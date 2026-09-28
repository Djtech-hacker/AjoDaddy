import { useState } from 'react'
import { Link, useNavigate, useLocation } from 'react-router-dom'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { motion } from 'framer-motion'
import { useLogin } from '@/hooks/useApi'
import { authApi } from '@/api/services'
import { useUIStore } from '@/stores/uiStore'
import { Button, Input } from '@/components/ui'
import AuthShell from '@/components/auth/AuthShell'

const schema = z.object({
  email:    z.string().email('Enter a valid email'),
  password: z.string().min(1, 'Password required'),
})
type FormData = z.infer<typeof schema>

const pinSchema = z.object({
  pin:        z.string().length(4, 'PIN must be 4 digits').regex(/^\d{4}$/, 'Digits only'),
  confirmPin: z.string().length(4, 'PIN must be 4 digits'),
}).refine(d => d.pin === d.confirmPin, { message: 'PINs do not match', path: ['confirmPin'] })
type PinData = z.infer<typeof pinSchema>

function LoginPanel() {
  return (
    <>
      <div>
        <p className="text-[11px] font-bold text-lime tracking-wide">DIGITIZED ROTATIONAL COMMUNES</p>
        <h2 className="text-[38px] font-extrabold tracking-tight leading-[1.1] mt-4 max-w-md">Securing Ajo for millions of households.</h2>
      </div>
      <div className="bg-white/[0.06] border border-white/10 rounded-2xl p-6 max-w-md">
        <p className="text-[13px] text-white/70 leading-relaxed">
          "PayPaddy removed the doubt. Our monthly trade collections happen on autopilot. I got my payout turn exactly at Week 4 with no single participant delay."
        </p>
        <div className="flex items-center gap-3 mt-4">
          <div className="w-8 h-8 rounded-full bg-brand flex items-center justify-center text-lime text-[10px] font-bold">CO</div>
          <div>
            <p className="text-[12px] font-bold text-white/85">Chioma Okafor</p>
            <p className="text-[11px] text-white/40">Entrepreneur, Lagos</p>
          </div>
        </div>
      </div>
      <div className="flex justify-between max-w-md">
        {[['₦4.2B+', 'Transacted'], ['98.6%', 'Success turn'], ['12K+', 'Groups']].map(([v, l]) => (
          <div key={l}>
            <p className="text-[18px] font-extrabold text-lime">{v}</p>
            <p className="text-[10px] text-white/40">{l}</p>
          </div>
        ))}
      </div>
    </>
  )
}

export default function LoginPage() {
  const navigate    = useNavigate()
  const location    = useLocation()
  const from        = (location.state as any)?.from?.pathname || '/dashboard'
  const login       = useLogin()
  const { showToast } = useUIStore()
  const [showPass, setShowPass]         = useState(false)
  const [showPinSetup, setShowPinSetup] = useState(false)
  const [pinLoading, setPinLoading]     = useState(false)

  const { register, handleSubmit, formState: { errors }, setError } = useForm<FormData>({ resolver: zodResolver(schema) })
  const { register: regPin, handleSubmit: hsPIN, formState: { errors: pinErrors } } = useForm<PinData>({ resolver: zodResolver(pinSchema) })

  const onSubmit = async (data: FormData) => {
    try {
      const result: any = await login.mutateAsync(data)
      const user = result?.user || result?.data?.user
      if (user && !user.hasTransactionPin) setShowPinSetup(true)
      else navigate(from, { replace: true })
    } catch (err: any) {
      setError('root', { message: err.response?.data?.message || 'Login failed' })
    }
  }

  const onSetPin = async (data: PinData) => {
    setPinLoading(true)
    try {
      await authApi.setTransactionPin(data.pin)
      showToast('Transaction PIN set successfully! 🎉', 'success')
      navigate(from, { replace: true })
    } catch (err: any) {
      showToast(err?.response?.data?.message || 'Failed to set PIN', 'error')
    } finally {
      setPinLoading(false)
    }
  }

  const skipPin = () => navigate(from, { replace: true })

  if (showPinSetup) {
    return (
      <AuthShell panel={<LoginPanel />}>
        <h1 className="text-[26px] font-extrabold tracking-tight text-ink mb-1.5">Set your transaction PIN</h1>
        <p className="text-[13px] text-dim mb-6">You need a 4-digit PIN for contributions and withdrawals. You can change it later from your wallet.</p>
        <form onSubmit={hsPIN(onSetPin)} className="space-y-4">
          <Input label="4-digit PIN" type="password" maxLength={4} placeholder="••••" error={pinErrors.pin?.message} {...regPin('pin')} />
          <Input label="Confirm PIN" type="password" maxLength={4} placeholder="••••" error={pinErrors.confirmPin?.message} {...regPin('confirmPin')} />
          <Button type="submit" fullWidth loading={pinLoading}>Set PIN & continue</Button>
          <button type="button" onClick={skipPin} className="w-full text-[12px] text-mist hover:text-dim text-center py-2">
            Skip for now (you'll be prompted when paying)
          </button>
        </form>
      </AuthShell>
    )
  }

  return (
    <AuthShell panel={<LoginPanel />}>
      <h1 className="text-[28px] font-extrabold tracking-tight text-ink mb-1.5">Welcome back</h1>
      <p className="text-[13px] text-dim mb-7">Enter your credentials to access your savings circles.</p>

      {errors.root && (
        <motion.div className="bg-red-50 border border-red-100 text-red-600 text-[13px] font-medium px-4 py-3 rounded-xl mb-5"
          initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }}>
          {errors.root.message}
        </motion.div>
      )}

      <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
        <Input label="Email address" type="email" placeholder="e.g. ada@domain.com"
          error={errors.email?.message} autoComplete="email" {...register('email')} />
        <div>
          <label className="text-[12px] font-semibold text-dim block mb-1.5">Password</label>
          <div className="relative">
            <input type={showPass ? 'text' : 'password'} placeholder="••••••••" autoComplete="current-password"
              className={`w-full h-11 border rounded-xl px-4 pr-11 text-[13px] font-medium text-ink bg-white outline-none placeholder:text-mist transition-all ${errors.password ? 'border-red-300' : 'border-black/[0.1] focus:border-brand focus:ring-2 focus:ring-brand/10'}`}
              {...register('password')} />
            <button type="button" onClick={() => setShowPass(v => !v)} className="absolute right-3.5 top-1/2 -translate-y-1/2 text-mist hover:text-dim">
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                <path d="M2 8C2 8 4.5 3.5 8 3.5C11.5 3.5 14 8 14 8C14 8 11.5 12.5 8 12.5C4.5 12.5 2 8 2 8Z" stroke="currentColor" strokeWidth="1.3"/>
                <circle cx="8" cy="8" r="2" stroke="currentColor" strokeWidth="1.3"/>
                {!showPass && <path d="M2 2L14 14" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/>}
              </svg>
            </button>
          </div>
          {errors.password && <p className="mt-1 text-[11px] text-red-500 font-medium">{errors.password.message}</p>}
          <div className="text-right mt-1.5">
            <Link to="/forgot-password" className="text-[11px] font-semibold text-brand">Forgot password?</Link>
          </div>
        </div>
        <Button type="submit" fullWidth loading={login.isPending} className="!bg-brand hover:!opacity-90">Sign in →</Button>
      </form>

      <p className="text-center text-[12px] text-dim mt-6">
        New to PayPaddy? <Link to="/register" className="text-brand font-bold">Create your account free</Link>
      </p>
    </AuthShell>
  )
}