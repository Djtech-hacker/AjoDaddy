import { useState, useEffect, useRef } from 'react'
import DashboardLayout from '@/components/layout/DashboardLayout'
import { Modal, Skeleton } from '@/components/ui'
import { supportApi, disputesApi } from '@/api/services'
import { useUIStore } from '@/stores/uiStore'
import dayjs from 'dayjs'
import relativeTime from 'dayjs/plugin/relativeTime'
dayjs.extend(relativeTime)

type Tab = 'tickets' | 'reports'

// Edit these to your real contact details
const CONTACT = {
  email: 'support@ajodaddy.com',
  phone: '+234 1 800 AJODADDY',
  hours: [
    { days: 'Monday – Friday', time: '8:00 AM – 6:00 PM (GMT+1)' },
    { days: 'Saturday – Sunday', time: '10:00 AM – 4:00 PM (GMT+1)' },
  ],
}

const STATUS_CONFIG: any = {
  OPEN:         { label: 'Open',         cls: 'bg-amber-50 text-amber-700 ring-1 ring-amber-200' },
  IN_PROGRESS:  { label: 'In Progress',  cls: 'bg-blue-50 text-blue-700 ring-1 ring-blue-200' },
  UNDER_REVIEW: { label: 'Under Review', cls: 'bg-violet-50 text-violet-700 ring-1 ring-violet-200' },
  ESCALATED:    { label: 'Escalated',    cls: 'bg-red-50 text-red-600 ring-1 ring-red-200' },
  RESOLVED:     { label: 'Resolved',     cls: 'bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200' },
  CLOSED:       { label: 'Closed',       cls: 'bg-gray-100 text-gray-500 ring-1 ring-gray-200' },
  DISMISSED:    { label: 'Dismissed',    cls: 'bg-gray-100 text-gray-500 ring-1 ring-gray-200' },
}

const PRIORITY_CONFIG: any = {
  LOW:    { label: 'Low',    cls: 'bg-gray-100 text-gray-500' },
  MEDIUM: { label: 'Medium', cls: 'bg-amber-50 text-amber-700' },
  HIGH:   { label: 'High',   cls: 'bg-orange-50 text-orange-600' },
  URGENT: { label: 'Urgent', cls: 'bg-red-50 text-red-600' },
}

const ICON = {
  user:   'M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z',
  wallet: 'M3 10h18M7 15h1m4 0h1m-7 4h12a3 3 0 003-3V8a3 3 0 00-3-3H6a3 3 0 00-3 3v8a3 3 0 003 3z',
  group:  'M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z',
  shield: 'M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z',
  search: 'M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z',
  mail:   'M3 8l9 6 9-6M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z',
  phone:  'M3 5a2 2 0 012-2h3.28a1 1 0 01.95.68l1.5 4.5a1 1 0 01-.5 1.2l-2.26 1.13a11 11 0 005.52 5.52l1.13-2.26a1 1 0 011.2-.5l4.5 1.5a1 1 0 01.68.95V19a2 2 0 01-2 2h-1C9.72 21 3 14.28 3 6V5z',
  chat:   'M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z',
  flag:   'M3 21v-4m0 0V5a2 2 0 012-2h6.5l1 1H21l-3 6 3 6h-8.5l-1-1H5a2 2 0 00-2 2zm9-13.5V9',
  chevron:'M9 5l7 7-7 7',
}

const Svg = ({ d, className = 'w-4 h-4', sw = 1.8 }: { d: string; className?: string; sw?: number }) => (
  <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden>
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={sw} d={d} />
  </svg>
)

const TOPICS = [
  { icon: ICON.user,   title: 'Account & Profile', desc: 'Verification, AjoDaddy ID, and settings' },
  { icon: ICON.wallet, title: 'Payment & Wallet',  desc: 'Deposits, linked cards, and bank transfers' },
  { icon: ICON.group,  title: 'Group Savings',     desc: 'Cycle schedules, payouts, and invites' },
  { icon: ICON.shield, title: 'Security & Keys',   desc: 'Two-factor setup and password resets' },
]
const CATEGORIES = [...TOPICS.map(t => t.title), 'Other']

