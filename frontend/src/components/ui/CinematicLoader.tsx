// import { useEffect, useRef, useState } from 'react'
// import { motion, useReducedMotion } from 'framer-motion'

// interface CinematicLoaderProps {
//   onComplete?: () => void
//   duration?: number
// }

// const LOGO_URL =
//   'https://res.cloudinary.com/dmjakrnby/image/upload/v1785357030/real_logo_s3jtjp.png'

// /**
//  * TAREVA loader
//  * Visual idea: a calm contribution cycle around a shared pool of savings.
//  * Kept deliberately simple: no particles, network lines, gradients, or 3D effects.
//  */
// export function CinematicLoader({
//   onComplete,
//   duration = 1800,
// }: CinematicLoaderProps) {
//   const [progress, setProgress] = useState(0)
//   const [exiting, setExiting] = useState(false)
//   const onCompleteRef = useRef(onComplete)
//   const reduceMotion = useReducedMotion()

//   useEffect(() => {
//     onCompleteRef.current = onComplete
//   }, [onComplete])

//   useEffect(() => {
//     let raf = 0
//     let exitTimer: ReturnType<typeof setTimeout> | undefined
//     let doneTimer: ReturnType<typeof setTimeout> | undefined
//     let start = 0
//     let finished = false
//     let cancelled = false

//     const finish = () => {
//       if (finished || cancelled) return
//       finished = true
//       setProgress(1)
//       exitTimer = setTimeout(() => {
//         if (cancelled) return
//         setExiting(true)
//         doneTimer = setTimeout(() => {
//           if (!cancelled) onCompleteRef.current?.()
//         }, reduceMotion ? 0 : 220)
//       }, reduceMotion ? 0 : 120)
//     }

//     if (reduceMotion) {
//       setProgress(1)
//       finish()
//     } else {
//       const tick = (now: number) => {
//         if (!start) start = now
//         const raw = Math.min((now - start) / Math.max(duration, 1), 1)
//         // Ease out gently; the loader should feel calm rather than theatrical.
//         const eased = 1 - Math.pow(1 - raw, 3)
//         setProgress(eased)

//         if (raw >= 1) {
//           finish()
//           return
//         }
//         raf = requestAnimationFrame(tick)
//       }
//       raf = requestAnimationFrame(tick)
//     }

//     return () => {
//       cancelled = true
//       cancelAnimationFrame(raf)
//       if (exitTimer) clearTimeout(exitTimer)
//       if (doneTimer) clearTimeout(doneTimer)
//     }
//   }, [duration, reduceMotion])

//   const circumference = 2 * Math.PI * 39

//   return (
//     <motion.div
//       role="status"
//       aria-label="Loading TAREVA"
//       aria-live="polite"
//       className="fixed inset-0 z-[9999] flex min-h-screen flex-col items-center justify-center overflow-hidden bg-[#F8F9FA] px-6"
//       initial={{ opacity: 1 }}
//       animate={{ opacity: exiting ? 0 : 1 }}
//       transition={{ duration: reduceMotion ? 0 : 0.22, ease: 'easeOut' }}
//     >
//       <div className="flex w-full max-w-[300px] flex-col items-center">
//         <motion.img
//           src={LOGO_URL}
//           alt="TAREVA"
//           className="mb-12 h-12 w-auto max-w-[220px] object-contain"
//           initial={reduceMotion ? false : { opacity: 0, y: 5 }}
//           animate={{ opacity: 1, y: 0 }}
//           transition={{ duration: reduceMotion ? 0 : 0.35, ease: 'easeOut' }}
//         />

//         {/* A single circular stroke represents the repeating Ajo contribution cycle. */}
//         <div className="relative mb-7 flex h-[112px] w-[112px] items-center justify-center">
//           <svg
//             viewBox="0 0 100 100"
//             className="absolute inset-0 h-full w-full -rotate-90"
//             aria-hidden="true"
//           >
//             <circle
//               cx="50"
//               cy="50"
//               r="39"
//               fill="none"
//               stroke="#DDEBE3"
//               strokeWidth="3"
//             />
//             <motion.circle
//               cx="50"
//               cy="50"
//               r="39"
//               fill="none"
//               stroke="#0B6E4F"
//               strokeWidth="3"
//               strokeLinecap="round"
//               strokeDasharray={circumference}
//               initial={{ strokeDashoffset: circumference }}
//               animate={{
//                 strokeDashoffset: circumference * (1 - progress),
//               }}
//               transition={{ duration: 0.12, ease: 'linear' }}
//             />
//           </svg>

