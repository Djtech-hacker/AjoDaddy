import { useState, useEffect } from 'react'
import { createPortal } from 'react-dom'
import { useAuthStore } from '@/stores/authStore'

const API_BASE = import.meta.env.VITE_API_URL || '/api'

async function post(path: string, body: object) {
  const token = useAuthStore.getState().accessToken
  const res = await fetch(`${API_BASE}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify(body),
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) {
    const m = data?.message
    throw new Error((Array.isArray(m) ? m.join(', ') : m) || `Request failed (${res.status})`)
  }
  return data
}

export default function TwoFactorCard({ enabled, onChange }: { enabled: boolean; onChange: (v: boolean) => void }) {
  const [open, setOpen] = useState(false)
  const [code, setCode] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [sending, setSending] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [sentTo, setSentTo] = useState<string | null>(null)
  const [cooldown, setCooldown] = useState(0)

  useEffect(() => {
    if (cooldown <= 0) return
    const t = setTimeout(() => setCooldown(c => c - 1), 1000)
    return () => clearTimeout(t)
  }, [cooldown])

  async function sendCode() {
    setErr(null); setSending(true)
    try {
      const r = await post('/auth/2fa/send-otp', { purpose: enabled ? 'disable' : 'enable' })
      const d = r.data ?? r
      setSentTo(d.maskedEmail ?? null)
      setCooldown(30)
    } catch (e: any) {
      setErr(e.message)
    } finally { setSending(false) }
  }

  function openModal() {
    setCode(''); setPassword(''); setErr(null); setSentTo(null)
    setOpen(true)
    sendCode()
  }

  function close() { if (!busy) setOpen(false) }

  async function confirm(e: React.FormEvent) {
    e.preventDefault()
    e.stopPropagation() // React events bubble through portals to the outer settings <form>
    setErr(null); setBusy(true)
    try {
      if (enabled) await post('/auth/2fa/disable', { password, code })
      else await post('/auth/2fa/enable', { code })
      onChange(!enabled)
      setOpen(false)
    } catch (e: any) {
      setErr(e.message)
    } finally { setBusy(false) }
  }

  const canSubmit = /^\d{6}$/.test(code) && (!enabled || password.length > 0) && !busy

  return (
    <>
      <div className="ps-row">
        <div>
          <span className="ps-row-title">Two-factor authentication (2FA)</span>
          <p className="ps-tiny">{enabled ? 'On — a code is emailed each time you log in' : 'Off — add a login code for extra security'}</p>
        </div>
        <button type="button" role="switch" aria-checked={enabled} aria-label="Two-factor authentication"
          className={`ps-switch ${enabled ? 'on' : ''}`} onClick={openModal}><span /></button>
      </div>

      {open && createPortal(
        <div className="pp-overlay" onClick={close}>
          <div className="pp-modal" onClick={e => e.stopPropagation()}>
            <div className="pp-modal-hd">
              <span className="pp-modal-title">{enabled ? 'Turn off 2FA' : 'Turn on 2FA'}</span>
              <button type="button" className="pp-modal-x" onClick={close}>✕</button>
            </div>
            <form className="pp-modal-form" onSubmit={confirm}>
              <p className="ps-tiny" style={{ fontSize: 12 }}>
                {sending ? 'Sending code…' : sentTo ? `We sent a 6-digit code to ${sentTo}.` : 'Enter the 6-digit code sent to your email.'}
              </p>
              {enabled && (
                <div className="pp-form-field">
                  <label>Password</label>
                  <input type="password" value={password} onChange={e => setPassword(e.target.value)} autoComplete="current-password" />
                </div>
              )}
              <div className="pp-form-field">
                <label>Verification code</label>
                <input inputMode="numeric" maxLength={6} value={code} autoFocus
                  onChange={e => setCode(e.target.value.replace(/\D/g, ''))} placeholder="123456" />
              </div>
              {err && <p className="ps-status err" role="alert">{err}</p>}
              <button type="submit" className="pp-submit" disabled={!canSubmit}>
                {busy ? 'Confirming…' : enabled ? 'Turn off 2FA' : 'Turn on 2FA'}
              </button>
              <button type="button" className="ps-ghost" disabled={sending || cooldown > 0} onClick={sendCode}>
                {cooldown > 0 ? `Resend code in ${cooldown}s` : 'Resend code'}
              </button>
            </form>
          </div>
        </div>,
        document.body
      )}
    </>
  )
}