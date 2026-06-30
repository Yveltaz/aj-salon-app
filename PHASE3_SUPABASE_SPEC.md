# PHASE 3 — REAL BACKEND (SUPABASE) — BUILD SPEC

Migrate Amelia Jacob's Salon app from localStorage to a real Supabase backend.
All devices sync in real time. No screen changes — only `src/api/client.js` changes
and a new `src/api/supabase.js` config file.

## Stack

- **Database:** Supabase (Postgres)
- **Auth:** Supabase Auth — PIN login issues a JWT, all API calls are authenticated
- **Frontend:** stays on Vercel (no change)
- **Realtime:** Supabase Realtime for live dashboard updates

---

## Setup steps (do these first)

1. Create a free Supabase project at supabase.com
2. Note the project URL and anon key from Settings → API
3. Install the Supabase client:
   ```
   npm install @supabase/supabase-js
   ```
4. Create `.env.local` (already in .gitignore):
   ```
   VITE_SUPABASE_URL=https://your-project.supabase.co
   VITE_SUPABASE_ANON_KEY=your-anon-key
   ```
5. Create `src/api/supabase.js`:
   ```js
   import { createClient } from '@supabase/supabase-js'
   export const supabase = createClient(
     import.meta.env.VITE_SUPABASE_URL,
     import.meta.env.VITE_SUPABASE_ANON_KEY
   )
   ```

---

## Database schema (run in Supabase SQL editor)

```sql
-- Locations
create table locations (
  location_id text primary key,
  name text not null,
  address text
);
insert into locations values
  ('loc_macarthur', 'Macarthur Square', 'Macarthur Square, Campbelltown NSW'),
  ('loc_edpark', 'Ed Park', 'Ed Park, Kirrawee NSW');

-- Employees (linked to Supabase Auth via user_id)
create table employees (
  employee_id text primary key,
  user_id uuid references auth.users(id),
  name text not null,
  role text not null,
  pin text not null unique,
  active boolean default true
);
insert into employees (employee_id, name, role, pin) values
  ('emp_sophie', 'Sophie R.', 'Senior stylist', '1111'),
  ('emp_tahlia', 'Tahlia P.', 'Colourist', '2222'),
  ('emp_megan', 'Megan L.', 'Stylist', '3333'),
  ('emp_demo', 'Demo Staff', 'Stylist', '0000'),
  ('emp_owner', 'Amelia J.', 'owner', '9999');

-- Service categories
create table service_categories (
  service_category_id text primary key,
  name text not null,
  display_order int
);
insert into service_categories values
  ('svc_colours', 'Colours', 1),
  ('svc_extensions', 'Extensions', 2),
  ('svc_haircuts', 'Haircuts', 3),
  ('svc_washblow', 'Wash & blow dry', 4),
  ('svc_treatments', 'Treatments', 5);

-- Shifts
create table shifts (
  shift_id text primary key,
  employee_id text references employees(employee_id),
  location_id text references locations(location_id),
  clock_on_at timestamptz not null,
  clock_off_at timestamptz,
  break_minutes int default 0,
  on_break_since timestamptz,
  status text default 'active', -- active | submitted | approved | rejected
  approved_hours numeric,
  approved_by text,
  approved_at timestamptz,
  rejection_reason text
);

-- Shift events (immutable raw clock log)
create table shift_events (
  event_id text primary key,
  shift_id text references shifts(shift_id),
  event_type text not null, -- clock_on | break_start | break_end | clock_off
  timestamp timestamptz not null,
  source text default 'app'
);

-- Shift services
create table shift_services (
  id serial primary key,
  shift_id text references shifts(shift_id),
  service_category_id text references service_categories(service_category_id),
  count int not null
);

-- Tasks
create table tasks (
  task_id text primary key,
  title text not null,
  description text,
  location_id text references locations(location_id),
  assigned_to text references employees(employee_id),
  due_at timestamptz,
  priority text default 'normal',
  status text default 'pending',
  recurring text,
  completed_at timestamptz,
  completion_notes text
);

-- Roster shifts
create table roster_shifts (
  roster_id text primary key,
  employee_id text references employees(employee_id),
  location_id text references locations(location_id),
  date date not null,
  start_time time not null,
  end_time time not null,
  notes text,
  published boolean default false
);

-- Leave requests
create table leave_requests (
  leave_id text primary key,
  employee_id text references employees(employee_id),
  type text not null, -- annual | sick | unpaid | other
  from_date date not null,
  to_date date not null,
  notes text,
  status text default 'pending', -- pending | approved | rejected
  submitted_at timestamptz default now(),
  actioned_at timestamptz,
  actioned_by text references employees(employee_id),
  rejection_reason text
);

-- Audit log
create table audit_log (
  id serial primary key,
  actor_id text,
  entity_type text,
  entity_id text,
  action text,
  before_json jsonb,
  after_json jsonb,
  reason text,
  at timestamptz default now()
);

-- Row Level Security
alter table shifts enable row level security;
alter table shift_events enable row level security;
alter table shift_services enable row level security;
alter table tasks enable row level security;
alter table roster_shifts enable row level security;
alter table leave_requests enable row level security;
alter table audit_log enable row level security;
alter table employees enable row level security;

-- Policies: authenticated users can read/write their own data;
-- owner role can read/write everything.
-- Simple policy for now — tighten per-row in a later sprint.
create policy "authenticated access" on shifts for all using (auth.role() = 'authenticated');
create policy "authenticated access" on shift_events for all using (auth.role() = 'authenticated');
create policy "authenticated access" on shift_services for all using (auth.role() = 'authenticated');
create policy "authenticated access" on tasks for all using (auth.role() = 'authenticated');
create policy "authenticated access" on roster_shifts for all using (auth.role() = 'authenticated');
create policy "authenticated access" on leave_requests for all using (auth.role() = 'authenticated');
create policy "authenticated access" on audit_log for all using (auth.role() = 'authenticated');
create policy "authenticated access" on employees for all using (auth.role() = 'authenticated');
```

