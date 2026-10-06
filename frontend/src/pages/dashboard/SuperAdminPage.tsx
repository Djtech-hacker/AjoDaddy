import { useState, useEffect, useRef } from 'react'
import { motion } from 'framer-motion'
import DashboardLayout from '@/components/layout/DashboardLayout'
import { Button, Badge, Skeleton, Modal } from '@/components/ui'
import { superAdminApi, paymentsApi } from '@/api/services'
import { useAuthStore } from '@/stores/authStore'
import { useUIStore } from '@/stores/uiStore'
import dayjs from 'dayjs'
import relativeTime from 'dayjs/plugin/relativeTime'
dayjs.extend(relativeTime)

type Tab = 'overview' | 'cs-oversight' | 'users' | 'revenue' | 'settings' | 'audit'

const rv = (r: string) => ({ SUPER_ADMIN:'success', ADMIN:'brand', CUSTOMER_SERVICE:'warning', USER:'neutral' } as any)[r] || 'neutral'
const sv = (s: string) => ({ ACTIVE:'success', BANNED:'danger', SUSPENDED:'warning' } as any)[s] || 'neutral'
const tsv = (s: string) => ({ OPEN:'warning', IN_PROGRESS:'brand', RESOLVED:'success', CLOSED:'neutral' } as any)[s] || 'neutral'
const dsv = (s: string) => ({ OPEN:'warning', UNDER_REVIEW:'warning', ESCALATED:'danger', RESOLVED:'success', CLOSED:'neutral', DISMISSED:'neutral' } as any)[s] || 'neutral'
const pv  = (p: string) => ({ LOW:'neutral', MEDIUM:'warning', HIGH:'danger', URGENT:'danger' } as any)[p] || 'neutral'
const wv  = (s: string) => ({ COMPLETED:'success', PROCESSING:'brand', PENDING:'warning', FAILED:'danger' } as any)[s] || 'neutral'
const tv  = (s: string) => ({ COMPLETED:'success', PROCESSING:'brand', PENDING:'warning', FAILED:'danger', REVERSED:'neutral' } as any)[s] || 'neutral'

const KYC_ACTIONS = ['KYC_MANUALLY_APPROVED','KYC_MANUALLY_REJECTED','KYC_COMPLETED','KYC_NIN_VERIFIED','KYC_BVN_VERIFIED','KYC_MANUAL_REVIEW','KYC_DUPLICATE_NIN_ATTEMPT','KYC_DUPLICATE_BVN_ATTEMPT','KYC_IDENTITY_REVEALED','KYC_FACE_SUBMITTED']

// Sub-tabs inside the per-user audit modal
type AuditSection = 'transactions' | 'contributions' | 'groups' | 'actions' | 'flags' | 'disputes' | 'tickets' | 'logins'

/* ───────────── design tokens (shared look with SupportPage / AdminPage) ───────────── */
const fieldCls = 'w-full border border-gray-200 rounded-lg px-3 text-[12px] text-gray-900 bg-gray-50 outline-none focus:border-emerald-500 focus:bg-white focus:ring-2 focus:ring-emerald-500/10 transition-all'
const labelCls = 'block text-[9.5px] font-semibold text-gray-400 uppercase tracking-wider mb-1.5'
const cardCls  = 'bg-white border border-gray-100 rounded-2xl shadow-sm overflow-hidden'
const rowCls   = 'bg-gray-50 border border-gray-100 rounded-lg p-3'
const btnPrimary = 'h-9 px-4 rounded-lg bg-[#0B3D2A] text-white text-[12px] font-semibold hover:bg-[#0F5138] disabled:opacity-40 disabled:cursor-not-allowed transition-colors'
const btnGhost   = 'h-9 px-4 rounded-lg border border-gray-200 text-gray-700 text-[12px] font-semibold hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed transition-colors'
const btnDanger  = 'h-9 px-4 rounded-lg bg-red-500 text-white text-[12px] font-semibold hover:bg-red-600 disabled:opacity-40 disabled:cursor-not-allowed transition-colors'
const act = 'h-7 px-2.5 rounded-md border text-[11px] font-semibold whitespace-nowrap disabled:opacity-50 transition-colors'
const actGray  = `${act} border-gray-200 text-gray-700 bg-white hover:bg-gray-50`
const actRed   = `${act} border-red-200 text-red-600 bg-red-50 hover:bg-red-100`
const TH = 'px-5 py-2.5 text-left text-[9.5px] font-semibold text-gray-400 uppercase tracking-wider whitespace-nowrap'
const TD = 'px-5 py-3'

const ICON = {
  search: 'M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z',
  down:   'M19 9l-7 7-7-7',
  alert:  'M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z',
  check:  'M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z',
  chat:   'M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z',
  flag:   'M3 21v-4m0 0V5a2 2 0 012-2h6.5l1 1H21l-3 6 3 6h-8.5l-1-1H5a2 2 0 00-2 2zm9-13.5V9',
  user:   'M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z',
  list:   'M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2',
  cash:   'M17 9V7a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2m2 4h10a2 2 0 002-2v-6a2 2 0 00-2-2H9a2 2 0 00-2 2v6a2 2 0 002 2zm7-5a2 2 0 11-4 0 2 2 0 014 0z',
  inbox:  'M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4',
  clock:  'M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z',
  camera: 'M3 9a2 2 0 012-2h.93a2 2 0 001.664-.89l.812-1.22A2 2 0 0110.07 4h3.86a2 2 0 011.664.89l.812 1.22A2 2 0 0018.07 7H19a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V9zM15 13a3 3 0 11-6 0 3 3 0 016 0z',
  lock:   'M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z',
}

const Svg = ({ d, className = 'w-4 h-4', sw = 1.8 }: { d: string; className?: string; sw?: number }) => (
  <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden>
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={sw} d={d} />
  </svg>
)

/* ───────────── small shared components ───────────── */
const TAG: any = {
  success: 'bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200',
  brand:   'bg-blue-50 text-blue-700 ring-1 ring-blue-200',
  warning: 'bg-amber-50 text-amber-700 ring-1 ring-amber-200',
  danger:  'bg-red-50 text-red-600 ring-1 ring-red-200',
  neutral: 'bg-gray-100 text-gray-500 ring-1 ring-gray-200',
}
function Tag({ variant = 'neutral', children }: { variant?: string; children?: React.ReactNode }) {
  return <span className={`inline-flex items-center rounded-md px-2 py-0.5 text-[9px] font-bold uppercase tracking-wide whitespace-nowrap ${TAG[variant] || TAG.neutral}`}>{children}</span>
}

const TONES: any = {
  orange:  { box: 'bg-orange-50 border-orange-100',   icon: 'bg-orange-100 text-orange-600',   title: 'text-orange-800',  text: 'text-orange-600' },
  blue:    { box: 'bg-blue-50 border-blue-100',       icon: 'bg-blue-100 text-blue-600',       title: 'text-blue-800',    text: 'text-blue-600' },
  amber:   { box: 'bg-amber-50 border-amber-100',     icon: 'bg-amber-100 text-amber-600',     title: 'text-amber-800',   text: 'text-amber-700' },
  red:     { box: 'bg-red-50 border-red-100',         icon: 'bg-red-100 text-red-600',         title: 'text-red-700',     text: 'text-red-600' },
  emerald: { box: 'bg-emerald-50 border-emerald-100', icon: 'bg-emerald-100 text-emerald-600', title: 'text-emerald-800', text: 'text-emerald-700' },
  purple:  { box: 'bg-purple-50 border-purple-100',   icon: 'bg-purple-100 text-purple-600',   title: 'text-purple-800',  text: 'text-purple-600' },
}
function Notice({ tone, icon, title, children, right }: { tone: string; icon?: string; title?: string; children?: React.ReactNode; right?: React.ReactNode }) {
  const t = TONES[tone]
  return (
    <div className={`${t.box} border rounded-xl px-4 py-3 flex items-start gap-3`}>
      {icon && <span className={`w-8 h-8 rounded-lg ${t.icon} flex items-center justify-center flex-shrink-0`}><Svg d={icon} /></span>}
      <div className="min-w-0 flex-1">
        {title && <p className={`text-[12px] font-semibold ${t.title}`}>{title}</p>}
        {children && <p className={`text-[11px] ${t.text} ${title ? 'mt-0.5' : ''} leading-relaxed`}>{children}</p>}
      </div>
      {right}
    </div>
  )
}

function Field({ label, ...props }: { label: string } & React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <div>
      <label className={labelCls}>{label}</label>
      <input {...props} className={`${fieldCls} h-10`} />
    </div>
  )
}

function Sel({ value, onChange, options, className = 'w-44', disabled }: { value: string; onChange: (v: string) => void; options: string[][]; className?: string; disabled?: boolean }) {
  return (
    <div className={`relative ${className}`}>
      <select value={value} disabled={disabled} onChange={e => onChange(e.target.value)} className={`${fieldCls} h-10 pr-8 appearance-none cursor-pointer font-medium disabled:opacity-50`}>
        {options.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
      </select>
      <Svg d={ICON.down} className="absolute right-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-400 pointer-events-none" sw={2} />
    </div>
  )
}

function SearchBox({ value, onChange, placeholder }: { value: string; onChange: (v: string) => void; placeholder: string }) {
  return (
    <div className="relative flex-1 min-w-[200px] max-w-sm">
      <Svg d={ICON.search} className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" sw={2} />
      <input value={value} onChange={e => onChange(e.target.value)} placeholder={placeholder} className={`${fieldCls} h-10 pl-9`} />
    </div>
  )
}

function Loading({ n = 4 }: { n?: number }) {
  return <div className="p-4 space-y-2">{[...Array(n)].map((_, i) => <Skeleton key={i} className="h-10 rounded-lg" />)}</div>
}

function Empty({ title, sub, icon }: { title: string; sub?: string; icon?: string }) {
  return (
    <div className="py-12 text-center px-4">
      {icon && <span className="w-10 h-10 rounded-xl bg-gray-50 text-gray-400 flex items-center justify-center mx-auto mb-3"><Svg d={icon} className="w-5 h-5" /></span>}
      <p className="text-[13px] font-semibold text-gray-800">{title}</p>
      {sub && <p className="text-[11px] text-gray-400 mt-1">{sub}</p>}
    </div>
  )
}

function Table({ heads, children }: { heads: string[]; children: React.ReactNode }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[640px]">
        <thead className="bg-gray-50/70">
          <tr>{heads.map((h, i) => <th key={`${h}-${i}`} className={TH}>{h}</th>)}</tr>
        </thead>
        <tbody className="divide-y divide-gray-50">{children}</tbody>
      </table>
    </div>
  )
}

function PageBar({ pag, page, setPage, noun = '' }: { pag: any; page: number; setPage: React.Dispatch<React.SetStateAction<number>>; noun?: string }) {
  if (!pag || pag.totalPages <= 1) return null
  return (
    <div className="flex items-center justify-between px-5 py-3 border-t border-gray-50 gap-3 flex-wrap">
      <p className="text-[11px] text-gray-400">Page {pag.page || page} of {pag.totalPages}{pag.total ? ` · ${pag.total} ${noun}` : ''}</p>
      <div className="flex gap-2">
        <button disabled={page === 1} onClick={() => setPage(p => p - 1)} className={actGray}>Prev</button>
        <button disabled={page >= pag.totalPages} onClick={() => setPage(p => p + 1)} className={actGray}>Next</button>
      </div>
    </div>
  )
}

