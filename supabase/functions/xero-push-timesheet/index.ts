// Pushes total approved hours per employee for a pay period to Xero as DRAFT
// timesheets. Owner-only. Refreshes the access token if expired. Unmatched
// employees are skipped (not fatal) and reported back. Every attempt is logged
// to xero_push_log.
import { corsHeaders, json, serviceClient, requireOwner, basicAuthHeader } from '../_shared/xero.ts'

const PAYROLL = 'https://api.xero.com/payroll.xro/2.0'
const uid = () => 'push_' + Math.random().toString(36).slice(2, 10) + Date.now().toString(36)
const normalize = (s: string) => (s || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()

function daysInclusive(start: string, end: string): string[] {
  const out: string[] = []
  const d = new Date(start + 'T00:00:00Z')
  const last = new Date(end + 'T00:00:00Z')
  while (d <= last) { out.push(d.toISOString().slice(0, 10)); d.setUTCDate(d.getUTCDate() + 1) }
  return out
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  const supabase = serviceClient()
  try {
    const auth = await requireOwner(supabase, req)
    if (!auth.ok) return auth.res

    const { payPeriodStart, payPeriodEnd } = await req.json().catch(() => ({}))
    if (!payPeriodStart || !payPeriodEnd) return json({ error: 'payPeriodStart and payPeriodEnd are required' }, 400)

    // 1. Load the singleton connection.
    const { data: conn } = await supabase.from('xero_connection').select('*').eq('id', 1).maybeSingle()
    if (!conn || !conn.tenant_id) {
      return json({ error: 'Xero is not connected. Connect it from the Reports screen first.' }, 400)
    }

    // 2. Refresh the token if it has expired (Xero rotates refresh tokens — save the new one).
    let accessToken = conn.access_token
    if (new Date(conn.token_expires_at).getTime() <= Date.now()) {
      const rRes = await fetch('https://identity.xero.com/connect/token', {
        method: 'POST',
        headers: { Authorization: basicAuthHeader(), 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ grant_type: 'refresh_token', refresh_token: conn.refresh_token }),
      })
      const refreshed = await rRes.json()
      if (!rRes.ok) {
        await logPush(supabase, auth.employeeId, payPeriodStart, payPeriodEnd, 0, 0, 'failed', refreshed, 'token refresh failed')
        return json({ error: 'Xero connection expired. Please reconnect.', status: 'expired' }, 400)
      }
      accessToken = refreshed.access_token
      await supabase.from('xero_connection').update({
        access_token: refreshed.access_token,
        refresh_token: refreshed.refresh_token,
        token_expires_at: new Date(Date.now() + refreshed.expires_in * 1000).toISOString(),
      }).eq('id', 1)
    }

    const xh = {
      Authorization: `Bearer ${accessToken}`,
      'Xero-Tenant-Id': conn.tenant_id,
      Accept: 'application/json',
      'Content-Type': 'application/json',
    }

    // 3. Sum approved hours per employee within the period.
    const endExclusive = new Date(payPeriodEnd + 'T00:00:00Z'); endExclusive.setUTCDate(endExclusive.getUTCDate() + 1)
    const { data: shifts } = await supabase
      .from('shifts').select('employee_id, approved_hours, status, clock_on_at')
      .eq('status', 'approved')
      .gte('clock_on_at', payPeriodStart)
      .lt('clock_on_at', endExclusive.toISOString())
    const totals: Record<string, number> = {}
    for (const s of shifts || []) totals[s.employee_id] = (totals[s.employee_id] || 0) + Number(s.approved_hours || 0)

    const empIds = Object.keys(totals)
    if (empIds.length === 0) {
      await logPush(supabase, auth.employeeId, payPeriodStart, payPeriodEnd, 0, 0, 'success', { note: 'no approved hours' }, null)
      return json({ pushed: [], skipped: [], status: 'success', message: 'No approved hours in this period.' })
    }
    const { data: emps } = await supabase.from('employees').select('employee_id, name').in('employee_id', empIds)
    const nameOf: Record<string, string> = {}
    for (const e of emps || []) nameOf[e.employee_id] = e.name

    // 4. Fetch Xero employees once and build a name -> EmployeeID map.
    const empRes = await fetch(`${PAYROLL}/Employees`, { headers: xh })
    const empBody = await empRes.json().catch(() => ({}))
    if (!empRes.ok) {
      if (empRes.status === 401) {
        await logPush(supabase, auth.employeeId, payPeriodStart, payPeriodEnd, 0, 0, 'failed', empBody, 'unauthorized')
        return json({ error: 'Xero connection expired. Please reconnect.', status: 'expired' }, 400)
      }
      // e.g. Payroll not enabled on this org — surface Xero's own message.
      const msg = xeroMessage(empBody) || `Xero returned ${empRes.status}`
      await logPush(supabase, auth.employeeId, payPeriodStart, payPeriodEnd, 0, 0, 'failed', empBody, msg)
      return json({ error: msg, status: 'failed' }, 400)
    }
    const xeroEmployees: any[] = empBody.Employees || empBody.employees || []
    const xeroByName: Record<string, string> = {}
    for (const xe of xeroEmployees) {
      const full = normalize(`${xe.FirstName || ''} ${xe.LastName || ''}`)
      if (full) xeroByName[full] = xe.EmployeeID
    }

    // Default earnings rate (required by the AU timesheet payload).
    const earningsRateId = await defaultEarningsRateId(xh)

    const days = daysInclusive(payPeriodStart, payPeriodEnd)
    const pushed: string[] = []
    const skipped: { name: string; reason: string }[] = []
    let pushFailure: { name: string; reason: string } | null = null

    // 5. Push a draft timesheet for each matched employee.
    for (const empId of empIds) {
      const name = nameOf[empId] || empId
      const hours = Math.round((totals[empId] || 0) * 100) / 100
      const xeroId = xeroByName[normalize(name)]
      if (!xeroId) {
        skipped.push({ name, reason: 'no matching employee found in Xero' })
        continue
      }
      if (!earningsRateId) {
        skipped.push({ name, reason: 'no ordinary earnings rate configured in Xero' })
        continue
      }
      // Total hours on the first day, zeros for the rest — sum = total approved hours.
      const units = days.map((_, i) => (i === 0 ? hours : 0))
      const tsRes = await fetch(`${PAYROLL}/Timesheets`, {
        method: 'POST',
        headers: xh,
        body: JSON.stringify([{
          EmployeeID: xeroId,
          StartDate: payPeriodStart,
          EndDate: payPeriodEnd,
          Status: 'DRAFT',
          TimesheetLines: [{ EarningsRateID: earningsRateId, NumberOfUnits: units }],
        }]),
      })
      const tsBody = await tsRes.json().catch(() => ({}))
      if (tsRes.ok) {
        pushed.push(name)
      } else {
        const msg = xeroMessage(tsBody) || `Xero returned ${tsRes.status}`
        skipped.push({ name, reason: msg })
        if (!pushFailure) pushFailure = { name, reason: msg }
      }
    }

    const status = pushed.length === 0 ? 'failed' : skipped.length > 0 ? 'partial' : 'success'
    const totalHours = pushed.reduce((a, n) => {
      const id = empIds.find((e) => nameOf[e] === n)
      return a + (id ? totals[id] : 0)
    }, 0)
    await logPush(
      supabase, auth.employeeId, payPeriodStart, payPeriodEnd,
      pushed.length, Math.round(totalHours * 100) / 100, status,
      { pushed, skipped }, pushFailure?.reason || (status === 'failed' ? 'all employees skipped' : null)
    )

    return json({ pushed, skipped, status })
  } catch (e) {
    return json({ error: (e as Error).message, status: 'failed' }, 500)
  }
})