//           {/* A simple stack of contributions: intentionally flat, not an illustration. */}
//           <div className="relative flex h-[58px] w-[58px] flex-col items-center justify-center">
//             <span className="absolute top-[7px] h-[27px] w-[43px] rounded-full border-[2px] border-[#14AE5C] bg-[#E7F5EC]" />
//             <span className="absolute top-[15px] h-[27px] w-[43px] rounded-full border-[2px] border-[#0B6E4F] bg-[#F8F9FA]" />
//             <span className="relative z-10 flex h-[27px] w-[43px] items-center justify-center rounded-full border-[2px] border-[#0B6E4F] bg-white text-[16px] font-semibold leading-none text-[#0B6E4F]">
//               ₦
//             </span>
//           </div>
//         </div>

//         <p className="text-center text-[15px] font-semibold tracking-[-0.02em] text-[#173B2B]">
//           Bringing your Ajo together
//         </p>
//         <p className="mt-2 text-center text-[12px] font-medium text-[#718078]">
//           Your circle of savings, in sync.
//         </p>

//         <div
//           className="mt-8 h-[3px] w-[132px] overflow-hidden rounded-full bg-[#E2EAE5]"
//           aria-hidden="true"
//         >
//           <motion.div
//             className="h-full rounded-full bg-[#14AE5C]"
//             style={{ width: `${Math.round(progress * 100)}%` }}
//           />
//         </div>
//       </div>
//     </motion.div>
//   )
// }


import { useEffect, useRef, useState } from 'react'
import { motion, useReducedMotion } from 'framer-motion'

interface CinematicLoaderProps {
  onComplete?: () => void
  duration?: number
}

const LOGO_URL = 'https://res.cloudinary.com/dmjakrnby/image/upload/v1785357030/real_logo_s3jtjp.png'

// ── Switch the whole look here: 'light' or 'dark' ──
const MODE = 'light' as 'light' | 'dark'

const THEMES = {
  light: {
    background:   '#F8F9FA',
    track:        '#DCE6E0',
    emptyNode:    '#E6EDE9',
    emptyIcon:    '#B3C1B9',
    contribution: '#14AE5C',
    coinCenter:   '#0B6E4F',
    payout:       '#F2B134',
    payoutIcon:   '#0B6E4F',
    text:         '#0B6E4F',
    muted:        '#7A8A82',
  },
  dark: {
    background:   '#0B1D16',
    track:        'rgba(255,255,255,0.10)',
    emptyNode:    'rgba(255,255,255,0.10)',
    emptyIcon:    'rgba(255,255,255,0.30)',
    contribution: '#14AE5C',
    coinCenter:   '#0F7F57',
    payout:       '#A8E03A',
    payoutIcon:   '#0B1D16',
    text:         '#FFFFFF',
    muted:        'rgba(255,255,255,0.45)',
  },
}
const THEME = THEMES[MODE]

const COIN_GOLD      = '#F2B134'
const COIN_GOLD_DARK = '#C98A12'

// The savings circle
const MEMBERS      = 8
const CONTRIBUTION = 2000 // ₦ per member, shown in the pool counter

// SVG geometry (viewBox is 200 x 200)
const VIEW     = 200
const CENTER   = 100
const RADIUS   = 78
const NODE_R   = 14
const CENTER_R = 28
const COIN_R   = 6

const EASE = [0.16, 1, 0.3, 1] as [number, number, number, number]
const EXIT_MS = 450

// Member 0 sits at 12 o'clock (this is who gets the payout), the rest go clockwise
const NODES = Array.from({ length: MEMBERS }, (_, i) => {
  const angle = -Math.PI / 2 + (i / MEMBERS) * Math.PI * 2
  return {
    cx: CENTER + RADIUS * Math.cos(angle),
    cy: CENTER + RADIUS * Math.sin(angle),
  }
})

// Small person icon (head + shoulders) drawn around a point
function PersonIcon({ cx, cy, color }: { cx: number; cy: number; color: string }) {
  return (
    <g fill={color}>
      <circle cx={cx} cy={cy - 3.4} r={3.6} />
      <path
        d={`M ${cx - 6.5} ${cy + 7.5}
            C ${cx - 6.5} ${cy + 2.8}, ${cx - 3.6} ${cy + 1.2}, ${cx} ${cy + 1.2}
            C ${cx + 3.6} ${cy + 1.2}, ${cx + 6.5} ${cy + 2.8}, ${cx + 6.5} ${cy + 7.5} Z`}
      />
    </g>
  )
}

