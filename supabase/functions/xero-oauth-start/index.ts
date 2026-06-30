// Builds the Xero authorization URL for the owner to begin connecting. Owner-only.
// The app's origin is signed into `state` so the callback can return the browser
// to wherever the owner started from, with a 10-minute expiry for CSRF safety.
import { corsHeaders, json, serviceClient, requireOwner, signState, callbackUrl } from '../_shared/xero.ts'

const SCOPES = 'openid profile email payroll.employees payroll.timesheets offline_access'

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  try {
    const supabase = serviceClient()
    const auth = await requireOwner(supabase, req)
    if (!auth.ok) return auth.res

    const body = await req.json().catch(() => ({}))
    const origin = typeof body?.origin === 'string' ? body.origin : ''

    const state = await signState({
      employeeId: auth.employeeId,
      origin,
      exp: Date.now() + 10 * 60 * 1000,
    })

    const params = new URLSearchParams({
      response_type: 'code',
      client_id: Deno.env.get('XERO_CLIENT_ID')!,
      redirect_uri: callbackUrl(),
      scope: SCOPES,
      state,
    })
    const url = `https://login.xero.com/identity/connect/authorize?${params.toString()}`
    return json({ url })
  } catch (e) {
    return json({ error: (e as Error).message }, 500)
  }
})
