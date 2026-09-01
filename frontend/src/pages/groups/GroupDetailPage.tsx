import { useState, useEffect } from 'react'
import { useParams, Link, useNavigate } from 'react-router-dom'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { motion, AnimatePresence } from 'framer-motion'
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer } from 'recharts'
import DashboardLayout from '@/components/layout/DashboardLayout'
import { Button, Badge, Avatar, Skeleton, EmptyState, Modal, Input, Select } from '@/components/ui'
import GroupChat from '@/components/chat/GroupChat'
import { useGroup, useGroupAnalytics, useJoinGroup } from '@/hooks/useApi'
import { useAuthStore } from '@/stores/authStore'
import { useUIStore } from '@/stores/uiStore'
import { groupsApi, disputesApi } from '@/api/services'
import type { GroupMember, Contribution } from '@/types'
import dayjs from 'dayjs'
import { nanoid } from 'nanoid'

const fmt = (n: number) => `₦${Number(n).toLocaleString()}`
const EASE = [0.16, 1, 0.3, 1] as const

// Shared frequency labels — used everywhere so nothing says the wrong word.
const FREQ_LABEL: Record<string, string> = { DAILY: 'Daily', WEEKLY: 'Weekly', BIWEEKLY: 'Bi-weekly', MONTHLY: 'Monthly', CUSTOM: 'Custom' }
// "per day / per week / …" phrasing
const FREQ_PER: Record<string, string> = { DAILY: 'day', WEEKLY: 'week', BIWEEKLY: '2 weeks', MONTHLY: 'month', CUSTOM: 'cycle' }
// "every day / every week / …" phrasing for payout
const FREQ_EVERY: Record<string, string> = { DAILY: 'every day', WEEKLY: 'every week', BIWEEKLY: 'every 2 weeks', MONTHLY: 'every month', CUSTOM: 'each cycle' }

function statusVariant(s: string) {
  const m: Record<string, any> = { PAID: 'success', PENDING: 'warning', OVERDUE: 'danger', ACTIVE: 'success', REMOVED: 'neutral' }
  return m[s] || 'neutral'
}

// Payout status → badge styling, used in the new payout history list.
function payoutStatusBadge(status: string) {
  const cfg: Record<string, string> = {
    COMPLETED:  'bg-emerald-50 text-emerald-700',
    PROCESSING: 'bg-blue-50 text-blue-700',
    SCHEDULED:  'bg-amber-50 text-amber-700',
    FAILED:     'bg-red-50 text-red-600',
    CANCELLED:  'bg-gray-100 text-gray-500',
  }
  return cfg[status] || 'bg-gray-100 text-gray-500'
}

type Tab = 'overview' | 'members' | 'contributions' | 'payouts' | 'activity' | 'chat' | 'analytics' | 'settings'

const editSchema = z.object({
  name:          z.string().min(3).max(60),
  description:   z.string().max(300).optional(),
  visibility:    z.enum(['PUBLIC', 'PRIVATE', 'INVITE_ONLY']),
  deadlineDays:  z.coerce.number().min(1).max(10).optional(),
  penaltyAmount: z.coerce.number().min(0).optional(),
})
type EditData = z.infer<typeof editSchema>

const VIS_OPTS = [
  { value: 'PUBLIC',      label: 'Public — anyone can join'     },
  { value: 'PRIVATE',     label: 'Private — invite code only'   },
  { value: 'INVITE_ONLY', label: 'Invite only — admin approves' },
]

const GROUP_REPORT_TYPES  = ['Fraudulent activity','Missed payouts','Fake information','Harassment','Suspicious behavior','Other']
const MEMBER_REPORT_TYPES = ['Harassment','Spam','Fraudulent activity','Failure to meet obligations','Inappropriate conduct','Other']

const PALETTE = ['#22C55E','#3B82F6','#F59E0B','#8B5CF6','#EC4899','#14B8A6']

function SBadge({ status }: { status: string }) {
  const cfg: any = {
    ACTIVE:    { label: 'Active',    cls: 'bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200' },
    PAUSED:    { label: 'Paused',    cls: 'bg-amber-50 text-amber-700 ring-1 ring-amber-200' },
    DRAFT:     { label: 'Draft',     cls: 'bg-gray-100 text-gray-500 ring-1 ring-gray-200' },
    COMPLETED: { label: 'Completed', cls: 'bg-blue-50 text-blue-700 ring-1 ring-blue-200' },
  }
  const c = cfg[status] || { label: status, cls: 'bg-gray-100 text-gray-500' }
  return <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-[11px] font-semibold ${c.cls}`}>{c.label}</span>
}

// ── Reusable "group terms" summary — shows contribution, payout, position, late fee ──
function GroupTerms({ group, myMemberInfo }: { group: any; myMemberInfo: any }) {
  const contribFreq = FREQ_LABEL[group.frequency] || group.frequency
  const payoutFreq  = FREQ_LABEL[group.payoutFrequency] || FREQ_LABEL[group.frequency] || group.frequency
  const perWord     = FREQ_PER[group.frequency] || 'cycle'
  const lateFee     = Number(group.penaltyAmount || 0)
  const estPayout   = myMemberInfo?.estimatedPayoutAmount != null
    ? Number(myMemberInfo.estimatedPayoutAmount) / 100
    : (group.contributionAmount || 0) * (group.maxMembers || 0)

  const rows: { label: string; val: string; hint?: string }[] = [
    { label: 'You contribute', val: `${fmt(group.contributionAmount)} per ${perWord}`, hint: `${contribFreq} contribution` },
    { label: 'Payout schedule', val: `A member is paid ${FREQ_EVERY[group.payoutFrequency] || FREQ_EVERY[group.frequency] || 'each cycle'}`, hint: `${payoutFreq} payout` },
    { label: 'Members', val: `${group.memberCount} / ${group.maxMembers}` },
    { label: 'Total rounds', val: `${group.totalCycles} rounds (everyone collects once)` },
  ]
  if (myMemberInfo) {
    rows.push({ label: 'Your payout position', val: `#${myMemberInfo.payoutPosition}` })
    if (myMemberInfo.estimatedPayoutAmount != null)
      rows.push({ label: 'Your expected payout', val: fmt(estPayout) })
    if (myMemberInfo.expectedPayoutDate)
      rows.push({ label: 'Expected payout date', val: dayjs(myMemberInfo.expectedPayoutDate).format('MMM D, YYYY') })
  }
  rows.push({ label: 'Late fee', val: lateFee > 0 ? `${fmt(lateFee)} if you miss the deadline` : 'None' })
  rows.push({ label: 'Payment deadline', val: `${group.deadlineDays || 3} day(s) after each cycle starts` })
  rows.push({ label: 'Grace period', val: '48 hours to fix a missed payment before removal' })

  return (
    <div className="bg-white rounded-2xl border border-gray-100 p-5 shadow-sm">
      <p className="text-[14px] font-bold text-gray-900 mb-4">Group terms</p>
      <div className="space-y-2.5">
        {rows.map(r => (
          <div key={r.label} className="flex items-start justify-between gap-4 py-1.5 border-b border-gray-50 last:border-0">
            <span className="text-[12px] text-gray-400 flex-shrink-0">{r.label}</span>
            <span className="text-[12.5px] font-semibold text-gray-900 text-right">{r.val}</span>
          </div>
        ))}
      </div>
    </div>
  )
}

function ContribRow({ c, isAdmin }: { c: Contribution; isAdmin: boolean }) {
  const initials = ((c.user?.firstName?.[0] || '') + (c.user?.lastName?.[0] || '')).toUpperCase() || '?'
  return (
    <div className="flex items-center gap-3 py-3 border-b border-gray-50 last:border-0">
      <div className="w-9 h-9 rounded-full bg-emerald-100 flex items-center justify-center text-[12px] font-bold text-emerald-700 flex-shrink-0">{initials}</div>
      <div className="flex-1 min-w-0">
        <p className="text-[13px] font-semibold text-gray-900">{c.user?.firstName} {c.user?.lastName}</p>
        <p className="text-[11px] text-gray-400">{c.paidAt ? dayjs(c.paidAt).format('MMM D, YYYY · h:mm A') : `Due ${dayjs(c.dueDate).format('MMM D')}`}</p>
      </div>
      <p className="text-[13px] font-bold text-gray-900 tabular-nums">{fmt(c.amount)}</p>
      <span className={`text-[11px] font-semibold px-2 py-0.5 rounded-full ${c.status === 'PAID' ? 'bg-emerald-50 text-emerald-700' : c.status === 'OVERDUE' ? 'bg-red-50 text-red-600' : 'bg-amber-50 text-amber-700'}`}>
        {c.status === 'PAID' ? 'Paid' : c.status.charAt(0) + c.status.slice(1).toLowerCase()}
      </span>
    </div>
  )
}

// ── Payout history row — real payout record from GET /groups/:id/payouts ──
function PayoutRow({ p }: { p: any }) {
  const recipient = p.recipient || {}
  const initials = ((recipient.firstName?.[0] || '') + (recipient.lastName?.[0] || '')).toUpperCase() || '?'
  const dateLabel = p.completedAt ? dayjs(p.completedAt).format('MMM D, YYYY · h:mm A')
    : p.scheduledDate ? `Scheduled ${dayjs(p.scheduledDate).format('MMM D, YYYY')}`
    : '—'
  return (
    <div className="flex items-center gap-3 px-5 py-3.5 border-b border-gray-50 last:border-0">
      <div className="w-9 h-9 rounded-full bg-emerald-100 flex items-center justify-center text-[12px] font-bold text-emerald-700 flex-shrink-0">{initials}</div>
      <div className="flex-1 min-w-0">
        <p className="text-[13px] font-semibold text-gray-900">{recipient.firstName} {recipient.lastName}</p>
        <p className="text-[11px] text-gray-400">Cycle {p.cycleNumber} · {dateLabel}</p>
      </div>
      <p className="text-[13px] font-bold text-gray-900 tabular-nums">{fmt(p.amount)}</p>
      <span className={`text-[11px] font-semibold px-2 py-0.5 rounded-full ${payoutStatusBadge(p.status)}`}>
        {p.status.charAt(0) + p.status.slice(1).toLowerCase()}
      </span>
    </div>
  )
}