function PillTabs<T extends string>({ items, value, onChange }: { items: { id: T; label: string }[]; value: T; onChange: (id: T) => void }) {
  return (
    <div className="flex items-center gap-1 bg-gray-100 rounded-lg p-0.5 overflow-x-auto w-fit max-w-full" role="tablist" style={{ scrollbarWidth: 'none' }}>
      {items.map(t => (
        <button key={t.id} role="tab" aria-selected={value === t.id} onClick={() => onChange(t.id)}
          className={`px-3 h-8 rounded-md text-[11px] font-semibold whitespace-nowrap flex-shrink-0 transition-all ${value === t.id ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-800'}`}>
          {t.label}
        </button>
      ))}
    </div>
  )
}

const Toolbar = ({ children }: { children: React.ReactNode }) => (
  <div className="flex items-center gap-3 flex-wrap px-5 sm:px-6 py-4">{children}</div>
)

function Stat({ label, value, sub, tone }: { label: string; value: React.ReactNode; sub?: string; tone?: 'emerald' | 'blue' }) {
  const box = tone === 'emerald' ? 'bg-emerald-50 border-emerald-200' : tone === 'blue' ? 'bg-blue-50 border-blue-200' : 'bg-white border-gray-100'
  const lab = tone === 'emerald' ? 'text-emerald-700' : tone === 'blue' ? 'text-blue-700' : 'text-gray-400'
  const val = tone === 'emerald' ? 'text-emerald-700' : tone === 'blue' ? 'text-blue-700' : 'text-gray-900'
  const sb  = tone === 'emerald' ? 'text-emerald-600' : tone === 'blue' ? 'text-blue-600' : 'text-gray-400'
  return (
    <div className={`${box} border rounded-2xl shadow-sm p-5`}>
      <p className={`text-[9.5px] font-semibold ${lab} uppercase tracking-wider mb-2`}>{label}</p>
      <p className={`text-[20px] sm:text-[22px] font-bold ${val} tracking-tight`}>{value}</p>
      {sub && <p className={`text-[11px] ${sb} mt-1`}>{sub}</p>}
    </div>
  )
}

