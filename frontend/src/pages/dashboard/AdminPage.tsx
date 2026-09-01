import { useState, useRef, useEffect } from 'react'
import DashboardLayout from '@/components/layout/DashboardLayout'
import { Button, Skeleton, Modal, Input } from '@/components/ui'
import { useAdminDashboard, useAdminUsers, useSuspendUser } from '@/hooks/useApi'
import { adminApi } from '@/api/services'
import { useUIStore } from '@/stores/uiStore'
import { useAuthStore } from '@/stores/authStore'
import LivenessCapture from '@/components/LivenessCapture'
import dayjs from 'dayjs'
import relativeTime from 'dayjs/plugin/relativeTime'
dayjs.extend(relativeTime)

type AdminTab = 'escalations' | 'users' | 'transactions' | 'groups' | 'contributions' | 'fraud' | 'payouts' | 'audit' | 'kyc'

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
  }
  const c = cfg[status] || { label: status, cls: 'bg-gray-100 text-gray-500' }
  return (
    <span className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[11px] font-semibold ${c.cls}`}>
      {['PENDING_VERIFICATION','SUSPENDED','BANNED'].includes(status) && (
        <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"/></svg>
      )}
      {c.label}
    </span>
  )
}

function RoleBadge({ role }: { role: string }) {
  const cfg: any = {
    SUPER_ADMIN:      { label: 'Super Admin',      cls: 'bg-purple-50 text-purple-700 border border-purple-200' },
    ADMIN:            { label: 'Admin',            cls: 'bg-blue-50 text-blue-700 border border-blue-200' },
    CUSTOMER_SERVICE: { label: 'Customer Service', cls: 'bg-teal-50 text-teal-700 border border-teal-200' },
    USER:             { label: 'User',             cls: 'bg-gray-50 text-gray-500 border border-gray-200' },
  }
  const c = cfg[role] || { label: role, cls: 'bg-gray-50 text-gray-500 border border-gray-200' }
  return <span className={`inline-flex items-center px-2 py-0.5 rounded-md text-[10px] font-semibold ${c.cls}`}>{c.label}</span>
}

function UserAvatar({ firstName, lastName }: { firstName?: string; lastName?: string }) {
  const initials = ((firstName?.[0] || '') + (lastName?.[0] || '')).toUpperCase() || '?'
  const colors = ['bg-emerald-500', 'bg-blue-500', 'bg-violet-500', 'bg-amber-500', 'bg-pink-500', 'bg-teal-500']
  const color = colors[(firstName?.charCodeAt(0) || 0) % colors.length]
  return (
    <div className={`w-10 h-10 ${color} rounded-full flex items-center justify-center text-white text-[13px] font-bold flex-shrink-0`}>
      {initials}
    </div>
  )
}

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
        showToast(`${record.user?.firstName} KYC approved ✅`, 'success')
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
  const handleSuspend     = async () => { if (!suspendModal || !suspendReason.trim()) return; await suspendUser.mutateAsync({ id: suspendModal.id, reason: suspendReason }); setSuspendModal(null); setSuspendReason(''); refetchUsers() }
  const handleBan         = async () => { if (!banModal || !banReason.trim()) return; setBanLoading(true); try { await adminApi.banUser(banModal.id, banReason); showToast(`${banModal.firstName} banned`, 'success'); setBanModal(null); setBanReason(''); refetchUsers() } catch (err: any) { showToast(err?.response?.data?.message || 'Failed', 'error') } finally { setBanLoading(false) } }
  const handleUnban       = async (u: any) => { setUnbanLoadingId(u.id); try { await adminApi.unbanUser(u.id); showToast(`${u.firstName} unbanned`, 'success'); refetchUsers() } catch (err: any) { showToast(err?.response?.data?.message || 'Failed', 'error') } finally { setUnbanLoadingId(null) } }
  const handleUnfreeze    = async (g: any) => { setUnfreezeLoadingId(g.id); try { await adminApi.unfreezeGroup(g.id); showToast(`${g.name} unfrozen`, 'success'); loadGroups() } catch (e: any) { showToast(e?.response?.data?.message || 'Failed', 'error') } finally { setUnfreezeLoadingId(null) } }
  const handleKycApprove  = (record: any) => { setPendingKycAction({ record, action: 'approve' }) }
  const handleKycReject   = () => { if (!kycRejectModal || !kycRejectReason.trim()) return; const record = kycRejectModal; const reason = kycRejectReason; setKycRejectModal(null); setKycRejectReason(''); setPendingKycAction({ record, action: 'reject', reason }) }

  const TABS: { id: AdminTab; label: string; badge?: number }[] = [
    { id: 'escalations',   label: 'Escalation Queue', badge: (queue?.totals?.total || 0) > 0 ? queue?.totals?.total : undefined },
    { id: 'users',         label: 'Users'          },
    { id: 'transactions',  label: 'Transactions'   },
    { id: 'groups',        label: 'Groups'         },
    { id: 'contributions', label: 'Contributions'  },
    { id: 'fraud',         label: 'Fraud'          },
    { id: 'payouts',       label: 'Payouts'        },
    { id: 'audit',         label: 'Audit Log'      },
    { id: 'kyc',           label: 'KYC Review',    badge: kycPendingCount || undefined },
  ]

  const Table = ({ heads, children }: { heads: string[]; children: React.ReactNode }) => (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[640px]">
        <thead className="border-b border-gray-100 bg-gray-50/50">
          <tr>{heads.map(h => <th key={h} className="px-5 py-3.5 text-left text-[11px] font-semibold text-gray-400 uppercase tracking-wider whitespace-nowrap">{h}</th>)}</tr>
        </thead>
        <tbody className="divide-y divide-gray-50">{children}</tbody>
      </table>
    </div>
  )

  const Paginator = ({ pag, page, setPage }: { pag: any; page: number; setPage: (fn: (p: number) => number) => void }) => {
    if (!pag || pag.totalPages <= 1) return null
    const total = pag.totalPages
    return (
      <div className="flex items-center justify-between px-5 py-3.5 border-t border-gray-50 flex-wrap gap-3">
        <p className="text-[12px] text-gray-400">{((page-1)*(pag.limit||20))+1}–{Math.min(page*(pag.limit||20),pag.total)} of {pag.total}</p>
        <div className="flex items-center gap-1">
          <button disabled={page===1} onClick={() => setPage(p=>p-1)} className="w-8 h-8 rounded-lg border border-gray-200 flex items-center justify-center text-gray-500 hover:bg-gray-50 disabled:opacity-40 transition-colors">
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7"/></svg>
          </button>
          {Array.from({ length: Math.min(total, 5) }, (_,i) => i+1).map(p => (
            <button key={p} onClick={() => setPage(()=>p)} className={`w-8 h-8 rounded-lg text-[12px] font-semibold transition-colors ${page===p?'bg-gray-900 text-white':'border border-gray-200 text-gray-500 hover:bg-gray-50'}`}>{p}</button>
          ))}
          {total > 5 && <><span className="text-gray-400 text-[12px] px-1">…</span><button onClick={() => setPage(()=>total)} className={`w-8 h-8 rounded-lg text-[12px] font-semibold transition-colors ${page===total?'bg-gray-900 text-white':'border border-gray-200 text-gray-500 hover:bg-gray-50'}`}>{total}</button></>}
          <button disabled={page>=total} onClick={() => setPage(p=>p+1)} className="w-8 h-8 rounded-lg border border-gray-200 flex items-center justify-center text-gray-500 hover:bg-gray-50 disabled:opacity-40 transition-colors">
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7"/></svg>
          </button>
        </div>
      </div>
    )
  }

  return (
    <DashboardLayout title="Admin Dashboard" subtitle="Investigations · Moderation · Escalations">
      <div className="bg-[#F8F9FB] min-h-screen">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 py-4 sm:py-6 space-y-5">
          <div className="bg-white border border-gray-100 rounded-2xl shadow-sm overflow-hidden">
            <div className="flex overflow-x-auto border-b border-gray-100 px-2" style={{ scrollbarWidth:'none' }}>
              {TABS.map(t => (
                <button key={t.id} onClick={() => setTab(t.id)}
                  className={`flex items-center gap-2 px-3 sm:px-4 py-4 text-[12px] sm:text-[13px] font-semibold whitespace-nowrap border-b-2 transition-all -mb-px flex-shrink-0 ${tab===t.id?'border-gray-900 text-gray-900':'border-transparent text-gray-400 hover:text-gray-700'}`}>
                  {t.label}
                  {t.badge && <span className="w-4 h-4 rounded-full bg-red-500 text-white text-[9px] font-bold flex items-center justify-center">{t.badge>9?'9+':t.badge}</span>}
                </button>
              ))}
            </div>

            {/* ESCALATIONS */}
            {tab==='escalations' && (
              <div className="p-5 space-y-5">
                <div className="bg-orange-50 border border-orange-100 rounded-2xl p-4 flex items-center gap-3">
                  <div className="w-10 h-10 rounded-xl bg-orange-100 flex items-center justify-center text-xl flex-shrink-0">📋</div>
                  <div><p className="text-[13px] font-semibold text-orange-800">Cases escalated by Customer Service</p><p className="text-[12px] text-orange-600">These require Admin review, investigation, or enforcement action.</p></div>
                </div>
                {queueLoading ? <div className="space-y-3">{[...Array(3)].map((_,i)=><Skeleton key={i} className="h-14 rounded-xl"/>)}</div> : (
                  <>
                    {(queue?.tickets?.length||0)>0 && (
                      <div className="rounded-2xl border border-gray-100 overflow-hidden">
                        <div className="px-5 py-3.5 bg-gray-50 border-b border-gray-100"><p className="text-[13px] font-bold text-gray-900">Escalated Support Tickets</p></div>
                        <Table heads={['User','Subject','Escalated by CS','When','']}>
                          {queue.tickets.map((t:any) => (
                            <tr key={t.id} className="hover:bg-gray-50/60 transition-colors">
                              <td className="px-5 py-3.5 text-[12px] text-gray-500">@{t.user?.username||'—'}</td>
                              <td className="px-5 py-3.5 text-[13px] font-medium text-gray-900 max-w-[220px] truncate">{t.subject}</td>
                              <td className="px-5 py-3.5 text-[12px] text-gray-500">@{t.escalatedBy?.username||'—'}</td>
                              <td className="px-5 py-3.5 text-[11px] text-gray-400 font-mono">{t.escalatedAt?dayjs(t.escalatedAt).format('MMM D, h:mm A'):'—'}</td>
                              <td className="px-5 py-3.5"><button onClick={()=>setQueueDetail({...t,_kind:'ticket'})} className="h-8 px-3 rounded-lg border border-gray-200 text-[12px] font-semibold text-gray-700 hover:bg-gray-50 transition-colors">Review</button></td>
                            </tr>
                          ))}
                        </Table>
                      </div>
                    )}
                    {(queue?.disputes?.length||0)>0 && (
                      <div className="rounded-2xl border border-gray-100 overflow-hidden">
                        <div className="px-5 py-3.5 bg-gray-50 border-b border-gray-100"><p className="text-[13px] font-bold text-gray-900">Escalated Reports</p></div>
                        <Table heads={['Reporter','Target','Type','Escalated by','When','']}>
                          {queue.disputes.map((d:any) => (
                            <tr key={d.id} className="hover:bg-gray-50/60 transition-colors">
                              <td className="px-5 py-3.5 text-[12px] text-gray-500">@{d.reporter?.username||'—'}</td>
                              <td className="px-5 py-3.5 text-[12px] text-gray-500">{d.reportedUser?`@${d.reportedUser.username}`:'Group'}</td>
                              <td className="px-5 py-3.5 text-[13px] font-medium text-gray-900">{d.type}</td>
                              <td className="px-5 py-3.5 text-[12px] text-gray-500">@{d.escalatedBy?.username||'system'}</td>
                              <td className="px-5 py-3.5 text-[11px] text-gray-400 font-mono">{d.escalatedAt?dayjs(d.escalatedAt).format('MMM D, h:mm A'):'—'}</td>
                              <td className="px-5 py-3.5"><button onClick={()=>setQueueDetail({...d,_kind:'dispute'})} className="h-8 px-3 rounded-lg border border-gray-200 text-[12px] font-semibold text-gray-700 hover:bg-gray-50 transition-colors">Review</button></td>
                            </tr>
                          ))}
                        </Table>
                      </div>
                    )}
                    {(!queue||(queue.tickets?.length===0&&queue.disputes?.length===0))&&(
                      <div className="py-14 text-center"><p className="text-3xl mb-3">✅</p><p className="text-[14px] font-semibold text-gray-800">Queue is clear</p><p className="text-[12px] text-gray-400 mt-1">No escalated cases.</p></div>
                    )}
                  </>
                )}
              </div>
            )}

            {/* USERS */}
            {tab==='users' && (
              <div className="p-5 space-y-5">
                <div className="flex items-center gap-3 flex-wrap">
                  <div className="relative flex-1 min-w-[200px] max-w-md">
                    <svg className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"/></svg>
                    <input value={search} onChange={e=>setSearch(e.target.value)} placeholder="Search users…" className="w-full h-11 pl-10 pr-4 bg-white border border-gray-200 rounded-xl text-[13px] placeholder-gray-400 outline-none focus:border-gray-400 transition-all"/>
                  </div>
                  {[
                    { val:roleFilter,    set:setRoleFilter,    opts:[['','All Roles'],['USER','User'],['ADMIN','Admin'],['SUPER_ADMIN','Super Admin'],['CUSTOMER_SERVICE','CS']] },
                    { val:statusFilterU, set:setStatusFilterU, opts:[['','All Status'],['ACTIVE','Active'],['SUSPENDED','Suspended'],['BANNED','Banned'],['PENDING_VERIFICATION','Pending']] },
                  ].map((f,i) => (
                    <div key={i} className="relative">
                      <select value={f.val} onChange={e=>f.set(e.target.value)} className="h-11 pl-3 pr-8 bg-white border border-gray-200 rounded-xl text-[13px] text-gray-700 font-medium outline-none cursor-pointer appearance-none hover:border-gray-300 transition-colors">
                        {f.opts.map(([v,l])=><option key={v} value={v}>{l}</option>)}
                      </select>
                      <svg className="absolute right-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-400 pointer-events-none" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7"/></svg>
                    </div>
                  ))}
                </div>
                <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
                  <Table heads={['User','Email','Wallet','Status','Joined','Actions']}>
                    {filteredUsers.length===0 ? (
                      <tr><td colSpan={6} className="py-14 text-center text-[13px] text-gray-400">No users found</td></tr>
                    ) : filteredUsers.map((u:any) => (
                      <tr key={u.id} className="hover:bg-gray-50/60 transition-colors">
                        <td className="px-5 py-4">
                          <div className="flex items-center gap-3">
                            <UserAvatar firstName={u.firstName} lastName={u.lastName}/>
                            <div><p className="text-[13px] font-semibold text-gray-900">{u.firstName} {u.lastName}</p><p className="text-[11px] text-gray-400">@{u.username}</p>{u.role!=='USER'&&<RoleBadge role={u.role}/>}</div>
                          </div>
                        </td>
                        <td className="px-5 py-4 text-[12px] text-gray-500 font-mono">{u.email}</td>
                        <td className="px-5 py-4 text-[13px] font-bold text-gray-900 font-mono">₦{(u.walletBalance||0).toLocaleString()}</td>
                        <td className="px-5 py-4"><StatusBadge status={u.status}/></td>
                        <td className="px-5 py-4"><p className="text-[12px] font-medium text-gray-900">{dayjs(u.createdAt).format('MMM D, YYYY')}</p><p className="text-[11px] text-gray-400">{dayjs(u.createdAt).fromNow()}</p></td>
                        <td className="px-5 py-4">
                          <div className="flex items-center gap-1.5 flex-wrap">
                            {u.status==='ACTIVE'    && <button onClick={()=>setSuspendModal(u)} className="h-8 px-3 rounded-lg bg-amber-50 text-amber-700 border border-amber-200 text-[11px] font-semibold hover:bg-amber-100 transition-colors">Suspend</button>}
                            {u.status==='SUSPENDED' && <button onClick={()=>adminApi.unsuspendUser(u.id).then(()=>{showToast('Unsuspended','success');refetchUsers()}).catch((e:any)=>showToast(e?.response?.data?.message||'Failed','error'))} className="h-8 px-3 rounded-lg bg-gray-100 text-gray-700 text-[11px] font-semibold hover:bg-gray-200 transition-colors">Unsuspend</button>}
                            {u.id!==currentUser?.id && u.status!=='BANNED' && <button onClick={()=>setBanModal(u)} className="h-8 px-3 rounded-lg bg-red-50 text-red-600 border border-red-200 text-[11px] font-semibold hover:bg-red-100 transition-colors">Ban</button>}
                            {u.status==='BANNED'    && <button onClick={()=>handleUnban(u)} disabled={unbanLoadingId===u.id} className="h-8 px-3 rounded-lg bg-gray-100 text-gray-700 text-[11px] font-semibold hover:bg-gray-200 disabled:opacity-50 transition-colors">{unbanLoadingId===u.id?'…':'Unban'}</button>}
                          </div>
                        </td>
                      </tr>
                    ))}
                  </Table>
                </div>
              </div>
            )}

            {/* TRANSACTIONS */}
            {tab==='transactions' && (
              <div className="p-5 space-y-4">
                <div className="flex gap-3 flex-wrap">
                  <div className="relative flex-1 min-w-[200px] max-w-sm">
                    <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"/></svg>
                    <input value={txSearch} onChange={e=>{setTxSearch(e.target.value);setTxPage(1)}} placeholder="Search by email, username or reference…" className="w-full h-10 pl-9 pr-3 bg-white border border-gray-200 rounded-xl text-[13px] placeholder-gray-400 outline-none focus:border-gray-400 transition-all"/>
                  </div>
                  {[
                    { val:txStatus, set:(v:string)=>{setTxStatus(v);setTxPage(1)}, opts:[['','All statuses'],['PENDING','Pending'],['COMPLETED','Completed'],['FAILED','Failed'],['REVERSED','Reversed']] },
                    { val:txType,   set:(v:string)=>{setTxType(v);setTxPage(1)},   opts:[['','All types'],['WALLET_FUNDING','Funding'],['CONTRIBUTION','Contribution'],['PAYOUT','Payout'],['WITHDRAWAL','Withdrawal']] },
                  ].map((f,i) => (
                    <div key={i} className="relative">
                      <select value={f.val} onChange={e=>f.set(e.target.value)} className="h-10 pl-3 pr-8 bg-white border border-gray-200 rounded-xl text-[13px] text-gray-700 font-medium outline-none cursor-pointer appearance-none hover:border-gray-300 transition-colors">
                        {f.opts.map(([v,l])=><option key={v} value={v}>{l}</option>)}
                      </select>
                      <svg className="absolute right-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-400 pointer-events-none" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7"/></svg>
                    </div>
                  ))}
                </div>
                <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
                  {txLoading ? <div className="p-5 space-y-3">{[...Array(5)].map((_,i)=><Skeleton key={i} className="h-14 rounded-xl"/>)}</div>
                  : filteredTx.length===0 ? <div className="py-14 text-center"><p className="text-[13px] text-gray-400">No transactions found</p></div>
                  : (<><Table heads={['User','Type','Amount','Status','Reference','Date']}>
                      {filteredTx.map((tx:any) => (
                        <tr key={tx.id} onClick={()=>setTxDetail(tx)} className="hover:bg-gray-50/60 transition-colors cursor-pointer">
                          <td className="px-5 py-3.5"><p className="text-[13px] font-semibold text-gray-900">@{tx.user?.username||'—'}</p><p className="text-[11px] text-gray-400">{tx.user?.email}</p></td>
                          <td className="px-5 py-3.5 text-[12px] text-gray-700 capitalize whitespace-nowrap">{tx.type?.replace(/_/g,' ').toLowerCase()}</td>
                          <td className="px-5 py-3.5 text-[13px] font-bold font-mono text-gray-900 whitespace-nowrap">₦{Number(tx.amount||0).toLocaleString()}</td>
                          <td className="px-5 py-3.5"><StatusBadge status={tx.status}/></td>
                          <td className="px-5 py-3.5 text-[11px] font-mono text-gray-400 max-w-[180px] truncate">{tx.reference}</td>
                          <td className="px-5 py-3.5 text-[11px] font-mono text-gray-400 whitespace-nowrap">{dayjs(tx.createdAt).format('MMM D, h:mm A')}</td>
                        </tr>
                      ))}
                    </Table><Paginator pag={txPag} page={txPage} setPage={setTxPage}/></>
                  )}
                </div>
              </div>
            )}

            {/* GROUPS */}
            {tab==='groups' && (
              <div className="p-5 space-y-4">
                <div className="relative w-48">
                  <select value={groupStatusFilter} onChange={e=>{setGSF(e.target.value);setGroupPage(1)}} className="w-full h-10 pl-3 pr-8 bg-white border border-gray-200 rounded-xl text-[13px] text-gray-700 outline-none cursor-pointer appearance-none hover:border-gray-300 transition-colors">
                    <option value="">All statuses</option><option value="ACTIVE">Active</option><option value="PAUSED">Paused</option><option value="COMPLETED">Completed</option><option value="CANCELLED">Cancelled</option>
                  </select>
                  <svg className="absolute right-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-400 pointer-events-none" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7"/></svg>
                </div>
                <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
                  {groupsLoading ? <div className="p-5 space-y-3">{[...Array(4)].map((_,i)=><Skeleton key={i} className="h-14 rounded-xl"/>)}</div>
                  : groups.length===0 ? <div className="py-14 text-center"><p className="text-[13px] text-gray-400">No groups found</p></div>
                  : (<><Table heads={['Group','Status','Contribution','Members','Cycle','Actions']}>
                      {groups.map((g:any) => (
                        <tr key={g.id} className="hover:bg-gray-50/60 transition-colors">
                          <td className="px-5 py-4"><p className="text-[13px] font-semibold text-gray-900">{g.name}</p><p className="text-[11px] text-gray-400">/{g.slug}</p>{g.frozenByAdminId&&<span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-red-50 text-red-600 text-[10px] font-semibold border border-red-100 mt-1">🔒 Frozen</span>}</td>
                          <td className="px-5 py-4"><StatusBadge status={g.status}/></td>
                          <td className="px-5 py-4 text-[13px] font-bold font-mono text-gray-900">₦{Number(g.contributionAmount||0).toLocaleString()}</td>
                          <td className="px-5 py-4 text-[13px] text-gray-600">{g._count?.members||0}/{g.maxMembers}</td>
                          <td className="px-5 py-4 text-[13px] text-gray-600">{g.currentCycle}/{g.totalCycles}</td>
                          <td className="px-5 py-4">
                            <div className="flex gap-1.5 flex-wrap">
                              {g.status!=='PAUSED'&&g.status!=='CANCELLED'&&<button onClick={()=>setFreezeModal(g)} className="h-8 px-3 rounded-lg bg-amber-50 text-amber-700 border border-amber-200 text-[11px] font-semibold hover:bg-amber-100 transition-colors">Freeze</button>}
                              {g.status==='PAUSED'&&<button disabled={unfreezeLoadingId===g.id} onClick={()=>handleUnfreeze(g)} className="h-8 px-3 rounded-lg bg-emerald-50 text-emerald-700 border border-emerald-200 text-[11px] font-semibold hover:bg-emerald-100 disabled:opacity-50 transition-colors">{unfreezeLoadingId===g.id?'…':'Unfreeze'}</button>}
                              {g.status!=='CANCELLED'&&<button onClick={()=>setCloseModal(g)} className="h-8 px-3 rounded-lg bg-red-50 text-red-600 border border-red-200 text-[11px] font-semibold hover:bg-red-100 transition-colors">Close</button>}
                            </div>
                          </td>
                        </tr>
                      ))}
                    </Table><Paginator pag={groupPag} page={groupPage} setPage={setGroupPage}/></>
                  )}
                </div>
              </div>
            )}

            {/* CONTRIBUTIONS */}
            {tab==='contributions' && (
              <div className="p-5 space-y-4">
                <div className="relative w-64">
                  <select value={contribStatus} onChange={e=>{setContribStatus(e.target.value);setContribPage(1)}} className="w-full h-10 pl-3 pr-8 bg-white border border-gray-200 rounded-xl text-[13px] text-gray-700 outline-none cursor-pointer appearance-none hover:border-gray-300 transition-colors">
                    <option value="">All statuses</option><option value="FAILED">Failed</option><option value="PENDING">Pending</option><option value="COMPLETED">Completed</option><option value="REVERSED">Reversed</option>
                  </select>
                  <svg className="absolute right-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-400 pointer-events-none" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7"/></svg>
                </div>
                <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
                  {contribLoading ? <div className="p-5 space-y-3">{[...Array(5)].map((_,i)=><Skeleton key={i} className="h-14 rounded-xl"/>)}</div>
                  : contributions.length===0 ? <div className="py-14 text-center"><p className="text-[13px] text-gray-400">No contributions found</p></div>
                  : (<><Table heads={['Member','Email','Amount','Status','Reference','Date']}>
                      {contributions.map((c:any) => (
                        <tr key={c.id} className={`hover:bg-gray-50/60 transition-colors ${c.status==='FAILED'?'bg-red-50/30':c.status==='PENDING'?'bg-amber-50/20':''}`}>
                          <td className="px-5 py-3.5 text-[13px] font-semibold text-gray-900">{c.user?.username||'—'}</td>
                          <td className="px-5 py-3.5 text-[12px] text-gray-400 font-mono">{c.user?.email||'—'}</td>
                          <td className="px-5 py-3.5 text-[13px] font-bold font-mono text-gray-900">₦{Number(c.amount||0).toLocaleString()}</td>
                          <td className="px-5 py-3.5"><StatusBadge status={c.status}/></td>
                          <td className="px-5 py-3.5 text-[11px] text-gray-400 font-mono max-w-[160px] truncate">{c.reference}</td>
                          <td className="px-5 py-3.5 text-[11px] text-gray-400 font-mono whitespace-nowrap">{dayjs(c.createdAt).format('MMM D, YYYY h:mm A')}</td>
                        </tr>
                      ))}
                    </Table><Paginator pag={contribPag} page={contribPage} setPage={setContribPage}/></>
                  )}
                </div>
              </div>
            )}

            {/* FRAUD */}
            {tab==='fraud' && (
              <div className="p-5">
                <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
                  <div className="px-5 py-4 border-b border-gray-100"><p className="text-[15px] font-bold text-gray-900">Fraud & Risk Flags</p></div>
                  {fraudLoading ? <div className="p-5 space-y-3">{[...Array(4)].map((_,i)=><Skeleton key={i} className="h-16 rounded-xl"/>)}</div>
                  : fraudFlags.length===0 ? <div className="py-14 text-center"><p className="text-3xl mb-3">✅</p><p className="text-[13px] text-gray-400">No unresolved fraud flags</p></div>
                  : <div className="divide-y divide-gray-50">
                      {fraudFlags.map((f:any) => (
                        <div key={f.id} className="flex items-center gap-4 px-5 py-4 hover:bg-gray-50/60 transition-colors">
                          <div className="w-10 h-10 rounded-xl bg-red-50 flex items-center justify-center flex-shrink-0">
                            <svg className="w-5 h-5 text-red-500" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"/></svg>
                          </div>
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 mb-0.5"><p className="text-[13px] font-semibold text-gray-900">{f.type}</p><StatusBadge status={f.severity}/></div>
                            <p className="text-[12px] text-gray-500 truncate">{f.description}</p>
                          </div>
                          <button disabled={resolvingId===f.id} onClick={async()=>{setResolvingId(f.id);try{await adminApi.resolveFraud(f.id);showToast('Resolved','success');setFraudFlags(p=>p.filter(x=>x.id!==f.id))}catch{showToast('Failed','error')}finally{setResolvingId(null)}}} className="h-8 px-3 rounded-lg border border-gray-200 text-[12px] font-semibold text-gray-700 hover:bg-gray-50 disabled:opacity-50 transition-colors flex-shrink-0">
                            {resolvingId===f.id?'…':'Resolve'}
                          </button>
                        </div>
                      ))}
                    </div>
                  }
                </div>
              </div>
            )}

            {/* PAYOUTS */}
            {tab==='payouts' && (
              <div className="p-5">
                <div className="bg-white rounded-2xl border border-gray-100 p-8 text-center shadow-sm">
                  <div className="w-14 h-14 rounded-2xl bg-emerald-50 flex items-center justify-center text-2xl mx-auto mb-4">💰</div>
                  <p className="text-[15px] font-bold text-gray-900 mb-2">Pending Payouts</p>
                  <button onClick={()=>adminApi.getPendingPayouts().then(r=>showToast(`${(r.data?.data as any)?.pagination?.total||0} pending payouts loaded`,'info'))} className="h-10 px-5 rounded-xl bg-gray-900 text-white text-[13px] font-semibold hover:bg-gray-800 transition-colors">Load pending payouts</button>
                </div>
              </div>
            )}

            {/* AUDIT */}
            {tab==='audit' && (
              <div className="p-5">
                <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
                  <div className="px-5 py-4 border-b border-gray-100"><p className="text-[15px] font-bold text-gray-900">Audit Log</p></div>
                  {auditLoading ? <div className="p-5 space-y-3">{[...Array(5)].map((_,i)=><Skeleton key={i} className="h-12 rounded-xl"/>)}</div>
                  : auditLogs.length===0 ? <div className="py-14 text-center"><p className="text-[13px] text-gray-400">No log entries yet</p></div>
                  : (<><Table heads={['Actor','Action','Details','Date']}>
                      {auditLogs.map((log:any) => {
                        const meta   = log.metadata || {}
                        const isKyc  = ['KYC_MANUALLY_APPROVED','KYC_MANUALLY_REJECTED','KYC_COMPLETED','KYC_NIN_VERIFIED','KYC_MANUAL_REVIEW','KYC_IDENTITY_REVEALED'].includes(log.action)
                        const reveal = log.action === 'KYC_IDENTITY_REVEALED'
                        return (
                          <tr key={log.id} className={`hover:bg-gray-50/60 transition-colors ${reveal?'bg-purple-50/30':isKyc?'bg-blue-50/30':''}`}>
                            <td className="px-5 py-3.5 text-[12px] text-gray-500 font-mono">{log.user?.username?`@${log.user.username}`:'System'}</td>
                            <td className="px-5 py-3.5">
                              <p className="text-[13px] font-semibold text-gray-900">{log.action?.replace(/_/g,' ')}</p>
                              {reveal  && <span className="text-[10px] px-1.5 py-0.5 bg-purple-100 text-purple-600 rounded font-semibold">🔐 REVEAL</span>}
                              {!reveal && isKyc && <span className="text-[10px] px-1.5 py-0.5 bg-blue-100 text-blue-600 rounded font-semibold">KYC</span>}
                            </td>
                            <td className="px-5 py-3.5 max-w-[300px]">
                              {isKyc ? (
                                <div className="space-y-1">
                                  {log.targetUser   && <p className="text-[12px] font-semibold text-gray-700">→ @{log.targetUser.username} ({log.targetUser.firstName} {log.targetUser.lastName})</p>}
                                  {meta.approvedBy  && <p className="text-[11px] text-emerald-600 font-semibold">✅ Approved by @{meta.approvedBy}{meta.approvedByEmail ? ` · ${meta.approvedByEmail}` : ''}</p>}
                                  {meta.rejectedBy  && <p className="text-[11px] text-red-500 font-semibold">❌ Rejected by @{meta.rejectedBy}{meta.rejectedByEmail ? ` · ${meta.rejectedByEmail}` : ''}</p>}
                                  {meta.reason      && <p className="text-[11px] text-gray-500">Reason: {meta.reason}</p>}
                                  {meta.facePhotoUrl && (
                                    <div className="flex items-center gap-2 mt-1">
                                      <img src={meta.facePhotoUrl} className="w-10 h-10 rounded-lg object-cover border-2 border-purple-200" alt="Face"/>
                                      <span className="text-[10px] text-purple-600 font-semibold">📸 Face captured</span>
                                    </div>
                                  )}
                                </div>
                              ) : (
                                <p className="text-[11px] text-gray-400 font-mono truncate">{log.entityType}{log.entityId?` · ${log.entityId.slice(0,8)}…`:''}</p>
                              )}
                            </td>
                            <td className="px-5 py-3.5 text-[11px] text-gray-400 font-mono whitespace-nowrap">{dayjs(log.createdAt).format('MMM D, h:mm A')}</td>
                          </tr>
                        )
                      })}
                    </Table><Paginator pag={auditPag} page={auditPage} setPage={setAuditPage}/></>
                  )}
                </div>
              </div>
            )}

            {/* KYC REVIEW */}
            {tab==='kyc' && (
              <div className="p-5 space-y-4">
                <div className="bg-blue-50 border border-blue-100 rounded-2xl p-4 flex items-start gap-3">
                  <div className="w-10 h-10 rounded-xl bg-blue-100 flex items-center justify-center text-xl flex-shrink-0">🪪</div>
                  <div>
                    <p className="text-[13px] font-semibold text-blue-800">KYC Identity Records</p>
                    <p className="text-[12px] text-blue-600 mt-0.5">NIN and BVN are masked. Super Admins can reveal full numbers — requires password + face capture (permanently audited).</p>
                  </div>
                </div>
                <div className="relative w-56">
                  <select value={kycStatusFilter} onChange={e=>setKycStatusFilter(e.target.value)} className="w-full h-10 pl-3 pr-8 bg-white border border-gray-200 rounded-xl text-[13px] text-gray-700 outline-none cursor-pointer appearance-none hover:border-gray-300 transition-colors">
                    <option value="">All statuses</option>
                    <option value="MANUAL_REVIEW">⏳ Manual Review</option>
                    <option value="VERIFIED">✅ Verified</option>
                    <option value="REJECTED">❌ Rejected</option>
                    <option value="PENDING">Pending</option>
                  </select>
                  <svg className="absolute right-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-400 pointer-events-none" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7"/></svg>
                </div>
                <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
                  {kycLoading ? <div className="p-5 space-y-3">{[...Array(3)].map((_,i)=><Skeleton key={i} className="h-16 rounded-xl"/>)}</div>
                  : kycRecords.length===0 ? <div className="py-14 text-center"><p className="text-3xl mb-3">✅</p><p className="text-[14px] font-semibold text-gray-800">No records</p></div>
                  : (
                    <Table heads={['User','Identity on file','NIN','BVN','Status','Note','Updated','Actions']}>
                      {kycRecords.map((r:any) => (
                        <tr key={r.id} className={`hover:bg-gray-50/60 transition-colors ${r.status==='MANUAL_REVIEW'?'bg-orange-50/20':r.status==='REJECTED'?'bg-red-50/20':r.status==='VERIFIED'?'bg-emerald-50/20':''}`}>
                          <td className="px-5 py-4">
                            <div className="flex items-center gap-3">
                              <UserAvatar firstName={r.user?.firstName} lastName={r.user?.lastName}/>
                              <div><p className="text-[13px] font-semibold text-gray-900">{r.user?.firstName} {r.user?.lastName}</p><p className="text-[11px] text-gray-400">@{r.user?.username}</p><p className="text-[11px] text-gray-400 font-mono">{r.user?.email}</p></div>
                            </div>
                          </td>
                          <td className="px-5 py-4 min-w-[150px]">
                            {(r.firstName||r.lastName) ? (
                              <div><p className="text-[13px] font-semibold text-gray-900">{r.firstName} {r.lastName}</p>{r.dateOfBirth&&<p className="text-[11px] text-gray-400 mt-0.5">DOB: {r.dateOfBirth}</p>}{r.phone&&<p className="text-[11px] text-gray-400">📱 {r.phone}</p>}</div>
                            ) : <span className="text-[12px] text-gray-300">—</span>}
                          </td>
                          <td className="px-5 py-4">
                            <p className="text-[13px] font-mono text-gray-700">{r.ninMasked||'—'}</p>
                            {r.ninVerified?<span className="text-[10px] font-semibold text-blue-500">✓ verified</span>:<span className="text-[10px] text-gray-300">not verified</span>}
                          </td>
                          <td className="px-5 py-4">
                            <p className="text-[13px] font-mono text-gray-700">{r.bvnMasked||'—'}</p>
                            {r.bvnVerified?<span className="text-[10px] font-semibold text-blue-500">✓ verified</span>:<span className="text-[10px] text-gray-300">not verified</span>}
                          </td>
                          <td className="px-5 py-4"><StatusBadge status={r.status}/></td>
                          <td className="px-5 py-4 max-w-[160px]"><p className="text-[11px] text-gray-500 leading-relaxed">{r.rejectionReason||'—'}</p></td>
                          <td className="px-5 py-4 text-[11px] text-gray-400 font-mono whitespace-nowrap">{dayjs(r.updatedAt).format('MMM D, h:mm A')}</td>
                          <td className="px-5 py-4">
                            <div className="flex flex-col gap-1.5">
                              {r.status==='MANUAL_REVIEW' && (
                                <div className="flex gap-1.5">
                                  <button disabled={kycActionLoading===r.userId} onClick={()=>handleKycApprove(r)} className="h-8 px-3 rounded-lg bg-emerald-50 text-emerald-700 border border-emerald-200 text-[11px] font-semibold hover:bg-emerald-100 disabled:opacity-50 transition-colors">{kycActionLoading===r.userId?'…':'Approve'}</button>
                                  <button onClick={()=>setKycRejectModal(r)} className="h-8 px-3 rounded-lg bg-red-50 text-red-600 border border-red-200 text-[11px] font-semibold hover:bg-red-100 transition-colors">Reject</button>
                                </div>
                              )}
                              {r.status==='VERIFIED' && <span className="text-[11px] text-emerald-600 font-semibold">✅ Verified</span>}
                              {r.status==='REJECTED' && <span className="text-[11px] text-red-500 font-semibold">❌ Rejected</span>}
              {(currentUser?.role === 'ADMIN' || currentUser?.role === 'SUPER_ADMIN') && (
                                <button onClick={()=>openRevealModal(r)} className="h-7 px-2.5 rounded-lg bg-purple-50 text-purple-700 border border-purple-200 text-[10px] font-semibold hover:bg-purple-100 transition-colors whitespace-nowrap">
                                  🔐 Reveal
                                </button>
                              )}
                            </div>
                          </td>
                        </tr>
                      ))}
                    </Table>
                  )}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Transaction detail */}
      <Modal open={!!txDetail} onClose={()=>setTxDetail(null)} title="Transaction Details" size="sm" footer={<Button onClick={()=>setTxDetail(null)}>Close</Button>}>
        {txDetail && (
          <div className="space-y-3">
            <div className="text-center py-4">
              <div className={`w-12 h-12 rounded-2xl mx-auto flex items-center justify-center text-xl mb-3 ${txDetail.status==='COMPLETED'?'bg-emerald-50':txDetail.status==='FAILED'?'bg-red-50':'bg-amber-50'}`}>
                {txDetail.status==='COMPLETED'?'✓':txDetail.status==='FAILED'?'✕':'⏳'}
              </div>
              <p className="text-[26px] font-bold tabular-nums text-gray-900">₦{Number(txDetail.amount).toLocaleString()}</p>
              <div className="mt-1"><StatusBadge status={txDetail.status}/></div>
            </div>
            <div className="bg-gray-50 rounded-xl p-4 space-y-2.5">
              {[['Reference', txDetail.reference||'—'],['Type', txDetail.type?.replace(/_/g,' ')],['User', `@${txDetail.user?.username||'—'}`],['Date', dayjs(txDetail.createdAt).format('MMM D, YYYY h:mm A')]].map(([l,v])=>(
                <div key={l} className="flex justify-between gap-4"><span className="text-[12px] text-gray-400 flex-shrink-0">{l}</span><span className="text-[12px] font-medium text-gray-900 text-right break-all">{v}</span></div>
              ))}
            </div>
          </div>
        )}
      </Modal>

      {/* Escalation review */}
      <Modal open={!!queueDetail} onClose={()=>{setQueueDetail(null);setResolution('');setRS('RESOLVED')}} title="Review escalated case" size="md">
        <div className="space-y-4">
          <div className="bg-orange-50 border border-orange-100 rounded-xl p-4">
            <p className="text-[13px] text-gray-900">{queueDetail?._kind==='ticket'?`"${queueDetail?.subject}"`:queueDetail?.type}</p>
          </div>
          <p className="text-[13px] text-gray-600 leading-relaxed">{queueDetail?.description||queueDetail?.subject}</p>
          {queueDetail?._kind==='dispute'&&!['RESOLVED','DISMISSED','CLOSED'].includes(queueDetail?.status)&&(
            <div className="bg-gray-50 rounded-xl p-4 space-y-3">
              <select value={resolveStatus} onChange={e=>setRS(e.target.value)} className="h-9 w-full border border-gray-200 rounded-lg px-3 text-[13px] text-gray-900 bg-white outline-none cursor-pointer">
                <option value="RESOLVED">Resolved</option><option value="DISMISSED">Dismissed</option><option value="CLOSED">Closed</option>
              </select>
              <textarea value={resolution} onChange={e=>setResolution(e.target.value)} rows={3} placeholder="What was the outcome?" className="w-full border border-gray-200 rounded-xl px-4 py-2.5 text-[13px] text-gray-900 outline-none focus:border-gray-400 resize-none transition-all"/>
              <button disabled={!resolution.trim()||resolveLoading} onClick={handleResolveCase} className="h-9 px-4 rounded-lg bg-red-500 text-white text-[12px] font-semibold hover:bg-red-600 disabled:opacity-40 transition-colors">{resolveLoading?'Closing…':'Close case'}</button>
            </div>
          )}
        </div>
      </Modal>

      {/* Suspend */}
      <Modal open={!!suspendModal} onClose={()=>setSuspendModal(null)} title={`Suspend ${suspendModal?.firstName}?`} size="sm" footer={<><Button variant="secondary" onClick={()=>setSuspendModal(null)}>Cancel</Button><Button variant="danger" onClick={handleSuspend} loading={suspendUser.isPending} disabled={!suspendReason.trim()}>Suspend</Button></>}>
        <p className="text-[13px] text-gray-500 mb-4">This revokes all active sessions.</p>
        <Input label="Reason" placeholder="e.g. Suspicious payment activity" value={suspendReason} onChange={e=>setSuspendReason(e.target.value)}/>
      </Modal>

      {/* Ban */}
      <Modal open={!!banModal} onClose={()=>{setBanModal(null);setBanReason('')}} title={`Ban ${banModal?.firstName}?`} size="sm" footer={<><Button variant="secondary" onClick={()=>{setBanModal(null);setBanReason('')}}>Cancel</Button><Button variant="danger" onClick={handleBan} loading={banLoading} disabled={!banReason.trim()}>Ban user</Button></>}>
        <div className="bg-red-50 border border-red-100 rounded-xl p-4 mb-4"><p className="text-[13px] font-semibold text-red-600">Permanent ban — only Super Admin can reverse.</p></div>
        <Input label="Reason" value={banReason} onChange={e=>setBanReason(e.target.value)}/>
      </Modal>

      {/* Freeze */}
      <Modal open={!!freezeModal} onClose={()=>{setFreezeModal(null);setFreezeReason('')}} title={`Freeze ${freezeModal?.name}?`} size="sm" footer={<><Button variant="secondary" onClick={()=>{setFreezeModal(null);setFreezeReason('')}}>Cancel</Button><Button variant="danger" loading={freezeLoading} disabled={!freezeReason.trim()} onClick={async()=>{if(!freezeModal||!freezeReason.trim())return;setFreezeLoading(true);try{await adminApi.freezeGroup(freezeModal.id,freezeReason);showToast(`${freezeModal.name} frozen`,'success');setFreezeModal(null);setFreezeReason('');loadGroups()}catch(e:any){showToast(e?.response?.data?.message||'Failed','error')}finally{setFreezeLoading(false)}}}>Freeze</Button></>}>
        <Input label="Reason" value={freezeReason} onChange={e=>setFreezeReason(e.target.value)}/>
      </Modal>

      {/* Close group */}
      <Modal open={!!closeModal} onClose={()=>{setCloseModal(null);setCloseReason('')}} title={`Close ${closeModal?.name}?`} size="sm" footer={<><Button variant="secondary" onClick={()=>{setCloseModal(null);setCloseReason('')}}>Cancel</Button><Button variant="danger" loading={closeLoading} disabled={!closeReason.trim()} onClick={async()=>{if(!closeModal||!closeReason.trim())return;setCloseLoading(true);try{await adminApi.closeGroup(closeModal.id,closeReason);showToast(`${closeModal.name} closed`,'success');setCloseModal(null);setCloseReason('');loadGroups()}catch(e:any){showToast(e?.response?.data?.message||'Failed','error')}finally{setCloseLoading(false)}}}>Close group</Button></>}>
        <Input label="Reason" value={closeReason} onChange={e=>setCloseReason(e.target.value)}/>
      </Modal>

      {/* KYC Reject */}
      <Modal open={!!kycRejectModal} onClose={()=>{setKycRejectModal(null);setKycRejectReason('')}} title={`Reject KYC for ${kycRejectModal?.user?.firstName}?`} size="sm" footer={<><Button variant="secondary" onClick={()=>{setKycRejectModal(null);setKycRejectReason('')}}>Cancel</Button><Button variant="danger" onClick={handleKycReject} disabled={!kycRejectReason.trim()}>Continue to face scan →</Button></>}>
        <div className="space-y-4">
          <div className="bg-red-50 border border-red-100 rounded-xl p-4"><p className="text-[13px] font-semibold text-red-600">User will be notified and can resubmit. Your face will be captured for the audit log.</p></div>
          <Input label="Rejection reason" placeholder="e.g. NIN and BVN names do not match" value={kycRejectReason} onChange={e=>setKycRejectReason(e.target.value)}/>
        </div>
      </Modal>

      {/* ══ KYC APPROVE/REJECT — face capture modal ══ */}
      <Modal
        open={!!pendingKycAction}
        onClose={closeKycActionModal}
        title={pendingKycAction?.action === 'approve' ? `📸 Approving ${pendingKycAction?.record?.user?.firstName} — Face capture` : `📸 Rejecting ${pendingKycAction?.record?.user?.firstName} — Face capture`}
        size="sm"
        footer={<Button variant="secondary" onClick={closeKycActionModal} disabled={actionLoading}>Cancel</Button>}
      >
        <div className="space-y-4">
          <div className="bg-amber-50 border border-amber-100 rounded-xl p-3">
            <p className="text-[12px] font-semibold text-amber-700">Liveness check — blink, turn, smile</p>
            <p className="text-[11px] text-amber-600 mt-0.5">Your photo is stored in the audit log with this {pendingKycAction?.action === 'approve' ? 'approval' : 'rejection'}.</p>
          </div>
          {actionLoading ? (
            <div className="flex items-center gap-2 text-[13px] text-gray-500 bg-gray-50 rounded-xl p-3">
              <div className="w-4 h-4 border-2 border-gray-300 border-t-gray-700 rounded-full animate-spin flex-shrink-0"/>
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

      {/* ══ NIN/BVN REVEAL — 3 step modal ══ */}
      <Modal
        open={!!revealModal}
        onClose={closeRevealModal}
        title={revealStep==='password'?'🔐 Reveal NIN/BVN — Step 1 of 2':revealStep==='camera'?'📸 Reveal NIN/BVN — Step 2 of 2':'✅ Identity Revealed'}
        size="sm"
        footer={
          revealStep==='password' ? (
            <><Button variant="secondary" onClick={closeRevealModal}>Cancel</Button><Button onClick={handlePasswordSubmit} disabled={!revealPassword.trim()}>Continue to face scan →</Button></>
          ) : revealStep==='camera' ? (
            <Button variant="secondary" onClick={closeRevealModal} disabled={revealLoading}>Cancel</Button>
          ) : (
            <Button onClick={closeRevealModal}>Close</Button>
          )
        }
      >
        {/* STEP 1: Password */}
        {revealStep==='password' && (
          <div className="space-y-4">
            <div className="bg-purple-50 border border-purple-100 rounded-xl p-4">
              <p className="text-[13px] font-semibold text-purple-700 mb-1">🔒 Sensitive data access</p>
              <p className="text-[12px] text-purple-600">Enter your password. Then your face photo will be captured and stored permanently in the audit log before NIN/BVN is shown.</p>
            </div>
            <div className="bg-gray-50 rounded-xl p-3 space-y-0.5">
              <p className="text-[13px] font-semibold text-gray-900">{revealModal?.user?.firstName} {revealModal?.user?.lastName}</p>
              <p className="text-[11px] text-gray-400 font-mono">{revealModal?.user?.email}</p>
              <p className="text-[11px] text-gray-400">NIN: <span className="font-mono">{revealModal?.ninMasked||'—'}</span> · BVN: <span className="font-mono">{revealModal?.bvnMasked||'—'}</span></p>
            </div>
            <Input label="Your Super Admin password" type="password" placeholder="Enter your password" value={revealPassword} onChange={e=>setRevealPassword(e.target.value)}/>
            {cameraError && <p className="text-[12px] text-red-500 bg-red-50 rounded-lg p-3">{cameraError}</p>}
          </div>
        )}

        {/* STEP 2: Camera */}
        {revealStep==='camera' && (
          <div className="space-y-4">
            <div className="bg-amber-50 border border-amber-100 rounded-xl p-3">
              <p className="text-[12px] font-semibold text-amber-700">Liveness check — prove it's really you</p>
              <p className="text-[11px] text-amber-600 mt-0.5">Blink, turn your head, and smile. The photo is only taken after all checks pass, and is permanently stored in the audit trail.</p>
            </div>
            {revealLoading ? (
              <div className="flex items-center gap-2 text-[13px] text-gray-500 bg-gray-50 rounded-xl p-3">
                <div className="w-4 h-4 border-2 border-gray-300 border-t-gray-700 rounded-full animate-spin flex-shrink-0"/>
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
        {revealStep==='revealed' && (
          <div className="space-y-4">
            <div className="bg-amber-50 border border-amber-100 rounded-xl p-3">
              <p className="text-[12px] text-amber-700 font-semibold">⚠️ This access is permanently logged. Do not share this data.</p>
            </div>
            {revealFaceUrl && (
              <div className="flex items-center gap-3 bg-purple-50 rounded-xl p-3">
                <img src={revealFaceUrl} className="w-14 h-14 rounded-xl object-cover border-2 border-purple-200" style={{ transform:'scaleX(-1)' }} alt="Face capture"/>
                <div><p className="text-[12px] font-semibold text-purple-700">Face captured & stored ✅</p><p className="text-[11px] text-purple-400">Visible in audit log</p></div>
              </div>
            )}
            <div className="bg-gray-50 rounded-xl p-4 space-y-3">
              <div>
                <p className="text-[11px] font-semibold text-gray-400 uppercase tracking-wider mb-1">NIN</p>
                <p className="text-[24px] font-bold font-mono text-gray-900 tracking-widest">{revealData?.nin||'—'}</p>
              </div>
              <div className="border-t border-gray-100 pt-3">
                <p className="text-[11px] font-semibold text-gray-400 uppercase tracking-wider mb-1">BVN</p>
                <p className="text-[24px] font-bold font-mono text-gray-900 tracking-widest">{revealData?.bvn||'—'}</p>
              </div>
              <div className="border-t border-gray-100 pt-3">
                <p className="text-[11px] font-semibold text-gray-400 uppercase tracking-wider mb-1">Identity on file</p>
                <p className="text-[13px] font-semibold text-gray-900">{revealModal?.firstName} {revealModal?.lastName}</p>
                {revealModal?.dateOfBirth&&<p className="text-[12px] text-gray-500">DOB: {revealModal.dateOfBirth}</p>}
              </div>
            </div>
          </div>
        )}
      </Modal>
    </DashboardLayout>
  )
}