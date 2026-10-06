// ============================================================
// LandingPage.tsx — brand colors (green / lime / warm), fully responsive
// ============================================================
import React, { useRef, useState, useEffect, useCallback } from 'react'
import { Link } from 'react-router-dom'
import { motion, useScroll, useTransform, AnimatePresence } from 'framer-motion'

// ── Hooks ────────────────────────────────────────────────────
function useMouseParallax(strength = 0.02) {
  const [offset, setOffset] = useState({ x: 0, y: 0 })
  const handleMouseMove = useCallback((e: MouseEvent) => {
    const cx = window.innerWidth / 2
    const cy = window.innerHeight / 2
    setOffset({ x: (e.clientX - cx) * strength, y: (e.clientY - cy) * strength })
  }, [strength])
  useEffect(() => {
    window.addEventListener('mousemove', handleMouseMove)
    return () => window.removeEventListener('mousemove', handleMouseMove)
  }, [handleMouseMove])
  return offset
}

function useInView(threshold = 0.15): [(node: Element | null) => void, boolean] {
  const [ref, setRef] = useState<Element | null>(null)
  const [inView, setInView] = useState(false)
  useEffect(() => {
    if (!ref) return
    const obs = new IntersectionObserver(([entry]) => {
      if (entry.isIntersecting) { setInView(true); obs.disconnect() }
    }, { threshold })
    obs.observe(ref)
    return () => obs.disconnect()
  }, [ref, threshold])
  return [setRef, inView]
}

// ── Static data (sample data for illustration only) ───────────
const LOGO_URL = 'https://res.cloudinary.com/dmjakrnby/image/upload/v1785357030/real_logo_s3jtjp.png'

const payoutRotation = [
  { pos: 1, name: 'Adaeze Kalu',  initials: 'AK', date: 'Jan 6',  done: true,  current: false },
  { pos: 2, name: 'Emeka Obi',    initials: 'EO', date: 'Jan 13', done: true,  current: false },
  { pos: 3, name: 'Fola Adeyemi', initials: 'FA', date: 'Jan 20', done: true,  current: false },
  { pos: 4, name: 'Amara Osei',   initials: 'AO', date: 'May 19', done: false, current: true  },
  { pos: 5, name: 'Kemi Hassan',  initials: 'KH', date: 'May 26', done: false, current: false },
  { pos: 6, name: 'Chidi Nwosu',  initials: 'CN', date: 'Jun 2',  done: false, current: false },
  { pos: 7, name: 'Ngozi Dike',   initials: 'ND', date: 'Jun 9',  done: false, current: false },
  { pos: 8, name: 'Kofi Mensah',  initials: 'KM', date: 'Jun 16', done: false, current: false },
]

const weeklyData = [
  { week: 'Wk 1', collected: 600000, target: 600000 },
  { week: 'Wk 2', collected: 600000, target: 600000 },
  { week: 'Wk 3', collected: 550000, target: 600000 },
  { week: 'Wk 4', collected: 580000, target: 600000 },
  { week: 'Wk 5', collected: 540000, target: 600000 },
  { week: 'Wk 6', collected: 600000, target: 600000 },
]

const faqs = [
  { q: 'What is Ajo and how does AjoDaddy work?', a: 'Ajo (also called Esusu or Susu) is a traditional rotating savings model where each member contributes a fixed amount regularly and members take turns receiving the pool. AjoDaddy helps groups track contributions, schedule payouts, and keep a clear record of every payment.' },
  { q: 'How are payouts made?', a: "Payouts are sent to the bank account the member has added to their profile, on the agreed date. Every payout is recorded in the group's history." },
  { q: 'What happens if a member misses a contribution?', a: 'Group admins are notified, and the rules the group has set for late or missed contributions apply.' },
  { q: 'Is my money safe?', a: 'Payments are processed by Paystack and Flutterwave, and your data is sent over encrypted (HTTPS) connections. Every contribution and payout is recorded in your group history. Only join groups with people you know and trust, because AjoDaddy is not responsible for losses caused by other members. Please read our Terms of Service and Privacy Policy for details.' },
  { q: 'Can I create my own group or join an existing one?', a: 'Both. Create a private group and invite members, or join with an invite link. Group admins control membership and contribution rules. We recommend private groups with people you personally know.' },
]

const navLinks = [['How it works','#how-it-works'],['Features','#features'],['Security','#security'],['FAQ','#faq']]

