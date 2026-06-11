import React, { useMemo, useState } from 'react'
import { SERVICE_CATEGORIES, LOCATIONS, clockOff } from '../api/client.js'
import { fmtTime } from './ui.jsx'

export default function ClockOff({ shift, onDone, onCancel, toast }) {
  const [counts, setCounts] = useState(
    Object.fromEntries(SERVICE_CATEGORIES.map((c) => [c.service_category_id, 0]))
  )
  const [step, setStep] = useState('counts') // counts -> confirm

  const total = useMemo(() => Object.values(counts).reduce((a, b) => a + b, 0), [counts])
  const location = LOCATIONS.find((l) => l.location_id === shift.location_id)
  const elapsedHrs = (Date.now() - new Date(shift.clock_on_at)) / 3600000
  const estPaid = Math.max(0, elapsedHrs - (shift.break_minutes || 0) / 60)

  function bump(id, d) {
    setCounts((c) => ({ ...c, [id]: Math.max(0, c[id] + d) }))
  }

  async function submit() {
    try {
      await clockOff(shift.shift_id, counts)
      toast('Shift submitted for approval')
      onDone()
    } catch (e) { toast(e.message) }
  }

  if (step === 'confirm') {
    return (
      <div className="screen">
        <div className="eyebrow">Clock off · Step 2 of 2</div>
        <h2 className="serif" style={{ fontSize: '1.7rem', fontWeight: 500, marginBottom: 12 }}>Confirm your shift</h2>
        <div className="card">
          <div className="summary-row"><span>Location</span><b>{location?.name}</b></div>
          <div className="summary-row"><span>Clocked on</span><b>{fmtTime(shift.clock_on_at)}</b></div>
          <div className="summary-row"><span>Breaks</span><b>{shift.break_minutes || 0} min</b></div>
          <div className="summary-row"><span>Estimated paid hours</span><b>{estPaid.toFixed(2)} h</b></div>
          {SERVICE_CATEGORIES.filter((c) => counts[c.service_category_id] > 0).map((c) => (
            <div className="summary-row" key={c.service_category_id}>
              <span>{c.name}</span><b>{counts[c.service_category_id]}</b>
            </div>
          ))}
          <div className="summary-row"><span>Total services</span><b>{total}</b></div>
        </div>
        <p className="muted" style={{ margin: '14px 2px' }}>
          Your shift goes to your manager for approval. Final paid hours are confirmed there.
        </p>
        <div style={{ display: 'grid', gap: 10 }}>
          <button className="btn btn-dark" onClick={submit}>Submit shift</button>
          <button className="btn btn-line" onClick={() => setStep('counts')}>Back</button>
        </div>
      </div>
    )
  }

  return (
    <div className="screen">
      <div className="eyebrow">Clock off · Step 1 of 2</div>
      <h2 className="serif" style={{ fontSize: '1.7rem', fontWeight: 500 }}>Today's services</h2>
      <p className="muted">Enter how many of each you completed this shift.</p>
      <div className="svc-list">
        {SERVICE_CATEGORIES.map((c) => (
          <div className="svc-row" key={c.service_category_id}>
            <span className="name">{c.name}</span>
            <span className="stepper">
              <button onClick={() => bump(c.service_category_id, -1)} aria-label={`Remove one ${c.name}`}>−</button>
              <span className="n">{counts[c.service_category_id]}</span>
              <button onClick={() => bump(c.service_category_id, +1)} aria-label={`Add one ${c.name}`}>+</button>
            </span>
          </div>
        ))}
      </div>
      <div style={{ display: 'grid', gap: 10 }}>
        <button className="btn btn-dark" onClick={() => setStep('confirm')}>Continue</button>
        <button className="btn btn-line" onClick={onCancel}>Stay clocked on</button>
      </div>
    </div>
  )
}
