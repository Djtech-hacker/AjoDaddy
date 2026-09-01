import { motion } from 'framer-motion'
import { useMaintenanceStore } from '@/stores/maintenanceStore'

const rings = [0, 1, 2]
const particles = Array.from({ length: 7 })

export function MaintenanceScreen() {
  const { message } = useMaintenanceStore()

  return (
    <div className="fixed inset-0 z-[9999] bg-ink flex items-center justify-center p-6 overflow-hidden">
      {/* Slow floating particles for depth */}
      {particles.map((_, i) => (
        <motion.span
          key={i}
          className="absolute w-1.5 h-1.5 rounded-full bg-[#22C55E]/30"
          style={{ left: `${8 + i * 13}%`, bottom: '-5%' }}
          animate={{ y: ['0vh', '-115vh'], opacity: [0, 0.7, 0] }}
          transition={{
            duration: 9 + i * 1.3,
            repeat: Infinity,
            delay: i * 1.1,
            ease: 'linear',
          }}
        />
      ))}

      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.3 }}
        className="max-w-md w-full text-center relative z-10"
      >
        <div className="relative w-24 h-24 mx-auto mb-6 flex items-center justify-center">
          {rings.map((i) => (
            <motion.span
              key={i}
              className="absolute inset-0 rounded-full border border-[#22C55E]/30"
              animate={{ scale: [1, 1.9], opacity: [0.55, 0] }}
              transition={{
                duration: 2.6,
                repeat: Infinity,
                delay: i * 0.85,
                ease: 'easeOut',
              }}
            />
          ))}

          <motion.div
            className="w-16 h-16 rounded-2xl bg-[#22C55E]/10 flex items-center justify-center"
            animate={{ scale: [1, 1.06, 1] }}
            transition={{ duration: 2.6, repeat: Infinity, ease: 'easeInOut' }}
          >
            <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#22C55E" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 20a8 8 0 1 0 0-16 8 8 0 0 0 0 16Z" />
              <path d="M12 8v4l2.5 2.5" />
            </svg>
          </motion.div>
        </div>

        <h1 className="text-[22px] font-extrabold text-warm tracking-tight mb-3">
          We're making things better
        </h1>
        <p className="text-[14px] text-warm/70 leading-relaxed mb-1">
          {message || "PayPaddy is temporarily down for maintenance. We'll be back shortly."}
        </p>
        <p className="text-[13px] text-warm/50 mt-4">
          Your groups, contributions, and wallet balance are all safe — nothing is lost.
        </p>

        <button
          onClick={() => window.location.reload()}
          className="mt-8 h-11 px-6 rounded-xl bg-[#22C55E] text-ink text-[13px] font-bold shadow-[0_0_20px_rgba(34,197,94,0.35)] transition-all duration-200 hover:brightness-105"
        >
          Try again
        </button>
      </motion.div>
    </div>
  )
}