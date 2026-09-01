import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { motion } from 'framer-motion'
import { authApi } from '@/api/services'
import { Button, Input } from '@/components/ui'

const LOGO_URL = 'https://res.cloudinary.com/dmjakrnby/image/upload/v1785357030/real_logo_s3jtjp.png'

const schema = z.object({
  email: z.string().email('Enter a valid email'),
})

type FormData = z.infer<typeof schema>

export default function ForgotPassword() {
  const [done, setDone] = useState(false)

  const { register, handleSubmit, formState: { errors, isSubmitting }, setError } = useForm<FormData>({
    resolver: zodResolver(schema),
  })

  const onSubmit = async (data: FormData) => {
    try {
      await authApi.forgotPassword(data.email)
      setDone(true)
    } catch (err: any) {
      setError('root', { message: err.response?.data?.message || 'Something went wrong' })
    }
  }

  return (
    <div className="min-h-screen bg-warm flex items-center justify-center px-6">
      <motion.div className="w-full max-w-sm"
        initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4, ease: [0.16, 1, 0.3, 1] }}
      >
        <Link to="/" className="inline-flex items-center mb-10">
          <img src={LOGO_URL} alt="PayPaddy" className="h-48" />
        </Link>

        {done ? (
          <div className="text-center">
            <div className="w-14 h-14 bg-brand-pale rounded-full flex items-center justify-center mx-auto mb-4 ring-8 ring-brand-pale/40">
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none">
                <path d="M3 8L10.5 13.5C11.4 14.17 12.6 14.17 13.5 13.5L21 8M5 19H19C20.1 19 21 18.1 21 17V7C21 5.9 20.1 5 19 5H5C3.9 5 3 5.9 3 7V17C3 18.1 3.9 19 5 19Z" stroke="#1B5C3C" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
            </div>
            <h2 className="text-[22px] font-extrabold text-ink mb-2">Check your email</h2>
            <p className="text-dim text-[13px]">We've sent a password reset link if an account exists for that email.</p>
            <Link to="/login" className="inline-block mt-6 text-[13px] font-semibold text-brand hover:underline">
              Back to login
            </Link>
          </div>
        ) : (
          <>
            <h1 className="text-[28px] font-extrabold tracking-tight text-ink mb-1.5">Forgot password?</h1>
            <p className="text-[13px] text-dim mb-7">Enter your email and we'll send you a reset link.</p>

            {(errors as any).root && (
              <div className="bg-red-50 border border-red-100 text-red-600 text-[13px] font-medium px-4 py-3 rounded-xl mb-4">
                {(errors as any).root.message}
              </div>
            )}

            <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
              <Input label="Email" type="email" placeholder="you@example.com"
                error={errors.email?.message} {...register('email')} />
              <Button type="submit" fullWidth loading={isSubmitting}>Send reset link</Button>
            </form>

            <p className="text-center text-[13px] text-dim mt-6">
              Remember your password?{' '}
              <Link to="/login" className="font-semibold text-brand hover:underline">Sign in</Link>
            </p>
          </>
        )}
      </motion.div>
    </div>
  )
}