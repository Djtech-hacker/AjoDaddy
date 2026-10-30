import { useState, useEffect } from 'react'
import { useAuthStore } from '@/stores/authStore'

const API_BASE = import.meta.env.VITE_API_URL || '/api'

async function post(path: string, body: object) {
  const res = await fetch(`${API_BASE}${path}`, {
    method: 'POST',
    credentials: 'include', // refresh_token cookie is set by this response
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) {
    const m = data?.message
    throw new Error((Array.isArray(m) ? m.join(', ') : m) || `Request failed (${res.status})`)
  }
  return data.data ?? data
}

interface Props {
  twoFactorToken: string
  maskedEmail?: string
  onBack: () => void
  onSuccess: (user: any) => void
}

export default function TwoFactorLoginStep({ twoFactorToken, maskedEmail, onBack, onSuccess }: Props) {
  const { setUser, setAccessToken } = useAuthStore()
  const [code, setCode] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [info, setInfo] = useState<string | null>(null)
  const [cooldown, setCooldown] = useState(30)
  const [email, setEmail] = useState(maskedEmail)

  useEffect(() => {
    if (cooldown <= 0) return
    const t = setTimeout(() => setCooldown(c => c - 1), 1000)
    return () => clearTimeout(t)
  }, [cooldown])

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setErr(null); setInfo(null); setBusy(true)
    try {
      const d = await post('/auth/2fa/login/verify', { twoFactorToken, code })
      setAccessToken(d.accessToken)
      setUser(d.user)
      onSuccess(d.user)
    } catch (e: any) {
      setErr(e.message)
    } finally { setBusy(false) }
  }

  async function resend() {
    setErr(null); setInfo(null)
    try {
      const d = await post('/auth/2fa/login/resend', { twoFactorToken })
      if (d.maskedEmail) setEmail(d.maskedEmail)
      setInfo('A new code has been sent.')
      setCooldown(30)
    } catch (e: any) { setErr(e.message) }
  }

  return (
    <>
      <h1 className="text-[26px] font-extrabold tracking-tight text-ink mb-1.5">Two-step verification</h1>
      <p className="text-[13px] text-dim mb-6">Enter the 6-digit code we sent to {email ?? 'your email'}.</p>

      {err && (
        <div role="alert" className="bg-red-50 border border-red-100 text-red-600 text-[13px] font-medium px-4 py-3 rounded-xl mb-5">{err}</div>
      )}
      {info && (
        <div className="bg-green-50 border border-green-100 text-green-700 text-[13px] font-medium px-4 py-3 rounded-xl mb-5">{info}</div>
      )}

      <form onSubmit={submit} className="space-y-4">
        <input
          inputMode="numeric" autoComplete="one-time-code" maxLength={6} autoFocus
          value={code} onChange={e => setCode(e.target.value.replace(/\D/g, ''))}
          placeholder="••••••"
          className="w-full h-12 border border-black/[0.1] rounded-xl text-center text-[22px] font-bold tracking-[0.5em] text-ink bg-white outline-none placeholder:text-mist focus:border-brand focus:ring-2 focus:ring-brand/10"
        />
        <button type="submit" disabled={code.length !== 6 || busy}
          className="w-full h-11 rounded-xl bg-brand text-white text-[13px] font-semibold disabled:opacity-50">
          {busy ? 'Verifying…' : 'Verify & sign in →'}
        </button>
        <div className="flex items-center justify-between text-[12px]">
          <button type="button" onClick={onBack} className="text-mist hover:text-dim">← Back to login</button>
          <button type="button" onClick={resend} disabled={cooldown > 0}
            className="font-semibold text-brand disabled:opacity-50">
            {cooldown > 0 ? `Resend in ${cooldown}s` : 'Resend code'}
          </button>
        </div>
      </form>
    </>
  )
}