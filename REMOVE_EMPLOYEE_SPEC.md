# REMOVE EMPLOYEE (ANONYMIZE) — BUILD SPEC

Add the ability for the owner to permanently remove an employee from the visible
app while preserving their historical shift/leave/audit records for payroll and
compliance purposes. This is NOT a hard delete — it's an anonymize-and-revoke.

## What "remove" means

When the owner removes an employee:
1. Their **login is permanently revoked** for that auth user — banned, can never
   sign in again. The 4-digit PIN itself becomes available for reuse by a future
   employee (see "PIN reuse" below) — uniqueness is enforced by `employee_id`,
   not by the PIN being permanently retired.
2. Their **name is replaced** in all UI displays with "Former employee" — but
   their `employee_id` stays the same internally, so all historical records
   (shifts, shift_services, leave_requests, audit_log, roster_shifts) remain
   correctly linked and queryable.
3. They **disappear from active lists** — Employees screen, roster builder,
   task assignment dropdowns — but their past shifts still show correctly in
   Reports, Timesheets history, and Audit log (with "Former employee" as the name).
4. This action is **irreversible** from the UI (the PIN is gone forever) — make
   the confirmation step serious enough to reflect that.

## Data layer changes (src/api/client.js)

Add a column to the employees table:
```sql
alter table employees add column removed_at timestamptz;
```

Do NOT delete the row. Do NOT delete the Supabase Auth user via the admin API in
a way that frees up the email — instead, ban the auth user so the email/PIN
combination can never authenticate again:

```
removeEmployee(employeeId, actorId, reason)  -> calls Edge Function 'remove-staff-login'
```

This needs a second Edge Function (same pattern as `create-staff-login`, same
service_role requirement, same owner-only check):

### New Edge Function: `supabase/functions/remove-staff-login/index.ts`

```ts
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

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL'),
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
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
      .from('employees').select('role').eq('user_id', user.id).single()
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

    // Delete the auth user entirely so the {pin}@aj-salon.internal email/PIN
    // combination becomes available for a future employee. employee_id (not
    // the PIN) is what keeps historical records uniquely attributed — the
    // anonymized "Former employee" name plus the stable employee_id is
    // considered sufficient separation between this person and whoever
    // is issued the same PIN later.
    if (target.user_id) {
      await supabase.auth.admin.deleteUser(target.user_id)
    }

    // Anonymize the employee row — keep employee_id intact for FK integrity.
    // pin is cleared (not retired) since the underlying auth user/email is
    // deleted above, freeing that PIN for a future employee to use.
    await supabase.from('employees').update({
      name: 'Former employee',
      pin: null,
      active: false,
      removed_at: new Date().toISOString(),
    }).eq('employee_id', employeeId)

    // Audit trail — record who was removed and why, before anonymization,
    // so the audit log itself retains the real name for compliance review.
    await supabase.from('audit_log').insert({
      actor_id: caller && user.id,
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
```

Deploy with: `npx supabase functions deploy remove-staff-login`

### Frontend client function

```js
export async function removeEmployee(employeeId, reason) {
  const { data: { session } } = await supabase.auth.getSession()
  const res = await fetch(
    `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/remove-staff-login`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${session.access_token}`,
      },
      body: JSON.stringify({ employeeId, reason }),
    }
  )
  const result = await res.json()
  if (!res.ok) throw new Error(result.error || 'Could not remove employee')
  return result
}
```

### Queries that need updating

Anywhere employees are listed for *active* use, filter out removed ones:
- `getEmployees()` (admin Employees screen) — exclude `removed_at IS NOT NULL` by
  default, but add a toggle "Show removed staff" that includes them read-only
  (no edit/reactivate actions, just visible in the list with a "Removed" badge
  and the date).
- Roster builder employee rows — exclude removed employees entirely.
- Task assignment dropdown — exclude removed employees.
- Dashboard "top staff" — exclude removed employees from new calculations, but
  historical shifts they completed still count toward location/day totals.

Anywhere history is shown, keep the row but display "Former employee" as the name:
- Timesheets (already shows employee name from join — will naturally show
  "Former employee" since that's now the actual `name` field value)
- Reports / CSV export — same, shows "Former employee" with their real
  `employee_id` as a stable identifier if Amelia needs to cross-reference
  (e.g. add an `Employee ID` column to the CSV export if not already present)
- Audit log — the remove action itself shows the real name in before_json (since
  the audit insert happens before anonymization), so there's always a recoverable
  record of who someone was, even after their row says "Former employee"

## UI changes (src/admin/Employees.jsx)

- Add a "Remove" button (danger styling, e.g. red text) next to each active
  employee, separate from the existing Active/Inactive toggle.
- Clicking it opens a confirmation modal — NOT a simple confirm(), something
  serious enough to match the irreversibility:
  - Title: "Remove [Name] permanently?"
  - Body: "This cannot be undone. Their PIN ([pin]) will never work again, and
    their name will be replaced with 'Former employee' everywhere in the app.
    Their shift history, hours, and records are kept for payroll and reporting."
  - A text input: "Type REMOVE to confirm" (must match exactly to enable the
    final button — this is the safety rail against misclicks)
  - Optional reason field ("Why are you removing them? e.g. left the salon")
  - Two buttons: "Cancel" / "Remove permanently" (red, disabled until REMOVE
    is typed)
- After removal: toast "Removed. Their history is preserved in Reports and Audit."
- Add a small link/toggle at the bottom of the Employees screen: "Show removed
  staff (N)" — expands a read-only list of removed employees with their removal
  date and reason, for Amelia's own reference. No actions available on these rows.

## Acceptance tests

1. Owner removes an active employee with reason "left the salon" → confirmation
   requires typing REMOVE → succeeds.
2. Removed employee's PIN no longer logs in as them (test the actual PIN, not
   just a flag check) — confirm error is the same "PIN not recognised" message
   users already see, not a different/confusing error.
2b. The same PIN can be assigned to a brand-new employee afterward via the
    instant-login "add employee" flow, and that new person logs in successfully
    as themselves (not as the removed employee — confirm name/employee_id are
    correct for the new hire).
3. Removed employee's existing shifts still show in Timesheets/Reports with name
   "Former employee" — totals/hours unaffected.
4. Removed employee no longer appears in roster builder or task assignment
   dropdown.
5. Audit log shows the remove action with the real original name in before_json,
   even though the employee row itself now says "Former employee".
6. Owner cannot remove themselves (test with the owner's own employee_id).
7. Attempting to type anything other than exactly "REMOVE" keeps the confirm
   button disabled.
8. "Show removed staff" toggle reveals the removed employee read-only, with
   removal date and reason visible.
9. `npm run build` passes, no service_role key in frontend bundle.

## Out of scope

Reactivating a removed employee (by design — once removed, that employee_id is
permanently retired; a returning staff member is treated as a new hire with a
new employee_id, even if they're given the same PIN as before), bulk removal.
