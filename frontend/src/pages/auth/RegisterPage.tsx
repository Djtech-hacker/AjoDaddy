import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { motion, AnimatePresence } from 'framer-motion'
import { useRegister } from '@/hooks/useApi'
import { Button, Input, Select } from '@/components/ui'

const step1Schema = z.object({
  firstName: z.string().min(2, 'Min 2 characters'),
  lastName:  z.string().min(2, 'Min 2 characters'),
  username:  z.string().min(3, 'Min 3 characters').regex(/^[a-zA-Z0-9_]+$/, 'Letters, numbers, underscores only'),
  email:     z.string().email('Enter a valid email'),
  phone:     z.string().optional(),
  password:  z.string().min(8, 'Min 8 characters')
    .regex(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)/, 'Must contain uppercase, lowercase & number'),
  confirmPassword: z.string(),
  referralCode: z.string().optional(),
}).refine(d => d.password === d.confirmPassword, {
  message: 'Passwords do not match',
  path: ['confirmPassword'],
})

type Step1Data = z.infer<typeof step1Schema>

export default function RegisterPage() {
  const navigate  = useNavigate()
  const register  = useRegister()
  const [step, setStep] = useState<1 | 2 | 'done'>(1)
  const [step1Data, setStep1Data] = useState<Step1Data | null>(null)

  const { register: reg1, handleSubmit: hs1, formState: { errors: e1 } } = useForm<Step1Data>({
    resolver: zodResolver(step1Schema),
  })

  const onStep1 = (data: Step1Data) => {
    setStep1Data(data)
    setStep(2)
  }

  const onSubmit = async () => {
    // FIX: guard against double-submission. Fast double-clicks (or any
    // re-render that fires onClick twice) could send two identical
    // /auth/register requests before `register.isPending` had a chance
    // to disable the button. The FIRST request would succeed (user
    // created, verification email sent), then the SECOND request hit
    // the DB's unique constraint and came back with a 409 "Email
    // already registered" — and since that promise resolved (rejected)
    // last, its toast is what the user actually saw, even though the
    // account was created successfully. Bailing out here if a request
    // is already in flight makes this impossible.
    if (!step1Data || register.isPending) return
    try {
      await register.mutateAsync({
        firstName:   step1Data.firstName,
        lastName:    step1Data.lastName,
        username:    step1Data.username,
        email:       step1Data.email,
        password:    step1Data.password,
        referralCode: step1Data.referralCode,
      })
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

  return (
    <div className="min-h-screen bg-warm flex items-center justify-center px-6 py-12">
      <motion.div className="w-full max-w-[440px]"
        initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5, ease: [0.16, 1, 0.3, 1] }}
      >
        <Link to="/" className="inline-flex items-center gap-2.5 mb-8">
          <div className="w-8 h-8 bg-brand rounded-lg flex items-center justify-center">
            <svg width="15" height="15" viewBox="0 0 16 16" fill="none">
              <path d="M8 2C8 2 3 5 3 9C3 11.76 5.24 14 8 14C10.76 14 13 11.76 13 9C13 5 8 2 8 2Z" fill="#A8E03A"/>
              <circle cx="8" cy="9" r="2" fill="#1B5C3C"/>
            </svg>
          </div>
          <span className="text-[15px] font-bold tracking-tight text-ink">PayPaddy</span>
        </Link>

        {/* Step indicator */}
        <div className="flex items-center gap-3 mb-8">
          {[1, 2].map(s => (
            <div key={s} className="flex items-center gap-2">
              <div className={`w-7 h-7 rounded-full flex items-center justify-center text-[11px] font-bold transition-all duration-300
                ${step > s ? 'bg-brand text-lime' : step === s ? 'bg-ink text-warm' : 'bg-sand text-mist border border-stone'}`}>
                {step > s
                  ? <svg width="10" height="10" viewBox="0 0 10 10" fill="none"><path d="M2 5L4.5 7.5L8 3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/></svg>
                  : s}
              </div>
              <span className={`text-[11px] font-semibold ${step === s ? 'text-ink' : 'text-mist'}`}>
                {s === 1 ? 'Account' : 'Review'}
              </span>
              {s < 2 && <div className={`w-10 h-px mx-1 ${step > s ? 'bg-brand' : 'bg-stone'}`} />}
            </div>
          ))}
        </div>

        <h1 className="text-[26px] font-extrabold tracking-tight text-ink mb-1.5">
          {step === 1 ? 'Create your account' : 'Confirm & create'}
        </h1>
        <p className="text-[13px] text-dim mb-6">
          {step === 1 ? 'Join thousands saving smarter.' : 'Review your details before submitting.'}
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
              <Input label="Phone (optional)" type="tel" placeholder="+234 803 456 7890" {...reg1('phone')} />
              <Input label="Password" type="password" placeholder="Min 8 chars, upper + lower + number"
                error={e1.password?.message} {...reg1('password')} />
              <Input label="Confirm password" type="password" placeholder="Repeat password"
                error={e1.confirmPassword?.message} {...reg1('confirmPassword')} />
              <Input label="Referral code (optional)" placeholder="Friend's referral code" {...reg1('referralCode')} />
              <Button type="submit" fullWidth className="mt-2">Continue →</Button>
            </motion.form>
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
                  ['Phone',    step1Data.phone || '—'],
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
                  onClick={() => setStep(1)}
                  disabled={register.isPending}
                  className="flex-1"
                >
                  ← Back
                </Button>
                {/*
                  FIX: added `disabled={register.isPending}` on top of the
                  existing `loading` prop. `loading` alone may only swap
                  visuals (spinner) without actually disabling the
                  underlying <button> element depending on how the Button
                  component is implemented — `disabled` guarantees the
                  browser itself blocks further click events while the
                  request is in flight, which is the real fix for the
                  double-submission bug (see onSubmit's guard above for
                  the second layer of protection).
                */}
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
