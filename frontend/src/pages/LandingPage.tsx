// ============================================================
// LandingPage.tsx — all sections in one file, fully responsive
// ============================================================
import { useRef, useState, useEffect, useCallback } from 'react'
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

// ── Static data ───────────────────────────────────────────────
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

const testimonials = [
  { name: 'Chioma Okafor', role: 'Entrepreneur, Lagos',      initials: 'CO', text: "PayPaddy transformed how our group saves. Transparent, fast, and trustworthy. We've run 3 complete cycles without a single issue.", amount: '₦2.4M', label: 'Saved this year' },
  { name: 'David Mensah',  role: 'Software Engineer, Accra', initials: 'DM', text: "Finally an Ajo platform that feels like it was built by people who actually use it. The payout tracking alone is worth it.",           amount: '₦850K', label: 'Last payout received' },
  { name: 'Ngozi Eze',     role: 'Teacher, Abuja',           initials: 'NE', text: "I was sceptical at first, but PayPaddy's transparency won me over. Every member can see every transaction in real time.",               amount: '20+',   label: 'Members in her group' },
]

const faqs = [
  { q: 'What is Ajo and how does PayPaddy work?',            a: 'Ajo (also called Esusu or Susu) is a traditional rotating savings model where each member contributes a fixed amount regularly. PayPaddy digitises this — automating collections, tracking contributions, and scheduling payouts with full transparency.' },
  { q: 'How are payouts disbursed?',                         a: "Payouts go directly to the designated member's bank account or mobile wallet on the agreed date. No manual handling — fully automated and auditable." },
  { q: 'What happens if a member misses a contribution?',    a: "The system sends automated reminders 48h before due dates. If missed, admins are notified and the group's penalty rules are applied automatically." },
  { q: 'Is my money safe?',                                  a: 'Funds are held in regulated escrow accounts. PayPaddy is compliant with CBN guidelines and uses 256-bit encryption with bank-grade security infrastructure.' },
  { q: 'Can I create my own group or join an existing one?', a: 'Both. Create a private group and invite members, or join via a group invite link. Group admins control membership and contribution rules.' },
]

// ── Logo SVG (reused) ─────────────────────────────────────────
function Logo({ size = 8 }: { size?: number }) {
  const px = size * 4
  return (
    <div className={`w-${size} h-${size} bg-brand rounded-lg flex items-center justify-center flex-shrink-0`} style={{ width: px, height: px }}>
      <svg width={px * 0.55} height={px * 0.55} viewBox="0 0 16 16" fill="none">
        <path d="M8 2C8 2 3 5 3 9C3 11.76 5.24 14 8 14C10.76 14 13 11.76 13 9C13 5 8 2 8 2Z" fill="#A8E03A"/>
        <circle cx="8" cy="9" r="2" fill="#1B5C3C"/>
      </svg>
    </div>
  )
}

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
      className={`fixed top-0 inset-x-0 z-50 transition-all duration-300 ${scrolled ? 'bg-warm/90 backdrop-blur-md border-b border-black/[0.06]' : ''}`}
      initial={{ y: -20, opacity: 0 }}
      animate={{ y: 0, opacity: 1 }}
      transition={{ duration: 0.5, ease: [0.16, 1, 0.3, 1] }}
    >
      <div className="max-w-6xl mx-auto px-5 sm:px-6 h-16 flex items-center justify-between">
        {/* Brand */}
       <Link to="/">
  <img
    src="https://res.cloudinary.com/dmjakrnby/image/upload/v1785357030/real_logo_s3jtjp.png"
    alt="AjoDaddy"
    style={{ height: 'clamp(4cm, 2vw, 2cm)', marginTop: '1cm' }}
    className="w-auto object-contain flex-shrink-0"
  />
</Link> 

        {/* Desktop links */}
        <nav className="hidden md:flex items-center gap-7">
          {[['How it works','#how-it-works'],['Features','#features'],['Security','#security'],['FAQ','#faq']].map(([label, href]) => (
            <a key={label} href={href}
              className="text-[13px] font-medium text-dim hover:text-ink transition-colors duration-150">
              {label}
            </a>
          ))}
        </nav>

        {/* Desktop CTAs */}
        <div className="hidden md:flex items-center gap-3">
          <Link to="/login" className="text-[13px] font-semibold text-dim hover:text-ink transition-colors px-4 py-2">
            Log in
          </Link>
          <Link to="/register"
            className="text-[13px] font-bold text-warm bg-ink px-4 py-2.5 rounded-xl hover:bg-pitch transition-all hover:shadow-dark-sm">
            Get started free
          </Link>
        </div>

        {/* Hamburger */}
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

      {/* Mobile menu */}
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
              {[['How it works','#how-it-works'],['Features','#features'],['Security','#security'],['FAQ','#faq']].map(([label, href]) => (
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
                  Get started free
                </Link>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.header>
  )
}

// ── Hero floating UI cards ────────────────────────────────────
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
        <p className="text-[9px] text-white/40 mt-1">9 / 12 collected</p>
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
        <p className="text-center text-[10px] text-mist mt-1.5">Collection rate</p>
      </motion.div>
    </motion.div>
  )
}

