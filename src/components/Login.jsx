import React, { useState } from 'react'
import { login } from '../api/client.js'
import { Wordmark } from './ui.jsx'

export default function Login({ onLogin }) {
  const [pin, setPin] = useState('')
  const [error, setError] = useState('')

  async function press(d) {
    setError('')
    const next = (pin + d).slice(0, 4)
    setPin(next)
    if (next.length === 4) {
      try {
        const emp = await login(next)
        onLogin(emp)
      } catch (e) {
        setError(e.message)
        setPin('')
      }
    }
  }

  return (
    <div className="screen login">
      <Wordmark />
      <p className="muted" style={{ textAlign: 'center' }}>Enter your staff PIN to begin</p>
      <div className="pin-dots" aria-label={`${pin.length} of 4 digits entered`}>
        {[0, 1, 2, 3].map((i) => <i key={i} className={i < pin.length ? 'full' : ''} />)}
      </div>
      <div className="login-error">{error}</div>
      <div className="pad">
        {[1, 2, 3, 4, 5, 6, 7, 8, 9].map((d) => (
          <button key={d} onClick={() => press(String(d))}>{d}</button>
        ))}
        <button className="ghost" onClick={() => { setPin(''); setError('') }}>Clear</button>
        <button onClick={() => press('0')}>0</button>
        <button className="ghost" onClick={() => setPin(pin.slice(0, -1))}>Del</button>
      </div>
      <p className="login-hint">Demo PINs — Sophie 1111 · Tahlia 2222 · Megan 3333 · 0000</p>
    </div>
  )
}
