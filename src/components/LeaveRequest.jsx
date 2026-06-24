import React, { useEffect, useState } from 'react'
import { getMyLeaveRequests, submitLeaveRequest } from '../api/client.js'
import { parseYmd, daysInclusive } from './ui.jsx'

const TYPES = ['Annual', 'Sick', 'Unpaid', 'Other']

function fmtRange(from, to) {
  const opts = { day: 'numeric', month: 'short' }
  const f = parseYmd(from).toLocaleDateString('en-AU', opts)
  if (from === to) return f
  const t = parseYmd(to).toLocaleDateString('en-AU', opts)
  return `${f} – ${t}`
}

export default function LeaveRequest({ employee, toast }) {
  const [requests, setRequests] = useState([])
  const [showForm, setShowForm] = useState(false)
  const [type, setType] = useState('Annual')
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const [notes, setNotes] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  async function refresh() { setRequests(await getMyLeaveRequests(employee.employee_id)) }
  useEffect(() => { refresh() }, [employee])

  function resetForm() {
    setType('Annual'); setFrom(''); setTo(''); setNotes(''); setError('')
  }

  async function submit() {
    if (!from || !to) return
    if (to < from) { setError('The “to” date can’t be before the “from” date.'); return }
    setBusy(true)
    try {
      await submitLeaveRequest({ employeeId: employee.employee_id, type, from, to, notes })
      resetForm()
      setShowForm(false)
      toast('Leave request submitted')
      await refresh()
    } finally { setBusy(false) }
  }

  return (
    <div className="screen">
      <div className="eyebrow">Time off</div>
      <h2 className="serif" style={{ fontSize: '1.7rem', fontWeight: 500, marginBottom: 12 }}>Leave</h2>

      {!showForm && (
        <button className="btn btn-dark" onClick={() => { resetForm(); setShowForm(true) }}>
          Request leave
        </button>
      )}

      {showForm && (
        <div className="card leave-form">
          <div className="eyebrow">Request leave</div>

          <div className="leave-seg" role="tablist" aria-label="Leave type">
            {TYPES.map((t) => (
              <button
                key={t}
                role="tab"
                aria-selected={type === t}
                className={'leave-seg-btn' + (type === t ? ' on' : '')}
                onClick={() => setType(t)}
              >
                {t}
              </button>
            ))}
          </div>

          <div className="leave-dates">
            <div>
              <label className="admin-label">From</label>
              <input className="admin-input" type="date" value={from} onChange={(e) => { setFrom(e.target.value); setError('') }} />
            </div>
            <div>
              <label className="admin-label">To</label>
              <input className="admin-input" type="date" value={to} min={from || undefined} onChange={(e) => { setTo(e.target.value); setError('') }} />
            </div>
          </div>

          <label className="admin-label" style={{ marginTop: 10 }}>Notes (optional)</label>
          <textarea className="admin-input" rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Anything your manager should know" />

          {error && <div className="admin-error">{error}</div>}

          <div className="leave-form-actions">
            <button className="btn btn-line" style={{ width: 'auto' }} onClick={() => { setShowForm(false); resetForm() }}>Cancel</button>
            <button className="btn btn-gold" style={{ width: 'auto' }} onClick={submit} disabled={!from || !to || busy}>Submit</button>
          </div>
        </div>
      )}

      <p className="muted" style={{ margin: '14px 0 8px' }}>
        To cancel a request contact your manager.
      </p>

      <div className="card" style={{ padding: 0 }}>
        {requests.length === 0 && (
          <p className="muted" style={{ padding: 18 }}>No leave requests yet.</p>
        )}
        {requests.map((r) => (
          <div className="leave-row" key={r.leave_id}>
            <div className="leave-row-main">
              <span className="chip">{r.type}</span>
              <span className="leave-range">{fmtRange(r.from, r.to)}</span>
              <span className="leave-days">{daysInclusive(r.from, r.to)}d</span>
            </div>
            <div className="leave-row-side">
              <span className={`status ${r.status}`}>{r.status}</span>
            </div>
            {r.status === 'rejected' && r.rejection_reason && (
              <div className="leave-reason">Reason: {r.rejection_reason}</div>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}
