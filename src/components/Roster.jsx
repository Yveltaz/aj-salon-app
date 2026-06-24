import React, { useEffect, useState } from 'react'
import { getRosterWeek, LOCATIONS } from '../api/client.js'
import { ymd, parseYmd, addDays, mondayOf, weekDates, weekLabel, fmtDayLong } from './ui.jsx'

const DAY_NAMES = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']
const SHORT = { loc_macarthur: 'Macarthur', loc_edpark: 'Ed Park' }

export default function Roster({ employee }) {
  const [weekStart, setWeekStart] = useState(() => ymd(mondayOf(new Date())))
  const [shifts, setShifts] = useState([])
  const [weekPublished, setWeekPublished] = useState(true)

  useEffect(() => {
    getRosterWeek(weekStart).then((all) => {
      setWeekPublished(all.some((s) => s.published))
      setShifts(all.filter((s) => s.employee_id === employee.employee_id && s.published))
    })
  }, [weekStart, employee])

  const todayStr = ymd(new Date())
  const days = weekDates(weekStart)
  const byDate = {}
  for (const s of shifts) byDate[s.date] = s
  const locName = (id) => LOCATIONS.find((l) => l.location_id === id)?.name || ''

  const nextShift = [...shifts]
    .filter((s) => s.date >= todayStr)
    .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.start_time.localeCompare(b.start_time)))[0]

  const shiftWeek = (delta) => setWeekStart(ymd(addDays(parseYmd(weekStart), delta)))

  return (
    <div className="screen">
      <div className="eyebrow">My week</div>
      <h2 className="serif" style={{ fontSize: '1.7rem', fontWeight: 500, marginBottom: 12 }}>Roster</h2>

      <div className="rost-weeknav">
        <button onClick={() => shiftWeek(-7)} aria-label="Previous week">‹</button>
        <span className="rost-weeklabel">{weekLabel(weekStart)}</span>
        <button onClick={() => shiftWeek(7)} aria-label="Next week">›</button>
      </div>

      {nextShift && (
        <div className="rost-hero">
          <div className="eyebrow">Next shift</div>
          <div className="rost-hero-day">{fmtDayLong(nextShift.date)}</div>
          <div className="rost-hero-meta">
            <span>{locName(nextShift.location_id)}</span>
            <span>{nextShift.start_time}–{nextShift.end_time}</span>
          </div>
          {nextShift.notes && <div className="rost-hero-notes">{nextShift.notes}</div>}
        </div>
      )}
      {!nextShift && weekPublished && (
        <p className="muted" style={{ textAlign: 'center', margin: '16px 0 4px' }}>No shifts rostered yet.</p>
      )}

      {!weekPublished && (
        <div className="rost-banner">Roster not yet published for this week.</div>
      )}

      <div className="rost-grid">
        {days.map((d, i) => {
          const ds = ymd(d)
          const s = byDate[ds]
          const isToday = ds === todayStr
          const isPast = ds < todayStr
          return (
            <div key={ds} className={'rost-cell' + (isToday ? ' today' : '') + (isPast ? ' past' : '')}>
              <div className="rost-dayname">{DAY_NAMES[i]}</div>
              <div className="rost-daynum">{d.getDate()}</div>
              {s ? (
                <div className="rost-shift">
                  <span className="rost-loc">{SHORT[s.location_id] || locName(s.location_id)}</span>
                  <span className="rost-time">{s.start_time}–{s.end_time}</span>
                </div>
              ) : (
                <div className="rost-empty">·</div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}