---

## Auth flow (PIN → JWT)

**Problem:** Supabase Auth uses email/password, not PINs.
**Solution:** Each employee has a synthetic email `{pin}@aj-salon.internal` and
password = their PIN. The login function looks up the employee by PIN, then calls
`supabase.auth.signInWithPassword({ email: \`${pin}@aj-salon.internal\`, password: pin })`.

**Setup:** For each employee, create a Supabase Auth user with that email/password.
Do this in a one-time seed script `scripts/seed-auth.js`:

```js
// Run once: node scripts/seed-auth.js
// Requires SUPABASE_SERVICE_ROLE_KEY (not the anon key — keep this secret)
import { createClient } from '@supabase/supabase-js'
const supabase = createClient(process.env.VITE_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY)
const pins = ['1111','2222','3333','0000','9999']
for (const pin of pins) {
  await supabase.auth.admin.createUser({
    email: `${pin}@aj-salon.internal`,
    password: pin,
    email_confirm: true
  })
  console.log(`Created user for PIN ${pin}`)
}
```

Add `SUPABASE_SERVICE_ROLE_KEY` to `.env.local` (never commit it, never expose it
to the frontend — service role key is server-only, only used in this seed script).

---

## Client.js migration

Replace every function in `src/api/client.js` with Supabase equivalents.
Keep all function signatures identical — no screen code changes.

Key patterns:

```js
// Auth
export async function login(pin) {
  const { data, error } = await supabase.auth.signInWithPassword({
    email: `${pin}@aj-salon.internal`, password: pin
  })
  if (error) throw new Error('PIN not recognised')
  const { data: emp } = await supabase.from('employees').select('*').eq('pin', pin).single()
  return emp
}

export async function logout() {
  await supabase.auth.signOut()
}

// Shifts
export async function clockOn(employeeId, locationId) {
  const shift_id = uid()
  const now = new Date().toISOString()
  const { data, error } = await supabase.from('shifts').insert({
    shift_id, employee_id: employeeId, location_id: locationId,
    clock_on_at: now, status: 'active'
  }).select().single()
  if (error) throw new Error(error.message)
  await supabase.from('shift_events').insert({
    event_id: uid(), shift_id, event_type: 'clock_on', timestamp: now
  })
  return data
}
// ... same pattern for all other functions
```

**Session persistence:** On app load check `supabase.auth.getSession()` — if a
valid session exists, skip the PIN screen. Add a `logout()` call to the sign-out
button in App.jsx.

---

## Realtime (dashboard live updates)

In `src/admin/Dashboard.jsx`, subscribe to shift changes so the dashboard updates
without refresh:

```js
useEffect(() => {
  const channel = supabase
    .channel('shifts')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'shifts' }, () => {
      refreshDashboard()
    })
    .subscribe()
  return () => supabase.removeChannel(channel)
}, [])
```

---

## Vercel environment variables

After deploying, add to Vercel → your project → Settings → Environment Variables:
- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_ANON_KEY`

These are safe to expose to the frontend (anon key only, RLS protects the data).

---

## Acceptance tests

1. `node scripts/seed-auth.js` runs without error, all 5 PINs created in Supabase Auth.
2. PIN `1111` logs in → JWT session stored → page refresh keeps user logged in.
3. PIN `1111` clocks on → row appears in Supabase `shifts` table immediately.
4. PIN `9999` (admin) → Dashboard → staff clocked on count updates in real time
   without page refresh.
5. PIN `1111` clocks off with 3 colours → `shift_services` rows inserted.
6. Admin approves shift → audit_log row written with before/after JSON.
7. Admin creates roster shift → PIN `1111` sees it on Roster tab (different device/browser).
8. PIN `1111` submits leave → PIN `9999` sees pending badge on Leave tab.
9. Wrong PIN → "PIN not recognised" error, no session created.
10. `npm run build` passes. No API keys in the built JS (verify in dist/).

---

## Out of scope

Row-level security per employee (all authenticated users see all data for now —
tighten in a later sprint), email notifications, multi-tenant (multiple salon
businesses), Xero/MYOB sync (Phase 5).
