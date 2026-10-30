// src/pages/Kyc/KycVerificationPage.tsx
//
// Flow: NIN -> BVN -> face scan (last). The step ALWAYS comes from GET /kyc/status,
// so after an admin rejection the user starts again at NIN.
// Styled to match ProfilePage (same cards, tick tiles, green accents) and rendered
// inside DashboardLayout so the sidebar stays visible.

import { useCallback, useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { motion, AnimatePresence } from 'framer-motion'
import DashboardLayout from '@/components/layout/DashboardLayout'
import LivenessCapture from '@/components/LivenessCapture'
import type { Challenge } from '@/components/LivenessCapture'
import { kycApi, authApi } from '@/api/services'
import { useUIStore } from '@/stores/uiStore'
import { useAuthStore } from '@/stores/authStore'

type Step = 'NIN' | 'BVN' | 'FACE' | 'REVIEW' | 'DONE'

type KycStatus = {
  status: string
  ninVerified: boolean
  bvnVerified: boolean
  faceSubmitted: boolean
  ninMasked: string | null
  bvnMasked: string | null
  rejectionReason?: string | null
  nextStep: 'VERIFY_NIN' | 'VERIFY_BVN' | 'FACE_SCAN' | 'COMPLETE'
}

function errMsg(err: any, fallback: string): string {
  const m = err?.response?.data?.message
  if (Array.isArray(m)) return m.join(', ')
  return m || err?.message || fallback
}

function stepFromStatus(s: KycStatus): Step {
  // A rejected record always restarts from the beginning, whatever the flags say.
  if (s.status === 'REJECTED') return 'NIN'
  if (s.nextStep === 'VERIFY_NIN') return 'NIN'
  if (s.nextStep === 'VERIFY_BVN') return 'BVN'
  if (s.nextStep === 'FACE_SCAN') return 'FACE'
  return s.status === 'VERIFIED' ? 'DONE' : 'REVIEW'
}

const fade = (delay = 0) => ({
  initial: { opacity: 0, y: 10 },
  animate: { opacity: 1, y: 0 },
  exit: { opacity: 0, y: -6 },
  transition: { duration: 0.3, ease: 'easeOut' as const, delay },
})

const Tick = ({ ok }: { ok: boolean }) =>
  ok ? (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3">
      <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
    </svg>
  ) : null

// 11-digit field with a line under it that fills as you type
function DigitField({
  label, value, onChange, onEnter, placeholder, disabled,
}: {
  label: string
  value: string
  onChange: (v: string) => void
  onEnter: () => void
  placeholder: string
  disabled?: boolean
}) {
  const pct = Math.min(value.length / 11, 1) * 100
  const complete = value.length === 11
  return (
    <div className="kv-field">
      <label htmlFor={`kv-${label}`}>{label}</label>
      <div className={`kv-input ${complete ? 'done' : ''}`}>
        <input
          id={`kv-${label}`}
          inputMode="numeric"
          autoComplete="off"
          maxLength={11}
          value={value}
          placeholder={placeholder}
          disabled={disabled}
          onChange={e => onChange(e.target.value.replace(/\D/g, '').slice(0, 11))}
          onKeyDown={e => { if (e.key === 'Enter' && complete) onEnter() }}
        />
        <span className="kv-count">{value.length}/11</span>
        <span className="kv-line"><i style={{ width: `${pct}%` }} /></span>
      </div>
      <p className="kv-hint">{complete ? 'Looks good. Ready to verify.' : `${11 - value.length} more digit${11 - value.length === 1 ? '' : 's'} to go`}</p>
    </div>
  )
}

export default function KycVerificationPage() {
  const navigate = useNavigate()
  const { showToast } = useUIStore()
  const { setUser } = useAuthStore()

  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState('')
  const [status, setStatus] = useState<KycStatus | null>(null)
  const [step, setStep] = useState<Step>('NIN')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const [nin, setNin] = useState('')
  const [bvn, setBvn] = useState('')

  const [scanning, setScanning] = useState(false)
  const [session, setSession] = useState<{ token: string; challenges: Challenge[] } | null>(null)

  const load = useCallback(async () => {
    try {
      const res = await kycApi.getStatus()
      const s = (res.data?.data ?? res.data) as KycStatus
      setStatus(s)
      setStep(stepFromStatus(s))
      setLoadError('')
    } catch (e) {
      setLoadError(errMsg(e, 'Could not load your verification status.'))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  // When verification completes, refresh the logged-in user so the rest of the app unlocks.
  useEffect(() => {
    if (step !== 'DONE') return
    authApi.getMe()
      .then(res => {
        const u = (res.data as any)?.data ?? res.data
        if (u?.id) setUser(u)
      })
      .catch(() => {})
  }, [step, setUser])

  const retryLoad = () => { setLoading(true); setLoadError(''); load() }

  const submitNin = async () => {
    setError(''); setBusy(true)
    try {
      await kycApi.verifyNin(nin.trim())
      setNin('')
      showToast('NIN verified', 'success')
      await load()
    } catch (e) {
      setError(errMsg(e, 'NIN verification failed. Please check your NIN and try again.'))
    } finally {
      setBusy(false)
    }
  }

  const submitBvn = async () => {
    setError(''); setBusy(true)
    try {
      await kycApi.verifyBvn(bvn.trim())
      setBvn('')
      showToast('BVN verified', 'success')
      await load()
    } catch (e) {
      setError(errMsg(e, 'BVN verification failed. Please check your BVN and try again.'))
    } finally {
      setBusy(false)
    }
  }

  const startFace = async () => {
    setError(''); setBusy(true)
    try {
      const res = await kycApi.startLiveness()
      const d = res.data?.data ?? res.data
      setSession({ token: d.sessionToken, challenges: d.challenges as Challenge[] })
      setScanning(true)
    } catch (e) {
      setError(errMsg(e, 'Could not start the face scan. Please try again.'))
    } finally {
      setBusy(false)
    }
  }

  const onCapture = async (image: string) => {
    if (!session) return
    setScanning(false); setBusy(true); setError('')
    try {
      const res = await kycApi.submitFace(image, session.token)
      const d = res.data?.data ?? res.data
      if (d?.message) showToast(d.message, 'success')
      await load()
    } catch (e) {
      setError(errMsg(e, 'Face scan failed. Please try again.'))
    } finally {
      setSession(null)
      setBusy(false)
    }
  }

  const cancelScan = () => { setScanning(false); setSession(null) }

  const rejected = status?.status === 'REJECTED'
  const ninOk = !!status?.ninVerified && !rejected
  const bvnOk = !!status?.bvnVerified && !rejected
  const faceOk = step === 'DONE' || step === 'REVIEW'

  const tiles: { key: Step; num: number; label: string; ok: boolean; value: string }[] = [
    { key: 'NIN',  num: 1, label: 'NIN',       ok: ninOk,  value: ninOk ? status?.ninMasked || 'Verified' : step === 'NIN' ? 'In progress' : 'Pending' },
    { key: 'BVN',  num: 2, label: 'BVN',       ok: bvnOk,  value: bvnOk ? status?.bvnMasked || 'Verified' : step === 'BVN' ? 'In progress' : 'Pending' },
    { key: 'FACE', num: 3, label: 'Face scan', ok: faceOk, value: faceOk ? 'Completed' : step === 'FACE' ? 'In progress' : 'Pending' },
  ]

  const Spinner = () => <span className="kv-spin" aria-hidden />

  return (
    <DashboardLayout title="Verify identity" subtitle="NIN, BVN and a quick face scan">
      <div className="kv-root">
        <style>{CSS}</style>

        {/* hero */}
        <motion.div className="kv-hero" {...fade(0)}>
          <div className="kv-shield">
            <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
              <path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
            </svg>
          </div>
          <div>
            <p className="kv-eyebrow">Identity verification</p>
            <h2 className="kv-title">Let's confirm it's really you</h2>
            <p className="kv-sub">Three quick steps. It takes about two minutes, and keeps every savings circle safe.</p>
          </div>
        </motion.div>

        {loading ? (
          <div className="kv-grid">{[1, 2, 3].map(i => <div key={i} className="kv-skel" style={{ height: 64 }} />)}</div>
        ) : loadError ? (
          <motion.div className="kv-card" {...fade(0.04)}>
            <p className="kv-h">We could not load your verification</p>
            <p className="kv-note err">{loadError}</p>
            <p className="kv-hint" style={{ marginTop: 10 }}>This is usually a short server hiccup. Try again in a moment.</p>
            <div className="kv-row">
              <button type="button" className="kv-btn" onClick={retryLoad}>Try again →</button>
            </div>
          </motion.div>
        ) : (
          <>
            {/* progress tiles (same look as the profile page) */}
            <motion.div className="kv-grid" {...fade(0.04)}>
              {tiles.map(t => (
                <div key={t.key} className={`kv-tile ${t.key === step ? 'cur' : ''} ${t.ok ? 'ok' : ''}`}>
                  <div>
                    <p className="kv-tile-label">{t.label}</p>
                    <p className={`kv-tile-value ${t.ok ? '' : 'muted'}`}>{t.value}</p>
                  </div>
                  <span className={`kv-tick ${t.ok ? 'ok' : ''} ${t.key === step ? 'cur' : ''}`}>
                    {t.ok ? <Tick ok /> : <b>{t.num}</b>}
                  </span>
                </div>
              ))}
            </motion.div>

            {rejected && (
              <div className="kv-note err">
                Your last verification was rejected.{status?.rejectionReason ? ` Reason: ${status.rejectionReason}.` : ''} Please start again with your NIN.
              </div>
            )}

            {error && <div className="kv-note err" role="alert">{error}</div>}

            <AnimatePresence mode="wait">
              <motion.div key={`${step}-${scanning}`} className="kv-card" {...fade(0)}>
                {step === 'NIN' && (
                  <>
                    <p className="kv-h">Step 1 of 3 · Your NIN</p>
                    <p className="kv-p">Enter your 11-digit National Identification Number.</p>
                    <DigitField label="NIN" placeholder="Enter 11 digits" value={nin} onChange={setNin} onEnter={submitNin} disabled={busy} />
                    <div className="kv-row">
                      <span className="kv-lock">🔒 Encrypted. Only used to confirm who you are.</span>
                      <button type="button" className="kv-btn" onClick={submitNin} disabled={busy || nin.length !== 11}>
                        {busy ? <><Spinner /> Verifying…</> : <>Verify NIN →</>}
                      </button>
                    </div>
                  </>
                )}

                {step === 'BVN' && (
                  <>
                    <p className="kv-h">Step 2 of 3 · Your BVN</p>
                    <p className="kv-p">
                      {status?.ninMasked ? `NIN ${status.ninMasked} verified. ` : ''}Now enter your 11-digit Bank Verification Number.
                    </p>
                    <DigitField label="BVN" placeholder="Enter 11 digits" value={bvn} onChange={setBvn} onEnter={submitBvn} disabled={busy} />
                    <div className="kv-row">
                      <span className="kv-lock">🔒 We never see your bank login or PIN.</span>
                      <button type="button" className="kv-btn" onClick={submitBvn} disabled={busy || bvn.length !== 11}>
                        {busy ? <><Spinner /> Verifying…</> : <>Verify BVN →</>}
                      </button>
                    </div>
                  </>
                )}

                {step === 'FACE' && !scanning && (
                  <>
                    <p className="kv-h">Step 3 of 3 · Face scan</p>
                    <p className="kv-p">We will ask you to blink, smile and turn your head. The photo is taken automatically.</p>
                    <ul className="kv-tips">
                      <li><span><Tick ok /></span>Sit in a well-lit place, facing the light</li>
                      <li><span><Tick ok /></span>Only you should be in the frame</li>
                      <li><span><Tick ok /></span>Remove sunglasses and hats, and turn off camera filters</li>
                    </ul>
                    <div className="kv-row">
                      <span className="kv-lock">📷 Your camera is only used during this scan.</span>
                      <button type="button" className="kv-btn" onClick={startFace} disabled={busy}>
                        {busy ? <><Spinner /> Please wait…</> : <>Start face scan →</>}
                      </button>
                    </div>
                  </>
                )}

                {step === 'FACE' && scanning && session && (
                  <LivenessCapture challenges={session.challenges} onCapture={onCapture} onCancel={cancelScan} />
                )}

                {step === 'REVIEW' && (
                  <div className="kv-center">
                    <div className="kv-badge warn">⏳</div>
                    <p className="kv-h" style={{ border: 'none', margin: 0, padding: 0 }}>Under review</p>
                    <p className="kv-p">Your details have been received and our team is reviewing them. We will notify you within 24 hours.</p>
                  </div>
                )}

                {step === 'DONE' && (
                  <div className="kv-center">
                    <div className="kv-badge ok"><Tick ok /></div>
                    <p className="kv-h" style={{ border: 'none', margin: 0, padding: 0 }}>You are verified</p>
                    <p className="kv-p">Your account is active. You can now join or create savings groups.</p>
                    <button type="button" className="kv-btn" onClick={() => navigate('/dashboard')}>Go to dashboard →</button>
                  </div>
                )}
              </motion.div>
            </AnimatePresence>
          </>
        )}
      </div>
    </DashboardLayout>
  )
}

const CSS = `
  @import url('https://fonts.googleapis.com/css2?family=DM+Mono:wght@400;500&family=Inter:wght@300;400;500;600;700;800&display=swap');
  .kv-root { font-family: 'Inter', -apple-system, sans-serif; max-width: 760px; margin: 0 auto; padding: 24px 20px; display: flex; flex-direction: column; gap: 16px; color: #111827; background: #F8F9FB; min-height: 100vh; }

  .kv-hero { background: #fff; border: 1px solid #E5E7EB; border-radius: 20px; padding: 22px 24px; display: flex; align-items: center; gap: 16px; box-shadow: 0 1px 4px rgba(0,0,0,.04); }
  .kv-shield { width: 54px; height: 54px; border-radius: 50%; background: #F0FDF4; color: #16A34A; border: 1px solid #BBF7D0; display: flex; align-items: center; justify-content: center; flex-shrink: 0; }
  .kv-eyebrow { font-size: 12px; color: #22C55E; font-weight: 600; margin-bottom: 2px; }
  .kv-title { font-size: 21px; font-weight: 800; letter-spacing: -0.4px; color: #111827; }
  .kv-sub { font-size: 12.5px; color: #6B7280; margin-top: 3px; line-height: 1.5; }

  .kv-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 12px; }
  @media (max-width: 640px) { .kv-grid { grid-template-columns: 1fr; } }
  .kv-tile { display: flex; align-items: center; justify-content: space-between; gap: 10px; background: #fff; border: 1px solid #E5E7EB; border-radius: 14px; padding: 14px; transition: border-color .2s, background .2s, box-shadow .2s; }
  .kv-tile.cur { border-color: #22C55E; background: #F0FDF4; box-shadow: 0 0 0 3px rgba(34,197,94,.08); }
  .kv-tile-label { font-size: 9px; font-weight: 600; letter-spacing: .05em; text-transform: uppercase; color: #9CA3AF; margin-bottom: 3px; }
  .kv-tile-value { font-size: 12.5px; font-weight: 600; color: #111827; font-family: 'DM Mono', monospace; }
  .kv-tile-value.muted { color: #9CA3AF; font-family: inherit; font-weight: 500; }
  .kv-tick { width: 24px; height: 24px; border-radius: 50%; border: 1.5px solid #D1D5DB; display: flex; align-items: center; justify-content: center; flex-shrink: 0; color: #9CA3AF; font-size: 11px; background: #fff; }
  .kv-tick b { font-weight: 700; }
  .kv-tick.cur { border-color: #22C55E; color: #16A34A; animation: kv-pulse 1.8s infinite; }
  .kv-tick.ok { background: #16A34A; border-color: #16A34A; color: #fff; animation: none; }
  @keyframes kv-pulse { 0% { box-shadow: 0 0 0 0 rgba(34,197,94,.35); } 70% { box-shadow: 0 0 0 8px rgba(34,197,94,0); } 100% { box-shadow: 0 0 0 0 rgba(34,197,94,0); } }

  .kv-card { position: relative; background: #fff; border: 1px solid #E5E7EB; border-radius: 18px; padding: 24px; box-shadow: 0 1px 4px rgba(0,0,0,.04); overflow: hidden; }
  .kv-card::before { content: ''; position: absolute; top: 0; left: 0; right: 0; height: 3px; background: linear-gradient(90deg, #22C55E, #0B3D2A); }
  .kv-h { font-size: 13px; font-weight: 700; color: #111827; padding-bottom: 12px; margin-bottom: 12px; border-bottom: 1px solid #F3F4F6; }
  .kv-p { font-size: 12.5px; color: #6B7280; line-height: 1.55; margin-bottom: 18px; }

  .kv-field label { display: block; font-size: 9px; font-weight: 600; letter-spacing: .05em; text-transform: uppercase; color: #9CA3AF; margin-bottom: 6px; }
  .kv-input { position: relative; display: flex; align-items: center; background: #F9FAFB; border: 1px solid #E5E7EB; border-radius: 12px; padding: 0 14px; height: 56px; overflow: hidden; transition: border-color .15s, box-shadow .15s, background .15s; }
  .kv-input:focus-within { border-color: #22C55E; background: #fff; box-shadow: 0 0 0 3px rgba(34,197,94,.1); }
  .kv-input.done { border-color: #16A34A; background: #F0FDF4; }
  .kv-input input { flex: 1; min-width: 0; height: 100%; border: none; background: transparent; outline: none; font-family: 'DM Mono', monospace; font-size: 19px; letter-spacing: .16em; color: #111827; }
  .kv-input input::placeholder { font-family: 'Inter', sans-serif; font-size: 13px; letter-spacing: 0; color: #9CA3AF; }
  .kv-count { font-family: 'DM Mono', monospace; font-size: 11px; color: #9CA3AF; margin-left: 8px; }
  .kv-input.done .kv-count { color: #16A34A; font-weight: 600; }
  .kv-line { position: absolute; left: 0; right: 0; bottom: 0; height: 3px; background: transparent; }
  .kv-line i { position: relative; display: block; height: 100%; background: linear-gradient(90deg, #86EFAC, #22C55E, #16A34A); border-radius: 0 3px 3px 0; transition: width .28s cubic-bezier(.16, 1, .3, 1); }
  .kv-line i::after { content: ''; position: absolute; right: -1px; top: -3px; width: 9px; height: 9px; border-radius: 50%; background: #22C55E; box-shadow: 0 0 10px 2px rgba(34,197,94,.55); opacity: 0; transition: opacity .2s; }
  .kv-input:focus-within .kv-line i::after, .kv-input.done .kv-line i::after { opacity: 1; }
  .kv-hint { font-size: 11px; color: #9CA3AF; margin-top: 8px; }

  .kv-row { display: flex; align-items: center; justify-content: space-between; gap: 14px; margin-top: 20px; flex-wrap: wrap; }
  .kv-lock { font-size: 11px; color: #6B7280; }
  .kv-btn { display: inline-flex; align-items: center; justify-content: center; gap: 8px; font-family: inherit; font-size: 13px; font-weight: 600; color: #fff; background: #0B3D2A; border: none; border-radius: 10px; padding: 12px 22px; cursor: pointer; transition: background .15s, transform .1s; }
  .kv-btn:hover:not(:disabled) { background: #0F5138; }
  .kv-btn:active:not(:disabled) { transform: scale(.98); }
  .kv-btn:disabled { opacity: .45; cursor: not-allowed; }
  .kv-spin { width: 13px; height: 13px; border-radius: 50%; border: 2px solid rgba(255,255,255,.4); border-top-color: #fff; animation: kv-rot .7s linear infinite; }
  @keyframes kv-rot { to { transform: rotate(360deg); } }

  .kv-tips { list-style: none; display: flex; flex-direction: column; gap: 10px; margin: 0; padding: 0; }
  .kv-tips li { display: flex; align-items: center; gap: 10px; font-size: 12.5px; color: #374151; }
  .kv-tips li span { width: 20px; height: 20px; border-radius: 50%; background: #16A34A; color: #fff; display: flex; align-items: center; justify-content: center; flex-shrink: 0; }

  .kv-note { font-size: 12px; font-weight: 500; padding: 11px 14px; border-radius: 10px; }
  .kv-note.err { color: #B91C1C; background: #FEF2F2; border: 1px solid #FECACA; }

  .kv-center { display: flex; flex-direction: column; align-items: center; text-align: center; gap: 10px; padding: 14px 0; }
  .kv-badge { width: 56px; height: 56px; border-radius: 50%; display: flex; align-items: center; justify-content: center; font-size: 22px; }
  .kv-badge.ok { background: #16A34A; color: #fff; box-shadow: 0 0 0 8px rgba(34,197,94,.12); }
  .kv-badge.ok svg { width: 24px; height: 24px; }
  .kv-badge.warn { background: #FEF3C7; }

  .kv-skel { background: linear-gradient(90deg, #F3F4F6 25%, #E5E7EB 50%, #F3F4F6 75%); background-size: 200% 100%; animation: kv-shimmer 1.5s infinite; border-radius: 14px; }
  @keyframes kv-shimmer { 0% { background-position: 200% 0; } 100% { background-position: -200% 0; } }

  @media (prefers-reduced-motion: reduce) { .kv-tick.cur, .kv-line i, .kv-spin { animation: none; transition: none; } }
`