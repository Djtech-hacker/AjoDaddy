import { Link } from 'react-router-dom'
import { motion } from 'framer-motion'
import { BarChart, Bar, XAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts'
import DashboardLayout from '@/components/layout/DashboardLayout'
import { Skeleton } from '@/components/ui'
import { useDashboardSummary, useInsights, useTrend } from '@/hooks/useApi'
import { useAuthStore } from '@/stores/authStore'
import dayjs from 'dayjs'
import type { Contribution, Payout, Insight } from '@/types'

function fmt(n: number) {
  if (n >= 1_000_000) return `₦${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000)     return `₦${Math.floor(n / 1_000)}K`
  return `₦${n.toLocaleString()}`
}
function naira(n: number) {
  return n.toLocaleString('en-NG', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}
function greeting() {
  const h = new Date().getHours()
  return h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening'
}

const STATUS: Record<string, { dot: string; text: string }> = {
  PAID:    { dot: 'bg-emerald-500', text: 'text-emerald-700' },
  OVERDUE: { dot: 'bg-red-500',     text: 'text-red-600' },
}

// ── Ribbon of fine lines (static curves, gently drifting) ─────
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
@keyframes dash-bob { from { transform: translateY(-5px) } to { transform: translateY(5px) } }
@keyframes dash-sweep { from { transform: translateX(-120%) } to { transform: translateX(420%) } }
.dash-bob   { animation: dash-bob 14s ease-in-out infinite alternate; will-change: transform }
.dash-sweep { animation: dash-sweep 10s linear infinite; will-change: transform }
@media (prefers-reduced-motion: reduce) { .dash-bob, .dash-sweep { animation: none } }
`

const rise = (i: number) => ({
  initial: { opacity: 0, y: 10 },
  animate: { opacity: 1, y: 0 },
  transition: { delay: 0.04 + i * 0.06, duration: 0.45, ease: [0.16, 1, 0.3, 1] as [number, number, number, number] },
})

const CARD  = 'bg-white rounded-xl border border-black/[0.07]'
const LABEL = 'text-[10px] font-semibold tracking-[0.12em] uppercase text-mist'

function Ring({ value }: { value: number }) {
  const r = 17, c = 2 * Math.PI * r
  return (
    <svg width="44" height="44" viewBox="0 0 44 44" className="flex-shrink-0">
      <circle cx="22" cy="22" r={r} fill="none" stroke="#EDE9E1" strokeWidth="3.5" />
      <motion.circle cx="22" cy="22" r={r} fill="none" stroke="#1B5C3C" strokeWidth="3.5" strokeLinecap="round"
        strokeDasharray={c} transform="rotate(-90 22 22)"
        initial={{ strokeDashoffset: c }} animate={{ strokeDashoffset: c * (1 - Math.min(value, 100) / 100) }}
        transition={{ delay: 0.5, duration: 1, ease: [0.16, 1, 0.3, 1] }} />
    </svg>
  )
}

export default function DashboardPage() {
  const { user }                     = useAuthStore()
  const { data: summary, isLoading } = useDashboardSummary()
  const { data: insights }           = useInsights()
  const { data: trendData }          = useTrend({ weeks: 8 })

  const walletBalance = summary?.wallet?.balance ?? 0
  const availBalance  = summary?.wallet?.availableBalance ?? 0
  const totalContrib  = summary?.totals?.totalTransacted ?? 0
  const txCount       = summary?.totals?.transactionCount ?? 0
  const activeGroups  = summary?.groups?.length ?? 0
  const streak        = summary?.gamification?.currentStreak ?? 0
  const reputation    = summary?.gamification?.reputationScore ?? 0
  const pendingCount  = summary?.pendingContributions?.length ?? 0
  const pendingAmount = summary?.pendingContributions?.reduce((s: number, c: any) => s + c.amount, 0) ?? 0

  const payNowHref = (() => {
    const pending = summary?.pendingContributions
    if (pending?.length === 1) { const g = pending[0].group; const p = g?.slug ?? g?.id; return p ? `/groups/${p}` : '/groups' }
    return '/groups'
  })()

  const metrics = [
    { label: 'Total contributed', value: fmt(totalContrib), unit: '', sub: `${txCount} transaction${txCount === 1 ? '' : 's'}` },
    { label: 'Active groups',     value: String(activeGroups), unit: '', sub: 'Savings circles' },
    { label: 'Streak',            value: `${streak}`, unit: streak === 1 ? 'week' : 'weeks', sub: 'Consecutive on-time weeks' },
  ]

  const hasTrend = trendData && (trendData as any[]).length > 0
  const ghost = [28, 42, 36, 58, 46, 70, 54, 78]

  return (
    <DashboardLayout title="Overview" subtitle={dayjs().format('dddd, MMMM D')}>
      <style>{css}</style>
      <div className="p-4 sm:p-6 space-y-4 max-w-6xl mx-auto">

        {/* Balance panel */}
        <motion.section {...rise(0)}
          className="relative overflow-hidden rounded-xl border border-white/[0.07] px-6 sm:px-8 py-7 sm:py-8"
          style={{ background: 'linear-gradient(120deg, #060D0A 0%, #0B1F18 60%, #123D2A 100%)' }}>
          {/* fine dot grid */}
          <div className="absolute inset-0 pointer-events-none opacity-60"
            style={{ backgroundImage: 'radial-gradient(rgba(255,255,255,0.07) 1px, transparent 1px)', backgroundSize: '22px 22px' }} />
          {/* ribbon */}
          <svg viewBox="0 0 900 260" preserveAspectRatio="none" aria-hidden
            className="dash-bob absolute inset-y-0 right-0 w-[72%] h-full pointer-events-none"
            style={{ maskImage: 'linear-gradient(90deg, transparent 0%, #000 45%)', WebkitMaskImage: 'linear-gradient(90deg, transparent 0%, #000 45%)' }}>
            {RIBBON.map((p, i) => (
              <path key={i} d={p.d} fill="none" vectorEffect="non-scaling-stroke" strokeWidth="1"
                stroke={`rgba(${Math.round(46 + 122 * p.mix * p.mix)},${Math.round(150 + 74 * p.mix * p.mix)},${Math.round(90 - 32 * p.mix * p.mix)},${0.12 + 0.5 * p.mix})`} />
            ))}
            <circle r="2.6" fill="#E6FF9A"><animateMotion dur="9s" repeatCount="indefinite" path={RIBBON[13].d} /></circle>
          </svg>
          <span aria-hidden className="dash-sweep absolute left-0 top-[34%] h-px w-[30%] pointer-events-none"
            style={{ background: 'linear-gradient(90deg, transparent, rgba(61,220,160,0.55), transparent)' }} />

          <div className="relative z-10 flex flex-col sm:flex-row sm:items-end sm:justify-between gap-6">
            <div className="min-w-0">
              <p className="text-[13px] text-white/50">{greeting()}, {user?.firstName}</p>
              <p className="text-[10px] font-semibold tracking-[0.14em] uppercase text-white/40 mt-5">Wallet balance</p>
              {isLoading
                ? <Skeleton className="h-11 w-52 rounded-md mt-2" />
                : <p className="text-[40px] sm:text-[48px] leading-none font-semibold tracking-tight text-white tabular-nums mt-2">
                    <span className="text-white/45 font-normal mr-1">₦</span>{naira(walletBalance)}
                  </p>}
              <p className="text-[12px] text-white/45 mt-2.5 tabular-nums">Available ₦{naira(availBalance)}</p>
            </div>

            <div className="flex items-center gap-2 flex-wrap">
              <Link to="/wallet" className="h-10 px-5 rounded-lg bg-lime text-ink text-[13px] font-semibold inline-flex items-center hover:bg-lime/90 transition-colors">
                Fund wallet
              </Link>
              <Link to={payNowHref} className="h-10 px-5 rounded-lg border border-white/15 bg-white/[0.04] text-white text-[13px] font-medium inline-flex items-center hover:bg-white/[0.09] transition-colors">
                Contribute
              </Link>
              <Link to="/groups" className="h-10 px-5 rounded-lg border border-white/15 bg-white/[0.04] text-white text-[13px] font-medium inline-flex items-center hover:bg-white/[0.09] transition-colors">
                New group
              </Link>
            </div>
          </div>
        </motion.section>

        {/* Pending alert */}
        {!isLoading && pendingCount > 0 && (
          <motion.div {...rise(1)} className="rounded-lg bg-amber-50 border border-amber-200 px-4 py-2.5 flex items-center justify-between gap-3 flex-wrap">
            <p className="text-[12.5px] text-amber-900 font-medium">
              {pendingCount} pending contribution{pendingCount > 1 ? 's' : ''} due, {fmt(pendingAmount)} in total
            </p>
            <Link to={payNowHref} className="h-8 px-4 rounded-md bg-void text-white text-[12px] font-semibold inline-flex items-center hover:opacity-90">Pay now</Link>
          </motion.div>
        )}

        {/* Metric strip */}
        <motion.section {...rise(2)} className={`${CARD} grid grid-cols-2 lg:grid-cols-4 divide-x divide-black/[0.06]`}>
          {isLoading
            ? [...Array(4)].map((_, i) => <div key={i} className="p-5"><Skeleton className="h-14 rounded-md" /></div>)
            : <>
                {metrics.map((m, i) => (
                  <div key={m.label} className={`p-5 ${i >= 2 ? 'border-t border-black/[0.06] lg:border-t-0' : ''}`}>
                    <p className={LABEL}>{m.label}</p>
                    <p className="text-[26px] font-semibold tracking-tight text-ink tabular-nums mt-2 leading-none">
                      {m.value}{m.unit && <span className="text-[13px] font-medium text-mist ml-1.5">{m.unit}</span>}
                    </p>
                    <p className="text-[11.5px] text-mist mt-2">{m.sub}</p>
                  </div>
                ))}
                <div className="p-5 border-t border-black/[0.06] lg:border-t-0 flex items-start justify-between gap-3">
                  <div>
                    <p className={LABEL}>Reputation</p>
                    <p className="text-[26px] font-semibold tracking-tight text-ink tabular-nums mt-2 leading-none">
                      {reputation}<span className="text-[13px] font-medium text-mist ml-1">/100</span>
                    </p>
                    <p className="text-[11.5px] text-mist mt-2">Based on on-time payments</p>
                  </div>
                  <Ring value={reputation} />
                </div>
              </>}
        </motion.section>

        <div className="grid lg:grid-cols-3 gap-4">
          {/* Trend */}
          <motion.section {...rise(3)} className={`${CARD} lg:col-span-2 p-5`}>
            <div className="flex items-baseline justify-between mb-5">
              <p className="text-[14px] font-semibold text-ink">Contribution trend</p>
              <p className="text-[11px] text-mist">Last 8 weeks</p>
            </div>
            {hasTrend ? (
              <ResponsiveContainer width="100%" height={200}>
                <BarChart data={trendData as any[]} barCategoryGap="28%">
                  <CartesianGrid vertical={false} stroke="#EDE9E1" />
                  <XAxis dataKey="week" tick={{ fontSize: 10, fill: '#9A968E' }} axisLine={false} tickLine={false} tickFormatter={v => dayjs(v).format('MMM D')} />
                  <Tooltip cursor={{ fill: '#F4F1EA' }} formatter={(v: any) => [`₦${Number(v).toLocaleString()}`, 'Total']} labelFormatter={l => dayjs(l).format('MMM D, YYYY')} />
                  <Bar dataKey="total" fill="#1B5C3C" radius={[4, 4, 0, 0]} maxBarSize={30} />
                </BarChart>
              </ResponsiveContainer>
            ) : (
              <div className="relative h-[200px]">
                <div className="absolute inset-0 flex flex-col justify-between pointer-events-none">
                  {[0, 1, 2, 3].map(i => <div key={i} className="border-t border-dashed border-black/[0.07]" />)}
                </div>
                <div className="absolute inset-x-0 bottom-0 top-4 flex items-end gap-3 px-1">
                  {ghost.map((h, i) => <div key={i} className="flex-1 rounded-t bg-sand/80" style={{ height: `${h}%` }} />)}
                </div>
                <div className="absolute inset-0 flex items-center justify-center">
                  <p className="text-[12.5px] text-dim bg-white/90 border border-black/[0.07] rounded-lg px-3.5 py-2">
                    Your contributions will appear here once you start saving
                  </p>
                </div>
              </div>
            )}
          </motion.section>

          {/* Payout turns */}
          <motion.section {...rise(4)} className="relative overflow-hidden bg-void rounded-xl border border-white/[0.07] p-5">
            <div className="absolute -top-20 -right-16 w-[260px] h-[260px] pointer-events-none"
              style={{ background: 'radial-gradient(closest-side, rgba(27,92,60,0.5), transparent)' }} />
            <div className="relative flex items-baseline justify-between mb-4">
              <p className="text-[14px] font-semibold text-white">Your payout turns</p>
              <span className="w-1.5 h-1.5 rounded-full bg-lime" />
            </div>
            <div className="relative space-y-2.5">
              {!summary?.upcomingPayouts?.length ? (
                <div className="py-8 text-center">
                  <div className="w-9 h-9 mx-auto rounded-lg border border-white/10 bg-white/[0.04] flex items-center justify-center text-white/45 mb-3">
                    <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><rect x="1.5" y="3" width="13" height="11" rx="2" stroke="currentColor" strokeWidth="1.3"/><path d="M1.5 6.5h13M5 1.5v3M11 1.5v3" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/></svg>
                  </div>
                  <p className="text-[13px] text-white/70">No payouts scheduled</p>
                  <p className="text-[11.5px] text-white/35 mt-1">Your turns show up once you join a group.</p>
                </div>
              ) : summary.upcomingPayouts.map((p: Payout) => (
                <div key={p.id} className="rounded-lg border border-white/[0.07] bg-white/[0.04] p-3">
                  <p className="text-[10.5px] text-white/40">{p.group?.name}</p>
                  <div className="flex items-end justify-between mt-1.5">
                    <p className="text-[18px] font-semibold text-white tabular-nums">₦{p.amount.toLocaleString()}</p>
                    <p className="text-[10.5px] text-white/40 font-mono">{dayjs(p.scheduledDate).format('MMM D, YYYY')}</p>
                  </div>
                </div>
              ))}
            </div>
          </motion.section>
        </div>

        <div className="grid lg:grid-cols-3 gap-4">
          {/* Recent contributions */}
          <motion.section {...rise(5)} className={`${CARD} lg:col-span-2 overflow-hidden`}>
            <div className="px-5 py-4 flex items-center justify-between border-b border-black/[0.06]">
              <p className="text-[14px] font-semibold text-ink">Recent contributions</p>
              <Link to="/groups" className="text-[12px] font-medium text-brand hover:underline">View all</Link>
            </div>
            {isLoading ? <div className="p-4"><Skeleton className="h-14 rounded-md" /></div>
              : !summary?.recentContributions?.length ? (
                <div className="py-12 text-center">
                  <p className="text-[13px] text-dim">No contributions yet</p>
                  <p className="text-[11.5px] text-mist mt-1">Join a group to make your first one.</p>
                </div>
              ) : (
                <div>
                  <div className="grid grid-cols-[1fr_auto_auto] sm:grid-cols-[1.6fr_0.6fr_0.8fr_auto_auto] gap-x-4 px-5 py-2.5 bg-warm/60">
                    <span className={LABEL}>Group</span>
                    <span className={`${LABEL} hidden sm:block`}>Cycle</span>
                    <span className={`${LABEL} hidden sm:block`}>Date</span>
                    <span className={`${LABEL} text-right`}>Amount</span>
                    <span className={`${LABEL} text-right w-[72px]`}>Status</span>
                  </div>
                  {summary.recentContributions.map((c: Contribution) => {
                    const st = STATUS[c.status] || { dot: 'bg-amber-500', text: 'text-amber-700' }
                    return (
                      <div key={c.id} className="grid grid-cols-[1fr_auto_auto] sm:grid-cols-[1.6fr_0.6fr_0.8fr_auto_auto] gap-x-4 items-center px-5 py-3 border-t border-black/[0.05] hover:bg-warm/50 transition-colors">
                        <p className="text-[13px] font-medium text-ink truncate">{c.group?.name || 'Group'}</p>
                        <p className="hidden sm:block text-[12px] text-dim tabular-nums">#{c.cycleNumber}</p>
                        <p className="hidden sm:block text-[12px] text-dim font-mono">{c.paidAt ? dayjs(c.paidAt).format('MMM D') : `Due ${dayjs(c.dueDate).format('MMM D')}`}</p>
                        <p className="text-[13px] font-semibold text-ink tabular-nums text-right">₦{c.amount.toLocaleString()}</p>
                        <span className={`inline-flex items-center justify-end gap-1.5 text-[11px] font-medium w-[72px] ${st.text}`}>
                          <span className={`w-1.5 h-1.5 rounded-full ${st.dot}`} />
                          {c.status.charAt(0) + c.status.slice(1).toLowerCase()}
                        </span>
                      </div>
                    )
                  })}
                </div>
              )}
          </motion.section>

          {/* Insights */}
          <motion.section {...rise(6)} className={`${CARD} p-5`}>
            <p className="text-[14px] font-semibold text-ink mb-3">Smart insights</p>
            {!insights || (insights as Insight[]).length === 0
              ? <p className="text-[12.5px] text-mist leading-relaxed">Keep contributing to unlock tips tailored to your saving habits.</p>
              : <div className="space-y-2.5">
                  {(insights as Insight[]).map((ins, i) => (
                    <div key={i} className="flex gap-3 rounded-lg bg-warm px-3 py-2.5">
                      <span className="text-[14px] leading-5">{ins.icon}</span>
                      <p className="text-[12px] text-dim leading-relaxed">{ins.message}</p>
                    </div>
                  ))}
                </div>}
          </motion.section>
        </div>
      </div>
    </DashboardLayout>
  )
}