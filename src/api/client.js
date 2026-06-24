// ---------------------------------------------------------------------------
// Amelia Jacob's Salon — data layer
//
// Every function here mirrors a REST endpoint from the blueprint (section 8).
// Today it persists to localStorage so the app runs standalone on a phone.
// To go live: replace the bodies with fetch() calls to the backend and keep
// the same signatures — no screen code changes required.
//
//   login(pin)                       -> POST /auth/pin
//   getLocations()                   -> GET  /locations
//   getActiveShift(employeeId)       -> GET  /shifts/active
//   clockOn(employeeId, locationId)  -> POST /shifts            (shift_events: clock_on)
//   startBreak(shiftId)              -> POST /shifts/:id/events (break_start)
//   endBreak(shiftId)                -> POST /shifts/:id/events (break_end)
//   clockOff(shiftId, services)      -> POST /shifts/:id/clock-off  -> status: submitted
//   getTasks(employeeId)             -> GET  /tasks?assigned_to=
//   setTaskStatus(taskId, status)    -> PATCH /tasks/:id
//   getShiftHistory(employeeId)      -> GET  /shifts?employee_id=
//   getKpis(employeeId)              -> GET  /kpis/me
// ---------------------------------------------------------------------------

const KEY = 'aj_salon_db_v1'

export const LOCATIONS = [
  { location_id: 'loc_macarthur', name: 'Macarthur Square', address: 'Macarthur Square, Campbelltown NSW' },
  { location_id: 'loc_edpark', name: 'Ed Park', address: 'Ed Park, Kirrawee NSW' },
]

export const SERVICE_CATEGORIES = [
  { service_category_id: 'svc_colours', name: 'Colours', display_order: 1 },
  { service_category_id: 'svc_extensions', name: 'Extensions', display_order: 2 },
  { service_category_id: 'svc_haircuts', name: 'Haircuts', display_order: 3 },
  { service_category_id: 'svc_washblow', name: 'Wash & blow dry', display_order: 4 },
  { service_category_id: 'svc_treatments', name: 'Treatments', display_order: 5 },
]

const SEED_EMPLOYEES = [
  { employee_id: 'emp_sophie', name: 'Sophie R.', role: 'Senior stylist', pin: '1111' },
  { employee_id: 'emp_tahlia', name: 'Tahlia P.', role: 'Colourist', pin: '2222' },
  { employee_id: 'emp_megan', name: 'Megan L.', role: 'Stylist', pin: '3333' },
  { employee_id: 'emp_demo', name: 'Demo Staff', role: 'Stylist', pin: '0000' },
  { employee_id: 'emp_owner', name: 'Amelia J.', role: 'owner', pin: '9999' },
]

function seedTasks() {
  const today = new Date()
  const at = (h, m = 0) => {
    const d = new Date(today)
    d.setHours(h, m, 0, 0)
    return d.toISOString()
  }
  return [
    { task_id: 't1', title: 'Prepare towels & check basins', description: 'Opening checklist — both basin stations.', location_id: 'loc_macarthur', assigned_to: null, due_at: at(9, 30), priority: 'high', status: 'pending', recurring: 'daily' },
    { task_id: 't2', title: 'Restock colour bowls', description: 'Check tint brushes and bowls at colour bar.', location_id: 'loc_macarthur', assigned_to: null, due_at: at(12, 0), priority: 'normal', status: 'pending', recurring: 'daily' },
    { task_id: 't3', title: 'Update retail display', description: 'Front shelf — feature the new treatment range.', location_id: 'loc_edpark', assigned_to: null, due_at: at(14, 0), priority: 'normal', status: 'pending', recurring: null },
    { task_id: 't4', title: 'Closing: clean basins & laundry', description: 'End-of-day routine. Note anything out of stock.', location_id: 'loc_macarthur', assigned_to: null, due_at: at(17, 30), priority: 'high', status: 'pending', recurring: 'daily' },
  ]
}