export default function GroupDetailPage() {
  const { slug } = useParams<{ slug: string }>()
  const { user } = useAuthStore()
  const { showToast } = useUIStore()
  const navigate = useNavigate()
  const [tab, setTab] = useState<Tab>('overview')
  const [agreementModal, setAgreementModal] = useState(false)
  const [agreementChecked, setAgreementChecked] = useState(false)
  const [agreementLoading, setAgreementLoading] = useState(false)
  const [pendingJoinAction, setPendingJoinAction] = useState<null | 'direct' | 'request' | 'code'>(null)

  const [pinModal, setPinModal]             = useState(false)
  const [pin, setPin]                       = useState('')
  const [pinLoading, setPinLoading]         = useState(false)
  const [createPinModal, setCreatePinModal] = useState(false)
  const [newPin, setNewPin]                 = useState('')
  const [confirmPin, setConfirmPin]         = useState('')
  const [createPinLoading, setCreatePinLoading] = useState(false)
  const [createPinError, setCreatePinError] = useState('')
  const [inviteData, setInviteData]         = useState<any>(null)
  const [inviteGenerating, setInviteGenerating] = useState(false)
  const [codeModal, setCodeModal]           = useState(false)
  const [inviteCode, setInviteCode]         = useState('')
  const [codeError, setCodeError]           = useState('')
  const [editOpen, setEditOpen]             = useState(false)
  const [editLoading, setEditLoading]       = useState(false)
  const [chatLockLoading, setChatLockLoading] = useState(false)
  const [removeTarget, setRemoveTarget]     = useState<GroupMember | null>(null)
  const [removeLoading, setRemoveLoading]   = useState(false)
  const [approveTarget, setApproveTarget]   = useState<GroupMember | null>(null)
  const [approveLoading, setApproveLoading] = useState(false)
  const [rejectTarget, setRejectTarget]     = useState<GroupMember | null>(null)
  const [rejectLoading, setRejectLoading]   = useState(false)
  const [banTarget, setBanTarget]           = useState<GroupMember | null>(null)
  const [banReason, setBanReason]           = useState('')
  const [banLoading, setBanLoading]         = useState(false)
  const [transferTarget, setTransferTarget] = useState<GroupMember | null>(null)
  const [transferLoading, setTransferLoading] = useState(false)
  const [reorderOpen, setReorderOpen]       = useState(false)
  const [reorderLoading, setReorderLoading] = useState(false)
  const [dragOrder, setDragOrder]           = useState<GroupMember[]>([])
  const [dragIdx, setDragIdx]               = useState<number | null>(null)
  const [dragOverIdx, setDragOverIdx]       = useState<number | null>(null)
  const [lifecycleLoading, setLifecycleLoading] = useState(false)
  const [deleteLoading, setDeleteLoading]   = useState(false)
  const [reportCategory, setReportCategory] = useState('')
  const [reportDescription, setReportDescription] = useState('')
  const [reportLoading, setReportLoading]   = useState(false)
  const [memberReportTarget, setMemberReportTarget] = useState<GroupMember | null>(null)
  const [memberReportCategory, setMemberReportCategory] = useState('')
  const [memberReportDescription, setMemberReportDescription] = useState('')
  const [memberReportLoading, setMemberReportLoading] = useState(false)

  // ── Contributions tab: per-cycle browsing ──
  const [selectedCycle, setSelectedCycle]         = useState<number | null>(null)
  const [cycleContributions, setCycleContributions] = useState<Contribution[] | null>(null)
  const [cycleLoading, setCycleLoading]            = useState(false)

  // ── Payouts tab: full history from GET /groups/:id/payouts ──
  const [payoutHistory, setPayoutHistory]   = useState<any[] | null>(null)
  const [payoutsLoading, setPayoutsLoading] = useState(false)

  const { data: group, isLoading, refetch } = useGroup(slug!)
  const { data: analytics } = useGroupAnalytics(group?.id || '')
  const joinGroup = useJoinGroup()

  const myMembership = group?.members?.find((m: GroupMember) => m.userId === user?.id)
  const myMemberInfo = (group as any)?.myMemberInfo
  const isMember     = !!myMembership && myMembership.status === 'ACTIVE'
  const isPending    = myMembership?.status === 'PENDING'
  const isAdmin      = myMembership?.role === 'ADMIN' || myMembership?.role === 'MODERATOR'
  const isOwner      = myMembership?.role === 'ADMIN' && group?.ownerId === user?.id
  const isFull       = group && group.memberCount >= group.maxMembers
  const isFrozen     = !!(group as any)?.frozenByAdminId
  const cycleStarted = (group?.currentCycle || 0) > 0
  const canReorder   = isAdmin && (group?.currentCycle === 0 || group?.status === 'DRAFT')
  const myPending    = group?.contributions?.find((c: Contribution) => c.userId === user?.id && ['PENDING','OVERDUE'].includes(c.status))
  const chatMembers  = (group?.members || []).map((m: GroupMember) => ({ id: m.userId, username: m.user.username, firstName: m.user.firstName, lastName: m.user.lastName, avatarUrl: m.user.avatarUrl }))

  const totalPool  = (group?.contributionAmount || 0) * (group?.memberCount || 0)
  const collected  = group?.contributions?.filter((c: Contribution) => c.status === 'PAID').reduce((s: number, c: Contribution) => s + c.amount, 0) || 0
  const remaining  = totalPool - collected
  const completion = totalPool > 0 ? Math.round((collected / totalPool) * 100) : 0
  const cyclePct   = group?.totalCycles > 0 ? Math.round((group.currentCycle / group.totalCycles) * 100) : 0

  // Default the cycle selector to the group's current cycle once it loads.
  useEffect(() => {
    if (group?.currentCycle && selectedCycle === null) setSelectedCycle(group.currentCycle)
  }, [group?.currentCycle, selectedCycle])

  // Fetch contributions for whichever cycle is selected, whenever the
  // Contributions tab is open. Cycle 0 means the group hasn't started yet.
  useEffect(() => {
    if (tab !== 'contributions' || !group?.id || !selectedCycle) return
    setCycleLoading(true)
    groupsApi.getContributionsByCycle(group.id, selectedCycle)
      .then(res => setCycleContributions((res.data as any)?.data || res.data || []))
      .catch(() => showToast('Could not load contributions for that cycle', 'error'))
      .finally(() => setCycleLoading(false))
  }, [tab, group?.id, selectedCycle])

  // Fetch the group's full payout history whenever the Payouts tab is opened.
  useEffect(() => {
    if (tab !== 'payouts' || !group?.id) return
    setPayoutsLoading(true)
    groupsApi.getPayoutHistory(group.id)
      .then(res => setPayoutHistory((res.data as any)?.data || res.data || []))
      .catch(() => showToast('Could not load payout history', 'error'))
      .finally(() => setPayoutsLoading(false))
  }, [tab, group?.id])

  const { register: regEdit, handleSubmit: handleEditSubmit, formState: { errors: editErrors }, reset: resetEdit } = useForm<EditData>({ resolver: zodResolver(editSchema) })

  const openEdit      = () => { if (!group) return; resetEdit({ name: group.name, description: group.description || '', visibility: group.visibility, deadlineDays: group.deadlineDays || 3, penaltyAmount: group.penaltyAmount || 0 }); setEditOpen(true) }
  const onEditSubmit  = async (data: EditData) => { if (!group) return; setEditLoading(true); try { await groupsApi.updateGroup(group.id, data); showToast('Settings updated', 'success'); setEditOpen(false); refetch() } catch (err: any) { showToast(err?.response?.data?.message || 'Failed', 'error') } finally { setEditLoading(false) } }
  const handleToggleChat  = async () => { if (!group) return; setChatLockLoading(true); try { await groupsApi.updateGroup(group.id, { chatEnabled: !group.chatEnabled }); showToast(group.chatEnabled ? 'Chat locked' : 'Chat unlocked', 'success'); refetch() } catch (err: any) { showToast(err?.response?.data?.message || 'Failed', 'error') } finally { setChatLockLoading(false) } }
  const handleContribute  = () => { if (!user?.hasTransactionPin) { setNewPin(''); setConfirmPin(''); setCreatePinError(''); setCreatePinModal(true); return } setPin(''); setPinModal(true) }
  const handleCreatePin   = async () => { if (newPin.length !== 4) { setCreatePinError('PIN must be 4 digits'); return } if (newPin !== confirmPin) { setCreatePinError('PINs do not match'); return } setCreatePinLoading(true); setCreatePinError(''); try { const token = localStorage.getItem('accessToken') || localStorage.getItem('token'); const res = await fetch(`${import.meta.env.VITE_API_URL || 'http://localhost:4000'}/users/transaction-pin`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` }, body: JSON.stringify({ pin: newPin }) }); if (!res.ok) { const data = await res.json().catch(() => ({})); throw new Error(data.message || 'Failed') } showToast('PIN created!', 'success'); setCreatePinModal(false); if (user) (user as any).hasTransactionPin = true } catch (err: any) { setCreatePinError(err.message || 'Failed') } finally { setCreatePinLoading(false) } }
  const handlePinConfirm  = async () => { if (!group || pin.length !== 4) return; setPinLoading(true); const idempotencyKey = `${group.id}-${user?.id}-${myPending?.id || nanoid(8)}`; try { await groupsApi.makeContribution(group.id, pin, idempotencyKey); showToast('Contribution paid! 🎉', 'success'); setPinModal(false); setPin(''); refetch() } catch (err: any) { showToast(err?.response?.data?.message || 'Payment failed', 'error') } finally { setPinLoading(false) } }
  const handleJoinClick   = () => { if (!group) return; setAgreementChecked(false); setPendingJoinAction(group.visibility === 'PRIVATE' ? 'code' : group.visibility === 'PUBLIC' ? 'direct' : 'request'); setAgreementModal(true) }
  const handleAcceptAgreement = async () => {
    if (!group || !agreementChecked) return
    setAgreementLoading(true)
    try {
      const deviceInfo = `${navigator.userAgent} · ${window.screen.width}x${window.screen.height}`
      await groupsApi.acceptAgreement(group.id, deviceInfo)
      setAgreementModal(false)
      if (pendingJoinAction === 'code') { setCodeModal(true); setInviteCode(''); setCodeError('') }
      else if (pendingJoinAction === 'direct') handleJoinDirect()
      else handleJoinRequest()
      setPendingJoinAction(null)
    } catch (err: any) { showToast(err?.response?.data?.message || 'Could not record agreement', 'error') }
    finally { setAgreementLoading(false) }
  }
  const handleJoinDirect  = async () => { if (!group) return; try { await joinGroup.mutateAsync({ id: group.id }); showToast('You joined! 🎉', 'success'); refetch() } catch (err: any) { showToast(err?.response?.data?.message || 'Failed', 'error') } }
  const handleJoinRequest = async () => { if (!group) return; try { await joinGroup.mutateAsync({ id: group.id }); showToast('Request sent — waiting for approval', 'info'); refetch() } catch (err: any) { showToast(err?.response?.data?.message || 'Failed', 'error') } }
  const handleJoinWithCode = async () => { if (!group || !inviteCode.trim()) { setCodeError('Enter an invite code'); return } try { await joinGroup.mutateAsync({ id: group.id, inviteCode: inviteCode.trim() }); showToast('You joined! 🎉', 'success'); setCodeModal(false); setInviteCode(''); refetch() } catch (err: any) { setCodeError(err?.response?.data?.message || 'Invalid code') } }
  const handleGenerateInvite  = async () => { if (!group) return; setInviteGenerating(true); try { const res = await groupsApi.generateInvite(group.id); setInviteData(res.data?.data || res.data) } catch { showToast('Failed to generate invite', 'error') } finally { setInviteGenerating(false) } }
  const handleRemoveConfirm   = async () => { if (!group || !removeTarget) return; setRemoveLoading(true); try { await groupsApi.removeMember(group.id, removeTarget.userId); showToast(`${removeTarget.user.firstName} removed`, 'success'); setRemoveTarget(null); refetch() } catch (err: any) { showToast(err?.response?.data?.message || 'Failed', 'error') } finally { setRemoveLoading(false) } }
  const handleApproveConfirm  = async () => { if (!group || !approveTarget) return; setApproveLoading(true); try { await groupsApi.approveMember(group.id, approveTarget.userId); showToast(`${approveTarget.user.firstName} approved`, 'success'); setApproveTarget(null); refetch() } catch (err: any) { showToast(err?.response?.data?.message || 'Failed', 'error') } finally { setApproveLoading(false) } }
  const handleRejectConfirm   = async () => { if (!group || !rejectTarget) return; setRejectLoading(true); try { await groupsApi.rejectMember(group.id, rejectTarget.userId); showToast('Request rejected', 'success'); setRejectTarget(null); refetch() } catch (err: any) { showToast(err?.response?.data?.message || 'Failed', 'error') } finally { setRejectLoading(false) } }
  const handleBanConfirm      = async () => { if (!group || !banTarget) return; setBanLoading(true); try { await groupsApi.banMember(group.id, banTarget.userId, { reason: banReason || undefined }); showToast(`${banTarget.user.firstName} banned`, 'success'); setBanTarget(null); setBanReason(''); refetch() } catch (err: any) { showToast(err?.response?.data?.message || 'Failed', 'error') } finally { setBanLoading(false) } }
  const handleTransferConfirm = async () => { if (!group || !transferTarget) return; setTransferLoading(true); try { await groupsApi.transferOwnership(group.id, transferTarget.userId); showToast('Ownership transferred', 'success'); setTransferTarget(null); refetch() } catch (err: any) { showToast(err?.response?.data?.message || 'Failed', 'error') } finally { setTransferLoading(false) } }
  const openReorder    = () => { if (!group) return; setDragOrder([...(group.members || [])].sort((a: GroupMember, b: GroupMember) => a.payoutPosition - b.payoutPosition)); setReorderOpen(true) }
  const handleDragStart = (i: number) => setDragIdx(i)
  const handleDragEnter = (i: number) => setDragOverIdx(i)
  const handleDragEnd   = () => { if (dragIdx === null || dragOverIdx === null || dragIdx === dragOverIdx) { setDragIdx(null); setDragOverIdx(null); return } const updated = [...dragOrder]; const [moved] = updated.splice(dragIdx, 1); updated.splice(dragOverIdx, 0, moved); setDragOrder(updated); setDragIdx(null); setDragOverIdx(null) }
  const handleSaveOrder = async () => { if (!group) return; setReorderLoading(true); try { const memberIds = dragOrder.map(m => m.userId); await groupsApi.updatePayoutOrder(group.id, memberIds); showToast('Payout order updated', 'success'); setReorderOpen(false); refetch() } catch (err: any) { showToast(err?.response?.data?.message || 'Failed', 'error') } finally { setReorderLoading(false) } }
  const handleStartGroup  = async () => { if (!group) return; setLifecycleLoading(true); try { await groupsApi.startGroup(group.id);  showToast('Group started! 🚀', 'success'); refetch() } catch (err: any) { showToast(err?.response?.data?.message || 'Failed', 'error') } finally { setLifecycleLoading(false) } }
  const handlePauseGroup  = async () => { if (!group) return; setLifecycleLoading(true); try { await groupsApi.pauseGroup(group.id);  showToast('Group paused', 'success');   refetch() } catch (err: any) { showToast(err?.response?.data?.message || 'Failed', 'error') } finally { setLifecycleLoading(false) } }
  const handleResumeGroup = async () => { if (!group) return; setLifecycleLoading(true); try { await groupsApi.resumeGroup(group.id); showToast('Group resumed', 'success');  refetch() } catch (err: any) { showToast(err?.response?.data?.message || 'Failed', 'error') } finally { setLifecycleLoading(false) } }
  const handleDeleteGroup = async () => { if (!group) return; if (!window.confirm(`Delete "${group.name}"? This cannot be undone.`)) return; setDeleteLoading(true); try { await groupsApi.deleteGroup(group.id); showToast('Group deleted', 'success'); navigate('/groups') } catch (err: any) { showToast(err?.response?.data?.message || 'Failed to delete', 'error') } finally { setDeleteLoading(false) } }
  const handleGroupReport  = async () => { if (!group || !reportCategory || !reportDescription.trim()) return; setReportLoading(true); try { await disputesApi.create({ type: reportCategory, description: reportDescription, groupId: group.id }); showToast('Report submitted', 'success'); setReportCategory(''); setReportDescription('') } catch (err: any) { showToast(err?.response?.data?.message || 'Failed', 'error') } finally { setReportLoading(false) } }
  const handleMemberReport = async () => { if (!memberReportTarget || !memberReportCategory || !memberReportDescription.trim()) return; setMemberReportLoading(true); try { await disputesApi.create({ type: memberReportCategory, description: memberReportDescription, reportedUserId: memberReportTarget.userId }); showToast('Report submitted', 'success'); setMemberReportTarget(null); setMemberReportCategory(''); setMemberReportDescription('') } catch (err: any) { showToast(err?.response?.data?.message || 'Failed', 'error') } finally { setMemberReportLoading(false) } }

  const TABS: { id: Tab; label: string }[] = [
    { id: 'overview',      label: 'Overview'                             },
    { id: 'members',       label: `Members (${group?.memberCount || 0})` },
    { id: 'contributions', label: 'Contributions'                        },
    { id: 'payouts',       label: 'Payouts'                              },
    { id: 'activity',      label: 'Activity'                             },
    { id: 'chat',          label: 'Chat'                                 },
    { id: 'analytics',     label: 'Analytics'                            },
    { id: 'settings',      label: 'Settings'                             },
  ]

  if (isLoading) return (
    <DashboardLayout title="Group">
      <div className="p-6 space-y-4 max-w-7xl">
        <Skeleton className="h-36 w-full rounded-2xl"/>
        <div className="grid md:grid-cols-3 gap-4">{[...Array(3)].map((_,i) => <Skeleton key={i} className="h-28 rounded-2xl"/>)}</div>
      </div>
    </DashboardLayout>
  )

  if (!group) return (
    <DashboardLayout title="Not found">
      <EmptyState icon="🔍" title="Group not found" description="This group doesn't exist or you don't have access."
        action={<Link to="/groups"><Button variant="secondary">Back to groups</Button></Link>}/>
    </DashboardLayout>
  )

  const contribFreqLabel = FREQ_LABEL[group.frequency] || group.frequency
  const payoutFreqLabel  = FREQ_LABEL[group.payoutFrequency] || contribFreqLabel
  const groupInitials = group.name.substring(0,2).toUpperCase()
  const avatarColor   = PALETTE[group.name.charCodeAt(0) % PALETTE.length]
  const cycleOptions  = Array.from({ length: Math.max(group.currentCycle, 1) }, (_, i) => i + 1)

  return (
    <DashboardLayout title={group.name} subtitle={`${contribFreqLabel} savings circle · ${group.visibility.toLowerCase()} group`}>
      <div className="bg-[#F8F9FB] min-h-screen">
        <div className="max-w-7xl mx-auto px-6 py-6 space-y-5">

          <Link to="/groups" className="inline-flex items-center gap-1.5 text-[13px] text-gray-500 hover:text-gray-900 transition-colors">
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7"/></svg>
            Back to groups
          </Link>

          {isFrozen && (
            <div className="bg-red-50 border border-red-200 rounded-2xl p-4 flex items-start gap-3">
              <div className="w-9 h-9 rounded-xl bg-red-100 flex items-center justify-center flex-shrink-0">
                <svg className="w-5 h-5 text-red-500" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 9v2m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"/></svg>
              </div>
              <div>
                <p className="text-[13px] font-semibold text-red-700">This group has been frozen by an administrator</p>
                <p className="text-[12px] text-red-500 mt-0.5">All activity is suspended. Only an admin can unfreeze this group.{(group as any).frozenReason ? ` Reason: ${(group as any).frozenReason}` : ''}</p>
              </div>
            </div>
          )}

          <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
            <div className="px-6 py-5">
              {/* Top row */}
              <div className="flex items-start justify-between gap-4 flex-wrap">
                <div className="flex items-center gap-4">
                  <div className="w-14 h-14 rounded-2xl flex items-center justify-center text-white text-[18px] font-bold flex-shrink-0" style={{ background: avatarColor }}>
                    {groupInitials}
                  </div>
                  <div>
                    <div className="flex items-center gap-2.5 mb-1">
                      <h1 className="text-[20px] font-bold text-gray-900 tracking-tight">{group.name}</h1>
                      <SBadge status={group.status}/>
                      {isFrozen && <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full bg-red-50 text-red-600 text-[11px] font-semibold ring-1 ring-red-200">🔒 Frozen by admin</span>}
                    </div>
                    <p className="text-[13px] text-gray-400">{contribFreqLabel} savings circle · {group.visibility.charAt(0) + group.visibility.slice(1).toLowerCase()} group</p>
                  </div>
                </div>
                <div className="flex-1 max-w-xs">
                  <div className="flex items-center justify-between mb-1.5 text-[12px]">
                    <span className="font-semibold text-gray-700">Cycle {group.currentCycle} progress</span>
                    <span className="font-bold text-gray-900">{cyclePct}%</span>
                  </div>
                  <div className="h-2 bg-gray-100 rounded-full overflow-hidden mb-1.5">
                    <motion.div className="h-full rounded-full bg-emerald-500" initial={{ width: 0 }} animate={{ width: `${cyclePct}%` }} transition={{ duration: 0.8, ease: EASE }}/>
                  </div>
                  <p className="text-[11px] text-gray-400">{fmt(collected)} of {fmt(totalPool)} collected</p>
                </div>
              </div>

              {/* Stats strip — FIXED: shows real contribution + payout frequency */}
              <div className="flex flex-wrap gap-0 mt-5 border border-gray-100 rounded-xl overflow-hidden">
                {[
                  { icon: '₦', label: `${contribFreqLabel} contribution`, val: fmt(group.contributionAmount) },
                  { icon: '🎁', label: 'Payout frequency', val: payoutFreqLabel },
                  { icon: '👥', label: 'Members', val: `${group.memberCount} / ${group.maxMembers}` },
                  { icon: '🔄', label: 'Current cycle', val: `Cycle ${group.currentCycle} of ${group.totalCycles}` },
                  { icon: '📅', label: 'Next payout', val: group.nextContributionDate ? dayjs(group.nextContributionDate).format('MMM D, YYYY') : '—' },
                ].map((s, i) => (
                  <div key={s.label} className={`flex-1 min-w-[140px] flex items-center gap-3 px-4 py-3.5 ${i > 0 ? 'border-l border-gray-100' : ''}`}>
                    <div className="w-8 h-8 rounded-lg bg-gray-50 flex items-center justify-center text-[14px] flex-shrink-0">{s.icon}</div>
                    <div>
                      <p className="text-[15px] font-bold text-gray-900 tracking-tight">{s.val}</p>
                      <p className="text-[10px] text-gray-400 uppercase tracking-wide font-medium">{s.label}</p>
                    </div>
                  </div>
                ))}
              </div>

              {/* CTA buttons */}
              <div className="flex items-center gap-2 mt-4 flex-wrap">
                {isMember && myPending && !isFrozen && (
                  <button onClick={handleContribute} disabled={pinLoading}
                    className="h-10 px-5 rounded-xl bg-emerald-600 text-white text-[13px] font-semibold hover:bg-emerald-700 transition-colors flex items-center gap-2 disabled:opacity-60 shadow-sm">
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4"/></svg>
                    Contribute Now · {fmt(myPending.amount)}
                  </button>
                )}
                {isMember && !myPending && !isFrozen && (
                  <div className="h-10 px-5 rounded-xl bg-gray-100 text-[13px] font-semibold text-gray-500 flex items-center gap-2">
                    <svg className="w-4 h-4 text-emerald-500" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7"/></svg>
                    Contribution up to date
                  </div>
                )}
                {isAdmin && !isFrozen && (
                  <button onClick={handleGenerateInvite} disabled={inviteGenerating}
                    className="h-10 px-4 rounded-xl border border-gray-200 bg-white text-[13px] font-semibold text-gray-700 hover:bg-gray-50 transition-colors flex items-center gap-2 shadow-sm disabled:opacity-60 disabled:cursor-not-allowed">
                    {inviteGenerating
                      ? <span className="w-4 h-4 rounded-full border-2 border-gray-400 border-t-transparent animate-spin flex-shrink-0"/>
                      : <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M18 9v3m0 0v3m0-3h3m-3 0h-3m-2-5a4 4 0 11-8 0 4 4 0 018 0zM3 20a6 6 0 0112 0v1H3v-1z"/></svg>}
                    {inviteGenerating ? 'Generating…' : 'Invite Members'}
                  </button>
                )}
                {!myMembership && !isFull && !isFrozen && (group.status === 'ACTIVE' || group.status === 'DRAFT') && (
                  <button onClick={handleJoinClick} disabled={joinGroup.isPending}
                    className="h-10 px-5 rounded-xl bg-emerald-600 text-white text-[13px] font-semibold hover:bg-emerald-700 transition-colors shadow-sm">
                    {joinGroup.isPending ? 'Joining…' : group.visibility === 'PRIVATE' ? 'Enter code to join' : group.visibility === 'INVITE_ONLY' ? 'Request to join' : 'Join group'}
                  </button>
                )}
                {isOwner && group.status === 'DRAFT' && !isFrozen && (
                  <button onClick={handleStartGroup} disabled={lifecycleLoading} className="h-10 px-4 rounded-xl bg-gray-900 text-white text-[13px] font-semibold hover:bg-gray-800 transition-colors shadow-sm">
                    {lifecycleLoading ? '…' : 'Start group'}
                  </button>
                )}
                {isOwner && group.status === 'ACTIVE' && !isFrozen && !cycleStarted && (
                  <button onClick={handlePauseGroup} disabled={lifecycleLoading} className="h-10 px-4 rounded-xl border border-gray-200 bg-white text-[13px] font-semibold text-gray-700 hover:bg-gray-50 transition-colors shadow-sm">
                    {lifecycleLoading ? '…' : 'Pause group'}
                  </button>
                )}
                {isOwner && group.status === 'PAUSED' && !isFrozen && !cycleStarted && (
                  <button onClick={handleResumeGroup} disabled={lifecycleLoading} className="h-10 px-4 rounded-xl bg-emerald-600 text-white text-[13px] font-semibold hover:bg-emerald-700 transition-colors shadow-sm">
                    {lifecycleLoading ? '…' : 'Resume group'}
                  </button>
                )}
                {isOwner && group.status === 'DRAFT' && (
                  <button onClick={handleDeleteGroup} disabled={deleteLoading}
                    className="h-10 px-4 rounded-xl bg-red-50 text-red-600 border border-red-200 text-[13px] font-semibold hover:bg-red-100 transition-colors flex items-center gap-2 shadow-sm">
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"/></svg>
                    {deleteLoading ? 'Deleting…' : 'Delete Group'}
                  </button>
                )}
                {isAdmin && (
                  <button onClick={openEdit}
                    className="h-10 px-4 rounded-xl border border-gray-200 bg-white text-[13px] font-semibold text-gray-700 hover:bg-gray-50 transition-colors flex items-center gap-2 shadow-sm ml-auto">
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z"/><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"/></svg>
                    Settings
                  </button>
                )}
              </div>
            </div>

            {/* Tabs */}
            <div className="border-t border-gray-100 overflow-x-auto">
              <div className="flex px-6">
                {TABS.map(t => (
                  <button key={t.id} onClick={() => setTab(t.id)}
                    className={`relative px-4 py-3.5 text-[13px] font-semibold whitespace-nowrap transition-colors border-b-2 ${tab === t.id ? 'border-emerald-500 text-emerald-600' : 'border-transparent text-gray-400 hover:text-gray-700'}`}>
                    {t.label}
                  </button>
                ))}
              </div>
            </div>
          </div>

          {/* Invite banner */}
          <AnimatePresence>
            {inviteData && (
              <motion.div className="bg-white rounded-2xl border border-gray-100 p-5 flex items-center justify-between gap-4 shadow-sm"
                initial={{ opacity:0, y:-8 }} animate={{ opacity:1, y:0 }} exit={{ opacity:0, y:-8 }}>
                <div className="min-w-0">
                  <p className="text-[13px] font-semibold text-gray-900">Invite link generated</p>
                  <p className="text-[12px] text-gray-400 font-mono mt-1 truncate">{inviteData.url}</p>
                  {inviteData.code && <p className="text-[12px] text-emerald-600 font-mono mt-1">Code: <span className="font-bold">{inviteData.code}</span></p>}
                </div>
                <div className="flex gap-2 flex-shrink-0">
                  <button onClick={() => navigator.clipboard.writeText(inviteData.url).then(() => showToast('Copied!','success'))} className="h-8 px-3 rounded-lg border border-gray-200 text-[12px] font-semibold text-gray-700 hover:bg-gray-50 transition-colors">Copy link</button>
                  {inviteData.code && <button onClick={() => navigator.clipboard.writeText(inviteData.code).then(() => showToast('Copied!','success'))} className="h-8 px-3 rounded-lg border border-gray-200 text-[12px] font-semibold text-gray-700 hover:bg-gray-50 transition-colors">Copy code</button>}
                  <button onClick={() => setInviteData(null)} className="h-8 px-3 rounded-lg text-[12px] text-gray-400 hover:text-gray-700 transition-colors">✕</button>
                </div>
              </motion.div>
            )}
          </AnimatePresence>

          {/* PIN prompt */}
          {isMember && !user?.hasTransactionPin && (
            <div className="bg-amber-50 border border-amber-100 rounded-2xl p-4 flex items-center justify-between gap-4 flex-wrap">
              <div>
                <p className="text-[13px] font-semibold text-amber-800">Set your transaction PIN</p>
                <p className="text-[12px] text-amber-600 mt-0.5">A 4-digit PIN is required to make contributions.</p>
              </div>
              <button onClick={() => { setNewPin(''); setConfirmPin(''); setCreatePinError(''); setCreatePinModal(true) }}
                className="h-8 px-4 rounded-lg bg-amber-600 text-white text-[12px] font-semibold hover:bg-amber-700 transition-colors">Set PIN</button>
            </div>
          )}

          {/* Tab content */}
          <AnimatePresence mode="wait">
            <motion.div key={tab} initial={{ opacity:0, y:6 }} animate={{ opacity:1, y:0 }} exit={{ opacity:0 }} transition={{ duration:0.18, ease:EASE }}>

              {/* OVERVIEW */}
              {tab === 'overview' && (
                <div className="grid lg:grid-cols-3 gap-5">
                  <div className="lg:col-span-2 space-y-5">
                    {/* Group terms box — shown to everyone, including before joining */}
                    <GroupTerms group={group} myMemberInfo={myMemberInfo}/>

                    <div className="bg-white rounded-2xl border border-gray-100 p-5 shadow-sm">
                      <p className="text-[14px] font-bold text-gray-900 mb-4">Contribution overview</p>
                      <div className="grid grid-cols-4 gap-4 mb-5">
                        {[{ label:'Total pool', val:fmt(totalPool) },{ label:'Collected', val:fmt(collected) },{ label:'Remaining', val:fmt(remaining) },{ label:'Completion', val:`${completion}%` }].map(s => (
                          <div key={s.label}>
                            <p className="text-[11px] text-gray-400 uppercase tracking-wider font-medium mb-1">{s.label}</p>
                            <p className="text-[18px] font-bold text-gray-900 tracking-tight">{s.val}</p>
                          </div>
                        ))}
                      </div>
                      <div className="space-y-1.5">
                        <div className="flex items-center justify-between text-[12px]"><span className="text-gray-500 font-medium">Cycle progress</span><span className="font-bold text-gray-900">{completion}%</span></div>
                        <div className="h-2 bg-gray-100 rounded-full overflow-hidden"><motion.div className="h-full bg-emerald-500 rounded-full" initial={{ width:0 }} animate={{ width:`${completion}%` }} transition={{ duration:0.8, ease:EASE }}/></div>
                        <div className="flex justify-between text-[11px] text-gray-400"><span>Start: {dayjs(group.createdAt).format('MMM D, YYYY')}</span><span>End: {group.nextContributionDate ? dayjs(group.nextContributionDate).format('MMM D, YYYY') : '—'}</span></div>
                      </div>
                    </div>
                    <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
                      <div className="flex items-center justify-between px-5 py-4 border-b border-gray-50">
                        <p className="text-[14px] font-bold text-gray-900">Recent contributions</p>
                        <button onClick={() => setTab('contributions')} className="text-[12px] font-semibold text-emerald-600 hover:text-emerald-700 transition-colors">View all →</button>
                      </div>
                      <div className="px-5 divide-y divide-gray-50">
                        {(group.contributions || []).length === 0
                          ? <div className="py-10 text-center"><p className="text-[13px] text-gray-400">No contributions yet</p></div>
                          : (group.contributions || []).slice(0,5).map((c: Contribution) => <ContribRow key={c.id} c={c} isAdmin={isAdmin}/>)}
                      </div>
                    </div>
                  </div>
                  <div className="space-y-5">
                    {/* Your payout — highlighted for members */}
                    {myMemberInfo && (
                      <div className="bg-white rounded-2xl border border-emerald-100 shadow-sm overflow-hidden">
                        <div className="px-5 py-4 border-b border-gray-50 bg-emerald-50">
                          <p className="text-[14px] font-bold text-emerald-800">Your payout</p>
                        </div>
                        <div className="px-5 py-4 space-y-2.5">
                          <div className="flex justify-between"><span className="text-[12px] text-gray-400">Position</span><span className="text-[13px] font-bold text-gray-900">#{myMemberInfo.payoutPosition}</span></div>
                          {myMemberInfo.estimatedPayoutAmount != null && (
                            <div className="flex justify-between"><span className="text-[12px] text-gray-400">You'll receive</span><span className="text-[13px] font-bold text-gray-900">{fmt(Number(myMemberInfo.estimatedPayoutAmount)/100)}</span></div>
                          )}
                          <div className="flex justify-between"><span className="text-[12px] text-gray-400">Expected date</span><span className="text-[13px] font-bold text-gray-900">{myMemberInfo.expectedPayoutDate ? dayjs(myMemberInfo.expectedPayoutDate).format('MMM D, YYYY') : (myMemberInfo.isNextRecipient ? 'You are next!' : '—')}</span></div>
                          {myMemberInfo.isNextRecipient && (
                            <div className="bg-emerald-50 border border-emerald-100 rounded-lg px-3 py-2 mt-1"><p className="text-[12px] font-semibold text-emerald-700">🎉 You're next in line to receive the pot</p></div>
                          )}
                        </div>
                      </div>
                    )}

                    <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
                      <div className="flex items-center justify-between px-5 py-4 border-b border-gray-50">
                        <p className="text-[14px] font-bold text-gray-900">Payout rotation</p>
                        {canReorder && <button onClick={openReorder} className="text-[12px] font-semibold text-emerald-600 hover:text-emerald-700 transition-colors">Reorder</button>}
                      </div>
                      <div className="px-5 divide-y divide-gray-50">
                        {(group.members || []).slice(0,8).map((m: GroupMember, i: number) => {
                          const isNext = i + 1 === group.currentCycle
                          return (
                            <div key={m.id} className={`flex items-center gap-3 py-3 ${isNext ? 'bg-emerald-50 -mx-5 px-5 rounded-none' : ''}`}>
                              <div className="w-8 h-8 rounded-full flex items-center justify-center text-[11px] font-bold flex-shrink-0"
                                style={{ background: isNext ? '#22C55E' : '#F3F4F6', color: isNext ? '#fff' : '#6B7280' }}>
                                {i + 1 < group.currentCycle ? '✓' : (m.user.username || m.user.firstName)[0].toUpperCase()}
                              </div>
                              <div className="flex-1 min-w-0">
                                <p className="text-[13px] font-semibold text-gray-900">{m.user.firstName} {m.user.lastName}</p>
                                <p className="text-[11px] text-gray-400">{isNext ? 'Next to receive' : 'Waiting'}</p>
                              </div>
                              <span className={`text-[11px] font-bold px-2 py-0.5 rounded-full ${isNext ? 'bg-emerald-100 text-emerald-700' : 'bg-gray-100 text-gray-500'}`}>#{m.payoutPosition}</span>
                            </div>
                          )
                        })}
                      </div>
                      {group.nextContributionDate && (
                        <div className="px-5 py-3.5 border-t border-gray-50 flex items-center justify-between">
                          <div className="flex items-center gap-2 text-[12px] text-gray-500">
                            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z"/></svg>
                            Next payout date
                          </div>
                          <p className="text-[13px] font-bold text-gray-900">{dayjs(group.nextContributionDate).format('MMM D, YYYY')}</p>
                        </div>
                      )}
                    </div>
                    <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
                      <div className="flex items-center justify-between px-5 py-4 border-b border-gray-50">
                        <p className="text-[14px] font-bold text-gray-900">Group activity</p>
                        <button onClick={() => setTab('activity')} className="text-[12px] font-semibold text-emerald-600 hover:text-emerald-700 transition-colors">View all</button>
                      </div>
                      <div className="px-5 py-3 space-y-3">
                        {(group.contributions || []).slice(0,3).map((c: Contribution) => (
                          <div key={c.id} className="flex items-start gap-3">
                            <div className={`w-2 h-2 rounded-full mt-1.5 flex-shrink-0 ${c.status === 'PAID' ? 'bg-emerald-500' : 'bg-amber-400'}`}/>
                            <div className="flex-1">
                              <p className="text-[12px] font-semibold text-gray-900">{c.user?.firstName} {c.user?.lastName}</p>
                              <p className="text-[11px] text-gray-400">paid {fmt(c.amount)} · {c.paidAt ? dayjs(c.paidAt).format('MMM D, YYYY · h:mm A') : '—'}</p>
                            </div>
                          </div>
                        ))}
                        {(group.contributions || []).length === 0 && <p className="text-[12px] text-gray-400 py-3 text-center">No activity yet</p>}
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {/* MEMBERS */}
              {tab === 'members' && (
                <div className="bg-white rounded-2xl border border-gray-100 overflow-hidden shadow-sm">
                  <table className="w-full">
                    <thead className="border-b border-gray-50 bg-gray-50/50">
                      <tr>{['Member','Role','Position','Total Paid','Status','Actions'].map(h => <th key={h} className="px-5 py-3.5 text-left text-[11px] font-semibold text-gray-400 uppercase tracking-wider">{h}</th>)}</tr>
                    </thead>
                    <tbody className="divide-y divide-gray-50">
                      {(group.members || []).map((m: GroupMember) => (
                        <tr key={m.id} className="hover:bg-gray-50/60 transition-colors">
                          <td className="px-5 py-4">
                            <div className="flex items-center gap-3">
                              <div className="w-9 h-9 rounded-full bg-emerald-100 flex items-center justify-center text-[12px] font-bold text-emerald-700 flex-shrink-0">{m.user.firstName?.[0]}{m.user.lastName?.[0]}</div>
                              <div><p className="text-[13px] font-semibold text-gray-900">{m.user.firstName} {m.user.lastName}</p><p className="text-[11px] text-gray-400">@{m.user.username}</p></div>
                            </div>
                          </td>
                          <td className="px-5 py-4"><span className={`text-[11px] font-semibold px-2 py-0.5 rounded-full ${m.role === 'ADMIN' ? 'bg-blue-50 text-blue-700' : 'bg-gray-100 text-gray-500'}`}>{m.role.toLowerCase()}</span></td>
                          <td className="px-5 py-4 text-[13px] text-gray-500 font-mono">#{m.payoutPosition}</td>
                          <td className="px-5 py-4 text-[13px] font-bold text-gray-900">{fmt(m.totalPaid)}</td>
                          <td className="px-5 py-4"><span className={`text-[11px] font-semibold px-2 py-0.5 rounded-full ${m.status === 'ACTIVE' ? 'bg-emerald-50 text-emerald-700' : 'bg-red-50 text-red-600'}`}>{m.status.toLowerCase()}</span></td>
                          <td className="px-5 py-4">
                            <div className="flex gap-1.5 flex-wrap">
                              {isAdmin && m.status === 'PENDING' && (<><button onClick={() => setApproveTarget(m)} className="h-7 px-2.5 rounded-lg bg-emerald-600 text-white text-[11px] font-semibold hover:bg-emerald-700 transition-colors">Approve</button><button onClick={() => setRejectTarget(m)} className="h-7 px-2.5 rounded-lg border border-gray-200 text-[11px] font-semibold text-gray-600 hover:bg-gray-50 transition-colors">Reject</button></>)}
                              {isAdmin && m.userId !== user?.id && m.status === 'ACTIVE' && !cycleStarted && (<><button onClick={() => setRemoveTarget(m)} className="h-7 px-2.5 rounded-lg border border-red-200 text-red-600 text-[11px] font-semibold hover:bg-red-50 transition-colors">Remove</button><button onClick={() => { setBanTarget(m); setBanReason('') }} className="h-7 px-2.5 rounded-lg border border-gray-200 text-[11px] font-semibold text-gray-600 hover:bg-gray-50 transition-colors">Ban</button></>)}
                              {isOwner && m.userId !== user?.id && m.status === 'ACTIVE' && m.role !== 'ADMIN' && (<button onClick={() => setTransferTarget(m)} className="h-7 px-2.5 rounded-lg border border-gray-200 text-[11px] font-semibold text-gray-600 hover:bg-gray-50 transition-colors">Make owner</button>)}
                              {m.userId !== user?.id && (<button onClick={() => { setMemberReportTarget(m); setMemberReportCategory(''); setMemberReportDescription('') }} className="h-7 px-2.5 rounded-lg border border-gray-200 text-[11px] font-semibold text-gray-500 hover:bg-gray-50 transition-colors">Report</button>)}
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}

              {/* CONTRIBUTIONS — now with a cycle selector so past cycles are browsable */}
              {tab === 'contributions' && (
                <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
                  <div className="flex items-center justify-between px-5 py-4 border-b border-gray-50 flex-wrap gap-3">
                    <p className="text-[14px] font-bold text-gray-900">Cycle {selectedCycle ?? group.currentCycle} contributions</p>
                    {cycleOptions.length > 0 && (
                      <select
                        value={selectedCycle ?? group.currentCycle}
                        onChange={e => setSelectedCycle(Number(e.target.value))}
                        className="h-9 border border-gray-200 rounded-lg px-3 text-[12.5px] font-medium text-gray-700 outline-none focus:border-emerald-400 bg-white cursor-pointer"
                      >
                        {cycleOptions.map(n => (
                          <option key={n} value={n}>Cycle {n}{n === group.currentCycle ? ' (current)' : ''}</option>
                        ))}
                      </select>
                    )}
                  </div>
                  <div className="px-5 divide-y divide-gray-50">
                    {cycleLoading ? (
                      <div className="py-10 space-y-3">{[...Array(3)].map((_, i) => <Skeleton key={i} className="h-12 rounded-xl"/>)}</div>
                    ) : (cycleContributions || []).length === 0 ? (
                      <div className="py-12 text-center"><p className="text-[13px] text-gray-400">No contributions for this cycle yet</p></div>
                    ) : (
                      (cycleContributions || []).map((c: Contribution) => <ContribRow key={c.id} c={c} isAdmin={isAdmin}/>)
                    )}
                  </div>
                </div>
              )}

              {/* PAYOUTS — real history from GET /groups/:id/payouts, plus the upcoming rotation order */}
              {tab === 'payouts' && (
                <div className="space-y-5">
                  <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
                    <div className="px-5 py-4 border-b border-gray-50">
                      <p className="text-[14px] font-bold text-gray-900">Payout history</p>
                      <p className="text-[12px] text-gray-400 mt-0.5">Every payout for this group, every cycle, any status.</p>
                    </div>
                    {payoutsLoading ? (
                      <div className="p-5 space-y-3">{[...Array(3)].map((_, i) => <Skeleton key={i} className="h-14 rounded-xl"/>)}</div>
                    ) : (payoutHistory || []).length === 0 ? (
                      <div className="py-12 text-center"><p className="text-[13px] text-gray-400">No payouts yet</p></div>
                    ) : (
                      <div>{(payoutHistory || []).map((p: any) => <PayoutRow key={p.id} p={p}/>)}</div>
                    )}
                  </div>

                  <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
                    <div className="px-5 py-4 border-b border-gray-50"><p className="text-[14px] font-bold text-gray-900">Upcoming rotation order</p></div>
                    <div className="divide-y divide-gray-50">
                      {(group.members || []).map((m: GroupMember, i: number) => {
                        const isNext = i + 1 === group.currentCycle
                        return (
                          <div key={m.id} className={`flex items-center gap-4 px-5 py-4 ${isNext ? 'bg-emerald-50/50' : ''}`}>
                            <div className="w-10 h-10 rounded-full bg-emerald-100 flex items-center justify-center text-[13px] font-bold text-emerald-700 flex-shrink-0">{m.user.firstName?.[0]}{m.user.lastName?.[0]}</div>
                            <div className="flex-1"><p className="text-[13px] font-semibold text-gray-900">{m.user.firstName} {m.user.lastName}</p><p className="text-[11px] text-gray-400">@{m.user.username}</p></div>
                            <div className="text-right"><p className="text-[14px] font-bold text-gray-900">{fmt(group.contributionAmount * (group.memberCount || 1))}</p><p className="text-[11px] text-gray-400">Position #{m.payoutPosition}</p></div>
                            {isNext && <span className="bg-emerald-100 text-emerald-700 text-[11px] font-bold px-2.5 py-0.5 rounded-full">Next</span>}
                            {i < group.currentCycle - 1 && <span className="bg-gray-100 text-gray-400 text-[11px] font-semibold px-2.5 py-0.5 rounded-full">Paid</span>}
                          </div>
                        )
                      })}
                    </div>
                  </div>
                </div>
              )}

              {/* ACTIVITY */}
              {tab === 'activity' && (
                <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
                  <div className="px-5 py-4 border-b border-gray-50"><p className="text-[14px] font-bold text-gray-900">Group activity</p></div>
                  <div className="px-5 divide-y divide-gray-50">
                    {(group.contributions || []).length === 0 ? <div className="py-12 text-center"><p className="text-[13px] text-gray-400">No activity yet</p></div>
                    : (group.contributions || []).map((c: Contribution) => (
                      <div key={c.id} className="flex items-start gap-3 py-3.5">
                        <div className={`w-2 h-2 rounded-full mt-1.5 flex-shrink-0 ${c.status === 'PAID' ? 'bg-emerald-500' : 'bg-amber-400'}`}/>
                        <div className="w-9 h-9 rounded-full bg-emerald-100 flex items-center justify-center text-[12px] font-bold text-emerald-700 flex-shrink-0">{c.user?.firstName?.[0]}{c.user?.lastName?.[0]}</div>
                        <div className="flex-1"><p className="text-[13px] font-semibold text-gray-900">{c.user?.firstName} {c.user?.lastName}</p><p className="text-[12px] text-gray-500">paid {fmt(c.amount)}</p><p className="text-[11px] text-gray-400">{c.paidAt ? dayjs(c.paidAt).format('MMM D, YYYY · h:mm A') : '—'}</p></div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* CHAT */}
              {tab === 'chat' && (
                <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
                  <div className="px-5 py-4 border-b border-gray-50 flex items-center justify-between">
                    <p className="text-[14px] font-bold text-gray-900">Group chat</p>
                    {isAdmin && (<button onClick={handleToggleChat} disabled={chatLockLoading} className="text-[12px] font-semibold text-gray-500 hover:text-gray-900 transition-colors disabled:opacity-50">{chatLockLoading ? '…' : group.chatEnabled ? 'Lock chat' : 'Unlock chat'}</button>)}
                  </div>
                  {group.chatEnabled ? <GroupChat groupId={group.id} currentUserId={user?.id || ''} isAdmin={isAdmin} members={chatMembers}/> : <div className="py-12 text-center"><p className="text-[13px] text-gray-400">Chat is currently locked by the admin.</p></div>}
                </div>
              )}

              {/* ANALYTICS */}
              {tab === 'analytics' && analytics && (
                <div className="space-y-5">
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                    {[
                      { label:'Collection rate', val:`${(analytics as any).overview?.collectionRate}%` },
                      { label:'Total collected',  val:fmt((analytics as any).overview?.totalCollected || 0) },
                      { label:'Total paid out',   val:fmt((analytics as any).overview?.totalPaidOut || 0) },
                      { label:'Paid this cycle',  val:`${(analytics as any).overview?.paidThisCycle} / ${(analytics as any).overview?.totalMembers}` },
                    ].map(m => (
                      <div key={m.label} className="bg-white rounded-2xl border border-gray-100 p-5 shadow-sm">
                        <p className="text-[11px] font-semibold text-gray-400 uppercase tracking-wider mb-2">{m.label}</p>
                        <p className="text-[22px] font-bold text-gray-900 tracking-tight tabular-nums">{m.val}</p>
                      </div>
                    ))}
                  </div>
                  <div className="bg-white rounded-2xl border border-gray-100 p-5 shadow-sm">
                    <p className="text-[14px] font-bold text-gray-900 mb-4">Weekly collection</p>
                    <ResponsiveContainer width="100%" height={200}>
                      <BarChart data={(analytics as any).weeklyData || []} margin={{ left:-20, top:8 }}>
                        <XAxis dataKey="week" tick={{ fontSize:11, fill:'#9CA3AF' }} axisLine={false} tickLine={false} tickFormatter={v => dayjs(v).format('MMM D')}/>
                        <YAxis tick={{ fontSize:11, fill:'#9CA3AF' }} axisLine={false} tickLine={false} tickFormatter={v => `₦${Math.floor(v/1000)}K`}/>
                        <Tooltip contentStyle={{ background:'#fff', border:'1px solid #E5E7EB', borderRadius:12, fontSize:12 }} formatter={(v: any) => [`₦${Number(v).toLocaleString()}`, 'Collected']}/>
                        <Bar dataKey="collected" fill="#22C55E" radius={[6,6,0,0]} maxBarSize={36}/>
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                </div>
              )}

              {/* SETTINGS */}
              {tab === 'settings' && (
                <div className="max-w-2xl space-y-5">
                  <div className="bg-white rounded-2xl border border-gray-100 p-6 shadow-sm">
                    <p className="text-[15px] font-bold text-gray-900 mb-5">Group settings</p>
                    <form className="space-y-4">
                      <Input label="Group name" error={editErrors.name?.message} {...regEdit('name')}/>
                      <div><label className="block text-[12px] font-semibold text-gray-500 mb-1.5">Description</label><textarea {...regEdit('description')} rows={2} className="w-full border border-gray-200 rounded-xl px-4 py-2.5 text-[13px] text-gray-900 outline-none focus:border-emerald-400 resize-none transition-all"/></div>
                      <Select label="Visibility" options={VIS_OPTS} error={editErrors.visibility?.message} {...regEdit('visibility')}/>
                      <div className="grid grid-cols-2 gap-4">
                        <Input label="Payment deadline (days)" type="number" error={editErrors.deadlineDays?.message} {...regEdit('deadlineDays')}/>
                        <Input label="Late penalty (₦)" type="number" error={editErrors.penaltyAmount?.message} {...regEdit('penaltyAmount')}/>
                      </div>
                      <button type="button" onClick={handleEditSubmit(onEditSubmit)} disabled={editLoading}
                        className="h-10 px-5 rounded-xl bg-emerald-600 text-white text-[13px] font-semibold hover:bg-emerald-700 disabled:opacity-50 transition-colors">
                        {editLoading ? 'Saving…' : 'Save changes'}
                      </button>
                    </form>
                  </div>
                  <div className="bg-white rounded-2xl border border-gray-100 p-6 shadow-sm">
                    <p className="text-[15px] font-bold text-gray-900 mb-1">Report this group</p>
                    <p className="text-[13px] text-gray-400 mb-4">Something wrong? Let our team know.</p>
                    <div className="space-y-3">
                      <select value={reportCategory} onChange={e => setReportCategory(e.target.value)} className="h-10 w-full border border-gray-200 rounded-xl px-3 text-[13px] text-gray-900 outline-none focus:border-emerald-400 transition-all">
                        <option value="">Select a reason</option>
                        {GROUP_REPORT_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
                      </select>
                      <textarea value={reportDescription} onChange={e => setReportDescription(e.target.value)} rows={3} placeholder="Describe the issue…" className="w-full border border-gray-200 rounded-xl px-4 py-2.5 text-[13px] text-gray-900 outline-none focus:border-emerald-400 resize-none transition-all"/>
                      <button onClick={handleGroupReport} disabled={reportLoading || !reportCategory || !reportDescription.trim()}
                        className="h-9 px-4 rounded-lg bg-red-500 text-white text-[12px] font-semibold hover:bg-red-600 disabled:opacity-50 transition-colors">
                        {reportLoading ? 'Submitting…' : 'Submit report'}
                      </button>
                    </div>
                  </div>
                </div>
              )}

            </motion.div>
          </AnimatePresence>
        </div>
      </div>

      {/* MODALS */}
      <Modal open={createPinModal} onClose={() => setCreatePinModal(false)} title="Create transaction PIN" size="sm"
        footer={<><Button variant="secondary" onClick={() => setCreatePinModal(false)}>Later</Button><Button onClick={handleCreatePin} loading={createPinLoading} disabled={newPin.length !== 4 || confirmPin.length !== 4}>Create PIN</Button></>}>
        <div className="space-y-4">
          <div className="bg-amber-50 border border-amber-100 rounded-xl p-4"><p className="text-[13px] text-amber-800">You'll need this 4-digit PIN to make contributions. Keep it safe.</p></div>
          <Input label="New PIN" type="password" maxLength={4} placeholder="••••" value={newPin} onChange={e => { setNewPin(e.target.value.replace(/\D/g,'')); setCreatePinError('') }}/>
          <Input label="Confirm PIN" type="password" maxLength={4} placeholder="••••" value={confirmPin} onChange={e => { setConfirmPin(e.target.value.replace(/\D/g,'')); setCreatePinError('') }}/>
          {createPinError && <p className="text-[12px] text-red-500">{createPinError}</p>}
        </div>
      </Modal>

      <Modal open={pinModal} onClose={() => { setPinModal(false); setPin('') }} title="Confirm payment" size="sm"
        footer={<><Button variant="secondary" onClick={() => { setPinModal(false); setPin('') }}>Cancel</Button><Button onClick={handlePinConfirm} loading={pinLoading} disabled={pin.length !== 4}>Confirm</Button></>}>
        <div className="space-y-3">
          <div className="bg-emerald-50 border border-emerald-100 rounded-xl p-4"><p className="text-[13px] font-semibold text-emerald-800">Paying {myPending ? fmt(myPending.amount) : ''} from your wallet</p></div>
          <Input label="Transaction PIN" type="password" maxLength={4} placeholder="••••" value={pin} onChange={e => setPin(e.target.value.replace(/\D/g,''))}/>
        </div>
      </Modal>

      <Modal open={codeModal} onClose={() => setCodeModal(false)} title="Enter invite code" size="sm"
        footer={<><Button variant="secondary" onClick={() => setCodeModal(false)}>Cancel</Button><Button onClick={handleJoinWithCode} loading={joinGroup.isPending} disabled={!inviteCode.trim()}>Join</Button></>}>
        <p className="text-[13px] text-gray-500 mb-4">This is a private group. Ask the admin for the invite code.</p>
        <Input label="Invite code" placeholder="Enter code here" value={inviteCode} onChange={e => { setInviteCode(e.target.value); setCodeError('') }}/>
        {codeError && <p className="text-[12px] text-red-500 mt-2">{codeError}</p>}
      </Modal>

      <Modal open={editOpen} onClose={() => setEditOpen(false)} title="Group settings" size="lg"
        footer={<><Button variant="secondary" onClick={() => setEditOpen(false)}>Cancel</Button><Button onClick={handleEditSubmit(onEditSubmit)} loading={editLoading}>Save changes</Button></>}>
        <form className="grid grid-cols-2 gap-4">
          <div className="col-span-2"><Input label="Group name" error={editErrors.name?.message} {...regEdit('name')}/></div>
          <div className="col-span-2"><label className="block text-[12px] font-medium text-gray-500 mb-1.5">Description</label><textarea {...regEdit('description')} rows={2} className="w-full border border-gray-200 rounded-xl px-4 py-2.5 text-[13px] text-gray-900 outline-none focus:border-emerald-400 resize-none transition-all"/></div>
          <div className="col-span-2"><Select label="Visibility" options={VIS_OPTS} error={editErrors.visibility?.message} {...regEdit('visibility')}/></div>
          <Input label="Deadline (days)" type="number" error={editErrors.deadlineDays?.message} {...regEdit('deadlineDays')}/>
          <Input label="Late penalty (₦)" type="number" error={editErrors.penaltyAmount?.message} {...regEdit('penaltyAmount')}/>
        </form>
      </Modal>

      <Modal open={!!removeTarget} onClose={() => setRemoveTarget(null)} title="Remove member" size="sm"
        footer={<><Button variant="secondary" onClick={() => setRemoveTarget(null)}>Cancel</Button><Button variant="danger" onClick={handleRemoveConfirm} loading={removeLoading}>Remove</Button></>}>
        <p className="text-[13px] text-gray-600">Remove <strong>{removeTarget?.user.firstName} {removeTarget?.user.lastName}</strong> from this group? They'll lose their payout position.</p>
      </Modal>

      <Modal open={!!approveTarget} onClose={() => setApproveTarget(null)} title="Approve member" size="sm"
        footer={<><Button variant="secondary" onClick={() => setApproveTarget(null)}>Cancel</Button><Button onClick={handleApproveConfirm} loading={approveLoading}>Approve</Button></>}>
        <p className="text-[13px] text-gray-600">Approve <strong>{approveTarget?.user.firstName} {approveTarget?.user.lastName}</strong> to join this group?</p>
      </Modal>

      <Modal open={!!rejectTarget} onClose={() => setRejectTarget(null)} title="Reject request" size="sm"
        footer={<><Button variant="secondary" onClick={() => setRejectTarget(null)}>Cancel</Button><Button variant="danger" onClick={handleRejectConfirm} loading={rejectLoading}>Reject</Button></>}>
        <p className="text-[13px] text-gray-600">Reject <strong>{rejectTarget?.user.firstName} {rejectTarget?.user.lastName}</strong>'s join request?</p>
      </Modal>

      <Modal open={!!banTarget} onClose={() => { setBanTarget(null); setBanReason('') }} title="Ban member" size="sm"
        footer={<><Button variant="secondary" onClick={() => { setBanTarget(null); setBanReason('') }}>Cancel</Button><Button variant="danger" onClick={handleBanConfirm} loading={banLoading}>Ban</Button></>}>
        <div className="space-y-3">
          <p className="text-[13px] text-gray-600">Ban <strong>{banTarget?.user.firstName} {banTarget?.user.lastName}</strong>? They won't be able to rejoin.</p>
          <Input label="Reason (optional)" placeholder="e.g. repeated non-payment" value={banReason} onChange={e => setBanReason(e.target.value)}/>
        </div>
      </Modal>

      <Modal open={!!transferTarget} onClose={() => setTransferTarget(null)} title="Transfer ownership" size="sm"
        footer={<><Button variant="secondary" onClick={() => setTransferTarget(null)}>Cancel</Button><Button variant="danger" onClick={handleTransferConfirm} loading={transferLoading}>Transfer</Button></>}>
        <div className="space-y-3">
          <div className="bg-red-50 border border-red-100 rounded-xl p-4"><p className="text-[13px] font-semibold text-red-700">This cannot be undone. You will lose admin rights.</p></div>
          <p className="text-[13px] text-gray-600">Transfer ownership to <strong>{transferTarget?.user.firstName} {transferTarget?.user.lastName}</strong>?</p>
        </div>
      </Modal>

      <Modal open={reorderOpen} onClose={() => setReorderOpen(false)} title="Reorder payout positions" size="sm"
        footer={<><Button variant="secondary" onClick={() => setReorderOpen(false)}>Cancel</Button><Button onClick={handleSaveOrder} loading={reorderLoading}>Save order</Button></>}>
        <p className="text-[12px] text-gray-500 mb-3">Drag to set who gets paid first.</p>
        <div className="space-y-2">
          {dragOrder.map((m, i) => (
            <div key={m.id} draggable onDragStart={() => handleDragStart(i)} onDragEnter={() => handleDragEnter(i)} onDragEnd={handleDragEnd} onDragOver={e => e.preventDefault()}
              className={`flex items-center gap-3 p-3 bg-white border rounded-xl cursor-grab active:cursor-grabbing transition-all select-none ${dragOverIdx === i ? 'border-emerald-400 bg-emerald-50' : 'border-gray-200'}`}>
              <span className="text-[12px] font-mono text-gray-400 w-5">#{i+1}</span>
              <span className="text-gray-300 text-[12px]">⠿</span>
              <div className="w-8 h-8 rounded-full bg-emerald-100 flex items-center justify-center text-[11px] font-bold text-emerald-700 flex-shrink-0">{m.user.firstName?.[0]}{m.user.lastName?.[0]}</div>
              <p className="text-[13px] font-semibold text-gray-900 flex-1">@{m.user.username}</p>
            </div>
          ))}
        </div>
      </Modal>

      <Modal open={!!memberReportTarget} onClose={() => { setMemberReportTarget(null); setMemberReportCategory(''); setMemberReportDescription('') }}
        title={`Report ${memberReportTarget?.user.firstName} ${memberReportTarget?.user.lastName}`} size="sm"
        footer={<><Button variant="secondary" onClick={() => { setMemberReportTarget(null); setMemberReportCategory(''); setMemberReportDescription('') }}>Cancel</Button><Button variant="danger" onClick={handleMemberReport} loading={memberReportLoading} disabled={!memberReportCategory || !memberReportDescription.trim()}>Submit report</Button></>}>
        <div className="space-y-4">
          <select value={memberReportCategory} onChange={e => setMemberReportCategory(e.target.value)} className="h-10 w-full border border-gray-200 rounded-xl px-3 text-[13px] text-gray-900 outline-none focus:border-emerald-400 transition-all">
            <option value="">Select a reason</option>
            {MEMBER_REPORT_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
          </select>
          <textarea value={memberReportDescription} onChange={e => setMemberReportDescription(e.target.value)} rows={4} placeholder="What happened? Include dates or specifics." className="w-full border border-gray-200 rounded-xl px-4 py-2.5 text-[13px] text-gray-900 outline-none focus:border-emerald-400 resize-none transition-all"/>
        </div>
      </Modal>

      {/* AGREEMENT — now shows the actual contribution, payout schedule, and late fee */}
      <Modal open={agreementModal} onClose={() => setAgreementModal(false)} title="Before you join" size="md"
        footer={<><Button variant="secondary" onClick={() => setAgreementModal(false)}>Cancel</Button><Button onClick={handleAcceptAgreement} loading={agreementLoading} disabled={!agreementChecked}>Accept & Join</Button></>}>
        <div className="space-y-4">
          {/* Concrete terms for THIS group */}
          <div className="bg-emerald-50 border border-emerald-100 rounded-xl p-4 space-y-2">
            <p className="text-[13px] font-bold text-emerald-800 mb-1">This group's terms</p>
            <div className="flex justify-between"><span className="text-[12px] text-emerald-700">You contribute</span><span className="text-[12.5px] font-bold text-emerald-900">{fmt(group.contributionAmount)} per {FREQ_PER[group.frequency] || 'cycle'}</span></div>
            <div className="flex justify-between"><span className="text-[12px] text-emerald-700">Payout schedule</span><span className="text-[12.5px] font-bold text-emerald-900">A member paid {FREQ_EVERY[group.payoutFrequency] || FREQ_EVERY[group.frequency] || 'each cycle'}</span></div>
            <div className="flex justify-between"><span className="text-[12px] text-emerald-700">Late fee</span><span className="text-[12.5px] font-bold text-emerald-900">{Number(group.penaltyAmount || 0) > 0 ? fmt(Number(group.penaltyAmount)) : 'None'}</span></div>
            <div className="flex justify-between"><span className="text-[12px] text-emerald-700">Payment deadline</span><span className="text-[12.5px] font-bold text-emerald-900">{group.deadlineDays || 3} day(s)</span></div>
          </div>

          <div className="bg-amber-50 border border-amber-100 rounded-xl p-4">
            <p className="text-[13px] font-bold text-amber-800 mb-1">Important notice</p>
            <p className="text-[12px] text-amber-700">By joining this contribution group, you agree to make every scheduled contribution on time.</p>
          </div>
          <div className="space-y-2.5 text-[12.5px] text-gray-600 leading-relaxed">
            <p className="font-semibold text-gray-900">Please understand the following rules:</p>
            <div className="flex gap-2"><span className="text-gray-400">•</span><p>Missing your scheduled contribution will <strong>immediately pause the entire group</strong>, and every member is notified.</p></div>
            <div className="flex gap-2"><span className="text-gray-400">•</span><p>You'll have <strong>48 hours</strong> to complete the missed payment.</p></div>
            <div className="flex gap-2"><span className="text-gray-400">•</span><p>If paid within 48 hours, the group resumes automatically.</p></div>
            <div className="flex gap-2"><span className="text-gray-400">•</span><p>If <strong>not</strong> completed within 48 hours:</p></div>
            <div className="pl-6 space-y-1.5">
              <div className="flex gap-2"><span className="text-red-400">–</span><p>You'll be automatically removed from the group.</p></div>
              <div className="flex gap-2"><span className="text-red-400">–</span><p>A debt equal to the missed contribution, plus a late fee{Number(group.penaltyAmount || 0) > 0 ? ` of ${fmt(Number(group.penaltyAmount))}` : ''}, is added to your account.</p></div>
              <div className="flex gap-2"><span className="text-red-400">–</span><p>You won't be able to join or create another group until the debt is fully repaid.</p></div>
            </div>
            <p className="text-[12px] text-gray-500 pt-1">Your NIN and BVN verification prevents opening another account to avoid repayment. Only join if you're confident you can complete every scheduled payment.</p>
          </div>

          <div className="bg-red-50 border border-red-200 rounded-xl p-4">
            <p className="text-[13px] font-bold text-red-700 mb-1">⚠️ Join at your own risk</p>
            <p className="text-[12px] text-red-600 leading-relaxed">
              This is a known risk in every rotating savings circle: a member paid out early in the rotation can stop contributing afterward and walk away with the pot. It's a real pattern — not everyone follows through. Our protections (48hr grace period, automatic removal, debt tracking, NIN/BVN verification) make it much harder to get away with, but they can't guarantee you'll get your money back if someone defaults after their payout. Only join groups with people you trust, or start with a small amount until the group proves reliable.
            </p>
            <p className="text-[12px] text-red-600 leading-relaxed mt-2">
              <strong>The safest option:</strong> join or create <strong>Private</strong> groups with people you personally know — friends, family, coworkers — rather than Public groups full of strangers. Private groups can only be joined with an invite code you control, so you decide exactly who's in the circle.
            </p>
          </div>

          <label className="flex items-start gap-3 bg-gray-50 border border-gray-200 rounded-xl p-3.5 cursor-pointer">
            <input type="checkbox" checked={agreementChecked} onChange={e => setAgreementChecked(e.target.checked)} className="mt-0.5 w-4 h-4 rounded border-gray-300 text-emerald-600 cursor-pointer"/>
            <span className="text-[13px] font-semibold text-gray-800">I have read and understood these rules.</span>
          </label>
        </div>
      </Modal>
    </DashboardLayout>
  )
}