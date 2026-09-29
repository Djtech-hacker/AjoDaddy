import { useState, useEffect, useRef } from 'react'
import { Link } from 'react-router-dom'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { motion, AnimatePresence } from 'framer-motion'
import { useRegister } from '@/hooks/useApi'
import { Button, Input } from '@/components/ui'
import AuthShell from '@/components/auth/AuthShell'

const API_BASE = import.meta.env.VITE_API_URL || '/api'

const step1Schema = z.object({
  firstName: z.string().min(2, 'Min 2 characters'),
  lastName:  z.string().min(2, 'Min 2 characters'),
  username:  z.string().min(3, 'Min 3 characters').regex(/^[a-zA-Z0-9_]+$/, 'Letters, numbers, underscores only'),
  email:     z.string().email('Enter a valid email'),
  phone:     z.string().regex(/^\+?\d{10,15}$/, 'Enter a valid phone number'),
  password:  z.string().min(8, 'Min 8 characters')
    .regex(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)/, 'Must contain uppercase, lowercase & number'),
  confirmPassword: z.string(),
}).refine(d => d.password === d.confirmPassword, { message: 'Passwords do not match', path: ['confirmPassword'] })
type Step1Data = z.infer<typeof step1Schema>

async function apiFetch(path: string, options: RequestInit = {}) {
  const res = await fetch(`${API_BASE}${path}`, { ...options, headers: { 'Content-Type': 'application/json', ...options.headers } })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(data.message || `Request failed (${res.status})`)
  return data
}

// Center-crop to a square, shrink to 256px, return a small JPEG data URL
function fileToAvatar(file: File, size = 256): Promise<string> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file)
    const img = new Image()
    img.onload = () => {
      const side = Math.min(img.width, img.height)
      const sx = (img.width - side) / 2
      const sy = (img.height - side) / 2
      const canvas = document.createElement('canvas')
      canvas.width = size; canvas.height = size
      canvas.getContext('2d')!.drawImage(img, sx, sy, side, side, 0, 0, size, size)
      URL.revokeObjectURL(url)
      resolve(canvas.toDataURL('image/jpeg', 0.85))
    }
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('Could not read image')) }
    img.src = url
  })
}

const FEATURES = [
  ['Free forever, no hidden transaction fees', 'Rotational savings cycles run free of management tariffs.'],
  ['Bank-grade identity validation', 'BVN and NIN checks ensure your members are verified.'],
  ['Community peer accountability', 'Smart locks and automated protection keep circles safe.'],
]

function RegisterPanel() {
  return (
    <>
      <div>
        <p className="text-[11px] font-bold text-lime tracking-wide">THE DIGITAL ESUSU REVOLUTION</p>
        <h2 className="text-[38px] font-extrabold tracking-tight leading-[1.1] mt-4 max-w-md">Unlock your collective power.</h2>
      </div>
      <div className="space-y-6 max-w-md">
        {FEATURES.map(([t, d]) => (
          <div key={t} className="flex gap-3">
            <div className="w-5 h-5 rounded-full bg-brand flex items-center justify-center flex-shrink-0 mt-0.5">
              <svg width="10" height="10" viewBox="0 0 10 10" fill="none"><path d="M2 5L4.5 7.5L8 3" stroke="#A8E03A" strokeWidth="1.5" strokeLinecap="round"/></svg>
            </div>
            <div>
              <p className="text-[13px] font-semibold text-white">{t}</p>
              <p className="text-[12px] text-white/45 mt-0.5">{d}</p>
            </div>
          </div>
        ))}
      </div>
      <p className="text-[12px] text-white/40">Join thousands of verified savers across West Africa</p>
    </>
  )
}

