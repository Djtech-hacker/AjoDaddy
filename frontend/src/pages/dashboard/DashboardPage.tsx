import { Link } from 'react-router-dom'
import { BarChart, Bar, XAxis, Tooltip, ResponsiveContainer } from 'recharts'
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
function greeting() {
  const h = new Date().getHours()
  return h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening'
}

const STATUS_CLS: Record<string, string> = {
  PAID: 'bg-emerald-100 text-emerald-700',
  OVERDUE: 'bg-red-100 text-red-600',
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

  const KPI = [
    { label: 'Wallet Balance',    value: fmt(walletBalance), sub: `Available ${fmt(availBalance)}`, dark: true },
    { label: 'Total Contributed', value: fmt(totalContrib),  sub: `${txCount} transaction${txCount === 1 ? '' : 's'}` },
    { label: 'Active Groups',     value: String(activeGroups), sub: 'Savings circles' },
    { label: 'Streak',            value: `${streak} Weeks`,  sub: 'Keep it going' },
  ]

  return (
    <DashboardLayout title="Dashboard" subtitle={dayjs().format('dddd, MMMM D')}>
      <div className="p-4 sm:p-6 space-y-4 max-w-6xl mx-auto">

        {/* Hero */}
        <div className="rounded-2xl bg-brand px-5 sm:px-7 py-6 flex items-center justify-between gap-4 flex-wrap">
          <div className="min-w-0">
            <h2 className="text-[20px] sm:text-[24px] font-bold text-white tracking-tight">{greeting()}, {user?.firstName} 👋</h2>
            <p className="text-[12px] text-white/60 mt-1">Here's your savings overview for today.</p>
          </div>
          <Link to="/groups" className="h-9 px-4 rounded-lg bg-lime text-black text-[12px] font-bold inline-flex items-center hover:opacity-90 transition-opacity">
            New Savings Group
          </Link>
        </div>

        {/* Pending alert */}
        {!isLoading && pendingCount > 0 && (
          <div className="rounded-xl bg-amber-50 border border-amber-200 px-4 py-3 flex items-center justify-between gap-3 flex-wrap">
            <p className="text-[13px] text-amber-900 font-medium">
              ⚠ {pendingCount} pending contribution{pendingCount > 1 ? 's' : ''} — Due: {fmt(pendingAmount)}
            </p>
            <Link to={payNowHref} className="h-8 px-4 rounded-lg bg-brand text-white text-[12px] font-semibold inline-flex items-center hover:opacity-90">Pay now →</Link>
          </div>
        )}

        {/* KPIs */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          {isLoading
            ? [...Array(4)].map((_, i) => <Skeleton key={i} className="h-24 rounded-xl" />)
            : KPI.map(k => (
              <div key={k.label} className={`rounded-xl p-4 border ${k.dark ? 'bg-brand border-brand text-white' : 'bg-white border-gray-100 text-gray-900'}`}>
                <p className={`text-[11px] font-medium ${k.dark ? 'text-white/60' : 'text-gray-400'}`}>{k.label}</p>
                <p className="text-[22px] font-extrabold tracking-tight mt-1 tabular-nums">{k.value}</p>
                <p className={`text-[11px] mt-1 ${k.dark ? 'text-white/50' : 'text-gray-400'}`}>{k.sub}</p>
              </div>
            ))}
        </div>

        <div className="grid lg:grid-cols-3 gap-4">
          <div className="lg:col-span-2 space-y-4">
            {/* Trend */}
            <div className="bg-white rounded-xl border border-gray-100 p-4 sm:p-5">
              <p className="text-[14px] font-bold text-gray-900 mb-4">Contribution Trend (8 Weeks)</p>
              {trendData && (trendData as any[]).length > 0 ? (
                <ResponsiveContainer width="100%" height={180}>
                  <BarChart data={trendData as any[]}>
                    <XAxis dataKey="week" tick={{ fontSize: 10, fill: '#9CA3AF' }} axisLine={false} tickLine={false} tickFormatter={v => dayjs(v).format('MMM D')} />
                    <Tooltip cursor={{ fill: '#F3F4F6' }} formatter={(v: any) => [`₦${Number(v).toLocaleString()}`, 'Total']} labelFormatter={l => dayjs(l).format('MMM D, YYYY')} />
                    <Bar dataKey="total" fill="#1B5C3C" radius={[3, 3, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              ) : (
                <div className="h-40 flex items-center justify-center text-[13px] text-gray-400">No contribution data yet</div>
              )}
            </div>

            {/* Recent contributions */}
            <div className="bg-white rounded-xl border border-gray-100 overflow-hidden">
              <div className="px-4 sm:px-5 py-4 flex items-center justify-between">
                <p className="text-[14px] font-bold text-gray-900">Recent Contributions</p>
                <Link to="/groups" className="text-[12px] font-semibold text-brand">View all</Link>
              </div>
              <div className="px-3 pb-3 space-y-2">
                {isLoading ? <Skeleton className="h-14 rounded-lg" />
                  : !summary?.recentContributions?.length ? <p className="py-8 text-center text-[13px] text-gray-400">No contributions yet — join a group to start saving</p>
                  : summary.recentContributions.map((c: Contribution) => (
                    <div key={c.id} className="flex items-center justify-between gap-3 bg-warm rounded-lg px-3 py-2.5">
                      <div className="min-w-0">
                        <p className="text-[13px] font-semibold text-gray-900 truncate">{c.group?.name || 'Group'}</p>
                        <p className="text-[11px] text-gray-400">Cycle {c.cycleNumber} · {c.paidAt ? dayjs(c.paidAt).format('MMM D') : `Due ${dayjs(c.dueDate).format('MMM D')}`}</p>
                      </div>
                      <div className="flex items-center gap-2 flex-shrink-0">
                        <p className="text-[13px] font-bold tabular-nums">₦{c.amount.toLocaleString()}</p>
                        <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${STATUS_CLS[c.status] || 'bg-amber-100 text-amber-700'}`}>
                          {c.status.charAt(0) + c.status.slice(1).toLowerCase()}
                        </span>
                      </div>
                    </div>
                  ))}
              </div>
            </div>
          </div>

          <div className="space-y-4">
            {/* Reputation */}
            <div className="bg-white rounded-xl border border-gray-100 p-4 sm:p-5">
              <p className="text-[11px] font-semibold text-gray-400">REPUTATION SCORE</p>
              <p className="text-[30px] font-extrabold text-gray-900 mt-1 tabular-nums">{reputation}<span className="text-[13px] font-medium text-gray-400"> /100</span></p>
              <div className="h-1.5 bg-gray-100 rounded-full overflow-hidden mt-2">
                <div className="h-full bg-brand rounded-full" style={{ width: `${Math.min(reputation, 100)}%` }} />
              </div>
              <p className="text-[11px] text-gray-400 mt-2">{streak} week streak</p>
            </div>

            {/* Payout turns */}
            <div className="bg-black rounded-xl p-4 sm:p-5">
              <p className="text-[11px] font-bold text-lime">YOUR PAYOUT TURNS</p>
              <div className="mt-3 space-y-2">
                {!summary?.upcomingPayouts?.length
                  ? <p className="text-[12px] text-white/40 py-3">No payouts scheduled yet.</p>
                  : summary.upcomingPayouts.map((p: Payout) => (
                    <div key={p.id} className="bg-white/[0.07] rounded-lg p-3">
                      <p className="text-[10px] text-white/40">{p.group?.name}</p>
                      <div className="flex items-end justify-between mt-1">
                        <p className="text-[18px] font-bold text-white tabular-nums">₦{p.amount.toLocaleString()}</p>
                        <p className="text-[10px] text-white/40">Turn: {dayjs(p.scheduledDate).format('MMM D, YYYY')}</p>
                      </div>
                    </div>
                  ))}
              </div>
            </div>

            {/* Insights */}
            <div className="bg-white rounded-xl border border-gray-100 p-4 sm:p-5">
              <p className="text-[14px] font-bold text-gray-900 mb-2">Smart Insights</p>
              {!insights || (insights as Insight[]).length === 0
                ? <p className="text-[12px] text-gray-400">Keep contributing to unlock tips.</p>
                : (insights as Insight[]).map((ins, i) => (
                  <p key={i} className="text-[12px] text-gray-500 leading-relaxed py-1.5 flex gap-2"><span>{ins.icon}</span><span>{ins.message}</span></p>
                ))}
            </div>
          </div>
        </div>
      </div>
    </DashboardLayout>
  )
}