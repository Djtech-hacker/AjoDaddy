import { useState } from 'react'
import { useSearchParams, Link, useNavigate } from 'react-router-dom'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { motion } from 'framer-motion'
import { authApi } from '@/api/services'
import { Button, Input } from '@/components/ui'

const LOGO_URL = 'https://res.cloudinary.com/dmjakrnby/image/upload/v1785357030/real_logo_s3jtjp.png'

const schema = z.object({
  newPassword:     z.string().min(8).regex(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)/, 'Must contain upper, lower & number'),
  confirmPassword: z.string(),
}).refine(d => d.newPassword === d.confirmPassword, { message: 'Passwords do not match', path: ['confirmPassword'] })

type FormData = z.infer<typeof schema>

export default function ResetPassword() {
  const [params]  = useSearchParams()
  const token     = params.get('token') || ''
  const navigate  = useNavigate()
  const [done, setDone] = useState(false)

  const { register, handleSubmit, formState: { errors, isSubmitting }, setError } = useForm<FormData>({
    resolver: zodResolver(schema),
  })

  const onSubmit = async (data: FormData) => {
    try {
      await authApi.resetPassword(token, data.newPassword)
      setDone(true)
      setTimeout(() => navigate('/login'), 3000)
    } catch (err: any) {
      setError('root', { message: err.response?.data?.message || 'Reset failed' })
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
                <path d="M5 12L10 17L19 7" stroke="#1B5C3C" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
            </div>
            <h2 className="text-[22px] font-extrabold text-ink mb-2">Password reset!</h2>
            <p className="text-dim text-[13px]">Redirecting you to login…</p>
          </div>
        ) : (
          <>
            <h1 className="text-[28px] font-extrabold tracking-tight text-ink mb-1.5">Set new password</h1>
            <p className="text-[13px] text-dim mb-7">Choose a strong password for your account.</p>

            {(errors as any).root && (
              <div className="bg-red-50 border border-red-100 text-red-600 text-[13px] font-medium px-4 py-3 rounded-xl mb-4">
                {(errors as any).root.message}
              </div>
            )}

            <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
              <Input label="New password" type="password" placeholder="Min 8 chars"
                error={errors.newPassword?.message} {...register('newPassword')} />
              <Input label="Confirm password" type="password" placeholder="Repeat password"
                error={errors.confirmPassword?.message} {...register('confirmPassword')} />
              <Button type="submit" fullWidth loading={isSubmitting}>Reset password</Button>
            </form>
          </>
        )}
      </motion.div>
    </div>
  )
}