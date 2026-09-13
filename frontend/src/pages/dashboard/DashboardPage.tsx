import { Link } from 'react-router-dom'
import { motion } from 'framer-motion'
import { AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from 'recharts'
import DashboardLayout from '@/components/layout/DashboardLayout'
import { Skeleton } from '@/components/ui'
import { useDashboardSummary, useInsights, useTrend } from '@/hooks/useApi'
import { useAuthStore } from '@/stores/authStore'
import dayjs from 'dayjs'
import type { Contribution, Payout, Insight } from '@/types'

const EASE = [0.16, 1, 0.3, 1] as const
const fadeUp = (delay = 0) => ({
  initial: { opacity: 0, y: 12 },
  animate: { opacity: 1, y: 0 },
  transition: { delay, duration: 0.4, ease: EASE },
})

function fmt(n: number) {
  if (n >= 1_000_000) return `₦${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000)     return `₦${Math.floor(n / 1_000)}K`
  return `₦${n.toLocaleString()}`
}

function greeting() {
  const h = new Date().getHours()
  if (h < 12) return 'Good morning'
  if (h < 17) return 'Good afternoon'
  return 'Good evening'
}

const CustomTooltip = ({ active, payload, label }: any) => {
  if (!active || !payload?.length) return null
  return (
    <div className="bg-white border border-gray-100 rounded-xl shadow-lg px-4 py-3">
      <p className="text-[11px] text-gray-400 mb-1">{dayjs(label).format('MMM D, YYYY')}</p>
      <p className="text-[15px] font-bold text-gray-900">₦{Number(payload[0].value).toLocaleString()}</p>
    </div>
  )
}

export default function DashboardPage() {
  const { user }                     = useAuthStore()
  const { data: summary, isLoading } = useDashboardSummary()
  const { data: insights }           = useInsights()
  const { data: trendData }          = useTrend({ weeks: 8 })

  const walletBalance   = summary?.wallet?.balance ?? 0
  const availBalance    = summary?.wallet?.availableBalance ?? 0
  const totalContrib    = summary?.totals?.totalTransacted ?? 0
  const txCount         = summary?.totals?.transactionCount ?? 0
  const activeGroups    = summary?.groups?.length ?? 0
  const streak          = summary?.gamification?.currentStreak ?? 0
  const longestStreak   = summary?.gamification?.longestStreak ?? 0
  const reputation      = summary?.gamification?.reputationScore ?? 0
  const badgeCount      = summary?.gamification?.badgeCount ?? 0
  const pendingCount    = summary?.pendingContributions?.length ?? 0
  const pendingAmount   = summary?.pendingContributions?.reduce((s: number, c: any) => s + c.amount, 0) ?? 0

  const initials = `${user?.firstName?.[0] || ''}${user?.lastName?.[0] || ''}`

  const payNowHref = (() => {
    const pending = summary?.pendingContributions
    if (!pending?.length) return '/groups'
    if (pending.length === 1) {
      const g = pending[0].group; const path = g?.slug ?? g?.id
      return path ? `/groups/${path}` : '/groups'
    }
    return '/groups'
  })()

  const KPI = [
    {
      label: 'Wallet Balance',
      value: fmt(walletBalance),
      sub: `Available ${fmt(availBalance)}`,
      grad: 'from-emerald-500 to-emerald-600',
      iconBg: 'bg-emerald-50',
      iconColor: 'text-emerald-600',
      icon: (
        <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M3 10h18M7 15h1m4 0h1m-7 4h12a3 3 0 003-3V8a3 3 0 00-3-3H6a3 3 0 00-3 3v8a3 3 0 003 3z"/>
        </svg>
      ),
    },
    {
      label: 'Total Contributed',
      value: fmt(totalContrib),
      sub: `${txCount} transaction${txCount === 1 ? '' : 's'}`,
      grad: 'from-blue-500 to-blue-600',
      iconBg: 'bg-blue-50',
      iconColor: 'text-blue-600',
      icon: (
        <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10"/>
        </svg>
      ),
    },
    {
      label: 'Active Groups',
      value: String(activeGroups),
      sub: 'Savings circles',
      grad: 'from-violet-500 to-violet-600',
      iconBg: 'bg-violet-50',
      iconColor: 'text-violet-600',
      icon: (
        <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z"/>
        </svg>
      ),
    },
    {
      label: 'Streak',
      value: `${streak}w`,
      sub: `Best ${longestStreak}w`,
      grad: 'from-amber-500 to-orange-500',
      iconBg: 'bg-orange-50',
      iconColor: 'text-orange-500',
      icon: (
        <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M17.657 18.657A8 8 0 016.343 7.343S7 9 9 10c0-2 .5-5 2.986-7C14 5 16.09 5.777 17.656 7.343A7.975 7.975 0 0120 13a7.975 7.975 0 01-2.343 5.657z"/>
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9.879 16.121A3 3 0 1012.015 11L11 14H9c0 .768.293 1.536.879 2.121z"/>
        </svg>
      ),
    },
  ]

  return (
    <DashboardLayout title="Dashboard" subtitle={dayjs().format('dddd, MMMM D')}>
      <div className="p-4 sm:p-6 space-y-5 max-w-7xl mx-auto">

        {/* ── Hero greeting card ── */}
        <motion.div {...fadeUp(0)}
          className="relative overflow-hidden rounded-3xl bg-gradient-to-br from-gray-900 via-gray-900 to-emerald-900 px-5 sm:px-7 py-6 sm:py-7">
          <div className="absolute -top-10 -right-10 w-40 h-40 bg-emerald-400/10 rounded-full blur-3xl" />
          <div className="relative flex items-center gap-4">
            <div className="w-12 h-12 sm:w-14 sm:h-14 rounded-2xl bg-white/10 backdrop-blur flex items-center justify-center text-white font-bold text-[15px] sm:text-[17px] flex-shrink-0 ring-1 ring-white/10">
              {initials || '👋'}
            </div>
            <div className="min-w-0">
              <h2 className="text-[19px] sm:text-[22px] font-bold text-white tracking-tight truncate">
                {greeting()}, {user?.firstName} 👋
              </h2>
              <p className="text-[12px] sm:text-[13px] text-white/50 mt-0.5">Here's your savings overview.</p>
            </div>
          </div>
        </motion.div>

        {/* ── Pending alert ── */}
        {!isLoading && pendingCount > 0 && (
          <motion.div {...fadeUp(0.04)}
            className="bg-white border border-amber-200 rounded-2xl px-4 sm:px-5 py-4 flex items-center justify-between gap-4 flex-wrap">
            <div className="flex items-center gap-3 min-w-0">
              <div className="w-9 h-9 rounded-xl bg-amber-50 flex items-center justify-center flex-shrink-0">
                <svg className="w-4.5 h-4.5 text-amber-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"/>
                </svg>
              </div>
              <div className="min-w-0">
                <p className="text-[13px] font-semibold text-gray-900">{pendingCount} pending contribution{pendingCount > 1 ? 's' : ''}</p>
                <p className="text-[12px] text-gray-400 mt-0.5">Due: {fmt(pendingAmount)}</p>
              </div>
            </div>
            <Link to={payNowHref} className="flex-shrink-0">
              <button className="h-9 px-4 rounded-xl bg-emerald-600 text-white text-[12px] font-semibold hover:bg-emerald-700 transition-colors whitespace-nowrap">
                Pay now →
              </button>
            </Link>
          </motion.div>
        )}

        {/* ── KPI Cards — single col on phones, no more overlap ── */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
          {isLoading
            ? [...Array(4)].map((_, i) => <Skeleton key={i} className="h-[92px] rounded-2xl"/>)
            : KPI.map((k, i) => (
            <motion.div key={k.label} {...fadeUp(i * 0.05)}
              className="relative bg-white rounded-2xl border border-gray-100 px-5 py-4 overflow-hidden hover:shadow-md hover:-translate-y-0.5 transition-all duration-200">
              <div className={`absolute top-0 left-0 right-0 h-1 bg-gradient-to-r ${k.grad}`} />
              <div className="flex items-center gap-3 mb-2">
                <div className={`w-10 h-10 rounded-xl ${k.iconBg} ${k.iconColor} flex items-center justify-center flex-shrink-0`}>
                  {k.icon}
                </div>
                <p className="text-[10.5px] font-bold text-gray-400 tracking-wide uppercase">{k.label}</p>
              </div>
              <p className="text-[24px] font-extrabold text-gray-900 tracking-tight leading-none tabular-nums">{k.value}</p>
              <p className="text-[11.5px] text-gray-400 mt-1.5">{k.sub}</p>
            </motion.div>
          ))}
        </div>

        {/* ── Main 3-col + Right 2-col ── */}
        <div className="grid lg:grid-cols-5 gap-5">

          {/* ── Left 3 cols ── */}
          <div className="lg:col-span-3 space-y-5">

            {/* Chart */}
            <motion.div {...fadeUp(0.15)} className="bg-white rounded-2xl border border-gray-100 p-4 sm:p-5">
              <div className="flex items-start justify-between mb-5 gap-3 flex-wrap">
                <div>
                  <p className="text-[15px] font-bold text-gray-900">Contribution trend</p>
                  <p className="text-[12px] text-gray-400 mt-0.5">Last 8 weeks</p>
                </div>
                <div className="flex items-center gap-2 border border-gray-200 rounded-lg px-3 py-1.5 text-[12px] font-medium text-gray-600 bg-white cursor-pointer hover:bg-gray-50 transition-colors">
                  <svg className="w-3.5 h-3.5 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z"/></svg>
                  8 weeks
                  <svg className="w-3 h-3 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7"/></svg>
                </div>
              </div>
              {trendData && (trendData as any[]).length > 0 ? (
                <ResponsiveContainer width="100%" height={180}>
                  <AreaChart data={trendData as any[]} margin={{ top: 4, right: 4, left: -20, bottom: 0 }}>
                    <defs>
                      <linearGradient id="trendGrad" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%"   stopColor="#22C55E" stopOpacity={0.15}/>
                        <stop offset="100%" stopColor="#22C55E" stopOpacity={0}/>
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" stroke="#F3F4F6" vertical={false}/>
                    <XAxis dataKey="week" tick={{ fontSize: 11, fill: '#9CA3AF' }} axisLine={false} tickLine={false}
                      tickFormatter={v => dayjs(v).format('MMM D')}/>
                    <YAxis tick={{ fontSize: 11, fill: '#9CA3AF' }} axisLine={false} tickLine={false}
                      tickFormatter={v => `₦${Math.floor(v / 1000)}K`}/>
                    <Tooltip content={<CustomTooltip/>} cursor={{ stroke: '#E5E7EB', strokeWidth: 1 }}/>
                    <Area type="monotone" dataKey="total" stroke="#22C55E" strokeWidth={2}
                      fill="url(#trendGrad)" dot={false} activeDot={{ r: 4, fill: '#22C55E', strokeWidth: 0 }}/>
                  </AreaChart>
                </ResponsiveContainer>
              ) : (
                <div className="h-44 flex flex-col items-center justify-center gap-2">
                  {isLoading
                    ? <Skeleton className="w-full h-full rounded-xl"/>
                    : (
                      <>
                        <div className="w-14 h-14 rounded-2xl bg-gray-50 flex items-center justify-center text-2xl">📈</div>
                        <p className="text-[13px] text-gray-400">No contribution data yet</p>
                      </>
                    )}
                </div>
              )}
            </motion.div>

            {/* Recent contributions */}
            <motion.div {...fadeUp(0.2)} className="bg-white rounded-2xl border border-gray-100 overflow-hidden">
              <div className="px-4 sm:px-5 py-4 border-b border-gray-50 flex items-center justify-between">
                <p className="text-[15px] font-bold text-gray-900">Recent contributions</p>
                <Link to="/groups" className="text-[12px] font-semibold text-emerald-600 hover:text-emerald-700 transition-colors">
                  View all
                </Link>
              </div>
              <div className="divide-y divide-gray-50">
                {isLoading ? (
                  <div className="p-4 sm:p-5 space-y-3">{[...Array(3)].map((_, i) => <Skeleton key={i} className="h-14 rounded-xl"/>)}</div>
                ) : !summary?.recentContributions?.length ? (
                  <div className="px-5 py-10 text-center">
                    <div className="w-14 h-14 rounded-2xl bg-gray-50 flex items-center justify-center text-2xl mx-auto mb-3">💳</div>
                    <p className="text-[13px] font-medium text-gray-500">No contributions yet</p>
                    <p className="text-[12px] text-gray-400 mt-1">Join a group to start saving</p>
                  </div>
                ) : summary.recentContributions.map((c: Contribution) => (
                  <div key={c.id} className="flex items-center gap-3 sm:gap-4 px-4 sm:px-5 py-4 hover:bg-gray-50/60 transition-colors">
                    <div className={`w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0 ${
                      c.status === 'PAID' ? 'bg-emerald-50' : c.status === 'OVERDUE' ? 'bg-red-50' : 'bg-amber-50'
                    }`}>
                      {c.status === 'PAID'
                        ? <svg className="w-4 h-4 text-emerald-600" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7"/></svg>
                        : c.status === 'OVERDUE'
                        ? <svg className="w-4 h-4 text-red-500" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"/></svg>
                        : <svg className="w-4 h-4 text-amber-500" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"/></svg>
                      }
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-[13px] font-semibold text-gray-900 truncate">{c.group?.name || 'Group'}</p>
                      <p className="text-[11px] text-gray-400 mt-0.5">
                        Cycle {c.cycleNumber} · {c.paidAt ? dayjs(c.paidAt).format('MMM D') : `Due ${dayjs(c.dueDate).format('MMM D')}`}
                      </p>
                    </div>
                    <div className="text-right flex-shrink-0">
                      <p className="text-[13px] sm:text-[14px] font-bold text-gray-900 tabular-nums">₦{c.amount.toLocaleString()}</p>
                      <span className={`text-[10px] font-bold mt-0.5 inline-block px-2 py-0.5 rounded-full ${
                        c.status === 'PAID'    ? 'bg-emerald-50 text-emerald-600' :
                        c.status === 'OVERDUE' ? 'bg-red-50 text-red-500' :
                                                  'bg-amber-50 text-amber-600'
                      }`}>{c.status.charAt(0) + c.status.slice(1).toLowerCase()}</span>
                    </div>
                  </div>
                ))}
              </div>
            </motion.div>
          </div>

          {/* ── Right 2 cols ── */}
          <div className="lg:col-span-2 space-y-5">

            {/* Upcoming payouts */}
            <motion.div {...fadeUp(0.17)} className="bg-white rounded-2xl border border-gray-100 overflow-hidden">
              <div className="px-4 sm:px-5 py-4 border-b border-gray-50">
                <p className="text-[15px] font-bold text-gray-900">Upcoming payouts</p>
              </div>
              <div className="p-4 sm:p-5">
                {isLoading ? (
                  <div className="space-y-3">{[...Array(2)].map((_, i) => <Skeleton key={i} className="h-20 rounded-xl"/>)}</div>
                ) : !summary?.upcomingPayouts?.length ? (
                  <div className="py-8 text-center">
                    <div className="w-14 h-14 rounded-2xl bg-gray-50 flex items-center justify-center text-2xl mx-auto mb-3">💰</div>
                    <p className="text-[13px] font-semibold text-gray-700">No payouts scheduled</p>
                    <p className="text-[12px] text-gray-400 mt-1">Payouts appear here when it's your turn.</p>
                  </div>
                ) : summary.upcomingPayouts.map((p: Payout) => (
                  <div key={p.id} className="bg-gradient-to-br from-gray-900 to-gray-800 rounded-2xl p-4 mb-3 last:mb-0">
                    <p className="text-[10px] font-semibold text-white/40 uppercase tracking-widest mb-2">{p.group?.name}</p>
                    <p className="text-[22px] sm:text-[24px] font-bold text-white tracking-tight tabular-nums">₦{p.amount.toLocaleString()}</p>
                    <div className="flex items-center justify-between mt-3">
                      <p className="text-[11px] text-white/40">{dayjs(p.scheduledDate).format('MMM D, YYYY')}</p>
                      <span className="text-[10px] font-semibold bg-white/10 text-white/70 px-2 py-0.5 rounded-full">
                        {p.status.toLowerCase()}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            </motion.div>

            {/* Reputation */}
            <motion.div {...fadeUp(0.21)} className="bg-white rounded-2xl border border-gray-100 p-4 sm:p-5">
              <div className="flex items-center justify-between mb-4">
                <p className="text-[15px] font-bold text-gray-900">Reputation</p>
                <span className="text-[12px] text-gray-400">{badgeCount} badge{badgeCount !== 1 ? 's' : ''}</span>
              </div>
              {isLoading ? <Skeleton className="h-20 rounded-xl"/> : (
                <>
                  <div className="flex items-end gap-2 mb-3">
                    <p className="text-[34px] sm:text-[36px] font-bold text-gray-900 tracking-tight leading-none tabular-nums">{reputation}</p>
                    <p className="text-[14px] text-gray-400 mb-1">/100</p>
                  </div>
                  <div className="h-2 bg-gray-100 rounded-full overflow-hidden mb-3">
                    <motion.div className="h-full rounded-full bg-gradient-to-r from-emerald-400 to-emerald-600"
                      initial={{ width: 0 }}
                      animate={{ width: `${reputation}%` }}
                      transition={{ duration: 1.2, ease: EASE, delay: 0.3 }}/>
                  </div>
                  <p className="text-[12px] text-gray-400">{streak} week streak</p>
                </>
              )}
            </motion.div>

            {/* Smart insights */}
            <motion.div {...fadeUp(0.25)} className="bg-white rounded-2xl border border-gray-100 overflow-hidden">
              <div className="px-4 sm:px-5 py-4 border-b border-gray-50">
                <p className="text-[15px] font-bold text-gray-900">Smart insights</p>
              </div>
              <div className="divide-y divide-gray-50">
                {!insights || (insights as Insight[]).length === 0 ? (
                  <div className="px-5 py-8 text-center">
                    <div className="w-14 h-14 rounded-2xl bg-gray-50 flex items-center justify-center text-2xl mx-auto mb-3">💡</div>
                    <p className="text-[13px] font-medium text-gray-500">No insights yet</p>
                    <p className="text-[12px] text-gray-400 mt-1">Keep contributing to unlock tips</p>
                  </div>
                ) : (insights as Insight[]).map((ins, i) => (
                  <div key={i} className="flex items-center gap-3 sm:gap-4 px-4 sm:px-5 py-4 hover:bg-gray-50/60 cursor-pointer transition-colors group">
                    <div className={`w-10 h-10 rounded-xl flex items-center justify-center text-xl flex-shrink-0 ${
                      ins.type === 'positive' ? 'bg-emerald-50' :
                      ins.type === 'warning'  ? 'bg-amber-50' : 'bg-blue-50'
                    }`}>
                      {ins.icon}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-[13px] font-semibold text-gray-900 truncate">{ins.title}</p>
                      <p className="text-[11px] text-gray-400 mt-0.5 leading-relaxed line-clamp-2">{ins.message}</p>
                    </div>
                    <svg className="w-4 h-4 text-gray-300 group-hover:text-gray-500 transition-colors flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7"/>
                    </svg>
                  </div>
                ))}
              </div>
            </motion.div>
          </div>
        </div>
      </div>
    </DashboardLayout>
  )
}