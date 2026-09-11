import { useState, useEffect, useRef } from 'react'
import DashboardLayout from '@/components/layout/DashboardLayout'
import { Modal, Input, Skeleton } from '@/components/ui'
import { supportApi, disputesApi } from '@/api/services'
import { useAuthStore } from '@/stores/authStore'
import { useUIStore } from '@/stores/uiStore'
import dayjs from 'dayjs'
import relativeTime from 'dayjs/plugin/relativeTime'
dayjs.extend(relativeTime)

type Tab = 'tickets' | 'reports'

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

const CATEGORIES = [
  { icon: '💳', bg: 'bg-emerald-50', iconBg: 'bg-emerald-100', title: 'Payments & Wallet',   desc: 'Issues with deposits, withdrawals and balances' },
  { icon: '👥', bg: 'bg-blue-50',    iconBg: 'bg-blue-100',    title: 'Groups & Savings',     desc: 'Group issues, savings plans and contributions' },
  { icon: '💸', bg: 'bg-purple-50',  iconBg: 'bg-purple-100',  title: 'Transactions',         desc: 'Transaction status, failed payments, refunds' },
  { icon: '🔐', bg: 'bg-amber-50',   iconBg: 'bg-amber-100',   title: 'Account & Security',   desc: 'Account access, verification and security issues' },
]

