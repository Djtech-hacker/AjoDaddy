import { useState, useEffect } from 'react'
import { motion } from 'framer-motion'
import DashboardLayout from '@/components/layout/DashboardLayout'
import { Button, Badge, Avatar, Skeleton, EmptyState, Modal, Input } from '@/components/ui'
import { superAdminApi } from '@/api/services'
import { useAuthStore } from '@/stores/authStore'
import { useUIStore } from '@/stores/uiStore'
import dayjs from 'dayjs'

type Tab = 'overview' | 'cs-oversight' | 'users' | 'revenue' | 'settings' | 'audit'

const rv = (r: string) => ({ SUPER_ADMIN:'success', ADMIN:'brand', CUSTOMER_SERVICE:'warning', USER:'neutral' } as any)[r] || 'neutral'
const sv = (s: string) => ({ ACTIVE:'success', BANNED:'danger', SUSPENDED:'warning' } as any)[s] || 'neutral'
const tsv = (s: string) => ({ OPEN:'warning', IN_PROGRESS:'brand', RESOLVED:'success', CLOSED:'neutral' } as any)[s] || 'neutral'
const dsv = (s: string) => ({ OPEN:'warning', UNDER_REVIEW:'warning', ESCALATED:'danger', RESOLVED:'success', CLOSED:'neutral', DISMISSED:'neutral' } as any)[s] || 'neutral'
const pv  = (p: string) => ({ LOW:'neutral', MEDIUM:'warning', HIGH:'danger', URGENT:'danger' } as any)[p] || 'neutral'

const KYC_ACTIONS = ['KYC_MANUALLY_APPROVED','KYC_MANUALLY_REJECTED','KYC_COMPLETED','KYC_NIN_VERIFIED','KYC_BVN_VERIFIED','KYC_MANUAL_REVIEW','KYC_DUPLICATE_NIN_ATTEMPT','KYC_DUPLICATE_BVN_ATTEMPT','KYC_IDENTITY_REVEALED','KYC_FACE_SUBMITTED']

// Shared classnames for the horizontally-scrolling pill tab bars so they
// behave on narrow screens (no nested-scroll fighting, no visible scrollbar).
const TAB_BAR = 'flex gap-1 bg-white border border-black/[0.06] rounded-xl p-1 overflow-x-auto flex-nowrap [scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden'
const TAB_BTN = (active: boolean) =>
  `px-3 sm:px-4 py-2 rounded-lg text-[12px] font-semibold whitespace-nowrap transition-all flex-shrink-0 ${active ? 'bg-ink text-warm' : 'text-dim hover:text-ink'}`