function load() {
  try {
    const raw = localStorage.getItem(KEY)
    if (raw) {
      const db = JSON.parse(raw)
      if (!db.audit_log) db.audit_log = []
      if (!db.roster_shifts) db.roster_shifts = []
      if (!db.leave_requests) db.leave_requests = []
      return db
    }
  } catch (e) { /* corrupted store — reseed */ }
  const db = { employees: SEED_EMPLOYEES, shifts: [], shift_events: [], shift_services: [], tasks: seedTasks(), audit_log: [], roster_shifts: [], leave_requests: [] }
  save(db)
  return db
}

function save(db) {
  localStorage.setItem(KEY, JSON.stringify(db))
}

const uid = () => 'id_' + Math.random().toString(36).slice(2, 10) + Date.now().toString(36)

// Add n days to a YYYY-MM-DD string, returning a YYYY-MM-DD string (local-safe).
function addDaysStr(ymd, n) {
  const [y, m, d] = ymd.split('-').map(Number)
  const dt = new Date(y, m - 1, d)
  dt.setDate(dt.getDate() + n)
  const yy = dt.getFullYear()
  const mm = String(dt.getMonth() + 1).padStart(2, '0')
  const dd = String(dt.getDate()).padStart(2, '0')
  return `${yy}-${mm}-${dd}`
}

// --- auth ------------------------------------------------------------------

export async function login(pin) {
  const db = load()
  const emp = db.employees.find((e) => e.pin === pin)
  if (!emp) throw new Error('PIN not recognised')
  const { pin: _drop, ...safe } = emp
  return safe
}

// --- shifts ----------------------------------------------------------------

export async function getActiveShift(employeeId) {
  const db = load()
  return db.shifts.find((s) => s.employee_id === employeeId && s.status === 'active') || null
}

export async function clockOn(employeeId, locationId) {
  const db = load()
  if (db.shifts.some((s) => s.employee_id === employeeId && s.status === 'active')) {
    throw new Error('Already clocked on')
  }
  const now = new Date().toISOString()
  const shift = {
    shift_id: uid(),
    employee_id: employeeId,
    location_id: locationId,
    clock_on_at: now,
    clock_off_at: null,
    break_minutes: 0,
    on_break_since: null,
    status: 'active',
  }
  db.shifts.push(shift)
  db.shift_events.push({ event_id: uid(), shift_id: shift.shift_id, event_type: 'clock_on', timestamp: now, source: 'app' })
  save(db)
  return shift
}

export async function startBreak(shiftId) {
  const db = load()
  const s = db.shifts.find((x) => x.shift_id === shiftId)
  if (!s || s.status !== 'active') throw new Error('No active shift')
  if (s.on_break_since) throw new Error('Already on a break')
  s.on_break_since = new Date().toISOString()
  db.shift_events.push({ event_id: uid(), shift_id: shiftId, event_type: 'break_start', timestamp: s.on_break_since, source: 'app' })
  save(db)
  return s
}

export async function endBreak(shiftId) {
  const db = load()
  const s = db.shifts.find((x) => x.shift_id === shiftId)
  if (!s || !s.on_break_since) throw new Error('Not on a break')
  const now = new Date()
  const mins = Math.max(1, Math.round((now - new Date(s.on_break_since)) / 60000))
  s.break_minutes += mins
  s.on_break_since = null
  db.shift_events.push({ event_id: uid(), shift_id: shiftId, event_type: 'break_end', timestamp: now.toISOString(), source: 'app' })
  save(db)
  return s
}

export async function clockOff(shiftId, serviceCounts) {
  const db = load()
  const s = db.shifts.find((x) => x.shift_id === shiftId)
  if (!s || s.status !== 'active') throw new Error('No active shift')
  const now = new Date()
  if (s.on_break_since) {
    const mins = Math.max(1, Math.round((now - new Date(s.on_break_since)) / 60000))
    s.break_minutes += mins
    s.on_break_since = null
    db.shift_events.push({ event_id: uid(), shift_id: shiftId, event_type: 'break_end', timestamp: now.toISOString(), source: 'app' })
  }
  s.clock_off_at = now.toISOString()
  s.status = 'submitted' // awaiting manager approval — never goes to payroll before that
  db.shift_events.push({ event_id: uid(), shift_id: shiftId, event_type: 'clock_off', timestamp: s.clock_off_at, source: 'app' })
  for (const [service_category_id, count] of Object.entries(serviceCounts)) {
    if (count > 0) db.shift_services.push({ shift_id: shiftId, service_category_id, count })
  }
  save(db)
  return s
}

