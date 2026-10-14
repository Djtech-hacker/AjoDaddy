import { useEffect, useRef, useState } from 'react'
import { motion } from 'framer-motion'

interface CinematicLoaderProps {
  onComplete?: () => void
  duration?: number
}

const LOGO_URL = 'https://res.cloudinary.com/dmjakrnby/image/upload/v1785357030/real_logo_s3jtjp.png'

const MESSAGES = [
  'Preparing your space',
  'Securing your wallet',
  'Syncing your groups',
  'Ready',
]

// Rising staircase: each bar is one contribution, the last one is the payout
const BARS = [22, 30, 38, 46, 54, 62, 70, 78, 86, 100]

const EASE = [0.16, 1, 0.3, 1] as [number, number, number, number]

// ── Living background: drifting network + payment pulses + embers ──
function LiveBackground() {
  const ref = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const canvas = ref.current
    const ctx = canvas?.getContext('2d')
    if (!canvas || !ctx) return

    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    let w = 0, h = 0, raf = 0, last = 0, spawnAt = 0
    const LINK = 150

    type Node  = { x: number; y: number; vx: number; vy: number; r: number }
    type Pulse = { a: number; b: number; t: number; speed: number }
    type Ember = { x: number; y: number; vy: number; vx: number; r: number; life: number; max: number }

    let nodes: Node[]   = []
    let pulses: Pulse[] = []
    let embers: Ember[] = []

    const seed = () => {
      const count = Math.min(Math.round((w * h) / 17000), 70)
      nodes = Array.from({ length: count }, () => ({
        x: Math.random() * w, y: Math.random() * h,
        vx: (Math.random() - 0.5) * 0.22, vy: (Math.random() - 0.5) * 0.22,
        r: 1 + Math.random() * 1.4,
      }))
      pulses = []
      embers = []
    }

    const resize = () => {
      const r = canvas.getBoundingClientRect()
      const dpr = Math.min(window.devicePixelRatio || 1, 1.5)
      w = r.width; h = r.height
      canvas.width = w * dpr; canvas.height = h * dpr
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      seed()
      if (reduce) frame(16, true)
    }

    const spawnEmber = () => {
      embers.push({
        x: Math.random() * w, y: h + 10,
        vy: -(0.25 + Math.random() * 0.45), vx: (Math.random() - 0.5) * 0.15,
        r: 0.8 + Math.random() * 1.6, life: 0, max: 260 + Math.random() * 220,
      })
    }

    const frame = (dt: number, still = false) => {
      ctx.clearRect(0, 0, w, h)
      const step = dt / 16.7

      // move nodes
      if (!still) {
        for (const n of nodes) {
          n.x += n.vx * step; n.y += n.vy * step
          if (n.x < -10) n.x = w + 10; else if (n.x > w + 10) n.x = -10
          if (n.y < -10) n.y = h + 10; else if (n.y > h + 10) n.y = -10
        }
      }

      // links
      ctx.lineWidth = 1
      for (let i = 0; i < nodes.length; i++) {
        for (let j = i + 1; j < nodes.length; j++) {
          const dx = nodes[i].x - nodes[j].x, dy = nodes[i].y - nodes[j].y
          const d = Math.hypot(dx, dy)
          if (d < LINK) {
            ctx.strokeStyle = `rgba(46,150,90,${(1 - d / LINK) * 0.3})`
            ctx.beginPath(); ctx.moveTo(nodes[i].x, nodes[i].y); ctx.lineTo(nodes[j].x, nodes[j].y); ctx.stroke()
          }
        }
      }

      // nodes
      for (const n of nodes) {
        ctx.fillStyle = 'rgba(180,235,200,0.55)'
        ctx.beginPath(); ctx.arc(n.x, n.y, n.r, 0, Math.PI * 2); ctx.fill()
      }

      if (still) return

      // spawn payment pulses along live links
      spawnAt -= dt
      if (spawnAt <= 0 && nodes.length > 2) {
        spawnAt = 380 + Math.random() * 420
        for (let tries = 0; tries < 12; tries++) {
          const a = Math.floor(Math.random() * nodes.length)
          const b = Math.floor(Math.random() * nodes.length)
          if (a !== b && Math.hypot(nodes[a].x - nodes[b].x, nodes[a].y - nodes[b].y) < LINK) {
            pulses.push({ a, b, t: 0, speed: 0.012 + Math.random() * 0.012 }); break
          }
        }
      }

      // draw pulses
      pulses = pulses.filter(p => {
        p.t += p.speed * step
        if (p.t >= 1) return false
        const A = nodes[p.a], B = nodes[p.b]
        if (!A || !B || Math.hypot(A.x - B.x, A.y - B.y) > LINK + 20) return false
        const x = A.x + (B.x - A.x) * p.t, y = A.y + (B.y - A.y) * p.t
        ctx.fillStyle = 'rgba(168,224,58,0.22)'
        ctx.beginPath(); ctx.arc(x, y, 7, 0, Math.PI * 2); ctx.fill()
        ctx.fillStyle = '#E6FF9A'
        ctx.beginPath(); ctx.arc(x, y, 1.8, 0, Math.PI * 2); ctx.fill()
        return true
      })

      // embers rising
      if (embers.length < 22 && Math.random() < 0.12) spawnEmber()
      embers = embers.filter(e => {
        e.life += step; e.x += e.vx * step; e.y += e.vy * step
        if (e.life > e.max || e.y < -10) return false
        const a = Math.sin((e.life / e.max) * Math.PI) * 0.7
        ctx.fillStyle = `rgba(168,224,58,${a})`
        ctx.beginPath(); ctx.arc(e.x, e.y, e.r, 0, Math.PI * 2); ctx.fill()
        return true
      })
    }

    const loop = (now: number) => {
      const dt = last ? Math.min(now - last, 50) : 16
      last = now
      frame(dt)
      raf = requestAnimationFrame(loop)
    }

    resize()
    const ro = new ResizeObserver(resize)
    ro.observe(canvas)
    if (!reduce) raf = requestAnimationFrame(loop)

    return () => { cancelAnimationFrame(raf); ro.disconnect() }
  }, [])

  return <canvas ref={ref} aria-hidden className="absolute inset-0 w-full h-full pointer-events-none" />
}