// ── Nav ───────────────────────────────────────────────────────
function Nav() {
  const [scrolled, setScrolled] = useState(false)
  const [menuOpen, setMenuOpen] = useState(false)

  useEffect(() => {
    const fn = () => setScrolled(window.scrollY > 40)
    window.addEventListener('scroll', fn, { passive: true })
    return () => window.removeEventListener('scroll', fn)
  }, [])

  return (
    <motion.header
      className={`fixed top-0 inset-x-0 z-50 transition-all duration-300 ${scrolled || menuOpen ? 'bg-warm/90 backdrop-blur-md border-b border-black/[0.06]' : ''}`}
      initial={{ y: -20, opacity: 0 }}
      animate={{ y: 0, opacity: 1 }}
      transition={{ duration: 0.5, ease: [0.16, 1, 0.3, 1] }}
    >
      <div className="max-w-6xl mx-auto px-5 sm:px-6 h-16 flex items-center justify-between">
        {/* spacer keeps the logo centered on mobile (same width as the hamburger) */}
        <div className="w-9 h-9 md:hidden" aria-hidden />

        <Link to="/" className="flex items-center justify-center">
          <img
            src={LOGO_URL}
            alt="AjoDaddy"
            style={{ height: '4cm', marginTop: '1cm', position: 'relative', top: '2cm' }}
            className="w-auto object-contain flex-shrink-0"
          />
        </Link>

        <nav className="hidden md:flex items-center gap-7">
          {navLinks.map(([label, href]) => (
            <a key={label} href={href}
              className="text-[13px] font-medium text-dim hover:text-ink transition-colors duration-150">
              {label}
            </a>
          ))}
        </nav>

        <div className="hidden md:flex items-center gap-3">
          <Link to="/login" className="text-[13px] font-semibold text-dim hover:text-ink transition-colors px-4 py-2">
            Log in
          </Link>
          <Link to="/register"
            className="text-[13px] font-bold text-warm bg-ink px-4 py-2.5 rounded-xl hover:bg-pitch transition-all hover:shadow-dark-sm">
            Get started
          </Link>
        </div>

        <button
          className="md:hidden w-9 h-9 flex flex-col items-center justify-center gap-1.5 rounded-lg hover:bg-sand transition-colors"
          onClick={() => setMenuOpen(v => !v)}
          aria-label="Toggle menu"
        >
          <span className={`block w-5 h-0.5 bg-ink rounded transition-all duration-200 origin-center ${menuOpen ? 'rotate-45 translate-y-[7px]' : ''}`}/>
          <span className={`block w-5 h-0.5 bg-ink rounded transition-all duration-200 ${menuOpen ? 'opacity-0 scale-x-0' : ''}`}/>
          <span className={`block w-5 h-0.5 bg-ink rounded transition-all duration-200 origin-center ${menuOpen ? '-rotate-45 -translate-y-[7px]' : ''}`}/>
        </button>
      </div>

      <AnimatePresence>
        {menuOpen && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.25, ease: [0.16, 1, 0.3, 1] }}
            className="md:hidden overflow-hidden bg-warm border-b border-black/[0.06]"
          >
            <div className="px-5 py-5 flex flex-col gap-4">
              {navLinks.map(([label, href]) => (
                <a key={label} href={href}
                  className="text-[14px] font-medium text-ink py-1"
                  onClick={() => setMenuOpen(false)}>
                  {label}
                </a>
              ))}
              <div className="pt-2 border-t border-black/[0.06] flex flex-col gap-2">
                <Link to="/login"
                  className="text-[14px] font-semibold text-ink text-center py-3 rounded-xl border border-black/[0.09] hover:bg-sand transition-colors"
                  onClick={() => setMenuOpen(false)}>
                  Log in
                </Link>
                <Link to="/register"
                  className="text-[14px] font-bold text-warm bg-ink text-center py-3 rounded-xl hover:bg-pitch transition-colors"
                  onClick={() => setMenuOpen(false)}>
                  Get started
                </Link>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.header>
  )
}

// ── Hero floating UI cards (sample illustrations) ─────────────
function FloatingCard({ name, initials, amount, time, delay, x, y }: {
  name: string; initials: string; amount: string; time: string; delay: number; x: string; y: string
}) {
  return (
    <motion.div
      className="absolute bg-white rounded-2xl shadow-card-md border border-black/[0.06] p-3.5 flex items-center gap-3 w-52"
      style={{ left: x, top: y }}
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay, duration: 0.7, ease: [0.16, 1, 0.3, 1] }}
    >
      <motion.div animate={{ y: [0, -4, 0] }} transition={{ duration: 4 + delay, repeat: Infinity, ease: 'easeInOut' }}>
        <div className="w-9 h-9 rounded-full bg-brand-pale flex items-center justify-center text-brand text-xs font-bold flex-shrink-0">
          {initials}
        </div>
      </motion.div>
      <div className="min-w-0">
        <p className="text-[11px] font-semibold text-ink truncate">{name}</p>
        <p className="text-[10px] text-mist">{time}</p>
      </div>
      <div className="ml-auto text-right flex-shrink-0">
        <p className="text-[12px] font-bold text-brand">{amount}</p>
        <div className="flex items-center gap-1 justify-end mt-0.5">
          <div className="w-1.5 h-1.5 rounded-full bg-emerald-400"/>
          <span className="text-[9px] text-mist">paid</span>
        </div>
      </div>
    </motion.div>
  )
}

function PayoutBadge({ delay }: { delay: number }) {
  return (
    <motion.div
      className="absolute right-[5%] top-[38%] bg-brand text-warm rounded-2xl shadow-dark-md p-4 w-44"
      initial={{ opacity: 0, scale: 0.9 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={{ delay, duration: 0.6, ease: [0.16, 1, 0.3, 1] }}
    >
      <motion.div animate={{ y: [0, -6, 0] }} transition={{ duration: 5, repeat: Infinity, ease: 'easeInOut' }}>
        <p className="text-[10px] font-semibold text-lime uppercase tracking-wider mb-1">Next Payout</p>
        <p className="text-[18px] font-bold text-white tracking-tight">₦600,000</p>
        <p className="text-[11px] text-white/50 mt-1">Amara Osei · May 19</p>
        <div className="mt-3 h-1 bg-white/10 rounded-full overflow-hidden">
          <motion.div className="h-full bg-lime rounded-full"
            initial={{ width: 0 }} animate={{ width: '82%' }}
            transition={{ delay: delay + 0.4, duration: 1, ease: [0.16, 1, 0.3, 1] }}
          />
        </div>
        <p className="text-[9px] text-white/40 mt-1">9 / 12 collected · sample</p>
      </motion.div>
    </motion.div>
  )
}

function ProgressRing({ delay }: { delay: number }) {
  const r = 22
  const circ = 2 * Math.PI * r
  return (
    <motion.div
      className="absolute left-[3%] bottom-[25%] bg-white rounded-2xl shadow-card-md border border-black/[0.06] p-4 w-40"
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay, duration: 0.6, ease: [0.16, 1, 0.3, 1] }}
    >
      <motion.div animate={{ y: [0, -5, 0] }} transition={{ duration: 6, repeat: Infinity, ease: 'easeInOut' }}>
        <p className="text-[10px] font-semibold text-mist uppercase tracking-wider mb-2.5">Group health</p>
        <div className="relative w-14 h-14 mx-auto">
          <svg width="56" height="56" viewBox="0 0 56 56">
            <circle cx="28" cy="28" r={r} fill="none" stroke="#EDE9E1" strokeWidth="5"/>
            <motion.circle
              cx="28" cy="28" r={r} fill="none" stroke="#1B5C3C" strokeWidth="5"
              strokeDasharray={circ} strokeLinecap="round"
              transform="rotate(-90 28 28)"
              initial={{ strokeDashoffset: circ }}
              animate={{ strokeDashoffset: circ * 0.08 }}
              transition={{ delay: delay + 0.3, duration: 1.2, ease: [0.16, 1, 0.3, 1] }}
            />
          </svg>
          <div className="absolute inset-0 flex items-center justify-center">
            <span className="text-[13px] font-bold text-ink">92%</span>
          </div>
        </div>
        <p className="text-center text-[10px] text-mist mt-1.5">Collection rate · sample</p>
      </motion.div>
    </motion.div>
  )
}

