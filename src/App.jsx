import React, { useEffect, useRef, useState } from 'react'
import Login from './components/Login.jsx'
import Shift from './components/Shift.jsx'
import ClockOff from './components/ClockOff.jsx'
import { Tasks, Kpis, History } from './components/Screens.jsx'
import Roster from './components/Roster.jsx'
import LeaveRequest from './components/LeaveRequest.jsx'
import { Wordmark, Toast, icons } from './components/ui.jsx'
import { getActiveShift, logout as apiLogout } from './api/client.js'
import AdminPortal from './admin/AdminPortal.jsx'

const SESSION_KEY = 'aj_session'

export default function App() {
  const [employee, setEmployee] = useState(() => {
    try { return JSON.parse(sessionStorage.getItem(SESSION_KEY)) } catch { return null }
  })
  const [shift, setShift] = useState(null)
  const [tab, setTab] = useState('shift')
  const [clockingOff, setClockingOff] = useState(false)
  const [toastMsg, setToastMsg] = useState('')
  const toastTimer = useRef(null)

  // Capture the Xero OAuth redirect params (?xero=connected&org=... or
  // ?xero=error&message=...) once, on whatever path we land on (the callback
  // sends us to /admin?..., but this also covers landing on the root path).
  const [xeroRedirect] = useState(() => {
    const p = new URLSearchParams(window.location.search)
    const status = p.get('xero')
    if (!status) return null
    return { status, org: p.get('org') || '', message: p.get('message') || '' }
  })

  const toast = (msg) => {
    setToastMsg(msg)
    clearTimeout(toastTimer.current)
    toastTimer.current = setTimeout(() => setToastMsg(''), 2400)
  }

  useEffect(() => {
    if (employee) {
      sessionStorage.setItem(SESSION_KEY, JSON.stringify(employee))
      if (employee.role !== 'owner') getActiveShift(employee.employee_id).then(setShift)
    }
  }, [employee])

  // Show the Xero connection toast on load and strip the query params so a
  // refresh doesn't replay it. Owners land on the Reports admin screen (below).
  useEffect(() => {
    if (!xeroRedirect) return
    window.history.replaceState({}, '', window.location.pathname)
    toast(xeroRedirect.status === 'connected'
      ? `Connected to ${xeroRedirect.org || 'Xero'}.`
      : `Xero connection failed: ${xeroRedirect.message || 'unknown error'}`)
  }, [])

  if (!employee) return <div className="app"><Login onLogin={setEmployee} /><Toast msg={toastMsg} /></div>

  const logout = () => {
    apiLogout()
    sessionStorage.removeItem(SESSION_KEY)
    setEmployee(null)
    setShift(null)
    setTab('shift')
  }

  if (employee.role === 'owner') return (
    <>
      <AdminPortal employee={employee} onLogout={logout} landOn={xeroRedirect ? 'reports' : undefined} />
      <Toast msg={toastMsg} />
    </>
  )

  let body
  if (tab === 'shift') {
    body = clockingOff && shift ? (
      <ClockOff
        shift={shift}
        toast={toast}
        onCancel={() => setClockingOff(false)}
        onDone={() => { setClockingOff(false); setShift(null) }}
      />
    ) : (
      <Shift employee={employee} shift={shift} setShift={setShift} toast={toast} onClockOffStart={() => setClockingOff(true)} />
    )
  } else if (tab === 'tasks') body = <Tasks toast={toast} />
  else if (tab === 'roster') body = <Roster employee={employee} />
  else if (tab === 'leave') body = <LeaveRequest employee={employee} toast={toast} />
  else if (tab === 'kpis') body = <Kpis employee={employee} />
  else body = <History employee={employee} />

  return (
    <div className="app">
      <div className="topbar">
        <h1>Amelia <em style={{ color: 'var(--gold)' }}>Jacob's</em></h1>
        <button className="who" onClick={logout}>{employee.name} · Sign out</button>
      </div>
      {body}
      <nav className="nav" aria-label="Main">
        {[
          ['shift', 'Shift'],
          ['tasks', 'Tasks'],
          ['roster', 'Roster'],
          ['leave', 'Leave'],
          ['kpis', 'KPIs'],
          ['history', 'History'],
        ].map(([id, label]) => (
          <button key={id} className={tab === id ? 'on' : ''} onClick={() => { setTab(id); setClockingOff(false) }} aria-current={tab === id}>
            {icons[id]}
            {label}
          </button>
        ))}
      </nav>
      <Toast msg={toastMsg} />
    </div>
  )
}
