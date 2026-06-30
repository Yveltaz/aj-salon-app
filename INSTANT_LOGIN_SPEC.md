# INSTANT STAFF LOGIN — BUILD SPEC

Currently, when the owner adds a new employee in the admin Employees screen, a
database row is created but the PIN can't log in until someone manually runs
`scripts/seed-auth.js` on a developer machine. Fix this so new employees can log
in immediately with their PIN, no manual step.

## Why this needs a server-side function

Creating a Supabase Auth user requires the `service_role` key, which bypasses all
security (Row Level Security, everything). That key must never be sent to the
browser or embedded in frontend code — if Amelia's laptop is compromised, the
whole database would be exposed. The fix is a Supabase Edge Function: a small
piece of server code that holds the secret key, and the frontend calls it instead
of touching Supabase Auth directly.

## What to build

### 1. Supabase Edge Function: `create-staff-login`

Location: `supabase/functions/create-staff-login/index.ts`

```ts
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
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL'),
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
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
```

### 2. Deploy the function

```bash
npx supabase login
npx supabase link --project-ref hmdmkxqxwmvdjegtjxhp
npx supabase functions deploy create-staff-login
npx supabase secrets set SUPABASE_SERVICE_ROLE_KEY=<the service role key>
```

(SUPABASE_URL is automatically available inside Edge Functions — don't set it manually.)

### 3. Frontend change (src/api/client.js)

Update `addEmployee` so that after inserting the employee row, it also calls the
Edge Function to create their login:

```js
export async function addEmployee({ name, role, pin }) {
  // Reject duplicate PINs before calling the function (existing check).
  const { data: existing } = await supabase.from('employees').select('pin').eq('pin', pin)
  if (existing?.length) throw new Error('This PIN is already in use')

  const employee_id = 'emp_' + uid()
  const { data: emp, error } = await supabase.from('employees')
    .insert({ employee_id, name, role, pin, active: true })
    .select().single()
  if (error) throw new Error(error.message)

  // Create the auth login via the Edge Function (uses the current admin's session token).
  const { data: { session } } = await supabase.auth.getSession()
  const res = await fetch(
    `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/create-staff-login`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${session.access_token}`,
      },
      body: JSON.stringify({ pin, employeeId: employee_id }),
    }
  )
  const result = await res.json()
  if (!res.ok) {
    // Roll back the employee row so we don't leave an orphaned record with no login.
    await supabase.from('employees').delete().eq('employee_id', employee_id)
    throw new Error(result.error || 'Could not create staff login')
  }

  return emp
}
```

### 4. UI feedback (src/admin/Employees.jsx)

After a successful add, show a toast: "Staff added — they can log in immediately
with their PIN." If it fails, show the specific error (e.g. "This PIN is already
in use") and do not show the employee as added (since it was rolled back).

## Acceptance tests

1. Owner adds employee "Jess" with PIN `4567` → toast confirms success.
2. Immediately (no script, no delay) sign out → PIN `4567` → logs in as Jess.
3. Owner tries to add another employee with PIN `4567` → blocked with "PIN already
   in use", no orphaned employee row created.
4. A non-owner (e.g. logged in as PIN `1111`) cannot call the Edge Function
   directly to create logins — returns 403 if attempted.
5. `npm run build` passes, no service_role key anywhere in frontend bundle.

## Out of scope

Self-service PIN reset, employee deactivation removing their login (deactivating
in the Employees screen should keep the login but the app should block them at
sign-in if `active = false` — add this check to the existing `login()` function
as a small addition, not a new system).