// ── Tech text animation ───────────────────────────────────────
const GLYPHS = '01<>/\\{}[]#$%&*+=?'
const scramble = (t: string) =>
  t.split('').map(c => (c === ' ' ? ' ' : GLYPHS[Math.floor(Math.random() * GLYPHS.length)])).join('')

function ScrambleText({ text, delay = 0, duration = 1300, shimmer = false }: {
  text: string; delay?: number; duration?: number; shimmer?: boolean
}) {
  const reduce = typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches
  const [out, setOut] = useState(() => (reduce ? text : scramble(text)))

  useEffect(() => {
    if (reduce) { setOut(text); return }
    let raf = 0
    let last = 0
    const begin = performance.now() + delay
    const tick = (now: number) => {
      if (now - last > 45) {
        last = now
        const p = Math.min(Math.max((now - begin) / duration, 0), 1)
        const reveal = Math.floor(p * text.length)
        setOut(text.split('').map((c, i) => (c === ' ' ? ' ' : i < reveal ? c : GLYPHS[Math.floor(Math.random() * GLYPHS.length)])).join(''))
        if (p >= 1) { setOut(text); return }
      }
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [text, delay, duration, reduce])

  // Brand green text with a lime glint sweeping across on a loop
  const shimmerStyle = shimmer ? {
    backgroundImage: 'linear-gradient(100deg, #1B5C3C 0%, #1B5C3C 42%, #A8E03A 50%, #1B5C3C 58%, #1B5C3C 100%)',
    backgroundSize: '250% 100%',
    WebkitBackgroundClip: 'text',
    backgroundClip: 'text',
    WebkitTextFillColor: 'transparent',
  } as React.CSSProperties : undefined

  return (
    <span className="relative inline-block whitespace-nowrap" aria-label={text}>
      <span className="invisible" aria-hidden>{text}</span>
      <motion.span
        aria-hidden
        className="absolute left-0 top-0 whitespace-nowrap"
        style={shimmerStyle}
        animate={shimmer ? { backgroundPosition: ['120% 0', '-120% 0'] } : undefined}
        transition={shimmer ? { duration: 3.2, repeat: Infinity, ease: 'linear', delay: 2.4 } : undefined}
      >
        {out}
      </motion.span>
    </span>
  )
}

// ── Hero ──────────────────────────────────────────────────────
function Hero() {
  const mouse  = useMouseParallax(0.018)
  const ref    = useRef(null)
  const { scrollYProgress } = useScroll({ target: ref, offset: ['start start', 'end start'] })
  const heroY  = useTransform(scrollYProgress, [0, 1], [0, 80])
  const heroO  = useTransform(scrollYProgress, [0, 0.6], [1, 0])

  return (
    <section ref={ref} className="relative min-h-screen bg-warm flex flex-col items-center justify-center overflow-hidden">
      <div className="absolute inset-0 opacity-[0.015]"
        style={{ backgroundImage: 'linear-gradient(#111009 1px,transparent 1px),linear-gradient(90deg,#111009 1px,transparent 1px)', backgroundSize: '64px 64px' }}
      />
      <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[500px] h-[500px] rounded-full bg-brand-pale/40 blur-[100px] pointer-events-none"/>

      <motion.div
        className="relative z-10 text-center px-5 sm:px-6 max-w-4xl mx-auto w-full pt-20"
        style={{ y: heroY, opacity: heroO }}
      >
        <motion.div
          className="inline-flex items-center gap-2 bg-white border border-black/[0.07] rounded-full px-4 py-1.5 mb-7 sm:mb-8 shadow-card"
          initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, ease: [0.16, 1, 0.3, 1] }}
        >
          <div className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse-soft"/>
          <span className="text-[11px] sm:text-[12px] font-semibold text-dim">Digital Ajo &amp; Esusu savings groups</span>
        </motion.div>

        <motion.h1
          className="text-[40px] sm:text-[56px] md:text-[72px] font-extrabold tracking-[-0.04em] text-ink leading-[1.05] mb-5 sm:mb-6"
          initial={{ opacity: 0, y: 24 }} animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.1, duration: 0.7, ease: [0.16, 1, 0.3, 1] }}
        >
          <ScrambleText text="Save Together." delay={200} /><br/>
          <ScrambleText text="Grow Together." delay={900} shimmer />
        </motion.h1>

        <motion.p
          className="text-[15px] sm:text-[17px] md:text-[19px] text-dim leading-relaxed max-w-xl mx-auto mb-9 sm:mb-10 font-normal"
          initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.2, duration: 0.6, ease: [0.16, 1, 0.3, 1] }}
        >
          The digital platform for Ajo, Esusu &amp; Susu —
          helping your group track contributions and payouts with full transparency.
        </motion.p>

        <motion.div
          className="flex flex-col sm:flex-row items-center justify-center gap-3 flex-wrap"
          initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.3, duration: 0.5 }}
        >
          <Link to="/register"
            className="w-full sm:w-auto inline-flex items-center justify-center gap-2 bg-ink text-warm text-[14px] font-bold px-7 py-4 rounded-xl hover:bg-pitch transition-all hover:shadow-dark-sm active:scale-[0.98]">
            Get started
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
              <path d="M3 7H11M11 7L7.5 3.5M11 7L7.5 10.5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
          </Link>
          <a href="#how-it-works"
            className="w-full sm:w-auto inline-flex items-center justify-center gap-2 bg-white border border-black/[0.08] text-ink text-[14px] font-semibold px-7 py-4 rounded-xl hover:border-black/20 transition-all hover:shadow-card active:scale-[0.98]">
            See how it works
          </a>
        </motion.div>
      </motion.div>

      <motion.div
        className="absolute inset-0 pointer-events-none hidden md:block"
        style={{ x: mouse.x * -1, y: mouse.y * -1 }}
      >
        <FloatingCard name="Adaeze Kalu" initials="AK" amount="₦50,000" time="2 min ago"  delay={0.6}  x="6%" y="28%"/>
        <FloatingCard name="Emeka Obi"   initials="EO" amount="₦50,000" time="14 min ago" delay={0.75} x="4%" y="52%"/>
        <PayoutBadge delay={0.65}/>
        <ProgressRing delay={0.8}/>
      </motion.div>

      <motion.div
        className="absolute bottom-7 left-1/2 -translate-x-1/2 flex flex-col items-center gap-2"
        initial={{ opacity: 0 }} animate={{ opacity: 1 }}
        transition={{ delay: 1.2 }}
      >
        <div className="w-[1px] h-8 bg-gradient-to-b from-transparent to-stone"/>
        <p className="text-[10px] font-semibold text-mist uppercase tracking-widest">Scroll</p>
      </motion.div>
    </section>
  )
}

