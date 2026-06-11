import React, { useEffect, useRef, useState } from 'react'
import Login from './components/Login.jsx'
import Shift from './components/Shift.jsx'
import ClockOff from './components/ClockOff.jsx'
import { Tasks, Kpis, History } from './components/Screens.jsx'
import { Wordmark, Toast, icons } from './components/ui.jsx'
import { getActiveShift } from './api/client.js'
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

  if (!employee) return <div className="app"><Login onLogin={setEmployee} /><Toast msg={toastMsg} /></div>

  const logout = () => {
    sessionStorage.removeItem(SESSION_KEY)
    setEmployee(null)
    setShift(null)
    setTab('shift')
  }

  if (employee.role === 'owner') return <AdminPortal employee={employee} onLogout={logout} />

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
          ['kpis', 'My KPIs'],
          ['history', 'History'],
        ].map(([id, label]) => (
          <button key={id} className={tab === id ? 'on' : ''} onClick={() => { setTab(id); setClockingOff(false) }} aria-current={tab === id}>
            {icons[id === 'kpis' ? 'kpis' : id === 'history' ? 'history' : id === 'tasks' ? 'tasks' : 'shift']}
            {label}
          </button>
        ))}
      </nav>
      <Toast msg={toastMsg} />
    </div>
  )
}
