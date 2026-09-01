import { useEffect, useState, useRef } from 'react'
import { motion, AnimatePresence, useMotionValue, useSpring, useTransform } from 'framer-motion'

interface CinematicLoaderProps {
  onComplete?: () => void
  duration?: number
}

const MESSAGES = [
  'Preparing your contribution space',
  'Securing transactions',
  'Syncing group activity',
  'Almost there',
]

const RING_COUNT = 6
const NODE_COUNT = 8

const rings = Array.from({ length: RING_COUNT }, (_, i) => ({
  id:       i,
  radius:   60 + i * 28,
  duration: 8 + i * 3.5,
  reverse:  i % 2 !== 0,
  opacity:  0.06 + (RING_COUNT - i) * 0.025,
  nodes:    i % 2 === 0 ? 2 : 3,
}))

function PayPaddyLogo() {
  return (
    <div
      style={{
        width: 80, height: 80,
        borderRadius: 20,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        flexShrink: 0,
        overflow: 'hidden',
      }}
    >
      <img
        src= "https://res.cloudinary.com/dmjakrnby/image/upload/v1785166848/AjoDaddy_Black_yv047m.png"
        alt="PayPaddy"
        style={{ width: '100%', height: '100%', objectFit: 'contain' }}
      />
    </div>
  )
}

function Particle({ index }: { index: number }) {
  const angle = (index / NODE_COUNT) * Math.PI * 2
  const r     = 120 + Math.sin(index * 1.7) * 40
  const x     = Math.cos(angle) * r
  const y     = Math.sin(angle) * r
  const size  = 2 + (index % 3)

  return (
    <motion.div
      className="absolute rounded-full"
      style={{
        width: size, height: size,
        left: '50%', top: '50%',
        marginLeft: x - size / 2,
        marginTop:  y - size / 2,
        background: index % 3 === 0 ? '#A8E03A' : 'rgba(255,255,255,0.4)',
      }}
      initial={{ opacity: 0, scale: 0 }}
      animate={{
        opacity: [0, 0.9, 0.4, 0.9, 0],
        scale:   [0, 1, 0.7, 1, 0],
        x: [0, Math.cos(angle + 0.5) * 8, 0],
        y: [0, Math.sin(angle + 0.5) * 8, 0],
      }}
      transition={{
        duration: 4 + index * 0.3,
        delay: index * 0.18,
        repeat: Infinity,
        ease: 'easeInOut',
      }}
    />
  )
}

function OrbitalRing({ ring }: { ring: typeof rings[0] }) {
  return (
    <motion.div
      className="absolute rounded-full border"
      style={{
        width:       ring.radius * 2,
        height:      ring.radius * 2,
        left:        '50%',
        top:         '50%',
        marginLeft:  -ring.radius,
        marginTop:   -ring.radius,
        borderColor: `rgba(255,255,255,${ring.opacity})`,
      }}
      initial={{ opacity: 0, scale: 0.6 }}
      animate={{ opacity: 1, scale: 1, rotate: ring.reverse ? [0, -360] : [0, 360] }}
      transition={{
        opacity: { duration: 1.2, delay: ring.id * 0.15 },
        scale:   { duration: 1.2, delay: ring.id * 0.15, ease: [0.16, 1, 0.3, 1] },
        rotate:  { duration: ring.duration, repeat: Infinity, ease: 'linear' },
      }}
    >
      {Array.from({ length: ring.nodes }).map((_, ni) => {
        const a        = (ni / ring.nodes) * Math.PI * 2
        const nx       = ring.radius + Math.cos(a) * ring.radius - 3
        const ny       = ring.radius + Math.sin(a) * ring.radius - 3
        const isAccent = ring.id === 1 && ni === 0
        return (
          <motion.div
            key={ni}
            className="absolute rounded-full"
            style={{
              width:      isAccent ? 6 : 4,
              height:     isAccent ? 6 : 4,
              left:       nx,
              top:        ny,
              background: isAccent ? '#A8E03A' : 'rgba(255,255,255,0.6)',
              boxShadow:  isAccent ? '0 0 8px #A8E03A66' : 'none',
            }}
            animate={{ opacity: [0.4, 1, 0.4] }}
            transition={{ duration: 2, delay: ni * 0.4, repeat: Infinity, ease: 'easeInOut' }}
          />
        )
      })}
    </motion.div>
  )
}

function ProgressBar({ progress }: { progress: number }) {
  return (
    <div className="w-48 h-px bg-white/10 overflow-hidden rounded-full">
      <motion.div
        className="h-full rounded-full"
        style={{ background: 'linear-gradient(90deg, rgba(168,224,58,0.5), #A8E03A)' }}
        initial={{ width: '0%' }}
        animate={{ width: `${progress}%` }}
        transition={{ duration: 0.6, ease: [0.16, 1, 0.3, 1] }}
      />
    </div>
  )
}

