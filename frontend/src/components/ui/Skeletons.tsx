import { motion } from 'framer-motion'
import { ReactNode } from 'react'

// ── Base shimmer ──────────────────────────────────────────────
function Shimmer({ className = '', style = {} }: { className?: string; style?: React.CSSProperties }) {
  return (
    <div className={`relative overflow-hidden rounded-lg bg-white/[0.04] ${className}`} style={style}>
      <motion.div
        className="absolute inset-0"
        style={{
          background: 'linear-gradient(90deg, transparent 0%, rgba(255,255,255,0.04) 50%, transparent 100%)',
        }}
        animate={{ x: ['-100%', '100%'] }}
        transition={{ duration: 2, repeat: Infinity, ease: 'linear', repeatDelay: 0.5 }}
      />
    </div>
  )
}

// Light variant for white backgrounds
function ShimmerLight({ className = '', style = {} }: { className?: string; style?: React.CSSProperties }) {
  return (
    <div className={`relative overflow-hidden rounded-lg bg-black/[0.04] ${className}`} style={style}>
      <motion.div
        className="absolute inset-0"
        style={{
          background: 'linear-gradient(90deg, transparent 0%, rgba(0,0,0,0.03) 50%, transparent 100%)',
        }}
        animate={{ x: ['-100%', '100%'] }}
        transition={{ duration: 2, repeat: Infinity, ease: 'linear', repeatDelay: 0.5 }}
      />
    </div>
  )
}

// ── Stagger wrapper ───────────────────────────────────────────
function SkeletonGroup({ children, className = '' }: { children: ReactNode; className?: string }) {
  return (
    <motion.div
      className={className}
      initial="hidden"
      animate="visible"
      variants={{
        hidden:  {},
        visible: { transition: { staggerChildren: 0.06 } },
      }}
    >
      {children}
    </motion.div>
  )
}

function SkeletonItem({ children }: { children: ReactNode }) {
  return (
    <motion.div
      variants={{
        hidden:  { opacity: 0, y: 6 },
        visible: { opacity: 1, y: 0, transition: { duration: 0.4, ease: [0.16, 1, 0.3, 1] } },
      }}
    >
      {children}
    </motion.div>
  )
}

// ── Dashboard balance card ────────────────────────────────────
export function BalanceCardSkeleton() {
  return (
    <div className="bg-[#0B1510] rounded-2xl p-6 overflow-hidden relative">
      <div className="absolute top-0 right-0 w-40 h-40 rounded-full opacity-10"
        style={{ background: 'radial-gradient(circle, #1B5C3C, transparent)' }} />
      <Shimmer className="w-24 h-2.5 mb-4 rounded-full" />
      <Shimmer className="w-40 h-10 mb-2 rounded-xl" />
      <Shimmer className="w-32 h-2 mb-6 rounded-full" />
      <div className="flex gap-3">
        <Shimmer className="w-28 h-9 rounded-xl" />
        <Shimmer className="w-24 h-9 rounded-xl" />
      </div>
    </div>
  )
}

// ── Stat card ─────────────────────────────────────────────────
export function StatCardSkeleton() {
  return (
    <div className="bg-white rounded-2xl border border-black/[0.06] p-5">
      <ShimmerLight className="w-20 h-2 mb-3 rounded-full" />
      <ShimmerLight className="w-28 h-7 mb-1 rounded-lg" />
      <ShimmerLight className="w-16 h-2 rounded-full" />
    </div>
  )
}

// ── Dashboard overview skeleton ───────────────────────────────
export function DashboardSkeleton() {
  return (
    <SkeletonGroup className="space-y-5">
      <SkeletonItem>
        <BalanceCardSkeleton />
      </SkeletonItem>

      {/* Stats row */}
      <SkeletonItem>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {[...Array(4)].map((_, i) => <StatCardSkeleton key={i} />)}
        </div>
      </SkeletonItem>

      {/* Pending banner */}
      <SkeletonItem>
        <div className="bg-white rounded-2xl border border-black/[0.06] p-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <ShimmerLight className="w-8 h-8 rounded-full" />
            <div>
              <ShimmerLight className="w-40 h-3 mb-2 rounded-full" />
              <ShimmerLight className="w-24 h-2 rounded-full" />
            </div>
          </div>
          <ShimmerLight className="w-20 h-7 rounded-lg" />
        </div>
      </SkeletonItem>

      {/* Charts row */}
      <SkeletonItem>
        <div className="grid md:grid-cols-2 gap-5">
          <div className="bg-white rounded-2xl border border-black/[0.06] p-5">
            <ShimmerLight className="w-32 h-3 mb-1 rounded-full" />
            <ShimmerLight className="w-20 h-2 mb-6 rounded-full" />
            <div className="flex items-end gap-2 h-32">
              {[40, 65, 45, 80, 55, 90, 70, 50].map((h, i) => (
                <ShimmerLight key={i} className="flex-1 rounded-t-md" style={{ height: `${h}%` }} />
              ))}
            </div>
          </div>
          <div className="bg-white rounded-2xl border border-black/[0.06] p-5 space-y-3">
            <ShimmerLight className="w-28 h-3 mb-4 rounded-full" />
            {[...Array(4)].map((_, i) => (
              <div key={i} className="flex items-center gap-3">
                <ShimmerLight className="w-8 h-8 rounded-full flex-shrink-0" />
                <div className="flex-1">
                  <ShimmerLight className="w-24 h-2.5 mb-1.5 rounded-full" />
                  <ShimmerLight className="w-16 h-2 rounded-full" />
                </div>
                <ShimmerLight className="w-14 h-2.5 rounded-full" />
              </div>
            ))}
          </div>
        </div>
      </SkeletonItem>
    </SkeletonGroup>
  )
}

