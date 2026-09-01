// VerifyEmail.tsx
import { useEffect, useState } from 'react'
import { useSearchParams, Link } from 'react-router-dom'
import { motion } from 'framer-motion'
import { authApi } from '@/api/services'
import { Spinner } from '@/components/ui'

export function VerifyEmail() {
  const [params]  = useSearchParams()
  const token     = params.get('token')
  const [status, setStatus] = useState<'loading' | 'success' | 'error'>('loading')
  const [message, setMessage] = useState('')

  useEffect(() => {
    if (!token) { setStatus('error'); setMessage('No token provided.'); return }
    authApi.verifyEmail(token)
      .then(() => setStatus('success'))
      .catch(err => { setStatus('error'); setMessage(err.response?.data?.message || 'Verification failed') })
  }, [token])

  return (
    <div className="min-h-screen bg-warm flex items-center justify-center px-6">
      <motion.div className="text-center max-w-sm"
        initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4, ease: [0.16, 1, 0.3, 1] }}
      >
        {status === 'loading' && (
          <>
            <Spinner size="lg" />
            <p className="mt-4 text-dim text-[14px]">Verifying your email…</p>
          </>
        )}
        {status === 'success' && (
          <>
            <div className="w-16 h-16 bg-brand-pale rounded-full flex items-center justify-center mx-auto mb-5 ring-8 ring-brand-pale/40">
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none">
                <path d="M5 12L10 17L19 7" stroke="#1B5C3C" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
            </div>
            <h2 className="text-[24px] font-extrabold text-ink mb-2">Email verified!</h2>
            <p className="text-dim text-[14px] mb-6">Your account is now active. Start saving with your community.</p>
            <Link to="/login" className="inline-flex items-center gap-2 bg-ink text-warm font-bold text-[14px] px-6 py-3 rounded-xl hover:bg-pitch transition-all">
              Sign in →
            </Link>
          </>
        )}
        {status === 'error' && (
          <>
            <div className="w-16 h-16 bg-red-50 rounded-full flex items-center justify-center mx-auto mb-5">
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none">
                <path d="M6 6L18 18M18 6L6 18" stroke="#dc2626" strokeWidth="2" strokeLinecap="round"/>
              </svg>
            </div>
            <h2 className="text-[24px] font-extrabold text-ink mb-2">Verification failed</h2>
            <p className="text-dim text-[14px] mb-6">{message || 'This link may have expired. Please request a new one.'}</p>
            <Link to="/login" className="text-brand font-semibold text-[14px] hover:text-brand-mid transition-colors">
              ← Back to login
            </Link>
          </>
        )}
      </motion.div>
    </div>
  )
}

export default VerifyEmail