// Help articles the search box looks through. Edit / add your own answers here.
const FAQS: { q: string; a: string; category: string }[] = [
  { category: 'Payment & Wallet', q: 'How do I withdraw my savings?',
    a: 'Go to Wallet, tap Withdraw, choose your linked bank account and enter the amount. Withdrawals usually reach your bank within a few minutes, but can take up to 24 hours.' },
  { category: 'Payment & Wallet', q: 'How do I fund my wallet?',
    a: 'Open Wallet and tap Deposit. You can pay with a linked debit card or by bank transfer to your personal account number.' },
  { category: 'Payment & Wallet', q: 'My deposit has not reflected',
    a: 'Bank transfers can take a few minutes to confirm. If it has been more than 30 minutes, submit a ticket with the amount, date and transaction reference.' },
  { category: 'Payment & Wallet', q: 'How do I link a bank account or card?',
    a: 'Go to Wallet, then Linked accounts, and choose Add bank or Add card. The account name must match your verified profile name.' },
  { category: 'Group Savings', q: 'How do I join or create a savings group?',
    a: 'Tap Groups, then Create group to start your own, or open an invite link or code from a friend to join one.' },
  { category: 'Group Savings', q: 'When do I get my payout?',
    a: 'Payout order and dates are shown on the group page under the cycle schedule. You are paid out when it is your turn and all members have contributed for that cycle.' },
  { category: 'Group Savings', q: 'A member missed their contribution',
    a: 'The group admin is notified automatically. If the payout is delayed for too long, use Report an issue and choose Missed payout or Payment issue.' },
  { category: 'Account & Profile', q: 'How do I verify my account?',
    a: 'Open Profile, then Verification, and upload a valid ID and a selfie. Verification is normally completed within 24 hours.' },
  { category: 'Account & Profile', q: 'How do I change my phone number or email?',
    a: 'Go to Profile, then Settings. For security, changing these may require a one-time code sent to your existing details.' },
  { category: 'Security & Keys', q: 'I forgot my password',
    a: 'On the login page tap Forgot password and follow the link sent to your email. If you cannot access that email, contact support.' },
  { category: 'Security & Keys', q: 'How do I set up two-factor authentication?',
    a: 'Go to Profile, then Security, and turn on Two-factor authentication. Scan the code with an authenticator app and enter the 6-digit code to confirm.' },
  { category: 'Security & Keys', q: 'I think someone accessed my account',
    a: 'Change your password immediately, then submit an Urgent ticket or use Report an issue so our team can secure your account.' },
]

const STOP_WORDS = new Set(['how', 'do', 'does', 'did', 'i', 'my', 'me', 'the', 'a', 'an', 'to', 'can', 'is', 'am', 'it', 'of', 'and', 'or', 'for', 'in', 'on', 'what', 'why', 'when', 'where', 'not', 'have', 'has', 'you', 'your'])

const searchFaqs = (query: string) => {
  const tokens = query.toLowerCase().split(/[^a-z0-9]+/).filter(w => w && !STOP_WORDS.has(w))
  if (!tokens.length) return []
  return FAQS
    .map(f => {
      const hay = `${f.q} ${f.a} ${f.category}`.toLowerCase()
      const score = tokens.reduce((n, tok) => n + (hay.includes(tok) ? 1 : 0), 0)
      return { f, score }
    })
    .filter(x => x.score > 0)
    .sort((a, b) => b.score - a.score)
    .map(x => x.f)
    .slice(0, 5)
}

const HERO_PATTERN =
  "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='420' height='220' viewBox='0 0 420 220'%3E%3Cpath d='M-20 130 C60 40 150 210 230 120 S370 70 440 140' fill='none' stroke='%23C9A227' stroke-opacity='.28' stroke-width='1.5'/%3E%3Cpath d='M-20 175 C80 90 160 230 250 150 S370 110 440 185' fill='none' stroke='%23C9A227' stroke-opacity='.18' stroke-width='1.5'/%3E%3C/svg%3E\")"

function SBadge({ status, small = false }: { status: string; small?: boolean }) {
  const c = STATUS_CONFIG[status] || { label: status, cls: 'bg-gray-100 text-gray-500' }
  return (
    <span className={`inline-flex items-center rounded-md font-bold whitespace-nowrap ${small ? 'px-2 py-0.5 text-[9px] uppercase tracking-wide' : 'px-2.5 py-0.5 text-[11px] rounded-full font-semibold'} ${c.cls}`}>
      {c.label}
    </span>
  )
}

const ticketId = (id?: string) => `#T-${(id || '').slice(0, 4).toUpperCase()}`

// The API has no category field, so it is stored as the first line of the message
const CAT_RE = /^Category:\s*(.+)\n/
const ticketCategory = (t: any) => t.category || (typeof t.message === 'string' ? t.message.match(CAT_RE)?.[1] : '') || '—'

const fieldCls = 'w-full border border-gray-200 rounded-lg px-3 text-[12px] text-gray-900 bg-gray-50 outline-none focus:border-emerald-500 focus:bg-white focus:ring-2 focus:ring-emerald-500/10 transition-all'
const labelCls = 'block text-[9.5px] font-semibold text-gray-400 uppercase tracking-wider mb-1.5'

