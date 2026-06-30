import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

Deno.serve(async (req) => {
  const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  }
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  try {
    const { pin, employeeId } = await req.json()
    if (!pin || !/^\d{4}$/.test(pin)) {
      return new Response(JSON.stringify({ error: 'PIN must be 4 digits' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    // This function runs server-side only — service role key never reaches the browser.
    // SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are auto-injected into Edge Functions.
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    )

    // Confirm the caller is an authenticated admin (owner role) before proceeding.
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
      .from('employees').select('role').eq('user_id', user.id).single()
    if (caller?.role !== 'owner') {
      return new Response(JSON.stringify({ error: 'Only the owner can create staff logins' }), {
        status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    const email = `${pin}@aj-salon.internal`
    const { data, error } = await supabase.auth.admin.createUser({
      email, password: pin, email_confirm: true,
    })
    if (error) {
      if (error.message.includes('already been registered')) {
        return new Response(JSON.stringify({ error: 'This PIN is already in use' }), {
          status: 409, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        })
      }
      throw error
    }

    // Link the new auth user to the employee row.
    if (employeeId) {
      await supabase.from('employees').update({ user_id: data.user.id }).eq('employee_id', employeeId)
    }

    return new Response(JSON.stringify({ success: true, userId: data.user.id }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  } catch (e) {
    return new Response(JSON.stringify({ error: e.message }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }
})
