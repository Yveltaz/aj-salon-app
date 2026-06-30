# XERO PAYROLL SYNC — BUILD SPEC

Add the ability for the owner to push approved shift hours to Xero as draft
timesheets, reviewed and sent manually. CSV export stays available as a fallback.
This is Phase 5 of the blueprint.

## Ground rules

Same as previous specs: extend, don't restructure; all data access through
`src/api/client.js` plus new Edge Functions for anything touching Xero's secret
client credentials; reuse design tokens; no new frontend dependencies beyond
what's needed for the OAuth redirect handling.

## What this is NOT

This does not auto-push shifts. This does not calculate pay rates, leave loading,
superannuation, or tax. It pushes **total approved hours per employee per pay
period** to Xero as a payroll input — Amelia still reviews and processes payroll
inside Xero itself, same as if she'd typed the hours in manually, just faster
and with fewer transcription errors.

---

## Why Xero needs its own Edge Functions

Xero's OAuth flow requires a `client_secret` to exchange codes for tokens and to
refresh tokens — this must never reach the browser, same principle as Supabase's
service_role key. Three new Edge Functions are needed:

1. `xero-oauth-start` — builds the Xero authorization URL
2. `xero-oauth-callback` — exchanges the auth code for tokens, stores them
3. `xero-push-timesheet` — pushes approved hours using the stored token, refreshing it if needed

---

## Database changes

```sql
create table xero_connection (
  id int primary key default 1,
  tenant_id text,
  tenant_name text,
  access_token text,
  refresh_token text,
  token_expires_at timestamptz,
  connected_at timestamptz,
  connected_by text references employees(employee_id),
  check (id = 1) -- singleton — one Xero connection per salon business
);

create table xero_push_log (
  push_id text primary key,
  pay_period_start date,
  pay_period_end date,
  pushed_at timestamptz default now(),
  pushed_by text references employees(employee_id),
  employee_count int,
  total_hours numeric,
  status text, -- success | partial | failed
  xero_response jsonb,
  error_message text
);
```

`xero_connection` and `xero_push_log` need RLS enabled with the same
"authenticated access" policy pattern as other tables, but `access_token` and
`refresh_token` should only ever be read by Edge Functions using the
service_role key — the frontend should call a function to check connection
status, not query this table directly. Add:

```sql
alter table xero_connection enable row level security;
alter table xero_push_log enable row level security;
create policy "authenticated read push log" on xero_push_log for select using (auth.role() = 'authenticated');
-- No policy granting select on xero_connection to authenticated users —
-- only service_role (used by Edge Functions) can read it.
```

---

## Edge Function 1: xero-oauth-start

`supabase/functions/xero-oauth-start/index.ts`

Owner-only (same auth check pattern as `create-staff-login`). Builds and returns
the Xero authorization URL the frontend should redirect to:

```
https://login.xero.com/identity/connect/authorize?
  response_type=code&
  client_id={XERO_CLIENT_ID}&
  redirect_uri={SUPABASE_URL}/functions/v1/xero-oauth-callback&
  scope=openid profile email payroll.employees payroll.timesheets offline_access&
  state={random nonce, store in a short-lived table or signed into the state itself}
```

Use the `payroll.employees` and `payroll.timesheets` scopes — this app only
needs read access to employees (to match names) and write access to timesheets,
nothing else. Do not request accounting/invoicing scopes.

For state validation: sign a JWT-like payload containing `{ employeeId, expiresAt }`
using a secret (can reuse a portion of SUPABASE_SERVICE_ROLE_KEY hashed, or add a
new secret `XERO_STATE_SECRET`), so xero-oauth-callback can verify the request
genuinely originated from this app within the last 10 minutes, without needing
a database round-trip.

Set `XERO_CLIENT_ID` as a Supabase secret:
```
npx supabase secrets set XERO_CLIENT_ID=<value>
npx supabase secrets set XERO_CLIENT_SECRET=<value>
```

## Edge Function 2: xero-oauth-callback

`supabase/functions/xero-oauth-callback/index.ts`

This is the `redirect_uri` registered in the Xero app. Xero redirects here with
`?code=...&state=...` after the owner approves the connection in their browser.

1. Verify `state` (reject if invalid/expired — show a clear error page, not a blank screen)
2. Exchange `code` for tokens:
   ```
   POST https://identity.xero.com/connect/token
   Authorization: Basic base64(client_id:client_secret)
   Content-Type: application/x-www-form-urlencoded
   grant_type=authorization_code&code={code}&redirect_uri={this same callback URL}
   ```
3. Call `GET https://api.xero.com/connections` with the new access token to get
   the `tenantId` (the specific Xero organisation the owner just authorized)
4. Store `tenant_id`, `tenant_name`, `access_token`, `refresh_token`, and
   `token_expires_at` (now + expires_in seconds) in `xero_connection` (upsert,
   id=1 — replacing any previous connection)
5. Redirect the browser back to the app: `{COMPANY_URL}/admin?xero=connected`
   (or `?xero=error` with a message on failure)

Access tokens expire after 30 minutes; refresh tokens expire after 60 days —
so token_expires_at tracks the 30-minute access token, and the refresh flow
(below) handles getting new ones automatically as long as the connection is
used at least once every 60 days.

## Edge Function 3: xero-push-timesheet

`supabase/functions/xero-push-timesheet/index.ts`

