// src/lib/ui.tsx
// Shared style tokens so every page looks like the new dashboard.
import type { ReactNode } from 'react'

export const CARD  = 'bg-white rounded-xl border border-black/[0.07]'
export const LABEL = 'text-[10px] font-semibold tracking-[0.12em] uppercase text-mist'

const BTN = 'h-9 px-4 rounded-lg text-[13px] font-medium inline-flex items-center justify-center gap-2 transition-colors disabled:opacity-50 disabled:cursor-not-allowed whitespace-nowrap'
export const BTN_PRIMARY   = `${BTN} bg-void text-white hover:bg-pitch`
export const BTN_SECONDARY = `${BTN} border border-black/[0.1] bg-white text-ink hover:bg-warm`
export const BTN_DANGER    = `${BTN} bg-red-600 text-white hover:bg-red-700`
export const BTN_LIME      = `${BTN} bg-lime text-ink font-semibold hover:bg-lime/90`
export const BTN_ON_DARK   = `${BTN} border border-white/15 bg-white/[0.05] text-white hover:bg-white/[0.1]`
export const BTN_SM        = 'h-7 px-2.5 rounded-md text-[11.5px] font-medium inline-flex items-center transition-colors disabled:opacity-50'

export const FIELD = 'w-full border border-black/[0.1] rounded-lg px-3.5 py-2.5 text-[13px] text-ink bg-white outline-none placeholder:text-mist focus:border-brand focus:ring-2 focus:ring-brand/10 transition-all'

export const rise = (i: number) => ({
  initial: { opacity: 0, y: 10 },
  animate: { opacity: 1, y: 0 },
  transition: { delay: 0.04 + i * 0.06, duration: 0.45, ease: [0.16, 1, 0.3, 1] as [number, number, number, number] },
})

type Tone = 'success' | 'warn' | 'danger' | 'info' | 'neutral'
const TONE: Record<Tone, string> = {
  success: 'text-emerald-700 bg-emerald-50',
  warn:    'text-amber-700 bg-amber-50',
  danger:  'text-red-600 bg-red-50',
  info:    'text-blue-700 bg-blue-50',
  neutral: 'text-dim bg-sand',
}

export function Pill({ tone = 'neutral', children }: { tone?: Tone; children: ReactNode }) {
  return (
    <span className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md text-[11px] font-medium ${TONE[tone]}`}>
      <span className="w-1.5 h-1.5 rounded-full bg-current opacity-70" />
      {children}
    </span>
  )
}

export function Initials({ first, last, size = 36 }: { first?: string; last?: string; size?: number }) {
  const t = ((first?.[0] || '') + (last?.[0] || '')).toUpperCase() || '?'
  return (
    <div className="rounded-lg bg-brand-pale text-brand font-semibold flex items-center justify-center flex-shrink-0"
      style={{ width: size, height: size, fontSize: size * 0.33 }}>{t}</div>
  )
}