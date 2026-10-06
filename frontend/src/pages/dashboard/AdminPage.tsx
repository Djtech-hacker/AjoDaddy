import { useState, useRef, useEffect } from 'react'
import DashboardLayout from '@/components/layout/DashboardLayout'
import { Skeleton, Modal } from '@/components/ui'
import { useAdminDashboard, useAdminUsers, useSuspendUser } from '@/hooks/useApi'
import { adminApi } from '@/api/services'
import { useUIStore } from '@/stores/uiStore'
import { useAuthStore } from '@/stores/authStore'
import LivenessCapture from '@/components/LivenessCapture'
import dayjs from 'dayjs'
import relativeTime from 'dayjs/plugin/relativeTime'
dayjs.extend(relativeTime)

type AdminTab = 'escalations' | 'users' | 'transactions' | 'groups' | 'contributions' | 'fraud' | 'payouts' | 'audit' | 'kyc'

/* ───────────── design tokens (shared look with SupportPage) ───────────── */
const fieldCls = 'w-full border border-gray-200 rounded-lg px-3 text-[12px] text-gray-900 bg-gray-50 outline-none focus:border-emerald-500 focus:bg-white focus:ring-2 focus:ring-emerald-500/10 transition-all'
const labelCls = 'block text-[9.5px] font-semibold text-gray-400 uppercase tracking-wider mb-1.5'
const btnPrimary = 'h-9 px-4 rounded-lg bg-[#0B3D2A] text-white text-[12px] font-semibold hover:bg-[#0F5138] disabled:opacity-40 disabled:cursor-not-allowed transition-colors'
const btnGhost   = 'h-9 px-4 rounded-lg border border-gray-200 text-gray-700 text-[12px] font-semibold hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed transition-colors'
const btnDanger  = 'h-9 px-4 rounded-lg bg-red-500 text-white text-[12px] font-semibold hover:bg-red-600 disabled:opacity-40 disabled:cursor-not-allowed transition-colors'
const act = 'h-7 px-2.5 rounded-md border text-[11px] font-semibold whitespace-nowrap disabled:opacity-50 transition-colors'
const actGray   = `${act} border-gray-200 text-gray-700 bg-white hover:bg-gray-50`
const actAmber  = `${act} border-amber-200 text-amber-700 bg-amber-50 hover:bg-amber-100`
const actRed    = `${act} border-red-200 text-red-600 bg-red-50 hover:bg-red-100`
const actGreen  = `${act} border-emerald-200 text-emerald-700 bg-emerald-50 hover:bg-emerald-100`
const actPurple = `${act} border-purple-200 text-purple-700 bg-purple-50 hover:bg-purple-100`
const TH = 'px-5 py-2.5 text-left text-[9.5px] font-semibold text-gray-400 uppercase tracking-wider whitespace-nowrap'
const TD = 'px-5 py-3'

const HERO_PATTERN =
  "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='420' height='220' viewBox='0 0 420 220'%3E%3Cpath d='M-20 130 C60 40 150 210 230 120 S370 70 440 140' fill='none' stroke='%23C9A227' stroke-opacity='.28' stroke-width='1.5'/%3E%3Cpath d='M-20 175 C80 90 160 230 250 150 S370 110 440 185' fill='none' stroke='%23C9A227' stroke-opacity='.18' stroke-width='1.5'/%3E%3C/svg%3E\")"

const ICON = {
  search:  'M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z',
  chevR:   'M9 5l7 7-7 7',
  chevL:   'M15 19l-7-7 7-7',
  down:    'M19 9l-7 7-7-7',
  alert:   'M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z',
  check:   'M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z',
  x:       'M6 18L18 6M6 6l12 12',
  clock:   'M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z',
  clip:    'M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2',
  id:      'M10 6H5a2 2 0 00-2 2v9a2 2 0 002 2h14a2 2 0 002-2V8a2 2 0 00-2-2h-5m-4 0V5a2 2 0 114 0v1m-4 0a2 2 0 104 0m-5 8a2 2 0 100-4 2 2 0 000 4zm0 0c1.306 0 2.417.835 2.83 2M9 14a3.001 3.001 0 00-2.83 2M15 11h3m-3 4h2',
  lock:    'M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z',
  camera:  'M3 9a2 2 0 012-2h.93a2 2 0 001.664-.89l.812-1.22A2 2 0 0110.07 4h3.86a2 2 0 011.664.89l.812 1.22A2 2 0 0018.07 7H19a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V9zM15 13a3 3 0 11-6 0 3 3 0 016 0z',
  attach:  'M15.172 7l-6.586 6.586a2 2 0 102.828 2.828l6.414-6.586a4 4 0 00-5.656-5.656l-6.415 6.585a6 6 0 108.486 8.486L20.5 13',
  cash:    'M17 9V7a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2m2 4h10a2 2 0 002-2v-6a2 2 0 00-2-2H9a2 2 0 00-2 2v6a2 2 0 002 2zm7-5a2 2 0 11-4 0 2 2 0 014 0z',
}

const Svg = ({ d, className = 'w-4 h-4', sw = 1.8 }: { d: string; className?: string; sw?: number }) => (
  <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden>
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={sw} d={d} />
  </svg>
)

/* ───────────── small shared components ───────────── */
function StatusBadge({ status }: { status: string }) {
  const cfg: any = {
    ACTIVE:               { label: 'Active',               cls: 'bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200' },
    VERIFIED:             { label: 'Verified',             cls: 'bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200' },
    SUSPENDED:            { label: 'Suspended',            cls: 'bg-amber-50 text-amber-700 ring-1 ring-amber-200' },
    BANNED:               { label: 'Banned',               cls: 'bg-red-50 text-red-600 ring-1 ring-red-200' },
    REJECTED:             { label: 'Rejected',             cls: 'bg-red-50 text-red-600 ring-1 ring-red-200' },
    MANUAL_REVIEW:        { label: 'Manual Review',        cls: 'bg-orange-50 text-orange-600 ring-1 ring-orange-200' },
    PENDING_VERIFICATION: { label: 'Pending Verification', cls: 'bg-orange-50 text-orange-600 ring-1 ring-orange-200' },
    COMPLETED:            { label: 'Completed',            cls: 'bg-blue-50 text-blue-700 ring-1 ring-blue-200' },
    FAILED:               { label: 'Failed',               cls: 'bg-red-50 text-red-600 ring-1 ring-red-200' },
    PENDING:              { label: 'Pending',              cls: 'bg-amber-50 text-amber-700 ring-1 ring-amber-200' },
    REVERSED:             { label: 'Reversed',             cls: 'bg-red-50 text-red-600 ring-1 ring-red-200' },
    PAUSED:               { label: 'Paused',               cls: 'bg-amber-50 text-amber-700 ring-1 ring-amber-200' },
    CANCELLED:            { label: 'Cancelled',            cls: 'bg-red-50 text-red-600 ring-1 ring-red-200' },
    CRITICAL:             { label: 'Critical',             cls: 'bg-red-50 text-red-600 ring-1 ring-red-200' },
    HIGH:                 { label: 'High',                 cls: 'bg-orange-50 text-orange-600 ring-1 ring-orange-200' },
    MEDIUM:               { label: 'Medium',               cls: 'bg-amber-50 text-amber-700 ring-1 ring-amber-200' },
    LOW:                  { label: 'Low',                  cls: 'bg-gray-100 text-gray-500 ring-1 ring-gray-200' },
    OPEN:                 { label: 'Open',                 cls: 'bg-blue-50 text-blue-700 ring-1 ring-blue-200' },
    IN_PROGRESS:          { label: 'In Progress',          cls: 'bg-amber-50 text-amber-700 ring-1 ring-amber-200' },
    RESOLVED:             { label: 'Resolved',             cls: 'bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200' },
    CLOSED:               { label: 'Closed',               cls: 'bg-gray-100 text-gray-500 ring-1 ring-gray-200' },
  }
  const c = cfg[status] || { label: status, cls: 'bg-gray-100 text-gray-500' }
  return (
    <span className={`inline-flex items-center rounded-md px-2 py-0.5 text-[9px] font-bold uppercase tracking-wide whitespace-nowrap ${c.cls}`}>
      {c.label}
    </span>
  )
}

function RoleBadge({ role }: { role: string }) {
  const cfg: any = {
    SUPER_ADMIN:      { label: 'Super Admin',      cls: 'bg-purple-50 text-purple-700 ring-1 ring-purple-200' },
    ADMIN:            { label: 'Admin',            cls: 'bg-blue-50 text-blue-700 ring-1 ring-blue-200' },
    CUSTOMER_SERVICE: { label: 'Customer Service', cls: 'bg-teal-50 text-teal-700 ring-1 ring-teal-200' },
    USER:             { label: 'User',             cls: 'bg-gray-50 text-gray-500 ring-1 ring-gray-200' },
  }
  const c = cfg[role] || { label: role, cls: 'bg-gray-50 text-gray-500 ring-1 ring-gray-200' }
  return <span className={`inline-flex items-center px-1.5 py-0.5 rounded-md text-[9px] font-bold uppercase tracking-wide ${c.cls}`}>{c.label}</span>
}

function UserAvatar({ firstName, lastName, avatarUrl }: { firstName?: string; lastName?: string; avatarUrl?: string }) {
  const initials = ((firstName?.[0] || '') + (lastName?.[0] || '')).toUpperCase() || '?'
  const colors = ['bg-emerald-500', 'bg-blue-500', 'bg-violet-500', 'bg-amber-500', 'bg-pink-500', 'bg-teal-500']
  const color = colors[(firstName?.charCodeAt(0) || 0) % colors.length]
  if (avatarUrl) return <img src={avatarUrl} alt={initials} className="w-9 h-9 rounded-full object-cover flex-shrink-0" />
  return (
    <div className={`w-9 h-9 ${color} rounded-full flex items-center justify-center text-white text-[12px] font-bold flex-shrink-0`}>{initials}</div>
  )
}

