import React, { useEffect, useMemo, useState } from 'react'
import { LOCATIONS, clockOn, startBreak, endBreak } from '../api/client.js'
import { icons, fmtClock, fmtTime } from './ui.jsx'

function ShiftRing({ shift, now }) {
  const elapsed = now - new Date(shift.clock_on_at)
  // The gold ring sweeps one full revolution per hour — a quiet clock face.
  const frac = (elapsed % 3600000) / 3600000
  const R = 96
  const C = 2 * Math.PI * R
  return (
    <div className="ring-wrap">
      <svg width="218" height="218" viewBox="0 0 218 218" aria-hidden="true">
        <circle cx="109" cy="109" r={R} fill="none" stroke="rgba(216,194,160,0.18)" strokeWidth="1.5" />
        <circle
          cx="109" cy="109" r={R} fill="none"
          stroke="#C9A35C" strokeWidth="2.5" strokeLinecap="round"
          strokeDasharray={C} strokeDashoffset={C * (1 - frac)}
        />
      </svg>
      <div className="ring-time">
        <span className="l">On shift</span>
        <span className="t">{fmtClock(elapsed)}</span>
        <span className="l">{shift.break_minutes || 0} min break</span>
      </div>
    </div>
  )
}

export default function Shift({ employee, shift, setShift, toast, onClockOffStart }) {
  const [locationId, setLocationId] = useState(null)
  const [now, setNow] = useState(Date.now())

  useEffect(() => {
    if (!shift) return
    const id = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(id)
  }, [shift])

  const location = useMemo(
    () => shift && LOCATIONS.find((l) => l.location_id === shift.location_id),
    [shift]
  )

  async function handleClockOn() {
    try {
      const s = await clockOn(employee.employee_id, locationId)
      setShift(s)
      toast('Clocked on — have a great shift')
    } catch (e) { toast(e.message) }
  }

  async function handleBreak() {
    try {
      const s = shift.on_break_since ? await endBreak(shift.shift_id) : await startBreak(shift.shift_id)
      setShift({ ...s })
      toast(s.on_break_since ? 'Break started' : 'Back from break')
    } catch (e) { toast(e.message) }
  }

  if (!shift) {
    return (
      <div className="screen">
        <div className="idle-hero">
          <div className="eyebrow">Start of shift</div>
          <h2>Where are you working today?</h2>
          <p className="muted">Select your salon, then clock on.</p>
        </div>
        <div className="loc-grid">
          {LOCATIONS.map((l) => (
            <button
              key={l.location_id}
              className={'loc-card' + (locationId === l.location_id ? ' sel' : '')}
              onClick={() => setLocationId(l.location_id)}
              aria-pressed={locationId === l.location_id}
            >
              <span className="ic">{icons.pin}</span>
              <span>
                <h3>{l.name}</h3>
                <span className="muted">{l.address}</span>
              </span>
            </button>
          ))}
        </div>
        <div style={{ marginTop: 18 }}>
          <button className="btn btn-dark" disabled={!locationId} onClick={handleClockOn}>
            Clock on
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="screen">
      <div className="shift-hero">
        <div className="eyebrow">{location?.name}</div>
        {shift.on_break_since && (
          <div className="break-pill"><span className="pulse" /> On break</div>
        )}
        <ShiftRing shift={shift} now={now} />
        <div className="shift-meta">
          <span>Clocked on <b>{fmtTime(shift.clock_on_at)}</b></span>
        </div>
        <div className="shift-actions">
          <button className="btn btn-line" style={{ borderColor: 'rgba(216,194,160,0.5)', color: '#D8C2A0' }} onClick={handleBreak}>
            {shift.on_break_since ? 'End break' : 'Start break'}
          </button>
          <button className="btn btn-gold" onClick={onClockOffStart}>Clock off</button>
        </div>
      </div>
      <p className="muted" style={{ textAlign: 'center', marginTop: 14 }}>
        You'll enter today's service counts when you clock off.
      </p>
    </div>
  )
}