// ── Hero ──────────────────────────────────────────────────────
function Hero() {
  const mouse  = useMouseParallax(0.018)
  const ref    = useRef(null)
  const { scrollYProgress } = useScroll({ target: ref, offset: ['start start', 'end start'] })
  const heroY  = useTransform(scrollYProgress, [0, 1], [0, 80])
  const heroO  = useTransform(scrollYProgress, [0, 0.6], [1, 0])

  const stats = [['₦4.2B', 'Total saved'], ['98.6%', 'Payout success'], ['12K+', 'Active groups']]

  return (
    <section ref={ref} className="relative min-h-screen bg-warm flex flex-col items-center justify-center overflow-hidden">
      {/* Grid BG */}
      <div className="absolute inset-0 opacity-[0.015]"
        style={{ backgroundImage: 'linear-gradient(#111009 1px,transparent 1px),linear-gradient(90deg,#111009 1px,transparent 1px)', backgroundSize: '64px 64px' }}
      />
      {/* Warm glow */}
      <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[500px] h-[500px] rounded-full bg-brand-pale/40 blur-[100px] pointer-events-none"/>

      {/* Main content */}
      <motion.div
        className="relative z-10 text-center px-5 sm:px-6 max-w-4xl mx-auto w-full"
        style={{ y: heroY, opacity: heroO }}
      >
        {/* Eyebrow */}
        <motion.div
          className="inline-flex items-center gap-2 bg-white border border-black/[0.07] rounded-full px-4 py-1.5 mb-7 sm:mb-8 shadow-card"
          initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, ease: [0.16, 1, 0.3, 1] }}
        >
          <div className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse-soft"/>
          <span className="text-[11px] sm:text-[12px] font-semibold text-dim">Now live across West Africa</span>
        </motion.div>

        {/* Headline */}
        <motion.h1
          className="text-[40px] sm:text-[56px] md:text-[72px] font-extrabold tracking-[-0.04em] text-ink leading-[1.0] mb-5 sm:mb-6"
          initial={{ opacity: 0, y: 24 }} animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.1, duration: 0.7, ease: [0.16, 1, 0.3, 1] }}
        >
          Save Together.<br/>
          <span className="text-brand">Grow Together.</span>
        </motion.h1>

        {/* Sub */}
        <motion.p
          className="text-[15px] sm:text-[17px] md:text-[19px] text-dim leading-relaxed max-w-xl mx-auto mb-9 sm:mb-10 font-normal"
          initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.2, duration: 0.6, ease: [0.16, 1, 0.3, 1] }}
        >
          The modern digital platform for Ajo, Esusu &amp; Susu —
          automating your community savings with full transparency.
        </motion.p>

        {/* CTAs */}
        <motion.div
          className="flex flex-col sm:flex-row items-center justify-center gap-3 flex-wrap"
          initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.3, duration: 0.5 }}
        >
          <Link to="/register"
            className="w-full sm:w-auto inline-flex items-center justify-center gap-2 bg-ink text-warm text-[14px] font-bold px-7 py-4 rounded-xl hover:bg-pitch transition-all hover:shadow-dark-sm active:scale-[0.98]">
            Start saving free
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
              <path d="M3 7H11M11 7L7.5 3.5M11 7L7.5 10.5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
          </Link>
          <a href="#how-it-works"
            className="w-full sm:w-auto inline-flex items-center justify-center gap-2 bg-white border border-black/[0.08] text-ink text-[14px] font-semibold px-7 py-4 rounded-xl hover:border-black/20 transition-all hover:shadow-card active:scale-[0.98]">
            See how it works
          </a>
        </motion.div>

        {/* Social proof */}
        <motion.div
          className="flex items-center justify-center gap-4 mt-8 sm:mt-10 flex-wrap"
          initial={{ opacity: 0 }} animate={{ opacity: 1 }}
          transition={{ delay: 0.5 }}
        >
          <div className="flex -space-x-2">
            {['AK','EO','ND','KM','FA'].map(i => (
              <div key={i} className="w-7 h-7 rounded-full border-2 border-warm flex items-center justify-center text-[8px] font-bold text-brand bg-brand-pale">
                {i}
              </div>
            ))}
          </div>
          <p className="text-[12px] text-dim"><strong className="text-ink font-bold">12,000+</strong> members saving with PayPaddy</p>
        </motion.div>

        {/* Mobile stats strip */}
        <motion.div
          className="flex md:hidden items-center justify-center gap-4 xs:gap-6 mt-8 bg-white border border-black/[0.06] rounded-2xl shadow-card px-4 sm:px-6 py-3 mx-auto max-w-xs sm:max-w-none"
          initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.9, duration: 0.6, ease: [0.16, 1, 0.3, 1] }}
        >
          {stats.map(([val, lab]) => (
            <div key={lab} className="text-center">
              <p className="text-[14px] sm:text-[16px] font-extrabold tracking-tight text-ink">{val}</p>
              <p className="text-[9px] sm:text-[10px] text-mist font-medium">{lab}</p>
            </div>
          ))}
        </motion.div>
      </motion.div>

      {/* Desktop floating cards — parallax layer */}
      <motion.div
        className="absolute inset-0 pointer-events-none hidden md:block"
        style={{ x: mouse.x * -1, y: mouse.y * -1 }}
      >
        <FloatingCard name="Adaeze Kalu" initials="AK" amount="₦50,000" time="2 min ago"  delay={0.6}  x="6%" y="28%"/>
        <FloatingCard name="Emeka Obi"   initials="EO" amount="₦50,000" time="14 min ago" delay={0.75} x="4%" y="52%"/>
        <PayoutBadge delay={0.65}/>
        <ProgressRing delay={0.8}/>

        {/* Desktop stats strip */}
        <motion.div
          className="absolute bottom-[14%] left-1/2 -translate-x-1/2 bg-white border border-black/[0.06] rounded-2xl shadow-card px-6 py-3 flex items-center gap-6 whitespace-nowrap"
          initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.9, duration: 0.6, ease: [0.16, 1, 0.3, 1] }}
        >
          {stats.map(([val, lab]) => (
            <div key={lab} className="text-center">
              <p className="text-[16px] font-extrabold tracking-tight text-ink">{val}</p>
              <p className="text-[10px] text-mist font-medium">{lab}</p>
            </div>
          ))}
        </motion.div>
      </motion.div>

      {/* Scroll indicator */}
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

