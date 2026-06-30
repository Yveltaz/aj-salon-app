import React, { useEffect, useRef, useState } from 'react'
import { getEmployees, addEmployee, setEmployeeActive } from '../api/client.js'
import { Toast } from '../components/ui.jsx'

export default function Employees() {
  const [employees, setEmployees] = useState([])
  const [form, setForm] = useState({ name: '', role: 'Stylist', pin: '' })
  const [error, setError] = useState('')
  const [toastMsg, setToastMsg] = useState('')
  const [saving, setSaving] = useState(false)
  const toastTimer = useRef(null)

  const toast = (msg) => {
    setToastMsg(msg)
    clearTimeout(toastTimer.current)
    toastTimer.current = setTimeout(() => setToastMsg(''), 3200)
  }

  async function refresh() { setEmployees(await getEmployees()) }
  useEffect(() => { refresh() }, [])

  async function handleAdd(e) {
    e.preventDefault()
    if (!form.name.trim()) { setError('Name is required'); return }
    if (!/^\d{4}$/.test(form.pin)) { setError('PIN must be exactly 4 digits'); return }
    setSaving(true)
    try {
      const added = await addEmployee(form)
      setForm({ name: '', role: 'Stylist', pin: '' })
      setError('')
      toast(`${added.name} added — they can log in immediately with their PIN.`)
      refresh()
    } catch (err) {
      // Add failed (and any partial row was rolled back) — surface the reason
      // and do not show the employee as added.
      setError(err.message)
    } finally {
      setSaving(false)
    }
  }

  async function toggleActive(emp) {
    await setEmployeeActive(emp.employee_id, emp.active === false)
    refresh()
  }

  return (
    <div className="admin-screen">
      <div className="eyebrow">Management</div>
      <h1 className="admin-heading">Employees</h1>

      <div className="card" style={{ marginBottom: 24 }}>
        <div className="eyebrow">Add employee</div>
        <form onSubmit={handleAdd} style={{ display: 'grid', gap: 10 }}>
          <input className="admin-input" placeholder="Full name *" value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} />
          <select className="admin-input" value={form.role} onChange={(e) => setForm((f) => ({ ...f, role: e.target.value }))}>
            <option>Senior stylist</option>
            <option>Colourist</option>
            <option>Stylist</option>
            <option>Apprentice</option>
          </select>
          <input className="admin-input" placeholder="4-digit PIN *" maxLength={4} inputMode="numeric" value={form.pin} onChange={(e) => setForm((f) => ({ ...f, pin: e.target.value.replace(/\D/g, '') }))} />
          {error && <div className="admin-error">{error}</div>}
          <button type="submit" className="btn btn-gold" disabled={saving}>
            {saving ? 'Adding…' : 'Add employee'}
          </button>
        </form>
      </div>

      <div className="card" style={{ padding: 0 }}>
        {employees.map((emp, i) => (
          <div key={emp.employee_id} style={{ display: 'flex', alignItems: 'center', gap: 14, padding: '14px 16px', borderBottom: i < employees.length - 1 ? '1px solid #f0e8df' : 'none' }}>
            <div style={{ flex: 1 }}>
              <div style={{ fontWeight: 500 }}>{emp.name}</div>
              <div className="muted" style={{ fontSize: '0.8rem' }}>{emp.role}</div>
            </div>
            {emp.role === 'owner' ? (
              <span className="status approved">owner</span>
            ) : (
              <label className="admin-toggle" title={emp.active === false ? 'Activate' : 'Deactivate'}>
                <input type="checkbox" checked={emp.active !== false} onChange={() => toggleActive(emp)} />
                <span className="admin-toggle-track" />
              </label>
            )}
          </div>
        ))}
      </div>

      <Toast msg={toastMsg} />
    </div>
  )
}
