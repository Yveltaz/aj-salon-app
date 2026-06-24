# ROSTER & LEAVE REQUESTS — BUILD SPEC

Extends the existing Amelia Jacob's Salon app (Vite + React, localStorage data layer).
Add two features: (1) admin builds the weekly roster, staff view it; (2) staff submit
leave requests, admin approves or rejects them.

## Ground rules

Same as admin portal spec:
1. Do not restructure existing screens. Extend only.
2. All data access through `src/api/client.js`. Add new functions with the existing
   "future REST endpoint" comment style.
3. Reuse all design tokens from `src/styles.css`. New CSS goes in a
   `/* ---- roster ---- */` section appended to that file.
4. No new runtime dependencies.
5. New components: `src/components/Roster.jsx`, `src/components/LeaveRequest.jsx`
   (staff side); `src/admin/Roster.jsx`, `src/admin/Leave.jsx` (admin side).

---

## Data layer additions (src/api/client.js)

```
// Roster
getRosterWeek(weekStart)              -> GET  /roster?week=YYYY-MM-DD
  returns: shifts[] where each shift = {
    roster_id, employee_id, location_id, date (YYYY-MM-DD),
    start_time (HH:MM), end_time (HH:MM), notes, published
  }

saveRosterShift(shift)                -> POST /roster          (upsert by roster_id)
deleteRosterShift(rosterId)           -> DELETE /roster/:id
publishRoster(weekStart)              -> POST /roster/publish  (sets published=true for whole week)
unpublishRoster(weekStart)            -> POST /roster/unpublish

// Leave
getMyLeaveRequests(employeeId)        -> GET  /leave?employee_id=
getAllLeaveRequests()                  -> GET  /leave           (admin)
submitLeaveRequest({employeeId, type, from, to, notes})
                                      -> POST /leave
approveLeave(leaveId, actorId)        -> POST /leave/:id/approve
rejectLeave(leaveId, actorId, reason) -> POST /leave/:id/reject  (reason REQUIRED)
```

**Data shapes to add to the localStorage store:**
```js
roster_shifts: []   // array of roster shift objects above
leave_requests: []  // { leave_id, employee_id, type, from, to, notes,
                    //   status: 'pending'|'approved'|'rejected',
                    //   submitted_at, actioned_at, actioned_by, rejection_reason }
```

**Audit rule:** approveLeave and rejectLeave write to `audit_log` same as timesheet
actions (actor_id, entity_type:'leave', entity_id, action, reason, at).

**Roster conflict rule:** saveRosterShift must check for an existing approved leave
request that overlaps the shift date for that employee. If one exists, throw:
`"${employee.name} has approved leave on ${date} — remove the leave approval first."`

---

## Staff screens

### Roster tab (src/components/Roster.jsx)

Replace the existing nav tab layout — add "Roster" as a 5th tab between Tasks and
KPIs. Icon: a calendar SVG (inline, same style as existing nav icons).

**Layout:**
- Week navigator at top: left/right arrows to move between weeks, current week
  label "16–22 Jun" centred. Default to current week.
- "Next shift" hero card (dark, same style as shift-hero) shown at top if the
  employee has an upcoming published shift. Shows: day + date, location, start–end
  time, any notes. If no upcoming shifts: soft message "No shifts rostered yet."
- Weekly grid below: 7 columns Mon–Sun, each day shows the employee's shift for
  that day (location pill + time range) or empty. Today's column has a gold left
  border. Past days are muted (opacity 0.5).
- Only show **published** roster shifts to staff. Unpublished drafts are admin-only.
- If roster hasn't been published for the viewed week: show a soft banner
  "Roster not yet published for this week."

### Leave request tab (src/components/LeaveRequest.jsx)

Add as a 6th tab after KPIs. Icon: a paper-plane or calendar-minus SVG.

**Layout:**
- "Request leave" button at top → opens inline form (not a modal):
  - Leave type: Annual / Sick / Unpaid / Other (segmented control, gold underline
    on selected)
  - From date / To date (native date inputs, styled to match brand)
  - Notes (optional, single textarea)
  - Submit button → disabled if no dates selected