// ── Trusted By ────────────────────────────────────────────────
const logos = ['GTBank', 'Paystack', 'Flutterwave', 'Access Bank', 'Moniepoint', 'OPay']

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
          Integrated with Africa's leading financial rails
        </motion.p>
        <div className="flex flex-wrap items-center justify-center gap-5 sm:gap-8 md:gap-12">
          {logos.map((l, i) => (
            <motion.div key={l}
              className="text-[12px] sm:text-[13px] font-bold text-stone tracking-tight hover:text-dim transition-colors cursor-default"
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
    { num: '02', title: 'Contribute on schedule', body: 'Automatic reminders keep everyone on track. Pay via bank transfer, card, or USSD. Every payment is logged and visible to all members.' },
    { num: '03', title: 'Receive your payout',    body: "When it's your turn, the full pool is automatically sent to your bank account. No waiting. No chasing. No drama." },
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
            Three steps to community wealth
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
              Real-time contribution status for every member. Automated reminders. Instant receipts. Complete audit trail.
            </p>
            <div className="space-y-4">
              {[
                ['Automated payment reminders', '48h and 2h before due dates'],
                ['Instant receipts',             'Sent via SMS and email on payment'],
                ['Live collection dashboard',    'See who has paid at a glance'],
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
              <p className="text-[12px] sm:text-[13px] font-bold text-ink">Week 5 — Lagos Tech Circle</p>
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
                    m.status === 'paid' ? 'text-green-700 bg-green-50' :
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
          <h2 className="text-[34px] sm:text-[38px] md:text-[46px] font-extrabold tracking-[-0.04em] text-ink">Your turn, fully automated</h2>
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
                  <p className={`text-[8px] sm:text-[9px] font-bold leading-tight ${p.current ? 'text-brand' : 'text-dim'}`}>
                    {p.name.split(' ')[0]}
                  </p>
                  <p className={`text-[7px] sm:text-[8px] font-mono ${p.current ? 'text-brand' : 'text-mist'}`}>{p.date}</p>
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
            <p className="text-[12px] text-mist font-semibold mb-1">Next payout — May 19, 2025</p>
            <p className="text-[28px] sm:text-[32px] font-extrabold tracking-tight text-ink">₦600,000</p>
            <p className="text-[12px] text-dim mt-1">To Amara Osei · GTBank ****4521</p>
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
            Every contribution, payout, and trend — beautifully displayed and always up to date.
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
              <span className="hidden sm:inline">paypaddy.io/dashboard</span>
              <span className="sm:hidden">paypaddy.io</span>
            </div>
            <div className="w-16"/>
          </div>

          <div className="p-4 sm:p-6">
            <div className="grid grid-cols-3 gap-2 sm:gap-4 mb-5 sm:mb-6">
              {[
                { label: 'Total Saved',    value: '₦4.2B',  delta: '+18.4%'        },
                { label: 'Active Groups',  value: '12,480', delta: '+340 this month'},
                { label: 'Payout Success', value: '98.6%',  delta: 'Excellent'     },
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
                  <p className="text-[8px] sm:text-[10px] text-lime font-semibold mt-0.5 sm:mt-1">↑ {m.delta}</p>
                </motion.div>
              ))}
            </div>

            <div className="bg-white/[0.03] rounded-xl sm:rounded-2xl border border-white/[0.05] p-3 sm:p-5">
              <div className="flex items-center justify-between mb-3 sm:mb-5">
                <p className="text-[11px] sm:text-[13px] font-bold text-white">
                  Weekly collection — Lagos Tech Circle
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

// ── Testimonials ──────────────────────────────────────────────
function Testimonials() {
  const [ref, inView] = useInView(0.1)
  return (
    <section ref={ref} className="py-20 sm:py-24 bg-warm">
      <div className="max-w-5xl mx-auto px-5 sm:px-6">
        <motion.div className="text-center mb-12 sm:mb-14"
          initial={{ opacity: 0, y: 20 }} animate={inView ? { opacity: 1, y: 0 } : {}}
          transition={{ duration: 0.6, ease: [0.16, 1, 0.3, 1] }}
        >
          <p className="text-[11px] font-bold text-brand uppercase tracking-widest mb-3">Testimonials</p>
          <h2 className="text-[34px] sm:text-[38px] md:text-[46px] font-extrabold tracking-[-0.04em] text-ink">Trusted by real savers</h2>
        </motion.div>
        <div className="grid sm:grid-cols-2 md:grid-cols-3 gap-4 sm:gap-5">
          {testimonials.map((t, i) => (
            <motion.div key={t.name}
              className="bg-white rounded-2xl border border-black/[0.06] p-5 sm:p-7 flex flex-col gap-4 sm:gap-5 hover:shadow-card-md transition-all duration-300 hover:-translate-y-1"
              initial={{ opacity: 0, y: 24 }} animate={inView ? { opacity: 1, y: 0 } : {}}
              transition={{ delay: i * 0.1, duration: 0.6, ease: [0.16, 1, 0.3, 1] }}
            >
              <div className="flex gap-0.5">
                {[...Array(5)].map((_, j) => (
                  <svg key={j} width="11" height="11" viewBox="0 0 12 12" fill="#1B5C3C">
                    <path d="M6 1L7.39 4.26L11 4.73L8.5 7.16L9.18 11L6 9.27L2.82 11L3.5 7.16L1 4.73L4.61 4.26L6 1Z"/>
                  </svg>
                ))}
              </div>
              <p className="text-[13px] sm:text-[14px] text-ink/80 leading-relaxed flex-1">"{t.text}"</p>
              <div className="bg-brand-pale rounded-xl px-3 sm:px-4 py-2 sm:py-2.5 flex items-center justify-between">
                <p className="text-[11px] text-dim font-medium">{t.label}</p>
                <p className="text-[13px] sm:text-[14px] font-extrabold text-brand tracking-tight">{t.amount}</p>
              </div>
              <div className="flex items-center gap-3 pt-1 border-t border-black/[0.04]">
                <div className="w-8 sm:w-9 h-8 sm:h-9 rounded-full bg-brand flex items-center justify-center text-lime text-[10px] sm:text-[11px] font-bold flex-shrink-0">
                  {t.initials}
                </div>
                <div>
                  <p className="text-[12px] sm:text-[13px] font-bold text-ink">{t.name}</p>
                  <p className="text-[10px] sm:text-[11px] text-mist">{t.role}</p>
                </div>
              </div>
            </motion.div>
          ))}
        </div>
      </div>
    </section>
  )
}

// ── Security ──────────────────────────────────────────────────
function Security() {
  const [ref, inView] = useInView(0.1)
  const pillars = [
    { title: '256-bit encryption',    body: 'Bank-grade TLS encryption on all data, in transit and at rest.' },
    { title: 'CBN Compliant',         body: 'Regulated escrow accounts under CBN guidelines. Funds are always protected.' },
    { title: 'Real-time audit trail', body: 'Every action is timestamped and logged. Full transparency for all group members.' },
    { title: '2FA Authentication',    body: 'Two-factor auth required for payouts and admin actions. No exceptions.' },
  ]
  return (
    <section id="security" ref={ref} className="py-20 sm:py-24 bg-white">
      <div className="max-w-5xl mx-auto px-5 sm:px-6">
        <motion.div className="text-center mb-12 sm:mb-14"
          initial={{ opacity: 0, y: 20 }} animate={inView ? { opacity: 1, y: 0 } : {}}
          transition={{ duration: 0.6, ease: [0.16, 1, 0.3, 1] }}
        >
          <p className="text-[11px] font-bold text-brand uppercase tracking-widest mb-3">Security</p>
          <h2 className="text-[34px] sm:text-[38px] md:text-[46px] font-extrabold tracking-[-0.04em] text-ink">Built to be trusted</h2>
          <p className="text-[14px] sm:text-[15px] text-dim mt-4 max-w-sm mx-auto">Enterprise-grade security infrastructure. Your money is never at risk.</p>
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
              <h3 className="text-[12px] sm:text-[14px] font-bold text-ink mb-1 sm:mb-1.5 leading-tight">{p.title}</h3>
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
          <p className="text-[11px] font-bold text-lime uppercase tracking-widest mb-4">Join PayPaddy</p>
          <h2 className="text-[40px] sm:text-[48px] md:text-[60px] font-extrabold tracking-[-0.05em] text-white leading-tight mb-5 sm:mb-6">
            Start saving<br/>with your people.
          </h2>
          <p className="text-[14px] sm:text-[16px] text-white/40 mb-8 sm:mb-10 max-w-md mx-auto">
            Free to start. No credit card required. Set up your first group in under 3 minutes.
          </p>
          <div className="flex flex-col sm:flex-row items-center justify-center gap-3 flex-wrap">
            <Link to="/register"
              className="w-full sm:w-auto inline-flex items-center justify-center gap-2 bg-lime text-ink text-[14px] font-bold px-7 py-4 rounded-xl hover:bg-lime/90 transition-all active:scale-[0.98]">
              Create your group free
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
    <footer className="bg-pitch border-t border-white/[0.05] py-12 sm:py-16">
      <div className="max-w-5xl mx-auto px-5 sm:px-6">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-8 sm:gap-10 mb-10 sm:mb-12">
          {/* Brand */}
          <div className="col-span-2 md:col-span-1">
            <div className="mb-4">
              <img
                src="https://res.cloudinary.com/dmjakrnby/image/upload/v1785357030/real_logo_s3jtjp.png"
                alt="AjoDaddy"
                className="h-12 md:h-20 w-auto object-contain flex-shrink-0"
              />
            </div>
            <p className="text-[12px] text-white/30 leading-relaxed max-w-[200px]">
              Africa's modern digital platform for community savings. Built with trust.
            </p>
          </div>   {/* ← this closes col-span div, NOT the inner mb-4 div */}
          
          {[
            { heading: 'Product', links: ['How it works','Features','Pricing','Security'] },
            { heading: 'Company', links: ['About','Blog','Careers','Contact'] },
            { heading: 'Legal',   links: ['Privacy Policy','Terms of Service','Cookie Policy'] },
          ].map(col => (
            <div key={col.heading}>
              <p className="text-[10px] sm:text-[11px] font-bold text-white/40 uppercase tracking-widest mb-3 sm:mb-4">
                {col.heading}
              </p>
              <ul className="space-y-2 sm:space-y-3">
                {col.links.map(l => (
                  <li key={l}>
                    <a href="#" className="text-[12px] sm:text-[13px] text-white/40 hover:text-white/70 transition-colors font-medium">
                      {l}
                    </a>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>

        <div className="border-t border-white/[0.05] pt-6 sm:pt-8 flex flex-col sm:flex-row items-center justify-between gap-3">
          <p className="text-[11px] sm:text-[12px] text-white/25 text-center sm:text-left">
            © 2025 PayPaddy Technologies Ltd. All rights reserved.
          </p>
          <p className="text-[11px] sm:text-[12px] text-white/25 font-mono">Lagos · Africa · Global</p>
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
      <Testimonials />
      <Security />
      <FAQ />
      <CTABanner />
      <Footer />
    </motion.div>
  )
}