// ── Payment partners ──────────────────────────────────────────
const logos = ['Paystack', 'Flutterwave']

function TrustedBy() {
  const [ref, inView] = useInView()
  return (
    <section ref={ref} className="py-14 sm:py-16 bg-white border-y border-black/[0.05]">
      <div className="max-w-5xl mx-auto px-5 sm:px-6">
        <motion.p
          className="text-center text-[11px] sm:text-[12px] font-semibold text-mist uppercase tracking-widest mb-7 sm:mb-8"
          initial={{ opacity: 0 }} animate={inView ? { opacity: 1 } : {}}
          transition={{ duration: 0.5 }}
        >
          Payments processed by
        </motion.p>
        <div className="flex flex-wrap items-center justify-center gap-6 sm:gap-10 md:gap-14">
          {logos.map((l, i) => (
            <motion.div key={l}
              className="text-[15px] sm:text-[17px] font-bold text-stone tracking-tight hover:text-dim transition-colors cursor-default"
              initial={{ opacity: 0 }} animate={inView ? { opacity: 1 } : {}}
              transition={{ delay: i * 0.06, duration: 0.4 }}
            >{l}</motion.div>
          ))}
        </div>
      </div>
    </section>
  )
}

// ── How It Works ──────────────────────────────────────────────
function HowItWorks() {
  const [ref, inView] = useInView(0.1)
  const steps = [
    { num: '01', title: 'Create or join a group', body: 'Start a new Ajo circle with custom rules, or join an existing one with an invite link. Set contribution amounts, frequency, and payout order.' },
    { num: '02', title: 'Contribute on schedule', body: 'Pay by card or bank transfer through our payment partners. Every payment is logged and visible to group members.' },
    { num: '03', title: 'Receive your payout',    body: "When it's your turn, the payout is sent to your bank account on the agreed date." },
  ]
  return (
    <section id="how-it-works" ref={ref} className="py-20 sm:py-24 bg-warm">
      <div className="max-w-5xl mx-auto px-5 sm:px-6">
        <motion.div className="mb-12 sm:mb-16 max-w-lg"
          initial={{ opacity: 0, y: 20 }} animate={inView ? { opacity: 1, y: 0 } : {}}
          transition={{ duration: 0.6, ease: [0.16, 1, 0.3, 1] }}
        >
          <p className="text-[11px] font-bold text-brand uppercase tracking-widest mb-3">How it works</p>
          <h2 className="text-[34px] sm:text-[38px] md:text-[46px] font-extrabold tracking-[-0.04em] text-ink leading-tight">
            Three steps to community savings
          </h2>
        </motion.div>
        <div className="grid sm:grid-cols-2 md:grid-cols-3 gap-5">
          {steps.map((s, i) => (
            <motion.div key={s.num}
              className="bg-white rounded-2xl border border-black/[0.06] p-6 sm:p-7 relative overflow-hidden hover:shadow-card-md transition-all duration-300 hover:-translate-y-1"
              initial={{ opacity: 0, y: 24 }} animate={inView ? { opacity: 1, y: 0 } : {}}
              transition={{ delay: i * 0.1, duration: 0.6, ease: [0.16, 1, 0.3, 1] }}
            >
              <div className="absolute top-5 right-5 text-[44px] font-black text-black/[0.04] leading-none select-none">{s.num}</div>
              <div className="w-10 h-10 bg-brand-pale rounded-xl flex items-center justify-center mb-5">
                <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
                  <circle cx="10" cy="10" r="8" stroke="#1B5C3C" strokeWidth="1.5"/>
                  <path d="M10 6V10L13 13" stroke="#1B5C3C" strokeWidth="1.5" strokeLinecap="round"/>
                </svg>
              </div>
              <h3 className="text-[15px] sm:text-[16px] font-bold text-ink tracking-tight mb-2">{s.title}</h3>
              <p className="text-[13px] text-dim leading-relaxed">{s.body}</p>
            </motion.div>
          ))}
        </div>
      </div>
    </section>
  )
}

