import React, { useEffect, useState } from 'react'
import {
  getTasks, setTaskStatus, getKpis, getShiftHistory,
  SERVICE_CATEGORIES, LOCATIONS, shiftPaidHours,
} from '../api/client.js'
import { icons, fmtTime, fmtDate } from './ui.jsx'

export function Tasks({ toast }) {
  const [tasks, setTasks] = useState([])

  async function refresh() { setTasks(await getTasks()) }
  useEffect(() => { refresh() }, [])

  async function toggle(t) {
    const next = t.status === 'completed' ? 'pending' : 'completed'
    await setTaskStatus(t.task_id, next)
    if (next === 'completed') toast('Task completed')
    refresh()
  }

  const locName = (id) => LOCATIONS.find((l) => l.location_id === id)?.name || ''

  return (
    <div className="screen">
      <div className="eyebrow">Today's checklist</div>
      <h2 className="serif" style={{ fontSize: '1.7rem', fontWeight: 500, marginBottom: 12 }}>Salon tasks</h2>
      <div className="card" style={{ padding: 0 }}>
        {tasks.length === 0 && <p className="muted" style={{ padding: 18 }}>No tasks assigned yet — your manager adds them from the admin portal.</p>}
        {tasks.map((t) => {
          const late = t.status !== 'completed' && new Date(t.due_at) < new Date()
          return (
            <div className={'task' + (t.status === 'completed' ? ' done' : '')} key={t.task_id}>
              <button className="tick" onClick={() => toggle(t)} aria-label={t.status === 'completed' ? 'Mark as not done' : 'Mark as done'}>
                {t.status === 'completed' && icons.check}
              </button>
              <div>
                <div className="tt">
                  {t.title}
                  {t.recurring && <span className="chip">{t.recurring}</span>}
                </div>
                <div className="td">{t.description}</div>
                <div className={'due' + (late ? ' late' : '')}>
                  Due {fmtTime(t.due_at)} · {locName(t.location_id)}{late ? ' · Overdue' : ''}
                </div>
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

export function Kpis({ employee }) {
  const [k, setK] = useState(null)
  useEffect(() => { getKpis(employee.employee_id).then(setK) }, [employee])
  if (!k) return <div className="screen" />

  const maxCat = Math.max(1, ...Object.values(k.byCategory))

  return (
    <div className="screen">
      <div className="eyebrow">Last 7 days</div>
      <h2 className="serif" style={{ fontSize: '1.7rem', fontWeight: 500 }}>My performance</h2>
      <div className="kpi-grid">
        <div className="kpi"><div className="v">{k.hours.toFixed(1)}</div><div className="k">Hours worked</div></div>
        <div className="kpi"><div className="v">{k.totalServices}</div><div className="k">Services</div></div>
        <div className="kpi"><div className="v">{k.servicesPerHour.toFixed(1)}</div><div className="k">Services / hour</div></div>
        <div className="kpi"><div className="v">{Math.round(k.taskCompletion * 100)}%</div><div className="k">Tasks done</div></div>
      </div>
      <div className="card" style={{ marginTop: 14 }}>
        <div className="eyebrow">By service</div>
        {SERVICE_CATEGORIES.map((c) => (
          <div className="bar-row" key={c.service_category_id}>
            <span>{c.name}</span>
            <span className="bar"><i style={{ width: `${(k.byCategory[c.service_category_id] / maxCat) * 100}%` }} /></span>
            <span className="bn">{k.byCategory[c.service_category_id]}</span>
          </div>
        ))}
      </div>
      <p className="muted" style={{ marginTop: 12, textAlign: 'center' }}>
        KPIs are calculated from submitted shifts. Targets are set by your manager.
      </p>
    </div>
  )
}

export function History({ employee }) {
  const [shifts, setShifts] = useState([])
  useEffect(() => { getShiftHistory(employee.employee_id).then(setShifts) }, [employee])

  const locName = (id) => LOCATIONS.find((l) => l.location_id === id)?.name || ''

  return (
    <div className="screen">
      <div className="eyebrow">Shift history</div>
      <h2 className="serif" style={{ fontSize: '1.7rem', fontWeight: 500, marginBottom: 12 }}>My shifts</h2>
      <div className="card" style={{ padding: 0 }}>
        {shifts.length === 0 && (
          <p className="muted" style={{ padding: 18 }}>No shifts yet. Your submitted shifts will appear here while they await approval.</p>
        )}
        {shifts.map((s) => {
          const total = s.services.reduce((a, x) => a + x.count, 0)
          return (
            <div className="hist" key={s.shift_id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10 }}>
              <div>
                <div className="d">{fmtDate(s.clock_on_at)} · {locName(s.location_id)}</div>
                <div className="m">
                  {fmtTime(s.clock_on_at)} – {fmtTime(s.clock_off_at)} · {shiftPaidHours(s).toFixed(2)} h paid · {total} services
                </div>
              </div>
              <span className={`status ${s.status}`}>{s.status}</span>
            </div>
          )
        })}
      </div>
    </div>
  )
}
