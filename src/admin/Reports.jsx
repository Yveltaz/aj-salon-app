import React, { useEffect, useState } from 'react'
import { getReport, exportReportCsv, SERVICE_CATEGORIES } from '../api/client.js'

function daysAgo(n) {
  const d = new Date()
  d.setDate(d.getDate() - n)
  return d.toISOString().slice(0, 10)
}
const today = () => new Date().toISOString().slice(0, 10)

export default function Reports() {
  const [from, setFrom] = useState(() => daysAgo(7))
  const [to, setTo] = useState(today)
  const [rows, setRows] = useState([])
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    getReport({ from, to }).then(setRows)
  }, [from, to])

  async function handleExport() {
    setBusy(true)
    try { await exportReportCsv({ from, to }) }
    finally { setBusy(false) }
  }

  const totals = {
    paid_hours: rows.reduce((a, r) => a + r.paid_hours, 0),
    total_services: rows.reduce((a, r) => a + r.total_services, 0),
    by: Object.fromEntries(
      SERVICE_CATEGORIES.map((c) => [c.service_category_id, rows.reduce((a, r) => a + (r.services_by_category[c.service_category_id] || 0), 0)])
    ),
  }

  return (
    <div className="admin-screen">
      <div className="eyebrow">Payroll</div>
      <h1 className="admin-heading">Reports</h1>

      <div className="card" style={{ marginBottom: 20 }}>
        <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', alignItems: 'center' }}>
          <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: '0.88rem' }}>
            From <input className="admin-input" style={{ width: 'auto', display: 'inline' }} type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
          </label>
          <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: '0.88rem' }}>
            To <input className="admin-input" style={{ width: 'auto', display: 'inline' }} type="date" value={to} onChange={(e) => setTo(e.target.value)} />
          </label>
          <button className="btn btn-gold" style={{ width: 'auto', padding: '9px 22px' }} onClick={handleExport} disabled={busy || rows.length === 0}>
            {busy ? 'Exporting…' : 'Export CSV'}
          </button>
        </div>
        <p className="muted" style={{ marginTop: 10, fontSize: '0.78rem' }}>Only approved shifts are exported for payroll.</p>
      </div>

      <div style={{ overflowX: 'auto' }}>
        <table className="admin-table admin-table-full">
          <thead>
            <tr>
              <th>Employee</th>
              <th>Date</th>
              <th>Location</th>
              <th>Hours</th>
              {SERVICE_CATEGORIES.map((c) => <th key={c.service_category_id}>{c.name}</th>)}
              <th>Total</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr><td colSpan={5 + SERVICE_CATEGORIES.length} style={{ padding: 18, color: 'var(--ink-soft)', textAlign: 'center' }}>No approved shifts in this date range.</td></tr>
            ) : rows.map((r) => (
              <tr key={r.shift_id}>
                <td>{r.employee}</td>
                <td>{r.date}</td>
                <td>{r.location}</td>
                <td>{r.paid_hours.toFixed(2)}</td>
                {SERVICE_CATEGORIES.map((c) => <td key={c.service_category_id}>{r.services_by_category[c.service_category_id] || 0}</td>)}
                <td>{r.total_services}</td>
              </tr>
            ))}
          </tbody>
          {rows.length > 0 && (
            <tfoot>
              <tr>
                <td colSpan={3} style={{ fontWeight: 600 }}>Total</td>
                <td style={{ fontWeight: 600 }}>{totals.paid_hours.toFixed(2)}</td>
                {SERVICE_CATEGORIES.map((c) => <td key={c.service_category_id} style={{ fontWeight: 600 }}>{totals.by[c.service_category_id]}</td>)}
                <td style={{ fontWeight: 600 }}>{totals.total_services}</td>
              </tr>
            </tfoot>
          )}
        </table>
      </div>
    </div>
  )
}