const TONES: any = {
  orange: { box: 'bg-orange-50 border-orange-100', icon: 'bg-orange-100 text-orange-600', title: 'text-orange-800', text: 'text-orange-600' },
  blue:   { box: 'bg-blue-50 border-blue-100',     icon: 'bg-blue-100 text-blue-600',     title: 'text-blue-800',   text: 'text-blue-600' },
  amber:  { box: 'bg-amber-50 border-amber-100',   icon: 'bg-amber-100 text-amber-600',   title: 'text-amber-800',  text: 'text-amber-700' },
  red:    { box: 'bg-red-50 border-red-100',       icon: 'bg-red-100 text-red-600',       title: 'text-red-700',    text: 'text-red-600' },
  purple: { box: 'bg-purple-50 border-purple-100', icon: 'bg-purple-100 text-purple-600', title: 'text-purple-800', text: 'text-purple-600' },
}
function Notice({ tone, icon, title, children }: { tone: string; icon?: string; title?: string; children?: React.ReactNode }) {
  const t = TONES[tone]
  return (
    <div className={`${t.box} border rounded-xl px-4 py-3 flex items-start gap-3`}>
      {icon && <span className={`w-8 h-8 rounded-lg ${t.icon} flex items-center justify-center flex-shrink-0`}><Svg d={icon} /></span>}
      <div className="min-w-0">
        {title && <p className={`text-[12px] font-semibold ${t.title}`}>{title}</p>}
        {children && <p className={`text-[11px] ${t.text} ${title ? 'mt-0.5' : ''} leading-relaxed`}>{children}</p>}
      </div>
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

function Sel({ value, onChange, options, className = 'w-44' }: { value: string; onChange: (v: string) => void; options: string[][]; className?: string }) {
  return (
    <div className={`relative ${className}`}>
      <select value={value} onChange={e => onChange(e.target.value)} className={`${fieldCls} h-10 pr-8 appearance-none cursor-pointer font-medium`}>
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

function Paginator({ pag, page, setPage }: { pag: any; page: number; setPage: React.Dispatch<React.SetStateAction<number>> }) {
  if (!pag || pag.totalPages <= 1) return null
  const total = pag.totalPages
  const pgBtn = (p: number) => `w-8 h-8 rounded-lg text-[11px] font-semibold transition-colors ${page === p ? 'bg-[#0B3D2A] text-white' : 'border border-gray-200 text-gray-500 hover:bg-gray-50'}`
  return (
    <div className="flex items-center justify-between px-5 py-3 border-t border-gray-50 flex-wrap gap-3">
      <p className="text-[11px] text-gray-400">{((page - 1) * (pag.limit || 20)) + 1}–{Math.min(page * (pag.limit || 20), pag.total)} of {pag.total}</p>
      <div className="flex items-center gap-1">
        <button disabled={page === 1} onClick={() => setPage(p => p - 1)} className="w-8 h-8 rounded-lg border border-gray-200 flex items-center justify-center text-gray-500 hover:bg-gray-50 disabled:opacity-40 transition-colors">
          <Svg d={ICON.chevL} sw={2} />
        </button>
        {Array.from({ length: Math.min(total, 5) }, (_, i) => i + 1).map(p => (
          <button key={p} onClick={() => setPage(() => p)} className={pgBtn(p)}>{p}</button>
        ))}
        {total > 5 && <><span className="text-gray-400 text-[11px] px-1">…</span><button onClick={() => setPage(() => total)} className={pgBtn(total)}>{total}</button></>}
        <button disabled={page >= total} onClick={() => setPage(p => p + 1)} className="w-8 h-8 rounded-lg border border-gray-200 flex items-center justify-center text-gray-500 hover:bg-gray-50 disabled:opacity-40 transition-colors">
          <Svg d={ICON.chevR} sw={2} />
        </button>
      </div>
    </div>
  )
}

const Toolbar = ({ children }: { children: React.ReactNode }) => (
  <div className="flex items-center gap-3 flex-wrap px-5 sm:px-6 pb-4">{children}</div>
)

/* ───────────── page ───────────── */
export default function AdminPage() {
  const [tab, setTab] = useState<AdminTab>('escalations')
  const { showToast } = useUIStore()
  const { user: currentUser } = useAuthStore()

  // Webcam refs
  const videoRef  = useRef<HTMLVideoElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const streamRef = useRef<MediaStream | null>(null)

  // Escalation
  const [queue, setQueue]             = useState<any>(null)
  const [queueLoading, setQL]         = useState(false)
  const [queueDetail, setQueueDetail] = useState<any>(null)
  const [resolveStatus, setRS]        = useState('RESOLVED')
  const [resolution, setResolution]   = useState('')
  const [resolveLoading, setResL]     = useState(false)

  // Escalation — ticket message thread (reply-to-CS/user flow)
  const [ticketThread, setTicketThread]     = useState<any>(null)
  const [ticketThreadLoading, setTTL]       = useState(false)
  const [ticketReplyMsg, setTicketReplyMsg] = useState('')
  const [ticketReplySending, setTRS]        = useState(false)
  const [ticketStatusUpdating, setTSU]      = useState(false)
  const [ticketNotes, setTicketNotes]       = useState<any[]>([])
  const [noteFile, setNoteFile]             = useState<File | null>(null)
  const [noteUploading, setNoteUploading]   = useState(false)

  // Users
  const [search, setSearch]               = useState('')
  const [roleFilter, setRoleFilter]       = useState('')
  const [statusFilterU, setStatusFilterU] = useState('')
  const [suspendModal, setSuspendModal]   = useState<any>(null)
  const [suspendReason, setSuspendReason] = useState('')
  const [banModal, setBanModal]           = useState<any>(null)
  const [banReason, setBanReason]         = useState('')
  const [banLoading, setBanLoading]       = useState(false)
  const [unbanLoadingId, setUnbanLoadingId] = useState<string | null>(null)

  // Transactions
  const [transactions, setTransactions] = useState<any[]>([])
  const [txLoading, setTxLoading]       = useState(false)
  const [txStatus, setTxStatus]         = useState('')
  const [txType, setTxType]             = useState('')
  const [txSearch, setTxSearch]         = useState('')
  const [txPage, setTxPage]             = useState(1)
  const [txPag, setTxPag]               = useState<any>(null)
  const [txDetail, setTxDetail]         = useState<any>(null)

  // Groups
  const [groups, setGroups]               = useState<any[]>([])
  const [groupsLoading, setGroupsLoading] = useState(false)
  const [groupStatusFilter, setGSF]       = useState('')
  const [groupPage, setGroupPage]         = useState(1)
  const [groupPag, setGroupPag]           = useState<any>(null)
  const [freezeModal, setFreezeModal]     = useState<any>(null)
  const [freezeReason, setFreezeReason]   = useState('')
  const [freezeLoading, setFreezeLoading] = useState(false)
  const [unfreezeLoadingId, setUnfreezeLoadingId] = useState<string | null>(null)
  const [closeModal, setCloseModal]       = useState<any>(null)
  const [closeReason, setCloseReason]     = useState('')
  const [closeLoading, setCloseLoading]   = useState(false)

  // Contributions
  const [contributions, setContributions]   = useState<any[]>([])
  const [contribLoading, setContribLoading] = useState(false)
  const [contribStatus, setContribStatus]   = useState('FAILED')
  const [contribPage, setContribPage]       = useState(1)
  const [contribPag, setContribPag]         = useState<any>(null)

  // Fraud
  const [fraudFlags, setFraudFlags]     = useState<any[]>([])
  const [fraudLoading, setFraudLoading] = useState(false)
  const [resolvingId, setResolvingId]   = useState<string | null>(null)

  // Audit
  const [auditLogs, setAuditLogs]       = useState<any[]>([])
  const [auditLoading, setAuditLoading] = useState(false)
  const [auditPage, setAuditPage]       = useState(1)
  const [auditPag, setAuditPag]         = useState<any>(null)

  // KYC
  const [kycRecords, setKycRecords]             = useState<any[]>([])
  const [kycLoading, setKycLoading]             = useState(false)
  const [kycRejectModal, setKycRejectModal]     = useState<any>(null)
  const [kycRejectReason, setKycRejectReason]   = useState('')
  const [kycActionLoading, setKycActionLoading] = useState<string | null>(null)
  const [kycStatusFilter, setKycStatusFilter]   = useState('MANUAL_REVIEW')

  // NIN/BVN Reveal — password + face capture
  const [revealModal, setRevealModal]       = useState<any>(null)
  const [revealStep, setRevealStep]         = useState<'password' | 'camera' | 'revealed'>('password')
  const [revealPassword, setRevealPassword] = useState('')
  const [revealLoading, setRevealLoading]   = useState(false)
  const [revealData, setRevealData]         = useState<any>(null)
  const [revealFaceUrl, setRevealFaceUrl]   = useState<string | null>(null)
  const [countdown, setCountdown]           = useState<number | null>(null)
  const [cameraError, setCameraError]       = useState('')

  // KYC approve/reject — face capture flow
  const [pendingKycAction, setPendingKycAction] = useState<{ record: any; action: 'approve' | 'reject'; reason?: string } | null>(null)
  const [actionCountdown, setActionCountdown]   = useState<number | null>(null)
  const [actionLoading, setActionLoading]       = useState(false)
  const [actionCamError, setActionCamError]     = useState('')

  const { data: dashboard } = useAdminDashboard()
  const { data: usersData, refetch: refetchUsers } = useAdminUsers({ search: search || undefined })
  const suspendUser  = useSuspendUser()
  const users        = (usersData as any)?.users || []
  const dash         = dashboard as any
  const isSuperAdmin = currentUser?.role === 'SUPER_ADMIN'

  const filteredUsers = users.filter((u: any) => {
    if (roleFilter    && u.role   !== roleFilter)    return false
    if (statusFilterU && u.status !== statusFilterU) return false
    return true
  })
  const filteredTx = transactions.filter(tx => {
    if (!txSearch) return true
    const q = txSearch.toLowerCase()
    return tx.user?.username?.toLowerCase().includes(q) || tx.user?.email?.toLowerCase().includes(q) || tx.reference?.toLowerCase().includes(q)
  })

  const loadQueue         = async () => { setQL(true); try { const r = await adminApi.getEscalationQueue(); setQueue((r.data as any)?.data || r.data) } catch { showToast('Could not load queue', 'error') } finally { setQL(false) } }
  const loadTransactions  = async () => { setTxLoading(true); try { const r = await adminApi.getTransactions({ page: txPage, limit: 20, status: txStatus || undefined, type: txType || undefined }); const d = (r.data as any)?.data || r.data; setTransactions(d?.transactions || []); setTxPag(d?.pagination) } catch { showToast('Could not load transactions', 'error') } finally { setTxLoading(false) } }
  const loadGroups        = async () => { setGroupsLoading(true); try { const r = await adminApi.getGroups({ page: groupPage, limit: 20, status: groupStatusFilter || undefined }); const d = (r.data as any)?.data || r.data; setGroups(d?.groups || []); setGroupPag(d?.pagination) } catch { showToast('Could not load groups', 'error') } finally { setGroupsLoading(false) } }
  const loadContributions = async () => { setContribLoading(true); try { const r = await adminApi.getTransactions({ page: contribPage, limit: 30, type: 'CONTRIBUTION', status: contribStatus || undefined }); const d = (r.data as any)?.data || r.data; setContributions(d?.transactions || []); setContribPag(d?.pagination) } catch { showToast('Could not load contributions', 'error') } finally { setContribLoading(false) } }
  const loadFraud         = async () => { setFraudLoading(true); try { const r = await adminApi.getFraudFlags({ resolved: false, limit: 50 }); const d = (r.data as any)?.data || r.data; setFraudFlags(d?.flags || []) } catch { showToast('Could not load fraud flags', 'error') } finally { setFraudLoading(false) } }
  const loadAudit         = async () => { setAuditLoading(true); try { const r = await adminApi.getAuditLogs({ page: auditPage, limit: 30 }); const d = (r.data as any)?.data || r.data; setAuditLogs(d?.logs || []); setAuditPag(d?.pagination) } catch { showToast('Could not load audit logs', 'error') } finally { setAuditLoading(false) } }
  const loadKyc           = async () => { setKycLoading(true); try { const r = await adminApi.getPendingKyc(kycStatusFilter || undefined); const d = (r.data as any)?.data || r.data; setKycRecords(Array.isArray(d) ? d : []) } catch { showToast('Could not load KYC records', 'error') } finally { setKycLoading(false) } }

  useEffect(() => { if (tab === 'escalations')   loadQueue()         }, [tab])
  useEffect(() => { if (tab === 'transactions')  loadTransactions()  }, [tab, txPage, txStatus, txType])
  useEffect(() => { if (tab === 'groups')        loadGroups()        }, [tab, groupPage, groupStatusFilter])
  useEffect(() => { if (tab === 'contributions') loadContributions() }, [tab, contribPage, contribStatus])
  useEffect(() => { if (tab === 'fraud')         loadFraud()         }, [tab])
  useEffect(() => { if (tab === 'audit')         loadAudit()         }, [tab, auditPage])
  useEffect(() => { if (tab === 'kyc')           loadKyc()           }, [tab, kycStatusFilter])

  // Load the full message thread whenever a ticket-type escalation is opened
  useEffect(() => {
    if (queueDetail?._kind === 'ticket') {
      setTTL(true)
      Promise.all([
        adminApi.getTicketDetail(queueDetail.id),
        adminApi.getTicketNotes(queueDetail.id),
      ]).then(([detailRes, notesRes]) => {
        setTicketThread((detailRes.data as any)?.data || detailRes.data)
        setTicketNotes((notesRes.data as any)?.data || notesRes.data || [])
      }).catch(() => showToast('Could not load ticket', 'error'))
        .finally(() => setTTL(false))
    } else {
      setTicketThread(null); setTicketNotes([])
    }
  }, [queueDetail])

  const closeKycActionModal = () => {
    setPendingKycAction(null); setActionLoading(false)
  }

  // Called by LivenessCapture after blink→turn→smile pass for approve/reject
  const handleKycActionLiveness = async (base64: string) => {
    if (!pendingKycAction) return
    setActionLoading(true)
    try {
      const cloudName    = import.meta.env.VITE_CLOUDINARY_CLOUD_NAME    || 'dq8vykxut'
      const uploadPreset = import.meta.env.VITE_CLOUDINARY_UPLOAD_PRESET || 'paypaddy_kyc_faces'
      const fd = new FormData()
      fd.append('file', base64)
      fd.append('upload_preset', uploadPreset)
      fd.append('folder', 'kyc-face-captures')
      fd.append('tags', `admin_${pendingKycAction.action},${pendingKycAction.record.userId},${currentUser?.id}`)
      const up  = await fetch(`https://api.cloudinary.com/v1_1/${cloudName}/image/upload`, { method: 'POST', body: fd })
      const upd = await up.json()
      if (!upd.secure_url) throw new Error('Face upload failed — check Cloudinary preset is Unsigned')

      const { record, action, reason } = pendingKycAction
      if (action === 'approve') {
        await adminApi.approveKyc(record.userId, upd.secure_url)
        showToast(`${record.user?.firstName} KYC approved`, 'success')
      } else {
        await adminApi.rejectKyc(record.userId, reason || '', upd.secure_url)
        showToast('KYC rejected', 'success')
      }
      closeKycActionModal()
      loadKyc()
    } catch (e: any) {
      showToast(e?.response?.data?.message || e?.message || 'Failed', 'error')
      closeKycActionModal()
    }
  }

  // ── Reveal helpers ────────────────────────────────────────
  const openRevealModal = (record: any) => {
    setRevealModal(record); setRevealStep('password')
    setRevealPassword(''); setRevealData(null); setRevealFaceUrl(null)
    setCountdown(null); setCameraError('')
  }
  const closeRevealModal = () => {
    streamRef.current?.getTracks().forEach(t => t.stop()); streamRef.current = null
    setRevealModal(null); setRevealStep('password')
    setRevealPassword(''); setRevealData(null); setRevealFaceUrl(null)
    setCountdown(null); setCameraError('')
  }
  const handlePasswordSubmit = () => {
    if (!revealPassword.trim()) { showToast('Enter your password', 'error'); return }
    setRevealStep('camera')
  }
  // Called by LivenessCapture after blink→turn→smile all pass
  const handleRevealLiveness = async (base64: string) => {
    if (!revealModal) return
    setRevealLoading(true)
    try {
      const cloudName    = import.meta.env.VITE_CLOUDINARY_CLOUD_NAME    || 'dq8vykxut'
      const uploadPreset = import.meta.env.VITE_CLOUDINARY_UPLOAD_PRESET || 'paypaddy_kyc_faces'
      const fd = new FormData()
      fd.append('file', base64)
      fd.append('upload_preset', uploadPreset)
      fd.append('folder', 'kyc-face-captures')
      fd.append('tags', `admin_reveal,${revealModal.userId},${currentUser?.id}`)
      const up   = await fetch(`https://api.cloudinary.com/v1_1/${cloudName}/image/upload`, { method: 'POST', body: fd })
      const upd  = await up.json()
      if (!upd.secure_url) throw new Error('Face upload failed — check Cloudinary preset is Unsigned')
      const faceUrl = upd.secure_url
      setRevealFaceUrl(faceUrl)
      const r = await adminApi.revealUserIdentity(revealModal.userId, revealPassword, faceUrl)
      const d = (r.data as any)?.data || r.data
      setRevealData(d)
      setRevealStep('revealed')
    } catch (e: any) {
      showToast(e?.response?.data?.message || e?.message || 'Failed', 'error')
      setRevealStep('password'); setRevealPassword('')
    } finally { setRevealLoading(false) }
  }

  const kycPendingCount = kycRecords.filter(r => r.status === 'MANUAL_REVIEW').length

  const handleResolveCase = async () => { if (!queueDetail || !resolution.trim()) return; setResL(true); try { if (queueDetail._kind === 'dispute') await adminApi.resolveDispute(queueDetail.id, resolveStatus, resolution); showToast('Case resolved', 'success'); setQueueDetail(null); setResolution(''); setRS('RESOLVED'); loadQueue() } catch (err: any) { showToast(err?.response?.data?.message || 'Failed', 'error') } finally { setResL(false) } }

  // Send a private message to CS on an escalated ticket (with optional file), never seen by the customer
  const handleTicketReply = async () => {
    if (!queueDetail || (!ticketReplyMsg.trim() && !noteFile)) return
    setTRS(true)
    try {
      let fileUrl: string | undefined, fileName: string | undefined, fileSize: number | undefined
      if (noteFile) {
        setNoteUploading(true)
        const cloudName    = import.meta.env.VITE_CLOUDINARY_CLOUD_NAME    || 'dq8vykxut'
        const uploadPreset = import.meta.env.VITE_CLOUDINARY_UPLOAD_PRESET || 'paypaddy_kyc_faces'
        const fd = new FormData()
        fd.append('file', noteFile)
        fd.append('upload_preset', uploadPreset)
        fd.append('folder', 'cs-admin-attachments')
        const up  = await fetch(`https://api.cloudinary.com/v1_1/${cloudName}/auto/upload`, { method: 'POST', body: fd })
        const upd = await up.json()
        if (!upd.secure_url) throw new Error('File upload failed')
        fileUrl = upd.secure_url; fileName = noteFile.name; fileSize = noteFile.size
        setNoteUploading(false)
      }
      await adminApi.addTicketNote(queueDetail.id, ticketReplyMsg, fileUrl, fileName, fileSize)
      setTicketReplyMsg(''); setNoteFile(null)
      const r = await adminApi.getTicketNotes(queueDetail.id)
      setTicketNotes((r.data as any)?.data || r.data || [])
      showToast('Sent to CS', 'success')
    } catch (e: any) {
      showToast(e?.response?.data?.message || e?.message || 'Failed', 'error')
    } finally { setTRS(false); setNoteUploading(false) }
  }

  // Mark an escalated ticket resolved/closed from the review modal
  const handleTicketStatusChange = async (status: string) => {
    if (!queueDetail) return
    setTSU(true)
    try {
      await adminApi.updateTicketStatus(queueDetail.id, status)
      showToast(`Ticket marked ${status.toLowerCase()}`, 'success')
      setQueueDetail(null)
      loadQueue()
    } catch (e: any) {
      showToast(e?.response?.data?.message || 'Failed', 'error')
    } finally { setTSU(false) }
  }

  const handleSuspend     = async () => { if (!suspendModal || !suspendReason.trim()) return; await suspendUser.mutateAsync({ id: suspendModal.id, reason: suspendReason }); setSuspendModal(null); setSuspendReason(''); refetchUsers() }
  const handleBan         = async () => { if (!banModal || !banReason.trim()) return; setBanLoading(true); try { await adminApi.banUser(banModal.id, banReason); showToast(`${banModal.firstName} banned`, 'success'); setBanModal(null); setBanReason(''); refetchUsers() } catch (err: any) { showToast(err?.response?.data?.message || 'Failed', 'error') } finally { setBanLoading(false) } }
  const handleUnban       = async (u: any) => { setUnbanLoadingId(u.id); try { await adminApi.unbanUser(u.id); showToast(`${u.firstName} unbanned`, 'success'); refetchUsers() } catch (err: any) { showToast(err?.response?.data?.message || 'Failed', 'error') } finally { setUnbanLoadingId(null) } }
  const handleUnfreeze    = async (g: any) => { setUnfreezeLoadingId(g.id); try { await adminApi.unfreezeGroup(g.id); showToast(`${g.name} unfrozen`, 'success'); loadGroups() } catch (e: any) { showToast(e?.response?.data?.message || 'Failed', 'error') } finally { setUnfreezeLoadingId(null) } }
  const handleKycApprove  = (record: any) => { setPendingKycAction({ record, action: 'approve' }) }
  const handleKycReject   = () => { if (!kycRejectModal || !kycRejectReason.trim()) return; const record = kycRejectModal; const reason = kycRejectReason; setKycRejectModal(null); setKycRejectReason(''); setPendingKycAction({ record, action: 'reject', reason }) }

  const TABS: { id: AdminTab; label: string; badge?: number }[] = [
    { id: 'escalations',   label: 'Escalations', badge: (queue?.totals?.total || 0) > 0 ? queue?.totals?.total : undefined },
    { id: 'users',         label: 'Users'          },
    { id: 'transactions',  label: 'Transactions'   },
    { id: 'groups',        label: 'Groups'         },
    { id: 'contributions', label: 'Contributions'  },
    { id: 'fraud',         label: 'Fraud'          },
    { id: 'payouts',       label: 'Payouts'        },
    { id: 'audit',         label: 'Audit log'      },
    { id: 'kyc',           label: 'KYC review',    badge: kycPendingCount || undefined },
  ]

  const SectionTitle = ({ children }: { children: React.ReactNode }) => (
    <p className="px-5 sm:px-6 pt-2 pb-2 text-[13px] font-bold text-gray-900">{children}</p>
  )

  return (
    <DashboardLayout title="Admin Dashboard" subtitle="Investigations · Moderation · Escalations">
      <div className="bg-[#F8F9FB] min-h-screen">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 py-6 sm:py-8 space-y-6">

          {/* ── Hero ── */}
          <section className="relative rounded-2xl bg-[#0B3D2A] overflow-hidden px-5 py-8 text-center"
            style={{ backgroundImage: HERO_PATTERN, backgroundSize: '420px 220px', backgroundRepeat: 'repeat' }}>
            <h2 className="text-[20px] sm:text-[24px] font-bold text-white tracking-tight">Admin dashboard</h2>
            <p className="text-[12px] sm:text-[13px] text-[#E4C96A] mt-1.5">Investigations · Moderation · Escalations</p>
          </section>

          <section className="bg-white border border-gray-100 rounded-2xl shadow-sm overflow-hidden">
            {/* ── Tabs ── */}
            <div className="px-5 sm:px-6 pt-5 pb-4">
              <div className="flex items-center gap-1 bg-gray-100 rounded-lg p-0.5 overflow-x-auto w-fit max-w-full" role="tablist" style={{ scrollbarWidth: 'none' }}>
                {TABS.map(t => (
                  <button key={t.id} role="tab" aria-selected={tab === t.id} onClick={() => setTab(t.id)}
                    className={`flex items-center gap-1.5 px-3 h-8 rounded-md text-[11px] font-semibold whitespace-nowrap flex-shrink-0 transition-all ${tab === t.id ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-800'}`}>
                    {t.label}
                    {t.badge && <span className="min-w-[16px] h-4 px-1 rounded-full bg-red-500 text-white text-[9px] font-bold flex items-center justify-center">{t.badge > 9 ? '9+' : t.badge}</span>}
                  </button>
                ))}
              </div>
            </div>

            {/* ESCALATIONS */}
            {tab === 'escalations' && (
              <div>
                <div className="px-5 sm:px-6 pb-4">
                  <Notice tone="orange" icon={ICON.clip} title="Cases escalated by Customer Service">
                    These require admin review, investigation, or enforcement action.
                  </Notice>
                </div>
                {queueLoading ? <Loading n={3} /> : (
                  <>
                    {(queue?.tickets?.length || 0) > 0 && (
                      <div className="pb-2">
                        <SectionTitle>Escalated support tickets</SectionTitle>
                        <Table heads={['User', 'Subject', 'Escalated by CS', 'When', '']}>
                          {queue.tickets.map((t: any) => (
                            <tr key={t.id} className="hover:bg-gray-50/80 transition-colors">
                              <td className={`${TD} text-[11px] text-gray-500`}>@{t.user?.username || '—'}</td>
                              <td className={`${TD} text-[12px] font-medium text-gray-900 max-w-[220px] truncate`}>{t.subject}</td>
                              <td className={`${TD} text-[11px] text-gray-500`}>@{t.escalatedBy?.username || '—'}</td>
                              <td className={`${TD} text-[11px] text-gray-500 whitespace-nowrap`}>{t.escalatedAt ? dayjs(t.escalatedAt).format('MMM D, h:mm A') : '—'}</td>
                              <td className={TD}><button onClick={() => setQueueDetail({ ...t, _kind: 'ticket' })} className={actGray}>Review</button></td>
                            </tr>
                          ))}
                        </Table>
                      </div>
                    )}
                    {(queue?.disputes?.length || 0) > 0 && (
                      <div className="pb-2">
                        <SectionTitle>Escalated reports</SectionTitle>
                        <Table heads={['Reporter', 'Target', 'Type', 'Escalated by', 'When', '']}>
                          {queue.disputes.map((d: any) => (
                            <tr key={d.id} className="hover:bg-gray-50/80 transition-colors">
                              <td className={`${TD} text-[11px] text-gray-500`}>@{d.reporter?.username || '—'}</td>
                              <td className={`${TD} text-[11px] text-gray-500`}>{d.reportedUser ? `@${d.reportedUser.username}` : 'Group'}</td>
                              <td className={`${TD} text-[12px] font-medium text-gray-900`}>{d.type}</td>
                              <td className={`${TD} text-[11px] text-gray-500`}>@{d.escalatedBy?.username || 'system'}</td>
                              <td className={`${TD} text-[11px] text-gray-500 whitespace-nowrap`}>{d.escalatedAt ? dayjs(d.escalatedAt).format('MMM D, h:mm A') : '—'}</td>
                              <td className={TD}><button onClick={() => setQueueDetail({ ...d, _kind: 'dispute' })} className={actGray}>Review</button></td>
                            </tr>
                          ))}
                        </Table>
                      </div>
                    )}
                    {(!queue || (queue.tickets?.length === 0 && queue.disputes?.length === 0)) && (
                      <Empty icon={ICON.check} title="Queue is clear" sub="No escalated cases." />
                    )}
                  </>
                )}
              </div>
            )}

            {/* USERS */}
            {tab === 'users' && (
              <div>
                <Toolbar>
                  <SearchBox value={search} onChange={setSearch} placeholder="Search users…" />
                  <Sel value={roleFilter} onChange={setRoleFilter} className="w-40" options={[['', 'All roles'], ['USER', 'User'], ['ADMIN', 'Admin'], ['SUPER_ADMIN', 'Super Admin'], ['CUSTOMER_SERVICE', 'CS']]} />
                  <Sel value={statusFilterU} onChange={setStatusFilterU} className="w-40" options={[['', 'All status'], ['ACTIVE', 'Active'], ['SUSPENDED', 'Suspended'], ['BANNED', 'Banned'], ['PENDING_VERIFICATION', 'Pending']]} />
                </Toolbar>
                <Table heads={['User', 'Email', 'Wallet', 'Status', 'Joined', 'Actions']}>
                  {filteredUsers.length === 0 ? (
                    <tr><td colSpan={6}><Empty title="No users found" sub="Try different filters or search words." /></td></tr>
                  ) : filteredUsers.map((u: any) => (
                    <tr key={u.id} className="hover:bg-gray-50/80 transition-colors">
                      <td className={TD}>
                        <div className="flex items-center gap-3">
                          <UserAvatar firstName={u.firstName} lastName={u.lastName} avatarUrl={u.avatarUrl} />
                          <div className="space-y-0.5">
                            <p className="text-[12px] font-semibold text-gray-900">{u.firstName} {u.lastName}</p>
                            <p className="text-[11px] text-gray-400">@{u.username}</p>
                            {u.role !== 'USER' && <RoleBadge role={u.role} />}
                          </div>
                        </div>
                      </td>
                      <td className={`${TD} text-[11px] text-gray-500 font-mono`}>{u.email}</td>
                      <td className={`${TD} text-[12px] font-bold text-gray-900 font-mono`}>₦{(u.walletBalance || 0).toLocaleString()}</td>
                      <td className={TD}><StatusBadge status={u.status} /></td>
                      <td className={TD}><p className="text-[11px] font-medium text-gray-900">{dayjs(u.createdAt).format('MMM D, YYYY')}</p><p className="text-[10.5px] text-gray-400">{dayjs(u.createdAt).fromNow()}</p></td>
                      <td className={TD}>
                        <div className="flex items-center gap-1.5 flex-wrap">
                          {u.status === 'ACTIVE' && <button onClick={() => setSuspendModal(u)} className={actAmber}>Suspend</button>}
                          {u.status === 'SUSPENDED' && <button onClick={() => adminApi.unsuspendUser(u.id).then(() => { showToast('Unsuspended', 'success'); refetchUsers() }).catch((e: any) => showToast(e?.response?.data?.message || 'Failed', 'error'))} className={actGray}>Unsuspend</button>}
                          {u.id !== currentUser?.id && u.status !== 'BANNED' && <button onClick={() => setBanModal(u)} className={actRed}>Ban</button>}
                          {u.status === 'BANNED' && <button onClick={() => handleUnban(u)} disabled={unbanLoadingId === u.id} className={actGray}>{unbanLoadingId === u.id ? '…' : 'Unban'}</button>}
                        </div>
                      </td>
                    </tr>
                  ))}
                </Table>
              </div>
            )}

            {/* TRANSACTIONS */}
            {tab === 'transactions' && (
              <div>
                <Toolbar>
                  <SearchBox value={txSearch} onChange={v => { setTxSearch(v); setTxPage(1) }} placeholder="Search by email, username or reference…" />
                  <Sel value={txStatus} onChange={v => { setTxStatus(v); setTxPage(1) }} className="w-40" options={[['', 'All statuses'], ['PENDING', 'Pending'], ['COMPLETED', 'Completed'], ['FAILED', 'Failed'], ['REVERSED', 'Reversed']]} />
                  <Sel value={txType} onChange={v => { setTxType(v); setTxPage(1) }} className="w-40" options={[['', 'All types'], ['WALLET_FUNDING', 'Funding'], ['CONTRIBUTION', 'Contribution'], ['PAYOUT', 'Payout'], ['WITHDRAWAL', 'Withdrawal']]} />
                </Toolbar>
                {txLoading ? <Loading n={5} />
                : filteredTx.length === 0 ? <Empty title="No transactions found" sub="Try different filters or search words." />
                : (<>
                    <Table heads={['User', 'Type', 'Amount', 'Status', 'Reference', 'Date']}>
                      {filteredTx.map((tx: any) => (
                        <tr key={tx.id} onClick={() => setTxDetail(tx)} className="hover:bg-gray-50/80 transition-colors cursor-pointer">
                          <td className={TD}><p className="text-[12px] font-semibold text-gray-900">@{tx.user?.username || '—'}</p><p className="text-[11px] text-gray-400">{tx.user?.email}</p></td>
                          <td className={`${TD} text-[11px] text-gray-600 capitalize whitespace-nowrap`}>{tx.type?.replace(/_/g, ' ').toLowerCase()}</td>
                          <td className={`${TD} text-[12px] font-bold font-mono text-gray-900 whitespace-nowrap`}>₦{Number(tx.amount || 0).toLocaleString()}</td>
                          <td className={TD}><StatusBadge status={tx.status} /></td>
                          <td className={`${TD} text-[11px] font-mono text-gray-400 max-w-[180px] truncate`}>{tx.reference}</td>
                          <td className={`${TD} text-[11px] text-gray-500 whitespace-nowrap`}>{dayjs(tx.createdAt).format('MMM D, h:mm A')}</td>
                        </tr>
                      ))}
                    </Table>
                    <Paginator pag={txPag} page={txPage} setPage={setTxPage} />
                  </>)}
              </div>
            )}

            {/* GROUPS */}
            {tab === 'groups' && (
              <div>
                <Toolbar>
                  <Sel value={groupStatusFilter} onChange={v => { setGSF(v); setGroupPage(1) }} className="w-48" options={[['', 'All statuses'], ['ACTIVE', 'Active'], ['PAUSED', 'Paused'], ['COMPLETED', 'Completed'], ['CANCELLED', 'Cancelled']]} />
                </Toolbar>
                {groupsLoading ? <Loading n={4} />
                : groups.length === 0 ? <Empty title="No groups found" />
                : (<>
                    <Table heads={['Group', 'Status', 'Contribution', 'Members', 'Cycle', 'Actions']}>
                      {groups.map((g: any) => (
                        <tr key={g.id} className="hover:bg-gray-50/80 transition-colors">
                          <td className={TD}>
                            <p className="text-[12px] font-semibold text-gray-900">{g.name}</p>
                            <p className="text-[11px] text-gray-400">/{g.slug}</p>
                            {g.frozenByAdminId && <span className="inline-flex items-center gap-1 mt-1 px-1.5 py-0.5 rounded-md bg-red-50 text-red-600 ring-1 ring-red-200 text-[9px] font-bold uppercase tracking-wide"><Svg d={ICON.lock} className="w-2.5 h-2.5" sw={2} />Frozen</span>}
                          </td>
                          <td className={TD}><StatusBadge status={g.status} /></td>
                          <td className={`${TD} text-[12px] font-bold font-mono text-gray-900`}>₦{Number(g.contributionAmount || 0).toLocaleString()}</td>
                          <td className={`${TD} text-[12px] text-gray-600`}>{g._count?.members || 0}/{g.maxMembers}</td>
                          <td className={`${TD} text-[12px] text-gray-600`}>{g.currentCycle}/{g.totalCycles}</td>
                          <td className={TD}>
                            <div className="flex gap-1.5 flex-wrap">
                              {g.status !== 'PAUSED' && g.status !== 'CANCELLED' && <button onClick={() => setFreezeModal(g)} className={actAmber}>Freeze</button>}
                              {g.status === 'PAUSED' && <button disabled={unfreezeLoadingId === g.id} onClick={() => handleUnfreeze(g)} className={actGreen}>{unfreezeLoadingId === g.id ? '…' : 'Unfreeze'}</button>}
                              {g.status !== 'CANCELLED' && <button onClick={() => setCloseModal(g)} className={actRed}>Close</button>}
                            </div>
                          </td>
                        </tr>
                      ))}
                    </Table>
                    <Paginator pag={groupPag} page={groupPage} setPage={setGroupPage} />
                  </>)}
              </div>
            )}

            {/* CONTRIBUTIONS */}
            {tab === 'contributions' && (
              <div>
                <Toolbar>
                  <Sel value={contribStatus} onChange={v => { setContribStatus(v); setContribPage(1) }} className="w-56" options={[['', 'All statuses'], ['FAILED', 'Failed'], ['PENDING', 'Pending'], ['COMPLETED', 'Completed'], ['REVERSED', 'Reversed']]} />
                </Toolbar>
                {contribLoading ? <Loading n={5} />
                : contributions.length === 0 ? <Empty title="No contributions found" />
                : (<>
                    <Table heads={['Member', 'Email', 'Amount', 'Status', 'Reference', 'Date']}>
                      {contributions.map((c: any) => (
                        <tr key={c.id} className={`hover:bg-gray-50/80 transition-colors ${c.status === 'FAILED' ? 'bg-red-50/30' : c.status === 'PENDING' ? 'bg-amber-50/20' : ''}`}>
                          <td className={`${TD} text-[12px] font-semibold text-gray-900`}>{c.user?.username || '—'}</td>
                          <td className={`${TD} text-[11px] text-gray-500 font-mono`}>{c.user?.email || '—'}</td>
                          <td className={`${TD} text-[12px] font-bold font-mono text-gray-900`}>₦{Number(c.amount || 0).toLocaleString()}</td>
                          <td className={TD}><StatusBadge status={c.status} /></td>
                          <td className={`${TD} text-[11px] text-gray-400 font-mono max-w-[160px] truncate`}>{c.reference}</td>
                          <td className={`${TD} text-[11px] text-gray-500 whitespace-nowrap`}>{dayjs(c.createdAt).format('MMM D, YYYY h:mm A')}</td>
                        </tr>
                      ))}
                    </Table>
                    <Paginator pag={contribPag} page={contribPage} setPage={setContribPage} />
                  </>)}
              </div>
            )}

            {/* FRAUD */}
            {tab === 'fraud' && (
              <div>
                <SectionTitle>Fraud & risk flags</SectionTitle>
                {fraudLoading ? <Loading n={4} />
                : fraudFlags.length === 0 ? <Empty icon={ICON.check} title="No unresolved fraud flags" />
                : (
                  <div className="divide-y divide-gray-50 border-t border-gray-50">
                    {fraudFlags.map((f: any) => (
                      <div key={f.id} className="flex items-center gap-4 px-5 sm:px-6 py-3.5 hover:bg-gray-50/80 transition-colors">
                        <span className="w-9 h-9 rounded-lg bg-red-50 text-red-500 flex items-center justify-center flex-shrink-0"><Svg d={ICON.alert} className="w-4 h-4" /></span>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 mb-0.5"><p className="text-[12px] font-semibold text-gray-900">{f.type}</p><StatusBadge status={f.severity} /></div>
                          <p className="text-[11px] text-gray-500 truncate">{f.description}</p>
                        </div>
                        <button disabled={resolvingId === f.id}
                          onClick={async () => { setResolvingId(f.id); try { await adminApi.resolveFraud(f.id); showToast('Resolved', 'success'); setFraudFlags(p => p.filter(x => x.id !== f.id)) } catch { showToast('Failed', 'error') } finally { setResolvingId(null) } }}
                          className={`${actGray} flex-shrink-0`}>
                          {resolvingId === f.id ? '…' : 'Resolve'}
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* PAYOUTS */}
            {tab === 'payouts' && (
              <div className="py-12 text-center px-4">
                <span className="w-10 h-10 rounded-xl bg-emerald-50 text-emerald-600 flex items-center justify-center mx-auto mb-3"><Svg d={ICON.cash} className="w-5 h-5" /></span>
                <p className="text-[13px] font-semibold text-gray-800">Pending payouts</p>
                <p className="text-[11px] text-gray-400 mt-1 mb-4">Check how many payouts are waiting to be released.</p>
                <button onClick={() => adminApi.getPendingPayouts().then(r => showToast(`${(r.data?.data as any)?.pagination?.total || 0} pending payouts loaded`, 'info'))} className={btnPrimary}>Load pending payouts</button>
              </div>
            )}

            {/* AUDIT */}
            {tab === 'audit' && (
              <div>
                <SectionTitle>Audit log</SectionTitle>
                {auditLoading ? <Loading n={5} />
                : auditLogs.length === 0 ? <Empty title="No log entries yet" />
                : (<>
                    <Table heads={['Actor', 'Action', 'Details', 'Date']}>
                      {auditLogs.map((log: any) => {
                        const meta   = log.metadata || {}
                        const isKyc  = ['KYC_MANUALLY_APPROVED', 'KYC_MANUALLY_REJECTED', 'KYC_COMPLETED', 'KYC_NIN_VERIFIED', 'KYC_MANUAL_REVIEW', 'KYC_IDENTITY_REVEALED'].includes(log.action)
                        const reveal = log.action === 'KYC_IDENTITY_REVEALED'
                        return (
                          <tr key={log.id} className={`hover:bg-gray-50/80 transition-colors ${reveal ? 'bg-purple-50/30' : isKyc ? 'bg-blue-50/30' : ''}`}>
                            <td className={`${TD} text-[11px] text-gray-500 font-mono`}>{log.user?.username ? `@${log.user.username}` : 'System'}</td>
                            <td className={TD}>
                              <p className="text-[12px] font-semibold text-gray-900">{log.action?.replace(/_/g, ' ')}</p>
                              {reveal && <span className="inline-block mt-1 text-[9px] px-1.5 py-0.5 bg-purple-50 text-purple-700 ring-1 ring-purple-200 rounded-md font-bold uppercase tracking-wide">Reveal</span>}
                              {!reveal && isKyc && <span className="inline-block mt-1 text-[9px] px-1.5 py-0.5 bg-blue-50 text-blue-700 ring-1 ring-blue-200 rounded-md font-bold uppercase tracking-wide">KYC</span>}
                            </td>
                            <td className={`${TD} max-w-[300px]`}>
                              {isKyc ? (
                                <div className="space-y-1">
                                  {log.targetUser && <p className="text-[11px] font-semibold text-gray-700">→ @{log.targetUser.username} ({log.targetUser.firstName} {log.targetUser.lastName})</p>}
                                  {meta.approvedBy && <p className="text-[11px] text-emerald-600 font-semibold">Approved by @{meta.approvedBy}{meta.approvedByEmail ? ` · ${meta.approvedByEmail}` : ''}</p>}
                                  {meta.rejectedBy && <p className="text-[11px] text-red-500 font-semibold">Rejected by @{meta.rejectedBy}{meta.rejectedByEmail ? ` · ${meta.rejectedByEmail}` : ''}</p>}
                                  {meta.reason && <p className="text-[11px] text-gray-500">Reason: {meta.reason}</p>}
                                  {meta.facePhotoUrl && (
                                    <div className="flex items-center gap-2 mt-1">
                                      <img src={meta.facePhotoUrl} className="w-9 h-9 rounded-lg object-cover ring-2 ring-purple-200" alt="Face" />
                                      <span className="text-[10px] text-purple-600 font-semibold">Face captured</span>
                                    </div>
                                  )}
                                </div>
                              ) : (
                                <p className="text-[11px] text-gray-400 font-mono truncate">{log.entityType}{log.entityId ? ` · ${log.entityId.slice(0, 8)}…` : ''}</p>
                              )}
                            </td>
                            <td className={`${TD} text-[11px] text-gray-500 whitespace-nowrap`}>{dayjs(log.createdAt).format('MMM D, h:mm A')}</td>
                          </tr>
                        )
                      })}
                    </Table>
                    <Paginator pag={auditPag} page={auditPage} setPage={setAuditPage} />
                  </>)}
              </div>
            )}

            {/* KYC REVIEW */}
            {tab === 'kyc' && (
              <div>
                <div className="px-5 sm:px-6 pb-4">
                  <Notice tone="blue" icon={ICON.id} title="KYC identity records">
                    NIN and BVN are masked. Super Admins can reveal full numbers, which requires password + face capture and is permanently audited.
                  </Notice>
                </div>
                <Toolbar>
                  <Sel value={kycStatusFilter} onChange={setKycStatusFilter} className="w-52" options={[['', 'All statuses'], ['MANUAL_REVIEW', 'Manual review'], ['VERIFIED', 'Verified'], ['REJECTED', 'Rejected'], ['PENDING', 'Pending']]} />
                </Toolbar>
                {kycLoading ? <Loading n={3} />
                : kycRecords.length === 0 ? <Empty icon={ICON.check} title="No records" />
                : (
                  <Table heads={['User', 'Identity on file', 'NIN', 'BVN', 'Status', 'Note', 'Updated', 'Actions']}>
                    {kycRecords.map((r: any) => (
                      <tr key={r.id} className={`hover:bg-gray-50/80 transition-colors ${r.status === 'MANUAL_REVIEW' ? 'bg-orange-50/20' : r.status === 'REJECTED' ? 'bg-red-50/20' : ''}`}>
                        <td className={TD}>
                          <div className="flex items-center gap-3">
                            <UserAvatar firstName={r.user?.firstName} lastName={r.user?.lastName} avatarUrl={r.user?.avatarUrl} />
                            <div><p className="text-[12px] font-semibold text-gray-900">{r.user?.firstName} {r.user?.lastName}</p><p className="text-[11px] text-gray-400">@{r.user?.username}</p><p className="text-[10.5px] text-gray-400 font-mono">{r.user?.email}</p></div>
                          </div>
                        </td>
                        <td className={`${TD} min-w-[150px]`}>
                          {(r.firstName || r.lastName) ? (
                            <div><p className="text-[12px] font-semibold text-gray-900">{r.firstName} {r.lastName}</p>{r.dateOfBirth && <p className="text-[11px] text-gray-400 mt-0.5">DOB: {r.dateOfBirth}</p>}{r.phone && <p className="text-[11px] text-gray-400">{r.phone}</p>}</div>
                          ) : <span className="text-[12px] text-gray-300">—</span>}
                        </td>
                        <td className={TD}>
                          <p className="text-[12px] font-mono text-gray-700">{r.ninMasked || '—'}</p>
                          {r.ninVerified ? <span className="text-[10px] font-semibold text-emerald-600">Verified</span> : <span className="text-[10px] text-gray-300">Not verified</span>}
                        </td>
                        <td className={TD}>
                          <p className="text-[12px] font-mono text-gray-700">{r.bvnMasked || '—'}</p>
                          {r.bvnVerified ? <span className="text-[10px] font-semibold text-emerald-600">Verified</span> : <span className="text-[10px] text-gray-300">Not verified</span>}
                        </td>
                        <td className={TD}><StatusBadge status={r.status} /></td>
                        <td className={`${TD} max-w-[160px]`}><p className="text-[11px] text-gray-500 leading-relaxed">{r.rejectionReason || '—'}</p></td>
                        <td className={`${TD} text-[11px] text-gray-500 whitespace-nowrap`}>{dayjs(r.updatedAt).format('MMM D, h:mm A')}</td>
                        <td className={TD}>
                          <div className="flex flex-col gap-1.5 items-start">
                            {r.status === 'MANUAL_REVIEW' && (
                              <div className="flex gap-1.5">
                                <button disabled={kycActionLoading === r.userId} onClick={() => handleKycApprove(r)} className={actGreen}>{kycActionLoading === r.userId ? '…' : 'Approve'}</button>
                                <button onClick={() => setKycRejectModal(r)} className={actRed}>Reject</button>
                              </div>
                            )}
                            {(currentUser?.role === 'ADMIN' || currentUser?.role === 'SUPER_ADMIN') && (
                              <button onClick={() => openRevealModal(r)} className={`${actPurple} inline-flex items-center gap-1`}>
                                <Svg d={ICON.lock} className="w-3 h-3" sw={2} /> Reveal
                              </button>
                            )}
                          </div>
                        </td>
                      </tr>
                    ))}
                  </Table>
                )}
              </div>
            )}
          </section>
        </div>
      </div>

      {/* Transaction detail */}
      <Modal open={!!txDetail} onClose={() => setTxDetail(null)} title="Transaction details" size="sm"
        footer={<div className="flex justify-end w-full"><button onClick={() => setTxDetail(null)} className={btnGhost}>Close</button></div>}>
        {txDetail && (
          <div className="space-y-3">
            <div className="text-center py-3">
              <span className={`w-11 h-11 rounded-xl mx-auto flex items-center justify-center mb-3 ${txDetail.status === 'COMPLETED' ? 'bg-emerald-50 text-emerald-600' : txDetail.status === 'FAILED' ? 'bg-red-50 text-red-500' : 'bg-amber-50 text-amber-600'}`}>
                <Svg d={txDetail.status === 'COMPLETED' ? ICON.check : txDetail.status === 'FAILED' ? ICON.x : ICON.clock} className="w-5 h-5" sw={2} />
              </span>
              <p className="text-[26px] font-bold tabular-nums text-gray-900">₦{Number(txDetail.amount).toLocaleString()}</p>
              <div className="mt-1.5"><StatusBadge status={txDetail.status} /></div>
            </div>
            <div className="bg-gray-50 border border-gray-100 rounded-xl p-4 space-y-2.5">
              {[['Reference', txDetail.reference || '—'], ['Type', txDetail.type?.replace(/_/g, ' ')], ['User', `@${txDetail.user?.username || '—'}`], ['Date', dayjs(txDetail.createdAt).format('MMM D, YYYY h:mm A')]].map(([l, v]) => (
                <div key={l} className="flex justify-between gap-4"><span className="text-[11px] text-gray-400 flex-shrink-0">{l}</span><span className="text-[12px] font-medium text-gray-900 text-right break-all">{v}</span></div>
              ))}
            </div>
          </div>
        )}
      </Modal>

      {/* Escalation review — dispute resolution form OR ticket message thread */}
      <Modal
        open={!!queueDetail}
        onClose={() => { setQueueDetail(null); setResolution(''); setRS('RESOLVED'); setTicketReplyMsg(''); setTicketThread(null) }}
        title="Review escalated case"
        size="md"
      >
        <div className="space-y-4">
          <div className="bg-gray-50 border border-gray-100 rounded-xl px-4 py-3">
            <p className="text-[9.5px] text-gray-400 uppercase tracking-wider font-semibold mb-1">{queueDetail?._kind === 'ticket' ? 'Ticket' : 'Report'}</p>
            <p className="text-[13px] font-medium text-gray-900">{queueDetail?._kind === 'ticket' ? queueDetail?.subject : queueDetail?.type}</p>
          </div>

          {queueDetail?._kind === 'ticket' ? (
            ticketThreadLoading ? (
              <div className="space-y-2">{[...Array(3)].map((_, i) => <Skeleton key={i} className="h-12 rounded-xl" />)}</div>
            ) : (
              <>
                <div className="max-h-72 overflow-y-auto space-y-2.5 pr-1">
                  {ticketNotes.map((n: any) => (
                    <div key={n.id} className="flex justify-start">
                      <div className="max-w-[85%] rounded-2xl rounded-tl-sm px-4 py-2.5 text-[13px] bg-gray-100 text-gray-900">
                        {n.content && <p className="leading-relaxed whitespace-pre-wrap">{n.content}</p>}
                        {n.fileUrl && (
                          <a href={n.fileUrl} target="_blank" rel="noreferrer" className="flex items-center gap-2 mt-2 bg-white rounded-lg px-3 py-2 border border-gray-200 hover:bg-gray-50 transition-colors">
                            <Svg d={ICON.attach} className="w-4 h-4 text-gray-500 flex-shrink-0" />
                            <span className="text-[12px] font-medium text-gray-700 truncate">{n.fileName || 'Attachment'}</span>
                          </a>
                        )}
                        <p className="text-[10px] mt-1 text-gray-400">
                          {n.author?.username ? `@${n.author.username}` : 'Staff'}{' · '}{dayjs(n.createdAt).format('MMM D, h:mm A')}
                        </p>
                      </div>
                    </div>
                  ))}
                  {ticketNotes.length === 0 && <p className="text-[12px] text-gray-400 text-center py-6">No messages with CS yet</p>}
                </div>

                <div className="border-t border-gray-100 pt-3 space-y-2.5">
                  <textarea
                    value={ticketReplyMsg}
                    onChange={e => setTicketReplyMsg(e.target.value)}
                    rows={3}
                    placeholder="Message to Customer Service (not visible to the customer)…"
                    className="w-full border border-gray-200 rounded-2xl px-4 py-3 text-[13px] text-gray-900 bg-gray-50 outline-none focus:border-emerald-400 focus:bg-white focus:ring-2 focus:ring-emerald-400/10 resize-none transition-all"
                  />
                  <div className="flex items-center justify-between gap-2 flex-wrap">
                    <label className="h-8 px-3 rounded-lg border border-gray-200 bg-white text-[11px] font-semibold text-gray-600 hover:bg-gray-50 cursor-pointer transition-colors flex items-center gap-1.5">
                      <Svg d={ICON.attach} className="w-3.5 h-3.5" /> {noteFile ? noteFile.name.slice(0, 20) : 'Attach file'}
                      <input type="file" className="hidden" onChange={e => setNoteFile(e.target.files?.[0] || null)} />
                    </label>
                    <div className="flex gap-1.5">
                      <button disabled={ticketStatusUpdating} onClick={() => handleTicketStatusChange('RESOLVED')} className={`${actGreen} !h-8 !px-3`}>Mark resolved</button>
                      <button disabled={ticketStatusUpdating} onClick={() => handleTicketStatusChange('CLOSED')} className={`${actRed} !h-8 !px-3`}>Close</button>
                    </div>
                    <button disabled={(!ticketReplyMsg.trim() && !noteFile) || ticketReplySending || noteUploading} onClick={handleTicketReply} className={btnPrimary}>
                      {noteUploading ? 'Uploading…' : ticketReplySending ? 'Sending…' : 'Send to CS'}
                    </button>
                  </div>
                </div>
              </>
            )
          ) : (
            <>
              <p className="text-[13px] text-gray-600 leading-relaxed">{queueDetail?.description || queueDetail?.subject}</p>
              {queueDetail?._kind === 'dispute' && !['RESOLVED', 'DISMISSED', 'CLOSED'].includes(queueDetail?.status) && (
                <div className="bg-gray-50 border border-gray-100 rounded-xl p-4 space-y-3">
                  <div>
                    <label className={labelCls}>Outcome</label>
                    <Sel value={resolveStatus} onChange={setRS} className="w-full" options={[['RESOLVED', 'Resolved'], ['DISMISSED', 'Dismissed'], ['CLOSED', 'Closed']]} />
                  </div>
                  <div>
                    <label className={labelCls}>Resolution notes</label>
                    <textarea value={resolution} onChange={e => setResolution(e.target.value)} rows={3} placeholder="What was the outcome?" className={`${fieldCls} py-2.5 resize-none leading-relaxed bg-white`} />
                  </div>
                  <div className="flex justify-end">
                    <button disabled={!resolution.trim() || resolveLoading} onClick={handleResolveCase} className={btnDanger}>{resolveLoading ? 'Closing…' : 'Close case'}</button>
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      </Modal>

      {/* Suspend */}
      <Modal open={!!suspendModal} onClose={() => setSuspendModal(null)} title={`Suspend ${suspendModal?.firstName}?`} size="sm"
        footer={
          <div className="flex gap-2 justify-end w-full">
            <button onClick={() => setSuspendModal(null)} className={btnGhost}>Cancel</button>
            <button onClick={handleSuspend} disabled={suspendUser.isPending || !suspendReason.trim()} className={btnDanger}>{suspendUser.isPending ? 'Suspending…' : 'Suspend'}</button>
          </div>
        }>
        <div className="space-y-4">
          <Notice tone="amber">This revokes all active sessions.</Notice>
          <Field label="Reason" placeholder="e.g. Suspicious payment activity" value={suspendReason} onChange={e => setSuspendReason(e.target.value)} />
        </div>
      </Modal>

      {/* Ban */}
      <Modal open={!!banModal} onClose={() => { setBanModal(null); setBanReason('') }} title={`Ban ${banModal?.firstName}?`} size="sm"
        footer={
          <div className="flex gap-2 justify-end w-full">
            <button onClick={() => { setBanModal(null); setBanReason('') }} className={btnGhost}>Cancel</button>
            <button onClick={handleBan} disabled={banLoading || !banReason.trim()} className={btnDanger}>{banLoading ? 'Banning…' : 'Ban user'}</button>
          </div>
        }>
        <div className="space-y-4">
          <Notice tone="red" icon={ICON.alert} title="Permanent ban">Only a Super Admin can reverse this.</Notice>
          <Field label="Reason" value={banReason} onChange={e => setBanReason(e.target.value)} />
        </div>
      </Modal>

      {/* Freeze */}
      <Modal open={!!freezeModal} onClose={() => { setFreezeModal(null); setFreezeReason('') }} title={`Freeze ${freezeModal?.name}?`} size="sm"
        footer={
          <div className="flex gap-2 justify-end w-full">
            <button onClick={() => { setFreezeModal(null); setFreezeReason('') }} className={btnGhost}>Cancel</button>
            <button disabled={freezeLoading || !freezeReason.trim()} className={btnDanger}
              onClick={async () => { if (!freezeModal || !freezeReason.trim()) return; setFreezeLoading(true); try { await adminApi.freezeGroup(freezeModal.id, freezeReason); showToast(`${freezeModal.name} frozen`, 'success'); setFreezeModal(null); setFreezeReason(''); loadGroups() } catch (e: any) { showToast(e?.response?.data?.message || 'Failed', 'error') } finally { setFreezeLoading(false) } }}>
              {freezeLoading ? 'Freezing…' : 'Freeze'}
            </button>
          </div>
        }>
        <Field label="Reason" value={freezeReason} onChange={e => setFreezeReason(e.target.value)} />
      </Modal>

      {/* Close group */}
      <Modal open={!!closeModal} onClose={() => { setCloseModal(null); setCloseReason('') }} title={`Close ${closeModal?.name}?`} size="sm"
        footer={
          <div className="flex gap-2 justify-end w-full">
            <button onClick={() => { setCloseModal(null); setCloseReason('') }} className={btnGhost}>Cancel</button>
            <button disabled={closeLoading || !closeReason.trim()} className={btnDanger}
              onClick={async () => { if (!closeModal || !closeReason.trim()) return; setCloseLoading(true); try { await adminApi.closeGroup(closeModal.id, closeReason); showToast(`${closeModal.name} closed`, 'success'); setCloseModal(null); setCloseReason(''); loadGroups() } catch (e: any) { showToast(e?.response?.data?.message || 'Failed', 'error') } finally { setCloseLoading(false) } }}>
              {closeLoading ? 'Closing…' : 'Close group'}
            </button>
          </div>
        }>
        <Field label="Reason" value={closeReason} onChange={e => setCloseReason(e.target.value)} />
      </Modal>

      {/* KYC Reject */}
      <Modal open={!!kycRejectModal} onClose={() => { setKycRejectModal(null); setKycRejectReason('') }} title={`Reject KYC for ${kycRejectModal?.user?.firstName}?`} size="sm"
        footer={
          <div className="flex gap-2 justify-end w-full">
            <button onClick={() => { setKycRejectModal(null); setKycRejectReason('') }} className={btnGhost}>Cancel</button>
            <button onClick={handleKycReject} disabled={!kycRejectReason.trim()} className={btnDanger}>Continue to face scan →</button>
          </div>
        }>
        <div className="space-y-4">
          <Notice tone="red" icon={ICON.alert} title="User will be notified">They can resubmit. Your face will be captured for the audit log.</Notice>
          <Field label="Rejection reason" placeholder="e.g. NIN and BVN names do not match" value={kycRejectReason} onChange={e => setKycRejectReason(e.target.value)} />
        </div>
      </Modal>

      {/* KYC approve/reject — face capture */}
      <Modal
        open={!!pendingKycAction}
        onClose={closeKycActionModal}
        title={pendingKycAction?.action === 'approve' ? `Approving ${pendingKycAction?.record?.user?.firstName} · Face capture` : `Rejecting ${pendingKycAction?.record?.user?.firstName} · Face capture`}
        size="sm"
        footer={<div className="flex justify-end w-full"><button onClick={closeKycActionModal} disabled={actionLoading} className={btnGhost}>Cancel</button></div>}
      >
        <div className="space-y-4">
          <Notice tone="amber" icon={ICON.camera} title="Liveness check: blink, turn, smile">
            Your photo is stored in the audit log with this {pendingKycAction?.action === 'approve' ? 'approval' : 'rejection'}.
          </Notice>
          {actionLoading ? (
            <div className="flex items-center gap-2 text-[12px] text-gray-500 bg-gray-50 border border-gray-100 rounded-xl p-3">
              <div className="w-4 h-4 border-2 border-gray-300 border-t-gray-700 rounded-full animate-spin flex-shrink-0" />
              Uploading photo and {pendingKycAction?.action === 'approve' ? 'approving' : 'rejecting'}…
            </div>
          ) : (
            <LivenessCapture
              onCapture={handleKycActionLiveness}
              onCancel={closeKycActionModal}
              uploadingLabel={`Uploading and ${pendingKycAction?.action === 'approve' ? 'approving' : 'rejecting'}…`}
            />
          )}
        </div>
      </Modal>

      {/* NIN/BVN reveal — 3 step modal */}
      <Modal
        open={!!revealModal}
        onClose={closeRevealModal}
        title={revealStep === 'password' ? 'Reveal NIN/BVN · Step 1 of 2' : revealStep === 'camera' ? 'Reveal NIN/BVN · Step 2 of 2' : 'Identity revealed'}
        size="sm"
        footer={
          revealStep === 'password' ? (
            <div className="flex gap-2 justify-end w-full">
              <button onClick={closeRevealModal} className={btnGhost}>Cancel</button>
              <button onClick={handlePasswordSubmit} disabled={!revealPassword.trim()} className={btnPrimary}>Continue to face scan →</button>
            </div>
          ) : revealStep === 'camera' ? (
            <div className="flex justify-end w-full"><button onClick={closeRevealModal} disabled={revealLoading} className={btnGhost}>Cancel</button></div>
          ) : (
            <div className="flex justify-end w-full"><button onClick={closeRevealModal} className={btnPrimary}>Close</button></div>
          )
        }
      >
        {/* STEP 1: Password */}
        {revealStep === 'password' && (
          <div className="space-y-4">
            <Notice tone="purple" icon={ICON.lock} title="Sensitive data access">
              Enter your password. Then your face photo will be captured and stored permanently in the audit log before NIN/BVN is shown.
            </Notice>
            <div className="bg-gray-50 border border-gray-100 rounded-xl p-3 space-y-0.5">
              <p className="text-[12px] font-semibold text-gray-900">{revealModal?.user?.firstName} {revealModal?.user?.lastName}</p>
              <p className="text-[11px] text-gray-400 font-mono">{revealModal?.user?.email}</p>
              <p className="text-[11px] text-gray-400">NIN: <span className="font-mono">{revealModal?.ninMasked || '—'}</span> · BVN: <span className="font-mono">{revealModal?.bvnMasked || '—'}</span></p>
            </div>
            <Field label="Your Super Admin password" type="password" placeholder="Enter your password" value={revealPassword} onChange={e => setRevealPassword(e.target.value)} />
            {cameraError && <p className="text-[12px] text-red-500 bg-red-50 rounded-lg p-3">{cameraError}</p>}
          </div>
        )}

        {/* STEP 2: Camera */}
        {revealStep === 'camera' && (
          <div className="space-y-4">
            <Notice tone="amber" icon={ICON.camera} title="Liveness check: prove it's really you">
              Blink, turn your head, and smile. The photo is only taken after all checks pass, and is permanently stored in the audit trail.
            </Notice>
            {revealLoading ? (
              <div className="flex items-center gap-2 text-[12px] text-gray-500 bg-gray-50 border border-gray-100 rounded-xl p-3">
                <div className="w-4 h-4 border-2 border-gray-300 border-t-gray-700 rounded-full animate-spin flex-shrink-0" />
                Uploading face and verifying password…
              </div>
            ) : (
              <LivenessCapture
                onCapture={handleRevealLiveness}
                onCancel={closeRevealModal}
                uploadingLabel="Uploading face and verifying password…"
              />
            )}
          </div>
        )}

        {/* STEP 3: Revealed */}
        {revealStep === 'revealed' && (
          <div className="space-y-4">
            <Notice tone="amber" icon={ICON.alert} title="This access is permanently logged">Do not share this data.</Notice>
            {revealFaceUrl && (
              <div className="flex items-center gap-3 bg-purple-50 border border-purple-100 rounded-xl p-3">
                <img src={revealFaceUrl} className="w-14 h-14 rounded-xl object-cover ring-2 ring-purple-200" style={{ transform: 'scaleX(-1)' }} alt="Face capture" />
                <div><p className="text-[12px] font-semibold text-purple-700">Face captured and stored</p><p className="text-[11px] text-purple-400">Visible in audit log</p></div>
              </div>
            )}
            <div className="bg-gray-50 border border-gray-100 rounded-xl p-4 space-y-3">
              <div>
                <p className={labelCls}>NIN</p>
                <p className="text-[22px] font-bold font-mono text-gray-900 tracking-widest">{revealData?.nin || '—'}</p>
              </div>
              <div className="border-t border-gray-100 pt-3">
                <p className={labelCls}>BVN</p>
                <p className="text-[22px] font-bold font-mono text-gray-900 tracking-widest">{revealData?.bvn || '—'}</p>
              </div>
              <div className="border-t border-gray-100 pt-3">
                <p className={labelCls}>Identity on file</p>
                <p className="text-[12px] font-semibold text-gray-900">{revealModal?.firstName} {revealModal?.lastName}</p>
                {revealModal?.dateOfBirth && <p className="text-[11px] text-gray-500">DOB: {revealModal.dateOfBirth}</p>}
              </div>
            </div>
          </div>
        )}
      </Modal>
    </DashboardLayout>
  )
}