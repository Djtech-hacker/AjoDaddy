// src/components/ui/RibbonPanel.tsx
// Dark panel with fine flowing lines, same as the dashboard balance panel.
import type { ReactNode } from 'react'

function ribbonPaths(lines = 26, w = 900, h = 260) {
  const out: { d: string; mix: number }[] = []
  for (let i = 0; i < lines; i++) {
    const k = i / (lines - 1) - 0.5
    let d = ''
    for (let s = 0; s <= 40; s++) {
      const u = s / 40
      const rise = 1 / (1 + Math.exp(-(u - 0.55) * 7))
      const base = h * (0.82 - 0.55 * rise)
      const spread = h * (0.02 + 0.2 * Math.pow(Math.sin(Math.PI * u), 1.4))
      const y = base + k * spread * 2
      d += `${s === 0 ? 'M' : 'L'}${(u * w).toFixed(1)} ${y.toFixed(1)} `
    }
    out.push({ d, mix: 1 - Math.abs(k) * 2 })
  }
  return out
}
const RIBBON = ribbonPaths()

const css = `
@keyframes rp-bob { from { transform: translateY(-5px) } to { transform: translateY(5px) } }
@keyframes rp-sweep { from { transform: translateX(-120%) } to { transform: translateX(420%) } }
.rp-bob   { animation: rp-bob 14s ease-in-out infinite alternate; will-change: transform }
.rp-sweep { animation: rp-sweep 10s linear infinite; will-change: transform }
@media (prefers-reduced-motion: reduce) { .rp-bob, .rp-sweep { animation: none } }
`

export default function RibbonPanel({ children, className = '' }: { children: ReactNode; className?: string }) {
  return (
    <section className={`relative overflow-hidden rounded-xl border border-white/[0.07] ${className}`}
      style={{ background: 'linear-gradient(120deg, #060D0A 0%, #0B1F18 60%, #123D2A 100%)' }}>
      <style>{css}</style>
      <div className="absolute inset-0 pointer-events-none opacity-60"
        style={{ backgroundImage: 'radial-gradient(rgba(255,255,255,0.07) 1px, transparent 1px)', backgroundSize: '22px 22px' }} />
      <svg viewBox="0 0 900 260" preserveAspectRatio="none" aria-hidden
        className="rp-bob absolute inset-y-0 right-0 w-[72%] h-full pointer-events-none"
        style={{ maskImage: 'linear-gradient(90deg, transparent 0%, #000 45%)', WebkitMaskImage: 'linear-gradient(90deg, transparent 0%, #000 45%)' }}>
        {RIBBON.map((p, i) => (
          <path key={i} d={p.d} fill="none" vectorEffect="non-scaling-stroke" strokeWidth="1"
            stroke={`rgba(${Math.round(46 + 122 * p.mix * p.mix)},${Math.round(150 + 74 * p.mix * p.mix)},${Math.round(90 - 32 * p.mix * p.mix)},${0.12 + 0.5 * p.mix})`} />
        ))}
        <circle r="2.6" fill="#E6FF9A"><animateMotion dur="9s" repeatCount="indefinite" path={RIBBON[13].d} /></circle>
      </svg>
      <span aria-hidden className="rp-sweep absolute left-0 top-[34%] h-px w-[30%] pointer-events-none"
        style={{ background: 'linear-gradient(90deg, transparent, rgba(61,220,160,0.55), transparent)' }} />
      <div className="relative z-10">{children}</div>
    </section>
  )
}  