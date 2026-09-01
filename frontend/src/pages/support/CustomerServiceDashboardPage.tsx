import { useState, useEffect, useRef } from 'react'
import DashboardLayout from '@/components/layout/DashboardLayout'
import { Button, Badge, EmptyState, Skeleton, Modal } from '@/components/ui'
import { csApi, adminApi } from '@/api/services'
import { useAuthStore } from '@/stores/authStore'
import { useUIStore } from '@/stores/uiStore'
import dayjs from 'dayjs'

type Tab = 'tickets' | 'reports'

const tsv = (s: string) => ({ OPEN: 'warning', IN_PROGRESS: 'brand', RESOLVED: 'success', CLOSED: 'neutral' } as any)[s] || 'neutral'
const dsv = (s: string) => ({ OPEN: 'warning', UNDER_REVIEW: 'warning', ESCALATED: 'danger', RESOLVED: 'success', CLOSED: 'neutral', DISMISSED: 'neutral' } as any)[s] || 'neutral'
const pv  = (p: string) => ({ LOW: 'neutral', MEDIUM: 'warning', HIGH: 'danger', URGENT: 'danger' } as any)[p] || 'neutral'

export default function CustomerServiceDashboardPage() {
  const { user } = useAuthStore()
  const { showToast } = useUIStore()
  const [tab, setTab] = useState<Tab>('tickets')
  const [staff, setStaff] = useState<any[]>([])

  const pollRef = useRef<any>(null)
  const ticketPollRef = useRef<any>(null)

  // ── Tickets ────────────────────────────────────────────────
  const [tickets, setTickets]             = useState<any[]>([])
  const [ticketsLoading, setTL]           = useState(false)
  const [ticketFilter, setTicketFilter]   = useState('')
  const [ticketPage, setTicketPage]       = useState(1)
  const [ticketPag, setTicketPag]         = useState<any>(null)
  const [ticketDetail, setTicketDetail]   = useState<any>(null)
  const [ticketDetailLoading, setTDL]     = useState(false)
  const [replyText, setReplyText]         = useState('')
  const [replyLoading, setReplyLoading]   = useState(false)
  const [noteText, setNoteText]           = useState('')
  const [noteLoading, setNoteLoading]     = useState(false)
  const [escalateNote, setEscNote]        = useState('')
  const [escalateOpen, setEscOpen]        = useState(false)
  const [actionLoading, setAL]            = useState(false)

  // ── Reports ────────────────────────────────────────────────
  const [reports, setReports]               = useState<any[]>([])
  const [reportsLoading, setRL2]            = useState(false)
  const [reportFilter, setReportFilter]     = useState('')
  const [reportPage, setReportPage]         = useState(1)
  const [reportPag, setReportPag]           = useState<any>(null)
  const [reportDetail, setReportDetail]     = useState<any>(null)
  const [reportDetailLoading, setRDL]       = useState(false)
  const [reportNoteText, setReportNote]     = useState('')
  const [reportNoteLoading, setRNL]         = useState(false)
  const [reportReplyText, setReportReply]   = useState('')
  const [reportReplyLoading, setRRL]        = useState(false)
  const [reportEscNote, setRescNote]        = useState('')
  const [reportEscOpen, setRescOpen]        = useState(false)
  const [reportActionLoading, setRAL]       = useState(false)

  useEffect(() => {
    adminApi.getUsers({ limit: 200 }).then(res => {
      const d = (res.data as any)?.data || res.data
      setStaff((d?.users || []).filter((u: any) => ['CUSTOMER_SERVICE','ADMIN','SUPER_ADMIN'].includes(u.role)))
    }).catch(() => {})
  }, [])

  const loadTickets = async () => {
    setTL(true)
    try {
      const res = await csApi.getTickets({ status: ticketFilter || undefined, page: ticketPage, limit: 20 })
      const d = (res.data as any)?.data || res.data
      setTickets(d?.tickets || []); setTicketPag(d?.pagination)
    } catch { showToast('Could not load tickets', 'error') }
    finally { setTL(false) }
  }

  const loadReports = async () => {
    setRL2(true)
    try {
      const res = await csApi.getDisputes({ status: reportFilter || undefined, page: reportPage, limit: 20 })
      const d = (res.data as any)?.data || res.data
      setReports(d?.disputes || []); setReportPag(d?.pagination)
    } catch { showToast('Could not load reports', 'error') }
    finally { setRL2(false) }
  }

  useEffect(() => { if (tab === 'tickets') loadTickets() }, [tab, ticketPage, ticketFilter])
  useEffect(() => { if (tab === 'reports') loadReports() }, [tab, reportPage, reportFilter])

  const openTicket = async (t: any) => {
    setTDL(true); setTicketDetail({ ticket: t, replies: [], notes: [] })
    if (ticketPollRef.current) clearInterval(ticketPollRef.current)
    const fetchTicket = async () => {
      try {
        const res = await csApi.getTicketDetail(t.id)
        const d = (res.data as any)?.data || res.data
        setTicketDetail(d)
      } catch {}
    }
    await fetchTicket()
    setTDL(false)
    ticketPollRef.current = setInterval(fetchTicket, 4000)
  }

  const handleReply = async () => {
    if (!ticketDetail?.ticket || !replyText.trim()) return
    setReplyLoading(true)
    try {
      await csApi.replyToTicket(ticketDetail.ticket.id, replyText)
      setReplyText(''); loadTickets()
    } catch (err: any) { showToast(err?.response?.data?.message || 'Failed', 'error') }
    finally { setReplyLoading(false) }
  }

  const handleAddNote = async () => {
    if (!ticketDetail?.ticket || !noteText.trim()) return
    setNoteLoading(true)
    try {
      await csApi.addTicketNote(ticketDetail.ticket.id, noteText)
      setNoteText(''); showToast('Internal note added', 'success')
    } catch (err: any) { showToast(err?.response?.data?.message || 'Failed', 'error') }
    finally { setNoteLoading(false) }
  }

  const handleTicketStatus = async (status: string) => {
    if (!ticketDetail?.ticket) return
    try {
      await csApi.updateTicketStatus(ticketDetail.ticket.id, status)
      showToast('Status updated', 'success')
      setTicketDetail({ ...ticketDetail, ticket: { ...ticketDetail.ticket, status } })
      loadTickets()
    } catch (err: any) { showToast(err?.response?.data?.message || 'Failed', 'error') }
  }

  const handleAssignTicket = async (assigneeId: string) => {
    if (!ticketDetail?.ticket || !assigneeId) return
    try { await csApi.assignTicket(ticketDetail.ticket.id, assigneeId); showToast('Assigned', 'success'); loadTickets() }
    catch (err: any) { showToast(err?.response?.data?.message || 'Failed', 'error') }
  }

  const handleEscalateTicket = async () => {
    if (!ticketDetail?.ticket) return
    setAL(true)
    try {
      await csApi.escalateTicket(ticketDetail.ticket.id, escalateNote || undefined)
      showToast('Escalated to Admin queue', 'success')
      setEscOpen(false); setEscNote('')
      setTicketDetail({ ...ticketDetail, ticket: { ...ticketDetail.ticket, escalatedAt: new Date() } })
      loadTickets()
    } catch (err: any) { showToast(err?.response?.data?.message || 'Failed', 'error') }
    finally { setAL(false) }
  }

  const openReport = async (r: any) => {
    setRDL(true); setReportDetail({ dispute: r, notes: [] })
    if (pollRef.current) clearInterval(pollRef.current)
    const fetchReport = async () => {
      try {
        const [detail, notes] = await Promise.all([csApi.getDisputeDetail(r.id), csApi.getDisputeNotes(r.id)])
        const d = (detail.data as any)?.data || detail.data
        const n = (notes.data as any)?.data || notes.data
        setReportDetail((prev: any) => ({ ...d, notes: Array.isArray(n) ? n : [], reporter: d?.reporter || prev?.reporter }))
      } catch {}
    }
    await fetchReport()
    setRDL(false)
    pollRef.current = setInterval(fetchReport, 4000)
  }

  const handleReportReply = async () => {
    if (!reportDetail?.dispute || !reportReplyText.trim()) return
    setRRL(true)
    try {
      const token = localStorage.getItem('accessToken') || localStorage.getItem('token')
      const reporterId = reportDetail?.reporter?.id || reportDetail?.dispute?.reporterId
      await fetch(`${import.meta.env.VITE_API_URL || 'http://localhost:4000'}/notifications`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
        body: JSON.stringify({ userId: reporterId, type: 'SYSTEM', title: `Update on your report: ${reportDetail.dispute.type}`, body: reportReplyText.trim() })
      }).catch(() => {})
      await csApi.addDisputeNote(reportDetail.dispute.id, `[REPLY TO REPORTER] ${reportReplyText.trim()}`)
      setReportReply('')
      showToast('Reply sent to reporter', 'success')
    } catch { showToast('Failed to send reply', 'error') }
    finally { setRRL(false) }
  }

  const handleReportNote = async () => {
    if (!reportDetail?.dispute || !reportNoteText.trim()) return
    setRNL(true)
    try {
      await csApi.addDisputeNote(reportDetail.dispute.id, reportNoteText)
      setReportNote(''); showToast('Internal note added', 'success')
    } catch (err: any) { showToast(err?.response?.data?.message || 'Failed', 'error') }
    finally { setRNL(false) }
  }

  const handleReportStatus = async (status: string) => {
    if (!reportDetail?.dispute) return
    try {
      await csApi.updateDisputeStatus(reportDetail.dispute.id, status)
      showToast('Status updated', 'success')
      setReportDetail({ ...reportDetail, dispute: { ...reportDetail.dispute, status } })
      loadReports()
    } catch (err: any) { showToast(err?.response?.data?.message || 'Failed', 'error') }
  }

  const handleEscalateReport = async () => {
    if (!reportDetail?.dispute) return
    setRAL(true)
    try {
      await csApi.escalateDispute(reportDetail.dispute.id, reportEscNote || undefined)
      showToast('Report escalated to Admin', 'success')
      setRescOpen(false); setRescNote('')
      setReportDetail({ ...reportDetail, dispute: { ...reportDetail.dispute, status: 'ESCALATED' } })
      loadReports()
    } catch (err: any) { showToast(err?.response?.data?.message || 'Failed', 'error') }
    finally { setRAL(false) }
  }

  return (
    <DashboardLayout title="Customer Service" subtitle="Tickets · Reports · Escalations">
      <div className="p-6 max-w-7xl space-y-5">

        <div className="flex gap-1 bg-white border border-black/[0.06] rounded-xl p-1 w-fit">
          {(['tickets','reports'] as Tab[]).map(t => (
            <button key={t} onClick={() => setTab(t)}
              className={`px-4 py-2 rounded-lg text-[12px] font-semibold transition-all ${tab === t ? 'bg-ink text-warm' : 'text-dim hover:text-ink'}`}>
              {t === 'tickets' ? 'Support Tickets' : 'Reports'}
            </button>
          ))}
        </div>

        {/* ── Tickets tab ── */}
        {tab === 'tickets' && (
          <div className="space-y-4">
            <select value={ticketFilter} onChange={e => { setTicketFilter(e.target.value); setTicketPage(1) }}
              className="h-10 border border-black/[0.09] rounded-xl px-3 text-[12px] text-ink bg-white outline-none focus:border-brand cursor-pointer">
              <option value="">All tickets</option>
              <option value="OPEN">Open</option>
              <option value="IN_PROGRESS">In progress</option>
              <option value="ESCALATED">Escalated to Admin</option>
              <option value="RESOLVED">Resolved</option>
              <option value="CLOSED">Closed</option>
            </select>
            <div className="bg-white rounded-2xl border border-black/[0.06] overflow-hidden">
              {ticketsLoading
                ? <div className="p-5 space-y-3">{[...Array(4)].map((_,i) => <Skeleton key={i} className="h-14 rounded-xl"/>)}</div>
                : tickets.length === 0 ? <EmptyState icon="💬" title="No tickets found"/>
                : <table className="w-full">
                    <thead className="bg-warm border-b border-black/[0.05]">
                      <tr>{['User','Subject','Priority','Status','Escalated','Created',''].map(h => (
                        <th key={h} className="px-4 py-3 text-left text-[10px] font-bold text-mist uppercase tracking-wider">{h}</th>
                      ))}</tr>
                    </thead>
                    <tbody>
                      {tickets.map((t: any) => (
                        <tr key={t.id} className="border-b border-black/[0.04] last:border-0 hover:bg-warm/50 transition-colors">
                          <td className="px-4 py-3">
                            <p className="text-[12px] font-semibold text-ink">{t.user?.firstName} {t.user?.lastName}</p>
                            <p className="text-[11px] text-mist font-mono">@{t.user?.username}</p>
                            <p className="text-[10px] text-mist">{t.user?.email}</p>
                          </td>
                          <td className="px-4 py-3 text-[12px] text-ink max-w-[200px] truncate">{t.subject}</td>
                          <td className="px-4 py-3"><Badge variant={pv(t.priority)}>{t.priority?.toLowerCase()}</Badge></td>
                          <td className="px-4 py-3"><Badge variant={tsv(t.status)}>{t.status?.replace('_',' ').toLowerCase()}</Badge></td>
                          <td className="px-4 py-3 text-[11px]">
                            {t.escalatedAt ? <span className="text-orange-500 font-semibold">⬆ {dayjs(t.escalatedAt).fromNow()}</span> : <span className="text-mist">—</span>}
                          </td>
                          <td className="px-4 py-3 text-[10px] text-mist font-mono">{dayjs(t.createdAt).format('MMM D, h:mm A')}</td>
                          <td className="px-4 py-3"><Button size="sm" variant="secondary" onClick={() => openTicket(t)}>Open</Button></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>}
              {ticketPag && ticketPag.totalPages > 1 && (
                <div className="flex items-center justify-between px-4 py-3 border-t border-black/[0.05]">
                  <p className="text-[12px] text-mist">Page {ticketPag.page} of {ticketPag.totalPages}</p>
                  <div className="flex gap-2">
                    <Button size="sm" variant="secondary" disabled={ticketPage===1} onClick={() => setTicketPage(p => p-1)}>Prev</Button>
                    <Button size="sm" variant="secondary" disabled={ticketPage>=ticketPag.totalPages} onClick={() => setTicketPage(p => p+1)}>Next</Button>
                  </div>
                </div>
              )}
            </div>
          </div>
        )}

        {/* ── Reports tab ── */}
        {tab === 'reports' && (
          <div className="space-y-4">
            <select value={reportFilter} onChange={e => { setReportFilter(e.target.value); setReportPage(1) }}
              className="h-10 border border-black/[0.09] rounded-xl px-3 text-[12px] text-ink bg-white outline-none focus:border-brand cursor-pointer">
              <option value="">All reports</option>
              <option value="OPEN">Open</option>
              <option value="UNDER_REVIEW">Under review</option>
              <option value="ESCALATED">Escalated to Admin</option>
              <option value="RESOLVED">Resolved</option>
              <option value="DISMISSED">Dismissed</option>
            </select>
            <div className="bg-white rounded-2xl border border-black/[0.06] overflow-hidden">
              {reportsLoading
                ? <div className="p-5 space-y-3">{[...Array(4)].map((_,i) => <Skeleton key={i} className="h-14 rounded-xl"/>)}</div>
                : reports.length === 0 ? <EmptyState icon="🚩" title="No reports found"/>
                : <table className="w-full">
                    <thead className="bg-warm border-b border-black/[0.05]">
                      <tr>{['Reporter','Target','Type','Status','Filed',''].map(h => (
                        <th key={h} className="px-4 py-3 text-left text-[10px] font-bold text-mist uppercase tracking-wider">{h}</th>
                      ))}</tr>
                    </thead>
                    <tbody>
                      {reports.map((r: any) => (
                        <tr key={r.id} className="border-b border-black/[0.04] last:border-0 hover:bg-warm/50 transition-colors">
                          <td className="px-4 py-3">
                            <p className="text-[12px] font-semibold text-ink">{r.reporter?.username || '—'}</p>
                            <p className="text-[10px] text-mist">{r.reporter?.email}</p>
                          </td>
                          <td className="px-4 py-3 text-[11px] text-dim">
                            {r.reportedUser ? `@${r.reportedUser.username}` : r.groupId ? `Group · ${r.groupId.slice(0,8)}…` : <span className="text-mist">General</span>}
                          </td>
                          <td className="px-4 py-3 text-[12px] text-ink">{r.type}</td>
                          <td className="px-4 py-3"><Badge variant={dsv(r.status)}>{r.status?.replace('_',' ').toLowerCase()}</Badge></td>
                          <td className="px-4 py-3 text-[10px] text-mist font-mono">{dayjs(r.createdAt).format('MMM D, h:mm A')}</td>
                          <td className="px-4 py-3"><Button size="sm" variant="secondary" onClick={() => openReport(r)}>Open</Button></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>}
              {reportPag && reportPag.totalPages > 1 && (
                <div className="flex items-center justify-between px-4 py-3 border-t border-black/[0.05]">
                  <p className="text-[12px] text-mist">Page {reportPag.page} of {reportPag.totalPages}</p>
                  <div className="flex gap-2">
                    <Button size="sm" variant="secondary" disabled={reportPage===1} onClick={() => setReportPage(p => p-1)}>Prev</Button>
                    <Button size="sm" variant="secondary" disabled={reportPage>=reportPag.totalPages} onClick={() => setReportPage(p => p+1)}>Next</Button>
                  </div>
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      {/* ══════════════════════════════════════════════════════
          TICKET DETAIL MODAL
      ══════════════════════════════════════════════════════ */}
      <Modal open={!!ticketDetail} onClose={() => {
          setTicketDetail(null); setReplyText(''); setNoteText('')
          if (ticketPollRef.current) clearInterval(ticketPollRef.current)
        }} title={ticketDetail?.ticket?.subject || 'Ticket'} size="lg">
        {ticketDetailLoading
          ? <div className="space-y-3">{[...Array(3)].map((_,i) => <Skeleton key={i} className="h-12 rounded-xl"/>)}</div>
          : (
          <div className="space-y-0">

            <div className="flex items-center gap-2 flex-wrap pb-4 border-b border-black/[0.05]">
              <Badge variant={pv(ticketDetail?.ticket?.priority)}>{ticketDetail?.ticket?.priority?.toLowerCase()}</Badge>
              <select value={ticketDetail?.ticket?.status} onChange={e => handleTicketStatus(e.target.value)}
                className="h-8 border border-black/[0.08] rounded-lg px-2 text-[11px] text-ink bg-white outline-none focus:border-brand cursor-pointer">
                <option value="OPEN">Open</option>
                <option value="IN_PROGRESS">In progress</option>
                <option value="RESOLVED">Resolved</option>
                <option value="CLOSED">Closed</option>
              </select>
              <select onChange={e => handleAssignTicket(e.target.value)} defaultValue=""
                className="h-8 border border-black/[0.08] rounded-lg px-2 text-[11px] text-ink bg-white outline-none focus:border-brand cursor-pointer">
                <option value="" disabled>Assign to…</option>
                {staff.map(s => <option key={s.id} value={s.id}>{s.firstName} ({s.role.replace('_',' ').toLowerCase()})</option>)}
              </select>
              {!ticketDetail?.ticket?.escalatedAt
                ? <Button size="sm" variant="danger" onClick={() => setEscOpen(true)}>Escalate to Admin</Button>
                : <Badge variant="danger">⬆ Escalated</Badge>}
            </div>

            {ticketDetail?.user && (
              <div className="py-4 border-b border-black/[0.05]">
                <div className="flex items-center gap-3 bg-warm rounded-xl px-4 py-3">
                  <div className="w-9 h-9 rounded-full bg-ink flex items-center justify-center text-white text-[12px] font-bold flex-shrink-0">
                    {ticketDetail.user.firstName?.[0]}{ticketDetail.user.lastName?.[0]}
                  </div>
                  <div>
                    <p className="text-[13px] font-semibold text-ink">{ticketDetail.user.firstName} {ticketDetail.user.lastName}</p>
                    <p className="text-[11px] text-mist">@{ticketDetail.user.username} · {ticketDetail.user.email}</p>
                  </div>
                </div>
              </div>
            )}

            <div className="py-4 border-b border-black/[0.05]">
              <p className="text-[11px] font-bold text-mist uppercase tracking-wider mb-3">Conversation</p>
              <div className="space-y-3 max-h-64 overflow-y-auto pr-1">
                {(ticketDetail?.replies || []).length === 0
                  ? <p className="text-[13px] text-mist text-center py-6">No messages yet</p>
                  : (ticketDetail?.replies || []).map((r: any) => {
                    const isCS = r.isAdminReply
                    const name = isCS
                      ? (r.author ? `${r.author.firstName} ${r.author.lastName}`.trim() : 'Support team')
                      : `${ticketDetail?.user?.firstName || ''} ${ticketDetail?.user?.lastName || ''}`.trim() || 'User'
                    const initials = name.split(' ').map((n: string) => n[0]).join('').slice(0,2).toUpperCase()
                    return (
                      <div key={r.id} className={`flex gap-2.5 ${isCS ? 'flex-row-reverse' : 'flex-row'}`}>
                        <div className={`w-8 h-8 rounded-full flex items-center justify-center text-[10px] font-bold flex-shrink-0 ${isCS ? 'bg-brand text-white' : 'bg-ink text-white'}`}>
                          {initials}
                        </div>
                        <div className={`max-w-[72%] flex flex-col ${isCS ? 'items-end' : 'items-start'}`}>
                          <p className="text-[10px] text-mist mb-1">{name} · {dayjs(r.createdAt).format('MMM D, h:mm A')}</p>
                          <div className={`rounded-2xl px-4 py-2.5 text-[13px] leading-relaxed ${isCS ? 'bg-brand text-white rounded-tr-sm' : 'bg-warm text-ink rounded-tl-sm'}`}>
                            {r.message}
                          </div>
                        </div>
                      </div>
                    )
                  })}
              </div>
              <div className="mt-4 flex gap-2 items-end">
                <textarea value={replyText} onChange={e => setReplyText(e.target.value)} rows={2}
                  placeholder="Reply to user — they will see this message…"
                  className="flex-1 border border-black/[0.08] rounded-xl px-4 py-2.5 text-[13px] text-ink bg-white outline-none focus:border-brand resize-none transition-all"/>
                <Button onClick={handleReply} loading={replyLoading} disabled={!replyText.trim()}>Send</Button>
              </div>
            </div>

            <div className="pt-4">
              <div className="flex items-center gap-2 mb-3">
                <span className="text-amber-500">🔒</span>
                <p className="text-[11px] font-bold text-amber-600 uppercase tracking-wider">Internal Notes — not visible to user</p>
              </div>
              <div className="space-y-2 mb-3">
                {(ticketDetail?.notes || []).length === 0
                  ? <p className="text-[12px] text-mist">No internal notes yet.</p>
                  : (ticketDetail?.notes || []).map((n: any) => (
                    <div key={n.id} className="bg-amber-50 border border-amber-100 rounded-xl p-3">
                      <p className="text-[10px] text-amber-600 font-semibold mb-1">Staff · {dayjs(n.createdAt).format('MMM D, h:mm A')}</p>
                      <p className="text-[12px] text-amber-900">{n.content}</p>
                    </div>
                  ))}
              </div>
              <div className="flex gap-2">
                <input value={noteText} onChange={e => setNoteText(e.target.value)} placeholder="Add a private note for your team…"
                  className="flex-1 h-9 border border-black/[0.08] rounded-xl px-3 text-[12px] text-ink bg-white outline-none focus:border-brand"/>
                <Button size="sm" variant="secondary" loading={noteLoading} disabled={!noteText.trim()} onClick={handleAddNote}>Add note</Button>
              </div>
            </div>
          </div>
        )}
      </Modal>

      {/* ══════════════════════════════════════════════════════
          REPORT DETAIL MODAL
      ══════════════════════════════════════════════════════ */}
      <Modal open={!!reportDetail} onClose={() => {
          setReportDetail(null); setReportNote(''); setRescNote(''); setReportReply('')
          if (pollRef.current) clearInterval(pollRef.current)
        }} title={reportDetail?.dispute?.type || 'Report'} size="lg">
        {reportDetailLoading
          ? <div className="space-y-3">{[...Array(3)].map((_,i) => <Skeleton key={i} className="h-12 rounded-xl"/>)}</div>
          : (
          <div className="space-y-0">

            <div className="flex items-center gap-2 flex-wrap pb-4 border-b border-black/[0.05]">
              <Badge variant={dsv(reportDetail?.dispute?.status)}>{reportDetail?.dispute?.status?.replace('_',' ').toLowerCase()}</Badge>
              {reportDetail?.dispute?.groupId && <Badge variant="neutral">Group report</Badge>}
              {reportDetail?.dispute?.reportedUserId && <Badge variant="neutral">Member report</Badge>}
              {reportDetail?.dispute?.status === 'OPEN' && (
                <Button size="sm" variant="secondary" onClick={() => handleReportStatus('UNDER_REVIEW')}>Mark under review</Button>
              )}
              {!['ESCALATED','RESOLVED','DISMISSED','CLOSED'].includes(reportDetail?.dispute?.status) && (
                <Button size="sm" variant="danger" onClick={() => setRescOpen(true)}>Escalate to Admin</Button>
              )}
              {reportDetail?.dispute?.status === 'ESCALATED' && <Badge variant="danger">⬆ Escalated to Admin</Badge>}
            </div>

            <div className="py-4 border-b border-black/[0.05]">
              <div className="flex items-center gap-3 bg-warm rounded-xl px-4 py-3">
                <div className="w-9 h-9 rounded-full bg-ink flex items-center justify-center text-white text-[12px] font-bold flex-shrink-0">
                  {(reportDetail?.reporter?.username || '?')[0].toUpperCase()}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-[13px] font-semibold text-ink">@{reportDetail?.reporter?.username || '—'}</p>
                  <p className="text-[11px] text-mist">{reportDetail?.reporter?.email || '—'}</p>
                </div>
                {reportDetail?.reportedUser && (
                  <div className="text-right">
                    <p className="text-[10px] text-mist uppercase tracking-wider mb-0.5">Against</p>
                    <p className="text-[12px] font-semibold text-ink">@{reportDetail.reportedUser.username}</p>
                  </div>
                )}
              </div>
            </div>

            <div className="py-4 border-b border-black/[0.05]">
              <p className="text-[11px] font-bold text-mist uppercase tracking-wider mb-2">What they reported</p>
              <p className="text-[13px] text-ink leading-relaxed bg-warm rounded-xl px-4 py-3">{reportDetail?.dispute?.description}</p>
              <p className="text-[10px] text-mist mt-2 font-mono">Filed {dayjs(reportDetail?.dispute?.createdAt).format('MMM D, YYYY h:mm A')}</p>
            </div>

            {/* Conversation thread — CS replies + user replies interleaved */}
            <div className="py-4 border-b border-black/[0.05]">
              <p className="text-[11px] font-bold text-mist uppercase tracking-wider mb-3">💬 Reply to reporter</p>
              <p className="text-[11px] text-mist mb-3">Sends a notification to @{reportDetail?.reporter?.username}. Saved as a record.</p>

              <div className="space-y-3 max-h-52 overflow-y-auto pr-1 mb-4">
                {(reportDetail?.notes || [])
                  .filter((n: any) => n.content?.startsWith('[REPLY TO REPORTER]') || n.content?.startsWith('[USER REPLY]'))
                  .sort((a: any, b: any) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime())
                  .map((n: any) => {
                    const isCS = n.content?.startsWith('[REPLY TO REPORTER]')
                    const text = n.content.replace('[REPLY TO REPORTER] ', '').replace('[USER REPLY] ', '')
                    return (
                      <div key={n.id} className={`flex gap-2.5 ${isCS ? 'flex-row-reverse' : 'flex-row'}`}>
                        <div className={`w-7 h-7 rounded-full flex items-center justify-center text-[10px] font-bold text-white flex-shrink-0 ${isCS ? 'bg-brand' : 'bg-ink'}`}>
                          {isCS ? 'CS' : 'U'}
                        </div>
                        <div className={`max-w-[80%] flex flex-col ${isCS ? 'items-end' : 'items-start'}`}>
                          <p className="text-[10px] text-mist mb-1">
                            {isCS ? 'Support team' : `@${reportDetail?.reporter?.username || 'User'}`} · {dayjs(n.createdAt).format('MMM D, h:mm A')}
                          </p>
                          <div className={`rounded-2xl px-4 py-2.5 text-[13px] leading-relaxed ${isCS ? 'bg-brand text-white rounded-tr-sm' : 'bg-warm text-ink rounded-tl-sm'}`}>
                            {text}
                          </div>
                        </div>
                      </div>
                    )
                  })}
              </div>

              <div className="flex gap-2 items-end">
                <textarea value={reportReplyText} onChange={e => setReportReply(e.target.value)} rows={2}
                  placeholder={`Message to @${reportDetail?.reporter?.username || 'reporter'}…`}
                  className="flex-1 border border-black/[0.08] rounded-xl px-4 py-2.5 text-[13px] text-ink bg-white outline-none focus:border-brand resize-none transition-all"/>
                <Button loading={reportReplyLoading} disabled={!reportReplyText.trim()} onClick={handleReportReply}>Send</Button>
              </div>
            </div>

            {/* Internal notes — hidden from reporter */}
            <div className="pt-4">
              <div className="flex items-center gap-2 mb-3">
                <span className="text-amber-500">🔒</span>
                <p className="text-[11px] font-bold text-amber-600 uppercase tracking-wider">Internal Notes — staff only</p>
              </div>
              <div className="space-y-2 mb-3">
                {(reportDetail?.notes || [])
                  .filter((n: any) => !n.content?.startsWith('[REPLY TO REPORTER]') && !n.content?.startsWith('[USER REPLY]'))
                  .length === 0
                  ? <p className="text-[12px] text-mist">No internal notes yet.</p>
                  : (reportDetail?.notes || [])
                      .filter((n: any) => !n.content?.startsWith('[REPLY TO REPORTER]') && !n.content?.startsWith('[USER REPLY]'))
                      .map((n: any) => (
                        <div key={n.id} className="bg-amber-50 border border-amber-100 rounded-xl p-3">
                          <p className="text-[10px] text-amber-600 font-semibold mb-1">Staff · {dayjs(n.createdAt).format('MMM D, h:mm A')}</p>
                          <p className="text-[12px] text-amber-900">{n.content}</p>
                        </div>
                      ))}
              </div>
              <div className="flex gap-2">
                <input value={reportNoteText} onChange={e => setReportNote(e.target.value)} placeholder="Add a private note for your team…"
                  className="flex-1 h-9 border border-black/[0.08] rounded-xl px-3 text-[12px] text-ink bg-white outline-none focus:border-brand"/>
                <Button size="sm" variant="secondary" loading={reportNoteLoading} disabled={!reportNoteText.trim()} onClick={handleReportNote}>Add note</Button>
              </div>
            </div>
          </div>
        )}
      </Modal>

      {/* ── Escalate ticket modal ── */}
      <Modal open={escalateOpen} onClose={() => setEscOpen(false)} title="Escalate to Admin queue" size="sm"
        footer={<><Button variant="secondary" onClick={() => setEscOpen(false)}>Cancel</Button><Button variant="danger" loading={actionLoading} onClick={handleEscalateTicket}>Escalate</Button></>}>
        <div className="space-y-4">
          <div className="bg-orange-50 border border-orange-100 rounded-xl p-4">
            <p className="text-[13px] font-semibold text-orange-700 mb-1">Sends to Admin Escalation Queue</p>
            <p className="text-[12px] text-orange-600">Use when the issue needs Admin action — suspension, fraud review, or financial investigation.</p>
          </div>
          <div>
            <label className="block text-[12px] font-medium text-dim mb-1.5">Escalation note (recommended)</label>
            <textarea value={escalateNote} onChange={e => setEscNote(e.target.value)} rows={3}
              placeholder="Why is this being escalated? What action is needed?"
              className="w-full border border-black/[0.08] rounded-xl px-3 py-2 text-[13px] text-ink bg-white outline-none focus:border-brand resize-none"/>
          </div>
        </div>
      </Modal>

      {/* ── Escalate report modal ── */}
      <Modal open={reportEscOpen} onClose={() => setRescOpen(false)} title="Escalate report to Admin" size="sm"
        footer={<><Button variant="secondary" onClick={() => setRescOpen(false)}>Cancel</Button><Button variant="danger" loading={reportActionLoading} onClick={handleEscalateReport}>Escalate</Button></>}>
        <div className="space-y-4">
          <div className="bg-orange-50 border border-orange-100 rounded-xl p-4">
            <p className="text-[13px] font-semibold text-orange-700 mb-1">Sends to Admin Escalation Queue</p>
            <p className="text-[12px] text-orange-600">Admin will be notified and can investigate and take enforcement action.</p>
          </div>
          <div>
            <label className="block text-[12px] font-medium text-dim mb-1.5">Escalation note</label>
            <textarea value={reportEscNote} onChange={e => setRescNote(e.target.value)} rows={3}
              placeholder="Summarise why this needs Admin attention…"
              className="w-full border border-black/[0.08] rounded-xl px-3 py-2 text-[13px] text-ink bg-white outline-none focus:border-brand resize-none"/>
          </div>
        </div>
      </Modal>
    </DashboardLayout>
  )
}