function SBadge({ status }: { status: string }) {
  const c = STATUS_CONFIG[status] || { label: status, cls: 'bg-gray-100 text-gray-500' }
  return <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-[11px] font-semibold ${c.cls}`}>{c.label}</span>
}

export default function SupportPage() {
  const { user } = useAuthStore()
  const { showToast } = useUIStore()
  const [tab, setTab] = useState<Tab>('tickets')
  const [search, setSearch] = useState('')
  const reportPollRef = useRef<any>(null)
  const sectionRef = useRef<HTMLDivElement>(null)

  // data
  const [tickets, setTickets]       = useState<any[]>([])
  const [ticketsLoading, setTL]     = useState(false)
  const [reports, setReports]       = useState<any[]>([])
  const [reportsLoading, setRL]     = useState(false)

  // new ticket
  const [ntOpen, setNtOpen]         = useState(false)
  const [subject, setSubject]       = useState('')
  const [message, setMessage]       = useState('')
  const [priority, setPriority]     = useState('MEDIUM')
  const [ntLoading, setNtL]         = useState(false)

  // ticket detail
  const [ticketDetail, setTD]       = useState<any>(null)
  const [tdLoading, setTDL]         = useState(false)
  const [replyText, setRT]          = useState('')
  const [replyLoading, setRL2]      = useState(false)

  // report detail
  const [reportDetail, setRD]       = useState<any>(null)
  const [reportReplies, setRR]      = useState<any[]>([])
  const [rrLoading, setRRL]         = useState(false)
  const [urText, setURT]            = useState('')
  const [urLoading, setURL]         = useState(false)

  // new report
  const [nrOpen, setNrOpen]         = useState(false)
  const [rCat, setRCat]             = useState('')
  const [rDesc, setRDesc]           = useState('')
  const [nrLoading, setNrL]         = useState(false)

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

  useEffect(() => {
    if (sectionRef.current) {
      sectionRef.current.scrollIntoView({ behavior: 'smooth', block: 'start' })
    }
  }, [tab])

  const createTicket = async () => {
    if (!subject.trim() || !message.trim()) return
    setNtL(true)
    try {
      await supportApi.createTicket({ subject, message, priority })
      showToast("Ticket submitted — we'll be in touch", 'success')
      setNtOpen(false); setSubject(''); setMessage(''); setPriority('MEDIUM'); loadTickets()
    } catch (e: any) { showToast(e?.response?.data?.message || 'Failed', 'error') }
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
    try { await disputesApi.create({ type: rCat, description: rDesc }); showToast('Report submitted', 'success'); setNrOpen(false); setRCat(''); setRDesc(''); loadReports() }
    catch (e: any) { showToast(e?.response?.data?.message || 'Failed', 'error') } finally { setNrL(false) }
  }

  const filtered = tab === 'tickets'
    ? tickets.filter(t => !search || t.subject?.toLowerCase().includes(search.toLowerCase()))
    : reports.filter(r => !search || r.type?.toLowerCase().includes(search.toLowerCase()) || r.description?.toLowerCase().includes(search.toLowerCase()))

  return (
    <DashboardLayout title="Support Center" subtitle="We're here to help you. Get support, report issues or track your requests.">
      <div className="bg-[#F8F9FB] min-h-screen">

        {/* ── Tab bar + actions ── */}
        <div className="bg-white border-b border-gray-100 px-4 sm:px-6">
          <div className="max-w-6xl mx-auto flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 py-2 sm:py-0">
            <div className="flex overflow-x-auto [scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden -mx-1 px-1">
              {(['tickets', 'reports'] as Tab[]).map(t => (
                <button key={t} onClick={() => setTab(t)}
                  className={`flex items-center gap-1.5 sm:gap-2 px-1 py-3 sm:py-4 mr-6 sm:mr-8 text-[13px] font-semibold border-b-2 transition-all flex-shrink-0 whitespace-nowrap ${tab === t ? 'border-emerald-500 text-emerald-600' : 'border-transparent text-gray-400 hover:text-gray-700'}`}>
                  {t === 'tickets' ? (
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M7 8h10M7 12h4m1 8l-4-4H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-3l-4 4z"/></svg>
                  ) : (
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M3 21v-4m0 0V5a2 2 0 012-2h6.5l1 1H21l-3 6 3 6h-8.5l-1-1H5a2 2 0 00-2 2zm9-13.5V9"/></svg>
                  )}
                  {t === 'tickets' ? 'My Tickets' : 'My Reports'}
                  {t === 'tickets' && tickets.length > 0 && <span className="bg-gray-100 text-gray-500 text-[10px] font-bold px-1.5 py-0.5 rounded-full">{tickets.length}</span>}
                  {t === 'reports' && reports.length > 0 && <span className="bg-gray-100 text-gray-500 text-[10px] font-bold px-1.5 py-0.5 rounded-full">{reports.length}</span>}
                </button>
              ))}
            </div>
            <div className="flex items-center gap-2 py-2 sm:py-3">
              <button onClick={() => setNrOpen(true)}
                className="flex-1 sm:flex-none inline-flex items-center justify-center gap-1.5 h-9 px-3 sm:px-4 rounded-lg border border-gray-200 bg-white text-[12px] font-semibold text-gray-700 hover:bg-gray-50 hover:border-gray-300 transition-all shadow-sm">
                <svg className="w-3.5 h-3.5 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 21v-4m0 0V5a2 2 0 012-2h6.5l1 1H21l-3 6 3 6h-8.5l-1-1H5a2 2 0 00-2 2zm9-13.5V9"/></svg>
                <span className="whitespace-nowrap">Report issue</span>
              </button>
              <button onClick={() => setNtOpen(true)}
                className="flex-1 sm:flex-none inline-flex items-center justify-center gap-1.5 h-9 px-3 sm:px-4 rounded-lg bg-emerald-600 text-white text-[12px] font-semibold hover:bg-emerald-700 transition-all shadow-sm">
                <svg className="w-3.5 h-3.5 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z"/></svg>
                <span className="whitespace-nowrap">Contact support</span>
              </button>
            </div>
          </div>
        </div>

        <div className="max-w-6xl mx-auto px-4 sm:px-6 py-6 sm:py-8 space-y-6">

          {/* ── Hero card ── */}
          <div className="relative bg-gradient-to-r from-[#f0fdf4] to-[#dcfce7] border border-emerald-100 rounded-2xl overflow-hidden">
            <div className="p-5 sm:p-8 max-w-lg">
              <p className="text-[14px] font-semibold text-emerald-600 mb-2">Hi {user?.firstName || 'there'} 👋</p>
              <h2 className="text-[22px] sm:text-[26px] font-bold text-gray-900 leading-tight tracking-tight mb-2">How can we help you today?</h2>
              <p className="text-[13px] text-gray-500 mb-6 leading-relaxed">Our support team is ready to assist you with any questions or issues you may have.</p>
              <div className="relative max-w-sm">
                <svg className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"/>
                </svg>
                <input value={search} onChange={e => setSearch(e.target.value)}
                  placeholder="Search for help articles or your tickets…"
                  className="w-full h-11 pl-10 pr-4 bg-white border border-emerald-100 rounded-xl text-[13px] text-gray-900 placeholder-gray-400 outline-none focus:border-emerald-400 focus:ring-2 focus:ring-emerald-400/10 transition-all shadow-sm"/>
              </div>
            </div>
            {/* Illustration */}
            <div className="absolute right-8 top-1/2 -translate-y-1/2 hidden lg:flex items-center justify-center">
              <div className="relative">
                <div className="w-28 h-28 rounded-full bg-emerald-600/10 border-4 border-emerald-200/50 flex items-center justify-center">
                  <div className="w-20 h-20 rounded-full bg-emerald-600 flex items-center justify-center shadow-xl">
                    <span className="text-4xl">🎧</span>
                  </div>
                </div>
                <div className="absolute -top-2 -right-1 w-9 h-9 rounded-full bg-white border-2 border-emerald-100 flex items-center justify-center shadow-md text-[16px]">💬</div>
                <div className="absolute -bottom-3 -left-6 bg-white rounded-xl px-3 py-2 shadow-md border border-gray-100">
                  <p className="text-[9px] font-semibold text-gray-400 uppercase tracking-wide">Avg. response</p>
                  <p className="text-[13px] font-bold text-emerald-600">~2 hours</p>
                </div>
              </div>
            </div>
          </div>

          {/* ── Common topics ── */}
          <div>
            <h3 className="text-[12px] font-bold text-gray-400 uppercase tracking-wider mb-4">Common Topics</h3>
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
              {CATEGORIES.map(cat => (
                <button key={cat.title} onClick={() => { setSubject(cat.title); setNtOpen(true) }}
                  className="group bg-white rounded-2xl border border-gray-100 p-4 sm:p-5 text-left hover:border-emerald-200 hover:shadow-md transition-all duration-200 flex flex-col gap-3">
                  <div className="flex items-start justify-between">
                    <div className={`w-10 h-10 sm:w-11 sm:h-11 rounded-xl ${cat.iconBg} flex items-center justify-center text-lg sm:text-xl`}>
                      {cat.icon}
                    </div>
                    <svg className="w-4 h-4 text-gray-300 group-hover:text-emerald-500 group-hover:translate-x-0.5 transition-all mt-1 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7"/>
                    </svg>
                  </div>
                  <div>
                    <p className="text-[13px] font-semibold text-gray-900">{cat.title}</p>
                    <p className="text-[11px] text-gray-400 mt-0.5 leading-relaxed">{cat.desc}</p>
                  </div>
                </button>
              ))}
            </div>
          </div>

          {/* ── Main + Sidebar grid ── */}
          <div ref={sectionRef} className="grid lg:grid-cols-3 gap-6 scroll-mt-4">

            {/* ── Main ── */}
            <div className="lg:col-span-2">
              <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">

                {/* List header */}
                <div className="flex items-center justify-between gap-2 px-4 sm:px-6 py-4 border-b border-gray-50">
                  <h3 className="text-[14px] font-bold text-gray-900">
                    {tab === 'tickets' ? (search ? 'Search results' : 'Recent Tickets') : 'My Reports'}
                  </h3>
                  {filtered.length > 0 && tab === 'tickets' && (
                    <button onClick={() => setSearch('')} className="text-[12px] text-emerald-600 font-semibold hover:text-emerald-700 transition-colors flex-shrink-0">
                      View all tickets →
                    </button>
                  )}
                </div>

                {/* Tickets */}
                {tab === 'tickets' && (
                  ticketsLoading ? (
                    <div className="p-4 space-y-2">{[...Array(3)].map((_,i) => <Skeleton key={i} className="h-16 rounded-xl"/>)}</div>
                  ) : filtered.length === 0 ? (
                    <div className="py-16 text-center px-4">
                      <div className="w-12 h-12 rounded-2xl bg-gray-50 flex items-center justify-center text-2xl mx-auto mb-4">💬</div>
                      <p className="text-[14px] font-semibold text-gray-800 mb-1">No tickets yet</p>
                      <p className="text-[12px] text-gray-400 mb-5">Open a ticket and we'll respond quickly.</p>
                      <button onClick={() => setNtOpen(true)}
                        className="h-9 px-5 rounded-lg bg-emerald-600 text-white text-[12px] font-semibold hover:bg-emerald-700 transition-colors">
                        Open a ticket
                      </button>
                    </div>
                  ) : filtered.map((t: any, i: number) => (
                    <button key={t.id} onClick={() => openTicket(t)}
                      className={`w-full flex items-center gap-3 sm:gap-4 px-4 sm:px-6 py-4 text-left hover:bg-gray-50/80 transition-colors group ${i < filtered.length - 1 ? 'border-b border-gray-50' : ''}`}>
                      <div className="w-10 h-10 rounded-xl bg-emerald-50 group-hover:bg-emerald-100 flex items-center justify-center flex-shrink-0 transition-colors">
                        <svg className="w-4.5 h-4.5 text-emerald-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M7 8h10M7 12h4m1 8l-4-4H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-3l-4 4z"/>
                        </svg>
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-[13px] font-semibold text-gray-900 truncate">{t.subject}</p>
                        <p className="text-[11px] text-gray-400 mt-0.5 truncate">
                          Ticket ID: #PPD-{t.id?.slice(0,4).toUpperCase()} · Updated {dayjs(t.updatedAt || t.createdAt).fromNow()}
                        </p>
                      </div>
                      <div className="flex items-center gap-1.5 sm:gap-2 flex-shrink-0">
                        <SBadge status={t.status}/>
                        <svg className="w-4 h-4 text-gray-300 group-hover:text-gray-500 transition-colors hidden sm:block" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7"/>
                        </svg>
                      </div>
                    </button>
                  ))
                )}

                {/* Reports */}
                {tab === 'reports' && (
                  reportsLoading ? (
                    <div className="p-4 space-y-2">{[...Array(3)].map((_,i) => <Skeleton key={i} className="h-16 rounded-xl"/>)}</div>
                  ) : filtered.length === 0 ? (
                    <div className="py-16 text-center px-4">
                      <div className="w-12 h-12 rounded-2xl bg-gray-50 flex items-center justify-center text-2xl mx-auto mb-4">🚩</div>
                      <p className="text-[14px] font-semibold text-gray-800 mb-1">No reports filed</p>
                      <p className="text-[12px] text-gray-400 mb-5">Reports on groups or members appear here.</p>
                      <button onClick={() => setNrOpen(true)}
                        className="h-9 px-5 rounded-lg bg-gray-900 text-white text-[12px] font-semibold hover:bg-gray-800 transition-colors">
                        File a report
                      </button>
                    </div>
                  ) : filtered.map((r: any, i: number) => (
                    <button key={r.id} onClick={() => openReport(r)}
                      className={`w-full flex items-center gap-3 sm:gap-4 px-4 sm:px-6 py-4 text-left hover:bg-gray-50/80 transition-colors group ${i < filtered.length - 1 ? 'border-b border-gray-50' : ''}`}>
                      <div className="w-10 h-10 rounded-xl bg-red-50 flex items-center justify-center flex-shrink-0">
                        <svg className="w-4 h-4 text-red-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"/>
                        </svg>
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-[13px] font-semibold text-gray-900 truncate">{r.type}</p>
                        <p className="text-[11px] text-gray-400 mt-0.5 truncate">{r.description} · {dayjs(r.createdAt).fromNow()}</p>
                      </div>
                      <div className="flex items-center gap-1.5 sm:gap-2 flex-shrink-0">
                        <SBadge status={r.status}/>
                        <svg className="w-4 h-4 text-gray-300 group-hover:text-gray-500 transition-colors hidden sm:block" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7"/>
                        </svg>
                      </div>
                    </button>
                  ))
                )}
              </div>
            </div>

            {/* ── Sidebar ── */}
            <div className="space-y-4">
              <div className="bg-white rounded-2xl border border-gray-100 p-5 sm:p-6 shadow-sm">
                <p className="text-[15px] font-bold text-gray-900 mb-1">Need immediate help?</p>
                <p className="text-[12px] text-gray-400 mb-5 leading-relaxed">Our support team typically responds within a few hours.</p>
                <div className="space-y-3.5 mb-6">
                  {[
                    { icon: '⏱', text: 'Response within 24 hours' },
                    { icon: '🛡', text: 'Experienced support team' },
                    { icon: '🔒', text: 'Secure & confidential' },
                  ].map(item => (
                    <div key={item.text} className="flex items-center gap-3">
                      <div className="w-7 h-7 rounded-full bg-emerald-50 flex items-center justify-center text-[14px] flex-shrink-0">
                        {item.icon}
                      </div>
                      <p className="text-[12px] text-gray-600 font-medium">{item.text}</p>
                    </div>
                  ))}
                </div>
                <button onClick={() => setNtOpen(true)}
                  className="w-full h-11 rounded-xl bg-emerald-600 text-white text-[13px] font-semibold hover:bg-emerald-700 active:bg-emerald-800 transition-colors flex items-center justify-center gap-2 shadow-sm">
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z"/></svg>
                  Contact support
                </button>
              </div>

              {/* Status guide */}
              <div className="bg-white rounded-2xl border border-gray-100 p-5 shadow-sm">
                <p className="text-[11px] font-bold text-gray-400 uppercase tracking-wider mb-3">Status Guide</p>
                <div className="space-y-2">
                  {(Object.entries(STATUS_CONFIG) as any[]).slice(0,5).map(([, cfg]: any) => (
                    <div key={cfg.label} className="flex items-center justify-between gap-2">
                      <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full flex-shrink-0 ${cfg.cls}`}>{cfg.label}</span>
                      <span className="text-[11px] text-gray-400 text-right">
                        {cfg.label === 'Open' ? 'Awaiting response' :
                         cfg.label === 'In Progress' ? 'Being handled' :
                         cfg.label === 'Under Review' ? 'Team reviewing' :
                         cfg.label === 'Escalated' ? 'Needs admin' : 'Case closed'}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* ════ NEW TICKET MODAL ════ */}
      <Modal open={ntOpen} onClose={() => setNtOpen(false)} title="Open a support ticket" size="sm"
        footer={
          <div className="flex gap-2 justify-end w-full">
            <button onClick={() => setNtOpen(false)} className="h-9 px-4 rounded-lg border border-gray-200 text-[12px] font-semibold text-gray-600 hover:bg-gray-50 transition-colors">Cancel</button>
            <button onClick={createTicket} disabled={ntLoading || !subject.trim() || !message.trim()}
              className="h-9 px-5 rounded-lg bg-emerald-600 text-white text-[12px] font-semibold hover:bg-emerald-700 disabled:opacity-40 transition-colors">
              {ntLoading ? 'Submitting…' : 'Submit ticket'}
            </button>
          </div>
        }>
        <div className="space-y-4">
          <div>
            <label className="block text-[12px] font-medium text-gray-600 mb-1.5">Subject</label>
            <input value={subject} onChange={e => setSubject(e.target.value)} placeholder="e.g. My withdrawal hasn't arrived"
              className="w-full h-10 border border-gray-200 rounded-xl px-3.5 text-[13px] text-gray-900 bg-gray-50 outline-none focus:border-emerald-400 focus:bg-white focus:ring-2 focus:ring-emerald-400/10 transition-all"/>
          </div>
          <div>
            <label className="block text-[12px] font-medium text-gray-600 mb-1.5">Message</label>
            <textarea value={message} onChange={e => setMessage(e.target.value)} rows={4}
              placeholder="Describe your issue in detail — include dates, amounts and reference numbers"
              className="w-full border border-gray-200 rounded-xl px-3.5 py-2.5 text-[13px] text-gray-900 bg-gray-50 outline-none focus:border-emerald-400 focus:bg-white focus:ring-2 focus:ring-emerald-400/10 resize-none transition-all"/>
          </div>
          <div>
            <label className="block text-[12px] font-medium text-gray-600 mb-1.5">Priority</label>
            <select value={priority} onChange={e => setPriority(e.target.value)}
              className="h-10 w-full border border-gray-200 rounded-xl px-3.5 text-[13px] text-gray-900 bg-gray-50 outline-none focus:border-emerald-400 cursor-pointer transition-all">
              <option value="LOW">Low — general question</option>
              <option value="MEDIUM">Medium — something's not working</option>
              <option value="HIGH">High — urgent issue</option>
              <option value="URGENT">Urgent — financial impact</option>
            </select>
          </div>
        </div>
      </Modal>

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
              className="w-full border border-gray-200 rounded-xl px-3.5 py-2.5 text-[13px] text-gray-900 bg-gray-50 outline-none focus:border-emerald-400 focus:bg-white focus:ring-2 focus:ring-emerald-400/10 resize-none transition-all"/>
          </div>
        </div>
      </Modal>

      {/* ════ TICKET DETAIL MODAL ════ */}
      <Modal open={!!ticketDetail} onClose={() => { setTD(null); setRT('') }}
        title={ticketDetail?.ticket?.subject || 'Ticket'} size="md"
        footer={
          <div className="flex items-center justify-between w-full gap-3">
            {['RESOLVED','IN_PROGRESS','OPEN'].includes(ticketDetail?.ticket?.status) && ticketDetail?.ticket?.status !== 'CLOSED' && (
              <button onClick={async () => {
                try { await supportApi.closeTicket(ticketDetail.ticket.id); showToast('Ticket closed','success'); setTD(null); loadTickets() }
                catch (e: any) { showToast(e?.response?.data?.message || 'Failed','error') }
              }} className="text-[12px] font-medium text-gray-400 hover:text-gray-700 transition-colors whitespace-nowrap">
                Mark as closed
              </button>
            )}
            <button onClick={sendReply} disabled={replyLoading || !replyText.trim()}
              className="ml-auto h-9 px-5 rounded-lg bg-emerald-600 text-white text-[12px] font-semibold hover:bg-emerald-700 disabled:opacity-40 transition-colors flex-shrink-0">
              {replyLoading ? 'Sending…' : 'Send reply'}
            </button>
          </div>
        }>
        {tdLoading ? (
          <div className="space-y-3">{[...Array(3)].map((_,i) => <Skeleton key={i} className="h-12 rounded-xl"/>)}</div>
        ) : (
          <div>
            <div className="flex items-center gap-2 pb-4 border-b border-gray-100 flex-wrap">
              <span className={`px-2.5 py-0.5 rounded-full text-[11px] font-semibold ${PRIORITY_CONFIG[ticketDetail?.ticket?.priority]?.cls || 'bg-gray-100 text-gray-500'}`}>
                {PRIORITY_CONFIG[ticketDetail?.ticket?.priority]?.label || ticketDetail?.ticket?.priority}
              </span>
              <SBadge status={ticketDetail?.ticket?.status}/>
              <span className="ml-auto text-[11px] text-gray-400 font-mono">#PPD-{ticketDetail?.ticket?.id?.slice(0,4).toUpperCase()}</span>
            </div>
            <div className="py-4 space-y-3 max-h-72 overflow-y-auto">
              {(ticketDetail?.replies || []).length === 0 ? (
                <div className="text-center py-10">
                  <p className="text-[13px] text-gray-400">No messages yet — send one below.</p>
                </div>
              ) : (ticketDetail?.replies || []).map((r: any) => (
                <div key={r.id} className={`flex gap-2.5 ${r.isAdminReply ? 'flex-row-reverse' : 'flex-row'}`}>
                  <div className={`w-8 h-8 rounded-full flex items-center justify-center text-[10px] font-bold flex-shrink-0 ${r.isAdminReply ? 'bg-gray-900 text-white' : 'bg-gray-100 text-gray-600'}`}>
                    {r.isAdminReply ? 'CS' : 'ME'}
                  </div>
                  <div className={`max-w-[80%] sm:max-w-[75%] flex flex-col ${r.isAdminReply ? 'items-end' : 'items-start'}`}>
                    <p className="text-[10px] text-gray-400 mb-1.5">{r.isAdminReply ? 'Support team' : 'You'} · {dayjs(r.createdAt).format('MMM D, h:mm A')}</p>
                    <div className={`rounded-2xl px-4 py-2.5 text-[13px] leading-relaxed ${r.isAdminReply ? 'bg-gray-900 text-white rounded-tr-sm' : 'bg-gray-100 text-gray-800 rounded-tl-sm'}`}>
                      {r.message}
                    </div>
                  </div>
                </div>
              ))}
            </div>
            <div className="pt-3 border-t border-gray-100">
              <textarea value={replyText} onChange={e => setRT(e.target.value)} rows={3} placeholder="Write a reply…"
                className="w-full border border-gray-200 rounded-2xl px-4 py-3 text-[13px] text-gray-900 bg-gray-50 outline-none focus:border-emerald-400 focus:bg-white focus:ring-2 focus:ring-emerald-400/10 resize-none transition-all"/>
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
            <SBadge status={reportDetail?.status}/>
            <span className="ml-auto text-[11px] text-gray-400 font-mono">#PPD-{reportDetail?.id?.slice(0,4).toUpperCase()}</span>
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
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse inline-block"/>live
              </span>
            </div>
            {rrLoading ? (
              <div className="space-y-2">{[...Array(2)].map((_,i) => <Skeleton key={i} className="h-12 rounded-xl"/>)}</div>
            ) : reportReplies.length === 0 ? (
              <div className="bg-gray-50 rounded-xl px-4 py-8 text-center border border-gray-100">
                <p className="text-[13px] text-gray-400">No replies yet — our team will respond shortly.</p>
              </div>
            ) : (
              <div className="space-y-3 max-h-52 overflow-y-auto pr-1">
                {reportReplies.map((r: any) => (
                  <div key={r.id} className={`flex gap-2.5 ${r.isCS ? 'flex-row' : 'flex-row-reverse'}`}>
                    <div className={`w-8 h-8 rounded-full flex items-center justify-center text-[10px] font-bold text-white flex-shrink-0 mt-0.5 ${r.isCS ? 'bg-gray-800' : 'bg-emerald-600'}`}>
                      {r.isCS ? 'CS' : 'ME'}
                    </div>
                    <div className={`max-w-[80%] sm:max-w-[78%] flex flex-col ${r.isCS ? 'items-start' : 'items-end'}`}>
                      <p className="text-[10px] text-gray-400 mb-1.5">{r.isCS ? 'Support team' : 'You'} · {dayjs(r.createdAt).format('MMM D, h:mm A')}</p>
                      <div className={`rounded-2xl px-4 py-2.5 text-[13px] leading-relaxed ${r.isCS ? 'bg-gray-100 text-gray-800 rounded-tl-sm' : 'bg-emerald-600 text-white rounded-tr-sm'}`}>
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
              className="flex-1 border border-gray-200 rounded-2xl px-4 py-3 text-[13px] text-gray-900 bg-gray-50 outline-none focus:border-emerald-400 focus:bg-white focus:ring-2 focus:ring-emerald-400/10 resize-none transition-all"/>
            <button disabled={!urText.trim() || urLoading} onClick={sendUserReply}
              className="h-10 px-5 rounded-xl bg-emerald-600 text-white text-[12px] font-semibold disabled:opacity-30 hover:bg-emerald-700 transition-colors flex-shrink-0">
              {urLoading ? '…' : 'Send'}
            </button>
          </div>
        </div>
      </Modal>
    </DashboardLayout>
  )
}