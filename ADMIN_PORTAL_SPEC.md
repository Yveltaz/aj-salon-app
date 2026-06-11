# ADMIN PORTAL — BUILD SPEC

Project: Amelia Jacob's Salon staff app (this repo, Vite + React, no router lib).
Goal: add the **owner/admin portal** to this same app so it shares the existing
localStorage data layer — a shift submitted in the staff app must appear for
approval in the admin portal in the same browser. Do not add a backend yet.

## Ground rules

1. **Do not restructure the staff app.** Extend, don't rewrite. Staff screens in
   `src/components/` stay as they are.
2. **All data access goes through `src/api/client.js`.** Add new functions there
   (signatures below). Keep the existing localStorage `KEY` and shapes — admin and
   staff must read the same store. Every new function gets the same
   "future REST endpoint" comment style as the existing ones.
3. **Reuse the design tokens in `src/styles.css`** (`--ivory`, `--blush`, `--gold`,
   `--ink`, `--night`, `.card`, `.btn-*`, `.eyebrow`, `.status`). Admin portal is
   the same brand: ivory background, white cards, hairline gold, Cormorant
   Garamond headings, Jost body. Desktop-first layout (sidebar + content) but must
   not break below 768px (sidebar collapses to a top bar).
4. No new runtime dependencies. React + existing CSS only. No Tailwind, no UI kits.
5. Keep diffs reviewable: new components under `src/admin/`, one new CSS section
   appended to `styles.css` marked `/* ---- admin ---- */`.

## Entry / auth

- Admin PIN `9999` (add `{ employee_id: 'emp_owner', name: 'Amelia J.', role: 'owner', pin: '9999' }` to seed employees).
- In `App.jsx`: after login, if `role === 'owner'` render `<AdminPortal>` instead of the staff shell. Staff flow unchanged for everyone else.
- Sign out returns to the shared PIN screen.

## Data layer additions (src/api/client.js)

```
getAdminDashboard()            -> GET  /admin/dashboard
  returns: clockedOnNow[{employee, location, clock_on_at}], todayHours,
           todayServices, pendingApprovalCount, overdueTaskCount,
           perLocationToday[{location_id, hours, services}]

getShiftsForApproval()         -> GET  /admin/shifts?status=submitted
approveShift(shiftId, actorId) -> POST /admin/shifts/:id/approve
rejectShift(shiftId, actorId, reason)            -> POST .../reject   (reason REQUIRED)
editShiftHours(shiftId, actorId, newBreakMinutes, newClockOff, reason)
                               -> PATCH /admin/shifts/:id  (reason REQUIRED)

getEmployees() / addEmployee({name, role, pin}) / setEmployeeActive(id, active)
getAllTasks() / addTask({title, description, location_id, due_at, priority, recurring})
deleteTask(taskId)

getReport({from, to})          -> GET /admin/reports
  returns rows: {employee, location, date, paid_hours, services_by_category, total_services}
exportReportCsv({from, to})    -> client-side CSV string + trigger download

getAuditLog()                  -> GET /admin/audit
```

**Audit rule (non-negotiable):** any approve / reject / edit writes an entry to a
new `audit_log` array in the store: `{actor_id, entity_type:'shift', entity_id,
action, before_json, after_json, reason, at}`. Edits must NEVER mutate
`shift_events` (raw clock log is immutable) — only `break_minutes`,
`clock_off_at`-derived `approved_hours`, and `status`. Store `approved_hours`
on the shift at approval time.

Shift statuses: `active` → `submitted` → `approved` | `rejected`.
Rejected shifts remain visible to the employee in History with status pill.

## Screens (src/admin/)

1. **Dashboard** (`Dashboard.jsx`) — top stat cards matching the mockup:
   "Staff clocked on today", "Total hours today", "Total services today",
   "Shifts awaiting approval", "Tasks overdue". Below: per-location comparison
   (two columns: Macarthur Square vs Ed Park — hours + services today, simple
   gold bar like `.bar`), and "Top staff this week" table (name, services,
   hours, services/hr) computed from approved+submitted shifts.

2. **Timesheets** (`Timesheets.jsx`) — list of `submitted` shifts: employee,
   date, location, clock on/off, breaks, calculated hours, services entered.
   Row actions: Approve (one tap), Reject (modal, reason required), Edit
   (modal: adjust break minutes / clock-off time, reason required, shows
   before→after). Show raw clock events read-only in the edit modal.

3. **Tasks** (`AdminTasks.jsx`) — table of all tasks with status; create task
   form (title, description, location select, due time, priority, recurring
   daily/weekly/none); delete with confirm.

4. **Employees** (`Employees.jsx`) — list with role + active toggle; add
   employee form (name, role, 4-digit PIN; reject duplicate PINs).

5. **Reports** (`Reports.jsx`) — date range (default: last 7 days), table per
   employee/day, totals row, "Export CSV" button (filename
   `aj-payroll-YYYY-MM-DD.csv`, columns: employee, date, location, paid_hours,
   each service category, total_services). CSV exports **approved shifts only**
   — note this in the UI ("Only approved shifts are exported for payroll").

6. **Audit log** (`Audit.jsx`) — reverse-chronological list: who, what,
   before→after, reason, timestamp. Read-only.

Sidebar nav order: Dashboard, Timesheets (with pending-count badge), Tasks,
Employees, Reports, Audit. AJ wordmark on top, "Sign out" at bottom.

## Acceptance tests (verify before finishing)

1. Staff PIN 1111: clock on at Macarthur Square, clock off with 3 colours →
   admin PIN 9999: shift appears in Timesheets, pending badge = 1.
2. Approve it → status `approved`, appears in Reports + CSV, audit entry exists.
3. Edit a shift's break minutes without entering a reason → blocked.
4. Reject flow requires a reason; employee History shows `rejected` pill.
5. Add employee with PIN `1111` → blocked (duplicate).
6. Create a task for Ed Park → shows in staff Tasks tab.
7. `npm run build` passes; no console errors on either portal.
8. Dashboard numbers reconcile with underlying shifts (no NaN with empty store).

## Out of scope (do not build)

Xero/MYOB API sync (Phase 5 — CSV export is the payroll path for now), GPS/QR
clock-on proof, rostering, multi-manager per-location permissions, photos on
tasks, real backend. Leave the API-comment scaffolding so these slot in later.