export async function getShiftHistory(employeeId) {
  const db = load()
  return db.shifts
    .filter((s) => s.employee_id === employeeId && s.status !== 'active')
    .sort((a, b) => new Date(b.clock_on_at) - new Date(a.clock_on_at))
    .map((s) => ({ ...s, services: db.shift_services.filter((x) => x.shift_id === s.shift_id) }))
}

// --- tasks -----------------------------------------------------------------

export async function getTasks() {
  const db = load()
  return [...db.tasks].sort((a, b) => new Date(a.due_at) - new Date(b.due_at))
}

export async function setTaskStatus(taskId, status, note) {
  const db = load()
  const t = db.tasks.find((x) => x.task_id === taskId)
  if (!t) throw new Error('Task not found')
  t.status = status
  if (status === 'completed') t.completed_at = new Date().toISOString()
  if (note) t.completion_notes = note
  save(db)
  return t
}

// --- KPIs ------------------------------------------------------------------

export function shiftPaidHours(s) {
  if (!s.clock_off_at) return 0
  const mins = (new Date(s.clock_off_at) - new Date(s.clock_on_at)) / 60000 - (s.break_minutes || 0)
  return Math.max(0, mins / 60)
}

export async function getKpis(employeeId) {
  const db = load()
  const weekAgo = Date.now() - 7 * 86400000
  const shifts = db.shifts.filter(
    (s) => s.employee_id === employeeId && s.status !== 'active' && new Date(s.clock_on_at).getTime() >= weekAgo
  )
  const hours = shifts.reduce((a, s) => a + shiftPaidHours(s), 0)
  const shiftIds = new Set(shifts.map((s) => s.shift_id))
  const services = db.shift_services.filter((x) => shiftIds.has(x.shift_id))
  const totalServices = services.reduce((a, x) => a + x.count, 0)
  const byCategory = {}
  for (const c of SERVICE_CATEGORIES) byCategory[c.service_category_id] = 0
  for (const x of services) byCategory[x.service_category_id] = (byCategory[x.service_category_id] || 0) + x.count
  const tasks = db.tasks
  const done = tasks.filter((t) => t.status === 'completed').length
  return {
    hours,
    shiftCount: shifts.length,
    totalServices,
    servicesPerHour: hours > 0 ? totalServices / hours : 0,
    byCategory,
    taskCompletion: tasks.length ? done / tasks.length : 0,
  }
}

export function resetDemo() {
  localStorage.removeItem(KEY)
}

// --- admin ------------------------------------------------------------------
//
//   getAdminDashboard()                                -> GET  /admin/dashboard
//   getShiftsForApproval()                             -> GET  /admin/shifts?status=submitted
//   approveShift(shiftId, actorId)                     -> POST /admin/shifts/:id/approve
//   rejectShift(shiftId, actorId, reason)              -> POST /admin/shifts/:id/reject  (reason REQUIRED)
//   editShiftHours(shiftId, actorId, brk, off, reason) -> PATCH /admin/shifts/:id        (reason REQUIRED)
//   getEmployees()                                     -> GET  /admin/employees
//   addEmployee({name, role, pin})                     -> POST /admin/employees
//   setEmployeeActive(id, active)                      -> PATCH /admin/employees/:id
//   getAllTasks()                                      -> GET  /admin/tasks
//   addTask({title, description, location_id, due_at, priority, recurring})
//                                                      -> POST /admin/tasks
//   deleteTask(taskId)                                 -> DELETE /admin/tasks/:id
//   getReport({from, to})                              -> GET  /admin/reports
//   exportReportCsv({from, to})                        -> client-side CSV + download
//   getAuditLog()                                      -> GET  /admin/audit

