import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

Deno.serve(async (req) => {
  const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  }
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  try {
    const { employeeId, reason } = await req.json()
    if (!employeeId) {
      return new Response(JSON.stringify({ error: 'employeeId required' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    // SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are auto-injected into Edge Functions.
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    )

    // Same owner-only auth check as create-staff-login.
    const authHeader = req.headers.get('Authorization')
    const { data: { user }, error: authError } = await supabase.auth.getUser(
      authHeader?.replace('Bearer ', '')
    )
    if (authError || !user) {
      return new Response(JSON.stringify({ error: 'Not authenticated' }), {
        status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }
    const { data: caller } = await supabase
      .from('employees').select('employee_id, role').eq('user_id', user.id).single()
    if (caller?.role !== 'owner') {
      return new Response(JSON.stringify({ error: 'Only the owner can remove staff' }), {
        status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    const { data: target } = await supabase
      .from('employees').select('user_id, name').eq('employee_id', employeeId).single()
    if (!target) {
      return new Response(JSON.stringify({ error: 'Employee not found' }), {
        status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }
    if (target.user_id === user.id) {
      return new Response(JSON.stringify({ error: 'You cannot remove your own account' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    // Anonymize the employee row FIRST — keep employee_id intact for FK
    // integrity, but clear name/pin/active and, crucially, user_id. There is a
    // foreign key from employees.user_id -> auth.users(id); the auth user below
    // cannot be deleted while this row still references it, so we must null
    // user_id before deleting. pin is cleared (not retired) so that PIN is freed
    // for a future employee to use.
    await supabase.from('employees').update({
      name: 'Former employee',
      pin: null,
      active: false,
      user_id: null,
      removed_at: new Date().toISOString(),
    }).eq('employee_id', employeeId)

    // Now delete the auth user entirely so the {pin}@aj-salon.internal email/PIN
    // combination becomes available for a future employee. employee_id (not the
    // PIN) is what keeps historical records uniquely attributed — the anonymized
    // "Former employee" name plus the stable employee_id is considered
    // sufficient separation between this person and whoever is issued the same
    // PIN later.
    if (target.user_id) {
      const { error: delErr } = await supabase.auth.admin.deleteUser(target.user_id)
      // If revoking the login fails we must not report success — the whole point
      // is that the removed PIN can never sign in again.
      if (delErr) throw new Error('Could not revoke the login: ' + (delErr.message || 'unknown error'))
    }

    // Audit trail — record who was removed and why, before anonymization,
    // so the audit log itself retains the real name for compliance review.
    // actor_id is the caller's employee_id (consistent with every other audit
    // row) so the Audit screen resolves it to the owner's name.
    await supabase.from('audit_log').insert({
      actor_id: caller.employee_id,
      entity_type: 'employee',
      entity_id: employeeId,
      action: 'remove',
      before_json: { name: target.name },
      after_json: { name: 'Former employee' },
      reason: reason || null,
      at: new Date().toISOString(),
    })

    return new Response(JSON.stringify({ success: true }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  } catch (e) {
    return new Response(JSON.stringify({ error: e.message }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }
})