Owner-only. Input: `{ payPeriodStart, payPeriodEnd }` (dates).

1. Load the stored connection from `xero_connection`. If none exists, return a
   clear error: "Xero is not connected. Connect it from the Reports screen first."
2. If `token_expires_at` has passed, refresh the token first:
   ```
   POST https://identity.xero.com/connect/token
   Authorization: Basic base64(client_id:client_secret)
   grant_type=refresh_token&refresh_token={stored refresh_token}
   ```
   Store the new access_token, refresh_token, and token_expires_at (Xero
   rotates refresh tokens on each use — always save the new one).
3. Query approved shifts within the pay period (`status = 'approved'`, grouped
   by employee), summing `approved_hours` per employee.
4. For each employee, look up their Xero employee record by matching name
   against `GET https://api.xero.com/payroll.xro/2.0/Employees` (cache this
   lookup per push — don't re-fetch per employee). If no match is found for an
   employee, skip them and record this in the result (don't fail the whole
   push) — Amelia needs to know "Sophie wasn't found in Xero, check her name
   matches" rather than the entire batch silently failing.
5. Push hours as a timesheet draft via the Xero Payroll API for each matched
   employee. Use Xero's sandbox/demo company behavior in mind — if Amelia's
   real Xero doesn't have Payroll enabled (some regions/plans don't), the API
   will reject with a clear error — surface that exact error rather than a
   generic failure.
6. Write a row to `xero_push_log` with the outcome — status `success` (all
   matched and pushed), `partial` (some employees skipped/unmatched), or
   `failed` (nothing pushed, e.g. connection/token error).
7. Return a structured result: `{ pushed: [...names], skipped: [...names with reasons], status }`

---

## Frontend changes

### src/api/client.js — new functions

```
getXeroStatus()                          -> calls a thin Edge Function (or reads
                                             a public-safe view) returning
                                             { connected: bool, tenantName, connectedAt }
                                             — never exposes tokens to the frontend
startXeroConnect()                       -> calls xero-oauth-start, returns the
                                             auth URL, frontend does
                                             window.location.href = url
pushToXero(payPeriodStart, payPeriodEnd) -> calls xero-push-timesheet
getXeroPushHistory()                     -> reads xero_push_log, newest first
disconnectXero()                          -> clears xero_connection row (owner-only,
                                             confirm before clearing)
```

### src/admin/Reports.jsx — new section

Add a "Payroll sync" card above or beside the existing CSV export:

- **If not connected:** "Connect to Xero" button → calls `startXeroConnect()`
  → redirects to Xero's login. After redirect back (`?xero=connected` in the
  URL), show a success toast and the connected organisation name.
- **If connected:** show "Connected to [Tenant Name]" with a small
  "Disconnect" link, plus the date pay period selector (reuse the existing
  Reports date range) and a **"Push to Xero"** button.
- Clicking Push to Xero opens a confirmation modal first — this is real payroll
  data, treat it with the same seriousness as the Remove Employee confirmation:
  - Shows a preview table: employee name, approved hours for the period
  - "This will create draft timesheets in Xero for review. Nothing is paid
    automatically — you'll still process payroll in Xero as normal."
  - Confirm / Cancel buttons
- After pushing: show the result — pushed count, any skipped employees with
  reasons ("Tahlia P. — no matching employee found in Xero"), and a link to a
  small **Sync history** table below (reads `getXeroPushHistory()`) showing
  past pushes with status, date, and employee count.
- CSV export button stays exactly where it is, unchanged — labeled "Export CSV
  (fallback)" so it's clear Xero is now the primary path but CSV still works.

### Error states to handle explicitly (not generic "something went wrong")

- Xero connection expired/revoked (refresh token expired after 60 days of
  inactivity) → "Xero connection expired. Please reconnect." with a Connect
  button, not a confusing error.
- Employee name mismatch → listed per-employee in the push result, not a
  blocking error for the whole batch.
- Xero Payroll not enabled on the connected organisation → surface Xero's own
  error message directly so Amelia knows it's a Xero account setting, not a
  bug in the app.

---

## Acceptance tests

1. Owner clicks "Connect to Xero" → redirected to Xero login → approves →
   redirected back to Reports with "Connected to [Demo Company name]" shown.
2. Disconnect → reconnect → works again, tenant info updates if a different
   org was chosen.
3. With 2+ approved shifts in a pay period for different employees → preview
   modal shows correct names and hour totals before pushing.
4. Push succeeds → `xero_push_log` row created with status `success`, visible
   in Sync history.
5. An employee whose name doesn't match any Xero employee → push still
   completes for the others, that employee listed as skipped with reason.
6. Manually expire the stored token (set `token_expires_at` to the past in the
   DB) → next push triggers a silent refresh and still succeeds.
7. Attempt to push with no Xero connection → clear error directing to Connect,
   no crash.
8. Non-owner cannot call any Xero Edge Function directly (403).
9. CSV export still works unchanged, independent of Xero connection status.
10. `npm run build` passes. No XERO_CLIENT_SECRET or raw access/refresh tokens
    anywhere in the frontend bundle.

---

## Out of scope

Per-service-type pay rates, leave loading/penalty rates, superannuation
calculation, two-way sync (reading payslips back from Xero), webhook-based
auto-push on approval, multi-organisation support (one Xero connection per
salon business, matching the blueprint's single-tenant assumption for now).