// ── Group card ────────────────────────────────────────────────
export function GroupCardSkeleton() {
  return (
    <div className="bg-white rounded-2xl border border-black/[0.06] p-5">
      <div className="flex items-center gap-3 mb-4">
        <ShimmerLight className="w-11 h-11 rounded-xl flex-shrink-0" />
        <div className="flex-1">
          <ShimmerLight className="w-32 h-3 mb-2 rounded-full" />
          <ShimmerLight className="w-20 h-2 rounded-full" />
        </div>
        <ShimmerLight className="w-16 h-6 rounded-full" />
      </div>
      <div className="grid grid-cols-3 gap-3 mb-4">
        {[...Array(3)].map((_, i) => (
          <div key={i} className="bg-black/[0.03] rounded-xl p-2.5">
            <ShimmerLight className="w-12 h-2 mb-1.5 rounded-full" />
            <ShimmerLight className="w-16 h-4 rounded-md" />
          </div>
        ))}
      </div>
      <ShimmerLight className="w-full h-1.5 rounded-full" />
    </div>
  )
}

// ── Groups list skeleton ──────────────────────────────────────
export function GroupsListSkeleton({ count = 6 }: { count?: number }) {
  return (
    <SkeletonGroup className="grid md:grid-cols-2 lg:grid-cols-3 gap-4">
      {[...Array(count)].map((_, i) => (
        <SkeletonItem key={i}>
          <GroupCardSkeleton />
        </SkeletonItem>
      ))}
    </SkeletonGroup>
  )
}

// ── Transaction row ───────────────────────────────────────────
export function TransactionRowSkeleton() {
  return (
    <div className="flex items-center gap-4 py-3.5 border-b border-black/[0.04] last:border-0">
      <ShimmerLight className="w-9 h-9 rounded-xl flex-shrink-0" />
      <div className="flex-1">
        <ShimmerLight className="w-28 h-2.5 mb-1.5 rounded-full" />
        <ShimmerLight className="w-40 h-2 rounded-full" />
      </div>
      <div className="text-right">
        <ShimmerLight className="w-16 h-2.5 mb-1.5 rounded-full ml-auto" />
        <ShimmerLight className="w-12 h-4 rounded-full ml-auto" />
      </div>
    </div>
  )
}

// ── Transaction list skeleton ─────────────────────────────────
export function TransactionListSkeleton({ count = 8 }: { count?: number }) {
  return (
    <SkeletonGroup className="bg-white rounded-2xl border border-black/[0.06] overflow-hidden">
      <SkeletonItem>
        <div className="px-5 py-4 border-b border-black/[0.05] flex items-center justify-between">
          <ShimmerLight className="w-36 h-3 rounded-full" />
          <ShimmerLight className="w-24 h-8 rounded-lg" />
        </div>
      </SkeletonItem>
      <div className="px-5 py-2">
        {[...Array(count)].map((_, i) => (
          <SkeletonItem key={i}>
            <TransactionRowSkeleton />
          </SkeletonItem>
        ))}
      </div>
    </SkeletonGroup>
  )
}

// ── Analytics chart skeleton ──────────────────────────────────
export function AnalyticsSkeleton() {
  return (
    <SkeletonGroup className="space-y-4">
      <SkeletonItem>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {[...Array(4)].map((_, i) => (
            <div key={i} className="bg-white rounded-2xl border border-black/[0.06] p-5">
              <ShimmerLight className="w-24 h-2 mb-3 rounded-full" />
              <ShimmerLight className="w-20 h-7 rounded-lg" />
            </div>
          ))}
        </div>
      </SkeletonItem>
      <SkeletonItem>
        <div className="bg-white rounded-2xl border border-black/[0.06] p-5">
          <ShimmerLight className="w-36 h-3 mb-6 rounded-full" />
          <div className="flex items-end gap-3 h-44">
            {[55, 70, 45, 85, 60, 90, 75, 50, 65, 80].map((h, i) => (
              <ShimmerLight key={i} className="flex-1 rounded-t-lg" style={{ height: `${h}%` }} />
            ))}
          </div>
        </div>
      </SkeletonItem>
    </SkeletonGroup>
  )
}