// ── Loader ────────────────────────────────────────────────────
export function CinematicLoader({ onComplete, duration = 3200 }: CinematicLoaderProps) {
  const onCompleteRef = useRef(onComplete)
  onCompleteRef.current = onComplete // timer never restarts when the parent re-renders

  const [progress, setProgress] = useState(0) // 0..1
  const [exiting, setExiting]   = useState(false)

  useEffect(() => {
    let raf = 0, start = 0, finished = false
    let exitTimer = 0, doneTimer = 0

    const loop = (now: number) => {
      if (!start) start = now
      const raw   = Math.min((now - start) / duration, 1)
      const eased = raw < 0.5 ? 2 * raw * raw : 1 - Math.pow(-2 * raw + 2, 2) / 2
      setProgress(eased)

      if (raw >= 1 && !finished) {
        finished = true
        exitTimer = window.setTimeout(() => {
          setExiting(true)
          doneTimer = window.setTimeout(() => onCompleteRef.current?.(), 700)
        }, 350)
        return
      }
      raf = requestAnimationFrame(loop)
    }
    raf = requestAnimationFrame(loop)

    return () => { cancelAnimationFrame(raf); clearTimeout(exitTimer); clearTimeout(doneTimer) }
  }, [duration])

  const pct      = Math.round(progress * 100)
  const msgIndex = Math.min(Math.floor(progress * MESSAGES.length), MESSAGES.length - 1)

  return (
    <motion.div
      className="fixed inset-0 z-[9999] flex flex-col items-center justify-center overflow-hidden select-none"
      style={{ background: 'linear-gradient(120deg, #060D0A 0%, #0B1F18 60%, #123D2A 100%)' }}
      initial={{ opacity: 1 }}
      animate={{ opacity: exiting ? 0 : 1, y: exiting ? -16 : 0 }}
      transition={{ duration: 0.7, ease: [0.4, 0, 0.2, 1] }}
    >
      {/* aurora glows, slowly drifting */}
      <motion.div
        className="absolute -bottom-40 -left-32 w-[720px] h-[720px] pointer-events-none"
        style={{ background: 'radial-gradient(closest-side, rgba(27,92,60,0.55), transparent)' }}
        animate={{ x: [0, 90, 0], y: [0, -50, 0], scale: [1, 1.12, 1] }}
        transition={{ duration: 12, repeat: Infinity, ease: 'easeInOut' }}
      />
      <motion.div
        className="absolute -top-44 -right-32 w-[620px] h-[620px] pointer-events-none"
        style={{ background: 'radial-gradient(closest-side, rgba(168,224,58,0.12), transparent)' }}
        animate={{ x: [0, -70, 0], y: [0, 60, 0], scale: [1, 1.18, 1] }}
        transition={{ duration: 14, repeat: Infinity, ease: 'easeInOut' }}
      />
      <motion.div
        className="absolute top-1/3 left-1/3 w-[480px] h-[480px] pointer-events-none"
        style={{ background: 'radial-gradient(closest-side, rgba(46,150,90,0.22), transparent)' }}
        animate={{ x: [0, 120, -40, 0], y: [0, 40, -60, 0], opacity: [0.5, 1, 0.6, 0.5] }}
        transition={{ duration: 16, repeat: Infinity, ease: 'easeInOut' }}
      />

      {/* fine dot grid */}
      <div className="absolute inset-0 pointer-events-none opacity-60"
        style={{ backgroundImage: 'radial-gradient(rgba(255,255,255,0.06) 1px, transparent 1px)', backgroundSize: '22px 22px' }} />

      {/* drifting network, payment pulses, embers */}
      <LiveBackground />

      {/* light sweeps across the screen */}
      <motion.div
        aria-hidden
        className="absolute inset-y-0 w-[32%] pointer-events-none"
        style={{ background: 'linear-gradient(100deg, transparent, rgba(168,224,58,0.05), transparent)' }}
        initial={{ x: '-40vw' }}
        animate={{ x: '130vw' }}
        transition={{ duration: 6, repeat: Infinity, repeatDelay: 1.5, ease: 'linear' }}
      />

      {/* vignette keeps the centre clean */}
      <div className="absolute inset-0 pointer-events-none"
        style={{ background: 'radial-gradient(ellipse at center, transparent 35%, rgba(3,8,6,0.75) 100%)' }} />

      <div className="relative z-10 w-full max-w-[340px] px-6 flex flex-col items-center">
        <motion.img
          src={LOGO_URL}
          alt="AjoDaddy"
          className="h-16 sm:h-20 w-auto object-contain"
          initial={{ opacity: 0, y: 14 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.9, ease: EASE }}
        />

        {/* rising bars */}
        <div className="mt-12 w-full h-24 flex items-end gap-[7px]" aria-hidden>
          {BARS.map((h, i) => {
            const fill   = Math.min(Math.max(progress * BARS.length - i, 0), 1)
            const isLast = i === BARS.length - 1
            return (
              <div key={i} className="flex-1 relative rounded-[3px] overflow-hidden bg-white/[0.06]"
                style={{ height: `${h}%` }}>
                <div
                  className="absolute inset-0 origin-bottom rounded-[3px]"
                  style={{
                    transform: `scaleY(${fill})`,
                    background: isLast
                      ? 'linear-gradient(180deg, #E6FF9A 0%, #A8E03A 100%)'
                      : 'linear-gradient(180deg, #2E965A 0%, #1B5C3C 100%)',
                    boxShadow: isLast && fill > 0.98 ? '0 0 24px rgba(168,224,58,0.55)' : 'none',
                    transition: 'box-shadow 0.4s ease',
                  }}
                />
              </div>
            )
          })}
        </div>

        <div className="mt-6 w-full flex items-baseline justify-between">
          <p key={msgIndex} className="text-[10.5px] font-semibold uppercase tracking-[0.18em] text-white/50">
            {MESSAGES[msgIndex]}
          </p>
          <p className="text-[13px] font-mono tabular-nums text-white/70">
            {String(pct).padStart(2, '0')}<span className="text-white/30">%</span>
          </p>
        </div>

        <div className="mt-3 w-full h-px bg-white/10 relative overflow-hidden">
          <div className="absolute inset-y-0 left-0"
            style={{
              width: `${progress * 100}%`,
              background: 'linear-gradient(90deg, rgba(168,224,58,0.2), #A8E03A)',
            }} />
        </div>
      </div>

      <motion.p
        className="absolute bottom-10 text-[10px] font-semibold uppercase tracking-[0.3em] text-white/30"
        initial={{ opacity: 0 }} animate={{ opacity: 1 }}
        transition={{ delay: 0.6, duration: 0.8 }}
      >
        Save Together · Grow Together
      </motion.p>
    </motion.div>
  )
}