export default function SupportPage() {
  const { showToast } = useUIStore()
  const [tab, setTab] = useState<Tab>('tickets')
  const [search, setSearch] = useState('')
  const [openFaq, setOpenFaq] = useState<string | null>(null)
  const reportPollRef = useRef<any>(null)
  const formRef = useRef<HTMLDivElement>(null)
  const tableRef = useRef<HTMLDivElement>(null)

  // data
  const [tickets, setTickets]   = useState<any[]>([])
  const [ticketsLoading, setTL] = useState(false)
  const [reports, setReports]   = useState<any[]>([])
  const [reportsLoading, setRL] = useState(false)

  // inline ticket form
  const [subject, setSubject]   = useState('')
  const [category, setCategory] = useState(CATEGORIES[1])
  const [priority, setPriority] = useState('MEDIUM')
  const [message, setMessage]   = useState('')
  const [ntLoading, setNtL]     = useState(false)

  // ticket detail
  const [ticketDetail, setTD]   = useState<any>(null)
  const [tdLoading, setTDL]     = useState(false)
  const [replyText, setRT]      = useState('')
  const [replyLoading, setRL2]  = useState(false)

  // report detail
  const [reportDetail, setRD]   = useState<any>(null)
  const [reportReplies, setRR]  = useState<any[]>([])
  const [rrLoading, setRRL]     = useState(false)
  const [urText, setURT]        = useState('')
  const [urLoading, setURL]     = useState(false)

  // new report
  const [nrOpen, setNrOpen]     = useState(false)
  const [rCat, setRCat]         = useState('')
  const [rDesc, setRDesc]       = useState('')
  const [nrLoading, setNrL]     = useState(false)

  const loadTickets = async () => {
    setTL(true)
    try { const r = await supportApi.getMyTickets(); const d = (r.data as any)?.data || r.data; setTickets(Array.isArray(d) ? d : d?.tickets || []) }
    catch {} finally { setTL(false) }
  }

  const loadReports = async () => {
    setRL(true)
    try { const r = await disputesApi.getMine(); const d = (r.data as any)?.data || r.data; setReports(Array.isArray(d) ? d : []) }
    catch {} finally { setRL(false) }
  }

  useEffect(() => { loadTickets(); loadReports() }, [])
  useEffect(() => () => { if (reportPollRef.current) clearInterval(reportPollRef.current) }, [])

  const scrollTo = (ref: React.RefObject<HTMLDivElement>) => ref.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })

  const pickTopic = (title: string) => { setCategory(title); scrollTo(formRef) }

  // No article found: send the search text straight into the ticket form
  const askSupport = (faqCategory?: string) => {
    setSubject(search.trim().slice(0, 120))
    if (faqCategory) setCategory(faqCategory)
    scrollTo(formRef)
  }

  const createTicket = async () => {
    if (!subject.trim() || !message.trim()) return
    setNtL(true)
    try {
      await supportApi.createTicket({ subject: subject.trim(), message: `Category: ${category}\n${message.trim()}`, priority })
      showToast("Ticket submitted. We'll be in touch", 'success')
      setSubject(''); setMessage(''); setPriority('MEDIUM'); setTab('tickets'); loadTickets()
    } catch (e: any) { showToast(e?.response?.data?.message || 'Could not submit ticket', 'error') }
    finally { setNtL(false) }
  }

  const openTicket = async (t: any) => {
    setTDL(true); setTD({ ticket: t, replies: [] })
    try { const r = await supportApi.getTicketDetail(t.id); setTD((r.data as any)?.data || r.data) }
    catch { showToast('Could not load ticket', 'error') } finally { setTDL(false) }
  }

  const sendReply = async () => {
    if (!ticketDetail?.ticket || !replyText.trim()) return
    setRL2(true)
    try { await supportApi.replyToTicket(ticketDetail.ticket.id, replyText); setRT(''); await openTicket(ticketDetail.ticket); loadTickets() }
    catch (e: any) { showToast(e?.response?.data?.message || 'Failed', 'error') } finally { setRL2(false) }
  }

  const fetchReplies = async (id: string) => {
    try { const r = await disputesApi.getReplies(id); const d = (r.data as any)?.data || r.data; setRR(Array.isArray(d) ? d : []) }
    catch { setRR([]) } finally { setRRL(false) }
  }

  const openReport = async (r: any) => {
    setRD(r); setRRL(true)
    if (reportPollRef.current) clearInterval(reportPollRef.current)
    await fetchReplies(r.id)
    reportPollRef.current = setInterval(() => fetchReplies(r.id), 4000)
  }

  const sendUserReply = async () => {
    if (!reportDetail?.id || !urText.trim()) return
    setURL(true)
    try { await disputesApi.reply(reportDetail.id, urText.trim()); setURT(''); await fetchReplies(reportDetail.id) }
    catch { showToast('Failed', 'error') } finally { setURL(false) }
  }

  const createReport = async () => {
    if (!rCat || !rDesc.trim()) return
    setNrL(true)
    try { await disputesApi.create({ type: rCat, description: rDesc }); showToast('Report submitted', 'success'); setNrOpen(false); setRCat(''); setRDesc(''); setTab('reports'); loadReports() }
    catch (e: any) { showToast(e?.response?.data?.message || 'Failed', 'error') } finally { setNrL(false) }
  }

  const q = search.trim().toLowerCase()
  const faqResults = q ? searchFaqs(q) : []
  const filteredTickets = tickets.filter(t => !q || t.subject?.toLowerCase().includes(q) || ticketCategory(t).toLowerCase().includes(q))
  const filteredReports = reports.filter(r => !q || r.type?.toLowerCase().includes(q) || r.description?.toLowerCase().includes(q))

  return (
    <DashboardLayout title="Help & Support">
      <div className="bg-[#F8F9FB] min-h-screen">
        <div className="max-w-5xl mx-auto px-4 sm:px-6 py-6 sm:py-8 space-y-8">

          {/* ── Hero ── */}
          <section className="relative rounded-2xl bg-[#0B3D2A] overflow-hidden px-5 py-10 sm:py-12 text-center"
            style={{ backgroundImage: HERO_PATTERN, backgroundSize: '420px 220px', backgroundRepeat: 'repeat' }}>
            <h2 className="text-[22px] sm:text-[26px] font-bold text-white tracking-tight">How can we help you today?</h2>
            <p className="text-[12px] sm:text-[13px] text-[#E4C96A] mt-2">Search our help articles or raise a support ticket below</p>
            <div className="relative max-w-md mx-auto mt-6">
              <Svg d={ICON.search} className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" sw={2} />
              <input
                value={search}
                onChange={e => setSearch(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') scrollTo(tableRef) }}
                aria-label="Search help articles, tickets and reports"
                placeholder="Type your question (e.g. 'How do I withdraw my savings?')"
                className="w-full h-11 pl-11 pr-4 rounded-full bg-white text-[12px] text-gray-900 placeholder-gray-400 outline-none focus:ring-2 focus:ring-emerald-400/40 shadow-sm" />
            </div>
          </section>

          {/* ── Search results (help articles) ── */}
          {q && (
            <section className="bg-white border border-gray-100 rounded-2xl shadow-sm p-5 sm:p-6">
              <h3 className="text-[13px] font-bold text-gray-900 mb-3">
                {faqResults.length ? `Help articles for “${search.trim()}”` : 'No help articles found'}
              </h3>

              {faqResults.length > 0 && (
                <div className="divide-y divide-gray-100 border border-gray-100 rounded-xl overflow-hidden">
                  {faqResults.map(f => {
                    const open = openFaq === f.q
                    return (
                      <div key={f.q}>
                        <button onClick={() => setOpenFaq(open ? null : f.q)} aria-expanded={open}
                          className="w-full flex items-center justify-between gap-3 px-4 py-3 text-left hover:bg-gray-50 transition-colors">
                          <span>
                            <span className="block text-[12px] font-semibold text-gray-900">{f.q}</span>
                            <span className="block text-[10px] text-gray-400 mt-0.5">{f.category}</span>
                          </span>
                          <Svg d={ICON.chevron} className={`w-4 h-4 text-gray-400 flex-shrink-0 transition-transform ${open ? 'rotate-90' : ''}`} />
                        </button>
                        {open && <p className="px-4 pb-4 text-[12px] text-gray-600 leading-relaxed">{f.a}</p>}
                      </div>
                    )
                  })}
                </div>
              )}

              {faqResults.length === 0 && (
                <p className="text-[12px] text-gray-500 mb-1">We couldn't find an answer to that. Our team can help directly.</p>
              )}

              <div className="mt-4 flex flex-wrap items-center gap-2">
                <button onClick={() => askSupport(faqResults[0]?.category)}
                  className="h-9 px-4 rounded-lg bg-[#0B3D2A] text-white text-[12px] font-semibold hover:bg-[#0F5138] transition-colors">
                  {faqResults.length ? "Still need help? Send this to support" : 'Send this to support'}
                </button>
                <a href={`mailto:${CONTACT.email}?subject=${encodeURIComponent(search.trim())}`}
                  className="h-9 px-4 rounded-lg border border-gray-200 text-gray-700 text-[12px] font-semibold hover:bg-gray-50 transition-colors inline-flex items-center">
                  Email us
                </a>
                <button onClick={() => setSearch('')} className="text-[11px] text-gray-400 hover:text-gray-700 ml-auto">Clear search</button>
              </div>
            </section>
          )}

          {/* ── Common help topics ── */}
          <section>
            <h3 className="text-[13px] font-bold text-gray-900 mb-3">Common help topics</h3>
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
              {TOPICS.map(t => (
                <button key={t.title} onClick={() => pickTopic(t.title)}
                  className="bg-white border border-gray-100 rounded-xl p-4 text-left hover:border-emerald-200 hover:shadow-sm transition-all">
                  <span className="w-8 h-8 rounded-lg bg-amber-50 text-amber-600 flex items-center justify-center mb-3">
                    <Svg d={t.icon} className="w-4 h-4" />
                  </span>
                  <p className="text-[12px] font-semibold text-gray-900">{t.title}</p>
                  <p className="text-[10.5px] text-gray-400 mt-1 leading-relaxed">{t.desc}</p>
                </button>
              ))}
            </div>
          </section>

          {/* ── Ticket form + direct channels ── */}
          <section ref={formRef} className="grid lg:grid-cols-[1.7fr_1fr] gap-5 scroll-mt-4">
            <div className="bg-white border border-gray-100 rounded-2xl p-5 sm:p-6 shadow-sm">
              <h3 className="text-[14px] font-bold text-gray-900">Submit a support ticket</h3>
              <p className="text-[11px] text-gray-400 mt-0.5 mb-5">Our team typically responds in under 2 hours.</p>

              <div className="space-y-4">
                <div>
                  <label htmlFor="sp-subject" className={labelCls}>Subject / summary</label>
                  <input id="sp-subject" value={subject} onChange={e => setSubject(e.target.value)}
                    placeholder="e.g. Unable to link my bank account" className={`${fieldCls} h-10`} />
                </div>
                <div className="grid sm:grid-cols-2 gap-4">
                  <div>
                    <label htmlFor="sp-cat" className={labelCls}>Issue category</label>
                    <select id="sp-cat" value={category} onChange={e => setCategory(e.target.value)} className={`${fieldCls} h-10 cursor-pointer`}>
                      {CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
                    </select>
                  </div>
                  <div>
                    <label htmlFor="sp-pri" className={labelCls}>Priority</label>
                    <select id="sp-pri" value={priority} onChange={e => setPriority(e.target.value)} className={`${fieldCls} h-10 cursor-pointer`}>
                      <option value="LOW">Low: general question</option>
                      <option value="MEDIUM">Medium: something isn't working</option>
                      <option value="HIGH">High: urgent issue</option>
                      <option value="URGENT">Urgent: financial impact</option>
                    </select>
                  </div>
                </div>
                <div>
                  <label htmlFor="sp-msg" className={labelCls}>Detailed description</label>
                  <textarea id="sp-msg" value={message} onChange={e => setMessage(e.target.value)} rows={5}
                    placeholder="Describe what happened. Include dates, amounts and reference numbers."
                    className={`${fieldCls} py-2.5 resize-none leading-relaxed`} />
                </div>
                <div className="flex justify-end">
                  <button onClick={createTicket} disabled={ntLoading || !subject.trim() || !message.trim()}
                    className="h-10 px-6 rounded-lg bg-[#0B3D2A] text-white text-[12px] font-semibold hover:bg-[#0F5138] disabled:opacity-40 disabled:cursor-not-allowed transition-colors">
                    {ntLoading ? 'Submitting…' : 'Submit ticket'}
                  </button>
                </div>
              </div>
            </div>

            <aside className="bg-white border border-gray-100 rounded-2xl p-5 sm:p-6 shadow-sm self-start">
              <h3 className="text-[14px] font-bold text-gray-900 mb-4">Direct channels</h3>

              <button onClick={() => scrollTo(formRef)}
                className="w-full h-10 rounded-lg bg-emerald-500 text-white text-[12px] font-semibold hover:bg-emerald-600 transition-colors inline-flex items-center justify-center gap-2">
                <Svg d={ICON.chat} className="w-4 h-4" sw={2} /> Message support
              </button>
              <button onClick={() => setNrOpen(true)}
                className="w-full h-10 mt-2 rounded-lg border border-gray-200 text-gray-700 text-[12px] font-semibold hover:bg-gray-50 transition-colors inline-flex items-center justify-center gap-2">
                <Svg d={ICON.flag} className="w-4 h-4" sw={2} /> Report an issue
              </button>

              <div className="mt-5 space-y-4">
                <div className="flex items-center gap-3">
                  <span className="w-8 h-8 rounded-lg bg-gray-50 text-gray-500 flex items-center justify-center flex-shrink-0"><Svg d={ICON.mail} /></span>
                  <div className="min-w-0">
                    <p className="text-[9.5px] text-gray-400 uppercase tracking-wider font-semibold">Email address</p>
                    <a href={`mailto:${CONTACT.email}`} className="text-[12px] font-semibold text-gray-900 hover:text-emerald-600 break-all">{CONTACT.email}</a>
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  <span className="w-8 h-8 rounded-lg bg-gray-50 text-gray-500 flex items-center justify-center flex-shrink-0"><Svg d={ICON.phone} /></span>
                  <div>
                    <p className="text-[9.5px] text-gray-400 uppercase tracking-wider font-semibold">Customer support line</p>
                    <p className="text-[12px] font-semibold text-gray-900">{CONTACT.phone}</p>
                  </div>
                </div>
              </div>

              <div className="mt-5 pt-4 border-t border-gray-100">
                <p className="text-[9.5px] text-gray-400 uppercase tracking-wider font-semibold mb-2">Customer support hours</p>
                {CONTACT.hours.map(h => (
                  <p key={h.days} className="text-[11px] text-gray-600 leading-relaxed"><span className="font-semibold text-gray-800">{h.days}:</span> {h.time}</p>
                ))}
              </div>
            </aside>
          </section>

          {/* ── Recent tickets / reports ── */}
          <section ref={tableRef} className="bg-white border border-gray-100 rounded-2xl shadow-sm overflow-hidden scroll-mt-4">
            <div className="flex items-center justify-between gap-3 px-5 sm:px-6 pt-5 pb-3 flex-wrap">
              <h3 className="text-[14px] font-bold text-gray-900">{tab === 'tickets' ? 'Your recent tickets' : 'Your reports'}</h3>
              <div className="flex items-center gap-1 bg-gray-100 rounded-lg p-0.5" role="tablist">
                {(['tickets', 'reports'] as Tab[]).map(t => (
                  <button key={t} role="tab" aria-selected={tab === t} onClick={() => setTab(t)}
                    className={`px-3 h-7 rounded-md text-[11px] font-semibold transition-all ${tab === t ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-800'}`}>
                    {t === 'tickets' ? `Tickets${tickets.length ? ` (${tickets.length})` : ''}` : `Reports${reports.length ? ` (${reports.length})` : ''}`}
                  </button>
                ))}
              </div>
            </div>

            <div className="overflow-x-auto">
              {tab === 'tickets' ? (
                <div className="min-w-[640px]">
                  <div className="grid grid-cols-[80px_1.8fr_1fr_1fr_96px] gap-3 px-5 sm:px-6 py-2 bg-gray-50/70 text-[9.5px] font-semibold text-gray-400 uppercase tracking-wider">
                    <span>Ticket ID</span><span>Subject</span><span>Category</span><span>Last updated</span><span>Status</span>
                  </div>
                  {ticketsLoading ? (
                    <div className="p-4 space-y-2">{[...Array(3)].map((_, i) => <Skeleton key={i} className="h-10 rounded-lg" />)}</div>
                  ) : filteredTickets.length === 0 ? (
                    <div className="py-12 text-center px-4">
                      <p className="text-[13px] font-semibold text-gray-800">{q ? 'No tickets match your search' : 'No tickets yet'}</p>
                      <p className="text-[11px] text-gray-400 mt-1">{q ? 'Try different words.' : 'Submit a ticket above and it will show up here.'}</p>
                    </div>
                  ) : filteredTickets.map((t: any) => (
                    <button key={t.id} onClick={() => openTicket(t)}
                      className="w-full grid grid-cols-[80px_1.8fr_1fr_1fr_96px] gap-3 items-center px-5 sm:px-6 py-3 text-left border-t border-gray-50 hover:bg-gray-50/80 transition-colors">
                      <span className="text-[11px] font-mono font-semibold text-gray-500">{ticketId(t.id)}</span>
                      <span className="text-[12px] font-medium text-gray-900 truncate">{t.subject}</span>
                      <span className="text-[11px] text-gray-500 truncate">{ticketCategory(t)}</span>
                      <span className="text-[11px] text-gray-500">{dayjs(t.updatedAt || t.createdAt).fromNow()}</span>
                      <SBadge status={t.status} small />
                    </button>
                  ))}
                </div>
              ) : (
                <div className="min-w-[640px]">
                  <div className="grid grid-cols-[1.2fr_2fr_1fr_96px] gap-3 px-5 sm:px-6 py-2 bg-gray-50/70 text-[9.5px] font-semibold text-gray-400 uppercase tracking-wider">
                    <span>Type</span><span>Details</span><span>Filed</span><span>Status</span>
                  </div>
                  {reportsLoading ? (
                    <div className="p-4 space-y-2">{[...Array(3)].map((_, i) => <Skeleton key={i} className="h-10 rounded-lg" />)}</div>
                  ) : filteredReports.length === 0 ? (
                    <div className="py-12 text-center px-4">
                      <p className="text-[13px] font-semibold text-gray-800">{q ? 'No reports match your search' : 'No reports filed'}</p>
                      <p className="text-[11px] text-gray-400 mt-1 mb-4">{q ? 'Try different words.' : 'Reports on groups or members appear here.'}</p>
                      {!q && <button onClick={() => setNrOpen(true)} className="h-9 px-5 rounded-lg bg-[#0B3D2A] text-white text-[12px] font-semibold hover:bg-[#0F5138] transition-colors">File a report</button>}
                    </div>
                  ) : filteredReports.map((r: any) => (
                    <button key={r.id} onClick={() => openReport(r)}
                      className="w-full grid grid-cols-[1.2fr_2fr_1fr_96px] gap-3 items-center px-5 sm:px-6 py-3 text-left border-t border-gray-50 hover:bg-gray-50/80 transition-colors">
                      <span className="text-[12px] font-medium text-gray-900 truncate">{r.type}</span>
                      <span className="text-[11px] text-gray-500 truncate">{r.description}</span>
                      <span className="text-[11px] text-gray-500">{dayjs(r.createdAt).fromNow()}</span>
                      <SBadge status={r.status} small />
                    </button>
                  ))}
                </div>
              )}
            </div>
          </section>
        </div>
      </div>

      {/* ════ NEW REPORT MODAL ════ */}
      <Modal open={nrOpen} onClose={() => setNrOpen(false)} title="File a report" size="sm"
        footer={
          <div className="flex gap-2 justify-end w-full">
            <button onClick={() => setNrOpen(false)} className="h-9 px-4 rounded-lg border border-gray-200 text-[12px] font-semibold text-gray-600 hover:bg-gray-50 transition-colors">Cancel</button>
            <button onClick={createReport} disabled={nrLoading || !rCat || !rDesc.trim()}
              className="h-9 px-5 rounded-lg bg-red-500 text-white text-[12px] font-semibold hover:bg-red-600 disabled:opacity-40 transition-colors">
              {nrLoading ? 'Submitting…' : 'Submit report'}
            </button>
          </div>
        }>
        <div className="space-y-4">
          <div className="bg-amber-50 border border-amber-100 rounded-xl px-4 py-3">
            <p className="text-[12px] text-amber-700 font-medium">Reports are reviewed by our team within 24 hours and kept confidential.</p>
          </div>
          <div>
            <label className="block text-[12px] font-medium text-gray-600 mb-1.5">Category</label>
            <select value={rCat} onChange={e => setRCat(e.target.value)}
              className="h-10 w-full border border-gray-200 rounded-xl px-3.5 text-[13px] text-gray-900 bg-gray-50 outline-none focus:border-emerald-400 cursor-pointer transition-all">
              <option value="">Select a category</option>
              <option value="Fraudulent activity">Fraudulent activity</option>
              <option value="Missed payout">Missed payout</option>
              <option value="Payment issue">Payment issue</option>
              <option value="Harassment">Harassment</option>
              <option value="Fake group or member">Fake group or member</option>
              <option value="Suspicious behavior">Suspicious behavior</option>
              <option value="Other">Other</option>
            </select>
          </div>
          <div>
            <label className="block text-[12px] font-medium text-gray-600 mb-1.5">Details</label>
            <textarea value={rDesc} onChange={e => setRDesc(e.target.value)} rows={4}
              placeholder="What happened? Include names, dates, and amounts if relevant."
              className="w-full border border-gray-200 rounded-xl px-3.5 py-2.5 text-[13px] text-gray-900 bg-gray-50 outline-none focus:border-emerald-400 focus:bg-white focus:ring-2 focus:ring-emerald-400/10 resize-none transition-all" />
          </div>
        </div>
      </Modal>

      {/* ════ TICKET DETAIL MODAL ════ */}
      <Modal open={!!ticketDetail} onClose={() => { setTD(null); setRT('') }}
        title={ticketDetail?.ticket?.subject || 'Ticket'} size="md"
        footer={
          <div className="flex items-center justify-between w-full gap-3">
            {['RESOLVED', 'IN_PROGRESS', 'OPEN'].includes(ticketDetail?.ticket?.status) && (
              <button onClick={async () => {
                try { await supportApi.closeTicket(ticketDetail.ticket.id); showToast('Ticket closed', 'success'); setTD(null); loadTickets() }
                catch (e: any) { showToast(e?.response?.data?.message || 'Failed', 'error') }
              }} className="text-[12px] font-medium text-gray-400 hover:text-gray-700 transition-colors whitespace-nowrap">
                Mark as closed
              </button>
            )}
            <button onClick={sendReply} disabled={replyLoading || !replyText.trim()}
              className="ml-auto h-9 px-5 rounded-lg bg-[#0B3D2A] text-white text-[12px] font-semibold hover:bg-[#0F5138] disabled:opacity-40 transition-colors flex-shrink-0">
              {replyLoading ? 'Sending…' : 'Send reply'}
            </button>
          </div>
        }>
        {tdLoading ? (
          <div className="space-y-3">{[...Array(3)].map((_, i) => <Skeleton key={i} className="h-12 rounded-xl" />)}</div>
        ) : (
          <div>
            <div className="flex items-center gap-2 pb-4 border-b border-gray-100 flex-wrap">
              <span className={`px-2.5 py-0.5 rounded-full text-[11px] font-semibold ${PRIORITY_CONFIG[ticketDetail?.ticket?.priority]?.cls || 'bg-gray-100 text-gray-500'}`}>
                {PRIORITY_CONFIG[ticketDetail?.ticket?.priority]?.label || ticketDetail?.ticket?.priority}
              </span>
              <SBadge status={ticketDetail?.ticket?.status} />
              <span className="ml-auto text-[11px] text-gray-400 font-mono">{ticketId(ticketDetail?.ticket?.id)}</span>
            </div>
            <div className="py-4 space-y-3 max-h-72 overflow-y-auto">
              {(ticketDetail?.replies || []).length === 0 ? (
                <div className="text-center py-10">
                  <p className="text-[13px] text-gray-400">No messages yet. Send one below.</p>
                </div>
              ) : (ticketDetail?.replies || []).map((r: any) => (
                <div key={r.id} className={`flex gap-2.5 ${r.isAdminReply ? 'flex-row-reverse' : 'flex-row'}`}>
                  <div className={`w-8 h-8 rounded-full flex items-center justify-center text-[10px] font-bold flex-shrink-0 ${r.isAdminReply ? 'bg-gray-900 text-white' : 'bg-gray-100 text-gray-600'}`}>
                    {r.isAdminReply ? 'CS' : 'ME'}
                  </div>
                  <div className={`max-w-[80%] sm:max-w-[75%] flex flex-col ${r.isAdminReply ? 'items-end' : 'items-start'}`}>
                    <p className="text-[10px] text-gray-400 mb-1.5">{r.isAdminReply ? 'Support team' : 'You'} · {dayjs(r.createdAt).format('MMM D, h:mm A')}</p>
                    <div className={`rounded-2xl px-4 py-2.5 text-[13px] leading-relaxed whitespace-pre-wrap ${r.isAdminReply ? 'bg-gray-900 text-white rounded-tr-sm' : 'bg-gray-100 text-gray-800 rounded-tl-sm'}`}>
                      {r.message}
                    </div>
                  </div>
                </div>
              ))}
            </div>
            <div className="pt-3 border-t border-gray-100">
              <textarea value={replyText} onChange={e => setRT(e.target.value)} rows={3} placeholder="Write a reply…"
                className="w-full border border-gray-200 rounded-2xl px-4 py-3 text-[13px] text-gray-900 bg-gray-50 outline-none focus:border-emerald-400 focus:bg-white focus:ring-2 focus:ring-emerald-400/10 resize-none transition-all" />
            </div>
          </div>
        )}
      </Modal>

      {/* ════ REPORT DETAIL MODAL ════ */}
      <Modal open={!!reportDetail} onClose={() => {
        setRD(null); setRR([]); setURT('')
        if (reportPollRef.current) clearInterval(reportPollRef.current)
      }} title={reportDetail?.type || 'Report'} size="md">
        <div>
          <div className="flex items-center gap-2 pb-4 border-b border-gray-100">
            <SBadge status={reportDetail?.status} />
            <span className="ml-auto text-[11px] text-gray-400 font-mono">{ticketId(reportDetail?.id)}</span>
          </div>
          <div className="py-4 border-b border-gray-100">
            <div className="bg-gray-50 rounded-xl px-4 py-3.5 border border-gray-100">
              <p className="text-[14px] text-gray-800 leading-relaxed">{reportDetail?.description}</p>
              <p className="text-[11px] text-gray-400 mt-2">Filed {reportDetail ? dayjs(reportDetail.createdAt).format('MMM D, YYYY · h:mm A') : ''}</p>
            </div>
          </div>
          {reportDetail?.resolution && (
            <div className="py-4 border-b border-gray-100">
              <div className="bg-emerald-50 border border-emerald-100 rounded-xl px-4 py-3.5">
                <p className="text-[10px] font-bold text-emerald-600 uppercase tracking-wider mb-1.5">Resolution</p>
                <p className="text-[13px] text-emerald-900">{reportDetail.resolution}</p>
              </div>
            </div>
          )}
          <div className="py-4 border-b border-gray-100">
            <div className="flex items-center justify-between mb-3">
              <p className="text-[11px] font-bold text-gray-400 uppercase tracking-wider">Conversation</p>
              <span className="text-[10px] text-gray-400 flex items-center gap-1 font-medium">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse inline-block" />live
              </span>
            </div>
            {rrLoading ? (
              <div className="space-y-2">{[...Array(2)].map((_, i) => <Skeleton key={i} className="h-12 rounded-xl" />)}</div>
            ) : reportReplies.length === 0 ? (
              <div className="bg-gray-50 rounded-xl px-4 py-8 text-center border border-gray-100">
                <p className="text-[13px] text-gray-400">No replies yet. Our team will respond shortly.</p>
              </div>
            ) : (
              <div className="space-y-3 max-h-52 overflow-y-auto pr-1">
                {reportReplies.map((r: any) => (
                  <div key={r.id} className={`flex gap-2.5 ${r.isCS ? 'flex-row' : 'flex-row-reverse'}`}>
                    <div className={`w-8 h-8 rounded-full flex items-center justify-center text-[10px] font-bold text-white flex-shrink-0 mt-0.5 ${r.isCS ? 'bg-gray-800' : 'bg-[#0B3D2A]'}`}>
                      {r.isCS ? 'CS' : 'ME'}
                    </div>
                    <div className={`max-w-[80%] sm:max-w-[78%] flex flex-col ${r.isCS ? 'items-start' : 'items-end'}`}>
                      <p className="text-[10px] text-gray-400 mb-1.5">{r.isCS ? 'Support team' : 'You'} · {dayjs(r.createdAt).format('MMM D, h:mm A')}</p>
                      <div className={`rounded-2xl px-4 py-2.5 text-[13px] leading-relaxed ${r.isCS ? 'bg-gray-100 text-gray-800 rounded-tl-sm' : 'bg-[#0B3D2A] text-white rounded-tr-sm'}`}>
                        {r.content}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
          <div className="pt-4 flex gap-2 items-end">
            <textarea value={urText} onChange={e => setURT(e.target.value)} rows={2}
              placeholder="Write a message to the support team…"
              className="flex-1 border border-gray-200 rounded-2xl px-4 py-3 text-[13px] text-gray-900 bg-gray-50 outline-none focus:border-emerald-400 focus:bg-white focus:ring-2 focus:ring-emerald-400/10 resize-none transition-all" />
            <button disabled={!urText.trim() || urLoading} onClick={sendUserReply}
              className="h-10 px-5 rounded-xl bg-[#0B3D2A] text-white text-[12px] font-semibold disabled:opacity-30 hover:bg-[#0F5138] transition-colors flex-shrink-0">
              {urLoading ? '…' : 'Send'}
            </button>
          </div>
        </div>
      </Modal>
    </DashboardLayout>
  )
}