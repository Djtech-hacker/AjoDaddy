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

function StepIndicator({ step, current }: { step: number; current: number }) {
  const done   = step < current
  const active = step === current
  return (
    <div className={`w-8 h-8 rounded-full flex items-center justify-center text-[12px] font-bold transition-all flex-shrink-0 ${
      done ? 'bg-emerald-500 text-white' : active ? 'bg-gray-900 text-white' : 'bg-gray-100 text-gray-400'
    }`}>
      {done ? '✓' : step}
    </div>
  )
}

export default function KycVerificationPage() {
  const navigate      = useNavigate()
  const { showToast } = useUIStore()

  const [status, setStatus]           = useState<any>(null)
  const [loading, setLoading]         = useState(true)

  const [nin, setNin]                 = useState('')
  const [bvn, setBvn]                 = useState('')
  const [ninLoading, setNinLoading]   = useState(false)
  const [bvnLoading, setBvnLoading]   = useState(false)
  const [error, setError]             = useState('')

  const [faceLoading, setFaceLoading] = useState(false)
  const [showLiveness, setShowLiveness] = useState(false)

  const step: KycStep = useMemo(() => deriveStep(status), [status])

  useEffect(() => { loadStatus() }, [])

  useEffect(() => {
    if (step === 'face') setShowLiveness(true)
    else setShowLiveness(false)
  }, [step])

  const loadStatus = async () => {
    setLoading(true)
    try {
      const res = await kycApi.getStatus()
      const d   = (res.data as any)?.data || res.data
      setStatus(d)
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
      showToast('NIN verified! ✅', 'success')
      setStatus((prev: any) => ({ ...(prev || {}), ninVerified: true, ninMasked: d?.ninMasked || ('*'.repeat(7) + nin.slice(-4)) }))
    } catch (err: any) {
      setError(err?.response?.data?.message || 'NIN verification failed. Please try again.')
    } finally {
      setNinLoading(false)
    }
  }

  const handleBvnSubmit = async () => {
    setError('')
    if (!/^\d{11}$/.test(bvn.trim())) { setError('BVN must be exactly 11 digits'); return }
    setBvnLoading(true)
    try {
      const res = await kycApi.verifyBvn(bvn.trim())
      const d   = (res.data as any)?.data || res.data
      showToast('BVN verified! One more step — face scan 📸', 'success')
      setStatus((prev: any) => ({ ...(prev || {}), bvnVerified: true, bvnMasked: d?.bvnMasked || ('*'.repeat(7) + bvn.slice(-4)), identityMatched: d?.identityMatched }))
    } catch (err: any) {
      setError(err?.response?.data?.message || 'BVN verification failed. Please try again.')
    } finally {
      setBvnLoading(false)
    }
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
      if (!upData.secure_url) throw new Error('Face upload failed — check Cloudinary preset is Unsigned')

      const res = await kycApi.submitFacePhoto(upData.secure_url)
      const d   = (res.data as any)?.data || res.data

      if (d?.status === 'VERIFIED' || d?.message?.includes('active')) {
        showToast('Identity fully verified! Account activated 🎉', 'success')
        setStatus((prev: any) => ({ ...(prev || {}), status: 'VERIFIED', faceSubmitted: true, facePhotoUrl: upData.secure_url }))
      } else {
        showToast('Face scan submitted. Under manual review.', 'info')
        setStatus((prev: any) => ({ ...(prev || {}), status: 'MANUAL_REVIEW', faceSubmitted: true, facePhotoUrl: upData.secure_url }))
      }
      setShowLiveness(false)
    } catch (err: any) {
      showToast(err?.response?.data?.message || err?.message || 'Face submission failed. Try again.', 'error')
    } finally {
      setFaceLoading(false)
    }
  }

  const handleResubmit = () => {
    setNin(''); setBvn(''); setError('')
    setStatus(null)
  }

  const currentStepNum =
    step === 'nin'  ? 1 :
    step === 'bvn'  ? 2 :
    step === 'face' ? 3 : 4

  return (
    <DashboardLayout title="Verify Identity" subtitle="Complete KYC to unlock all PayPaddy features">
      <div className="bg-[#F8F9FB] min-h-screen">
        <div className="max-w-xl mx-auto px-4 py-8 space-y-6">

          {step !== 'complete' && step !== 'rejected' && (
            <div className="bg-amber-50 border border-amber-100 rounded-2xl p-5">
              <p className="text-[13px] font-bold text-amber-800 mb-2">Identity verification required</p>
              <p className="text-[12px] text-amber-700 mb-3">Until you verify your identity you cannot:</p>
              <div className="space-y-1.5">
                {['Join or create contribution groups','Receive payouts','Withdraw funds','Access financial features'].map(item => (
                  <div key={item} className="flex items-center gap-2 text-[12px] text-amber-700">
                    <span className="text-red-400 font-bold">✕</span> {item}
                  </div>
                ))}
              </div>
            </div>
          )}

          <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-6">
            <div className="flex items-center gap-2 mb-2">
              <StepIndicator step={1} current={currentStepNum}/>
              <div className={`flex-1 h-0.5 transition-all ${currentStepNum > 1 ? 'bg-emerald-400' : 'bg-gray-100'}`}/>
              <StepIndicator step={2} current={currentStepNum}/>
              <div className={`flex-1 h-0.5 transition-all ${currentStepNum > 2 ? 'bg-emerald-400' : 'bg-gray-100'}`}/>
              <StepIndicator step={3} current={currentStepNum}/>
              <div className={`flex-1 h-0.5 transition-all ${currentStepNum > 3 ? 'bg-emerald-400' : 'bg-gray-100'}`}/>
              <StepIndicator step={4} current={currentStepNum}/>
            </div>
            <div className="flex justify-between text-[11px] text-gray-400 font-semibold uppercase tracking-wide mb-6">
              <span>NIN</span><span>BVN</span><span>Face</span><span>Done</span>
            </div>

            {loading ? (
              <div className="py-10 text-center">
                <div className="w-7 h-7 border-2 border-gray-200 border-t-gray-700 rounded-full animate-spin mx-auto mb-3"/>
                <p className="text-[13px] text-gray-400">Loading your verification status…</p>
              </div>

            ) : step === 'complete' ? (
              <div className="text-center py-8 space-y-4">
                <div className="w-16 h-16 rounded-full bg-emerald-100 flex items-center justify-center text-3xl mx-auto">✅</div>
                <p className="text-[16px] font-bold text-gray-900">Identity Verified</p>
                <p className="text-[13px] text-gray-500">Your account is fully active. All features are unlocked.</p>
                <div className="bg-gray-50 rounded-xl p-4 text-left space-y-3">
                  <div className="flex justify-between items-center">
                    <span className="text-[12px] text-gray-400">NIN</span>
                    <span className="text-[13px] font-mono font-semibold text-gray-900">{status?.ninMasked || '———'} <span className="text-emerald-500">✓</span></span>
                  </div>
                  <div className="flex justify-between items-center">
                    <span className="text-[12px] text-gray-400">BVN</span>
                    <span className="text-[13px] font-mono font-semibold text-gray-900">{status?.bvnMasked || '———'} <span className="text-emerald-500">✓</span></span>
                  </div>
                  <div className="flex justify-between items-center border-t border-gray-100 pt-3">
                    <span className="text-[12px] text-gray-400">Face scan (liveness)</span>
                    <span className="text-[12px] text-emerald-600 font-semibold">✓ Confirmed</span>
                  </div>
                </div>
                <button onClick={() => navigate('/groups')} className="h-10 px-6 rounded-xl bg-emerald-600 text-white text-[13px] font-semibold hover:bg-emerald-700 transition-colors">
                  Go to Groups →
                </button>
              </div>

            ) : step === 'rejected' ? (
              <div className="text-center py-8 space-y-4">
                <div className="w-16 h-16 rounded-full bg-red-100 flex items-center justify-center text-3xl mx-auto">❌</div>
                <p className="text-[16px] font-bold text-gray-900">Verification Rejected</p>
                <p className="text-[13px] text-gray-500">Your identity verification was rejected.</p>
                {status?.rejectionReason && (
                  <div className="bg-red-50 border border-red-100 rounded-xl p-4 text-left">
                    <p className="text-[11px] font-bold text-red-500 uppercase tracking-wider mb-1">Reason</p>
                    <p className="text-[13px] text-red-700">{status.rejectionReason}</p>
                  </div>
                )}
                <div className="flex gap-3 justify-center">
                  <button onClick={handleResubmit} className="h-10 px-6 rounded-xl bg-emerald-600 text-white text-[13px] font-semibold hover:bg-emerald-700 transition-colors">Resubmit →</button>
                  <button onClick={() => navigate('/contact-support')} className="h-10 px-5 rounded-xl border border-gray-200 text-gray-600 text-[13px] font-semibold hover:bg-gray-50 transition-colors">Contact Support</button>
                </div>
              </div>

            ) : step === 'pending' ? (
              <div className="text-center py-8 space-y-4">
                <div className="w-16 h-16 rounded-full bg-amber-100 flex items-center justify-center text-3xl mx-auto">⏳</div>
                <p className="text-[16px] font-bold text-gray-900">Under Review</p>
                <p className="text-[13px] text-gray-500">Your identity is being manually reviewed. Usually under 24 hours.</p>
                <div className="bg-gray-50 rounded-xl p-4 text-left space-y-3">
                  <div className="flex justify-between items-center">
                    <span className="text-[12px] text-gray-400">NIN</span>
                    <span className="text-[13px] font-mono font-semibold text-gray-900">{status?.ninMasked} <span className="text-blue-400 text-[11px]">submitted</span></span>
                  </div>
                  <div className="flex justify-between items-center">
                    <span className="text-[12px] text-gray-400">BVN</span>
                    <span className="text-[13px] font-mono font-semibold text-gray-900">{status?.bvnMasked} <span className="text-blue-400 text-[11px]">submitted</span></span>
                  </div>
                  <div className="flex justify-between items-center">
                    <span className="text-[12px] text-gray-400">Face scan (liveness)</span>
                    <span className="text-[12px] text-blue-500 font-semibold">📸 Confirmed</span>
                  </div>
                  <div className="flex justify-between items-center border-t border-gray-100 pt-3">
                    <span className="text-[12px] text-gray-400">Status</span>
                    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-amber-50 text-amber-700 text-[11px] font-semibold ring-1 ring-amber-200">⏳ Under review</span>
                  </div>
                </div>
              </div>

            ) : step === 'nin' ? (
              <div className="space-y-4">
                <div>
                  <p className="text-[15px] font-bold text-gray-900 mb-1">Step 1: NIN Verification</p>
                  <p className="text-[12px] text-gray-400">Enter your 11-digit National Identification Number</p>
                </div>
                <div className="bg-blue-50 border border-blue-100 rounded-xl p-3">
                  <p className="text-[12px] text-blue-700">🔒 Your NIN is encrypted before storage. Only the last 4 digits are ever shown.</p>
                </div>
                <div>
                  <label className="block text-[12px] font-semibold text-gray-500 mb-1.5">National Identification Number (NIN)</label>
                  <input
                    value={nin}
                    onChange={e => { setNin(e.target.value.replace(/\D/g, '')); setError('') }}
                    maxLength={11}
                    placeholder="Enter your 11-digit NIN"
                    className="w-full h-11 px-4 border border-gray-200 rounded-xl text-[14px] font-mono tracking-widest text-gray-900 outline-none focus:border-emerald-400 transition-all bg-white"
                  />
                  <p className="text-[11px] text-gray-400 mt-1">{nin.length}/11 digits entered</p>
                </div>
                {error && <div className="bg-red-50 border border-red-100 rounded-xl px-4 py-3"><p className="text-[12px] text-red-600">{error}</p></div>}
                <button onClick={handleNinSubmit} disabled={ninLoading || nin.length !== 11}
                  className="w-full h-11 rounded-xl bg-emerald-600 text-white text-[13px] font-semibold hover:bg-emerald-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors">
                  {ninLoading ? 'Verifying NIN…' : 'Verify NIN →'}
                </button>
              </div>

            ) : step === 'bvn' ? (
              <div className="space-y-4">
                <div className="flex items-center gap-2 bg-emerald-50 border border-emerald-100 rounded-xl p-3">
                  <span className="text-emerald-600 font-bold">✓</span>
                  <p className="text-[12px] text-emerald-700 font-semibold">NIN verified: {status?.ninMasked}</p>
                </div>
                <div>
                  <p className="text-[15px] font-bold text-gray-900 mb-1">Step 2: BVN Verification</p>
                  <p className="text-[12px] text-gray-400">Enter your 11-digit Bank Verification Number</p>
                </div>
                <div className="bg-blue-50 border border-blue-100 rounded-xl p-3">
                  <p className="text-[12px] text-blue-700">🔒 Your BVN is encrypted and cross-matched with your NIN to confirm your identity.</p>
                </div>
                <div>
                  <label className="block text-[12px] font-semibold text-gray-500 mb-1.5">Bank Verification Number (BVN)</label>
                  <input
                    value={bvn}
                    onChange={e => { setBvn(e.target.value.replace(/\D/g, '')); setError('') }}
                    maxLength={11}
                    placeholder="Enter your 11-digit BVN"
                    className="w-full h-11 px-4 border border-gray-200 rounded-xl text-[14px] font-mono tracking-widest text-gray-900 outline-none focus:border-emerald-400 transition-all bg-white"
                  />
                  <p className="text-[11px] text-gray-400 mt-1">{bvn.length}/11 digits entered</p>
                </div>
                {error && <div className="bg-red-50 border border-red-100 rounded-xl px-4 py-3"><p className="text-[12px] text-red-600">{error}</p></div>}
                <button onClick={handleBvnSubmit} disabled={bvnLoading || bvn.length !== 11}
                  className="w-full h-11 rounded-xl bg-emerald-600 text-white text-[13px] font-semibold hover:bg-emerald-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors">
                  {bvnLoading ? 'Verifying BVN…' : 'Verify BVN →'}
                </button>
              </div>

            ) : step === 'face' ? (
              <div className="space-y-4">
                <div className="flex items-center gap-2 bg-emerald-50 border border-emerald-100 rounded-xl p-3">
                  <span className="text-emerald-600 font-bold">✓</span>
                  <p className="text-[12px] text-emerald-700 font-semibold">NIN & BVN verified</p>
                </div>
                <div>
                  <p className="text-[15px] font-bold text-gray-900 mb-1">Step 3: Face Liveness Scan</p>
                  <p className="text-[12px] text-gray-400">Center your face in good lighting and capture a clear selfie. We'll verify it's really you.</p>
                </div>

                {faceLoading ? (
                  <div className="text-center py-8 space-y-3">
                    <div className="w-8 h-8 border-2 border-gray-300 border-t-gray-700 rounded-full animate-spin mx-auto"/>
                    <p className="text-[13px] text-gray-500">Uploading your face scan…</p>
                  </div>
                ) : showLiveness ? (
                  <LivenessCapture
                    onCapture={handleLivenessCapture}
                    onCancel={() => { setShowLiveness(false) }}
                    uploadingLabel="Uploading your face scan…"
                  />
                ) : (
                  <button onClick={() => setShowLiveness(true)}
                    className="w-full h-11 rounded-xl bg-emerald-600 text-white text-[13px] font-semibold hover:bg-emerald-700 transition-colors">
                    Start Face Scan →
                  </button>
                )}
              </div>
            ) : null}
          </div>
        </div>
      </div>
    </DashboardLayout>
  )
}