export async function getAdminDashboard() {
  const db = load()
  const todayStr = new Date().toISOString().slice(0, 10)

  const clockedOnNow = db.shifts
    .filter((s) => s.status === 'active')
    .map((s) => ({
      employee: (({ pin: _p, ...e }) => e)(db.employees.find((e) => e.employee_id === s.employee_id) || {}),
      location: LOCATIONS.find((l) => l.location_id === s.location_id),
      clock_on_at: s.clock_on_at,
    }))

  const todayShifts = db.shifts.filter(
    (s) => s.clock_on_at.slice(0, 10) === todayStr && (s.status === 'submitted' || s.status === 'approved')
  )
  const todayHours = todayShifts.reduce((a, s) => a + shiftPaidHours(s), 0)
  const todayShiftIds = new Set(todayShifts.map((s) => s.shift_id))
  const todayServices = db.shift_services
    .filter((x) => todayShiftIds.has(x.shift_id))
    .reduce((a, x) => a + x.count, 0)

  const pendingApprovalCount = db.shifts.filter((s) => s.status === 'submitted').length
  const overdueTaskCount = db.tasks.filter((t) => t.status !== 'completed' && new Date(t.due_at) < new Date()).length

  const perLocationToday = LOCATIONS.map((loc) => {
    const ls = todayShifts.filter((s) => s.location_id === loc.location_id)
    const lIds = new Set(ls.map((s) => s.shift_id))
    return {
      location_id: loc.location_id,
      name: loc.name,
      hours: ls.reduce((a, s) => a + shiftPaidHours(s), 0),
      services: db.shift_services.filter((x) => lIds.has(x.shift_id)).reduce((a, x) => a + x.count, 0),
    }
  })

  const weekAgo = Date.now() - 7 * 86400000
  const weekShifts = db.shifts.filter(
    (s) => (s.status === 'approved' || s.status === 'submitted') && new Date(s.clock_on_at).getTime() >= weekAgo
  )
  const empStats = {}
  for (const s of weekShifts) {
    if (!empStats[s.employee_id]) {
      const emp = db.employees.find((e) => e.employee_id === s.employee_id)
      if (!emp || emp.role === 'owner') continue
      empStats[s.employee_id] = { employee_id: s.employee_id, name: emp.name, hours: 0, services: 0 }
    }
    if (empStats[s.employee_id]) empStats[s.employee_id].hours += shiftPaidHours(s)
  }
  const weekShiftIds = new Set(weekShifts.map((s) => s.shift_id))
  for (const x of db.shift_services.filter((x) => weekShiftIds.has(x.shift_id))) {
    const s = weekShifts.find((sh) => sh.shift_id === x.shift_id)
    if (s && empStats[s.employee_id]) empStats[s.employee_id].services += x.count
  }
  const topStaff = Object.values(empStats)
    .map((e) => ({ ...e, servicesPerHour: e.hours > 0 ? e.services / e.hours : 0 }))
    .sort((a, b) => b.services - a.services)

  return { clockedOnNow, todayHours, todayServices, pendingApprovalCount, overdueTaskCount, perLocationToday, topStaff }
}

export async function getShiftsForApproval() {
  const db = load()
  return db.shifts
    .filter((s) => s.status === 'submitted')
    .sort((a, b) => new Date(a.clock_on_at) - new Date(b.clock_on_at))
    .map((s) => ({
      ...s,
      employee: (({ pin: _p, ...e }) => e)(db.employees.find((e) => e.employee_id === s.employee_id) || {}),
      location: LOCATIONS.find((l) => l.location_id === s.location_id),
      services: db.shift_services.filter((x) => x.shift_id === s.shift_id),
      events: db.shift_events.filter((x) => x.shift_id === s.shift_id),
    }))
}

export async function approveShift(shiftId, actorId) {
  const db = load()
  const s = db.shifts.find((x) => x.shift_id === shiftId)
  if (!s || s.status !== 'submitted') throw new Error('Shift not submitted')
  const before = { ...s }
  s.status = 'approved'
  s.approved_hours = shiftPaidHours(s)
  s.approved_by = actorId
  s.approved_at = new Date().toISOString()
  db.audit_log.push({ actor_id: actorId, entity_type: 'shift', entity_id: shiftId, action: 'approve', before_json: JSON.stringify(before), after_json: JSON.stringify(s), reason: null, at: new Date().toISOString() })
  save(db)
  return s
}

