// src/components/auth/AuthShell.tsx
// Form panel on the left (your original layout), dark animated brand panel on the right.
import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { motion } from 'framer-motion'

export const LOGO_URL = 'https://res.cloudinary.com/dmjakrnby/image/upload/v1785357030/real_logo_s3jtjp.png'

// Plain CSS transforms, so the animation stays smooth.
const css = `
@keyframes auth-sweep   { from { transform: translateX(-120%) } to { transform: translateX(420%) } }
@keyframes auth-drift-a { from { transform: translate3d(-4%,-3%,0) } to { transform: translate3d(7%,6%,0) } }
@keyframes auth-drift-b { from { transform: translate3d(6%,5%,0) }  to { transform: translate3d(-7%,-6%,0) } }
.auth-sweep { animation: auth-sweep 9s linear infinite; will-change: transform }
.auth-orb-a { animation: auth-drift-a 14s ease-in-out infinite alternate; will-change: transform }
.auth-orb-b { animation: auth-drift-b 17s ease-in-out infinite alternate; will-change: transform }
@media (prefers-reduced-motion: reduce) { .auth-sweep, .auth-orb-a, .auth-orb-b { animation: none } }
`

const streaks = [
  { top: '20%', dur: '9s',  delay: '0s' },
  { top: '42%', dur: '12s', delay: '3s' },
  { top: '66%', dur: '10s', delay: '6s' },
  { top: '86%', dur: '14s', delay: '1.5s' },
]

export default function AuthShell({ children, panel }: { children: ReactNode; panel: ReactNode }) {
  return (
    <div className="min-h-screen bg-warm flex">
      <style>{css}</style>

      {/* Form side (unchanged) */}
      <div className="flex-1 flex flex-col px-5 sm:px-12 py-6 min-w-0">
        <Link to="/" className="flex justify-center">
          <img src={LOGO_URL} alt="AjoDaddy" className="h-28 sm:h-36 w-auto object-contain" />
        </Link>
        <div className="flex-1 flex items-center justify-center py-4">
          <motion.div className="w-full max-w-[400px]"
            initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.45, ease: [0.16, 1, 0.3, 1] }}>
            {children}
          </motion.div>
        </div>
        <p className="text-[11px] text-mist text-center">Secured by AjoDaddy Shield · CBN compliant processors</p>
      </div>

      {/* Dark brand panel, now animated */}
      <div
        className="relative hidden lg:flex flex-1 overflow-hidden text-white items-center justify-center"
        style={{ background: 'linear-gradient(160deg, #050B09 0%, #0A1F1A 55%, #10301F 100%)' }}
      >
        <div className="auth-orb-a absolute -top-32 -left-24 w-[520px] h-[520px] pointer-events-none"
          style={{ background: 'radial-gradient(closest-side, rgba(61,220,160,0.16), transparent)' }} />
        <div className="auth-orb-b absolute -bottom-40 -right-24 w-[560px] h-[560px] pointer-events-none"
          style={{ background: 'radial-gradient(closest-side, rgba(168,224,58,0.12), transparent)' }} />

        {streaks.map(s => (
          <span key={s.top} aria-hidden className="auth-sweep absolute left-0 h-px w-[35%] pointer-events-none"
            style={{ top: s.top, animationDuration: s.dur, animationDelay: s.delay,
              background: 'linear-gradient(90deg, transparent, rgba(61,220,160,0.7), transparent)' }} />
        ))}

        <div className="relative z-10 flex flex-col items-center text-center px-14 max-w-xl">
          {panel}
        </div>
      </div>
    </div>
  )
}