// src/components/auth/AuthPanels.tsx
// Text for the left panel on the login and register pages (no made-up testimonials or numbers).
import type { ReactNode } from 'react'
import { motion } from 'framer-motion'

function Rise({ i, children, className }: { i: number; children: ReactNode; className?: string }) {
  return (
    <motion.div
      className={className}
      initial={{ opacity: 0, y: 18 }} animate={{ opacity: 1, y: 0 }}
      transition={{ delay: 0.2 + i * 0.12, duration: 0.6, ease: [0.16, 1, 0.3, 1] }}
    >
      {children}
    </motion.div>
  )
}

function Panel({ line1, line2, sub, chips }: { line1: string; line2: string; sub: string; chips: string[] }) {
  return (
    <>
      <Rise i={0}>
        <h2 className="text-[40px] xl:text-[48px] font-extrabold tracking-tight leading-[1.1]">
          <span className="block text-white">{line1}</span>
          <span className="block text-lime">{line2}</span>
        </h2>
      </Rise>
      <Rise i={1}>
        <p className="text-[16px] text-white/60 max-w-sm mx-auto mt-5 leading-relaxed">{sub}</p>
      </Rise>
      <Rise i={2} className="mt-10 flex flex-wrap justify-center gap-x-7 gap-y-3">
        {chips.map(c => (
          <span key={c} className="flex items-center gap-2 text-[13px] font-medium text-white/75">
            <span className="w-4 h-4 rounded-full bg-brand flex items-center justify-center">
              <svg width="9" height="9" viewBox="0 0 10 10" fill="none"><path d="M2 5L4.5 7.5L8 3" stroke="#A8E03A" strokeWidth="1.6" strokeLinecap="round"/></svg>
            </span>
            {c}
          </span>
        ))}
      </Rise>
    </>
  )
}

export function LoginPanel() {
  return (
    <Panel
      line1="Save together."
      line2="Grow together."
      sub="Sign in to see your contributions, upcoming payouts and the full record of every group you're in."
      chips={['Payment reminders', 'Receipts for every payment', 'Clear payout schedule']}
    />
  )
}

export function RegisterPanel() {
  return (
    <Panel
      line1="Start your circle."
      line2="Invite your people."
      sub="Create your account and set up your first savings group in minutes. Only join groups with people you know and trust."
      chips={['Verified members', 'Private groups', 'Every naira on record']}
    />
  )
}