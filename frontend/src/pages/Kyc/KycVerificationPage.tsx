// ============================================================
// KycVerificationPage.tsx — AjoDaddy identity verification
// Same flow and API calls as before (NIN → BVN → face liveness),
// restyled to match the Profile page cards.
// ============================================================
import { useState, useEffect, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import DashboardLayout from '@/components/layout/DashboardLayout'
import { useUIStore } from '@/stores/uiStore'
import { kycApi } from '@/api/services'
import LivenessCapture from '@/components/LivenessCapture'

type KycStep = 'nin' | 'bvn' | 'face' | 'complete' | 'pending' | 'rejected'

function deriveStep(status: any): KycStep {
  if (!status)                                                    return 'nin'
  if (status.status === 'VERIFIED')                               return 'complete'
  if (status.status === 'REJECTED')                               return 'rejected'
  if (status.status === 'MANUAL_REVIEW' && status.faceSubmitted)  return 'pending'
  if (status.bvnVerified && !status.faceSubmitted)                return 'face'
  if (status.ninVerified  && !status.bvnVerified)                 return 'bvn'
  return 'nin'
}

// ── small icons ────────────────────────────────────────────────
const Icon = {
  check: <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3"><path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7"/></svg>,
  x:     <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2"><path strokeLinecap="round" strokeLinejoin="round" d="M6 6l12 12M18 6L6 18"/></svg>,
  clock: <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="9"/><path strokeLinecap="round" strokeLinejoin="round" d="M12 7v5l3 2"/></svg>,
  shield:<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4m5.6-4A12 12 0 0112 2.9 12 12 0 013.4 6 12 12 0 003 9c0 5.6 3.8 10.3 9 11.6 5.2-1.3 9-6 9-11.6 0-1-.1-2-.4-3z"/></svg>,
  lock:  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="5" y="11" width="14" height="9" rx="2"/><path strokeLinecap="round" d="M8 11V8a4 4 0 018 0v3"/></svg>,
}

const STEPS = ['NIN', 'BVN', 'Face scan', 'Done']

function Stepper({ current }: { current: number }) {
  return (
    <ol className="kx-stepper" aria-label="Verification progress">
      {STEPS.map((label, i) => {
        const n = i + 1
        const state = n < current ? 'done' : n === current ? 'active' : 'todo'
        return (
          <li key={label} className={`kx-step ${state}`} aria-current={state === 'active' ? 'step' : undefined}>
            <span className="kx-dot">{state === 'done' ? Icon.check : n}</span>
            <span className="kx-step-label">{label}</span>
          </li>
        )
      })}
    </ol>
  )
}

function SummaryRows({ status, review = false }: { status: any; review?: boolean }) {
  const tag = review ? 'Submitted' : 'Verified'
  return (
    <div className="kx-summary">
      <div className="kx-sum-row"><span>NIN</span><b className="kx-mono">{status?.ninMasked || '—'}</b><i className="kx-chip ok">{tag}</i></div>
      <div className="kx-sum-row"><span>BVN</span><b className="kx-mono">{status?.bvnMasked || '—'}</b><i className="kx-chip ok">{tag}</i></div>
      <div className="kx-sum-row"><span>Face scan</span><b>Liveness check</b><i className="kx-chip ok">{review ? 'Submitted' : 'Confirmed'}</i></div>
    </div>
  )
}

function IdStep({ title, subtitle, note, banner, label, placeholder, value, onChange, error, loading, onSubmit, cta, busyCta }: {
  title: string; subtitle: string; note: string; banner?: string
  label: string; placeholder: string; value: string; onChange: (v: string) => void
  error: string; loading: boolean; onSubmit: () => void; cta: string; busyCta: string
}) {
  const ready = value.length === 11
  return (
    <div className="kx-body">
      {banner && <div className="kx-banner ok"><span className="kx-banner-ic">{Icon.check}</span>{banner}</div>}
      <div>
        <h2 className="kx-title">{title}</h2>
        <p className="kx-sub">{subtitle}</p>
      </div>
      <div className="kx-note"><span className="kx-note-ic">{Icon.lock}</span>{note}</div>
      <div>
        <label className="kx-label" htmlFor="kx-id">{label}</label>
        <input
          id="kx-id" className="kx-input" value={value} inputMode="numeric" autoComplete="off" maxLength={11}
          placeholder={placeholder}
          onChange={e => onChange(e.target.value.replace(/\D/g, ''))}
          onKeyDown={e => { if (e.key === 'Enter' && ready && !loading) onSubmit() }}
          aria-invalid={!!error}
        />
        <div className="kx-meter" aria-hidden><span style={{ width: `${(value.length / 11) * 100}%` }} /></div>
        <p className="kx-hint">{value.length}/11 digits</p>
      </div>
      {error && <p className="kx-error" role="alert">{error}</p>}
      <button className="kx-btn" onClick={onSubmit} disabled={loading || !ready}>{loading ? busyCta : cta}</button>
    </div>
  )
}

export default function KycVerificationPage() {
  const navigate      = useNavigate()
  const { showToast } = useUIStore()

  const [status, setStatus]             = useState<any>(null)
  const [loading, setLoading]           = useState(true)
  const [nin, setNin]                   = useState('')
  const [bvn, setBvn]                   = useState('')
  const [ninLoading, setNinLoading]     = useState(false)
  const [bvnLoading, setBvnLoading]     = useState(false)
  const [error, setError]               = useState('')
  const [faceLoading, setFaceLoading]   = useState(false)
  const [showLiveness, setShowLiveness] = useState(false)

  const step: KycStep = useMemo(() => deriveStep(status), [status])

  useEffect(() => { loadStatus() }, [])
  useEffect(() => { setShowLiveness(step === 'face') }, [step])

  const loadStatus = async () => {
    setLoading(true)
    try {
      const res = await kycApi.getStatus()
      setStatus((res.data as any)?.data || res.data)
    } catch {
      showToast('Could not load verification status', 'error')
    } finally {
      setLoading(false)
    }
  }

  const handleNinSubmit = async () => {
    setError('')
    if (!/^\d{11}$/.test(nin.trim())) { setError('NIN must be exactly 11 digits'); return }
    setNinLoading(true)
    try {
      const res = await kycApi.verifyNin(nin.trim())
      const d   = (res.data as any)?.data || res.data
      showToast('NIN verified', 'success')
      setStatus((prev: any) => ({ ...(prev || {}), ninVerified: true, ninMasked: d?.ninMasked || ('*'.repeat(7) + nin.slice(-4)) }))
    } catch (err: any) {
      setError(err?.response?.data?.message || 'NIN verification failed. Please try again.')
    } finally { setNinLoading(false) }
  }

  const handleBvnSubmit = async () => {
    setError('')
    if (!/^\d{11}$/.test(bvn.trim())) { setError('BVN must be exactly 11 digits'); return }
    setBvnLoading(true)
    try {
      const res = await kycApi.verifyBvn(bvn.trim())
      const d   = (res.data as any)?.data || res.data
      showToast('BVN verified. One more step: face scan', 'success')
      setStatus((prev: any) => ({ ...(prev || {}), bvnVerified: true, bvnMasked: d?.bvnMasked || ('*'.repeat(7) + bvn.slice(-4)), identityMatched: d?.identityMatched }))
    } catch (err: any) {
      setError(err?.response?.data?.message || 'BVN verification failed. Please try again.')
    } finally { setBvnLoading(false) }
  }

  const handleLivenessCapture = async (base64: string) => {
    setFaceLoading(true)
    try {
      const cloudName    = import.meta.env.VITE_CLOUDINARY_CLOUD_NAME    || 'dq8vykxut'
      const uploadPreset = import.meta.env.VITE_CLOUDINARY_UPLOAD_PRESET || 'paypaddy_kyc_faces'
      const fd = new FormData()
      fd.append('file', base64)
      fd.append('upload_preset', uploadPreset)
      fd.append('folder', 'kyc-face-captures')
      fd.append('tags', 'user_kyc_face_liveness')

      const upRes  = await fetch(`https://api.cloudinary.com/v1_1/${cloudName}/image/upload`, { method: 'POST', body: fd })
      const upData = await upRes.json()
      if (!upData.secure_url) throw new Error('Face upload failed. Check that the Cloudinary preset is Unsigned.')

      const res = await kycApi.submitFacePhoto(upData.secure_url)
      const d   = (res.data as any)?.data || res.data

      if (d?.status === 'VERIFIED' || d?.message?.includes('active')) {
        showToast('Identity fully verified. Account activated', 'success')
        setStatus((prev: any) => ({ ...(prev || {}), status: 'VERIFIED', faceSubmitted: true, facePhotoUrl: upData.secure_url }))
      } else {
        showToast('Face scan submitted. Under manual review.', 'info')
        setStatus((prev: any) => ({ ...(prev || {}), status: 'MANUAL_REVIEW', faceSubmitted: true, facePhotoUrl: upData.secure_url }))
      }
      setShowLiveness(false)
    } catch (err: any) {
      showToast(err?.response?.data?.message || err?.message || 'Face submission failed. Try again.', 'error')
    } finally { setFaceLoading(false) }
  }

  const handleResubmit = () => { setNin(''); setBvn(''); setError(''); setStatus(null) }

  const currentStepNum = step === 'nin' ? 1 : step === 'bvn' ? 2 : step === 'face' ? 3 : 4
  const showLocked = step !== 'complete' && step !== 'rejected'

  return (
    <DashboardLayout title="Verify Identity" subtitle="Complete KYC to unlock all AjoDaddy features">
      <style>{CSS}</style>
      <div className="kx-root">
        <div className="kx-grid">
          <div className="kx-main">
            <section className="kx-card">
              <Stepper current={currentStepNum} />

              {loading ? (
                <div className="kx-center">
                  <div className="kx-spin" />
                  <p className="kx-sub">Loading your verification status…</p>
                </div>

              ) : step === 'complete' ? (
                <div className="kx-body kx-centered">
                  <div className="kx-badge ok">{Icon.shield}</div>
                  <h2 className="kx-title">Identity verified</h2>
                  <p className="kx-sub">Your account is fully active. All features are unlocked.</p>
                  <SummaryRows status={status} />
                  <button className="kx-btn" onClick={() => navigate('/groups')}>Go to groups →</button>
                </div>

              ) : step === 'rejected' ? (
                <div className="kx-body kx-centered">
                  <div className="kx-badge err">{Icon.x}</div>
                  <h2 className="kx-title">Verification rejected</h2>
                  <p className="kx-sub">We couldn't verify your identity with the details you submitted.</p>
                  {status?.rejectionReason && (
                    <div className="kx-banner err kx-left"><div><b>Reason</b><p>{status.rejectionReason}</p></div></div>
                  )}
                  <div className="kx-actions">
                    <button className="kx-btn" onClick={handleResubmit}>Resubmit →</button>
                    <button className="kx-btn ghost" onClick={() => navigate('/contact-support')}>Contact support</button>
                  </div>
                </div>

              ) : step === 'pending' ? (
                <div className="kx-body kx-centered">
                  <div className="kx-badge warn">{Icon.clock}</div>
                  <h2 className="kx-title">Under review</h2>
                  <p className="kx-sub">Your identity is being reviewed manually. This usually takes under 24 hours.</p>
                  <SummaryRows status={status} review />
                  <span className="kx-chip warn big">Under review</span>
                </div>

              ) : step === 'nin' ? (
                <IdStep
                  title="Step 1: NIN verification" subtitle="Enter your 11-digit National Identification Number."
                  note="Your NIN is encrypted before storage. Only the last 4 digits are ever shown."
                  label="National Identification Number (NIN)" placeholder="Enter your 11-digit NIN"
                  value={nin} onChange={v => { setNin(v); setError('') }} error={error}
                  loading={ninLoading} onSubmit={handleNinSubmit} cta="Verify NIN →" busyCta="Verifying NIN…"
                />

              ) : step === 'bvn' ? (
                <IdStep
                  banner={`NIN verified: ${status?.ninMasked ?? ''}`}
                  title="Step 2: BVN verification" subtitle="Enter your 11-digit Bank Verification Number."
                  note="Your BVN is encrypted and cross-matched with your NIN to confirm your identity."
                  label="Bank Verification Number (BVN)" placeholder="Enter your 11-digit BVN"
                  value={bvn} onChange={v => { setBvn(v); setError('') }} error={error}
                  loading={bvnLoading} onSubmit={handleBvnSubmit} cta="Verify BVN →" busyCta="Verifying BVN…"
                />

              ) : step === 'face' ? (
                <div className="kx-body">
                  <div className="kx-banner ok"><span className="kx-banner-ic">{Icon.check}</span>NIN and BVN verified</div>
                  <div>
                    <h2 className="kx-title">Step 3: Face liveness scan</h2>
                    <p className="kx-sub">Centre your face in good lighting and capture a clear selfie. We'll confirm it's really you.</p>
                  </div>
                  {faceLoading ? (
                    <div className="kx-center"><div className="kx-spin" /><p className="kx-sub">Uploading your face scan…</p></div>
                  ) : showLiveness ? (
                    <LivenessCapture
                      onCapture={handleLivenessCapture}
                      onCancel={() => setShowLiveness(false)}
                      uploadingLabel="Uploading your face scan…"
                    />
                  ) : (
                    <button className="kx-btn" onClick={() => setShowLiveness(true)}>Start face scan →</button>
                  )}
                </div>
              ) : null}
            </section>
          </div>

          {showLocked && (
            <aside className="kx-side">
              <section className="kx-card kx-locked">
                <h3 className="kx-side-h">Until you verify</h3>
                <ul>
                  {['Join or create contribution groups', 'Receive payouts', 'Withdraw funds', 'Use financial features'].map(t => (
                    <li key={t}><span className="kx-x">{Icon.lock}</span>{t}</li>
                  ))}
                </ul>
              </section>
            </aside>
          )}
        </div>
      </div>
    </DashboardLayout>
  )
}

const CSS = `
  @import url('https://fonts.googleapis.com/css2?family=DM+Mono:wght@400;500&family=Inter:wght@400;500;600;700&display=swap');
  .kx-root { font-family: 'Inter', -apple-system, sans-serif; background: #F8F9FB; min-height: 100vh; padding: 24px 20px 40px; color: #111827; }
  .kx-grid { max-width: 940px; margin: 0 auto; display: grid; grid-template-columns: minmax(0, 1fr) 260px; gap: 16px; align-items: start; }
  .kx-grid:has(.kx-side) { grid-template-columns: minmax(0, 1fr) 260px; }
  .kx-grid:not(:has(.kx-side)) { grid-template-columns: minmax(0, 620px); justify-content: center; }
  @media (max-width: 820px) { .kx-grid, .kx-grid:has(.kx-side) { grid-template-columns: 1fr; } .kx-side { order: -1; } }
  .kx-card { background: #fff; border: 1px solid #E5E7EB; border-radius: 18px; padding: 24px; box-shadow: 0 1px 4px rgba(0,0,0,.04); }

  /* stepper */
  .kx-stepper { list-style: none; margin: 0 0 26px; padding: 0; display: flex; }
  .kx-step { flex: 1; display: flex; flex-direction: column; align-items: center; gap: 6px; position: relative; }
  .kx-step:not(:last-child)::after { content: ''; position: absolute; top: 14px; left: calc(50% + 18px); right: calc(-50% + 18px); height: 2px; background: #E5E7EB; }
  .kx-step.done:not(:last-child)::after { background: #16A34A; }
  .kx-dot { width: 28px; height: 28px; border-radius: 50%; display: flex; align-items: center; justify-content: center; font-size: 12px; font-weight: 700; background: #F3F4F6; color: #9CA3AF; border: 1.5px solid #E5E7EB; position: relative; z-index: 1; }
  .kx-step.active .kx-dot { background: #0B3D2A; border-color: #0B3D2A; color: #fff; box-shadow: 0 0 0 4px rgba(11,61,42,.12); }
  .kx-step.done .kx-dot { background: #16A34A; border-color: #16A34A; color: #fff; }
  .kx-step-label { font-size: 11px; font-weight: 600; color: #9CA3AF; }
  .kx-step.active .kx-step-label { color: #111827; }
  .kx-step.done .kx-step-label { color: #15803D; }

  /* content */
  .kx-body { display: flex; flex-direction: column; gap: 16px; }
  .kx-centered { align-items: center; text-align: center; }
  .kx-left { text-align: left; align-self: stretch; }
  .kx-title { font-size: 17px; font-weight: 700; letter-spacing: -.2px; }
  .kx-sub { font-size: 12.5px; color: #6B7280; line-height: 1.55; margin-top: 3px; }
  .kx-badge { width: 52px; height: 52px; border-radius: 50%; display: flex; align-items: center; justify-content: center; }
  .kx-badge.ok { background: #DCFCE7; color: #15803D; }
  .kx-badge.err { background: #FEE2E2; color: #B91C1C; }
  .kx-badge.warn { background: #FEF3C7; color: #B45309; }

  .kx-note { display: flex; gap: 10px; align-items: flex-start; font-size: 12px; color: #374151; line-height: 1.5; background: #F9FAFB; border: 1px solid #E5E7EB; border-radius: 10px; padding: 11px 12px; }
  .kx-note-ic { color: #16A34A; margin-top: 1px; display: flex; }
  .kx-banner { display: flex; gap: 10px; align-items: center; font-size: 12px; font-weight: 600; border-radius: 10px; padding: 11px 12px; }
  .kx-banner.ok { background: #F0FDF4; color: #15803D; }
  .kx-banner.err { background: #FEF2F2; color: #B91C1C; align-items: flex-start; }
  .kx-banner.err b { font-size: 10px; letter-spacing: .05em; text-transform: uppercase; }
  .kx-banner.err p { font-weight: 500; margin-top: 3px; }
  .kx-banner-ic { width: 20px; height: 20px; border-radius: 50%; background: #16A34A; color: #fff; display: flex; align-items: center; justify-content: center; flex-shrink: 0; }
  .kx-banner-ic svg { width: 11px; height: 11px; }

  /* input */
  .kx-label { display: block; font-size: 9.5px; font-weight: 600; letter-spacing: .05em; text-transform: uppercase; color: #9CA3AF; margin-bottom: 6px; }
  .kx-input { width: 100%; height: 46px; padding: 0 14px; background: #F9FAFB; border: 1px solid #E5E7EB; border-radius: 10px; font-family: 'DM Mono', monospace; font-size: 15px; letter-spacing: .18em; color: #111827; outline: none; transition: border-color .15s, box-shadow .15s, background .15s; }
  .kx-input::placeholder { letter-spacing: 0; font-family: 'Inter', sans-serif; font-size: 13px; color: #9CA3AF; }
  .kx-input:focus { border-color: #22C55E; background: #fff; box-shadow: 0 0 0 3px rgba(34,197,94,.12); }
  .kx-input[aria-invalid="true"] { border-color: #F87171; }
  .kx-meter { height: 3px; background: #F3F4F6; border-radius: 99px; margin-top: 8px; overflow: hidden; }
  .kx-meter span { display: block; height: 100%; background: #16A34A; border-radius: 99px; transition: width .15s; }
  .kx-hint { font-size: 11px; color: #9CA3AF; margin-top: 5px; }
  .kx-error { font-size: 12px; color: #B91C1C; background: #FEF2F2; border-radius: 8px; padding: 10px 12px; }

  /* buttons */
  .kx-btn { font-family: inherit; height: 44px; padding: 0 22px; border: none; border-radius: 10px; background: #0B3D2A; color: #fff; font-size: 13px; font-weight: 600; cursor: pointer; transition: background .15s; }
  .kx-body > .kx-btn { width: 100%; }
  .kx-btn:hover:not(:disabled) { background: #0F5138; }
  .kx-btn:disabled { opacity: .45; cursor: not-allowed; }
  .kx-btn:focus-visible { outline: 2px solid #16A34A; outline-offset: 2px; }
  .kx-btn.ghost { background: #fff; color: #374151; border: 1px solid #D1D5DB; }
  .kx-btn.ghost:hover:not(:disabled) { background: #F9FAFB; }
  .kx-actions { display: flex; gap: 10px; flex-wrap: wrap; justify-content: center; }
  .kx-body.kx-centered > .kx-btn { width: auto; }

  /* summary */
  .kx-summary { align-self: stretch; text-align: left; border: 1px solid #E5E7EB; border-radius: 12px; background: #F9FAFB; }
  .kx-sum-row { display: grid; grid-template-columns: 82px 1fr auto; align-items: center; gap: 10px; padding: 12px 14px; font-size: 12px; }
  .kx-sum-row + .kx-sum-row { border-top: 1px solid #E5E7EB; }
  .kx-sum-row span { font-size: 9.5px; font-weight: 600; letter-spacing: .05em; text-transform: uppercase; color: #9CA3AF; }
  .kx-sum-row b { font-weight: 600; color: #111827; }
  .kx-mono { font-family: 'DM Mono', monospace; }
  .kx-chip { font-style: normal; font-size: 9px; font-weight: 700; letter-spacing: .04em; text-transform: uppercase; padding: 3px 8px; border-radius: 6px; }
  .kx-chip.ok { color: #15803D; background: #DCFCE7; }
  .kx-chip.warn { color: #B45309; background: #FEF3C7; }
  .kx-chip.big { font-size: 10px; padding: 5px 10px; }

  /* side + loading */
  .kx-side-h { font-size: 13px; font-weight: 700; padding-bottom: 12px; margin-bottom: 12px; border-bottom: 1px solid #F3F4F6; }
  .kx-locked ul { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 12px; }
  .kx-locked li { display: flex; align-items: center; gap: 10px; font-size: 12px; color: #4B5563; }
  .kx-x { width: 24px; height: 24px; border-radius: 7px; background: #F3F4F6; color: #9CA3AF; display: flex; align-items: center; justify-content: center; flex-shrink: 0; }
  .kx-center { text-align: center; padding: 36px 0; }
  .kx-spin { width: 26px; height: 26px; border: 2px solid #E5E7EB; border-top-color: #16A34A; border-radius: 50%; margin: 0 auto 12px; animation: kx-spin .8s linear infinite; }
  @keyframes kx-spin { to { transform: rotate(360deg); } }
  @media (prefers-reduced-motion: reduce) { .kx-spin { animation-duration: 2s; } .kx-meter span, .kx-btn, .kx-input { transition: none; } }
`