export function CinematicLoader({ onComplete, duration = 2800 }: CinematicLoaderProps) {
  const reduce = useReducedMotion()

  const onCompleteRef = useRef(onComplete)
  onCompleteRef.current = onComplete // timers never restart when the parent re-renders

  const [exiting, setExiting] = useState(false)
  const [paid, setPaid] = useState(reduce ? MEMBERS : 0) // members who have contributed so far

  // Reduced motion: show the finished circle and leave quickly
  const total = reduce ? Math.min(duration, 700) : duration

  // Timeline in seconds, everything scales with `duration`
  const d          = total / 1000
  const fillStart  = d * 0.16   // line leaves the top
  const fillWindow = d * 0.46   // time for the line to go all the way round
  const coinDelay  = d * 0.04   // member fills, then the coin leaves
  const travel     = d * 0.16   // coin flight to the pool
  const payoutAt   = d * 0.79   // pool pays the member at the top
  const payoutFly  = d * 0.14

  const fillAt    = (i: number) => fillStart + (i / MEMBERS) * fillWindow
  const arriveAt  = (i: number) => fillAt(i) + coinDelay + travel

  useEffect(() => {
    const timers: number[] = []

    if (!reduce) {
      // Pool counter goes up the moment each coin lands
      for (let i = 0; i < MEMBERS; i++) {
        timers.push(window.setTimeout(() => setPaid(i + 1), arriveAt(i) * 1000))
      }
    }

    timers.push(window.setTimeout(() => setExiting(true), total))
    timers.push(window.setTimeout(() => onCompleteRef.current?.(), total + EXIT_MS))

    return () => timers.forEach(clearTimeout)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [total, reduce])

  return (
    <motion.div
      role="status"
      aria-live="polite"
      aria-label="Loading TAREVA"
      className="fixed inset-0 z-[9999] flex flex-col items-center justify-center gap-6 sm:gap-8 select-none"
      style={{ background: THEME.background }}
      initial={{ opacity: 1 }}
      animate={{ opacity: exiting ? 0 : 1 }}
      transition={{ duration: EXIT_MS / 1000, ease: [0.4, 0, 0.2, 1] }}
    >
      <span className="sr-only">Loading TAREVA</span>

      <motion.img
        src={LOGO_URL}
        alt=""
        draggable={false}
        className="h-20 sm:h-24 w-auto object-contain"
        initial={reduce ? false : { opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.6, ease: EASE }}
      />

      <motion.svg
        viewBox={`0 0 ${VIEW} ${VIEW}`}
        className="h-56 w-56 sm:h-64 sm:w-64"
        aria-hidden
        initial={reduce ? false : { opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ duration: 0.4, delay: 0.1 }}
      >
        {/* empty circle */}
        <circle cx={CENTER} cy={CENTER} r={RADIUS} fill="none" stroke={THEME.track} strokeWidth={3} />

        {/* line that travels clockwise, member to member */}
        <g transform={`rotate(-90 ${CENTER} ${CENTER})`}>
          <motion.circle
            cx={CENTER} cy={CENTER} r={RADIUS}
            fill="none" stroke={THEME.contribution}
            strokeWidth={3} strokeLinecap="round"
            initial={reduce ? false : { pathLength: 0 }}
            animate={{ pathLength: 1 }}
            transition={{ delay: fillStart, duration: fillWindow, ease: 'linear' }}
          />
        </g>

        {/* members: empty seat, then filled green when the line reaches them */}
        {NODES.map((n, i) => (
          <g key={i}>
            <circle cx={n.cx} cy={n.cy} r={NODE_R} fill={THEME.emptyNode} />
            <PersonIcon cx={n.cx} cy={n.cy} color={THEME.emptyIcon} />
            <motion.g
              style={{ transformBox: 'fill-box', transformOrigin: 'center' }}
              initial={reduce ? false : { opacity: 0, scale: 0.6 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ delay: fillAt(i), duration: 0.35, ease: EASE }}
            >
              <circle cx={n.cx} cy={n.cy} r={NODE_R} fill={THEME.contribution} />
              <PersonIcon cx={n.cx} cy={n.cy} color="#FFFFFF" />
            </motion.g>
          </g>
        ))}

        {/* the shared pool: a naira coin in the middle */}
        <motion.g
          style={{ transformBox: 'fill-box', transformOrigin: 'center' }}
          initial={reduce ? false : { opacity: 0, scale: 0.6 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ delay: 0.2, duration: 0.5, ease: EASE }}
        >
          <circle cx={CENTER} cy={CENTER} r={CENTER_R} fill={THEME.coinCenter} />
          <circle cx={CENTER} cy={CENTER} r={CENTER_R - 5} fill="none" stroke="#FFFFFF" strokeOpacity={0.35} strokeWidth={1.5} />
          <text
            x={CENTER} y={CENTER + 1}
            textAnchor="middle" dominantBaseline="central"
            fill="#FFFFFF" fontSize={30} fontWeight={700}
            fontFamily="system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif"
          >
            ₦
          </text>
        </motion.g>

        {!reduce && (
          <>
            {/* a soft ring ripples out each time a contribution lands */}
            {NODES.map((_, i) => (
              <motion.circle
                key={`ripple-${i}`}
                cx={CENTER} cy={CENTER} r={CENTER_R}
                fill="none" stroke={THEME.contribution} strokeWidth={2}
                style={{ transformBox: 'fill-box', transformOrigin: 'center' }}
                initial={{ opacity: 0, scale: 1 }}
                animate={{ opacity: [0.5, 0], scale: [1, 1.35] }}
                transition={{ delay: arriveAt(i), duration: 0.5, ease: 'easeOut' }}
              />
            ))}

            {/* each member's coin flies into the pool */}
            {NODES.map((n, i) => (
              <motion.g
                key={`coin-${i}`}
                initial={{ opacity: 0, x: 0, y: 0 }}
                animate={{
                  opacity: [0, 1, 1, 0],
                  x: CENTER - n.cx,
                  y: CENTER - n.cy,
                }}
                transition={{
                  delay: fillAt(i) + coinDelay,
                  opacity: { duration: travel, times: [0, 0.15, 0.8, 1], ease: 'linear' },
                  x: { duration: travel, ease: [0.5, 0, 0.75, 0.4] },
                  y: { duration: travel, ease: [0.5, 0, 0.75, 0.4] },
                }}
              >
                <circle cx={n.cx} cy={n.cy} r={COIN_R} fill={COIN_GOLD} stroke={COIN_GOLD_DARK} strokeWidth={1} />
                <circle cx={n.cx} cy={n.cy} r={COIN_R - 2.2} fill="none" stroke={COIN_GOLD_DARK} strokeOpacity={0.6} strokeWidth={0.8} />
              </motion.g>
            ))}

            {/* payout: the pool sends a coin back out to the member whose turn it is */}
            <motion.g
              initial={{ opacity: 0, x: 0, y: 0 }}
              animate={{
                opacity: [0, 1, 1, 0],
                x: NODES[0].cx - CENTER,
                y: NODES[0].cy - CENTER,
              }}
              transition={{
                delay: payoutAt,
                opacity: { duration: payoutFly, times: [0, 0.15, 0.8, 1], ease: 'linear' },
                x: { duration: payoutFly, ease: EASE },
                y: { duration: payoutFly, ease: EASE },
              }}
            >
              <circle cx={CENTER} cy={CENTER} r={COIN_R + 2} fill={COIN_GOLD} stroke={COIN_GOLD_DARK} strokeWidth={1.2} />
              <circle cx={CENTER} cy={CENTER} r={COIN_R - 1} fill="none" stroke={COIN_GOLD_DARK} strokeOpacity={0.6} strokeWidth={0.9} />
            </motion.g>
          </>
        )}

        {/* member at the top receives the payout and turns gold (or lime on dark) */}
        <motion.g
          style={{ transformBox: 'fill-box', transformOrigin: 'center' }}
          initial={reduce ? false : { opacity: 0, scale: 1 }}
          animate={{ opacity: 1, scale: reduce ? 1 : [1, 1.25, 1.1] }}
          transition={{ delay: payoutAt + payoutFly * 0.8, duration: 0.5, ease: EASE }}
        >
          <circle cx={NODES[0].cx} cy={NODES[0].cy} r={NODE_R} fill={THEME.payout} />
          <PersonIcon cx={NODES[0].cx} cy={NODES[0].cy} color={THEME.payoutIcon} />
        </motion.g>
      </motion.svg>

      {/* pool counter: goes up by one contribution each time a coin lands */}
      <div className="flex flex-col items-center gap-1">
        <span
          className="text-[10px] font-semibold uppercase tracking-[0.22em]"
          style={{ color: THEME.muted }}
        >
          Ajo pool
        </span>
        <div className="h-10 overflow-hidden">
          <motion.span
            key={paid}
            className="block text-3xl font-semibold tabular-nums leading-10"
            style={{ color: THEME.text }}
            initial={reduce || paid === 0 ? false : { y: 12, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            transition={{ duration: 0.25, ease: EASE }}
          >
            ₦{(paid * CONTRIBUTION).toLocaleString('en-NG')}
          </motion.span>
        </div>
      </div>
    </motion.div>
  )
}