export function CinematicLoader({ onComplete, duration = 3200 }: CinematicLoaderProps) {
  const [msgIndex, setMsgIndex] = useState(0)
  const [progress, setProgress] = useState(0)
  const [exiting,  setExiting]  = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)

  const mouseX  = useMotionValue(0)
  const mouseY  = useMotionValue(0)
  const springX = useSpring(mouseX, { stiffness: 40, damping: 20 })
  const springY = useSpring(mouseY, { stiffness: 40, damping: 20 })
  const rotateX = useTransform(springY, [-300, 300], [4, -4])
  const rotateY = useTransform(springX, [-300, 300], [-4, 4])

  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    const fn = (e: MouseEvent) => {
      const rect = el.getBoundingClientRect()
      mouseX.set(e.clientX - rect.left - rect.width / 2)
      mouseY.set(e.clientY - rect.top  - rect.height / 2)
    }
    el.addEventListener('mousemove', fn)
    return () => el.removeEventListener('mousemove', fn)
  }, [])

  useEffect(() => {
    const step  = duration / 100
    let current = 0
    const timer = setInterval(() => {
      current += 1
      setProgress(current)
      setMsgIndex(Math.min(Math.floor((current / 100) * MESSAGES.length), MESSAGES.length - 1))
      if (current >= 100) {
        clearInterval(timer)
        setTimeout(() => {
          setExiting(true)
          setTimeout(() => onComplete?.(), 700)
        }, 200)
      }
    }, step)
    return () => clearInterval(timer)
  }, [duration, onComplete])

  return (
    <AnimatePresence>
      {!exiting && (
        <motion.div
          ref={containerRef}
          className="fixed inset-0 z-[9999] flex items-center justify-center overflow-hidden select-none"
          style={{ background: '#080909' }}
          initial={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.7, ease: [0.4, 0, 0.2, 1] }}
        >
          {/* Ambient brand glow */}
          <div className="absolute inset-0 pointer-events-none">
            <motion.div
              className="absolute rounded-full"
              style={{
                width: 600, height: 600,
                left: '50%', top: '50%',
                transform: 'translate(-50%,-50%)',
                background: 'radial-gradient(circle, rgba(27,92,60,0.18) 0%, transparent 70%)',
              }}
              animate={{ scale: [1, 1.08, 1], opacity: [0.6, 1, 0.6] }}
              transition={{ duration: 5, repeat: Infinity, ease: 'easeInOut' }}
            />
            <motion.div
              className="absolute rounded-full"
              style={{
                width: 300, height: 300,
                left: '50%', top: '50%',
                transform: 'translate(-50%,-50%)',
                background: 'radial-gradient(circle, rgba(168,224,58,0.06) 0%, transparent 70%)',
              }}
              animate={{ scale: [1, 1.2, 1], opacity: [0.3, 0.7, 0.3] }}
              transition={{ duration: 3.5, repeat: Infinity, ease: 'easeInOut' }}
            />
          </div>

          {/* Grain */}
          <div
            className="absolute inset-0 pointer-events-none opacity-[0.025]"
            style={{
              backgroundImage: `url("data:image/svg+xml,%3Csvg viewBox='0 0 256 256' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='noise'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='4' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23noise)'/%3E%3C/svg%3E")`,
              backgroundSize: '200px 200px',
            }}
          />

          {/* 3D scene */}
          <motion.div
            className="relative flex items-center justify-center"
            style={{ rotateX, rotateY, transformStyle: 'preserve-3d', perspective: 800 }}
          >
            <div className="absolute" style={{ width: 1, height: 1 }}>
              {rings.map(ring => <OrbitalRing key={ring.id} ring={ring} />)}
            </div>
            <div className="absolute" style={{ width: 1, height: 1 }}>
              {Array.from({ length: NODE_COUNT }).map((_, i) => <Particle key={i} index={i} />)}
            </div>

            {/* Logo */}
            <motion.div
              className="relative z-10 flex flex-col items-center"
              initial={{ opacity: 0, scale: 0.8 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ duration: 1, ease: [0.16, 1, 0.3, 1] }}
            >
              <div className="relative">
                <motion.div
                  style={{
                    position: 'absolute', inset: 0,
                    borderRadius: 20,
                    background: 'rgba(27,92,60,0.4)',
                  }}
                  animate={{ scale: [1, 1.5, 1], opacity: [0.5, 0, 0.5] }}
                  transition={{ duration: 2.5, repeat: Infinity, ease: 'easeInOut' }}
                />
                <PayPaddyLogo />
              </div>
            </motion.div>
          </motion.div>

          {/* Status */}
          <div className="absolute bottom-16 left-0 right-0 flex flex-col items-center gap-4">
            <AnimatePresence mode="wait">
              <motion.p
                key={msgIndex}
                style={{
                  color: 'rgba(255,255,255,0.3)',
                  fontSize: 11,
                  letterSpacing: '0.15em',
                  textTransform: 'uppercase',
                }}
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -6 }}
                transition={{ duration: 0.5, ease: [0.16, 1, 0.3, 1] }}
              >
                {MESSAGES[msgIndex]}
              </motion.p>
            </AnimatePresence>
            <ProgressBar progress={progress} />
            <p style={{ color: 'rgba(255,255,255,0.15)', fontSize: 10, fontFamily: 'monospace' }}>
              {progress}%
            </p>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}