// shift_events is immutable — only break_minutes and clock_off_at are modified
export async function rejectShift(shiftId, actorId, reason) {
  if (!reason) throw new Error('Reason is required')
  const db = load()
  const s = db.shifts.find((x) => x.shift_id === shiftId)
  if (!s || s.status !== 'submitted') throw new Error('Shift not submitted')
  const before = { ...s }
  s.status = 'rejected'
  s.rejected_by = actorId
  s.rejected_at = new Date().toISOString()
  s.rejection_reason = reason
  db.audit_log.push({ actor_id: actorId, entity_type: 'shift', entity_id: shiftId, action: 'reject', before_json: JSON.stringify(before), after_json: JSON.stringify(s), reason, at: new Date().toISOString() })
  save(db)
  return s
}

export async function editShiftHours(shiftId, actorId, newBreakMinutes, newClockOff, reason) {
  if (!reason) throw new Error('Reason is required')
  const db = load()
  const s = db.shifts.find((x) => x.shift_id === shiftId)
  if (!s || s.status !== 'submitted') throw new Error('Shift not submitted')
  const before = { ...s }
  if (newBreakMinutes !== undefined && newBreakMinutes !== null) s.break_minutes = Number(newBreakMinutes)
  if (newClockOff) s.clock_off_at = newClockOff
  db.audit_log.push({ actor_id: actorId, entity_type: 'shift', entity_id: shiftId, action: 'edit', before_json: JSON.stringify(before), after_json: JSON.stringify(s), reason, at: new Date().toISOString() })
  save(db)
  return s
}

export async function getEmployees() {
  const db = load()
  return db.employees.map(({ pin: _p, ...e }) => e)
}

export async function addEmployee({ name, role, pin }) {
  const db = load()
  if (db.employees.some((e) => e.pin === pin)) throw new Error('PIN already in use')
  const emp = { employee_id: uid(), name, role, pin, active: true }
  db.employees.push(emp)
  save(db)
  const { pin: _p, ...safe } = emp
  return safe
}

export async function setEmployeeActive(id, active) {
  const db = load()
  const emp = db.employees.find((e) => e.employee_id === id)
  if (!emp) throw new Error('Employee not found')
  emp.active = active
  save(db)
  const { pin: _p, ...safe } = emp
  return safe
}

export async function getAllTasks() {
  const db = load()
  return [...db.tasks].sort((a, b) => new Date(a.due_at) - new Date(b.due_at))
}

export async function addTask({ title, description, location_id, due_at, priority, recurring }) {
  const db = load()
  const task = { task_id: uid(), title, description: description || '', location_id, assigned_to: null, due_at, priority: priority || 'normal', status: 'pending', recurring: recurring || null }
  db.tasks.push(task)
  save(db)
  return task
}

export async function deleteTask(taskId) {
  const db = load()
  const idx = db.tasks.findIndex((t) => t.task_id === taskId)
  if (idx === -1) throw new Error('Task not found')
  db.tasks.splice(idx, 1)
  save(db)
}

// Returns approved shifts only — from/to are YYYY-MM-DD strings (inclusive)
export async function getReport({ from, to }) {
  const db = load()
  const fromMs = new Date(from).getTime()
  const toMs = new Date(to).getTime() + 86400000
  const shifts = db.shifts.filter(
    (s) => s.status === 'approved' && new Date(s.clock_on_at).getTime() >= fromMs && new Date(s.clock_on_at).getTime() < toMs
  )
  return shifts.map((s) => {
    const emp = db.employees.find((e) => e.employee_id === s.employee_id)
    const loc = LOCATIONS.find((l) => l.location_id === s.location_id)
    const svcs = db.shift_services.filter((x) => x.shift_id === s.shift_id)
    const byCat = {}
    for (const c of SERVICE_CATEGORIES) byCat[c.service_category_id] = 0
    for (const x of svcs) byCat[x.service_category_id] = (byCat[x.service_category_id] || 0) + x.count
    return {
      shift_id: s.shift_id,
      employee: emp?.name || s.employee_id,
      location: loc?.name || s.location_id,
      date: s.clock_on_at.slice(0, 10),
      paid_hours: shiftPaidHours(s),
      services_by_category: byCat,
      total_services: svcs.reduce((a, x) => a + x.count, 0),
    }
  })
}

