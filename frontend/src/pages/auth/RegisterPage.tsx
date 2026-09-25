import { useState, useEffect } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { motion, AnimatePresence } from 'framer-motion'
import { useRegister } from '@/hooks/useApi'
import { Button, Input } from '@/components/ui'

const LOGO_URL = 'https://res.cloudinary.com/dmjakrnby/image/upload/v1785357030/real_logo_s3jtjp.png'
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
}).refine(d => d.password === d.confirmPassword, {
  message: 'Passwords do not match',
  path: ['confirmPassword'],
})

type Step1Data = z.infer<typeof step1Schema>

async function apiFetch(path: string, options: RequestInit = {}) {
  const res = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers: { 'Content-Type': 'application/json', ...options.headers },
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(data.message || `Request failed (${res.status})`)
  return data
}

export default function RegisterPage() {
  const navigate  = useNavigate()
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

  const { register: reg1, handleSubmit: hs1, formState: { errors: e1 } } = useForm<Step1Data>({
    resolver: zodResolver(step1Schema),
  })

  const onStep1 = async (data: Step1Data) => {
    setStep1Data(data)
    setOtpError('')
    setOtpSending(true)
    try {
      const res = await apiFetch('/auth/send-phone-otp', {
        method: 'POST',
        body: JSON.stringify({ phone: data.phone }),
      })
      setOtpToken(res.otpToken)
      setStep('otp')
      setResendCooldown(30)
    } catch (err: any) {
      setOtpError(err.message || 'Could not send code. Please try again.')
    } finally {
      setOtpSending(false)
    }
  }

  const onVerifyOtp = async () => {
    if (otpCode.length !== 6) { setOtpError('Enter the 6-digit code'); return }
    setOtpError('')
    setOtpVerifying(true)
    try {
      const res = await apiFetch('/auth/verify-phone-otp', {
        method: 'POST',
        body: JSON.stringify({ otpToken, code: otpCode }),
      })
      setPhoneVerifiedToken(res.phoneVerifiedToken)
      setStep(2)
    } catch (err: any) {
      setOtpError(err.message || 'Incorrect code. Please try again.')
    } finally {
      setOtpVerifying(false)
    }
  }

  const resendOtp = async () => {
    if (!step1Data) return
    setOtpError('')
    setOtpSending(true)
    try {
      const res = await apiFetch('/auth/send-phone-otp', {
        method: 'POST',
        body: JSON.stringify({ phone: step1Data.phone }),
      })
      setOtpToken(res.otpToken)
      setOtpCode('')
      setResendCooldown(30)
    } catch (err: any) {
      setOtpError(err.message || 'Could not resend code.')
    } finally {
      setOtpSending(false)
    }
  }
 
  // Countdown ticker for the resend cooldown
    useEffect(() => {
    if (resendCooldown <= 0) return
    const timer = setTimeout(() => setResendCooldown(c => c - 1), 1000)
    return () => clearTimeout(timer)
  }, [resendCooldown])


  const onSubmit = async () => {
    if (!step1Data || register.isPending) return
    try {
      await register.mutateAsync({
        firstName:   step1Data.firstName,
        lastName:    step1Data.lastName,
        username:    step1Data.username,
        email:       step1Data.email,
        password:    step1Data.password,
        phone:       step1Data.phone,
        phoneVerifiedToken,
      } as any)
      setStep('done')
    } catch (err: any) {
      // error shown via toast from mutation
    }
  }

  if (step === 'done') {
    return (
      <div className="min-h-screen bg-warm flex items-center justify-center px-6">
        <motion.div className="text-center max-w-sm"
          initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }}
          transition={{ duration: 0.4, ease: [0.16, 1, 0.3, 1] }}
        >
          <div className="w-16 h-16 bg-brand-pale rounded-full flex items-center justify-center mx-auto mb-6 ring-8 ring-brand-pale/40">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none">
              <path d="M5 12L10 17L19 7" stroke="#1B5C3C" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
          </div>
          <h2 className="text-[26px] font-extrabold tracking-tight text-ink mb-2">You're in! 🎉</h2>
          <p className="text-[14px] text-dim leading-relaxed mb-8">
            Check your email to verify your account. Once verified you can start saving.
          </p>
          <Link to="/login">
            <Button fullWidth>Go to login →</Button>
          </Link>
        </motion.div>
      </div>
    )
  }

  const stepNum = step === 1 ? 1 : step === 'otp' ? 2 : 3

  return (
    <div className="min-h-screen bg-warm flex items-center justify-center px-6 py-12">
      <motion.div className="w-full max-w-[440px]"
        initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5, ease: [0.16, 1, 0.3, 1] }}
      >
        <Link to="/" className="w-full flex items-center justify-center mb-8">
          <img src={LOGO_URL} alt="PayPaddy" className="h-24" />
        </Link>

        {/* Step indicator */}
        <div className="flex items-center gap-3 mb-8">
          {[1, 2, 3].map(s => (
            <div key={s} className="flex items-center gap-2">
              <div className={`w-7 h-7 rounded-full flex items-center justify-center text-[11px] font-bold transition-all duration-300
                ${stepNum > s ? 'bg-brand text-lime' : stepNum === s ? 'bg-ink text-warm' : 'bg-sand text-mist border border-stone'}`}>
                {stepNum > s
                  ? <svg width="10" height="10" viewBox="0 0 10 10" fill="none"><path d="M2 5L4.5 7.5L8 3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/></svg>
                  : s}
              </div>
              <span className={`text-[11px] font-semibold ${stepNum === s ? 'text-ink' : 'text-mist'}`}>
                {s === 1 ? 'Account' : s === 2 ? 'Verify phone' : 'Review'}
              </span>
              {s < 3 && <div className={`w-8 h-px mx-1 ${stepNum > s ? 'bg-brand' : 'bg-stone'}`} />}
            </div>
          ))}
        </div>

        <h1 className="text-[26px] font-extrabold tracking-tight text-ink mb-1.5">
          {step === 1 ? 'Create your account' : step === 'otp' ? 'Verify your phone' : 'Confirm & create'}
        </h1>
        <p className="text-[13px] text-dim mb-6">
          {step === 1 ? 'Join thousands saving smarter.' : step === 'otp' ? `Enter the code we sent to ${step1Data?.phone}` : 'Review your details before submitting.'}
        </p>

        <AnimatePresence mode="wait">
          {step === 1 && (
            <motion.form key="step1"
              initial={{ opacity: 0, x: 16 }} animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -16 }} transition={{ duration: 0.22 }}
              onSubmit={hs1(onStep1)} className="space-y-3"
            >
              <div className="grid grid-cols-2 gap-3">
                <Input label="First name" placeholder="Adaeze" error={e1.firstName?.message} {...reg1('firstName')} />
                <Input label="Last name"  placeholder="Kalu"   error={e1.lastName?.message}  {...reg1('lastName')} />
              </div>
              <Input label="Username" placeholder="adaeze_k" error={e1.username?.message} {...reg1('username')}
                hint="Letters, numbers and underscores only" />
              <Input label="Email" type="email" placeholder="you@example.com" error={e1.email?.message} {...reg1('email')} />
              <Input label="Phone number" type="tel" placeholder="+234 803 456 7890" error={e1.phone?.message} {...reg1('phone')} />
              <Input label="Password" type="password" placeholder="Min 8 chars, upper + lower + number"
                error={e1.password?.message} {...reg1('password')} />
              <Input label="Confirm password" type="password" placeholder="Repeat password"
                error={e1.confirmPassword?.message} {...reg1('confirmPassword')} />
              {otpError && <p className="text-[12px] text-red-500">{otpError}</p>}
              <Button type="submit" fullWidth className="mt-2" loading={otpSending} disabled={otpSending}>
                {otpSending ? 'Sending code…' : 'Continue →'}
              </Button>
            </motion.form>
          )}

          {step === 'otp' && (
            <motion.div key="otp"
              initial={{ opacity: 0, x: 16 }} animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -16 }} transition={{ duration: 0.22 }}
              className="space-y-4"
            >
              <Input
                label="6-digit code"
                placeholder="123456"
                maxLength={6}
                value={otpCode}
                onChange={e => setOtpCode(e.target.value.replace(/\D/g, ''))}
              />
              {otpError && <p className="text-[12px] text-red-500">{otpError}</p>}
              <p className="text-[12px] text-dim">
                Didn't get it?{' '}
                <button type="button" onClick={resendOtp} disabled={otpSending || resendCooldown > 0}
                  className="text-brand font-semibold hover:text-brand-mid disabled:text-mist disabled:cursor-not-allowed">
                  {otpSending ? 'Resending…' : resendCooldown > 0 ? `Resend in ${resendCooldown}s` : 'Resend code'}
                </button>
              </p>
              <div className="flex gap-3">
                <Button variant="secondary" onClick={() => setStep(1)} disabled={otpVerifying} className="flex-1">← Back</Button>
                <Button onClick={onVerifyOtp} loading={otpVerifying} disabled={otpVerifying || otpCode.length !== 6} className="flex-1">
                  Verify →
                </Button>
              </div>
            </motion.div>
          )}

          {step === 2 && step1Data && (
            <motion.div key="step2"
              initial={{ opacity: 0, x: 16 }} animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -16 }} transition={{ duration: 0.22 }}
            >
              <div className="bg-warm rounded-2xl border border-black/[0.06] p-5 space-y-3 mb-5">
                {[
                  ['Name',     `${step1Data.firstName} ${step1Data.lastName}`],
                  ['Username', `@${step1Data.username}`],
                  ['Email',    step1Data.email],
                  ['Phone',    `${step1Data.phone} ✓ verified`],
                ].map(([label, value]) => (
                  <div key={label} className="flex justify-between text-[13px]">
                    <span className="text-dim font-medium">{label}</span>
                    <span className="text-ink font-semibold">{value}</span>
                  </div>
                ))}
              </div>

              <div className="flex gap-3">
                <Button
                  variant="secondary"
                  onClick={() => setStep('otp')}
                  disabled={register.isPending}
                  className="flex-1"
                >
                  ← Back
                </Button>
                <Button
                  onClick={onSubmit}
                  loading={register.isPending}
                  disabled={register.isPending}
                  className="flex-1"
                >
                  Create account
                </Button>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        <p className="text-center text-[13px] text-dim mt-6">
          Already have an account?{' '}
          <Link to="/login" className="text-brand font-bold hover:text-brand-mid transition-colors">Sign in</Link>
        </p>
      </motion.div>
    </div>
  )
}