import { useEffect, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { useMaintenanceStore } from '@/stores/maintenanceStore'

function formatCountdown(ms: number) {
  if (ms <= 0) return 'starting now'
  const totalMinutes = Math.floor(ms / 60000)
  const hours = Math.floor(totalMinutes / 60)
  const minutes = totalMinutes % 60
  if (hours > 0) return `${hours}h ${minutes}m`
  return `${minutes}m`
}

export function MaintenanceBanner() {
  const { scheduledAt, announcement } = useMaintenanceStore()
  const [dismissed, setDismissed] = useState(false)
  const [now, setNow] = useState(Date.now())

  useEffect(() => {
    const tick = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(tick)
  }, [])

  // Reset dismissal if a new schedule comes in (different timestamp)
  useEffect(() => { setDismissed(false) }, [scheduledAt])

  if (!scheduledAt || dismissed) return null

  const target = new Date(scheduledAt).getTime()
  const remaining = target - now

  // Once it's clearly passed, the backend cron + poll will flip
  // isMaintenanceMode shortly — stop showing a stale countdown banner.
  if (remaining < -60000) return null

  return (
    <AnimatePresence>
      <motion.div
        initial={{ y: -48, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        exit={{ y: -48, opacity: 0 }}
        transition={{ duration: 0.2 }}
        className="fixed top-0 left-0 right-0 z-[9998] bg-ink text-warm px-4 py-2.5 flex items-center justify-center gap-3 text-[12px] font-medium"
      >
        <span className="w-1.5 h-1.5 rounded-full bg-[#22C55E] animate-pulse flex-shrink-0" />
        <span className="truncate">
          {announcement || 'Scheduled maintenance'} — starting in{' '}
          <strong className="font-bold">{formatCountdown(remaining)}</strong>
        </span>
        <button
          onClick={() => setDismissed(true)}
          aria-label="Dismiss"
          className="text-warm/50 hover:text-warm transition-colors flex-shrink-0 ml-2"
        >
          ✕
        </button>
      </motion.div>
    </AnimatePresence>
  )
}