export async function exportReportCsv({ from, to }) {
  const rows = await getReport({ from, to })
  const lines = [['Employee', 'Date', 'Location', 'Paid Hours', ...SERVICE_CATEGORIES.map((c) => c.name), 'Total Services'].join(',')]
  for (const r of rows) {
    lines.push([
      `"${r.employee}"`, r.date, `"${r.location}"`,
      r.paid_hours.toFixed(2),
      ...SERVICE_CATEGORIES.map((c) => r.services_by_category[c.service_category_id] || 0),
      r.total_services,
    ].join(','))
  }
  const blob = new Blob([lines.join('\n')], { type: 'text/csv' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `aj-payroll-${from}.csv`
  a.click()
  URL.revokeObjectURL(url)
}

export async function getAuditLog() {
  const db = load()
  return [...(db.audit_log || [])].reverse().map((entry) => {
    const actor = db.employees.find((e) => e.employee_id === entry.actor_id)
    return { ...entry, actor_name: actor?.name || entry.actor_id }
  })
}

// --- roster -----------------------------------------------------------------
//
//   getRosterWeek(weekStart)         -> GET    /roster?week=YYYY-MM-DD
//   saveRosterShift(shift)           -> POST   /roster              (upsert by roster_id)
//   deleteRosterShift(rosterId)      -> DELETE /roster/:id
//   publishRoster(weekStart)         -> POST   /roster/publish      (whole week)
//   unpublishRoster(weekStart)       -> POST   /roster/unpublish
//   copyRosterWeek(toWeekStart)      -> POST   /roster/copy         (previous week -> drafts)
//   getRosteredShiftsInRange(employeeId, from, to) -> GET /roster?employee_id=&from=&to= (published only)
//
// weekStart is the Monday of the week as YYYY-MM-DD.

export async function getRosterWeek(weekStart) {
  const db = load()
  const end = addDaysStr(weekStart, 6)
  return db.roster_shifts
    .filter((s) => s.date >= weekStart && s.date <= end)
    .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.start_time.localeCompare(b.start_time)))
}

// Upsert by roster_id. Blocks if the employee has an approved leave request that
// overlaps the shift date (conflict rule from the spec).
export async function saveRosterShift(shift) {
  const db = load()
  const emp = db.employees.find((e) => e.employee_id === shift.employee_id)
  const conflict = db.leave_requests.find(
    (l) => l.employee_id === shift.employee_id && l.status === 'approved' && shift.date >= l.from && shift.date <= l.to
  )
  if (conflict) {
    throw new Error(`${emp?.name || 'Employee'} has approved leave on ${shift.date} — remove the leave approval first.`)
  }
  if (shift.roster_id) {
    const existing = db.roster_shifts.find((s) => s.roster_id === shift.roster_id)
    if (existing) {
      Object.assign(existing, {
        employee_id: shift.employee_id,
        location_id: shift.location_id,
        date: shift.date,
        start_time: shift.start_time,
        end_time: shift.end_time,
        notes: shift.notes || '',
        published: !!shift.published,
      })
      save(db)
      return existing
    }
  }
  const created = {
    roster_id: shift.roster_id || uid(),
    employee_id: shift.employee_id,
    location_id: shift.location_id,
    date: shift.date,
    start_time: shift.start_time,
    end_time: shift.end_time,
    notes: shift.notes || '',
    published: !!shift.published,
  }
  db.roster_shifts.push(created)
  save(db)
  return created
}

export async function deleteRosterShift(rosterId) {
  const db = load()
  const idx = db.roster_shifts.findIndex((s) => s.roster_id === rosterId)
  if (idx === -1) throw new Error('Roster shift not found')
  db.roster_shifts.splice(idx, 1)
  save(db)
}

export async function publishRoster(weekStart) {
  const db = load()
  const end = addDaysStr(weekStart, 6)
  for (const s of db.roster_shifts) {
    if (s.date >= weekStart && s.date <= end) s.published = true
  }
  save(db)
}

export async function unpublishRoster(weekStart) {
  const db = load()
  const end = addDaysStr(weekStart, 6)
  for (const s of db.roster_shifts) {
    if (s.date >= weekStart && s.date <= end) s.published = false
  }
  save(db)
}