// ── Chat skeleton ─────────────────────────────────────────────
export function ChatSkeleton() {
  const pattern = [false, false, true, false, true, true, false]
  return (
    <SkeletonGroup className="p-4 space-y-4">
      {pattern.map((isMe, i) => (
        <SkeletonItem key={i}>
          <div className={`flex items-end gap-2 ${isMe ? 'flex-row-reverse' : ''}`}>
            {!isMe && <ShimmerLight className="w-7 h-7 rounded-full flex-shrink-0" />}
            <div className={`flex flex-col gap-1 max-w-[60%] ${isMe ? 'items-end' : 'items-start'}`}>
              {!isMe && <ShimmerLight className="w-16 h-2 rounded-full" />}
              <ShimmerLight
                className="rounded-2xl"
                style={{
                  width:  `${100 + (i % 3) * 40}px`,
                  height: `${32 + (i % 2) * 12}px`,
                }}
              />
            </div>
          </div>
        </SkeletonItem>
      ))}
    </SkeletonGroup>
  )
}

// ── Notification item skeleton ────────────────────────────────
export function NotificationSkeleton({ count = 5 }: { count?: number }) {
  return (
    <SkeletonGroup className="space-y-1">
      {[...Array(count)].map((_, i) => (
        <SkeletonItem key={i}>
          <div className="flex items-start gap-3 p-3 rounded-xl">
            <ShimmerLight className="w-8 h-8 rounded-full flex-shrink-0 mt-0.5" />
            <div className="flex-1">
              <ShimmerLight className="w-36 h-2.5 mb-2 rounded-full" />
              <ShimmerLight className={`h-2 rounded-full mb-1 ${i % 2 === 0 ? 'w-full' : 'w-3/4'}`} />
              <ShimmerLight className="w-20 h-1.5 rounded-full mt-2" />
            </div>
          </div>
        </SkeletonItem>
      ))}
    </SkeletonGroup>
  )
}

// ── Member row skeleton ───────────────────────────────────────
export function MemberRowSkeleton({ count = 5 }: { count?: number }) {
  return (
    <SkeletonGroup>
      {[...Array(count)].map((_, i) => (
        <SkeletonItem key={i}>
          <div className="flex items-center gap-3 px-5 py-4 border-b border-black/[0.04] last:border-0">
            <ShimmerLight className="w-9 h-9 rounded-full flex-shrink-0" />
            <div className="flex-1">
              <ShimmerLight className="w-28 h-2.5 mb-1.5 rounded-full" />
              <ShimmerLight className="w-20 h-2 rounded-full" />
            </div>
            <ShimmerLight className="w-14 h-5 rounded-full" />
            <ShimmerLight className="w-8 h-2 rounded-full" />
            <ShimmerLight className="w-16 h-2.5 rounded-full" />
          </div>
        </SkeletonItem>
      ))}
    </SkeletonGroup>
  )
}

// ── Group detail hero skeleton ────────────────────────────────
export function GroupHeroSkeleton() {
  return (
    <div className="bg-[#0B1510] rounded-2xl p-6 relative overflow-hidden">
      <div className="absolute top-0 right-0 w-48 h-48 rounded-full opacity-10"
        style={{ background: 'radial-gradient(circle, #1B5C3C, transparent)' }} />
      <div className="flex items-start justify-between flex-wrap gap-4">
        <div>
          <div className="flex items-center gap-3 mb-4">
            <Shimmer className="w-12 h-12 rounded-xl" />
            <div>
              <Shimmer className="w-36 h-4 mb-2 rounded-lg" />
              <Shimmer className="w-24 h-2.5 rounded-full" />
            </div>
          </div>
          <div className="flex gap-3">
            {[...Array(3)].map((_, i) => (
              <Shimmer key={i} className="w-24 h-14 rounded-xl" />
            ))}
          </div>
        </div>
        <div className="flex gap-2">
          <Shimmer className="w-28 h-9 rounded-xl" />
          <Shimmer className="w-24 h-9 rounded-xl" />
        </div>
      </div>
      <div className="mt-5">
        <div className="flex justify-between mb-2">
          <Shimmer className="w-24 h-2 rounded-full" />
          <Shimmer className="w-16 h-2 rounded-full" />
        </div>
        <Shimmer className="w-full h-1.5 rounded-full" />
      </div>
    </div>
  )
}