export default function RegisterPage() {
  const register  = useRegister()
  const [step, setStep] = useState<1 | 'otp' | 2 | 'done'>(1)
  const [step1Data, setStep1Data] = useState<Step1Data | null>(null)
  const [otpToken, setOtpToken] = useState('')
  const [otpCode, setOtpCode] = useState('')
  const [otpError, setOtpError] = useState('')
  const [otpSending, setOtpSending] = useState(false)
  const [otpVerifying, setOtpVerifying] = useState(false)
  const [phoneVerifiedToken, setPhoneVerifiedToken] = useState('')
  const [resendCooldown, setResendCooldown] = useState(0)

  const [avatar, setAvatar] = useState('')
  const [avatarError, setAvatarError] = useState('')
  const fileRef = useRef<HTMLInputElement>(null)

  const { register: reg1, handleSubmit: hs1, formState: { errors: e1 } } = useForm<Step1Data>({ resolver: zodResolver(step1Schema) })

  const onPickAvatar = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    if (!file.type.startsWith('image/')) { setAvatarError('Please choose an image file'); return }
    if (file.size > 8 * 1024 * 1024) { setAvatarError('Image must be under 8MB'); return }
    try { setAvatar(await fileToAvatar(file)); setAvatarError('') }
    catch { setAvatarError('Could not read that image') }
  }

  const onStep1 = async (data: Step1Data) => {
    if (!avatar) { setAvatarError('Please add a profile picture'); return }
    setStep1Data(data); setOtpError(''); setOtpSending(true)
    try {
      const res = await apiFetch('/auth/send-phone-otp', { method: 'POST', body: JSON.stringify({ phone: data.phone }) })
      setOtpToken(res.otpToken); setStep('otp'); setResendCooldown(30)
    } catch (err: any) { setOtpError(err.message || 'Could not send code. Please try again.') }
    finally { setOtpSending(false) }
  }

  const onVerifyOtp = async () => {
    if (otpCode.length !== 6) { setOtpError('Enter the 6-digit code'); return }
    setOtpError(''); setOtpVerifying(true)
    try {
      const res = await apiFetch('/auth/verify-phone-otp', { method: 'POST', body: JSON.stringify({ otpToken, code: otpCode }) })
      setPhoneVerifiedToken(res.phoneVerifiedToken); setStep(2)
    } catch (err: any) { setOtpError(err.message || 'Incorrect code. Please try again.') }
    finally { setOtpVerifying(false) }
  }

  const resendOtp = async () => {
    if (!step1Data) return
    setOtpError(''); setOtpSending(true)
    try {
      const res = await apiFetch('/auth/send-phone-otp', { method: 'POST', body: JSON.stringify({ phone: step1Data.phone }) })
      setOtpToken(res.otpToken); setOtpCode(''); setResendCooldown(30)
    } catch (err: any) { setOtpError(err.message || 'Could not resend code.') }
    finally { setOtpSending(false) }
  }

  useEffect(() => {
    if (resendCooldown <= 0) return
    const t = setTimeout(() => setResendCooldown(c => c - 1), 1000)
    return () => clearTimeout(t)
  }, [resendCooldown])

  const onSubmit = async () => {
    if (!step1Data || register.isPending) return
    try {
      await register.mutateAsync({
        firstName: step1Data.firstName, lastName: step1Data.lastName, username: step1Data.username,
        email: step1Data.email, password: step1Data.password, phone: step1Data.phone, phoneVerifiedToken,
        avatarUrl: avatar,
      } as any)
      setStep('done')
    } catch { /* toast shown by mutation */ }
  }

  if (step === 'done') {
    return (
      <AuthShell panel={<RegisterPanel />}>
        <h1 className="text-[28px] font-extrabold tracking-tight text-ink mb-2">You're in! 🎉</h1>
        <p className="text-[13px] text-dim leading-relaxed mb-6">Check your email to verify your account. Once verified you can start saving.</p>
        <Link to="/login"><Button fullWidth>Go to login →</Button></Link>
      </AuthShell>
    )
  }

  return (
    <AuthShell panel={<RegisterPanel />}>
      <h1 className="text-[28px] font-extrabold tracking-tight text-ink mb-1.5">
        {step === 1 ? 'Create your account' : step === 'otp' ? 'Verify your phone' : 'Confirm & create'}
      </h1>
      <p className="text-[13px] text-dim mb-6">
        {step === 1 ? 'Join savers creating secure financial communities.' : step === 'otp' ? `Enter the code we sent to ${step1Data?.phone}` : 'Review your details before submitting.'}
      </p>

      <AnimatePresence mode="wait">
        {step === 1 && (
          <motion.form key="s1" initial={{ opacity: 0, x: 16 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -16 }}
            transition={{ duration: 0.22 }} onSubmit={hs1(onStep1)} className="space-y-3" autoComplete="off">

            {/* Profile picture */}
            <div className="flex items-center gap-4 pb-1">
              <button type="button" onClick={() => fileRef.current?.click()}
                className="relative w-20 h-20 rounded-full border-2 border-dashed border-black/[0.15] bg-warm overflow-hidden flex items-center justify-center flex-shrink-0 hover:border-brand transition-colors">
                {avatar
                  ? <img src={avatar} alt="Profile" className="w-full h-full object-cover" />
                  : <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="#9A968E" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"><path d="M23 19a2 2 0 01-2 2H3a2 2 0 01-2-2V8a2 2 0 012-2h4l2-3h6l2 3h4a2 2 0 012 2z"/><circle cx="12" cy="13" r="4"/></svg>}
              </button>
              <div>
                <p className="text-[13px] font-semibold text-ink">Profile picture</p>
                <button type="button" onClick={() => fileRef.current?.click()} className="text-[12px] text-brand font-semibold">
                  {avatar ? 'Change photo' : 'Upload a photo'}
                </button>
                {avatarError && <p className="text-[12px] text-red-500 mt-0.5">{avatarError}</p>}
              </div>
              <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={onPickAvatar} />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <Input label="First name" placeholder="Adaeze" autoComplete="given-name" error={e1.firstName?.message} {...reg1('firstName')} />
              <Input label="Last name" placeholder="Okonkwo" autoComplete="family-name" error={e1.lastName?.message} {...reg1('lastName')} />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <Input label="Username" placeholder="ada_pay" autoComplete="off" error={e1.username?.message} {...reg1('username')} />
              <Input label="Phone number" type="tel" placeholder="+234 812…" autoComplete="tel" error={e1.phone?.message} {...reg1('phone')} />
            </div>
            <Input label="Email address" type="email" placeholder="adaeze@domain.com" autoComplete="email" error={e1.email?.message} {...reg1('email')} />
            <Input label="Choose password" type="password" placeholder="Min 8 chars, upper + lower + number" autoComplete="new-password" error={e1.password?.message} {...reg1('password')} />
            <Input label="Confirm password" type="password" placeholder="Repeat password" autoComplete="new-password" error={e1.confirmPassword?.message} {...reg1('confirmPassword')} />
            {otpError && <p className="text-[12px] text-red-500">{otpError}</p>}
            <Button type="submit" fullWidth className="mt-1" loading={otpSending} disabled={otpSending}>
              {otpSending ? 'Sending code…' : 'Create account →'}
            </Button>
          </motion.form>
        )}

        {step === 'otp' && (
          <motion.div key="otp" initial={{ opacity: 0, x: 16 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -16 }}
            transition={{ duration: 0.22 }} className="space-y-4">
            <Input label="6-digit code" placeholder="123456" maxLength={6} value={otpCode} autoComplete="one-time-code" inputMode="numeric"
              onChange={e => setOtpCode(e.target.value.replace(/\D/g, ''))} />
            {otpError && <p className="text-[12px] text-red-500">{otpError}</p>}
            <p className="text-[12px] text-dim">
              Didn't get it?{' '}
              <button type="button" onClick={resendOtp} disabled={otpSending || resendCooldown > 0}
                className="text-brand font-semibold disabled:text-mist disabled:cursor-not-allowed">
                {otpSending ? 'Resending…' : resendCooldown > 0 ? `Resend in ${resendCooldown}s` : 'Resend code'}
              </button>
            </p>
            <div className="flex gap-3">
              <Button variant="secondary" onClick={() => setStep(1)} disabled={otpVerifying} className="flex-1">← Back</Button>
              <Button onClick={onVerifyOtp} loading={otpVerifying} disabled={otpVerifying || otpCode.length !== 6} className="flex-1">Verify →</Button>
            </div>
          </motion.div>
        )}

        {step === 2 && step1Data && (
          <motion.div key="s2" initial={{ opacity: 0, x: 16 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -16 }} transition={{ duration: 0.22 }}>
            <div className="bg-white rounded-2xl border border-black/[0.06] p-5 space-y-3 mb-5">
              {avatar && (
                <div className="flex justify-center pb-1">
                  <img src={avatar} alt="Profile" className="w-16 h-16 rounded-full object-cover border border-black/[0.06]" />
                </div>
              )}
              {[['Name', `${step1Data.firstName} ${step1Data.lastName}`], ['Username', `@${step1Data.username}`],
                ['Email', step1Data.email], ['Phone', `${step1Data.phone} ✓ verified`]].map(([l, v]) => (
                <div key={l} className="flex justify-between text-[13px]">
                  <span className="text-dim font-medium">{l}</span><span className="text-ink font-semibold">{v}</span>
                </div>
              ))}
            </div>
            <div className="flex gap-3">
              <Button variant="secondary" onClick={() => setStep('otp')} disabled={register.isPending} className="flex-1">← Back</Button>
              <Button onClick={onSubmit} loading={register.isPending} disabled={register.isPending} className="flex-1">Create account</Button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <p className="text-center text-[12px] text-dim mt-6">
        Already have an account? <Link to="/login" className="text-brand font-bold">Sign in</Link>
      </p>
    </AuthShell>
  )
}