// Duplicate the previous week's shifts into the given week as unpublished drafts.
export async function copyRosterWeek(toWeekStart) {
  const db = load()
  const fromWeekStart = addDaysStr(toWeekStart, -7)
  const fromEnd = addDaysStr(fromWeekStart, 6)
  const src = db.roster_shifts.filter((s) => s.date >= fromWeekStart && s.date <= fromEnd)
  const created = src.map((s) => ({
    roster_id: uid(),
    employee_id: s.employee_id,
    location_id: s.location_id,
    date: addDaysStr(s.date, 7),
    start_time: s.start_time,
    end_time: s.end_time,
    notes: s.notes || '',
    published: false,
  }))
  db.roster_shifts.push(...created)
  save(db)
  return created
}

export async function getRosteredShiftsInRange(employeeId, from, to) {
  const db = load()
  return db.roster_shifts.filter(
    (s) => s.employee_id === employeeId && s.published && s.date >= from && s.date <= to
  )
}

// --- leave ------------------------------------------------------------------
//
//   getMyLeaveRequests(employeeId)        -> GET  /leave?employee_id=
//   getAllLeaveRequests()                 -> GET  /leave            (admin)
//   submitLeaveRequest({...})             -> POST /leave
//   approveLeave(leaveId, actorId)        -> POST /leave/:id/approve
//   rejectLeave(leaveId, actorId, reason) -> POST /leave/:id/reject (reason REQUIRED)

export async function getMyLeaveRequests(employeeId) {
  const db = load()
  return db.leave_requests
    .filter((l) => l.employee_id === employeeId)
    .sort((a, b) => new Date(b.submitted_at) - new Date(a.submitted_at))
}

export async function getAllLeaveRequests() {
  const db = load()
  return db.leave_requests
    .map((l) => ({
      ...l,
      employee: (({ pin: _p, ...e }) => e)(db.employees.find((e) => e.employee_id === l.employee_id) || {}),
      actioned_by_name: db.employees.find((e) => e.employee_id === l.actioned_by)?.name || null,
    }))
    .sort((a, b) => new Date(b.submitted_at) - new Date(a.submitted_at))
}

export async function submitLeaveRequest({ employeeId, type, from, to, notes }) {
  if (!from || !to) throw new Error('From and to dates are required')
  const db = load()
  const req = {
    leave_id: uid(),
    employee_id: employeeId,
    type,
    from,
    to,
    notes: notes || '',
    status: 'pending',
    submitted_at: new Date().toISOString(),
    actioned_at: null,
    actioned_by: null,
    rejection_reason: null,
  }
  db.leave_requests.push(req)
  save(db)
  return req
}

export async function approveLeave(leaveId, actorId) {
  const db = load()
  const l = db.leave_requests.find((x) => x.leave_id === leaveId)
  if (!l) throw new Error('Leave request not found')
  if (l.status !== 'pending') throw new Error('Leave request already actioned')
  const before = { ...l }
  l.status = 'approved'
  l.actioned_at = new Date().toISOString()
  l.actioned_by = actorId
  db.audit_log.push({ actor_id: actorId, entity_type: 'leave', entity_id: leaveId, action: 'approve', before_json: JSON.stringify(before), after_json: JSON.stringify(l), reason: null, at: new Date().toISOString() })
  save(db)
  return l
}

export async function rejectLeave(leaveId, actorId, reason) {
  if (!reason) throw new Error('Reason is required')
  const db = load()
  const l = db.leave_requests.find((x) => x.leave_id === leaveId)
  if (!l) throw new Error('Leave request not found')
  if (l.status !== 'pending') throw new Error('Leave request already actioned')
  const before = { ...l }
  l.status = 'rejected'
  l.actioned_at = new Date().toISOString()
  l.actioned_by = actorId
  l.rejection_reason = reason
  db.audit_log.push({ actor_id: actorId, entity_type: 'leave', entity_id: leaveId, action: 'reject', before_json: JSON.stringify(before), after_json: JSON.stringify(l), reason, at: new Date().toISOString() })
  save(db)
  return l
}
