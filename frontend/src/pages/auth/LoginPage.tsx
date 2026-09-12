import { useState } from 'react'
import { Link, useNavigate, useLocation } from 'react-router-dom'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { motion } from 'framer-motion'
import { useLogin } from '@/hooks/useApi'
import { useAuthStore } from '@/stores/authStore'
import { authApi } from '@/api/services'
import { useUIStore } from '@/stores/uiStore'
import { Button, Input } from '@/components/ui'

const LOGO_URL = 'https://res.cloudinary.com/dmjakrnby/image/upload/v1785357030/real_logo_s3jtjp.png'

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

export default function LoginPage() {
  const navigate    = useNavigate()
  const location    = useLocation()
  const from        = (location.state as any)?.from?.pathname || '/dashboard'
  const login       = useLogin()
  const { showToast } = useUIStore()
  const [showPass, setShowPass]     = useState(false)
  const [showPinSetup, setShowPinSetup] = useState(false)
  const [pinLoading, setPinLoading] = useState(false)

  const { register, handleSubmit, formState: { errors }, setError } = useForm<FormData>({
    resolver: zodResolver(schema),
  })

  const { register: regPin, handleSubmit: hsPIN, formState: { errors: pinErrors } } = useForm<PinData>({
    resolver: zodResolver(pinSchema),
  })

  const onSubmit = async (data: FormData) => {
    try {
      const result: any = await login.mutateAsync(data)
      const user = result?.user || result?.data?.user
      if (user && !user.hasTransactionPin) {
        setShowPinSetup(true)
      } else {
        navigate(from, { replace: true })
      }
    } catch (err: any) {
      const msg = err.response?.data?.message || 'Login failed'
      setError('root', { message: msg })
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
      <div className="min-h-screen bg-warm flex items-center justify-center px-6">
        <motion.div className="w-full max-w-sm"
          initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4, ease: [0.16, 1, 0.3, 1] }}
        >
          <div className="text-center mb-8">
            <div className="w-16 h-16 bg-brand-pale rounded-full flex items-center justify-center mx-auto mb-4 ring-8 ring-brand-pale/40">
              <span className="text-2xl">🔐</span>
            </div>
            <h2 className="text-[26px] font-extrabold tracking-tight text-ink mb-2">Set your transaction PIN</h2>
            <p className="text-[13px] text-dim leading-relaxed">
              You need a 4-digit PIN to make contributions and withdrawals. You can change it later from your wallet using OTP verification.
            </p>
          </div>

          <form onSubmit={hsPIN(onSetPin)} className="space-y-4">
            <Input label="4-digit PIN" type="password" maxLength={4} placeholder="••••"
              error={pinErrors.pin?.message} {...regPin('pin')} />
            <Input label="Confirm PIN" type="password" maxLength={4} placeholder="••••"
              error={pinErrors.confirmPin?.message} {...regPin('confirmPin')} />

            <div className="bg-amber-50 border border-amber-200 rounded-xl p-3">
              <p className="text-[11px] text-amber-700">
                ⚠️ Keep your PIN safe. You'll need it for every payment. To change it later, go to Wallet → Security → Change PIN (requires OTP).
              </p>
            </div>

            <Button type="submit" fullWidth loading={pinLoading}>Set PIN & continue →</Button>
            <button type="button" onClick={skipPin}
              className="w-full text-[12px] text-mist hover:text-dim transition-colors text-center py-2">
              Skip for now (you'll be prompted when paying)
            </button>
          </form>
        </motion.div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-warm flex flex-col">
      <div className="bg-brand px-4 py-2.5 flex items-center justify-center gap-3 flex-wrap text-center">
        <span className="text-[11px] font-semibold text-white/60">API connected — use your registered credentials</span>
        <span className="text-white/20">|</span>
        <span className="text-[11px] text-lime font-mono">POST /api/auth/login</span>
      </div>

      <div className="flex-1 flex">
        <div className="flex-1 flex items-center justify-center px-6 py-12">
          <motion.div className="w-full max-w-[400px]"
            initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, ease: [0.16, 1, 0.3, 1] }}
          >
            <Link to="/" className="w-full flex items-center justify-center mb-10">
              <img src={LOGO_URL} alt="PayPaddy" className="h-48" />
            </Link>

            <h1 className="text-[30px] font-extrabold tracking-[-0.04em] text-ink mb-1.5">Welcome back</h1>
            <p className="text-[14px] text-dim mb-8">Sign in to your savings circle</p>

            {errors.root && (
              <motion.div className="bg-red-50 border border-red-100 text-red-600 text-[13px] font-medium px-4 py-3 rounded-xl mb-5"
                initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }}>
                {errors.root.message}
              </motion.div>
            )}

            <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
              <Input label="Email address" type="email" placeholder="you@example.com"
                error={errors.email?.message} autoComplete="email" {...register('email')} />

              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <label className="text-[12px] font-semibold text-dim">Password</label>
                  <Link to="/forgot-password" className="text-[11px] font-semibold text-brand hover:text-brand-mid transition-colors">
                    Forgot password?
                  </Link>
                </div>
                <div className="relative">
                  <input type={showPass ? 'text' : 'password'} placeholder="••••••••"
                    autoComplete="current-password"
                    className={`w-full h-11 border rounded-xl px-4 pr-11 text-[13px] font-medium text-ink bg-white outline-none placeholder:text-mist transition-all duration-150 ${errors.password ? 'border-red-300 focus:border-red-400' : 'border-black/[0.1] focus:border-brand focus:ring-2 focus:ring-brand/10'}`}
                    {...register('password')} />
                  <button type="button" onClick={() => setShowPass(v => !v)}
                    className="absolute right-3.5 top-1/2 -translate-y-1/2 text-mist hover:text-dim transition-colors">
                    <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                      <path d="M2 8C2 8 4.5 3.5 8 3.5C11.5 3.5 14 8 14 8C14 8 11.5 12.5 8 12.5C4.5 12.5 2 8 2 8Z" stroke="currentColor" strokeWidth="1.3"/>
                      <circle cx="8" cy="8" r="2" stroke="currentColor" strokeWidth="1.3"/>
                      {!showPass && <path d="M2 2L14 14" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/>}
                    </svg>
                  </button>
                </div>
                {errors.password && <p className="mt-1 text-[11px] text-red-500 font-medium">{errors.password.message}</p>}
              </div>

              <Button type="submit" fullWidth loading={login.isPending} className="mt-2">Sign in →</Button>
            </form>

            <p className="text-center text-[13px] text-dim mt-6">
              No account?{' '}
              <Link to="/register" className="text-brand font-bold hover:text-brand-mid transition-colors">Create one free</Link>
            </p>
          </motion.div>
        </div>

        <div className="hidden lg:flex flex-1 bg-void items-center justify-center p-12 relative overflow-hidden">
          <div className="absolute inset-0 opacity-[0.04]"
            style={{ backgroundImage: 'linear-gradient(rgba(255,255,255,0.5) 1px,transparent 1px),linear-gradient(90deg,rgba(255,255,255,0.5) 1px,transparent 1px)', backgroundSize: '48px 48px' }} />
          <div className="absolute top-1/3 left-1/2 -translate-x-1/2 -translate-y-1/2 w-64 h-64 bg-brand/20 rounded-full blur-[80px]" />
          <motion.div className="relative z-10 max-w-xs"
            initial={{ opacity: 0, x: 24 }} animate={{ opacity: 1, x: 0 }}
            transition={{ delay: 0.2, duration: 0.6, ease: [0.16, 1, 0.3, 1] }}
          >
            {[
              { val: '₦4.2B',  label: 'Saved across all groups' },
              { val: '98.6%',  label: 'Payout success rate' },
              { val: '12,480', label: 'Active savings groups' },
            ].map((s, i) => (
              <motion.div key={s.label} className="mb-8"
                initial={{ opacity: 0, x: 16 }} animate={{ opacity: 1, x: 0 }}
                transition={{ delay: 0.3 + i * 0.1, duration: 0.5 }}
              >
                <p className="text-[36px] font-extrabold text-white tracking-[-0.04em] leading-none">{s.val}</p>
                <p className="text-[11px] text-white/35 font-semibold mt-1 uppercase tracking-wider">{s.label}</p>
              </motion.div>
            ))}
            <div className="border-t border-white/[0.08] pt-6">
              <p className="text-[14px] text-white/40 leading-relaxed italic">
                "The most transparent Ajo platform I've used."
              </p>
              <div className="flex items-center gap-3 mt-4">
                <div className="w-8 h-8 rounded-full bg-brand flex items-center justify-center text-lime text-[10px] font-bold">CO</div>
                <div>
                  <p className="text-[12px] font-bold text-white/70">Chioma Okafor</p>
                  <p className="text-[11px] text-white/30">Entrepreneur, Lagos</p>
                </div>
              </div>
            </div>
          </motion.div>
        </div>
      </div>
    </div>
  )
}