function xeroMessage(body: any): string | null {
  if (!body) return null
  if (typeof body.Message === 'string') return body.Message
  if (typeof body.message === 'string') return body.message
  if (Array.isArray(body.Elements) && body.Elements[0]?.ValidationErrors?.[0]?.Message) {
    return body.Elements[0].ValidationErrors[0].Message
  }
  if (body.detail) return body.detail
  return null
}

async function defaultEarningsRateId(headers: Record<string, string>): Promise<string | null> {
  try {
    const res = await fetch(`${PAYROLL}/PayItems`, { headers })
    if (!res.ok) return null
    const body = await res.json()
    const rates: any[] = body?.PayItems?.EarningsRates || body?.EarningsRates || []
    if (rates.length === 0) return null
    const ordinary = rates.find((r) => /ordinary/i.test(r.Name || '')) || rates[0]
    return ordinary.EarningsRateID || null
  } catch {
    return null
  }
}

async function logPush(
  supabase: any, pushedBy: string, start: string, end: string,
  employeeCount: number, totalHours: number, status: string,
  xeroResponse: unknown, errorMessage: string | null
) {
  await supabase.from('xero_push_log').insert({
    push_id: uid(),
    pay_period_start: start,
    pay_period_end: end,
    pushed_by: pushedBy,
    employee_count: employeeCount,
    total_hours: totalHours,
    status,
    xero_response: xeroResponse,
    error_message: errorMessage,
  })
}