export default function SuperAdminPage() {
  const { user: currentUser } = useAuthStore()
  const { showToast } = useUIStore()
  const [tab, setTab] = useState<Tab>('overview')

  const [dash, setDash]             = useState<any>(null)
  const [dashLoading, setDL]        = useState(false)
  const [recentReports, setRecentReports] = useState<any[]>([])
  const [reportStats, setReportStats]     = useState<any>(null)

  const [csTickets, setCsTickets]         = useState<any[]>([])
  const [csTicketsLoading, setCTL]        = useState(false)
  const [csTicketFilter, setCsTicketFilter] = useState('')
  const [csTicketPage, setCsTicketPage]   = useState(1)
  const [csTicketPag, setCsTicketPag]     = useState<any>(null)
  const [csReports, setCsReports]         = useState<any[]>([])
  const [csReportsLoading, setCRL]        = useState(false)
  const [csReportFilter, setCsReportFilter] = useState('')
  const [csReportPage, setCsReportPage]   = useState(1)
  const [csReportPag, setCsReportPag]     = useState<any>(null)
  const [csAgents, setCsAgents]           = useState<any[]>([])
  const [csSubTab, setCsSubTab]           = useState<'tickets' | 'reports' | 'agents'>('tickets')
  const [csTicketDetail, setCsTicketDetail] = useState<any>(null)
  const [csTicketDetailLoading, setCTDL]  = useState(false)
  const [csReportDetail, setCsReportDetail] = useState<any>(null)
  const [csReportDetailLoading, setCRDL]  = useState(false)

  const [users, setUsers]           = useState<any[]>([])
  const [usersLoading, setUL]       = useState(false)
  const [search, setSearch]         = useState('')
  const [roleFilter, setRoleFilter] = useState('')
  const [usersPage, setUsersPage]   = useState(1)
  const [usersPag, setUsersPag]     = useState<any>(null)
  const [roleLoading, setRoleLoading] = useState<string | null>(null)
  const [banModal, setBanModal]     = useState<any>(null)
  const [banReason, setBanReason]   = useState('')
  const [banLoading, setBanLoading] = useState(false)
  const [deleteModal, setDeleteModal] = useState<any>(null)
  const [deleteReason, setDeleteReason] = useState('')
  const [deleteLoading, setDeleteLoading] = useState(false)

  // ── Company revenue ──
  const [revenue, setRevenue]           = useState<any>(null)
  const [revenueLoading, setRevenueLoading] = useState(false)
  const [revenueSubTab, setRevenueSubTab]   = useState<'penalties' | 'platform-fees'>('penalties')

  const [settings, setSettings]     = useState<any>(null)
  const [settingsLoading, setSL]    = useState(false)
  const [saving, setSaving]         = useState(false)

  // ── Scheduled maintenance ──
  const [maintenanceScheduleAt, setMaintenanceScheduleAt]     = useState('')
  const [maintenanceAnnouncement, setMaintenanceAnnouncement] = useState('')
  const [schedulingMaintenance, setSchedulingMaintenance]     = useState(false)
  const [cancelingSchedule, setCancelingSchedule]             = useState(false)

  const [logs, setLogs]             = useState<any[]>([])
  const [logsLoading, setLL]        = useState(false)
  const [logsPage, setLogsPage]     = useState(1)
  const [logsPag, setLogsPag]       = useState<any>(null)
  const [actionFilter, setActionFilter] = useState('')
  const [logDetail, setLogDetail]   = useState<any>(null)

  const loadDash = async () => {
    setDL(true)
    try {
      const [dashRes, reportsRes] = await Promise.all([superAdminApi.getDashboard(), superAdminApi.getAllDisputes({ page: 1, limit: 10 })])
      setDash((dashRes.data as any)?.data || dashRes.data)
      const rd = (reportsRes.data as any)?.data || reportsRes.data
      const disputes = rd?.disputes || []
      setRecentReports(disputes)
      setReportStats({ total: rd?.pagination?.total || 0, open: disputes.filter((d: any) => d.status === 'OPEN').length, escalated: disputes.filter((d: any) => d.status === 'ESCALATED').length, resolved: disputes.filter((d: any) => d.status === 'RESOLVED').length })
    } catch { showToast('Could not load dashboard', 'error') }
    finally { setDL(false) }
  }

  const loadCsTickets = async () => {
    setCTL(true)
    try {
      const res = await superAdminApi.getAllTickets({ status: csTicketFilter || undefined, page: csTicketPage, limit: 20 })
      const d = (res.data as any)?.data || res.data
      setCsTickets(d?.tickets || []); setCsTicketPag(d?.pagination)
    } catch { showToast('Could not load tickets', 'error') }
    finally { setCTL(false) }
  }

  const loadCsReports = async () => {
    setCRL(true)
    try {
      const res = await superAdminApi.getAllDisputes({ status: csReportFilter || undefined, page: csReportPage, limit: 20 })
      const d = (res.data as any)?.data || res.data
      setCsReports(d?.disputes || []); setCsReportPag(d?.pagination)
    } catch { showToast('Could not load reports', 'error') }
    finally { setCRL(false) }
  }

  const loadCsAgents = async () => {
    try {
      const res = await superAdminApi.getUsers({ role: 'CUSTOMER_SERVICE', limit: 100 })
      const d = (res.data as any)?.data || res.data
      setCsAgents(d?.users || [])
    } catch { showToast('Could not load CS agents', 'error') }
  }

  const openCsTicket = async (t: any) => {
    setCTDL(true); setCsTicketDetail({ ticket: t, replies: [], notes: [], user: null })
    try { const res = await superAdminApi.getTicketDetail(t.id); setCsTicketDetail((res.data as any)?.data || res.data) }
    catch { showToast('Could not load ticket detail', 'error') }
    finally { setCTDL(false) }
  }

  const openCsReport = async (r: any) => {
    setCRDL(true); setCsReportDetail(r)
    try {
      const token = localStorage.getItem('accessToken') || localStorage.getItem('token')
      const headers = { 'Authorization': `Bearer ${token}` }
      const [detailRes, notesRes] = await Promise.all([
        fetch(`/api/cs/disputes/${r.id}`, { headers }),
        fetch(`/api/cs/disputes/${r.id}/notes`, { headers }),
      ])
      const detail = detailRes.ok ? await detailRes.json() : null
      const notes  = notesRes.ok  ? await notesRes.json()  : null
      setCsReportDetail({ ...(detail?.data?.dispute || r), reporter: detail?.data?.reporter || null, reportedUser: detail?.data?.reportedUser || null, notes: notes?.data || [] })
    } catch { setCsReportDetail(r) }
    finally { setCRDL(false) }
  }

  const loadUsers = async () => {
    setUL(true)
    try {
      const res = await superAdminApi.getUsers({ page: usersPage, limit: 30, search: search || undefined, role: roleFilter || undefined })
      const d = (res.data as any)?.data || res.data
      setUsers(d?.users || []); setUsersPag(d?.pagination)
    } catch { showToast('Could not load users', 'error') }
    finally { setUL(false) }
  }

  const loadRevenue = async () => {
    setRevenueLoading(true)
    try {
      const res = await superAdminApi.getRevenue()
      setRevenue((res.data as any)?.data || res.data)
    } catch { showToast('Could not load revenue data', 'error') }
    finally { setRevenueLoading(false) }
  }

  const loadSettings = async () => {
    setSL(true)
    try {
      const res = await superAdminApi.getSettings()
      const s = (res.data as any)?.data || res.data
      setSettings(s)
      setMaintenanceAnnouncement(s?.maintenanceAnnouncement || '')
      setMaintenanceScheduleAt(s?.maintenanceScheduledAt ? dayjs(s.maintenanceScheduledAt).format('YYYY-MM-DDTHH:mm') : '')
    }
    catch { showToast('Could not load settings', 'error') }
    finally { setSL(false) }
  }

  const loadLogs = async () => {
    setLL(true)
    try {
      const res = await superAdminApi.getFullAuditLog({ page: logsPage, limit: 40, action: actionFilter || undefined })
      const d = (res.data as any)?.data || res.data
      setLogs(d?.logs || []); setLogsPag(d?.pagination)
    } catch { showToast('Could not load logs', 'error') }
    finally { setLL(false) }
  }

  useEffect(() => { if (tab === 'overview') loadDash() }, [tab])
  useEffect(() => { if (tab === 'cs-oversight' && csSubTab === 'tickets') loadCsTickets() }, [tab, csSubTab, csTicketPage, csTicketFilter])
  useEffect(() => { if (tab === 'cs-oversight' && csSubTab === 'reports') loadCsReports() }, [tab, csSubTab, csReportPage, csReportFilter])
  useEffect(() => { if (tab === 'cs-oversight' && csSubTab === 'agents') loadCsAgents() }, [tab, csSubTab])
  useEffect(() => { if (tab === 'users') loadUsers() }, [tab, usersPage, search, roleFilter])
  useEffect(() => { if (tab === 'revenue') loadRevenue() }, [tab])
  useEffect(() => { if (tab === 'settings') loadSettings() }, [tab])
  useEffect(() => { if (tab === 'audit') loadLogs() }, [tab, logsPage, actionFilter])

  const handleRoleChange = async (u: any, newRole: string) => {
    if (newRole === u.role) return
    setRoleLoading(u.id)
    try { await superAdminApi.updateUserRole(u.id, newRole); showToast(`${u.firstName}'s role updated to ${newRole}`, 'success'); loadUsers() }
    catch (err: any) { showToast(err?.response?.data?.message || 'Failed', 'error') }
    finally { setRoleLoading(null) }
  }

  const handleBan = async () => {
    if (!banModal || !banReason.trim()) return
    setBanLoading(true)
    try { await superAdminApi.banUser(banModal.id, banReason); showToast(`${banModal.firstName} permanently banned`, 'success'); setBanModal(null); setBanReason(''); loadUsers() }
    catch (err: any) { showToast(err?.response?.data?.message || 'Failed', 'error') }
    finally { setBanLoading(false) }
  }

  const handleDelete = async () => {
    if (!deleteModal || !deleteReason.trim()) return
    setDeleteLoading(true)
    try { await superAdminApi.deleteUser(deleteModal.id, deleteReason); showToast('Account deleted', 'success'); setDeleteModal(null); setDeleteReason(''); loadUsers() }
    catch (err: any) { showToast(err?.response?.data?.message || 'Failed', 'error') }
    finally { setDeleteLoading(false) }
  }

  const handleSaveSettings = async () => {
    if (!settings) return
    setSaving(true)
    try {
      await superAdminApi.updateSettings({ reportFlagThreshold: settings.reportFlagThreshold, reportHighPriorityThreshold: settings.reportHighPriorityThreshold, reportAutoEscalateThreshold: settings.reportAutoEscalateThreshold, platformFeePercent: settings.platformFeePercent, withdrawalsFrozen: settings.withdrawalsFrozen, contributionsFrozen: settings.contributionsFrozen, maintenanceMode: settings.maintenanceMode })
      showToast('Settings saved', 'success')
    } catch (err: any) { showToast(err?.response?.data?.message || 'Failed to save', 'error') }
    finally { setSaving(false) }
  }

  const handleScheduleMaintenance = async () => {
    if (!maintenanceScheduleAt) return
    setSchedulingMaintenance(true)
    try {
      await superAdminApi.updateSettings({
        maintenanceScheduledAt: new Date(maintenanceScheduleAt).toISOString(),
        maintenanceAnnouncement: maintenanceAnnouncement || undefined,
      })
      showToast('Maintenance scheduled — customers will see a countdown', 'success')
      loadSettings()
    } catch (err: any) { showToast(err?.response?.data?.message || 'Failed to schedule maintenance', 'error') }
    finally { setSchedulingMaintenance(false) }
  }

  const handleCancelSchedule = async () => {
    setCancelingSchedule(true)
    try {
      await superAdminApi.updateSettings({ clearScheduledMaintenance: true })
      showToast('Scheduled maintenance cancelled', 'success')
      setMaintenanceScheduleAt('')
      loadSettings()
    } catch (err: any) { showToast(err?.response?.data?.message || 'Failed', 'error') }
    finally { setCancelingSchedule(false) }
  }

  const overview = dash?.overview || {}

  const TABS: { id: Tab; label: string }[] = [
    { id: 'overview',     label: 'Overview'          },
    { id: 'cs-oversight', label: 'CS Oversight'      },
    { id: 'users',        label: 'Users & Roles'     },
    { id: 'revenue',      label: 'Company Revenue'   },
    { id: 'settings',     label: 'Platform Settings' },
    { id: 'audit',        label: 'Full Audit Log'    },
  ]

  // ── Helpers for audit log rendering ───────────────────────
  const getActionColor = (action: string) => {
    if (action === 'KYC_IDENTITY_REVEALED') return 'text-purple-700 bg-purple-100'
    if (KYC_ACTIONS.includes(action)) return 'text-blue-700 bg-blue-50'
    if (['BAN_USER','USER_DELETED','FORCE_LOGOUT'].includes(action)) return 'text-red-700 bg-red-50'
    if (['SUSPEND_USER'].includes(action)) return 'text-amber-700 bg-amber-50'
    if (['UNSUSPEND_USER','UNBAN_USER'].includes(action)) return 'text-emerald-700 bg-emerald-50'
    if (['ROLE_CHANGED'].includes(action)) return 'text-purple-700 bg-purple-50'
    if (action?.includes('GROUP')) return 'text-teal-700 bg-teal-50'
    return 'text-gray-700 bg-gray-50'
  }

  const renderAuditDetails = (log: any) => {
    const meta = log.metadata || {}
    const isKyc = KYC_ACTIONS.includes(log.action)

    if (isKyc) {
      return (
        <div className="space-y-1">
          {log.targetUser && (
            <p className="text-[12px] font-semibold text-gray-800">
              Target: @{log.targetUser.username} — {log.targetUser.firstName} {log.targetUser.lastName}
            </p>
          )}
          {log.action === 'KYC_IDENTITY_REVEALED' && (
            <p className="text-[11px] text-purple-600 font-semibold">🔐 NIN/BVN revealed by @{log.user?.username || '—'}{log.user?.email ? ` · ${log.user.email}` : ''}</p>
          )}
          {log.action === 'KYC_MANUALLY_APPROVED' && (
            <p className="text-[11px] text-emerald-600 font-semibold">✅ Manually approved by @{meta.approvedBy || log.user?.username || '—'}{meta.approvedByEmail ? ` · ${meta.approvedByEmail}` : ''}</p>
          )}
          {log.action === 'KYC_MANUALLY_REJECTED' && (
            <div>
              <p className="text-[11px] text-red-500 font-semibold">❌ Rejected by @{meta.rejectedBy || log.user?.username || '—'}{meta.rejectedByEmail ? ` · ${meta.rejectedByEmail}` : ''}</p>
              {meta.reason && <p className="text-[11px] text-red-400 mt-0.5">Reason: {meta.reason}</p>}
            </div>
          )}
          {log.action === 'KYC_FACE_SUBMITTED' && <p className="text-[11px] text-blue-600">📸 User submitted KYC face scan</p>}
          {log.action === 'KYC_COMPLETED' && <p className="text-[11px] text-emerald-600">Auto-verified — NIN + BVN matched</p>}
          {log.action === 'KYC_MANUAL_REVIEW' && <p className="text-[11px] text-amber-600">Sent to manual review — name/DOB mismatch</p>}
          {log.action === 'KYC_DUPLICATE_NIN_ATTEMPT' && <p className="text-[11px] text-red-500">Duplicate NIN detected</p>}
          {log.action === 'KYC_DUPLICATE_BVN_ATTEMPT' && <p className="text-[11px] text-red-500">Duplicate BVN detected</p>}
          {meta.facePhotoUrl && (
            <div className="flex items-center gap-2 mt-1">
              <img src={meta.facePhotoUrl} className="w-10 h-10 rounded-lg object-cover border-2 border-purple-300" alt="Admin face"/>
              <span className="text-[10px] text-purple-600 font-semibold">📸 Face on record</span>
            </div>
          )}
        </div>
      )
    }

    if (log.action === 'ROLE_CHANGED' && meta.previousRole) {
      return <p className="text-[11px] text-mist">{meta.previousRole} → {meta.newRole}</p>
    }
    if (meta.reason) {
      return <p className="text-[11px] text-mist">Reason: {meta.reason}</p>
    }
    if (Object.keys(meta).length > 0) {
      return <p className="text-[10px] text-mist font-mono truncate max-w-[220px]">{JSON.stringify(meta)}</p>
    }
    return <p className="text-[11px] text-mist">{log.entityType}{log.entityId ? ` · ${log.entityId.slice(0,8)}…` : ''}</p>
  }

  return (
    <DashboardLayout title="Super Admin" subtitle="Platform oversight · Roles · Settings · Full audit trail">
      <div className="p-4 sm:p-6 max-w-7xl space-y-5 overflow-x-hidden">

        <div className={`${TAB_BAR} w-full sm:w-fit`}>
          {TABS.map(t => (
            <button key={t.id} onClick={() => setTab(t.id)} className={TAB_BTN(tab === t.id)}>
              {t.label}
            </button>
          ))}
        </div>

        {/* ── Overview ── */}
        {tab === 'overview' && (
          <>
            {dashLoading ? (
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3 sm:gap-4">{[...Array(6)].map((_,i) => <Skeleton key={i} className="h-24 rounded-2xl"/>)}</div>
            ) : (
              <>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3 sm:gap-4">
                  {[
                    { label: 'Total users',     val: overview.users?.total || 0,           sub: `${overview.users?.newToday||0} today` },
                    { label: 'Active groups',   val: overview.groups?.active || 0,          sub: `of ${overview.groups?.total||0} total` },
                    { label: 'Platform volume', val: `₦${((overview.finance?.totalVolume||0)/1000).toFixed(0)}K`, sub: 'all time' },
                    { label: 'Fraud flags',     val: overview.alerts?.fraudFlags || 0,      sub: 'Unresolved', accent: (overview.alerts?.fraudFlags||0)>0 },
                    { label: 'Suspended users', val: overview.users?.suspended || 0,        sub: 'Accounts' },
                    { label: 'Pending payouts', val: overview.finance?.pendingPayouts || 0, sub: 'Awaiting' },
                  ].map(m => (
                    <motion.div key={m.label} className={`rounded-2xl border p-4 sm:p-5 ${(m as any).accent ? 'bg-red-50 border-red-100' : 'bg-white border-black/[0.06]'}`} initial={{opacity:0,y:12}} animate={{opacity:1,y:0}}>
                      <p className="text-[10px] font-semibold text-mist uppercase tracking-wider mb-2">{m.label}</p>
                      <p className={`text-[20px] sm:text-[24px] font-extrabold tracking-tight ${(m as any).accent ? 'text-red-600' : 'text-ink'}`}>{m.val}</p>
                      <p className="text-[11px] text-mist mt-1">{m.sub}</p>
                    </motion.div>
                  ))}
                </div>

                <div className="grid md:grid-cols-2 gap-5">
                  <div className="bg-white rounded-2xl border border-black/[0.06] p-5">
                    <p className="text-[14px] font-bold text-ink mb-4">Role breakdown</p>
                    {[
                      { role: 'SUPER_ADMIN',     label: 'Super Admins', color: 'bg-emerald-500' },
                      { role: 'ADMIN',            label: 'Admins',       color: 'bg-blue-500'    },
                      { role: 'CUSTOMER_SERVICE', label: 'CS Agents',    color: 'bg-amber-500'   },
                      { role: 'USER',             label: 'Regular users',color: 'bg-sand'        },
                    ].map(r => (
                      <div key={r.role} className="flex items-center justify-between gap-2 py-2.5 border-b border-black/[0.04] last:border-0">
                        <div className="flex items-center gap-2.5 min-w-0">
                          <span className={`w-2.5 h-2.5 rounded-full flex-shrink-0 ${r.color}`}/>
                          <p className="text-[13px] font-medium text-ink truncate">{r.label}</p>
                        </div>
                        <Button size="sm" variant="secondary" onClick={() => { setRoleFilter(r.role); setTab('users') }}>View →</Button>
                      </div>
                    ))}
                  </div>
                  <div className="bg-white rounded-2xl border border-black/[0.06] p-5">
                    <p className="text-[14px] font-bold text-ink mb-4">Quick actions</p>
                    <div className="space-y-2.5">
                      <Button variant="secondary" className="w-full justify-start" onClick={() => setTab('cs-oversight')}>🎧 CS Oversight</Button>
                      <Button variant="secondary" className="w-full justify-start" onClick={() => setTab('revenue')}>💰 Company revenue</Button>
                      <Button variant="secondary" className="w-full justify-start" onClick={() => setTab('settings')}>⚙️ Platform settings</Button>
                      <Button variant="secondary" className="w-full justify-start" onClick={() => setTab('users')}>👥 Manage roles</Button>
                      <Button variant="secondary" className="w-full justify-start" onClick={() => setTab('audit')}>📋 Full audit trail</Button>
                    </div>
                  </div>
                </div>

                <div className="bg-white rounded-2xl border border-black/[0.06] p-4 sm:p-5">
                  <div className="flex items-center justify-between mb-4 gap-2">
                    <p className="text-[14px] font-bold text-ink">Complaints & Reports</p>
                    <Button size="sm" variant="secondary" onClick={() => setTab('cs-oversight')}>View all →</Button>
                  </div>
                  {reportStats && (
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 sm:gap-4 mb-5">
                      {[
                        { label: 'Total',     val: reportStats.total,     color: 'text-ink'          },
                        { label: 'Open',      val: reportStats.open,      color: 'text-amber-600'    },
                        { label: 'Escalated', val: reportStats.escalated, color: 'text-red-600'      },
                        { label: 'Resolved',  val: reportStats.resolved,  color: 'text-emerald-600'  },
                      ].map(s => (
                        <div key={s.label} className="bg-warm rounded-xl p-4">
                          <p className="text-[10px] font-semibold text-mist uppercase tracking-wider mb-1">{s.label}</p>
                          <p className={`text-[20px] sm:text-[22px] font-extrabold ${s.color}`}>{s.val}</p>
                        </div>
                      ))}
                    </div>
                  )}
                  <p className="text-[11px] font-semibold text-mist uppercase tracking-wider mb-3">Most recent</p>
                  {recentReports.length === 0 ? (
                    <p className="text-[13px] text-mist text-center py-6">No reports filed yet</p>
                  ) : recentReports.map((r: any) => (
                    <div key={r.id} className="flex items-start gap-3 py-3 border-b border-black/[0.04] last:border-0">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <p className="text-[13px] font-semibold text-ink">{r.type}</p>
                          <Badge variant={dsv(r.status)}>{r.status?.replace('_',' ').toLowerCase()}</Badge>
                          {r.groupId && <Badge variant="neutral">Group</Badge>}
                          {r.reportedUserId && <Badge variant="neutral">Member</Badge>}
                        </div>
                        <p className="text-[12px] text-dim mt-0.5 truncate">{r.description}</p>
                        <p className="text-[10px] text-mist mt-1 font-mono truncate">By @{r.reporter?.username || '—'} · {dayjs(r.createdAt).format('MMM D, YYYY h:mm A')}{r.reportedUser ? ` · Against @${r.reportedUser.username}` : ''}</p>
                      </div>
                    </div>
                  ))}
                </div>
              </>
            )}
          </>
        )}

        {/* ── CS Oversight ── */}
        {tab === 'cs-oversight' && (
          <div className="space-y-4">
            <div className="bg-amber-50 border border-amber-100 rounded-2xl p-4">
              <p className="text-[13px] font-semibold text-amber-800">Super Admin read-only oversight</p>
              <p className="text-[12px] text-amber-700 mt-0.5">You can see every ticket, every report, every CS reply, and every internal note. This is monitoring only — use Admin panel for enforcement actions.</p>
            </div>
            <div className={`${TAB_BAR} w-full sm:w-fit`}>
              {([
                { id: 'tickets', label: 'Support Tickets' },
                { id: 'reports', label: 'Reports & Complaints' },
                { id: 'agents',  label: 'CS Agents' },
              ] as { id: 'tickets' | 'reports' | 'agents'; label: string }[]).map(t => (
                <button key={t.id} onClick={() => setCsSubTab(t.id)} className={TAB_BTN(csSubTab === t.id)}>
                  {t.label}
                </button>
              ))}
            </div>

            {csSubTab === 'tickets' && (
              <div className="space-y-4">
                <select value={csTicketFilter} onChange={e => { setCsTicketFilter(e.target.value); setCsTicketPage(1) }} className="h-10 border border-black/[0.09] rounded-xl px-3 text-[12px] text-ink bg-white outline-none cursor-pointer w-full sm:w-auto">
                  <option value="">All tickets</option><option value="OPEN">Open</option><option value="IN_PROGRESS">In progress</option><option value="RESOLVED">Resolved</option><option value="CLOSED">Closed</option>
                </select>
                <div className="bg-white rounded-2xl border border-black/[0.06] overflow-hidden">
                  {csTicketsLoading ? <div className="p-5 space-y-3">{[...Array(4)].map((_,i) => <Skeleton key={i} className="h-14 rounded-xl"/>)}</div>
                  : csTickets.length === 0 ? <EmptyState icon="💬" title="No tickets found"/>
                  : (
                    <>
                      {/* Mobile card list */}
                      <div className="md:hidden divide-y divide-black/[0.04]">
                        {csTickets.map((t: any) => (
                          <button key={t.id} onClick={() => openCsTicket(t)} className="w-full text-left p-4 active:bg-warm/60">
                            <div className="flex items-start justify-between gap-2 mb-1.5">
                              <p className="text-[13px] font-semibold text-ink truncate">{t.subject}</p>
                              <Badge variant={pv(t.priority)}>{t.priority?.toLowerCase()}</Badge>
                            </div>
                            <p className="text-[11px] text-dim">@{t.user?.username || '—'} <span className="text-mist font-mono">· {t.user?.email}</span></p>
                            <div className="flex items-center gap-2 flex-wrap mt-2">
                              <Badge variant={tsv(t.status)}>{t.status?.replace('_',' ').toLowerCase()}</Badge>
                              {t.assignedToId ? <span className="text-[10px] text-dim">@{t.assignedTo?.username || t.assignedToId.slice(0,8)}</span> : <span className="text-[10px] text-mist">Unassigned</span>}
                              {t.escalatedAt && <span className="text-[10px] text-orange-500 font-semibold">⬆ escalated</span>}
                            </div>
                            <p className="text-[10px] text-mist mt-1.5 font-mono">{dayjs(t.createdAt).format('MMM D, h:mm A')}</p>
                          </button>
                        ))}
                      </div>
                      {/* Desktop table */}
                      <div className="hidden md:block overflow-x-auto">
                      <table className="w-full">
                        <thead className="bg-warm border-b border-black/[0.05]">
                          <tr>{['User','Subject','Priority','Status','Assigned To','Escalated','Created',''].map(h => <th key={h} className="px-4 py-3 text-left text-[10px] font-bold text-mist uppercase tracking-wider">{h}</th>)}</tr>
                        </thead>
                        <tbody>
                          {csTickets.map((t: any) => (
                            <tr key={t.id} className="border-b border-black/[0.04] last:border-0 hover:bg-warm/50 transition-colors">
                              <td className="px-4 py-3 text-[11px] text-dim"><p className="font-semibold text-ink">@{t.user?.username || '—'}</p><p className="font-mono text-[10px]">{t.user?.email}</p></td>
                              <td className="px-4 py-3 text-[12px] text-ink max-w-[180px] truncate">{t.subject}</td>
                              <td className="px-4 py-3"><Badge variant={pv(t.priority)}>{t.priority?.toLowerCase()}</Badge></td>
                              <td className="px-4 py-3"><Badge variant={tsv(t.status)}>{t.status?.replace('_',' ').toLowerCase()}</Badge></td>
                              <td className="px-4 py-3 text-[11px] text-dim">{t.assignedToId ? `@${t.assignedTo?.username || t.assignedToId.slice(0,8)}` : <span className="text-mist">Unassigned</span>}</td>
                              <td className="px-4 py-3 text-[11px]">{t.escalatedAt ? <span className="text-orange-500 font-semibold">⬆ {dayjs(t.escalatedAt).format('MMM D')}</span> : <span className="text-mist">—</span>}</td>
                              <td className="px-4 py-3 text-[10px] text-mist font-mono">{dayjs(t.createdAt).format('MMM D, h:mm A')}</td>
                              <td className="px-4 py-3"><Button size="sm" variant="secondary" onClick={() => openCsTicket(t)}>View</Button></td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                      </div>
                    </>
                  )}
                  {csTicketPag && csTicketPag.totalPages > 1 && (
                    <div className="flex items-center justify-between px-4 py-3 border-t border-black/[0.05]">
                      <p className="text-[11px] sm:text-[12px] text-mist">Page {csTicketPag.page} of {csTicketPag.totalPages} · {csTicketPag.total} tickets</p>
                      <div className="flex gap-2"><Button size="sm" variant="secondary" disabled={csTicketPage===1} onClick={() => setCsTicketPage(p => p-1)}>Prev</Button><Button size="sm" variant="secondary" disabled={csTicketPage>=csTicketPag.totalPages} onClick={() => setCsTicketPage(p => p+1)}>Next</Button></div>
                    </div>
                  )}
                </div>
              </div>
            )}

            {csSubTab === 'reports' && (
              <div className="space-y-4">
                <select value={csReportFilter} onChange={e => { setCsReportFilter(e.target.value); setCsReportPage(1) }} className="h-10 border border-black/[0.09] rounded-xl px-3 text-[12px] text-ink bg-white outline-none cursor-pointer w-full sm:w-auto">
                  <option value="">All reports</option><option value="OPEN">Open</option><option value="UNDER_REVIEW">Under review</option><option value="ESCALATED">Escalated</option><option value="RESOLVED">Resolved</option><option value="DISMISSED">Dismissed</option>
                </select>
                <div className="bg-white rounded-2xl border border-black/[0.06] overflow-hidden">
                  {csReportsLoading ? <div className="p-5 space-y-3">{[...Array(4)].map((_,i) => <Skeleton key={i} className="h-14 rounded-xl"/>)}</div>
                  : csReports.length === 0 ? <EmptyState icon="🚩" title="No reports found"/>
                  : (
                    <>
                      {/* Mobile card list */}
                      <div className="md:hidden divide-y divide-black/[0.04]">
                        {csReports.map((r: any) => (
                          <button key={r.id} onClick={() => openCsReport(r)} className="w-full text-left p-4 active:bg-warm/60">
                            <div className="flex items-start justify-between gap-2 mb-1.5">
                              <p className="text-[13px] font-semibold text-ink">{r.type}</p>
                              <Badge variant={dsv(r.status)}>{r.status?.replace('_',' ').toLowerCase()}</Badge>
                            </div>
                            <p className="text-[11px] text-dim">@{r.reporter?.username || '—'} → {r.reportedUser ? `@${r.reportedUser.username}` : r.groupId ? 'Group' : '—'}</p>
                            <p className="text-[10px] text-mist mt-1.5 font-mono">{dayjs(r.createdAt).format('MMM D, h:mm A')}</p>
                          </button>
                        ))}
                      </div>
                      {/* Desktop table */}
                      <div className="hidden md:block overflow-x-auto">
                      <table className="w-full">
                        <thead className="bg-warm border-b border-black/[0.05]">
                          <tr>{['Reporter','Against','Type','Status','Assigned To','Resolved By','Filed',''].map(h => <th key={h} className="px-4 py-3 text-left text-[10px] font-bold text-mist uppercase tracking-wider">{h}</th>)}</tr>
                        </thead>
                        <tbody>
                          {csReports.map((r: any) => (
                            <tr key={r.id} className="border-b border-black/[0.04] last:border-0 hover:bg-warm/50 transition-colors">
                              <td className="px-4 py-3 text-[11px] text-dim">@{r.reporter?.username || '—'}</td>
                              <td className="px-4 py-3 text-[11px] text-dim">{r.reportedUser ? `@${r.reportedUser.username}` : r.groupId ? 'Group' : '—'}</td>
                              <td className="px-4 py-3 text-[12px] text-ink">{r.type}</td>
                              <td className="px-4 py-3"><Badge variant={dsv(r.status)}>{r.status?.replace('_',' ').toLowerCase()}</Badge></td>
                              <td className="px-4 py-3 text-[11px] text-dim">{r.assignedToId ? `@${r.assignedTo?.username || r.assignedToId.slice(0,8)}` : <span className="text-mist">—</span>}</td>
                              <td className="px-4 py-3 text-[11px] text-dim">{r.resolvedById ? `@${r.resolvedBy?.username || r.resolvedById.slice(0,8)}` : <span className="text-mist">—</span>}</td>
                              <td className="px-4 py-3 text-[10px] text-mist font-mono">{dayjs(r.createdAt).format('MMM D, h:mm A')}</td>
                              <td className="px-4 py-3"><Button size="sm" variant="secondary" onClick={() => openCsReport(r)}>View</Button></td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                      </div>
                    </>
                  )}
                  {csReportPag && csReportPag.totalPages > 1 && (
                    <div className="flex items-center justify-between px-4 py-3 border-t border-black/[0.05]">
                      <p className="text-[11px] sm:text-[12px] text-mist">Page {csReportPag.page} of {csReportPag.totalPages} · {csReportPag.total} reports</p>
                      <div className="flex gap-2"><Button size="sm" variant="secondary" disabled={csReportPage===1} onClick={() => setCsReportPage(p => p-1)}>Prev</Button><Button size="sm" variant="secondary" disabled={csReportPage>=csReportPag.totalPages} onClick={() => setCsReportPage(p => p+1)}>Next</Button></div>
                    </div>
                  )}
                </div>
              </div>
            )}

            {csSubTab === 'agents' && (
              <div className="space-y-4">
                <p className="text-[12px] text-mist">All active Customer Service agents. Use Users & Roles tab to promote or demote.</p>
                {csAgents.length === 0 ? (
                  <div className="bg-white rounded-2xl border border-black/[0.06] p-8 text-center">
                    <p className="text-[14px] font-semibold text-ink mb-1">No CS agents yet</p>
                    <p className="text-[13px] text-dim mb-4">Promote a user to Customer Service role to get started.</p>
                    <Button onClick={() => { setRoleFilter('CUSTOMER_SERVICE'); setTab('users') }}>Manage roles →</Button>
                  </div>
                ) : (
                  <div className="grid sm:grid-cols-2 gap-4">
                    {csAgents.map((a: any) => (
                      <div key={a.id} className="bg-white rounded-2xl border border-black/[0.06] p-5">
                        <div className="flex items-center gap-3 mb-4">
                          <div className="w-10 h-10 rounded-full bg-amber-100 flex items-center justify-center text-amber-700 text-[13px] font-bold flex-shrink-0">{a.firstName?.[0]}{a.lastName?.[0]}</div>
                          <div className="flex-1 min-w-0">
                            <p className="text-[13px] font-semibold text-ink truncate">{a.firstName} {a.lastName}</p>
                            <p className="text-[11px] text-mist font-mono truncate">@{a.username}</p>
                            <p className="text-[11px] text-mist truncate">{a.email}</p>
                          </div>
                          <Badge variant={sv(a.status)}>{a.status?.toLowerCase()}</Badge>
                        </div>
                        <div className="grid grid-cols-2 gap-3 text-center">
                          <div className="bg-warm rounded-xl p-3"><p className="text-[10px] text-mist uppercase tracking-wider mb-1">Reputation</p><p className="text-[16px] font-bold text-ink">{a.reputationScore || 100}</p></div>
                          <div className="bg-warm rounded-xl p-3"><p className="text-[10px] text-mist uppercase tracking-wider mb-1">Joined</p><p className="text-[12px] font-semibold text-ink">{dayjs(a.createdAt).format('MMM D, YYYY')}</p></div>
                        </div>
                        <div className="mt-3 flex gap-2 flex-wrap">
                          <Button size="sm" variant="secondary" className="flex-1" onClick={() => { setCsTicketFilter(''); setCsSubTab('tickets') }}>View their tickets</Button>
                          <Button size="sm" variant="secondary" onClick={() => { setRoleFilter('CUSTOMER_SERVICE'); setTab('users') }}>Manage role</Button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {/* ── Users & Roles ── */}
        {tab === 'users' && (
          <div className="space-y-4">
            <div className="bg-brand-pale border border-brand/10 rounded-xl px-4 py-3">
              <p className="text-[12px] font-semibold text-brand">Super Admin exclusive: Role assignment</p>
              <p className="text-[12px] text-dim mt-0.5">You are the only role that can promote or demote users to Admin, Customer Service, or Super Admin.</p>
            </div>
            <div className="flex gap-3 flex-wrap">
              <input value={search} onChange={e => { setSearch(e.target.value); setUsersPage(1) }} placeholder="Search users…" className="h-10 border border-black/[0.09] rounded-xl px-4 text-[13px] text-ink bg-white outline-none focus:border-brand w-full sm:w-64"/>
              <select value={roleFilter} onChange={e => { setRoleFilter(e.target.value); setUsersPage(1) }} className="h-10 border border-black/[0.09] rounded-xl px-3 text-[12px] text-ink bg-white outline-none focus:border-brand cursor-pointer w-full sm:w-auto">
                <option value="">All roles</option><option value="SUPER_ADMIN">Super Admin</option><option value="ADMIN">Admin</option><option value="CUSTOMER_SERVICE">Customer Service</option><option value="USER">User</option>
              </select>
            </div>
            <div className="bg-white rounded-2xl border border-black/[0.06] overflow-hidden">
              {usersLoading ? <div className="p-5 space-y-3">{[...Array(5)].map((_,i) => <Skeleton key={i} className="h-14 rounded-xl"/>)}</div>
              : users.length === 0 ? <EmptyState icon="👤" title="No users found"/> : (
                <>
                  {/* Mobile card list */}
                  <div className="md:hidden divide-y divide-black/[0.04]">
                    {users.map((u: any) => (
                      <div key={u.id} className="p-4">
                        <div className="flex items-start justify-between gap-2 mb-1">
                          <div className="min-w-0">
                            <p className="text-[13px] font-semibold text-ink truncate">{u.firstName} {u.lastName}</p>
                            <p className="text-[10px] text-mist font-mono truncate">@{u.username} · {u.email}</p>
                          </div>
                          <Badge variant={sv(u.status)}>{u.status?.toLowerCase()}</Badge>
                        </div>
                        <div className="flex items-center gap-2 flex-wrap mt-2">
                          <Badge variant={rv(u.role)}>{u.role?.replace('_',' ').toLowerCase()}</Badge>
                          <span className="text-[10px] text-mist font-mono">Joined {dayjs(u.createdAt).format('MMM D, YYYY')}</span>
                        </div>
                        {u.id !== currentUser?.id && (
                          <div className="flex gap-1.5 flex-wrap items-center mt-3">
                            <select value={u.role} disabled={roleLoading===u.id} onChange={e => handleRoleChange(u, e.target.value)}
                              className="h-8 border border-black/[0.08] rounded-lg px-2 text-[11px] text-ink bg-white outline-none focus:border-brand cursor-pointer disabled:opacity-50 flex-1 min-w-[120px]">
                              <option value="USER">User</option><option value="CUSTOMER_SERVICE">Customer Service</option><option value="ADMIN">Admin</option><option value="SUPER_ADMIN">Super Admin</option>
                            </select>
                            {u.status !== 'BANNED' && <Button size="sm" variant="danger" onClick={() => setBanModal(u)}>Perm Ban</Button>}
                            {u.status === 'BANNED' && <Button size="sm" variant="secondary" onClick={() => superAdminApi.unbanUser(u.id).then(() => { showToast('Unbanned','success'); loadUsers() }).catch((e: any) => showToast(e?.response?.data?.message || 'Failed','error'))}>Unban</Button>}
                            <Button size="sm" variant="danger" onClick={() => setDeleteModal(u)}>Delete</Button>
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                  {/* Desktop table */}
                  <div className="hidden md:block overflow-x-auto">
                  <table className="w-full">
                    <thead className="bg-warm border-b border-black/[0.05]">
                      <tr>{['User','Email','Role','Status','Joined','Actions'].map(h => <th key={h} className="px-4 py-3 text-left text-[10px] font-bold text-mist uppercase tracking-wider">{h}</th>)}</tr>
                    </thead>
                    <tbody>
                      {users.map((u: any) => (
                        <tr key={u.id} className="border-b border-black/[0.04] last:border-0 hover:bg-warm/50">
                          <td className="px-4 py-3.5"><p className="text-[12px] font-semibold text-ink">{u.firstName} {u.lastName}</p><p className="text-[10px] text-mist font-mono">@{u.username}</p></td>
                          <td className="px-4 py-3.5 text-[11px] text-dim font-mono">{u.email}</td>
                          <td className="px-4 py-3.5"><Badge variant={rv(u.role)}>{u.role?.replace('_',' ').toLowerCase()}</Badge></td>
                          <td className="px-4 py-3.5"><Badge variant={sv(u.status)}>{u.status?.toLowerCase()}</Badge></td>
                          <td className="px-4 py-3.5 text-[10px] text-mist font-mono">{dayjs(u.createdAt).format('MMM D, YYYY')}</td>
                          <td className="px-4 py-3.5">
                            <div className="flex gap-1.5 flex-wrap items-center">
                              {u.id !== currentUser?.id && (
                                <select value={u.role} disabled={roleLoading===u.id} onChange={e => handleRoleChange(u, e.target.value)}
                                  className="h-7 border border-black/[0.08] rounded-lg px-2 text-[11px] text-ink bg-white outline-none focus:border-brand cursor-pointer disabled:opacity-50">
                                  <option value="USER">User</option><option value="CUSTOMER_SERVICE">Customer Service</option><option value="ADMIN">Admin</option><option value="SUPER_ADMIN">Super Admin</option>
                                </select>
                              )}
                              {u.id !== currentUser?.id && u.status !== 'BANNED' && <Button size="sm" variant="danger" onClick={() => setBanModal(u)}>Perm Ban</Button>}
                              {u.id !== currentUser?.id && u.status === 'BANNED' && <Button size="sm" variant="secondary" onClick={() => superAdminApi.unbanUser(u.id).then(() => { showToast('Unbanned','success'); loadUsers() }).catch((e: any) => showToast(e?.response?.data?.message || 'Failed','error'))}>Unban</Button>}
                              {u.id !== currentUser?.id && <Button size="sm" variant="danger" onClick={() => setDeleteModal(u)}>Delete</Button>}
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  </div>
                </>
              )}
              {usersPag && usersPag.totalPages > 1 && (
                <div className="flex items-center justify-between px-4 py-3 border-t border-black/[0.05]">
                  <p className="text-[11px] sm:text-[12px] text-mist">Page {usersPag.page} of {usersPag.totalPages} · {usersPag.total} users</p>
                  <div className="flex gap-2"><Button size="sm" variant="secondary" disabled={usersPage===1} onClick={() => setUsersPage(p => p-1)}>Prev</Button><Button size="sm" variant="secondary" disabled={usersPage>=usersPag.totalPages} onClick={() => setUsersPage(p => p+1)}>Next</Button></div>
                </div>
              )}
            </div>
          </div>
        )}

        {/* ── Company Revenue ── */}
        {tab === 'revenue' && (
          <div className="space-y-4">
            <div className="bg-emerald-50 border border-emerald-100 rounded-2xl p-4">
              <p className="text-[13px] font-semibold text-emerald-800">💰 Company revenue account</p>
              <p className="text-[12px] text-emerald-700 mt-0.5">Late penalty fees collected from members, and the 1% platform fee taken on withdrawals, both flow into this account automatically. This balance is what's available to withdraw as company earnings.</p>
            </div>

            {revenueLoading ? (
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">{[...Array(3)].map((_,i) => <Skeleton key={i} className="h-28 rounded-2xl"/>)}</div>
            ) : !revenue ? (
              <EmptyState icon="💰" title="No revenue data yet"/>
            ) : (
              <>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  <motion.div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-5" initial={{opacity:0,y:12}} animate={{opacity:1,y:0}}>
                    <p className="text-[10px] font-semibold text-emerald-700 uppercase tracking-wider mb-2">Total available balance</p>
                    <p className="text-[24px] sm:text-[28px] font-extrabold text-emerald-700 tracking-tight">₦{revenue.walletBalance.toLocaleString()}</p>
                    <p className="text-[11px] text-emerald-600 mt-1">Company revenue wallet</p>
                  </motion.div>
                  <motion.div className="rounded-2xl border border-black/[0.06] bg-white p-5" initial={{opacity:0,y:12}} animate={{opacity:1,y:0}}>
                    <p className="text-[10px] font-semibold text-mist uppercase tracking-wider mb-2">From late penalty fees</p>
                    <p className="text-[20px] sm:text-[24px] font-extrabold text-ink tracking-tight">₦{revenue.totalFromPenalties.toLocaleString()}</p>
                    <p className="text-[11px] text-mist mt-1">{revenue.penaltyCount} penalt{revenue.penaltyCount === 1 ? 'y' : 'ies'} collected</p>
                  </motion.div>
                  <motion.div className="rounded-2xl border border-black/[0.06] bg-white p-5" initial={{opacity:0,y:12}} animate={{opacity:1,y:0}}>
                    <p className="text-[10px] font-semibold text-mist uppercase tracking-wider mb-2">From platform fees (1%)</p>
                    <p className="text-[20px] sm:text-[24px] font-extrabold text-ink tracking-tight">₦{revenue.totalFromPlatformFees.toLocaleString()}</p>
                    <p className="text-[11px] text-mist mt-1">{revenue.platformFeeCount} withdrawal{revenue.platformFeeCount === 1 ? '' : 's'} charged</p>
                  </motion.div>
                </div>

                <div className={`${TAB_BAR} w-full sm:w-fit`}>
                  {([
                    { id: 'penalties',     label: 'Recent penalty fees' },
                    { id: 'platform-fees', label: 'Recent platform fees' },
                  ] as { id: 'penalties' | 'platform-fees'; label: string }[]).map(t => (
                    <button key={t.id} onClick={() => setRevenueSubTab(t.id)} className={TAB_BTN(revenueSubTab === t.id)}>
                      {t.label}
                    </button>
                  ))}
                </div>

                <div className="bg-white rounded-2xl border border-black/[0.06] overflow-hidden">
                  {revenueSubTab === 'penalties' ? (
                    revenue.recentPenalties.length === 0 ? <EmptyState icon="🕒" title="No penalty fees collected yet"/> : (
                      <>
                        <div className="md:hidden divide-y divide-black/[0.04]">
                          {revenue.recentPenalties.map((t: any) => (
                            <div key={t.id} className="p-4">
                              <div className="flex items-center justify-between gap-2">
                                <p className="text-[14px] font-bold text-ink">₦{t.amount.toLocaleString()}</p>
                                <Badge variant={t.status === 'COMPLETED' ? 'success' : 'warning'}>{t.status?.toLowerCase()}</Badge>
                              </div>
                              <p className="text-[10px] text-mist font-mono mt-1">{dayjs(t.createdAt).format('MMM D, h:mm A')}</p>
                              <p className="text-[11px] text-dim font-mono mt-1">From {t.metadata?.fromUserId || '—'}{t.metadata?.groupId ? ` · Group ${t.metadata.groupId.slice(0,8)}…` : ''}</p>
                            </div>
                          ))}
                        </div>
                        <div className="hidden md:block overflow-x-auto">
                        <table className="w-full">
                          <thead className="bg-warm border-b border-black/[0.05]">
                            <tr>{['When','Amount','From user','Group / Contribution',''].map(h => <th key={h} className="px-4 py-3 text-left text-[10px] font-bold text-mist uppercase tracking-wider">{h}</th>)}</tr>
                          </thead>
                          <tbody>
                            {revenue.recentPenalties.map((t: any) => (
                              <tr key={t.id} className="border-b border-black/[0.04] last:border-0">
                                <td className="px-4 py-3 text-[10px] text-mist font-mono whitespace-nowrap">{dayjs(t.createdAt).format('MMM D, h:mm A')}</td>
                                <td className="px-4 py-3 text-[13px] font-bold text-ink">₦{t.amount.toLocaleString()}</td>
                                <td className="px-4 py-3 text-[11px] text-dim font-mono">{t.metadata?.fromUserId || '—'}</td>
                                <td className="px-4 py-3 text-[11px] text-dim font-mono">{t.metadata?.groupId ? `${t.metadata.groupId.slice(0,8)}…` : '—'}</td>
                                <td className="px-4 py-3"><Badge variant={t.status === 'COMPLETED' ? 'success' : 'warning'}>{t.status?.toLowerCase()}</Badge></td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                        </div>
                      </>
                    )
                  ) : (
                    revenue.recentPlatformFees.length === 0 ? <EmptyState icon="🕒" title="No platform fees collected yet"/> : (
                      <>
                        <div className="md:hidden divide-y divide-black/[0.04]">
                          {revenue.recentPlatformFees.map((t: any) => (
                            <div key={t.id} className="p-4">
                              <div className="flex items-center justify-between gap-2">
                                <p className="text-[14px] font-bold text-ink">₦{t.amount.toLocaleString()}</p>
                                <Badge variant="success">{t.status?.toLowerCase()}</Badge>
                              </div>
                              <p className="text-[10px] text-mist font-mono mt-1">{dayjs(t.createdAt).format('MMM D, h:mm A')}</p>
                              <p className="text-[11px] text-dim font-mono mt-1 truncate">From {t.metadata?.fromUserId || '—'} · Ref {t.reference}</p>
                            </div>
                          ))}
                        </div>
                        <div className="hidden md:block overflow-x-auto">
                        <table className="w-full">
                          <thead className="bg-warm border-b border-black/[0.05]">
                            <tr>{['When','Amount','From user','Reference',''].map(h => <th key={h} className="px-4 py-3 text-left text-[10px] font-bold text-mist uppercase tracking-wider">{h}</th>)}</tr>
                          </thead>
                          <tbody>
                            {revenue.recentPlatformFees.map((t: any) => (
                              <tr key={t.id} className="border-b border-black/[0.04] last:border-0">
                                <td className="px-4 py-3 text-[10px] text-mist font-mono whitespace-nowrap">{dayjs(t.createdAt).format('MMM D, h:mm A')}</td>
                                <td className="px-4 py-3 text-[13px] font-bold text-ink">₦{t.amount.toLocaleString()}</td>
                                <td className="px-4 py-3 text-[11px] text-dim font-mono">{t.metadata?.fromUserId || '—'}</td>
                                <td className="px-4 py-3 text-[11px] text-dim font-mono truncate max-w-[160px]">{t.reference}</td>
                                <td className="px-4 py-3"><Badge variant="success">{t.status?.toLowerCase()}</Badge></td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                        </div>
                      </>
                    )
                  )}
                </div>

                <div className="bg-amber-50 border border-amber-100 rounded-xl p-3.5">
                  <p className="text-[12px] text-amber-700">This is a read-only view for now — it shows exactly how much has accumulated and where it came from. Actually withdrawing this balance to a real bank account would reuse the same withdrawal flow users have, just pointed at this account. Let me know if you want that built next.</p>
                </div>
              </>
            )}
          </div>
        )}

        {/* ── Platform Settings ── */}
        {tab === 'settings' && (
          <div className="max-w-2xl space-y-5">
            {settingsLoading ? <div className="space-y-3">{[...Array(4)].map((_,i) => <Skeleton key={i} className="h-16 rounded-2xl"/>)}</div>
            : settings && (
              <>
                <div className="bg-white rounded-2xl border border-black/[0.06] p-5 sm:p-6 space-y-5">
                  <p className="text-[14px] font-bold text-ink">Automated Report Escalation Thresholds</p>
                  <p className="text-[13px] text-dim">When a user or group reaches these report counts, the system automatically flags or escalates them.</p>
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                    {[
                      { key: 'reportFlagThreshold',         label: 'Flag threshold', desc: 'Reports → flag for review'        },
                      { key: 'reportHighPriorityThreshold', label: 'High priority',  desc: 'Reports → high priority'          },
                      { key: 'reportAutoEscalateThreshold', label: 'Auto-escalate',  desc: 'Reports → auto-escalate to Admin' },
                    ].map(f => (
                      <div key={f.key}>
                        <label className="block text-[12px] font-medium text-dim mb-1.5">{f.label}</label>
                        <input type="number" value={settings[f.key]} onChange={e => setSettings({...settings, [f.key]: +e.target.value})} className="h-10 w-full border border-black/[0.08] rounded-xl px-3 text-[13px] text-ink bg-white outline-none focus:border-brand"/>
                        <p className="text-[10px] text-mist mt-1">{f.desc}</p>
                      </div>
                    ))}
                  </div>
                </div>
                <div className="bg-white rounded-2xl border border-black/[0.06] p-5 sm:p-6 space-y-4">
                  <p className="text-[14px] font-bold text-ink">Financial Controls</p>
                  <div>
                    <label className="block text-[12px] font-medium text-dim mb-1.5">Platform fee (%)</label>
                    <input type="number" step="0.1" value={settings.platformFeePercent} onChange={e => setSettings({...settings, platformFeePercent: +e.target.value})} className="h-10 w-32 border border-black/[0.08] rounded-xl px-3 text-[13px] text-ink bg-white outline-none focus:border-brand"/>
                  </div>
                </div>
                <div className="bg-white rounded-2xl border border-black/[0.06] p-5 sm:p-6 space-y-4">
                  <p className="text-[14px] font-bold text-ink">Platform Toggles</p>
                  {[
                    { key: 'withdrawalsFrozen',   label: 'Freeze all withdrawals',   desc: 'Blocks all withdrawal attempts platform-wide' },
                    { key: 'contributionsFrozen', label: 'Freeze all contributions', desc: 'Blocks new contributions to any group'         },
                    { key: 'maintenanceMode',     label: 'Maintenance mode',          desc: 'Shows maintenance banner to all users'         },
                  ].map(toggle => (
                    <div key={toggle.key} className="flex items-center justify-between gap-3 py-2 border-b border-black/[0.04] last:border-0">
                      <div className="min-w-0"><p className="text-[13px] font-semibold text-ink">{toggle.label}</p><p className="text-[11px] text-mist">{toggle.desc}</p></div>
                      <button type="button" onClick={() => setSettings({...settings, [toggle.key]: !settings[toggle.key]})}
                        className={`relative w-11 h-6 rounded-full transition-colors flex-shrink-0 ${settings[toggle.key] ? 'bg-red-500' : 'bg-black/15'}`}>
                        <span className={`absolute top-1 w-4 h-4 bg-white rounded-full shadow-sm transition-all ${settings[toggle.key] ? 'left-6' : 'left-1'}`}/>
                      </button>
                    </div>
                  ))}
                </div>

                {/* ── Schedule Maintenance ── */}
                <div className="bg-white rounded-2xl border border-black/[0.06] p-5 sm:p-6 space-y-4">
                  <div className="flex items-center justify-between flex-wrap gap-2">
                    <p className="text-[14px] font-bold text-ink">Schedule Maintenance</p>
                    {settings.maintenanceScheduledAt && (
                      <Badge variant="warning">Scheduled for {dayjs(settings.maintenanceScheduledAt).format('MMM D, h:mm A')}</Badge>
                    )}
                  </div>
                  <p className="text-[13px] text-dim">
                    Announce an upcoming maintenance window ahead of time. Customers will see a countdown banner across the app, and maintenance mode will switch on automatically at the scheduled time — you don't need to come back and flip the toggle yourself.
                  </p>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div>
                      <label className="block text-[12px] font-medium text-dim mb-1.5">Start time</label>
                      <input
                        type="datetime-local"
                        value={maintenanceScheduleAt}
                        onChange={e => setMaintenanceScheduleAt(e.target.value)}
                        className="h-10 w-full border border-black/[0.08] rounded-xl px-3 text-[13px] text-ink bg-white outline-none focus:border-brand"
                      />
                    </div>
                    <div>
                      <label className="block text-[12px] font-medium text-dim mb-1.5">Announcement message</label>
                      <input
                        type="text"
                        value={maintenanceAnnouncement}
                        onChange={e => setMaintenanceAnnouncement(e.target.value)}
                        placeholder="e.g. Upgrading our payment systems"
                        className="h-10 w-full border border-black/[0.08] rounded-xl px-3 text-[13px] text-ink bg-white outline-none focus:border-brand"
                      />
                    </div>
                  </div>
                  <div className="flex gap-2 flex-wrap">
                    <Button loading={schedulingMaintenance} disabled={!maintenanceScheduleAt} onClick={handleScheduleMaintenance}>
                      Schedule maintenance
                    </Button>
                    {settings.maintenanceScheduledAt && (
                      <Button variant="secondary" loading={cancelingSchedule} onClick={handleCancelSchedule}>
                        Cancel scheduled maintenance
                      </Button>
                    )}
                  </div>
                </div>

                <Button loading={saving} onClick={handleSaveSettings}>Save all settings</Button>
              </>
            )}
          </div>
        )}

        {/* ── Full Audit Log ── */}
        {tab === 'audit' && (
          <div className="space-y-4">
            <div className="space-y-3">
              <p className="text-[12px] text-mist">Full unfiltered platform audit trail — every action by every role.</p>
              <input value={actionFilter} onChange={e => { setActionFilter(e.target.value); setLogsPage(1) }} placeholder="Filter by action (e.g. KYC, BAN, ROLE)…"
                className="h-10 border border-black/[0.09] rounded-xl px-4 text-[13px] text-ink bg-white outline-none focus:border-brand w-full sm:w-72"/>
              <div className="flex gap-1.5 flex-wrap">
                {['KYC', 'REVEALED', 'BAN', 'SUSPEND', 'ROLE', 'GROUP', 'REFUND'].map(q => (
                  <button key={q} onClick={() => { setActionFilter(q); setLogsPage(1) }}
                    className={`h-7 px-2.5 rounded-lg text-[10px] font-semibold border transition-colors ${actionFilter === q ? 'bg-ink text-white border-ink' : 'border-black/[0.09] text-dim hover:text-ink'}`}>
                    {q}
                  </button>
                ))}
                {actionFilter && <button onClick={() => { setActionFilter(''); setLogsPage(1) }} className="h-7 px-2 rounded-lg text-[10px] font-semibold text-mist hover:text-ink transition-colors">Clear ×</button>}
              </div>
            </div>
            <div className="bg-white rounded-2xl border border-black/[0.06] overflow-hidden">
              {logsLoading ? <div className="p-5 space-y-3">{[...Array(6)].map((_,i) => <Skeleton key={i} className="h-12 rounded-xl"/>)}</div>
              : logs.length === 0 ? <EmptyState icon="📋" title="No log entries found"/>
              : (
                <>
                  {/* Mobile card list */}
                  <div className="md:hidden divide-y divide-black/[0.04]">
                    {logs.map((log: any) => {
                      const isKyc = KYC_ACTIONS.includes(log.action)
                      return (
                        <button key={log.id} onClick={() => setLogDetail(log)} className={`w-full text-left p-4 active:bg-warm/60 ${isKyc ? 'bg-blue-50/20' : ''}`}>
                          <div className="flex items-center justify-between gap-2 mb-1.5">
                            <span className={`inline-flex items-center px-2 py-0.5 rounded-md text-[10px] font-bold ${getActionColor(log.action)}`}>
                              {log.action?.replace(/_/g,' ')}
                            </span>
                            <Badge variant={rv(log.user?.role || 'USER')}>{(log.user?.role || 'system').replace('_',' ').toLowerCase()}</Badge>
                          </div>
                          <p className="text-[12px] font-semibold text-ink">{log.user?.username ? `@${log.user.username}` : 'System'}</p>
                          <div className="text-[11px] mt-1">{renderAuditDetails(log)}</div>
                          <p className="text-[10px] text-mist mt-1.5 font-mono">{dayjs(log.createdAt).format('MMM D, h:mm A')}</p>
                        </button>
                      )
                    })}
                  </div>
                  {/* Desktop table */}
                  <div className="hidden md:block overflow-x-auto">
                  <table className="w-full">
                    <thead className="bg-warm border-b border-black/[0.05]">
                      <tr>{['When','Actor','Role','Action','Details',''].map(h => <th key={h} className="px-4 py-3 text-left text-[10px] font-bold text-mist uppercase tracking-wider">{h}</th>)}</tr>
                    </thead>
                    <tbody>
                      {logs.map((log: any) => {
                        const isKyc = KYC_ACTIONS.includes(log.action)
                        const colorCls = getActionColor(log.action)
                        return (
                          <tr key={log.id} className={`border-b border-black/[0.04] last:border-0 hover:bg-warm/50 cursor-pointer ${isKyc ? 'bg-blue-50/20' : ''}`} onClick={() => setLogDetail(log)}>
                            <td className="px-4 py-3.5 text-[10px] text-mist font-mono whitespace-nowrap">{dayjs(log.createdAt).format('MMM D, h:mm A')}</td>
                            <td className="px-4 py-3.5">
                              <p className="text-[12px] font-semibold text-ink">{log.user?.username ? `@${log.user.username}` : 'System'}</p>
                              {log.user?.firstName && <p className="text-[10px] text-mist">{log.user.firstName} {log.user.lastName}</p>}
                            </td>
                            <td className="px-4 py-3.5"><Badge variant={rv(log.user?.role || 'USER')}>{(log.user?.role || 'system').replace('_',' ').toLowerCase()}</Badge></td>
                            <td className="px-4 py-3.5">
                              <span className={`inline-flex items-center px-2 py-0.5 rounded-md text-[10px] font-bold ${colorCls}`}>
                                {log.action?.replace(/_/g,' ')}
                              </span>
                            </td>
                            <td className="px-4 py-3.5 max-w-[280px]">
                              {renderAuditDetails(log)}
                            </td>
                            <td className="px-4 py-3.5">
                              <Button size="sm" variant="secondary" onClick={e => { e.stopPropagation(); setLogDetail(log) }}>Details</Button>
                            </td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                  </div>
                </>
              )}
              {logsPag && logsPag.totalPages > 1 && (
                <div className="flex items-center justify-between px-4 py-3 border-t border-black/[0.05]">
                  <p className="text-[11px] sm:text-[12px] text-mist">Page {logsPag.page} of {logsPag.totalPages}</p>
                  <div className="flex gap-2"><Button size="sm" variant="secondary" disabled={logsPage===1} onClick={() => setLogsPage(p => p-1)}>Prev</Button><Button size="sm" variant="secondary" disabled={logsPage>=logsPag.totalPages} onClick={() => setLogsPage(p => p+1)}>Next</Button></div>
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      {/* ── Audit Log Detail Modal ── */}
      <Modal open={!!logDetail} onClose={() => setLogDetail(null)} title="Audit Log Entry" size="md" footer={<Button variant="secondary" onClick={() => setLogDetail(null)}>Close</Button>}>
        {logDetail && (() => {
          const meta = logDetail.metadata || {}
          const isKyc = KYC_ACTIONS.includes(logDetail.action)
          return (
            <div className="space-y-4">
              <div className="flex items-center gap-2 flex-wrap">
                <span className={`inline-flex items-center px-2.5 py-1 rounded-lg text-[11px] font-bold ${getActionColor(logDetail.action)}`}>
                  {logDetail.action?.replace(/_/g,' ')}
                </span>
                <Badge variant={rv(logDetail.user?.role || 'USER')}>{(logDetail.user?.role || 'system').replace('_',' ').toLowerCase()}</Badge>
                {isKyc && <span className="px-2 py-0.5 bg-blue-100 text-blue-700 text-[10px] font-bold rounded">KYC</span>}
              </div>

              <div className="bg-warm rounded-xl p-4 space-y-2.5">
                {[
                  { label: 'Time',        val: dayjs(logDetail.createdAt).format('MMM D, YYYY h:mm:ss A') },
                  { label: 'Actor',       val: logDetail.user ? `@${logDetail.user.username} (${logDetail.user.firstName} ${logDetail.user.lastName})` : 'System' },
                  { label: 'Entity',      val: `${logDetail.entityType || '—'}${logDetail.entityId ? ` · ${logDetail.entityId}` : ''}` },
                ].map(r => (
                  <div key={r.label} className="flex justify-between gap-4">
                    <span className="text-[11px] text-mist flex-shrink-0">{r.label}</span>
                    <span className="text-[12px] font-medium text-ink text-right break-all">{r.val}</span>
                  </div>
                ))}
              </div>

              {meta.facePhotoUrl && (
                <div className="text-center space-y-2">
                  <img src={meta.facePhotoUrl} className="w-32 h-32 rounded-2xl object-cover border-4 border-purple-200 mx-auto" alt="Admin face capture"/>
                  <p className="text-[11px] text-purple-600 font-semibold">📸 Admin's face at the moment of this action</p>
                </div>
              )}

              {isKyc && (
                <div className="bg-blue-50 border border-blue-100 rounded-xl p-4 space-y-2">
                  <p className="text-[11px] font-bold text-blue-700 uppercase tracking-wider">KYC Details</p>
                  {logDetail.targetUser && (
                    <div>
                      <p className="text-[12px] font-semibold text-ink">Target user: @{logDetail.targetUser.username}</p>
                      <p className="text-[11px] text-mist">{logDetail.targetUser.firstName} {logDetail.targetUser.lastName} · {logDetail.targetUser.email}</p>
                    </div>
                  )}
                  {logDetail.action === 'KYC_IDENTITY_REVEALED' && (
                    <p className="text-[12px] text-purple-700 font-semibold">🔐 Full NIN/BVN revealed by @{logDetail.user?.username}{logDetail.user?.email ? ` · ${logDetail.user.email}` : ''}</p>
                  )}
                  {logDetail.action === 'KYC_MANUALLY_APPROVED' && (
                    <p className="text-[12px] text-emerald-700 font-semibold">✅ Approved by @{meta.approvedBy || logDetail.user?.username}{meta.approvedByEmail ? ` · ${meta.approvedByEmail}` : ''}</p>
                  )}
                  {logDetail.action === 'KYC_MANUALLY_REJECTED' && (
                    <div>
                      <p className="text-[12px] text-red-600 font-semibold">❌ Rejected by @{meta.rejectedBy || logDetail.user?.username}{meta.rejectedByEmail ? ` · ${meta.rejectedByEmail}` : ''}</p>
                      {meta.reason && <p className="text-[12px] text-red-500 mt-1">Reason: {meta.reason}</p>}
                    </div>
                  )}
                  {logDetail.action === 'KYC_FACE_SUBMITTED' && <p className="text-[12px] text-blue-600">📸 User submitted their KYC face scan</p>}
                  {logDetail.action === 'KYC_COMPLETED' && <p className="text-[12px] text-emerald-600">Auto-verified — NIN and BVN names matched</p>}
                  {logDetail.action === 'KYC_MANUAL_REVIEW' && <p className="text-[12px] text-amber-600">Sent to manual review — name or DOB mismatch between NIN and BVN</p>}
                </div>
              )}

              {Object.keys(meta).length > 0 && (
                <div className="bg-warm rounded-xl p-4">
                  <p className="text-[11px] font-bold text-mist uppercase tracking-wider mb-2">Metadata</p>
                  <div className="space-y-1.5">
                    {Object.entries(meta).map(([k, v]) => (
                      k === 'facePhotoUrl' ? null : (
                      <div key={k} className="flex justify-between gap-4">
                        <span className="text-[11px] text-mist capitalize">{k.replace(/([A-Z])/g, ' $1').trim()}</span>
                        <span className="text-[11px] font-medium text-ink text-right break-all">{String(v)}</span>
                      </div>
                      )
                    ))}
                  </div>
                </div>
              )}
            </div>
          )
        })()}
      </Modal>

      {/* ── CS Ticket detail modal ── */}
      <Modal open={!!csTicketDetail} onClose={() => setCsTicketDetail(null)} title={csTicketDetail?.ticket?.subject || 'Ticket'} size="lg">
        {csTicketDetailLoading ? <div className="space-y-3">{[...Array(3)].map((_,i) => <Skeleton key={i} className="h-12 rounded-xl"/>)}</div>
        : (
          <div className="space-y-4">
            <div className="flex items-center gap-2 flex-wrap">
              <Badge variant={pv(csTicketDetail?.ticket?.priority)}>{csTicketDetail?.ticket?.priority?.toLowerCase()}</Badge>
              <Badge variant={tsv(csTicketDetail?.ticket?.status)}>{csTicketDetail?.ticket?.status?.replace('_',' ').toLowerCase()}</Badge>
              {csTicketDetail?.ticket?.escalatedAt && <Badge variant="danger">⬆ Escalated to Admin</Badge>}
              {csTicketDetail?.ticket?.assignedToId && <span className="text-[11px] text-dim">Assigned to @{csTicketDetail.ticket.assignedTo?.username || csTicketDetail.ticket.assignedToId?.slice(0,8)}</span>}
            </div>
            {csTicketDetail?.user && (
              <div className="bg-warm rounded-xl p-3.5">
                <p className="text-[11px] font-semibold text-mist uppercase tracking-wider mb-1">Filed by</p>
                <p className="text-[13px] font-medium text-ink">{csTicketDetail.user.firstName} · @{csTicketDetail.user.username} · {csTicketDetail.user.email}</p>
              </div>
            )}
            <div className="space-y-3 max-h-80 overflow-y-auto px-1">
              <p className="text-[11px] font-semibold text-mist uppercase tracking-wider">Conversation</p>
              {(csTicketDetail?.replies || []).length === 0 && <p className="text-[13px] text-mist py-4 text-center">No replies yet</p>}
              {(csTicketDetail?.replies || []).map((r: any) => {
                const isCS = r.isAdminReply
                const senderName = isCS ? 'Support team' : `${csTicketDetail?.user?.firstName || ''} ${csTicketDetail?.user?.lastName || ''}`.trim() || 'User'
                const initials = senderName.split(' ').map((n: string) => n[0]).join('').slice(0, 2).toUpperCase()
                return (
                  <div key={r.id} className={`flex gap-2.5 ${isCS ? 'flex-row-reverse' : 'flex-row'}`}>
                    <div className={`w-8 h-8 rounded-full flex items-center justify-center text-[11px] font-bold flex-shrink-0 mt-0.5 ${isCS ? 'bg-brand text-white' : 'bg-ink text-white'}`}>{initials}</div>
                    <div className={`max-w-[75%] ${isCS ? 'items-end' : 'items-start'} flex flex-col`}>
                      <p className="text-[10px] font-semibold text-mist mb-1">{senderName} · {dayjs(r.createdAt).format('MMM D, h:mm A')}</p>
                      <div className={`rounded-2xl px-4 py-2.5 text-[13px] leading-relaxed ${isCS ? 'bg-brand text-white rounded-tr-sm' : 'bg-warm text-ink rounded-tl-sm'}`}>{r.message}</div>
                    </div>
                  </div>
                )
              })}
            </div>
            {(csTicketDetail?.notes || []).length > 0 && (
              <div className="border-t border-black/[0.05] pt-4 space-y-2">
                <p className="text-[11px] font-semibold text-amber-600 uppercase tracking-wider">🔒 Internal Notes</p>
                {csTicketDetail.notes.map((n: any) => (
                  <div key={n.id} className="bg-amber-50 border border-amber-100 rounded-xl p-3 text-[12px]">
                    <p className="text-[10px] text-amber-600 font-semibold mb-1">Staff note · {dayjs(n.createdAt).format('MMM D, h:mm A')}</p>
                    <p className="text-amber-900">{n.content}</p>
                  </div>
                ))}
              </div>
            )}
            <div className="bg-amber-50 border border-amber-100 rounded-xl p-3.5"><p className="text-[12px] text-amber-700">Super Admin read-only view. To take action on this ticket, use the Admin panel.</p></div>
          </div>
        )}
      </Modal>

      {/* ── CS Report detail modal ── */}
      <Modal open={!!csReportDetail} onClose={() => setCsReportDetail(null)} title={csReportDetail?.type || 'Report'} size="lg">
        {csReportDetailLoading ? <div className="space-y-3">{[...Array(3)].map((_,i) => <Skeleton key={i} className="h-12 rounded-xl"/>)}</div>
        : (
          <div className="space-y-4">
            <div className="flex items-center gap-2 flex-wrap">
              <Badge variant={dsv(csReportDetail?.status)}>{csReportDetail?.status?.replace('_',' ').toLowerCase()}</Badge>
              {csReportDetail?.groupId && <Badge variant="neutral">Group report</Badge>}
              {csReportDetail?.reportedUserId && <Badge variant="neutral">Member report</Badge>}
              {csReportDetail?.escalatedAt && <Badge variant="danger">⬆ Escalated</Badge>}
            </div>
            <div className="bg-warm rounded-xl p-4 space-y-2">
              <p className="text-[13px] text-ink leading-relaxed">{csReportDetail?.description}</p>
              {csReportDetail?.reporter && <p className="text-[11px] text-mist">Reported by @{csReportDetail.reporter?.username} · {dayjs(csReportDetail?.createdAt).format('MMM D, YYYY h:mm A')}</p>}
              {csReportDetail?.reportedUser && <p className="text-[11px] text-mist">Against @{csReportDetail.reportedUser?.username}</p>}
            </div>
            {csReportDetail?.resolution && (
              <div className="bg-emerald-50 border border-emerald-100 rounded-xl p-4">
                <p className="text-[11px] font-semibold text-emerald-700 uppercase tracking-wider mb-1">Resolution</p>
                <p className="text-[13px] text-emerald-900">{csReportDetail.resolution}</p>
                {csReportDetail.resolvedById && <p className="text-[11px] text-emerald-600 mt-1">Resolved by @{csReportDetail.resolvedBy?.username || csReportDetail.resolvedById?.slice(0,8)}</p>}
              </div>
            )}
            {(csReportDetail?.notes || []).length > 0 && (
              <div className="space-y-2">
                <p className="text-[11px] font-semibold text-amber-600 uppercase tracking-wider">🔒 Internal Notes from CS</p>
                {csReportDetail.notes.map((n: any) => (
                  <div key={n.id} className="bg-amber-50 border border-amber-100 rounded-xl p-3 text-[12px]">
                    <p className="text-[10px] text-amber-600 font-semibold mb-1">Staff note · {dayjs(n.createdAt).format('MMM D, h:mm A')}</p>
                    <p className="text-amber-900">{n.content}</p>
                  </div>
                ))}
              </div>
            )}
            <div className="bg-amber-50 border border-amber-100 rounded-xl p-3.5"><p className="text-[12px] text-amber-700">Super Admin read-only view. To take enforcement action, use the Admin panel escalation queue.</p></div>
          </div>
        )}
      </Modal>

      {/* ── Permanent ban modal ── */}
      <Modal open={!!banModal} onClose={() => { setBanModal(null); setBanReason('') }} title={`Permanently ban ${banModal?.firstName}?`} size="sm"
        footer={<><Button variant="secondary" onClick={() => { setBanModal(null); setBanReason('') }}>Cancel</Button><Button variant="danger" loading={banLoading} disabled={!banReason.trim()} onClick={handleBan}>Permanently ban</Button></>}>
        <div className="bg-red-50 border border-red-100 rounded-xl p-4 mb-4">
          <p className="text-[13px] font-semibold text-red-600 mb-1">Super Admin action — permanent</p>
          <p className="text-[12px] text-red-500">This user will be permanently banned from PayPaddy. Only you can reverse this.</p>
        </div>
        <Input label="Reason" placeholder="e.g. Severe fraud, platform abuse" value={banReason} onChange={e => setBanReason(e.target.value)}/>
      </Modal>

      {/* ── Delete account modal ── */}
      <Modal open={!!deleteModal} onClose={() => { setDeleteModal(null); setDeleteReason('') }} title={`Delete ${deleteModal?.firstName}'s account?`} size="sm"
        footer={<><Button variant="secondary" onClick={() => { setDeleteModal(null); setDeleteReason('') }}>Cancel</Button><Button variant="danger" loading={deleteLoading} disabled={!deleteReason.trim()} onClick={handleDelete}>Delete account</Button></>}>
        <div className="bg-red-50 border border-red-100 rounded-xl p-4 mb-4">
          <p className="text-[13px] font-semibold text-red-600 mb-1">Soft delete</p>
          <p className="text-[12px] text-red-500">Account is blocked and hidden but transaction history is preserved for compliance.</p>
        </div>
        <Input label="Reason" placeholder="e.g. User requested permanent closure" value={deleteReason} onChange={e => setDeleteReason(e.target.value)}/>
      </Modal>
    </DashboardLayout>
  )
}