/* ───────────── page ───────────── */
export default function SuperAdminPage() {
  const { user: currentUser } = useAuthStore()
  const { showToast } = useUIStore()
  const [tab, setTab] = useState<Tab>('overview')

  const [dash, setDash]             = useState<any>(null)
  const [dashLoading, setDL]        = useState(false)
  const [recentReports, setRecentReports] = useState<any[]>([])
  const [recentAudit, setRecentAudit]     = useState<any[]>([])
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

  // ── Per-user audit trail (search a user, see everything they've done) ──
  const [auditUser, setAuditUser]         = useState<any>(null)
  const [auditData, setAuditData]         = useState<any>(null)
  const [auditLoading, setAuditLoading]   = useState(false)
  const [auditSection, setAuditSection]   = useState<AuditSection>('transactions')

  // ── Company revenue ──
  const [revenue, setRevenue]           = useState<any>(null)
  const [revenueLoading, setRevenueLoading] = useState(false)
  const [revenueSubTab, setRevenueSubTab]   = useState<'penalties' | 'platform-fees' | 'withdrawals'>('penalties')

  // ── Platform-wide user deposits (separate from company revenue) ──
  const [deposits, setDeposits]           = useState<any>(null)
  const [depositsLoading, setDepositsLoading] = useState(false)

  // ── Company revenue withdrawal ──
  const [banks, setBanks]                 = useState<{ name: string; code: string }[]>([])
  const [withdrawModalOpen, setWithdrawModalOpen] = useState(false)
  const [withdrawLoading, setWithdrawLoading]     = useState(false)
  const [wdAmount, setWdAmount]           = useState('')
  const [wdBankCode, setWdBankCode]       = useState('')
  const [wdBankName, setWdBankName]       = useState('')
  const [wdAccountNumber, setWdAccountNumber] = useState('')
  const [wdAccountName, setWdAccountName] = useState('')
  const [wdVerifying, setWdVerifying]     = useState(false)
  const [wdPassword, setWdPassword]       = useState('')
  const [wdFacePhotoUrl, setWdFacePhotoUrl] = useState('')
  const [wdCameraOn, setWdCameraOn]       = useState(false)
  const videoRef  = useRef<HTMLVideoElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const streamRef = useRef<MediaStream | null>(null)

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
      const [dashRes, reportsRes, auditRes] = await Promise.all([
        superAdminApi.getDashboard(),
        superAdminApi.getAllDisputes({ page: 1, limit: 10 }),
        superAdminApi.getFullAuditLog({ page: 1, limit: 4 }),
      ])
      setDash((dashRes.data as any)?.data || dashRes.data)
      const rd = (reportsRes.data as any)?.data || reportsRes.data
      const disputes = rd?.disputes || []
      setRecentReports(disputes)
      setReportStats({ total: rd?.pagination?.total || 0, open: disputes.filter((d: any) => d.status === 'OPEN').length, escalated: disputes.filter((d: any) => d.status === 'ESCALATED').length, resolved: disputes.filter((d: any) => d.status === 'RESOLVED').length })
      const ad = (auditRes.data as any)?.data || auditRes.data
      setRecentAudit(ad?.logs || [])
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

  const loadDeposits = async () => {
    setDepositsLoading(true)
    try {
      const res = await superAdminApi.getDeposits()
      setDeposits((res.data as any)?.data || res.data)
    } catch { showToast('Could not load deposit totals', 'error') }
    finally { setDepositsLoading(false) }
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
  useEffect(() => { if (tab === 'revenue') { loadRevenue(); loadDeposits() } }, [tab])
  useEffect(() => { if (tab === 'settings') loadSettings() }, [tab])
  useEffect(() => { if (tab === 'audit') loadLogs() }, [tab, logsPage, actionFilter])

  // Stop any open camera stream if the component unmounts mid-capture
  useEffect(() => () => { streamRef.current?.getTracks().forEach(t => t.stop()) }, [])

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

  // ── Per-user audit trail ─────────────────────────────────────
  const openUserAudit = async (u: any) => {
    setAuditUser(u)
    setAuditData(null)
    setAuditSection('transactions')
    setAuditLoading(true)
    try {
      const res = await superAdminApi.getUserAudit(u.id)
      setAuditData((res.data as any)?.data || res.data)
    } catch (err: any) {
      showToast(err?.response?.data?.message || 'Could not load audit trail', 'error')
    } finally { setAuditLoading(false) }
  }

  const closeUserAudit = () => { setAuditUser(null); setAuditData(null) }

  // ── Company revenue withdrawal helpers ──────────────────────
  const loadBanks = async () => {
    if (banks.length) return
    try {
      const res = await paymentsApi.getBanks()
      setBanks(((res.data as any)?.data || res.data || []) as any[])
    } catch { /* non-fatal — select just stays empty */ }
  }

  const openWithdrawModal = () => {
    setWithdrawModalOpen(true)
    loadBanks()
  }

  const stopCamera = () => {
    streamRef.current?.getTracks().forEach(t => t.stop())
    streamRef.current = null
    setWdCameraOn(false)
  }

  const closeWithdrawModal = () => {
    stopCamera()
    setWithdrawModalOpen(false)
    setWdAmount(''); setWdBankCode(''); setWdBankName(''); setWdAccountNumber('')
    setWdAccountName(''); setWdPassword(''); setWdFacePhotoUrl('')
  }

  const handleVerifyAccount = async (accNum: string, bankCode: string) => {
    if (accNum.length !== 10 || !bankCode) { setWdAccountName(''); return }
    setWdVerifying(true)
    try {
      const res = await paymentsApi.verifyAccount(accNum, bankCode)
      const d = (res.data as any)?.data || res.data
      setWdAccountName(d?.accountName || '')
      if (!d?.accountName) showToast('Could not resolve an account name for this number', 'error')
    } catch (err: any) {
      setWdAccountName('')
      showToast(err?.response?.data?.message || 'Could not verify account', 'error')
    } finally { setWdVerifying(false) }
  }

  // Auto-verify once both the account number (10 digits) and a bank are set
  useEffect(() => {
    if (wdAccountNumber.length === 10 && wdBankCode) handleVerifyAccount(wdAccountNumber, wdBankCode)
    else setWdAccountName('')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wdAccountNumber, wdBankCode])

  const startCamera = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user' } })
      streamRef.current = stream
      if (videoRef.current) {
        videoRef.current.srcObject = stream
        await videoRef.current.play()
      }
      setWdCameraOn(true)
    } catch {
      showToast('Camera access is required for face verification', 'error')
    }
  }

  const captureFace = () => {
    if (!videoRef.current || !canvasRef.current) return
    const video = videoRef.current
    const canvas = canvasRef.current
    canvas.width = video.videoWidth
    canvas.height = video.videoHeight
    const ctx = canvas.getContext('2d')
    ctx?.drawImage(video, 0, 0, canvas.width, canvas.height)
    setWdFacePhotoUrl(canvas.toDataURL('image/jpeg', 0.85))
    stopCamera()
  }

  const retakeFace = () => {
    setWdFacePhotoUrl('')
    startCamera()
  }

  const handleWithdrawRevenue = async () => {
    const amount = parseFloat(wdAmount)
    if (!amount || amount < 500) return showToast('Enter an amount of at least ₦500', 'error')
    if (revenue && amount > revenue.walletBalance) return showToast('Amount exceeds the available balance', 'error')
    if (!wdBankCode || !wdAccountNumber || !wdAccountName) return showToast('Select a bank and verify the account first', 'error')
    if (!wdPassword) return showToast('Enter your password to confirm', 'error')
    if (!wdFacePhotoUrl) return showToast('Face verification photo is required', 'error')

    setWithdrawLoading(true)
    try {
      const res = await superAdminApi.withdrawRevenue({
        amount,
        accountNumber: wdAccountNumber,
        bankCode: wdBankCode,
        accountName: wdAccountName,
        bankName: wdBankName,
        password: wdPassword,
        facePhotoUrl: wdFacePhotoUrl,
      })
      const d = (res.data as any)?.data || res.data
      showToast(d?.message || 'Withdrawal initiated', 'success')
      closeWithdrawModal()
      loadRevenue()
    } catch (err: any) {
      showToast(err?.response?.data?.message || 'Withdrawal failed', 'error')
    } finally { setWithdrawLoading(false) }
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
    if (action === 'COMPANY_REVENUE_WITHDRAWAL') return 'text-emerald-700 bg-emerald-100'
    if (action?.includes('GROUP')) return 'text-teal-700 bg-teal-50'
    return 'text-gray-700 bg-gray-100'
  }
  const actionPill = (action: string) => `inline-flex items-center px-2 py-0.5 rounded-md text-[9px] font-bold uppercase tracking-wide ${getActionColor(action)}`

  const renderAuditDetails = (log: any) => {
    const meta = log.metadata || {}
    const isKyc = KYC_ACTIONS.includes(log.action)

    if (isKyc) {
      return (
        <div className="space-y-1">
          {log.targetUser && (
            <p className="text-[11px] font-semibold text-gray-700">
              Target: @{log.targetUser.username} — {log.targetUser.firstName} {log.targetUser.lastName}
            </p>
          )}
          {log.action === 'KYC_IDENTITY_REVEALED' && (
            <p className="text-[11px] text-purple-600 font-semibold">NIN/BVN revealed by @{log.user?.username || '—'}{log.user?.email ? ` · ${log.user.email}` : ''}</p>
          )}
          {log.action === 'KYC_MANUALLY_APPROVED' && (
            <p className="text-[11px] text-emerald-600 font-semibold">Manually approved by @{meta.approvedBy || log.user?.username || '—'}{meta.approvedByEmail ? ` · ${meta.approvedByEmail}` : ''}</p>
          )}
          {log.action === 'KYC_MANUALLY_REJECTED' && (
            <div>
              <p className="text-[11px] text-red-500 font-semibold">Rejected by @{meta.rejectedBy || log.user?.username || '—'}{meta.rejectedByEmail ? ` · ${meta.rejectedByEmail}` : ''}</p>
              {meta.reason && <p className="text-[11px] text-red-400 mt-0.5">Reason: {meta.reason}</p>}
            </div>
          )}
          {log.action === 'KYC_FACE_SUBMITTED' && <p className="text-[11px] text-blue-600">User submitted KYC face scan</p>}
          {log.action === 'KYC_COMPLETED' && <p className="text-[11px] text-emerald-600">Auto-verified — NIN + BVN matched</p>}
          {log.action === 'KYC_MANUAL_REVIEW' && <p className="text-[11px] text-amber-600">Sent to manual review — name/DOB mismatch</p>}
          {log.action === 'KYC_DUPLICATE_NIN_ATTEMPT' && <p className="text-[11px] text-red-500">Duplicate NIN detected</p>}
          {log.action === 'KYC_DUPLICATE_BVN_ATTEMPT' && <p className="text-[11px] text-red-500">Duplicate BVN detected</p>}
          {meta.facePhotoUrl && (
            <div className="flex items-center gap-2 mt-1">
              <img src={meta.facePhotoUrl} className="w-9 h-9 rounded-lg object-cover ring-2 ring-purple-200" alt="Admin face"/>
              <span className="text-[10px] text-purple-600 font-semibold">Face on record</span>
            </div>
          )}
        </div>
      )
    }

    if (log.action === 'COMPANY_REVENUE_WITHDRAWAL') {
      return (
        <div className="space-y-1">
          <p className="text-[11px] text-emerald-700 font-semibold">₦{Number(meta.amount || 0).toLocaleString()} → {meta.accountName} ({meta.accountNumber})</p>
          {meta.bankName && <p className="text-[10px] text-gray-400">{meta.bankName}</p>}
          {meta.facePhotoUrl && (
            <div className="flex items-center gap-2 mt-1">
              <img src={meta.facePhotoUrl} className="w-9 h-9 rounded-lg object-cover ring-2 ring-emerald-200" alt="Withdrawal face"/>
              <span className="text-[10px] text-emerald-600 font-semibold">Face on record</span>
            </div>
          )}
        </div>
      )
    }

    if (log.action === 'ROLE_CHANGED' && meta.previousRole) {
      return <p className="text-[11px] text-gray-500">{meta.previousRole} → {meta.newRole}</p>
    }
    if (meta.reason) {
      return <p className="text-[11px] text-gray-500">Reason: {meta.reason}</p>
    }
    if (Object.keys(meta).length > 0) {
      return <p className="text-[10px] text-gray-400 font-mono truncate max-w-[220px]">{JSON.stringify(meta)}</p>
    }
    return <p className="text-[11px] text-gray-400">{log.entityType}{log.entityId ? ` · ${log.entityId.slice(0,8)}…` : ''}</p>
  }

  const AUDIT_SECTIONS: { id: AuditSection; label: string; count: (d: any) => number }[] = [
    { id: 'transactions',  label: 'Transactions',   count: d => d?.transactions?.length || 0 },
    { id: 'contributions', label: 'Contributions',  count: d => d?.contributions?.length || 0 },
    { id: 'groups',        label: 'Groups',         count: d => (d?.memberships?.length || 0) + (d?.ownedGroups?.length || 0) },
    { id: 'actions',       label: 'Admin Actions',  count: d => (d?.auditAsActor?.length || 0) + (d?.auditAsTarget?.length || 0) },
    { id: 'flags',         label: 'Fraud Flags',    count: d => d?.fraudFlags?.length || 0 },
    { id: 'disputes',      label: 'Disputes',       count: d => (d?.disputesFiled?.length || 0) + (d?.disputesAgainst?.length || 0) },
    { id: 'tickets',       label: 'Support',        count: d => d?.supportTickets?.length || 0 },
    { id: 'logins',        label: 'Login Attempts', count: d => d?.loginAttempts?.length || 0 },
  ]

  const SubTitle = ({ children }: { children: React.ReactNode }) => (
    <p className="text-[9.5px] font-semibold text-gray-400 uppercase tracking-wider mb-1.5 px-1">{children}</p>
  )

  return (
    <DashboardLayout title="Super Admin" subtitle="Platform oversight · Roles · Settings · Full audit trail">
      <div className="bg-[#F8F9FB] min-h-screen">
      <div className="p-4 sm:p-6 max-w-7xl space-y-5 overflow-x-hidden">

        <PillTabs items={TABS} value={tab} onChange={setTab} />

        {/* ── Overview (unchanged) ── */}
        {tab === 'overview' && (
          <>
            {dashLoading ? (
              <div className="grid md:grid-cols-3 gap-4">{[...Array(3)].map((_,i) => <Skeleton key={i} className="h-32 rounded-2xl"/>)}</div>
            ) : (
              <>
                <div>
                  <h2 className="text-[20px] font-extrabold tracking-tight text-ink">Super Admin Console</h2>
                  <p className="text-[12px] text-mist mt-0.5">System metrics, auditing, and platform security flags</p>
                </div>

                {/* Top row */}
                <div className="grid md:grid-cols-3 gap-4">
                  <motion.div className="rounded-2xl bg-brand text-white p-5" initial={{opacity:0,y:12}} animate={{opacity:1,y:0}}>
                    <div className="flex items-center justify-between">
                      <p className="text-[10px] font-semibold uppercase tracking-wider text-white/70">Core platform state</p>
                      <span className="flex items-center gap-1.5 text-[10px] font-semibold"><span className="w-1.5 h-1.5 rounded-full bg-lime"/>Operational</span>
                    </div>
                    <p className="text-[24px] font-extrabold tracking-tight mt-3">All Systems Normal</p>
                    <p className="text-[10px] text-white/60 mt-3">Central Bank partner gateway active • Webhooks live</p>
                  </motion.div>

                  <motion.div className="rounded-2xl bg-white border border-black/[0.06] p-5" initial={{opacity:0,y:12}} animate={{opacity:1,y:0}}>
                    <p className="text-[10px] font-semibold uppercase tracking-wider text-mist">Active sessions</p>
                    <p className="text-[24px] font-extrabold tracking-tight text-ink mt-3">
                      {(overview.system?.activeSessions ?? overview.users?.active ?? 0).toLocaleString()} <span className="text-[16px] font-bold">/ min</span>
                    </p>
                    <p className="text-[10px] text-brand mt-3">↑ {overview.users?.newToday || 0} new users today</p>
                  </motion.div>

                  <motion.div className="rounded-2xl bg-white border border-black/[0.06] p-5" initial={{opacity:0,y:12}} animate={{opacity:1,y:0}}>
                    <p className="text-[10px] font-semibold uppercase tracking-wider text-mist">Response metrics</p>
                    <p className="text-[24px] font-extrabold tracking-tight text-ink mt-3">{overview.system?.avgResponseMs ?? '—'} ms</p>
                    <p className="text-[10px] text-mist mt-3">Gateway average payload</p>
                  </motion.div>
                </div>

                {/* Middle row */}
                <div className="grid md:grid-cols-[1.6fr_1fr] gap-4">
                  <div className="bg-white rounded-2xl border border-black/[0.06] p-5">
                    <div className="flex items-center justify-between mb-3">
                      <p className="text-[13px] font-bold text-ink">Recent Audit Trails</p>
                      <button onClick={() => setTab('audit')} className="text-[11px] text-brand font-semibold">View all →</button>
                    </div>
                    {recentAudit.length === 0 ? (
                      <p className="text-[12px] text-mist text-center py-6">No recent activity</p>
                    ) : (
                      <div className="space-y-2">
                        {recentAudit.map((log: any) => (
                          <button key={log.id} onClick={() => setLogDetail(log)} className="w-full text-left bg-warm rounded-lg px-3 py-2.5 flex items-start justify-between gap-3 hover:bg-sand transition-colors">
                            <div className="min-w-0">
                              <p className="text-[11px] font-semibold text-ink truncate">
                                {log.action?.replace(/_/g,' ').toLowerCase().replace(/^\w/, (c: string) => c.toUpperCase())} by {log.user?.username ? `@${log.user.username}` : 'system'}
                              </p>
                              <p className="text-[10px] text-mist truncate">{log.metadata?.reason || log.entityType || '—'}</p>
                            </div>
                            <span className="text-[10px] text-mist flex-shrink-0">{dayjs(log.createdAt).fromNow()}</span>
                          </button>
                        ))}
                      </div>
                    )}
                  </div>

                  <div className="space-y-4">
                    <div className="rounded-2xl bg-black text-white p-5">
                      <p className="text-[10px] font-semibold uppercase tracking-wider text-lime">Weekly revenue yield</p>
                      <p className="text-[24px] font-extrabold tracking-tight mt-2">₦{Number(overview.finance?.weeklyRevenue ?? overview.finance?.totalRevenue ?? 0).toLocaleString()}</p>
                      <p className="text-[10px] text-white/50 mt-2">{overview.finance?.platformFeePercent ?? 0.5}% platform transaction fee share</p>
                    </div>

                    <div className="bg-white rounded-2xl border border-black/[0.06] p-4">
                      <div className="flex items-center justify-between mb-3">
                        <p className="text-[12px] font-bold text-ink">Fraud Shield Flags</p>
                        {(overview.alerts?.fraudFlags || 0) > 0 && <span className="text-[9px] font-bold text-red-500 bg-red-50 px-2 py-0.5 rounded-full">HIGH</span>}
                      </div>
                      {(dash?.recentFraudFlags || []).length === 0 ? (
                        <p className="text-[11px] text-mist text-center py-3">{overview.alerts?.fraudFlags || 0} unresolved flags</p>
                      ) : (
                        <div className="space-y-2">
                          {dash.recentFraudFlags.slice(0, 3).map((f: any) => (
                            <div key={f.id} className="bg-warm rounded-lg px-3 py-2 flex items-start justify-between gap-2">
                              <div className="min-w-0">
                                <p className="text-[11px] font-semibold text-ink truncate">{f.user ? `${f.user.firstName} ${f.user.lastName}` : f.type}</p>
                                <p className="text-[10px] text-mist truncate">{f.description || f.type}</p>
                              </div>
                              {f.riskScore != null && <span className="text-[10px] font-bold text-red-500 flex-shrink-0">{f.riskScore}% Risk</span>}
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                </div>

                {/* Super Actions */}
                <div className="bg-white rounded-2xl border border-black/[0.06] p-5 md:max-w-[58%]">
                  <p className="text-[13px] font-bold text-ink mb-3">Super Actions</p>
                  <div className="flex gap-2 flex-wrap">
                    <button onClick={() => setTab('settings')} className="h-9 px-4 rounded-lg bg-brand text-white text-[11px] font-semibold hover:opacity-90 transition-opacity">🔔 Broadcast System Alert</button>
                    <button onClick={() => setTab('settings')} className="h-9 px-4 rounded-lg border border-red-400 text-red-500 text-[11px] font-semibold hover:bg-red-50 transition-colors">System Maintenance Mode</button>
                  </div>
                </div>

                {/* Complaints & Reports */}
                <div className="bg-white rounded-2xl border border-black/[0.06] p-4 sm:p-5">
                  <div className="flex items-center justify-between mb-4 gap-2">
                    <p className="text-[14px] font-bold text-ink">Complaints & Reports</p>
                    <Button size="sm" variant="secondary" onClick={() => setTab('cs-oversight')}>View all →</Button>
                  </div>
                  {reportStats && (
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 sm:gap-4 mb-5">
                      {[
                        { label: 'Total',     val: reportStats.total,     color: 'text-ink'         },
                        { label: 'Open',      val: reportStats.open,      color: 'text-amber-600'   },
                        { label: 'Escalated', val: reportStats.escalated, color: 'text-red-600'     },
                        { label: 'Resolved',  val: reportStats.resolved,  color: 'text-emerald-600' },
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
            <Notice tone="amber" icon={ICON.alert} title="Super Admin read-only oversight">
              You can see every ticket, every report, every CS reply, and every internal note. This is monitoring only. Use the Admin panel for enforcement actions.
            </Notice>
            <PillTabs
              items={[{ id: 'tickets', label: 'Support tickets' }, { id: 'reports', label: 'Reports & complaints' }, { id: 'agents', label: 'CS agents' }] as { id: 'tickets' | 'reports' | 'agents'; label: string }[]}
              value={csSubTab} onChange={setCsSubTab} />

            {csSubTab === 'tickets' && (
              <div className={cardCls}>
                <Toolbar>
                  <Sel value={csTicketFilter} onChange={v => { setCsTicketFilter(v); setCsTicketPage(1) }} className="w-48"
                    options={[['', 'All tickets'], ['OPEN', 'Open'], ['IN_PROGRESS', 'In progress'], ['RESOLVED', 'Resolved'], ['CLOSED', 'Closed']]} />
                </Toolbar>
                {csTicketsLoading ? <Loading n={4} />
                : csTickets.length === 0 ? <Empty icon={ICON.chat} title="No tickets found" />
                : (
                  <Table heads={['User', 'Subject', 'Priority', 'Status', 'Assigned to', 'Escalated', 'Created', '']}>
                    {csTickets.map((t: any) => (
                      <tr key={t.id} className="hover:bg-gray-50/80 transition-colors">
                        <td className={TD}><p className="text-[12px] font-semibold text-gray-900">@{t.user?.username || '—'}</p><p className="text-[10.5px] text-gray-400 font-mono">{t.user?.email}</p></td>
                        <td className={`${TD} text-[12px] text-gray-900 max-w-[180px] truncate`}>{t.subject}</td>
                        <td className={TD}><Tag variant={pv(t.priority)}>{t.priority?.toLowerCase()}</Tag></td>
                        <td className={TD}><Tag variant={tsv(t.status)}>{t.status?.replace('_', ' ').toLowerCase()}</Tag></td>
                        <td className={`${TD} text-[11px] text-gray-500`}>{t.assignedToId ? `@${t.assignedTo?.username || t.assignedToId.slice(0, 8)}` : <span className="text-gray-300">Unassigned</span>}</td>
                        <td className={`${TD} text-[11px]`}>{t.escalatedAt ? <span className="text-orange-500 font-semibold">{dayjs(t.escalatedAt).format('MMM D')}</span> : <span className="text-gray-300">—</span>}</td>
                        <td className={`${TD} text-[11px] text-gray-500 whitespace-nowrap`}>{dayjs(t.createdAt).format('MMM D, h:mm A')}</td>
                        <td className={TD}><button onClick={() => openCsTicket(t)} className={actGray}>View</button></td>
                      </tr>
                    ))}
                  </Table>
                )}
                <PageBar pag={csTicketPag} page={csTicketPage} setPage={setCsTicketPage} noun="tickets" />
              </div>
            )}

            {csSubTab === 'reports' && (
              <div className={cardCls}>
                <Toolbar>
                  <Sel value={csReportFilter} onChange={v => { setCsReportFilter(v); setCsReportPage(1) }} className="w-48"
                    options={[['', 'All reports'], ['OPEN', 'Open'], ['UNDER_REVIEW', 'Under review'], ['ESCALATED', 'Escalated'], ['RESOLVED', 'Resolved'], ['DISMISSED', 'Dismissed']]} />
                </Toolbar>
                {csReportsLoading ? <Loading n={4} />
                : csReports.length === 0 ? <Empty icon={ICON.flag} title="No reports found" />
                : (
                  <Table heads={['Reporter', 'Against', 'Type', 'Status', 'Assigned to', 'Resolved by', 'Filed', '']}>
                    {csReports.map((r: any) => (
                      <tr key={r.id} className="hover:bg-gray-50/80 transition-colors">
                        <td className={`${TD} text-[11px] text-gray-500`}>@{r.reporter?.username || '—'}</td>
                        <td className={`${TD} text-[11px] text-gray-500`}>{r.reportedUser ? `@${r.reportedUser.username}` : r.groupId ? 'Group' : '—'}</td>
                        <td className={`${TD} text-[12px] font-medium text-gray-900`}>{r.type}</td>
                        <td className={TD}><Tag variant={dsv(r.status)}>{r.status?.replace('_', ' ').toLowerCase()}</Tag></td>
                        <td className={`${TD} text-[11px] text-gray-500`}>{r.assignedToId ? `@${r.assignedTo?.username || r.assignedToId.slice(0, 8)}` : <span className="text-gray-300">—</span>}</td>
                        <td className={`${TD} text-[11px] text-gray-500`}>{r.resolvedById ? `@${r.resolvedBy?.username || r.resolvedById.slice(0, 8)}` : <span className="text-gray-300">—</span>}</td>
                        <td className={`${TD} text-[11px] text-gray-500 whitespace-nowrap`}>{dayjs(r.createdAt).format('MMM D, h:mm A')}</td>
                        <td className={TD}><button onClick={() => openCsReport(r)} className={actGray}>View</button></td>
                      </tr>
                    ))}
                  </Table>
                )}
                <PageBar pag={csReportPag} page={csReportPage} setPage={setCsReportPage} noun="reports" />
              </div>
            )}

            {csSubTab === 'agents' && (
              <div className="space-y-4">
                <p className="text-[11px] text-gray-400">All active Customer Service agents. Use the Users & Roles tab to promote or demote.</p>
                {csAgents.length === 0 ? (
                  <div className={cardCls}>
                    <Empty icon={ICON.user} title="No CS agents yet" sub="Promote a user to Customer Service to get started." />
                    <div className="flex justify-center pb-8 -mt-4"><button onClick={() => { setRoleFilter('CUSTOMER_SERVICE'); setTab('users') }} className={btnPrimary}>Manage roles →</button></div>
                  </div>
                ) : (
                  <div className="grid sm:grid-cols-2 gap-4">
                    {csAgents.map((a: any) => (
                      <div key={a.id} className={`${cardCls} p-5`}>
                        <div className="flex items-center gap-3 mb-4">
                          {a.avatarUrl
                            ? <img src={a.avatarUrl} alt={`${a.firstName} ${a.lastName}`} className="w-10 h-10 rounded-full object-cover flex-shrink-0"/>
                            : <div className="w-10 h-10 rounded-full bg-amber-100 flex items-center justify-center text-amber-700 text-[12px] font-bold flex-shrink-0">{a.firstName?.[0]}{a.lastName?.[0]}</div>}
                          <div className="flex-1 min-w-0">
                            <p className="text-[12px] font-semibold text-gray-900 truncate">{a.firstName} {a.lastName}</p>
                            <p className="text-[11px] text-gray-400 font-mono truncate">@{a.username}</p>
                            <p className="text-[11px] text-gray-400 truncate">{a.email}</p>
                          </div>
                          <Tag variant={sv(a.status)}>{a.status?.toLowerCase()}</Tag>
                        </div>
                        <div className="grid grid-cols-2 gap-3 text-center">
                          <div className={rowCls}><p className="text-[9.5px] text-gray-400 uppercase tracking-wider font-semibold mb-1">Reputation</p><p className="text-[16px] font-bold text-gray-900">{a.reputationScore || 100}</p></div>
                          <div className={rowCls}><p className="text-[9.5px] text-gray-400 uppercase tracking-wider font-semibold mb-1">Joined</p><p className="text-[12px] font-semibold text-gray-900">{dayjs(a.createdAt).format('MMM D, YYYY')}</p></div>
                        </div>
                        <div className="mt-3 flex gap-2 flex-wrap">
                          <button className={`${btnGhost} flex-1`} onClick={() => { setCsTicketFilter(''); setCsSubTab('tickets') }}>View their tickets</button>
                          <button className={btnGhost} onClick={() => { setRoleFilter('CUSTOMER_SERVICE'); setTab('users') }}>Manage role</button>
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
            <Notice tone="emerald" icon={ICON.lock} title="Super Admin exclusive: role assignment">
              You are the only role that can promote or demote users to Admin, Customer Service, or Super Admin. Click any user's name to see their full activity for audit.
            </Notice>
            <div className={cardCls}>
              <Toolbar>
                <SearchBox value={search} onChange={v => { setSearch(v); setUsersPage(1) }} placeholder="Search by name, username, or email…" />
                <Sel value={roleFilter} onChange={v => { setRoleFilter(v); setUsersPage(1) }} className="w-48"
                  options={[['', 'All roles'], ['SUPER_ADMIN', 'Super Admin'], ['ADMIN', 'Admin'], ['CUSTOMER_SERVICE', 'Customer Service'], ['USER', 'User']]} />
              </Toolbar>
              {usersLoading ? <Loading n={5} />
              : users.length === 0 ? <Empty icon={ICON.user} title="No users found" sub="Try different filters or search words." />
              : (
                <Table heads={['User', 'Email', 'Role', 'Status', 'Joined', 'Actions']}>
                  {users.map((u: any) => (
                    <tr key={u.id} className="hover:bg-gray-50/80 transition-colors">
                      <td className={TD}>
                        <button onClick={() => openUserAudit(u)} className="text-left">
                          <p className="text-[12px] font-semibold text-gray-900 underline decoration-dotted underline-offset-2">{u.firstName} {u.lastName}</p>
                          <p className="text-[11px] text-gray-400 font-mono">@{u.username}</p>
                        </button>
                      </td>
                      <td className={`${TD} text-[11px] text-gray-500 font-mono`}>{u.email}</td>
                      <td className={TD}><Tag variant={rv(u.role)}>{u.role?.replace('_', ' ').toLowerCase()}</Tag></td>
                      <td className={TD}><Tag variant={sv(u.status)}>{u.status?.toLowerCase()}</Tag></td>
                      <td className={`${TD} text-[11px] text-gray-500 whitespace-nowrap`}>{dayjs(u.createdAt).format('MMM D, YYYY')}</td>
                      <td className={TD}>
                        <div className="flex gap-1.5 flex-wrap items-center">
                          <button onClick={() => openUserAudit(u)} className={`${actGray} inline-flex items-center gap-1`}><Svg d={ICON.search} className="w-3 h-3" sw={2} /> Audit</button>
                          {u.id !== currentUser?.id && (
                            <select value={u.role} disabled={roleLoading === u.id} onChange={e => handleRoleChange(u, e.target.value)}
                              className="h-7 border border-gray-200 rounded-md px-2 text-[11px] text-gray-700 bg-white outline-none focus:border-emerald-500 cursor-pointer disabled:opacity-50">
                              <option value="USER">User</option><option value="CUSTOMER_SERVICE">Customer Service</option><option value="ADMIN">Admin</option><option value="SUPER_ADMIN">Super Admin</option>
                            </select>
                          )}
                          {u.id !== currentUser?.id && u.status !== 'BANNED' && <button onClick={() => setBanModal(u)} className={actRed}>Perm ban</button>}
                          {u.id !== currentUser?.id && u.status === 'BANNED' && <button onClick={() => superAdminApi.unbanUser(u.id).then(() => { showToast('Unbanned', 'success'); loadUsers() }).catch((e: any) => showToast(e?.response?.data?.message || 'Failed', 'error'))} className={actGray}>Unban</button>}
                          {u.id !== currentUser?.id && <button onClick={() => setDeleteModal(u)} className={actRed}>Delete</button>}
                        </div>
                      </td>
                    </tr>
                  ))}
                </Table>
              )}
              <PageBar pag={usersPag} page={usersPage} setPage={setUsersPage} noun="users" />
            </div>
          </div>
        )}

        {/* ── Company Revenue ── */}
        {tab === 'revenue' && (
          <div className="space-y-4">
            <Notice tone="blue" icon={ICON.inbox} title="Total money users have put into AjoDaddy">
              All wallet funding by users (via Paystack), separate from company revenue. This money belongs to your users, not the platform.
            </Notice>
            {depositsLoading ? (
              <div className="grid grid-cols-1 md:grid-cols-4 gap-4">{[...Array(4)].map((_, i) => <Skeleton key={i} className="h-24 rounded-2xl" />)}</div>
            ) : deposits && (
              <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                <Stat tone="blue" label="Total deposited (all time)" value={`₦${deposits.totalDeposited.toLocaleString()}`} sub={`${deposits.depositCount} successful deposits`} />
                <Stat label="Unique depositors" value={deposits.uniqueDepositors.toLocaleString()} sub="distinct users" />
                <Stat label="Currently held in wallets" value={`₦${deposits.totalHeldInWallets.toLocaleString()}`} sub="right now, across all users" />
                <Stat label="Avg. per depositor" value={`₦${(deposits.uniqueDepositors ? deposits.totalDeposited / deposits.uniqueDepositors : 0).toLocaleString(undefined, { maximumFractionDigits: 0 })}`} sub="lifetime average" />
              </div>
            )}
            {deposits?.recentDeposits?.length > 0 && (
              <div className={cardCls}>
                <p className="px-5 sm:px-6 pt-4 pb-2 text-[13px] font-bold text-gray-900">Recent deposits</p>
                <Table heads={['When', 'User', 'Amount', 'Reference']}>
                  {deposits.recentDeposits.map((t: any) => (
                    <tr key={t.id} className="hover:bg-gray-50/80 transition-colors">
                      <td className={`${TD} text-[11px] text-gray-500 whitespace-nowrap`}>{dayjs(t.createdAt).format('MMM D, h:mm A')}</td>
                      <td className={`${TD} text-[11px] text-gray-600`}>@{t.user?.username || '—'} <span className="text-gray-400">· {t.user?.email}</span></td>
                      <td className={`${TD} text-[12px] font-bold font-mono text-gray-900`}>₦{t.amount.toLocaleString()}</td>
                      <td className={`${TD} text-[11px] text-gray-400 font-mono truncate max-w-[160px]`}>{t.reference}</td>
                    </tr>
                  ))}
                </Table>
              </div>
            )}

            <Notice tone="emerald" icon={ICON.cash} title="Company revenue account"
              right={<button disabled={!revenue || revenue.walletBalance <= 0} onClick={openWithdrawModal} className={`${btnPrimary} flex-shrink-0`}>Withdraw revenue →</button>}>
              Late penalty fees collected from members, and the 1% platform fee taken on withdrawals, both flow into this account automatically.
            </Notice>

            {revenueLoading ? (
              <div className="grid grid-cols-1 md:grid-cols-4 gap-4">{[...Array(4)].map((_, i) => <Skeleton key={i} className="h-28 rounded-2xl" />)}</div>
            ) : !revenue ? (
              <div className={cardCls}><Empty icon={ICON.cash} title="No revenue data yet" /></div>
            ) : (
              <>
                <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                  <Stat tone="emerald" label="Available balance" value={`₦${revenue.walletBalance.toLocaleString()}`} sub="Ready to withdraw" />
                  <Stat label="From late penalty fees" value={`₦${revenue.totalFromPenalties.toLocaleString()}`} sub={`${revenue.penaltyCount} penalt${revenue.penaltyCount === 1 ? 'y' : 'ies'} collected`} />
                  <Stat label="From platform fees (1%)" value={`₦${revenue.totalFromPlatformFees.toLocaleString()}`} sub={`${revenue.platformFeeCount} withdrawal${revenue.platformFeeCount === 1 ? '' : 's'} charged`} />
                  <Stat label="Withdrawn to date" value={`₦${revenue.totalWithdrawn.toLocaleString()}`} sub={`${revenue.withdrawalCount} withdrawal${revenue.withdrawalCount === 1 ? '' : 's'} made`} />
                </div>

                <PillTabs
                  items={[{ id: 'penalties', label: 'Recent penalty fees' }, { id: 'platform-fees', label: 'Recent platform fees' }, { id: 'withdrawals', label: 'Withdrawal history' }] as { id: 'penalties' | 'platform-fees' | 'withdrawals'; label: string }[]}
                  value={revenueSubTab} onChange={setRevenueSubTab} />

                <div className={cardCls}>
                  {revenueSubTab === 'penalties' ? (
                    revenue.recentPenalties.length === 0 ? <Empty icon={ICON.clock} title="No penalty fees collected yet" /> : (
                      <Table heads={['When', 'Amount', 'From user', 'Group / contribution', 'Status']}>
                        {revenue.recentPenalties.map((t: any) => (
                          <tr key={t.id} className="hover:bg-gray-50/80 transition-colors">
                            <td className={`${TD} text-[11px] text-gray-500 whitespace-nowrap`}>{dayjs(t.createdAt).format('MMM D, h:mm A')}</td>
                            <td className={`${TD} text-[12px] font-bold font-mono text-gray-900`}>₦{t.amount.toLocaleString()}</td>
                            <td className={`${TD} text-[11px] text-gray-500 font-mono`}>{t.metadata?.fromUserId || '—'}</td>
                            <td className={`${TD} text-[11px] text-gray-500 font-mono`}>{t.metadata?.groupId ? `${t.metadata.groupId.slice(0, 8)}…` : '—'}</td>
                            <td className={TD}><Tag variant={t.status === 'COMPLETED' ? 'success' : 'warning'}>{t.status?.toLowerCase()}</Tag></td>
                          </tr>
                        ))}
                      </Table>
                    )
                  ) : revenueSubTab === 'platform-fees' ? (
                    revenue.recentPlatformFees.length === 0 ? <Empty icon={ICON.clock} title="No platform fees collected yet" /> : (
                      <Table heads={['When', 'Amount', 'From user', 'Reference', 'Status']}>
                        {revenue.recentPlatformFees.map((t: any) => (
                          <tr key={t.id} className="hover:bg-gray-50/80 transition-colors">
                            <td className={`${TD} text-[11px] text-gray-500 whitespace-nowrap`}>{dayjs(t.createdAt).format('MMM D, h:mm A')}</td>
                            <td className={`${TD} text-[12px] font-bold font-mono text-gray-900`}>₦{t.amount.toLocaleString()}</td>
                            <td className={`${TD} text-[11px] text-gray-500 font-mono`}>{t.metadata?.fromUserId || '—'}</td>
                            <td className={`${TD} text-[11px] text-gray-400 font-mono truncate max-w-[160px]`}>{t.reference}</td>
                            <td className={TD}><Tag variant="success">{t.status?.toLowerCase()}</Tag></td>
                          </tr>
                        ))}
                      </Table>
                    )
                  ) : (
                    (revenue.recentWithdrawals || []).length === 0 ? <Empty icon={ICON.cash} title="No withdrawals made yet" /> : (
                      <Table heads={['When', 'Amount', 'To account', 'Bank', 'Initiated by', 'Reference', 'Status']}>
                        {revenue.recentWithdrawals.map((t: any) => (
                          <tr key={t.id} className="hover:bg-gray-50/80 transition-colors">
                            <td className={`${TD} text-[11px] text-gray-500 whitespace-nowrap`}>{dayjs(t.createdAt).format('MMM D, h:mm A')}</td>
                            <td className={`${TD} text-[12px] font-bold font-mono text-gray-900`}>₦{t.amount.toLocaleString()}</td>
                            <td className={`${TD} text-[11px] text-gray-600`}>{t.metadata?.accountName}<br /><span className="font-mono text-[10.5px] text-gray-400">{t.metadata?.accountNumber}</span></td>
                            <td className={`${TD} text-[11px] text-gray-500`}>{t.metadata?.bankName || '—'}</td>
                            <td className={`${TD} text-[11px] text-gray-500`}>{t.metadata?.initiatedByUsername ? `@${t.metadata.initiatedByUsername}` : '—'}</td>
                            <td className={`${TD} text-[11px] text-gray-400 font-mono truncate max-w-[140px]`}>{t.reference}</td>
                            <td className={TD}><Tag variant={wv(t.status)}>{t.status?.toLowerCase()}</Tag></td>
                          </tr>
                        ))}
                      </Table>
                    )
                  )}
                </div>

                <Notice tone="amber">Withdrawals require your account password and a live face photo, both recorded in the audit log against the transaction for compliance.</Notice>
              </>
            )}
          </div>
        )}

        {/* ── Platform Settings ── */}
        {tab === 'settings' && (
          <div className="max-w-2xl space-y-4">
            {settingsLoading ? <div className="space-y-3">{[...Array(4)].map((_, i) => <Skeleton key={i} className="h-16 rounded-2xl" />)}</div>
            : settings && (
              <>
                <div className={`${cardCls} p-5 sm:p-6 space-y-4`}>
                  <div>
                    <h3 className="text-[14px] font-bold text-gray-900">Automated report escalation thresholds</h3>
                    <p className="text-[11px] text-gray-400 mt-0.5">When a user or group reaches these report counts, the system automatically flags or escalates them.</p>
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                    {[
                      { key: 'reportFlagThreshold',         label: 'Flag threshold', desc: 'Reports → flag for review'        },
                      { key: 'reportHighPriorityThreshold', label: 'High priority',  desc: 'Reports → high priority'          },
                      { key: 'reportAutoEscalateThreshold', label: 'Auto-escalate',  desc: 'Reports → auto-escalate to Admin' },
                    ].map(f => (
                      <div key={f.key}>
                        <label className={labelCls}>{f.label}</label>
                        <input type="number" value={settings[f.key]} onChange={e => setSettings({ ...settings, [f.key]: +e.target.value })} className={`${fieldCls} h-10`} />
                        <p className="text-[10px] text-gray-400 mt-1">{f.desc}</p>
                      </div>
                    ))}
                  </div>
                </div>

                <div className={`${cardCls} p-5 sm:p-6 space-y-4`}>
                  <h3 className="text-[14px] font-bold text-gray-900">Financial controls</h3>
                  <div>
                    <label className={labelCls}>Platform fee (%)</label>
                    <input type="number" step="0.1" value={settings.platformFeePercent} onChange={e => setSettings({ ...settings, platformFeePercent: +e.target.value })} className={`${fieldCls} h-10 !w-32`} />
                  </div>
                </div>

                <div className={`${cardCls} p-5 sm:p-6`}>
                  <h3 className="text-[14px] font-bold text-gray-900 mb-2">Platform toggles</h3>
                  {[
                    { key: 'withdrawalsFrozen',   label: 'Freeze all withdrawals',   desc: 'Blocks all withdrawal attempts platform-wide' },
                    { key: 'contributionsFrozen', label: 'Freeze all contributions', desc: 'Blocks new contributions to any group'         },
                    { key: 'maintenanceMode',     label: 'Maintenance mode',          desc: 'Shows maintenance banner to all users'         },
                  ].map(toggle => (
                    <div key={toggle.key} className="flex items-center justify-between gap-3 py-3 border-b border-gray-50 last:border-0">
                      <div className="min-w-0"><p className="text-[12px] font-semibold text-gray-900">{toggle.label}</p><p className="text-[11px] text-gray-400">{toggle.desc}</p></div>
                      <button type="button" role="switch" aria-checked={!!settings[toggle.key]} onClick={() => setSettings({ ...settings, [toggle.key]: !settings[toggle.key] })}
                        className={`relative w-11 h-6 rounded-full transition-colors flex-shrink-0 ${settings[toggle.key] ? 'bg-red-500' : 'bg-gray-200'}`}>
                        <span className={`absolute top-1 w-4 h-4 bg-white rounded-full shadow-sm transition-all ${settings[toggle.key] ? 'left-6' : 'left-1'}`} />
                      </button>
                    </div>
                  ))}
                </div>

                {/* Schedule maintenance */}
                <div className={`${cardCls} p-5 sm:p-6 space-y-4`}>
                  <div className="flex items-center justify-between flex-wrap gap-2">
                    <h3 className="text-[14px] font-bold text-gray-900">Schedule maintenance</h3>
                    {settings.maintenanceScheduledAt && <Tag variant="warning">Scheduled for {dayjs(settings.maintenanceScheduledAt).format('MMM D, h:mm A')}</Tag>}
                  </div>
                  <p className="text-[11px] text-gray-400 leading-relaxed">
                    Announce an upcoming maintenance window ahead of time. Customers will see a countdown banner across the app, and maintenance mode will switch on automatically at the scheduled time. You don't need to come back and flip the toggle yourself.
                  </p>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <Field label="Start time" type="datetime-local" value={maintenanceScheduleAt} onChange={e => setMaintenanceScheduleAt(e.target.value)} />
                    <Field label="Announcement message" type="text" value={maintenanceAnnouncement} onChange={e => setMaintenanceAnnouncement(e.target.value)} placeholder="e.g. Upgrading our payment systems" />
                  </div>
                  <div className="flex gap-2 flex-wrap">
                    <button disabled={!maintenanceScheduleAt || schedulingMaintenance} onClick={handleScheduleMaintenance} className={btnPrimary}>{schedulingMaintenance ? 'Scheduling…' : 'Schedule maintenance'}</button>
                    {settings.maintenanceScheduledAt && (
                      <button disabled={cancelingSchedule} onClick={handleCancelSchedule} className={btnGhost}>{cancelingSchedule ? 'Cancelling…' : 'Cancel scheduled maintenance'}</button>
                    )}
                  </div>
                </div>

                <button disabled={saving} onClick={handleSaveSettings} className={`${btnPrimary} !h-10 !px-6`}>{saving ? 'Saving…' : 'Save all settings'}</button>
              </>
            )}
          </div>
        )}

        {/* ── Full Audit Log ── */}
        {tab === 'audit' && (
          <div className="space-y-4">
            <div className={cardCls}>
              <div className="px-5 sm:px-6 pt-5">
                <h3 className="text-[14px] font-bold text-gray-900">Full audit log</h3>
                <p className="text-[11px] text-gray-400 mt-0.5">Unfiltered platform audit trail. Every action by every role.</p>
              </div>
              <Toolbar>
                <SearchBox value={actionFilter} onChange={v => { setActionFilter(v); setLogsPage(1) }} placeholder="Filter by action (e.g. KYC, BAN, ROLE)…" />
                <div className="flex gap-1.5 flex-wrap items-center">
                  {['KYC', 'REVEALED', 'BAN', 'SUSPEND', 'ROLE', 'GROUP', 'REFUND', 'REVENUE'].map(q => (
                    <button key={q} onClick={() => { setActionFilter(q); setLogsPage(1) }}
                      className={`h-7 px-2.5 rounded-md text-[10px] font-semibold border transition-colors ${actionFilter === q ? 'bg-[#0B3D2A] text-white border-[#0B3D2A]' : 'border-gray-200 text-gray-500 hover:text-gray-900 hover:bg-gray-50'}`}>
                      {q}
                    </button>
                  ))}
                  {actionFilter && <button onClick={() => { setActionFilter(''); setLogsPage(1) }} className="h-7 px-2 text-[10px] font-semibold text-gray-400 hover:text-gray-900 transition-colors">Clear ×</button>}
                </div>
              </Toolbar>
              {logsLoading ? <Loading n={6} />
              : logs.length === 0 ? <Empty icon={ICON.list} title="No log entries found" />
              : (
                <Table heads={['When', 'Actor', 'Role', 'Action', 'Details', '']}>
                  {logs.map((log: any) => {
                    const isKyc = KYC_ACTIONS.includes(log.action)
                    return (
                      <tr key={log.id} onClick={() => setLogDetail(log)} className={`hover:bg-gray-50/80 transition-colors cursor-pointer ${isKyc ? 'bg-blue-50/20' : ''}`}>
                        <td className={`${TD} text-[11px] text-gray-500 whitespace-nowrap`}>{dayjs(log.createdAt).format('MMM D, h:mm A')}</td>
                        <td className={TD}>
                          <p className="text-[12px] font-semibold text-gray-900">{log.user?.username ? `@${log.user.username}` : 'System'}</p>
                          {log.user?.firstName && <p className="text-[10.5px] text-gray-400">{log.user.firstName} {log.user.lastName}</p>}
                        </td>
                        <td className={TD}><Tag variant={rv(log.user?.role || 'USER')}>{(log.user?.role || 'system').replace('_', ' ').toLowerCase()}</Tag></td>
                        <td className={TD}><span className={actionPill(log.action)}>{log.action?.replace(/_/g, ' ')}</span></td>
                        <td className={`${TD} max-w-[280px]`}>{renderAuditDetails(log)}</td>
                        <td className={TD}><button onClick={e => { e.stopPropagation(); setLogDetail(log) }} className={actGray}>Details</button></td>
                      </tr>
                    )
                  })}
                </Table>
              )}
              <PageBar pag={logsPag} page={logsPage} setPage={setLogsPage} />
            </div>
          </div>
        )}
      </div>
      </div>

      {/* ── Audit log detail modal ── */}
      <Modal open={!!logDetail} onClose={() => setLogDetail(null)} title="Audit log entry" size="md"
        footer={<div className="flex justify-end w-full"><button onClick={() => setLogDetail(null)} className={btnGhost}>Close</button></div>}>
        {logDetail && (() => {
          const meta = logDetail.metadata || {}
          const isKyc = KYC_ACTIONS.includes(logDetail.action)
          return (
            <div className="space-y-4">
              <div className="flex items-center gap-2 flex-wrap">
                <span className={actionPill(logDetail.action)}>{logDetail.action?.replace(/_/g, ' ')}</span>
                <Tag variant={rv(logDetail.user?.role || 'USER')}>{(logDetail.user?.role || 'system').replace('_', ' ').toLowerCase()}</Tag>
                {isKyc && <Tag variant="brand">KYC</Tag>}
              </div>

              <div className={`${rowCls} !p-4 space-y-2.5`}>
                {[
                  { label: 'Time',   val: dayjs(logDetail.createdAt).format('MMM D, YYYY h:mm:ss A') },
                  { label: 'Actor',  val: logDetail.user ? `@${logDetail.user.username} (${logDetail.user.firstName} ${logDetail.user.lastName})` : 'System' },
                  { label: 'Entity', val: `${logDetail.entityType || '—'}${logDetail.entityId ? ` · ${logDetail.entityId}` : ''}` },
                ].map(r => (
                  <div key={r.label} className="flex justify-between gap-4">
                    <span className="text-[11px] text-gray-400 flex-shrink-0">{r.label}</span>
                    <span className="text-[12px] font-medium text-gray-900 text-right break-all">{r.val}</span>
                  </div>
                ))}
              </div>

              {meta.facePhotoUrl && (
                <div className="text-center space-y-2">
                  <img src={meta.facePhotoUrl} className="w-32 h-32 rounded-2xl object-cover ring-4 ring-purple-200 mx-auto" alt="Admin face capture" />
                  <p className="text-[11px] text-purple-600 font-semibold">Admin's face at the moment of this action</p>
                </div>
              )}

              {isKyc && (
                <div className="bg-blue-50 border border-blue-100 rounded-xl p-4 space-y-2">
                  <p className="text-[9.5px] font-semibold text-blue-700 uppercase tracking-wider">KYC details</p>
                  {logDetail.targetUser && (
                    <div>
                      <p className="text-[12px] font-semibold text-gray-900">Target user: @{logDetail.targetUser.username}</p>
                      <p className="text-[11px] text-gray-400">{logDetail.targetUser.firstName} {logDetail.targetUser.lastName} · {logDetail.targetUser.email}</p>
                    </div>
                  )}
                  {logDetail.action === 'KYC_IDENTITY_REVEALED' && <p className="text-[12px] text-purple-700 font-semibold">Full NIN/BVN revealed by @{logDetail.user?.username}{logDetail.user?.email ? ` · ${logDetail.user.email}` : ''}</p>}
                  {logDetail.action === 'KYC_MANUALLY_APPROVED' && <p className="text-[12px] text-emerald-700 font-semibold">Approved by @{meta.approvedBy || logDetail.user?.username}{meta.approvedByEmail ? ` · ${meta.approvedByEmail}` : ''}</p>}
                  {logDetail.action === 'KYC_MANUALLY_REJECTED' && (
                    <div>
                      <p className="text-[12px] text-red-600 font-semibold">Rejected by @{meta.rejectedBy || logDetail.user?.username}{meta.rejectedByEmail ? ` · ${meta.rejectedByEmail}` : ''}</p>
                      {meta.reason && <p className="text-[12px] text-red-500 mt-1">Reason: {meta.reason}</p>}
                    </div>
                  )}
                  {logDetail.action === 'KYC_FACE_SUBMITTED' && <p className="text-[12px] text-blue-600">User submitted their KYC face scan</p>}
                  {logDetail.action === 'KYC_COMPLETED' && <p className="text-[12px] text-emerald-600">Auto-verified. NIN and BVN names matched.</p>}
                  {logDetail.action === 'KYC_MANUAL_REVIEW' && <p className="text-[12px] text-amber-600">Sent to manual review. Name or DOB mismatch between NIN and BVN.</p>}
                </div>
              )}

              {logDetail.action === 'COMPANY_REVENUE_WITHDRAWAL' && (
                <div className="bg-emerald-50 border border-emerald-100 rounded-xl p-4 space-y-1.5">
                  <p className="text-[9.5px] font-semibold text-emerald-700 uppercase tracking-wider">Withdrawal details</p>
                  <p className="text-[12px] font-semibold text-gray-900">₦{Number(meta.amount || 0).toLocaleString()} → {meta.accountName}</p>
                  <p className="text-[11px] text-gray-500">{meta.accountNumber} · {meta.bankName || '—'}</p>
                  <p className="text-[11px] text-gray-500">Withdrawn by @{meta.withdrawnBy} {meta.withdrawnByEmail ? `· ${meta.withdrawnByEmail}` : ''}</p>
                  <p className="text-[11px] text-emerald-700 font-semibold">Password verified</p>
                </div>
              )}

              {Object.keys(meta).length > 0 && (
                <div className={`${rowCls} !p-4`}>
                  <p className={labelCls}>Metadata</p>
                  <div className="space-y-1.5">
                    {Object.entries(meta).map(([k, v]) => (
                      k === 'facePhotoUrl' ? null : (
                        <div key={k} className="flex justify-between gap-4">
                          <span className="text-[11px] text-gray-400 capitalize">{k.replace(/([A-Z])/g, ' $1').trim()}</span>
                          <span className="text-[11px] font-medium text-gray-900 text-right break-all">{String(v)}</span>
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

      {/* ── CS ticket detail modal ── */}
      <Modal open={!!csTicketDetail} onClose={() => setCsTicketDetail(null)} title={csTicketDetail?.ticket?.subject || 'Ticket'} size="lg">
        {csTicketDetailLoading ? <div className="space-y-3">{[...Array(3)].map((_, i) => <Skeleton key={i} className="h-12 rounded-xl" />)}</div>
        : (
          <div className="space-y-4">
            <div className="flex items-center gap-2 flex-wrap">
              <Tag variant={pv(csTicketDetail?.ticket?.priority)}>{csTicketDetail?.ticket?.priority?.toLowerCase()}</Tag>
              <Tag variant={tsv(csTicketDetail?.ticket?.status)}>{csTicketDetail?.ticket?.status?.replace('_', ' ').toLowerCase()}</Tag>
              {csTicketDetail?.ticket?.escalatedAt && <Tag variant="danger">Escalated to Admin</Tag>}
              {csTicketDetail?.ticket?.assignedToId && <span className="text-[11px] text-gray-500">Assigned to @{csTicketDetail.ticket.assignedTo?.username || csTicketDetail.ticket.assignedToId?.slice(0, 8)}</span>}
            </div>
            {csTicketDetail?.user && (
              <div className={`${rowCls} !p-3.5`}>
                <p className={labelCls}>Filed by</p>
                <p className="text-[12px] font-medium text-gray-900">{csTicketDetail.user.firstName} · @{csTicketDetail.user.username} · {csTicketDetail.user.email}</p>
              </div>
            )}
            <div className="space-y-3 max-h-80 overflow-y-auto px-1">
              <p className={labelCls}>Conversation</p>
              {(csTicketDetail?.replies || []).length === 0 && <p className="text-[12px] text-gray-400 py-4 text-center">No replies yet</p>}
              {(csTicketDetail?.replies || []).map((r: any) => {
                const isCS = r.isAdminReply
                const senderName = isCS ? 'Support team' : `${csTicketDetail?.user?.firstName || ''} ${csTicketDetail?.user?.lastName || ''}`.trim() || 'User'
                const initials = senderName.split(' ').map((n: string) => n[0]).join('').slice(0, 2).toUpperCase()
                return (
                  <div key={r.id} className={`flex gap-2.5 ${isCS ? 'flex-row-reverse' : 'flex-row'}`}>
                    <div className={`w-8 h-8 rounded-full flex items-center justify-center text-[10px] font-bold flex-shrink-0 mt-0.5 ${isCS ? 'bg-[#0B3D2A] text-white' : 'bg-gray-100 text-gray-600'}`}>{initials}</div>
                    <div className={`max-w-[75%] ${isCS ? 'items-end' : 'items-start'} flex flex-col`}>
                      <p className="text-[10px] text-gray-400 mb-1.5">{senderName} · {dayjs(r.createdAt).format('MMM D, h:mm A')}</p>
                      <div className={`rounded-2xl px-4 py-2.5 text-[13px] leading-relaxed whitespace-pre-wrap ${isCS ? 'bg-[#0B3D2A] text-white rounded-tr-sm' : 'bg-gray-100 text-gray-800 rounded-tl-sm'}`}>{r.message}</div>
                    </div>
                  </div>
                )
              })}
            </div>
            {(csTicketDetail?.notes || []).length > 0 && (
              <div className="border-t border-gray-100 pt-4 space-y-2">
                <p className="text-[9.5px] font-semibold text-amber-600 uppercase tracking-wider">Internal notes</p>
                {csTicketDetail.notes.map((n: any) => (
                  <div key={n.id} className="bg-amber-50 border border-amber-100 rounded-xl p-3 text-[12px]">
                    <p className="text-[10px] text-amber-600 font-semibold mb-1">Staff note · {dayjs(n.createdAt).format('MMM D, h:mm A')}</p>
                    <p className="text-amber-900">{n.content}</p>
                  </div>
                ))}
              </div>
            )}
            <Notice tone="amber">Super Admin read-only view. To take action on this ticket, use the Admin panel.</Notice>
          </div>
        )}
      </Modal>

      {/* ── CS report detail modal ── */}
      <Modal open={!!csReportDetail} onClose={() => setCsReportDetail(null)} title={csReportDetail?.type || 'Report'} size="lg">
        {csReportDetailLoading ? <div className="space-y-3">{[...Array(3)].map((_, i) => <Skeleton key={i} className="h-12 rounded-xl" />)}</div>
        : (
          <div className="space-y-4">
            <div className="flex items-center gap-2 flex-wrap">
              <Tag variant={dsv(csReportDetail?.status)}>{csReportDetail?.status?.replace('_', ' ').toLowerCase()}</Tag>
              {csReportDetail?.groupId && <Tag>Group report</Tag>}
              {csReportDetail?.reportedUserId && <Tag>Member report</Tag>}
              {csReportDetail?.escalatedAt && <Tag variant="danger">Escalated</Tag>}
            </div>
            <div className={`${rowCls} !p-4 space-y-2`}>
              <p className="text-[13px] text-gray-800 leading-relaxed">{csReportDetail?.description}</p>
              {csReportDetail?.reporter && <p className="text-[11px] text-gray-400">Reported by @{csReportDetail.reporter?.username} · {dayjs(csReportDetail?.createdAt).format('MMM D, YYYY h:mm A')}</p>}
              {csReportDetail?.reportedUser && <p className="text-[11px] text-gray-400">Against @{csReportDetail.reportedUser?.username}</p>}
            </div>
            {csReportDetail?.resolution && (
              <div className="bg-emerald-50 border border-emerald-100 rounded-xl p-4">
                <p className="text-[9.5px] font-semibold text-emerald-700 uppercase tracking-wider mb-1">Resolution</p>
                <p className="text-[13px] text-emerald-900">{csReportDetail.resolution}</p>
                {csReportDetail.resolvedById && <p className="text-[11px] text-emerald-600 mt-1">Resolved by @{csReportDetail.resolvedBy?.username || csReportDetail.resolvedById?.slice(0, 8)}</p>}
              </div>
            )}
            {(csReportDetail?.notes || []).length > 0 && (
              <div className="space-y-2">
                <p className="text-[9.5px] font-semibold text-amber-600 uppercase tracking-wider">Internal notes from CS</p>
                {csReportDetail.notes.map((n: any) => (
                  <div key={n.id} className="bg-amber-50 border border-amber-100 rounded-xl p-3 text-[12px]">
                    <p className="text-[10px] text-amber-600 font-semibold mb-1">Staff note · {dayjs(n.createdAt).format('MMM D, h:mm A')}</p>
                    <p className="text-amber-900">{n.content}</p>
                  </div>
                ))}
              </div>
            )}
            <Notice tone="amber">Super Admin read-only view. To take enforcement action, use the Admin panel escalation queue.</Notice>
          </div>
        )}
      </Modal>

      {/* ── Permanent ban modal ── */}
      <Modal open={!!banModal} onClose={() => { setBanModal(null); setBanReason('') }} title={`Permanently ban ${banModal?.firstName}?`} size="sm"
        footer={
          <div className="flex gap-2 justify-end w-full">
            <button onClick={() => { setBanModal(null); setBanReason('') }} className={btnGhost}>Cancel</button>
            <button disabled={banLoading || !banReason.trim()} onClick={handleBan} className={btnDanger}>{banLoading ? 'Banning…' : 'Permanently ban'}</button>
          </div>
        }>
        <div className="space-y-4">
          <Notice tone="red" icon={ICON.alert} title="Super Admin action: permanent">This user will be permanently banned from AjoDaddy. Only you can reverse this.</Notice>
          <Field label="Reason" placeholder="e.g. Severe fraud, platform abuse" value={banReason} onChange={e => setBanReason(e.target.value)} />
        </div>
      </Modal>

      {/* ── Delete account modal ── */}
      <Modal open={!!deleteModal} onClose={() => { setDeleteModal(null); setDeleteReason('') }} title={`Delete ${deleteModal?.firstName}'s account?`} size="sm"
        footer={
          <div className="flex gap-2 justify-end w-full">
            <button onClick={() => { setDeleteModal(null); setDeleteReason('') }} className={btnGhost}>Cancel</button>
            <button disabled={deleteLoading || !deleteReason.trim()} onClick={handleDelete} className={btnDanger}>{deleteLoading ? 'Deleting…' : 'Delete account'}</button>
          </div>
        }>
        <div className="space-y-4">
          <Notice tone="red" icon={ICON.alert} title="Soft delete">Account is blocked and hidden but transaction history is preserved for compliance.</Notice>
          <Field label="Reason" placeholder="e.g. User requested permanent closure" value={deleteReason} onChange={e => setDeleteReason(e.target.value)} />
        </div>
      </Modal>

      {/* ── Withdraw company revenue modal ── */}
      <Modal open={withdrawModalOpen} onClose={closeWithdrawModal} title="Withdraw company revenue" size="md"
        footer={
          <div className="flex gap-2 justify-end w-full">
            <button onClick={closeWithdrawModal} className={btnGhost}>Cancel</button>
            <button disabled={withdrawLoading || !wdAmount || !wdBankCode || !wdAccountNumber || !wdAccountName || !wdPassword || !wdFacePhotoUrl} onClick={handleWithdrawRevenue} className={btnPrimary}>
              {withdrawLoading ? 'Processing…' : 'Confirm withdrawal'}
            </button>
          </div>
        }>
        <div className="space-y-4">
          <Notice tone="emerald" icon={ICON.cash}>
            Available balance: <span className="font-bold">₦{(revenue?.walletBalance || 0).toLocaleString()}</span>. This sends real funds out to a bank account. Password and a live face photo are required.
          </Notice>

          <Field label="Amount (₦)" type="number" min={500} value={wdAmount} onChange={e => setWdAmount(e.target.value)} placeholder="e.g. 50000" />

          <div>
            <label className={labelCls}>Bank</label>
            <div className="relative">
              <select value={wdBankCode}
                onChange={e => { const code = e.target.value; setWdBankCode(code); setWdBankName(banks.find(b => b.code === code)?.name || '') }}
                className={`${fieldCls} h-10 pr-8 appearance-none cursor-pointer`}>
                <option value="">Select bank…</option>
                {banks.map(b => <option key={b.code} value={b.code}>{b.name}</option>)}
              </select>
              <Svg d={ICON.down} className="absolute right-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-400 pointer-events-none" sw={2} />
            </div>
          </div>

          <div>
            <label className={labelCls}>Account number</label>
            <input type="text" inputMode="numeric" maxLength={10} value={wdAccountNumber}
              onChange={e => setWdAccountNumber(e.target.value.replace(/\D/g, ''))}
              placeholder="10-digit account number" className={`${fieldCls} h-10`} />
            {wdVerifying && <p className="text-[11px] text-gray-400 mt-1">Verifying account…</p>}
            {!wdVerifying && wdAccountName && <p className="text-[12px] text-emerald-600 font-semibold mt-1">✓ {wdAccountName}</p>}
          </div>

          <Field label="Your password" type="password" value={wdPassword} onChange={e => setWdPassword(e.target.value)} placeholder="Confirm with your account password" />

          <div>
            <label className={labelCls}>Face verification</label>
            {!wdFacePhotoUrl && !wdCameraOn && (
              <button type="button" onClick={startCamera} className={`${btnGhost} w-full inline-flex items-center justify-center gap-2`}><Svg d={ICON.camera} /> Start camera</button>
            )}
            {wdCameraOn && (
              <div className="space-y-2">
                <video ref={videoRef} className="w-full rounded-xl bg-black aspect-video object-cover" muted playsInline />
                <button type="button" onClick={captureFace} className={`${btnPrimary} w-full`}>Capture photo</button>
              </div>
            )}
            {wdFacePhotoUrl && (
              <div className="flex items-center gap-3">
                <img src={wdFacePhotoUrl} className="w-16 h-16 rounded-xl object-cover ring-2 ring-emerald-200" alt="Captured face" />
                <div className="flex-1">
                  <p className="text-[12px] text-emerald-600 font-semibold">Photo captured</p>
                  <button type="button" onClick={retakeFace} className="text-[11px] text-emerald-700 underline">Retake</button>
                </div>
              </div>
            )}
            <canvas ref={canvasRef} className="hidden" />
          </div>
        </div>
      </Modal>

      {/* ── Per-user audit trail modal ── */}
      <Modal open={!!auditUser} onClose={closeUserAudit} title={auditUser ? `${auditUser.firstName} ${auditUser.lastName} · Full audit` : 'Audit'} size="lg">
        {auditLoading ? (
          <div className="space-y-3">{[...Array(5)].map((_, i) => <Skeleton key={i} className="h-12 rounded-xl" />)}</div>
        ) : !auditData ? (
          <p className="text-[13px] text-gray-400 text-center py-8">No data</p>
        ) : (
          <div className="space-y-4">
            {/* User summary */}
            <div className={`${rowCls} !p-4 space-y-2`}>
              <div className="flex items-center gap-2 flex-wrap">
                <p className="text-[13px] font-semibold text-gray-900">@{auditData.user.username}</p>
                <Tag variant={rv(auditData.user.role)}>{auditData.user.role?.replace('_', ' ').toLowerCase()}</Tag>
                <Tag variant={sv(auditData.user.status)}>{auditData.user.status?.toLowerCase()}</Tag>
              </div>
              <p className="text-[11px] text-gray-400">{auditData.user.email} · {auditData.user.phone || 'no phone'} · Joined {dayjs(auditData.user.createdAt).format('MMM D, YYYY')}</p>
              <div className="grid grid-cols-3 gap-2 pt-2">
                {[
                  { l: 'Wallet',      v: `₦${auditData.user.walletBalance.toLocaleString()}` },
                  { l: 'Contributed', v: `₦${auditData.user.totalContributed.toLocaleString()}` },
                  { l: 'Reputation',  v: auditData.user.reputationScore || 100 },
                ].map(s => (
                  <div key={s.l} className="bg-white border border-gray-100 rounded-lg p-2.5 text-center">
                    <p className="text-[9px] text-gray-400 uppercase tracking-wider font-semibold">{s.l}</p>
                    <p className="text-[13px] font-bold text-gray-900">{s.v}</p>
                  </div>
                ))}
              </div>
              <div className="flex gap-2 flex-wrap pt-1">
                {auditData.user.isEmailVerified && <Tag variant="success">Email verified</Tag>}
                {auditData.user.isPhoneVerified && <Tag variant="success">Phone verified</Tag>}
                {auditData.user.hasTransactionPin && <Tag>PIN set</Tag>}
                {auditData.identityRecord && <Tag variant={auditData.identityRecord.status === 'VERIFIED' ? 'success' : 'warning'}>KYC {auditData.identityRecord.status?.toLowerCase()}</Tag>}
              </div>
            </div>

            <PillTabs items={AUDIT_SECTIONS.map(s => ({ id: s.id, label: `${s.label} (${s.count(auditData)})` }))} value={auditSection} onChange={setAuditSection} />

            <div className="max-h-96 overflow-y-auto space-y-2 px-0.5">
              {auditSection === 'transactions' && (
                auditData.transactions.length === 0 ? <p className="text-[12px] text-gray-400 text-center py-6">No transactions</p> :
                auditData.transactions.map((t: any) => (
                  <div key={t.id} className={`${rowCls} flex items-center justify-between gap-2`}>
                    <div className="min-w-0">
                      <p className="text-[12px] font-semibold text-gray-900">{t.type?.replace('_', ' ')}</p>
                      <p className="text-[10.5px] text-gray-400 font-mono">{dayjs(t.createdAt).format('MMM D, h:mm A')} · {t.reference}</p>
                    </div>
                    <div className="text-right flex-shrink-0 space-y-1">
                      <p className="text-[12px] font-bold font-mono text-gray-900">₦{t.amount.toLocaleString()}</p>
                      <Tag variant={tv(t.status)}>{t.status?.toLowerCase()}</Tag>
                    </div>
                  </div>
                ))
              )}
              {auditSection === 'contributions' && (
                auditData.contributions.length === 0 ? <p className="text-[12px] text-gray-400 text-center py-6">No contributions</p> :
                auditData.contributions.map((c: any) => (
                  <div key={c.id} className={`${rowCls} flex items-center justify-between gap-2`}>
                    <div className="min-w-0">
                      <p className="text-[12px] font-semibold text-gray-900">{c.group?.name || 'Group'}</p>
                      <p className="text-[10.5px] text-gray-400 font-mono">{dayjs(c.createdAt).format('MMM D, h:mm A')}</p>
                    </div>
                    <p className="text-[12px] font-bold font-mono text-gray-900 flex-shrink-0">₦{c.amount.toLocaleString()}</p>
                  </div>
                ))
              )}
              {auditSection === 'groups' && (
                <>
                  {auditData.ownedGroups?.length > 0 && (
                    <div className="mb-2">
                      <SubTitle>Owns</SubTitle>
                      {auditData.ownedGroups.map((g: any) => (
                        <div key={g.id} className={`${rowCls} flex items-center justify-between gap-2 mb-1.5`}>
                          <p className="text-[12px] font-semibold text-gray-900">{g.name}</p>
                          <Tag variant={g.status === 'ACTIVE' ? 'success' : 'neutral'}>{g.status?.toLowerCase()}</Tag>
                        </div>
                      ))}
                    </div>
                  )}
                  {auditData.memberships?.length > 0 ? (
                    <div>
                      <SubTitle>Member of</SubTitle>
                      {auditData.memberships.map((m: any) => (
                        <div key={m.id} className={`${rowCls} flex items-center justify-between gap-2 mb-1.5`}>
                          <p className="text-[12px] font-semibold text-gray-900">{m.group?.name || 'Group'}</p>
                          <Tag>{m.status?.toLowerCase()}</Tag>
                        </div>
                      ))}
                    </div>
                  ) : (!auditData.ownedGroups || auditData.ownedGroups.length === 0) && (
                    <p className="text-[12px] text-gray-400 text-center py-6">No group activity</p>
                  )}
                </>
              )}
              {auditSection === 'actions' && (
                <>
                  {auditData.auditAsTarget?.length > 0 && (
                    <div className="mb-2">
                      <SubTitle>Actions taken on this user</SubTitle>
                      {auditData.auditAsTarget.map((a: any) => (
                        <div key={a.id} className={`${rowCls} mb-1.5`}>
                          <span className={actionPill(a.action)}>{a.action?.replace(/_/g, ' ')}</span>
                          <p className="text-[10.5px] text-gray-400 font-mono mt-1">{dayjs(a.createdAt).format('MMM D, h:mm A')}</p>
                        </div>
                      ))}
                    </div>
                  )}
                  {auditData.auditAsActor?.length > 0 ? (
                    <div>
                      <SubTitle>Actions this user performed (if staff)</SubTitle>
                      {auditData.auditAsActor.map((a: any) => (
                        <div key={a.id} className={`${rowCls} mb-1.5`}>
                          <span className={actionPill(a.action)}>{a.action?.replace(/_/g, ' ')}</span>
                          <p className="text-[10.5px] text-gray-400 font-mono mt-1">{dayjs(a.createdAt).format('MMM D, h:mm A')}</p>
                        </div>
                      ))}
                    </div>
                  ) : (!auditData.auditAsTarget || auditData.auditAsTarget.length === 0) && (
                    <p className="text-[12px] text-gray-400 text-center py-6">No admin actions on record</p>
                  )}
                </>
              )}
              {auditSection === 'flags' && (
                auditData.fraudFlags.length === 0 ? <p className="text-[12px] text-gray-400 text-center py-6">No fraud flags</p> :
                auditData.fraudFlags.map((f: any) => (
                  <div key={f.id} className="bg-red-50 border border-red-100 rounded-lg p-3">
                    <div className="flex items-center justify-between gap-2">
                      <p className="text-[12px] font-semibold text-red-700">{f.type}</p>
                      <Tag variant={f.resolved ? 'success' : 'danger'}>{f.resolved ? 'resolved' : f.severity?.toLowerCase()}</Tag>
                    </div>
                    <p className="text-[11px] text-red-600 mt-1">{f.description}</p>
                    <p className="text-[10.5px] text-gray-400 font-mono mt-1">{dayjs(f.createdAt).format('MMM D, h:mm A')}</p>
                  </div>
                ))
              )}
              {auditSection === 'disputes' && (
                <>
                  {auditData.disputesAgainst?.length > 0 && (
                    <div className="mb-2">
                      <SubTitle>Reported against this user</SubTitle>
                      {auditData.disputesAgainst.map((d: any) => (
                        <div key={d.id} className={`${rowCls} mb-1.5`}>
                          <div className="flex items-center justify-between gap-2">
                            <p className="text-[12px] font-semibold text-gray-900">{d.type}</p>
                            <Tag variant={dsv(d.status)}>{d.status?.replace('_', ' ').toLowerCase()}</Tag>
                          </div>
                          <p className="text-[11px] text-gray-500 mt-1">{d.description}</p>
                        </div>
                      ))}
                    </div>
                  )}
                  {auditData.disputesFiled?.length > 0 ? (
                    <div>
                      <SubTitle>Filed by this user</SubTitle>
                      {auditData.disputesFiled.map((d: any) => (
                        <div key={d.id} className={`${rowCls} mb-1.5`}>
                          <div className="flex items-center justify-between gap-2">
                            <p className="text-[12px] font-semibold text-gray-900">{d.type}</p>
                            <Tag variant={dsv(d.status)}>{d.status?.replace('_', ' ').toLowerCase()}</Tag>
                          </div>
                          <p className="text-[11px] text-gray-500 mt-1">{d.description}</p>
                        </div>
                      ))}
                    </div>
                  ) : (!auditData.disputesAgainst || auditData.disputesAgainst.length === 0) && (
                    <p className="text-[12px] text-gray-400 text-center py-6">No disputes</p>
                  )}
                </>
              )}
              {auditSection === 'tickets' && (
                auditData.supportTickets.length === 0 ? <p className="text-[12px] text-gray-400 text-center py-6">No support tickets</p> :
                auditData.supportTickets.map((t: any) => (
                  <div key={t.id} className={rowCls}>
                    <div className="flex items-center justify-between gap-2">
                      <p className="text-[12px] font-semibold text-gray-900">{t.subject}</p>
                      <Tag variant={tsv(t.status)}>{t.status?.replace('_', ' ').toLowerCase()}</Tag>
                    </div>
                    <p className="text-[10.5px] text-gray-400 font-mono mt-1">{dayjs(t.createdAt).format('MMM D, h:mm A')}</p>
                  </div>
                ))
              )}
              {auditSection === 'logins' && (
                auditData.loginAttempts.length === 0 ? <p className="text-[12px] text-gray-400 text-center py-6">No login attempts recorded</p> :
                auditData.loginAttempts.map((l: any) => (
                  <div key={l.id} className={`${rowCls} flex items-center justify-between gap-2`}>
                    <div className="min-w-0">
                      <p className="text-[11px] text-gray-600 font-mono">{l.ipAddress || '—'}</p>
                      <p className="text-[10.5px] text-gray-400 font-mono">{dayjs(l.createdAt).format('MMM D, h:mm A')}{l.reason ? ` · ${l.reason}` : ''}</p>
                    </div>
                    <Tag variant={l.success ? 'success' : 'danger'}>{l.success ? 'success' : 'failed'}</Tag>
                  </div>
                ))
              )}
            </div>
          </div>
        )}
      </Modal>
    </DashboardLayout>
  )
}