// ── Contribution Tracking ─────────────────────────────────────
function TrackingSection() {
  const [ref, inView] = useInView(0.1)
  return (
    <section id="features" ref={ref} className="py-20 sm:py-24 bg-white">
      <div className="max-w-5xl mx-auto px-5 sm:px-6">
        <div className="grid md:grid-cols-2 gap-10 md:gap-16 items-center">
          <motion.div
            initial={{ opacity: 0, x: -24 }} animate={inView ? { opacity: 1, x: 0 } : {}}
            transition={{ duration: 0.7, ease: [0.16, 1, 0.3, 1] }}
          >
            <p className="text-[11px] font-bold text-brand uppercase tracking-widest mb-3">Contribution tracking</p>
            <h2 className="text-[32px] sm:text-[36px] md:text-[42px] font-extrabold tracking-[-0.04em] text-ink leading-tight mb-5">
              Know exactly where every naira stands
            </h2>
            <p className="text-[14px] sm:text-[15px] text-dim leading-relaxed mb-7">
              Contribution status for every member, payment reminders, receipts and a complete record of group activity.
            </p>
            <div className="space-y-4">
              {[
                ['Payment reminders',         'Before contributions are due'],
                ['Receipts',                  'Sent by email or SMS when you pay'],
                ['Live collection dashboard', 'See who has paid at a glance'],
              ].map(([title, sub]) => (
                <div key={title} className="flex items-start gap-3">
                  <div className="w-5 h-5 rounded-full bg-brand-pale flex items-center justify-center flex-shrink-0 mt-0.5">
                    <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
                      <path d="M2 5L4.5 7.5L8 3" stroke="#1B5C3C" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                    </svg>
                  </div>
                  <div>
                    <p className="text-[13px] font-semibold text-ink">{title}</p>
                    <p className="text-[12px] text-mist">{sub}</p>
                  </div>
                </div>
              ))}
            </div>
          </motion.div>

          <motion.div
            initial={{ opacity: 0, x: 24 }} animate={inView ? { opacity: 1, x: 0 } : {}}
            transition={{ delay: 0.15, duration: 0.7, ease: [0.16, 1, 0.3, 1] }}
            className="bg-warm rounded-2xl border border-black/[0.06] p-4 sm:p-5 shadow-card"
          >
            <div className="flex items-center justify-between mb-4">
              <p className="text-[12px] sm:text-[13px] font-bold text-ink">Sample group — Week 5</p>
              <span className="text-[10px] font-semibold text-amber-600 bg-amber-50 border border-amber-100 px-2 py-0.5 rounded-full">In progress</span>
            </div>
            <div className="mb-4">
              <div className="flex justify-between text-[10px] sm:text-[11px] text-mist mb-1.5">
                <span>₦540,000 collected</span><span>₦600,000 target</span>
              </div>
              <div className="h-2 bg-sand rounded-full overflow-hidden">
                <motion.div className="h-full bg-brand rounded-full"
                  initial={{ width: 0 }} animate={inView ? { width: '90%' } : {}}
                  transition={{ delay: 0.5, duration: 1.1, ease: [0.16, 1, 0.3, 1] }}
                />
              </div>
              <p className="text-[10px] text-mist mt-1">9 of 12 members paid</p>
            </div>
            <div className="space-y-1.5">
              {[
                { name: 'Adaeze Kalu',  initials: 'AK', status: 'paid',    time: '9:41 AM'  },
                { name: 'Emeka Obi',    initials: 'EO', status: 'paid',    time: '10:02 AM' },
                { name: 'Fola Adeyemi', initials: 'FA', status: 'pending', time: ''         },
                { name: 'Kemi Hassan',  initials: 'KH', status: 'paid',    time: '11:15 AM' },
                { name: 'Chidi Nwosu',  initials: 'CN', status: 'overdue', time: ''         },
              ].map((m, i) => (
                <motion.div key={m.name}
                  className="flex items-center gap-2 sm:gap-3 py-2 border-b border-black/[0.04] last:border-0"
                  initial={{ opacity: 0, x: 12 }} animate={inView ? { opacity: 1, x: 0 } : {}}
                  transition={{ delay: 0.3 + i * 0.07, duration: 0.4 }}
                >
                  <div className="w-7 h-7 rounded-full bg-brand-pale flex items-center justify-center text-[9px] font-bold text-brand flex-shrink-0">
                    {m.initials}
                  </div>
                  <span className="flex-1 min-w-0 text-[12px] font-medium text-ink truncate">{m.name}</span>
                  {m.time && <span className="text-[10px] text-mist font-mono hidden sm:block">{m.time}</span>}
                  <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full flex-shrink-0 ${
                    m.status === 'paid'    ? 'text-green-700 bg-green-50' :
                    m.status === 'overdue' ? 'text-red-600 bg-red-50' :
                                             'text-amber-600 bg-amber-50'
                  }`}>{m.status}</span>
                </motion.div>
              ))}
            </div>
          </motion.div>
        </div>
      </div>
    </section>
  )
}

// ── Payout Rotation ───────────────────────────────────────────
function PayoutRotationSection() {
  const [ref, inView] = useInView(0.1)
  return (
    <section ref={ref} className="py-20 sm:py-24 bg-warm">
      <div className="max-w-5xl mx-auto px-5 sm:px-6">
        <motion.div className="text-center mb-12 sm:mb-14"
          initial={{ opacity: 0, y: 20 }} animate={inView ? { opacity: 1, y: 0 } : {}}
          transition={{ duration: 0.6, ease: [0.16, 1, 0.3, 1] }}
        >
          <p className="text-[11px] font-bold text-brand uppercase tracking-widest mb-3">Payout rotation</p>
          <h2 className="text-[34px] sm:text-[38px] md:text-[46px] font-extrabold tracking-[-0.04em] text-ink">Know when it's your turn</h2>
          <p className="text-[14px] sm:text-[15px] text-dim mt-4 max-w-md mx-auto">Every member sees exactly when they receive their payout. No surprises.</p>
        </motion.div>

        <div className="relative">
          <div className="absolute top-8 left-0 right-0 h-[1px] bg-stone/50 hidden md:block"/>
          <motion.div className="absolute top-8 left-0 h-[1px] bg-brand hidden md:block"
            initial={{ width: 0 }} animate={inView ? { width: '37.5%' } : {}}
            transition={{ delay: 0.4, duration: 1, ease: [0.16, 1, 0.3, 1] }}
          />
          <div className="grid grid-cols-4 md:grid-cols-8 gap-2 sm:gap-3">
            {payoutRotation.map((p, i) => (
              <motion.div key={p.pos} className="flex flex-col items-center gap-2"
                initial={{ opacity: 0, y: 16 }} animate={inView ? { opacity: 1, y: 0 } : {}}
                transition={{ delay: 0.1 + i * 0.07, duration: 0.5, ease: [0.16, 1, 0.3, 1] }}
              >
                <div className={`w-12 h-12 sm:w-14 sm:h-14 md:w-16 md:h-16 rounded-xl flex flex-col items-center justify-center border-2 transition-all ${
                  p.current ? 'bg-brand border-brand shadow-dark-sm scale-110' :
                  p.done    ? 'bg-brand-pale border-brand-pale' :
                              'bg-white border-stone'
                }`}>
                  <span className={`text-[10px] sm:text-[11px] font-extrabold ${p.current ? 'text-lime' : p.done ? 'text-brand' : 'text-ink'}`}>
                    {p.initials}
                  </span>
                  {p.done && !p.current && (
                    <svg width="10" height="10" viewBox="0 0 10 10" fill="none" className="mt-0.5">
                      <path d="M2 5L4 7L8 3" stroke="#1B5C3C" strokeWidth="1.5" strokeLinecap="round"/>
                    </svg>
                  )}
                  {p.current && <div className="w-1.5 h-1.5 rounded-full bg-lime mt-0.5 animate-pulse-soft"/>}
                </div>
                <div className="text-center">
                  <p className={`text-[9px] sm:text-[10px] font-bold leading-tight ${p.current ? 'text-brand' : 'text-dim'}`}>
                    {p.name.split(' ')[0]}
                  </p>
                  <p className={`text-[8px] sm:text-[9px] font-mono ${p.current ? 'text-brand' : 'text-mist'}`}>{p.date}</p>
                </div>
                {p.current && <span className="text-[8px] font-bold text-white bg-brand px-1.5 py-0.5 rounded-full">Next</span>}
              </motion.div>
            ))}
          </div>
        </div>

        <motion.div
          className="mt-8 sm:mt-10 bg-white rounded-2xl border border-black/[0.06] p-5 sm:p-6 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-5 shadow-card"
          initial={{ opacity: 0, y: 16 }} animate={inView ? { opacity: 1, y: 0 } : {}}
          transition={{ delay: 0.6, duration: 0.6, ease: [0.16, 1, 0.3, 1] }}
        >
          <div>
            <p className="text-[12px] text-mist font-semibold mb-1">Sample payout — May 19</p>
            <p className="text-[28px] sm:text-[32px] font-extrabold tracking-tight text-ink">₦600,000</p>
            <p className="text-[12px] text-dim mt-1">To Amara Osei · Bank account ****4521</p>
          </div>
          <div className="flex items-center gap-3 flex-wrap">
            {[
              ['Collected',    '₦540K', 'bg-warm',       'text-ink'],
              ['Remaining',    '₦60K',  'bg-warm',       'text-amber-600'],
              ['Members paid', '9/12',  'bg-brand-pale', 'text-brand'],
            ].map(([label, val, bg, col]) => (
              <div key={label} className={`text-center px-4 py-2.5 ${bg} rounded-xl`}>
                <p className="text-[10px] sm:text-[11px] text-mist font-semibold">{label}</p>
                <p className={`text-[16px] sm:text-[18px] font-bold ${col}`}>{val}</p>
              </div>
            ))}
          </div>
        </motion.div>
      </div>
    </section>
  )
}

// ── Analytics Preview ─────────────────────────────────────────
function AnalyticsPreview() {
  const [ref, inView] = useInView(0.1)
  return (
    <section ref={ref} className="py-20 sm:py-24 bg-void overflow-hidden relative">
      <div className="absolute top-0 left-1/2 -translate-x-1/2 w-[500px] h-[300px] bg-brand/10 blur-[100px] pointer-events-none"/>
      <div className="max-w-5xl mx-auto px-5 sm:px-6">
        <motion.div className="text-center mb-12 sm:mb-14"
          initial={{ opacity: 0, y: 20 }} animate={inView ? { opacity: 1, y: 0 } : {}}
          transition={{ duration: 0.6, ease: [0.16, 1, 0.3, 1] }}
        >
          <p className="text-[11px] font-bold text-lime uppercase tracking-widest mb-3">Analytics</p>
          <h2 className="text-[34px] sm:text-[38px] md:text-[46px] font-extrabold tracking-[-0.04em] text-white leading-tight">
            Total visibility.<br/>Zero guesswork.
          </h2>
          <p className="text-[14px] sm:text-[15px] text-white/40 mt-4 max-w-md mx-auto">
            Every contribution, payout, and trend for your group, in one place.
          </p>
        </motion.div>

        <motion.div
          className="bg-pitch rounded-2xl sm:rounded-3xl border border-white/[0.06] overflow-hidden shadow-dark-md"
          initial={{ opacity: 0, y: 32 }} animate={inView ? { opacity: 1, y: 0 } : {}}
          transition={{ delay: 0.2, duration: 0.8, ease: [0.16, 1, 0.3, 1] }}
        >
          <div className="px-4 sm:px-6 py-3 sm:py-4 border-b border-white/[0.06] flex items-center justify-between">
            <div className="flex items-center gap-1.5 sm:gap-2">
              {[0,1,2].map(n => <div key={n} className="w-2 sm:w-2.5 h-2 sm:h-2.5 rounded-full bg-white/10"/>)}
            </div>
            <div className="flex items-center gap-2 text-[10px] sm:text-[11px] text-white/30 font-mono">
              <div className="w-1.5 h-1.5 rounded-full bg-lime animate-pulse-soft"/>
              <span className="hidden sm:inline">Sample dashboard preview</span>
              <span className="sm:hidden">Sample preview</span>
            </div>
            <div className="w-16"/>
          </div>

          <div className="p-4 sm:p-6">
            <div className="grid grid-cols-3 gap-2 sm:gap-4 mb-5 sm:mb-6">
              {[
                { label: 'Collected',       value: '₦540K',  delta: 'this cycle'  },
                { label: 'Members paid',    value: '9 / 12', delta: 'on schedule' },
                { label: 'Collection rate', value: '92%',    delta: 'sample group'},
              ].map((m, i) => (
                <motion.div key={m.label}
                  className="bg-white/[0.04] rounded-xl p-2.5 sm:p-4 border border-white/[0.06]"
                  initial={{ opacity: 0 }} animate={inView ? { opacity: 1 } : {}}
                  transition={{ delay: 0.4 + i * 0.08 }}
                >
                  <p className="text-[8px] sm:text-[10px] text-white/30 font-semibold uppercase tracking-wider mb-1 sm:mb-1.5 leading-tight">
                    {m.label}
                  </p>
                  <p className="text-[14px] sm:text-[22px] font-extrabold text-white tracking-tight">{m.value}</p>
                  <p className="text-[8px] sm:text-[10px] text-lime font-semibold mt-0.5 sm:mt-1">{m.delta}</p>
                </motion.div>
              ))}
            </div>

            <div className="bg-white/[0.03] rounded-xl sm:rounded-2xl border border-white/[0.05] p-3 sm:p-5">
              <div className="flex items-center justify-between mb-3 sm:mb-5">
                <p className="text-[11px] sm:text-[13px] font-bold text-white">
                  Weekly collection — sample group
                </p>
                <span className="text-[9px] sm:text-[10px] text-white/30 font-mono">Last 6 weeks</span>
              </div>
              <div className="flex items-end gap-1.5 sm:gap-3 h-20 sm:h-28">
                {weeklyData.map((d, i) => {
                  const pct = Math.round((d.collected / d.target) * 100)
                  return (
                    <div key={d.week} className="flex-1 flex flex-col items-center gap-1">
                      <p className="text-[7px] sm:text-[9px] font-mono text-white/30">{pct}%</p>
                      <div className="w-full bg-white/[0.06] rounded-md overflow-hidden flex items-end" style={{ height: 60 }}>
                        <motion.div
                          className={`w-full rounded-sm sm:rounded-md ${pct === 100 ? 'bg-lime' : 'bg-brand'}`}
                          initial={{ height: 0 }}
                          animate={inView ? { height: `${pct}%` } : {}}
                          transition={{ delay: 0.5 + i * 0.07, duration: 0.8, ease: [0.16, 1, 0.3, 1] }}
                        />
                      </div>
                      <p className="text-[7px] sm:text-[9px] text-white/30 font-mono">{d.week}</p>
                    </div>
                  )
                })}
              </div>
            </div>
          </div>
        </motion.div>
      </div>
    </section>
  )
}

// ── Security ──────────────────────────────────────────────────
function Security() {
  const [ref, inView] = useInView(0.1)
  const pillars = [
    { title: 'Encrypted connections',    body: 'Data is sent over HTTPS/TLS between your device and our servers.' },
    { title: 'Trusted payment partners', body: 'Card and bank payments are processed by Paystack and Flutterwave.' },
    { title: 'Full audit trail',         body: 'Contributions and payouts are timestamped and recorded for group members.' },
    { title: 'Verified accounts',        body: 'Members verify their identity and set a transaction PIN before moving money.' },
  ]
  return (
    <section id="security" ref={ref} className="py-20 sm:py-24 bg-white">
      <div className="max-w-5xl mx-auto px-5 sm:px-6">
        <motion.div className="text-center mb-12 sm:mb-14"
          initial={{ opacity: 0, y: 20 }} animate={inView ? { opacity: 1, y: 0 } : {}}
          transition={{ duration: 0.6, ease: [0.16, 1, 0.3, 1] }}
        >
          <p className="text-[11px] font-bold text-brand uppercase tracking-widest mb-3">Security</p>
          <h2 className="text-[34px] sm:text-[38px] md:text-[46px] font-extrabold tracking-[-0.04em] text-ink">Built with care</h2>
          <p className="text-[14px] sm:text-[15px] text-dim mt-4 max-w-sm mx-auto">Your data and payments are handled with care.</p>
        </motion.div>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 sm:gap-5">
          {pillars.map((p, i) => (
            <motion.div key={p.title}
              className="p-4 sm:p-6 rounded-2xl bg-warm border border-black/[0.05] hover:shadow-card transition-all duration-200 hover:-translate-y-1"
              initial={{ opacity: 0, y: 20 }} animate={inView ? { opacity: 1, y: 0 } : {}}
              transition={{ delay: i * 0.08, duration: 0.5, ease: [0.16, 1, 0.3, 1] }}
            >
              <div className="w-8 sm:w-9 h-8 sm:h-9 bg-brand-pale rounded-xl flex items-center justify-center mb-3 sm:mb-4">
                <svg width="18" height="18" viewBox="0 0 20 20" fill="none">
                  <path d="M10 2L4 5V10C4 13.31 6.67 16.41 10 17C13.33 16.41 16 13.31 16 10V5L10 2Z" stroke="#1B5C3C" strokeWidth="1.5" strokeLinejoin="round"/>
                  <path d="M7.5 10L9 11.5L12.5 8" stroke="#1B5C3C" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                </svg>
              </div>
              <h3 className="text-[13px] sm:text-[14px] font-bold text-ink mb-1 sm:mb-1.5 leading-tight">{p.title}</h3>
              <p className="text-[11px] sm:text-[12px] text-dim leading-relaxed">{p.body}</p>
            </motion.div>
          ))}
        </div>
      </div>
    </section>
  )
}

// ── FAQ ───────────────────────────────────────────────────────
function FAQ() {
  const [open, setOpen] = useState<number | null>(null)
  const [ref, inView]   = useInView(0.1)
  return (
    <section id="faq" ref={ref} className="py-20 sm:py-24 bg-warm">
      <div className="max-w-3xl mx-auto px-5 sm:px-6">
        <motion.div className="text-center mb-10 sm:mb-12"
          initial={{ opacity: 0, y: 20 }} animate={inView ? { opacity: 1, y: 0 } : {}}
          transition={{ duration: 0.6, ease: [0.16, 1, 0.3, 1] }}
        >
          <p className="text-[11px] font-bold text-brand uppercase tracking-widest mb-3">FAQ</p>
          <h2 className="text-[34px] sm:text-[38px] md:text-[46px] font-extrabold tracking-[-0.04em] text-ink">Common questions</h2>
        </motion.div>
        <div className="space-y-2 sm:space-y-3">
          {faqs.map((f, i) => (
            <motion.div key={f.q}
              className="bg-white rounded-2xl border border-black/[0.06] overflow-hidden"
              initial={{ opacity: 0, y: 12 }} animate={inView ? { opacity: 1, y: 0 } : {}}
              transition={{ delay: i * 0.07, duration: 0.5, ease: [0.16, 1, 0.3, 1] }}
            >
              <button
                className="w-full flex items-center justify-between gap-3 sm:gap-4 px-4 sm:px-6 py-4 sm:py-5 text-left hover:bg-warm/50 transition-colors"
                onClick={() => setOpen(open === i ? null : i)}
              >
                <span className="text-[13px] sm:text-[14px] font-semibold text-ink">{f.q}</span>
                <motion.div
                  animate={{ rotate: open === i ? 45 : 0 }}
                  transition={{ duration: 0.2, ease: [0.16, 1, 0.3, 1] }}
                  className="flex-shrink-0 w-6 h-6 rounded-full bg-warm border border-black/[0.08] flex items-center justify-center"
                >
                  <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
                    <path d="M5 2V8M2 5H8" stroke="#6B6760" strokeWidth="1.5" strokeLinecap="round"/>
                  </svg>
                </motion.div>
              </button>
              <AnimatePresence>
                {open === i && (
                  <motion.div
                    initial={{ height: 0, opacity: 0 }}
                    animate={{ height: 'auto', opacity: 1 }}
                    exit={{ height: 0, opacity: 0 }}
                    transition={{ duration: 0.25, ease: [0.16, 1, 0.3, 1] }}
                    className="overflow-hidden"
                  >
                    <p className="px-4 sm:px-6 pb-4 sm:pb-5 text-[13px] text-dim leading-relaxed border-t border-black/[0.04] pt-4">
                      {f.a}
                    </p>
                  </motion.div>
                )}
              </AnimatePresence>
            </motion.div>
          ))}
        </div>
      </div>
    </section>
  )
}

// ── CTA Banner ────────────────────────────────────────────────
function CTABanner() {
  const [ref, inView] = useInView(0.2)
  return (
    <section ref={ref} className="py-20 sm:py-24 bg-void relative overflow-hidden">
      <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[500px] h-[300px] bg-brand/15 blur-[120px] pointer-events-none"/>
      <div className="max-w-3xl mx-auto px-5 sm:px-6 text-center relative z-10">
        <motion.div
          initial={{ opacity: 0, y: 24 }} animate={inView ? { opacity: 1, y: 0 } : {}}
          transition={{ duration: 0.7, ease: [0.16, 1, 0.3, 1] }}
        >
          <p className="text-[11px] font-bold text-lime uppercase tracking-widest mb-4">Join AjoDaddy</p>
          <h2 className="text-[40px] sm:text-[48px] md:text-[60px] font-extrabold tracking-[-0.05em] text-white leading-tight mb-5 sm:mb-6">
            Start saving<br/>with your people.
          </h2>
          <p className="text-[14px] sm:text-[16px] text-white/40 mb-8 sm:mb-10 max-w-md mx-auto">
            Set up your first group in minutes and invite people you know and trust.
          </p>
          <div className="flex flex-col sm:flex-row items-center justify-center gap-3 flex-wrap">
            <Link to="/register"
              className="w-full sm:w-auto inline-flex items-center justify-center gap-2 bg-lime text-ink text-[14px] font-bold px-7 py-4 rounded-xl hover:bg-lime/90 transition-all active:scale-[0.98]">
              Create your group
              <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                <path d="M3 7H11M11 7L7.5 3.5M11 7L7.5 10.5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
            </Link>
            <Link to="/login"
              className="w-full sm:w-auto inline-flex items-center justify-center text-white/70 text-[14px] font-semibold px-7 py-4 rounded-xl border border-white/10 hover:border-white/20 hover:text-white transition-all">
              Sign in instead
            </Link>
          </div>
        </motion.div>
      </div>
    </section>
  )
}

// ── Footer ────────────────────────────────────────────────────
function Footer() {
  return (
    <footer className="bg-pitch border-t border-white/[0.05] pt-12 pb-8">
      <div className="max-w-5xl mx-auto px-5 sm:px-6">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-x-6 gap-y-10 mb-10">
          <div className="col-span-2">
            <img src={LOGO_URL} alt="AjoDaddy" className="h-12 md:h-20 w-auto object-contain mb-4" />
            <p className="text-[13px] text-white/40 leading-relaxed max-w-sm">
              AjoDaddy is a product of <strong className="text-white/70 font-semibold">Banji Digital Technologies</strong>{' '}
              (Business Name Registration No. 9693887), registered with the Corporate Affairs Commission of Nigeria.
            </p>
            <p className="text-[13px] text-white/40 leading-relaxed max-w-sm mt-3">
              [FULL STREET ADDRESS], Ikeja, Lagos State, Nigeria
              <br />
              <a href="mailto:[SUPPORT EMAIL]" className="text-lime font-medium underline">[SUPPORT EMAIL]</a>
            </p>
          </div>

          <div>
            <p className="text-[10px] sm:text-[11px] font-bold text-white/40 uppercase tracking-widest mb-4">Product</p>
            <ul className="space-y-3">
              {navLinks.map(([label, href]) => (
                <li key={label}><a href={href} className="text-[13px] text-white/40 hover:text-white/70 transition-colors font-medium">{label}</a></li>
              ))}
            </ul>
          </div>

          <div>
            <p className="text-[10px] sm:text-[11px] font-bold text-white/40 uppercase tracking-widest mb-4">Legal</p>
            <ul className="space-y-3">
              <li><Link to="/privacy" className="text-[13px] text-white/40 hover:text-white/70 transition-colors font-medium">Privacy Policy</Link></li>
              <li><Link to="/terms" className="text-[13px] text-white/40 hover:text-white/70 transition-colors font-medium">Terms of Service</Link></li>
            </ul>
          </div>
        </div>

        <div className="border-t border-white/[0.05] pt-6 flex flex-col sm:flex-row items-center justify-between gap-2 text-center sm:text-left">
          <p className="text-[11px] sm:text-[12px] text-white/25">
            © {new Date().getFullYear()} Banji Digital Technologies. All rights reserved.
          </p>
          <p className="text-[11px] sm:text-[12px] text-white/25 font-mono">Lagos, Nigeria</p>
        </div>
      </div>
    </footer>
  )
}

// ── Page export ───────────────────────────────────────────────
export default function LandingPage() {
  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.25 }}
    >
      <Nav />
      <Hero />
      <TrustedBy />
      <HowItWorks />
      <TrackingSection />
      <PayoutRotationSection />
      <AnalyticsPreview />
      <Security />
      <FAQ />
      <CTABanner />
      <Footer />
    </motion.div>
  )
}