- Below the form (or if form is hidden): list of past requests, newest first.
  Each row: type chip, date range, status pill (pending/approved/rejected),
  rejection reason shown inline if rejected.
- Staff cannot edit or cancel a submitted request — note this: "To cancel a
  request contact your manager."

---

## Admin screens

### Admin Roster (src/admin/Roster.jsx)

Add to admin sidebar nav between Tasks and Employees. Badge: none.

**Layout:**
- Same week navigator as staff view.
- Full weekly grid: all employees as rows, days as columns (7). Each cell shows
  that employee's rostered shift or is empty/clickable.
- Click an empty cell → opens shift editor panel (inline right panel or bottom
  sheet on mobile):
  - Employee (pre-filled from row)
  - Date (pre-filled from column)
  - Location select (Macarthur Square / Ed Park)
  - Start time / End time (time inputs)
  - Notes (optional)
  - Save / Delete buttons
  - If employee has approved leave on that date: show warning, block save.
- Click an existing shift cell → opens same editor pre-filled for editing/deleting.
- Unpublished shifts shown with a dashed border. Published shifts solid gold border.
- **Publish week** button (prominent, top right): publishes all shifts for the
  current week → staff can now see them. Confirm dialog: "Publish roster for
  [week]? Staff will be notified." (no actual notification yet — just confirm).
- **Unpublish** link (small, below publish button) for corrections. Shows warning:
  "Staff will no longer see this week's roster."
- Copy last week button: duplicates all shifts from the previous week into the
  current week as unpublished drafts. Useful for recurring rosters.

### Admin Leave (src/admin/Leave.jsx)

Add to admin sidebar nav after Roster. Badge: count of pending leave requests
(same style as Timesheets badge).

**Layout:**
- Filter tabs: All / Pending / Approved / Rejected
- Table: employee, leave type, from–to dates, days count, notes, status, actions.
- Pending rows: Approve button (green) + Reject button (red, opens reason modal —
  reason required same as timesheet reject).
- Approved/rejected rows: read-only with actioned date + who actioned.
- If approving leave that overlaps an existing published roster shift: show warning
  modal: "[Name] is rostered on [dates]. Approve anyway? Their roster shifts will
  need to be removed manually." — two buttons: "Approve anyway" / "Cancel".
  Do NOT auto-delete roster shifts — admin decides.

---

## Navigation changes

**Staff app (src/App.jsx):**
Current tabs: Shift · Tasks · KPIs · History
New tabs:     Shift · Tasks · Roster · Leave · KPIs · History

Update the nav grid to 6 columns. Keep existing tab IDs unchanged.

**Admin sidebar (src/admin/AdminPortal.jsx):**
Current: Dashboard · Timesheets · Tasks · Employees · Reports · Audit
New:     Dashboard · Timesheets · Tasks · Roster · Leave · Employees · Reports · Audit

---

## Acceptance tests

1. Admin creates a shift for Sophie on Monday at Macarthur Square 9am–5pm →
   unpublished → Sophie logs in → Roster tab → shift NOT visible.
2. Admin publishes the week → Sophie logs in → shift IS visible, "Next shift"
   hero shows it.
3. Sophie submits annual leave for that Monday → appears in admin Leave tab with
   pending badge.
4. Admin approves the leave → status shows approved in Sophie's leave list.
5. Admin tries to roster Sophie on that Monday after leave is approved → blocked
   with conflict error.
6. Admin rejects a leave request without entering a reason → blocked.
7. Admin uses "Copy last week" → previous week's shifts appear as unpublished
   drafts for current week.
8. Staff Leave tab: submit with no dates selected → Submit button stays disabled.
9. `npm run build` passes with no console errors.
10. Roster week navigator: clicking back/forward changes the week displayed
    correctly, no off-by-one on week boundaries.

---

## Out of scope

Push notifications for roster publish or leave approval, shift swaps between
staff, recurring shift templates beyond "copy last week", payroll impact of leave
types, public holidays calendar. Leave these for a later phase.
