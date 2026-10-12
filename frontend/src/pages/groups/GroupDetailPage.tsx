import { useState, useEffect } from 'react'
import { useParams, Link, useNavigate } from 'react-router-dom'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { motion, AnimatePresence } from 'framer-motion'
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts'
import DashboardLayout from '@/components/layout/DashboardLayout'
import RibbonPanel from '@/components/ui/RibbonPanel'
import { CARD, LABEL, FIELD, BTN_PRIMARY, BTN_SECONDARY, BTN_LIME, BTN_ON_DARK, BTN_SM, Pill, Initials, rise } from '@/lib/ui'
import { Button, Skeleton, EmptyState, Modal, Input, Select } from '@/components/ui'
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

function payoutTone(status: string): 'success' | 'info' | 'warn' | 'danger' | 'neutral' {
  const m: Record<string, any> = { COMPLETED: 'success', PROCESSING: 'info', SCHEDULED: 'warn', FAILED: 'danger', CANCELLED: 'neutral' }
  return m[status] || 'neutral'
}
function contribTone(status: string): 'success' | 'warn' | 'danger' {
  return status === 'PAID' ? 'success' : status === 'OVERDUE' ? 'danger' : 'warn'
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

// Status chip that sits on the dark header panel.
function DarkStatus({ status }: { status: string }) {
  const dot: Record<string, string> = { ACTIVE: 'bg-emerald-400', PAUSED: 'bg-amber-400', DRAFT: 'bg-white/40', COMPLETED: 'bg-sky-400' }
  return (
    <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md bg-white/10 text-white/80 text-[11px] font-medium">
      <span className={`w-1.5 h-1.5 rounded-full ${dot[status] || 'bg-white/40'}`} />
      {status.charAt(0) + status.slice(1).toLowerCase()}
    </span>
  )
}

const selectCls = 'h-10 w-full border border-black/[0.1] rounded-lg px-3 text-[13px] text-ink bg-white outline-none focus:border-brand focus:ring-2 focus:ring-brand/10 transition-all'

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
    <div className={CARD}>
      <div className="px-5 py-4 border-b border-black/[0.06]"><p className="text-[14px] font-semibold text-ink">Group terms</p></div>
      <div className="px-5">
        {rows.map(r => (
          <div key={r.label} className="flex items-start justify-between gap-4 py-3 border-b border-black/[0.05] last:border-0">
            <span className="text-[12px] text-mist flex-shrink-0">{r.label}</span>
            <span className="text-[12.5px] font-medium text-ink text-right">{r.val}</span>
          </div>
        ))}
      </div>
    </div>
  )
}

function ContribRow({ c, isAdmin }: { c: Contribution; isAdmin: boolean }) {
  return (
    <div className="flex items-center gap-3 py-3 border-b border-black/[0.05] last:border-0">
      <Initials first={c.user?.firstName} last={c.user?.lastName} />
      <div className="flex-1 min-w-0">
        <p className="text-[13px] font-medium text-ink">{c.user?.firstName} {c.user?.lastName}</p>
        <p className="text-[11px] text-mist font-mono">{c.paidAt ? dayjs(c.paidAt).format('MMM D, YYYY · h:mm A') : `Due ${dayjs(c.dueDate).format('MMM D')}`}</p>
      </div>
      <p className="text-[13px] font-semibold text-ink tabular-nums">{fmt(c.amount)}</p>
      <Pill tone={contribTone(c.status)}>{c.status === 'PAID' ? 'Paid' : c.status.charAt(0) + c.status.slice(1).toLowerCase()}</Pill>
    </div>
  )
}

// ── Payout history row — real payout record from GET /groups/:id/payouts ──
function PayoutRow({ p }: { p: any }) {
  const recipient = p.recipient || {}
  const dateLabel = p.completedAt ? dayjs(p.completedAt).format('MMM D, YYYY · h:mm A')
    : p.scheduledDate ? `Scheduled ${dayjs(p.scheduledDate).format('MMM D, YYYY')}`
    : '—'
  return (
    <div className="flex items-center gap-3 px-5 py-3.5 border-b border-black/[0.05] last:border-0">
      <Initials first={recipient.firstName} last={recipient.lastName} />
      <div className="flex-1 min-w-0">
        <p className="text-[13px] font-medium text-ink">{recipient.firstName} {recipient.lastName}</p>
        <p className="text-[11px] text-mist font-mono">Cycle {p.cycleNumber} · {dateLabel}</p>
      </div>
      <p className="text-[13px] font-semibold text-ink tabular-nums">{fmt(p.amount)}</p>
      <Pill tone={payoutTone(p.status)}>{p.status.charAt(0) + p.status.slice(1).toLowerCase()}</Pill>
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

  const cyclePct   = group && group.totalCycles > 0 ? Math.round((group.currentCycle / group.totalCycles) * 100) : 0
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
  const handleCreatePin   = async () => { if (newPin.length !== 4) { setCreatePinError('PIN must be 4 digits'); return } if (newPin !== confirmPin) { setCreatePinError('PINs do not match'); return } setCreatePinLoading(true); setCreatePinError(''); try { const token = localStorage.getItem('accessToken') || localStorage.getItem('token'); const res = await fetch(`${import.meta.env.VITE_API_URL || 'http://localhost:4000'}/users/transaction-pin`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` }, body: JSON.stringify({ pin: newPin }) }); if (!res.ok) { const data = await res.json().catch(() => ({})); throw new Error(data.message || 'Failed') } showToast('PIN created', 'success'); setCreatePinModal(false); if (user) (user as any).hasTransactionPin = true } catch (err: any) { setCreatePinError(err.message || 'Failed') } finally { setCreatePinLoading(false) } }
  const handlePinConfirm  = async () => { if (!group || pin.length !== 4) return; setPinLoading(true); const idempotencyKey = `${group.id}-${user?.id}-${myPending?.id || nanoid(8)}`; try { await groupsApi.makeContribution(group.id, pin, idempotencyKey); showToast('Contribution paid', 'success'); setPinModal(false); setPin(''); refetch() } catch (err: any) { showToast(err?.response?.data?.message || 'Payment failed', 'error') } finally { setPinLoading(false) } }
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
  const handleJoinDirect  = async () => { if (!group) return; try { await joinGroup.mutateAsync({ id: group.id }); showToast('You joined the group', 'success'); refetch() } catch (err: any) { showToast(err?.response?.data?.message || 'Failed', 'error') } }
  const handleJoinRequest = async () => { if (!group) return; try { await joinGroup.mutateAsync({ id: group.id }); showToast('Request sent — waiting for approval', 'info'); refetch() } catch (err: any) { showToast(err?.response?.data?.message || 'Failed', 'error') } }
  const handleJoinWithCode = async () => { if (!group || !inviteCode.trim()) { setCodeError('Enter an invite code'); return } try { await joinGroup.mutateAsync({ id: group.id, inviteCode: inviteCode.trim() }); showToast('You joined the group', 'success'); setCodeModal(false); setInviteCode(''); refetch() } catch (err: any) { setCodeError(err?.response?.data?.message || 'Invalid code') } }
  const handleGenerateInvite  = async () => { if (!group) return; setInviteGenerating(true); try { const res = await groupsApi.generateInvite(group.id); setInviteData(res.data?.data || res.data) } catch { showToast('Failed to generate invite', 'error') } finally { setInviteGenerating(false) } }
  const handleRemoveConfirm   = async () => { if (!group || !removeTarget) return; setRemoveLoading(true); try { await groupsApi.removeMember(group.id, removeTarget.userId); showToast(`${removeTarget.user.firstName} removed`, 'success'); setRemoveTarget(null); refetch() } catch (err: any) { showToast(err?.response?.data?.message || 'Failed', 'error') } finally { setRemoveLoading(false) } }
  const handleApproveConfirm  = async () => { if (!group || !approveTarget) return; setApproveLoading(true); try { await groupsApi.approveMember(group.id, approveTarget.userId); showToast(`${approveTarget.user.firstName} approved`, 'success'); setApproveTarget(null); refetch() } catch (err: any) { showToast(err?.response?.data?.message || 'Failed', 'error') } finally { setApproveLoading(false) } }
  const handleRejectConfirm   = async () => { if (!group || !rejectTarget) return; setRejectLoading(true); try { await groupsApi.rejectMember(group.id, rejectTarget.userId); showToast('Request rejected', 'success'); setRejectTarget(null); refetch() } catch (err: any) { showToast(err?.response?.data?.message || 'Failed', 'error') } finally { setRejectLoading(false) } }
  const handleBanConfirm      = async () => { if (!group || !banTarget) return; setBanLoading(true); try { await groupsApi.banMember(group.id, banTarget.userId, banReason || undefined); showToast(`${banTarget.user.firstName} banned`, 'success'); setBanTarget(null); setBanReason(''); refetch() } catch (err: any) { showToast(err?.response?.data?.message || 'Failed', 'error') } finally { setBanLoading(false) } }
  const handleTransferConfirm = async () => { if (!group || !transferTarget) return; setTransferLoading(true); try { await groupsApi.transferOwnership(group.id, transferTarget.userId); showToast('Ownership transferred', 'success'); setTransferTarget(null); refetch() } catch (err: any) { showToast(err?.response?.data?.message || 'Failed', 'error') } finally { setTransferLoading(false) } }
  const openReorder    = () => { if (!group) return; setDragOrder([...(group.members || [])].sort((a: GroupMember, b: GroupMember) => a.payoutPosition - b.payoutPosition)); setReorderOpen(true) }
  const handleDragStart = (i: number) => setDragIdx(i)
  const handleDragEnter = (i: number) => setDragOverIdx(i)
  const handleDragEnd   = () => { if (dragIdx === null || dragOverIdx === null || dragIdx === dragOverIdx) { setDragIdx(null); setDragOverIdx(null); return } const updated = [...dragOrder]; const [moved] = updated.splice(dragIdx, 1); updated.splice(dragOverIdx, 0, moved); setDragOrder(updated); setDragIdx(null); setDragOverIdx(null) }
  const handleSaveOrder = async () => { if (!group) return; setReorderLoading(true); try { const memberIds = dragOrder.map(m => m.userId); await groupsApi.updatePayoutOrder(group.id, memberIds); showToast('Payout order updated', 'success'); setReorderOpen(false); refetch() } catch (err: any) { showToast(err?.response?.data?.message || 'Failed', 'error') } finally { setReorderLoading(false) } }
  const handleStartGroup  = async () => { if (!group) return; setLifecycleLoading(true); try { await groupsApi.startGroup(group.id);  showToast('Group started', 'success'); refetch() } catch (err: any) { showToast(err?.response?.data?.message || 'Failed', 'error') } finally { setLifecycleLoading(false) } }
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
      <div className="p-4 sm:p-6 space-y-4 max-w-6xl mx-auto">
        <Skeleton className="h-52 w-full rounded-xl"/>
        <div className="grid md:grid-cols-3 gap-4">{[...Array(3)].map((_,i) => <Skeleton key={i} className="h-28 rounded-xl"/>)}</div>
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
  const cycleOptions  = Array.from({ length: Math.max(group.currentCycle, 1) }, (_, i) => i + 1)

  const headerStats = [
    { label: `${contribFreqLabel} contribution`, val: fmt(group.contributionAmount) },
    { label: 'Payout frequency', val: payoutFreqLabel },
    { label: 'Members', val: `${group.memberCount} / ${group.maxMembers}` },
    { label: 'Current cycle', val: `${group.currentCycle} of ${group.totalCycles}` },
    { label: 'Next payout', val: group.nextContributionDate ? dayjs(group.nextContributionDate).format('MMM D, YYYY') : '—' },
  ]

  return (
    <DashboardLayout title={group.name} subtitle={`${contribFreqLabel} savings circle · ${group.visibility.toLowerCase()} group`}>
      <div className="max-w-6xl mx-auto px-4 sm:px-6 py-5 sm:py-6 space-y-4">

        <Link to="/groups" className="inline-flex items-center gap-1.5 text-[12.5px] text-mist hover:text-ink transition-colors">
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7"/></svg>
          Back to groups
        </Link>

        {isFrozen && (
          <div className="bg-red-50 border border-red-200 rounded-xl p-4 flex items-start gap-3">
            <div className="w-9 h-9 rounded-lg bg-red-100 flex items-center justify-center flex-shrink-0">
              <svg className="w-5 h-5 text-red-500" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 9v2m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"/></svg>
            </div>
            <div>
              <p className="text-[13px] font-semibold text-red-700">This group has been frozen by an administrator</p>
              <p className="text-[12px] text-red-500 mt-0.5">All activity is suspended. Only an admin can unfreeze this group.{(group as any).frozenReason ? ` Reason: ${(group as any).frozenReason}` : ''}</p>
            </div>
          </div>
        )}

        {/* ── Header panel ── */}
        <motion.div {...rise(0)}>
          <RibbonPanel className="px-6 sm:px-8 py-6 sm:py-7">
            <div className="flex items-start justify-between gap-6 flex-wrap">
              <div className="min-w-0">
                <div className="flex items-center gap-2.5 flex-wrap">
                  <p className="text-[10px] font-semibold tracking-[0.14em] uppercase text-white/40">{contribFreqLabel} savings circle</p>
                  <DarkStatus status={group.status}/>
                  {isFrozen && <span className="inline-flex items-center px-2 py-0.5 rounded-md bg-red-500/20 text-red-200 text-[11px] font-medium">Frozen by admin</span>}
                </div>
                <h1 className="text-[28px] sm:text-[34px] font-semibold tracking-tight text-white mt-2 leading-tight">{group.name}</h1>
                <p className="text-[12.5px] text-white/45 mt-1.5">{group.visibility.charAt(0) + group.visibility.slice(1).toLowerCase().replace('_', ' ')} group</p>
              </div>

              <div className="w-full sm:w-72">
                <div className="flex items-center justify-between mb-2 text-[12px]">
                  <span className="text-white/55">Cycle {group.currentCycle} progress</span>
                  <span className="font-semibold text-white tabular-nums">{cyclePct}%</span>
                </div>
                <div className="h-1.5 bg-white/10 rounded-full overflow-hidden">
                  <motion.div className="h-full rounded-full bg-lime" initial={{ width: 0 }} animate={{ width: `${cyclePct}%` }} transition={{ duration: 0.8, ease: EASE }}/>
                </div>
                <p className="text-[11px] text-white/40 mt-2 tabular-nums">{fmt(collected)} of {fmt(totalPool)} collected</p>
              </div>
            </div>

            {/* Stats strip */}
            <div className="grid grid-cols-2 sm:grid-cols-5 mt-6 border border-white/10 rounded-lg overflow-hidden bg-white/[0.02]">
              {headerStats.map((s, i) => (
                <div key={s.label} className={`px-4 py-3.5 border-white/10 ${i > 0 ? 'sm:border-l' : ''} ${i >= 2 ? 'border-t sm:border-t-0' : ''}`}>
                  <p className="text-[10px] font-semibold tracking-[0.12em] uppercase text-white/40">{s.label}</p>
                  <p className="text-[15px] font-semibold text-white tabular-nums mt-1.5">{s.val}</p>
                </div>
              ))}
            </div>

            {/* CTA buttons */}
            <div className="flex items-center gap-2 mt-5 flex-wrap">
              {isMember && myPending && !isFrozen && (
                <button onClick={handleContribute} disabled={pinLoading} className={`${BTN_LIME} !h-10 !px-5`}>
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4"/></svg>
                  Contribute now · {fmt(myPending.amount)}
                </button>
              )}
              {isMember && !myPending && !isFrozen && (
                <div className="h-10 px-4 rounded-lg border border-white/15 bg-white/[0.04] text-[13px] font-medium text-white/70 flex items-center gap-2">
                  <svg className="w-4 h-4 text-lime" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7"/></svg>
                  Contribution up to date
                </div>
              )}
              {isAdmin && !isFrozen && (
                <button onClick={handleGenerateInvite} disabled={inviteGenerating} className={`${BTN_ON_DARK} !h-10`}>
                  {inviteGenerating
                    ? <span className="w-4 h-4 rounded-full border-2 border-white/50 border-t-transparent animate-spin flex-shrink-0"/>
                    : <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M18 9v3m0 0v3m0-3h3m-3 0h-3m-2-5a4 4 0 11-8 0 4 4 0 018 0zM3 20a6 6 0 0112 0v1H3v-1z"/></svg>}
                  {inviteGenerating ? 'Generating…' : 'Invite members'}
                </button>
              )}
              {!myMembership && !isFull && !isFrozen && (group.status === 'ACTIVE' || group.status === 'DRAFT') && (
                <button onClick={handleJoinClick} disabled={joinGroup.isPending} className={`${BTN_LIME} !h-10 !px-5`}>
                  {joinGroup.isPending ? 'Joining…' : group.visibility === 'PRIVATE' ? 'Enter code to join' : group.visibility === 'INVITE_ONLY' ? 'Request to join' : 'Join group'}
                </button>
              )}
              {isOwner && group.status === 'DRAFT' && !isFrozen && (
                <button onClick={handleStartGroup} disabled={lifecycleLoading} className={`${BTN_LIME} !h-10`}>
                  {lifecycleLoading ? '…' : 'Start group'}
                </button>
              )}
              {isOwner && group.status === 'ACTIVE' && !isFrozen && !cycleStarted && (
                <button onClick={handlePauseGroup} disabled={lifecycleLoading} className={`${BTN_ON_DARK} !h-10`}>
                  {lifecycleLoading ? '…' : 'Pause group'}
                </button>
              )}
              {isOwner && group.status === 'PAUSED' && !isFrozen && !cycleStarted && (
                <button onClick={handleResumeGroup} disabled={lifecycleLoading} className={`${BTN_LIME} !h-10`}>
                  {lifecycleLoading ? '…' : 'Resume group'}
                </button>
              )}
              {isOwner && group.status === 'DRAFT' && (
                <button onClick={handleDeleteGroup} disabled={deleteLoading}
                  className="h-10 px-4 rounded-lg border border-red-400/40 text-red-300 text-[13px] font-medium hover:bg-red-500/10 transition-colors flex items-center gap-2 disabled:opacity-50">
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"/></svg>
                  {deleteLoading ? 'Deleting…' : 'Delete group'}
                </button>
              )}
              {isAdmin && (
                <button onClick={openEdit} className={`${BTN_ON_DARK} !h-10 sm:ml-auto`}>
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z"/><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"/></svg>
                  Settings
                </button>
              )}
            </div>
          </RibbonPanel>
        </motion.div>

        {/* ── Tabs ── */}
        <div className={`${CARD} overflow-x-auto`}>
          <div className="flex px-2">
            {TABS.map(t => (
              <button key={t.id} onClick={() => setTab(t.id)}
                className={`relative px-4 py-3.5 text-[13px] font-medium whitespace-nowrap transition-colors border-b-2 ${tab === t.id ? 'border-void text-ink' : 'border-transparent text-mist hover:text-ink'}`}>
                {t.label}
              </button>
            ))}
          </div>
        </div>

        {/* Invite banner */}
        <AnimatePresence>
          {inviteData && (
            <motion.div className={`${CARD} p-5 flex items-center justify-between gap-4 flex-wrap`}
              initial={{ opacity:0, y:-8 }} animate={{ opacity:1, y:0 }} exit={{ opacity:0, y:-8 }}>
              <div className="min-w-0">
                <p className="text-[13px] font-semibold text-ink">Invite link generated</p>
                <p className="text-[12px] text-mist font-mono mt-1 truncate">{inviteData.url}</p>
                {inviteData.code && <p className="text-[12px] text-brand font-mono mt-1">Code: <span className="font-bold">{inviteData.code}</span></p>}
              </div>
              <div className="flex gap-2 flex-shrink-0">
                <button onClick={() => navigator.clipboard.writeText(inviteData.url).then(() => showToast('Copied','success'))} className={BTN_SECONDARY}>Copy link</button>
                {inviteData.code && <button onClick={() => navigator.clipboard.writeText(inviteData.code).then(() => showToast('Copied','success'))} className={BTN_SECONDARY}>Copy code</button>}
                <button onClick={() => setInviteData(null)} className="h-9 px-3 rounded-lg text-[12px] text-mist hover:text-ink transition-colors">✕</button>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* PIN prompt */}
        {isMember && !user?.hasTransactionPin && (
          <div className="bg-amber-50 border border-amber-200 rounded-lg px-4 py-3 flex items-center justify-between gap-4 flex-wrap">
            <div>
              <p className="text-[13px] font-semibold text-amber-800">Set your transaction PIN</p>
              <p className="text-[12px] text-amber-600 mt-0.5">A 4-digit PIN is required to make contributions.</p>
            </div>
            <button onClick={() => { setNewPin(''); setConfirmPin(''); setCreatePinError(''); setCreatePinModal(true) }}
              className="h-8 px-4 rounded-md bg-void text-white text-[12px] font-semibold hover:opacity-90 transition-opacity">Set PIN</button>
          </div>
        )}

        {/* Tab content */}
        <AnimatePresence mode="wait">
          <motion.div key={tab} initial={{ opacity:0, y:6 }} animate={{ opacity:1, y:0 }} exit={{ opacity:0 }} transition={{ duration:0.18, ease:EASE }}>

            {/* OVERVIEW */}
            {tab === 'overview' && (
              <div className="grid lg:grid-cols-3 gap-4">
                <div className="lg:col-span-2 space-y-4">
                  <GroupTerms group={group} myMemberInfo={myMemberInfo}/>

                  <div className={CARD}>
                    <div className="px-5 py-4 border-b border-black/[0.06]"><p className="text-[14px] font-semibold text-ink">Contribution overview</p></div>
                    <div className="grid grid-cols-2 sm:grid-cols-4 divide-x divide-black/[0.06]">
                      {[{ label:'Total pool', val:fmt(totalPool) },{ label:'Collected', val:fmt(collected) },{ label:'Remaining', val:fmt(remaining) },{ label:'Completion', val:`${completion}%` }].map((s, i) => (
                        <div key={s.label} className={`p-4 sm:p-5 ${i >= 2 ? 'border-t sm:border-t-0 border-black/[0.06]' : ''}`}>
                          <p className={LABEL}>{s.label}</p>
                          <p className="text-[20px] font-semibold text-ink tracking-tight tabular-nums mt-2 leading-none">{s.val}</p>
                        </div>
                      ))}
                    </div>
                    <div className="px-5 pb-5 pt-1 space-y-2">
                      <div className="h-1.5 bg-sand rounded-full overflow-hidden"><motion.div className="h-full rounded-full" style={{ background: 'linear-gradient(90deg, #1B5C3C, #A8E03A)' }} initial={{ width:0 }} animate={{ width:`${completion}%` }} transition={{ duration:0.8, ease:EASE }}/></div>
                      <div className="flex justify-between text-[11px] text-mist font-mono"><span>Start: {dayjs(group.createdAt).format('MMM D, YYYY')}</span><span>End: {group.nextContributionDate ? dayjs(group.nextContributionDate).format('MMM D, YYYY') : '—'}</span></div>
                    </div>
                  </div>

                  <div className={`${CARD} overflow-hidden`}>
                    <div className="flex items-center justify-between px-5 py-4 border-b border-black/[0.06]">
                      <p className="text-[14px] font-semibold text-ink">Recent contributions</p>
                      <button onClick={() => setTab('contributions')} className="text-[12px] font-medium text-brand hover:underline">View all</button>
                    </div>
                    <div className="px-5">
                      {(group.contributions || []).length === 0
                        ? <div className="py-10 text-center"><p className="text-[13px] text-mist">No contributions yet</p></div>
                        : (group.contributions || []).slice(0,5).map((c: Contribution) => <ContribRow key={c.id} c={c} isAdmin={isAdmin}/>)}
                    </div>
                  </div>
                </div>

                <div className="space-y-4">
                  {myMemberInfo && (
                    <div className="relative overflow-hidden bg-void rounded-xl border border-white/[0.07] p-5">
                      <div className="absolute -top-16 -right-14 w-[220px] h-[220px] pointer-events-none" style={{ background: 'radial-gradient(closest-side, rgba(27,92,60,0.5), transparent)' }} />
                      <p className="relative text-[14px] font-semibold text-white mb-4">Your payout</p>
                      <div className="relative space-y-3">
                        <div className="flex justify-between"><span className="text-[12px] text-white/45">Position</span><span className="text-[13px] font-semibold text-white">#{myMemberInfo.payoutPosition}</span></div>
                        {myMemberInfo.estimatedPayoutAmount != null && (
                          <div className="flex justify-between"><span className="text-[12px] text-white/45">You'll receive</span><span className="text-[13px] font-semibold text-lime tabular-nums">{fmt(Number(myMemberInfo.estimatedPayoutAmount)/100)}</span></div>
                        )}
                        <div className="flex justify-between"><span className="text-[12px] text-white/45">Expected date</span><span className="text-[13px] font-semibold text-white">{myMemberInfo.expectedPayoutDate ? dayjs(myMemberInfo.expectedPayoutDate).format('MMM D, YYYY') : (myMemberInfo.isNextRecipient ? 'You are next' : '—')}</span></div>
                        {myMemberInfo.isNextRecipient && (
                          <div className="rounded-lg border border-lime/30 bg-lime/10 px-3 py-2"><p className="text-[12px] font-medium text-lime">You're next in line to receive the pot</p></div>
                        )}
                      </div>
                    </div>
                  )}

                  <div className={`${CARD} overflow-hidden`}>
                    <div className="flex items-center justify-between px-5 py-4 border-b border-black/[0.06]">
                      <p className="text-[14px] font-semibold text-ink">Payout rotation</p>
                      {canReorder && <button onClick={openReorder} className="text-[12px] font-medium text-brand hover:underline">Reorder</button>}
                    </div>
                    <div className="px-5">
                      {(group.members || []).slice(0,8).map((m: GroupMember, i: number) => {
                        const isNext = i + 1 === group.currentCycle
                        return (
                          <div key={m.id} className={`flex items-center gap-3 py-3 border-b border-black/[0.05] last:border-0 ${isNext ? 'bg-brand-pale/40 -mx-5 px-5' : ''}`}>
                            <div className={`w-8 h-8 rounded-lg flex items-center justify-center text-[11px] font-semibold flex-shrink-0 ${isNext ? 'bg-brand text-white' : 'bg-warm text-dim'}`}>
                              {i + 1 < group.currentCycle ? '✓' : (m.user.username || m.user.firstName)[0].toUpperCase()}
                            </div>
                            <div className="flex-1 min-w-0">
                              <p className="text-[13px] font-medium text-ink">{m.user.firstName} {m.user.lastName}</p>
                              <p className="text-[11px] text-mist">{isNext ? 'Next to receive' : 'Waiting'}</p>
                            </div>
                            <span className={`text-[11px] font-mono ${isNext ? 'text-brand font-semibold' : 'text-mist'}`}>#{m.payoutPosition}</span>
                          </div>
                        )
                      })}
                    </div>
                    {group.nextContributionDate && (
                      <div className="px-5 py-3.5 border-t border-black/[0.06] flex items-center justify-between">
                        <p className="text-[12px] text-mist">Next payout date</p>
                        <p className="text-[13px] font-semibold text-ink">{dayjs(group.nextContributionDate).format('MMM D, YYYY')}</p>
                      </div>
                    )}
                  </div>

                  <div className={`${CARD} overflow-hidden`}>
                    <div className="flex items-center justify-between px-5 py-4 border-b border-black/[0.06]">
                      <p className="text-[14px] font-semibold text-ink">Group activity</p>
                      <button onClick={() => setTab('activity')} className="text-[12px] font-medium text-brand hover:underline">View all</button>
                    </div>
                    <div className="px-5 py-3 space-y-3">
                      {(group.contributions || []).slice(0,3).map((c: Contribution) => (
                        <div key={c.id} className="flex items-start gap-3">
                          <div className={`w-1.5 h-1.5 rounded-full mt-2 flex-shrink-0 ${c.status === 'PAID' ? 'bg-emerald-500' : 'bg-amber-400'}`}/>
                          <div className="flex-1">
                            <p className="text-[12.5px] font-medium text-ink">{c.user?.firstName} {c.user?.lastName}</p>
                            <p className="text-[11px] text-mist font-mono">paid {fmt(c.amount)} · {c.paidAt ? dayjs(c.paidAt).format('MMM D, YYYY · h:mm A') : '—'}</p>
                          </div>
                        </div>
                      ))}
                      {(group.contributions || []).length === 0 && <p className="text-[12px] text-mist py-3 text-center">No activity yet</p>}
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* MEMBERS */}
            {tab === 'members' && (
              <div className={`${CARD} overflow-hidden`}>
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[720px]">
                    <thead className="bg-warm/60">
                      <tr>{['Member','Role','Position','Total paid','Status','Actions'].map(h => <th key={h} className={`px-5 py-2.5 text-left ${LABEL}`}>{h}</th>)}</tr>
                    </thead>
                    <tbody>
                      {(group.members || []).map((m: GroupMember) => (
                        <tr key={m.id} className="border-t border-black/[0.05] hover:bg-warm/50 transition-colors">
                          <td className="px-5 py-3.5">
                            <div className="flex items-center gap-3">
                              <Initials first={m.user.firstName} last={m.user.lastName} />
                              <div><p className="text-[13px] font-medium text-ink">{m.user.firstName} {m.user.lastName}</p><p className="text-[11px] text-mist font-mono">@{m.user.username}</p></div>
                            </div>
                          </td>
                          <td className="px-5 py-3.5"><Pill tone={m.role === 'ADMIN' ? 'info' : 'neutral'}>{m.role.toLowerCase()}</Pill></td>
                          <td className="px-5 py-3.5 text-[12.5px] text-dim font-mono">#{m.payoutPosition}</td>
                          <td className="px-5 py-3.5 text-[13px] font-semibold text-ink tabular-nums">{fmt(m.totalPaid)}</td>
                          <td className="px-5 py-3.5"><Pill tone={m.status === 'ACTIVE' ? 'success' : m.status === 'PENDING' ? 'warn' : 'danger'}>{m.status.toLowerCase()}</Pill></td>
                          <td className="px-5 py-3.5">
                            <div className="flex gap-1.5 flex-wrap">
                              {isAdmin && m.status === 'PENDING' && (<><button onClick={() => setApproveTarget(m)} className={`${BTN_SM} bg-void text-white hover:bg-pitch`}>Approve</button><button onClick={() => setRejectTarget(m)} className={`${BTN_SM} border border-black/[0.1] text-dim hover:bg-warm`}>Reject</button></>)}
                              {isAdmin && m.userId !== user?.id && m.status === 'ACTIVE' && !cycleStarted && (<><button onClick={() => setRemoveTarget(m)} className={`${BTN_SM} border border-red-200 text-red-600 hover:bg-red-50`}>Remove</button><button onClick={() => { setBanTarget(m); setBanReason('') }} className={`${BTN_SM} border border-black/[0.1] text-dim hover:bg-warm`}>Ban</button></>)}
                              {isOwner && m.userId !== user?.id && m.status === 'ACTIVE' && m.role !== 'ADMIN' && (<button onClick={() => setTransferTarget(m)} className={`${BTN_SM} border border-black/[0.1] text-dim hover:bg-warm`}>Make owner</button>)}
                              {m.userId !== user?.id && (<button onClick={() => { setMemberReportTarget(m); setMemberReportCategory(''); setMemberReportDescription('') }} className={`${BTN_SM} border border-black/[0.1] text-mist hover:bg-warm`}>Report</button>)}
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {/* CONTRIBUTIONS — with a cycle selector so past cycles are browsable */}
            {tab === 'contributions' && (
              <div className={`${CARD} overflow-hidden`}>
                <div className="flex items-center justify-between px-5 py-4 border-b border-black/[0.06] flex-wrap gap-3">
                  <p className="text-[14px] font-semibold text-ink">Cycle {selectedCycle ?? group.currentCycle} contributions</p>
                  {cycleOptions.length > 0 && (
                    <select
                      value={selectedCycle ?? group.currentCycle}
                      onChange={e => setSelectedCycle(Number(e.target.value))}
                      className="h-9 border border-black/[0.1] rounded-lg px-3 text-[12.5px] font-medium text-dim outline-none focus:border-brand bg-white cursor-pointer"
                    >
                      {cycleOptions.map(n => (
                        <option key={n} value={n}>Cycle {n}{n === group.currentCycle ? ' (current)' : ''}</option>
                      ))}
                    </select>
                  )}
                </div>
                <div className="px-5">
                  {cycleLoading ? (
                    <div className="py-10 space-y-3">{[...Array(3)].map((_, i) => <Skeleton key={i} className="h-12 rounded-lg"/>)}</div>
                  ) : (cycleContributions || []).length === 0 ? (
                    <div className="py-12 text-center"><p className="text-[13px] text-mist">No contributions for this cycle yet</p></div>
                  ) : (
                    (cycleContributions || []).map((c: Contribution) => <ContribRow key={c.id} c={c} isAdmin={isAdmin}/>)
                  )}
                </div>
              </div>
            )}

            {/* PAYOUTS — history plus the upcoming rotation order */}
            {tab === 'payouts' && (
              <div className="space-y-4">
                <div className={`${CARD} overflow-hidden`}>
                  <div className="px-5 py-4 border-b border-black/[0.06]">
                    <p className="text-[14px] font-semibold text-ink">Payout history</p>
                    <p className="text-[12px] text-mist mt-0.5">Every payout for this group, every cycle, any status.</p>
                  </div>
                  {payoutsLoading ? (
                    <div className="p-5 space-y-3">{[...Array(3)].map((_, i) => <Skeleton key={i} className="h-14 rounded-lg"/>)}</div>
                  ) : (payoutHistory || []).length === 0 ? (
                    <div className="py-12 text-center"><p className="text-[13px] text-mist">No payouts yet</p></div>
                  ) : (
                    <div>{(payoutHistory || []).map((p: any) => <PayoutRow key={p.id} p={p}/>)}</div>
                  )}
                </div>

                <div className={`${CARD} overflow-hidden`}>
                  <div className="px-5 py-4 border-b border-black/[0.06]"><p className="text-[14px] font-semibold text-ink">Upcoming rotation order</p></div>
                  <div>
                    {(group.members || []).map((m: GroupMember, i: number) => {
                      const isNext = i + 1 === group.currentCycle
                      return (
                        <div key={m.id} className={`flex items-center gap-4 px-5 py-3.5 border-b border-black/[0.05] last:border-0 ${isNext ? 'bg-brand-pale/40' : ''}`}>
                          <Initials first={m.user.firstName} last={m.user.lastName} size={40} />
                          <div className="flex-1"><p className="text-[13px] font-medium text-ink">{m.user.firstName} {m.user.lastName}</p><p className="text-[11px] text-mist font-mono">@{m.user.username}</p></div>
                          <div className="text-right"><p className="text-[14px] font-semibold text-ink tabular-nums">{fmt(group.contributionAmount * (group.memberCount || 1))}</p><p className="text-[11px] text-mist">Position #{m.payoutPosition}</p></div>
                          {isNext && <Pill tone="success">Next</Pill>}
                          {i < group.currentCycle - 1 && <Pill tone="neutral">Paid</Pill>}
                        </div>
                      )
                    })}
                  </div>
                </div>
              </div>
            )}

            {/* ACTIVITY */}
            {tab === 'activity' && (
              <div className={`${CARD} overflow-hidden`}>
                <div className="px-5 py-4 border-b border-black/[0.06]"><p className="text-[14px] font-semibold text-ink">Group activity</p></div>
                <div className="px-5">
                  {(group.contributions || []).length === 0 ? <div className="py-12 text-center"><p className="text-[13px] text-mist">No activity yet</p></div>
                  : (group.contributions || []).map((c: Contribution) => (
                    <div key={c.id} className="flex items-start gap-3 py-3.5 border-b border-black/[0.05] last:border-0">
                      <Initials first={c.user?.firstName} last={c.user?.lastName} />
                      <div className="flex-1"><p className="text-[13px] font-medium text-ink">{c.user?.firstName} {c.user?.lastName}</p><p className="text-[12px] text-dim">paid {fmt(c.amount)}</p><p className="text-[11px] text-mist font-mono">{c.paidAt ? dayjs(c.paidAt).format('MMM D, YYYY · h:mm A') : '—'}</p></div>
                      <Pill tone={contribTone(c.status)}>{c.status.charAt(0) + c.status.slice(1).toLowerCase()}</Pill>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* CHAT */}
            {tab === 'chat' && (
              <div className={`${CARD} overflow-hidden`}>
                <div className="px-5 py-4 border-b border-black/[0.06] flex items-center justify-between">
                  <p className="text-[14px] font-semibold text-ink">Group chat</p>
                  {isAdmin && (<button onClick={handleToggleChat} disabled={chatLockLoading} className="text-[12px] font-medium text-mist hover:text-ink transition-colors disabled:opacity-50">{chatLockLoading ? '…' : group.chatEnabled ? 'Lock chat' : 'Unlock chat'}</button>)}
                </div>
                {group.chatEnabled ? <GroupChat groupId={group.id} currentUserId={user?.id || ''} isAdmin={isAdmin} members={chatMembers}/> : <div className="py-12 text-center"><p className="text-[13px] text-mist">Chat is currently locked by the admin.</p></div>}
              </div>
            )}

            {/* ANALYTICS */}
            {tab === 'analytics' && analytics && (
              <div className="space-y-4">
                <div className={`${CARD} grid grid-cols-2 md:grid-cols-4 divide-x divide-black/[0.06]`}>
                  {[
                    { label:'Collection rate', val:`${(analytics as any).overview?.collectionRate}%` },
                    { label:'Total collected',  val:fmt((analytics as any).overview?.totalCollected || 0) },
                    { label:'Total paid out',   val:fmt((analytics as any).overview?.totalPaidOut || 0) },
                    { label:'Paid this cycle',  val:`${(analytics as any).overview?.paidThisCycle} / ${(analytics as any).overview?.totalMembers}` },
                  ].map((m, i) => (
                    <div key={m.label} className={`p-5 ${i >= 2 ? 'border-t md:border-t-0 border-black/[0.06]' : ''}`}>
                      <p className={LABEL}>{m.label}</p>
                      <p className="text-[24px] font-semibold text-ink tracking-tight tabular-nums mt-2 leading-none">{m.val}</p>
                    </div>
                  ))}
                </div>
                <div className={`${CARD} p-5`}>
                  <p className="text-[14px] font-semibold text-ink mb-4">Weekly collection</p>
                  <ResponsiveContainer width="100%" height={220}>
                    <BarChart data={(analytics as any).weeklyData || []} margin={{ left:-20, top:8 }} barCategoryGap="28%">
                      <CartesianGrid vertical={false} stroke="#EDE9E1" />
                      <XAxis dataKey="week" tick={{ fontSize:10, fill:'#9A968E' }} axisLine={false} tickLine={false} tickFormatter={v => dayjs(v).format('MMM D')}/>
                      <YAxis tick={{ fontSize:10, fill:'#9A968E' }} axisLine={false} tickLine={false} tickFormatter={v => `₦${Math.floor(v/1000)}K`}/>
                      <Tooltip cursor={{ fill:'#F4F1EA' }} contentStyle={{ background:'#fff', border:'1px solid #E5E1D8', borderRadius:8, fontSize:12 }} formatter={(v: any) => [`₦${Number(v).toLocaleString()}`, 'Collected']}/>
                      <Bar dataKey="collected" fill="#1B5C3C" radius={[4,4,0,0]} maxBarSize={30}/>
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </div>
            )}

            {/* SETTINGS */}
            {tab === 'settings' && (
              <div className="max-w-2xl space-y-4">
                <div className={`${CARD} p-6`}>
                  <p className="text-[15px] font-semibold text-ink mb-5">Group settings</p>
                  <form className="space-y-4">
                    <Input label="Group name" error={editErrors.name?.message} {...regEdit('name')}/>
                    <div><label className="block text-[12px] font-semibold text-dim mb-1.5">Description</label><textarea {...regEdit('description')} rows={2} className={`${FIELD} resize-none`}/></div>
                    <Select label="Visibility" options={VIS_OPTS} error={editErrors.visibility?.message} {...regEdit('visibility')}/>
                    <div className="grid grid-cols-2 gap-4">
                      <Input label="Payment deadline (days)" type="number" error={editErrors.deadlineDays?.message} {...regEdit('deadlineDays')}/>
                      <Input label="Late penalty (₦)" type="number" error={editErrors.penaltyAmount?.message} {...regEdit('penaltyAmount')}/>
                    </div>
                    <button type="button" onClick={handleEditSubmit(onEditSubmit)} disabled={editLoading} className={`${BTN_PRIMARY} !h-10 !px-5`}>
                      {editLoading ? 'Saving…' : 'Save changes'}
                    </button>
                  </form>
                </div>
                <div className={`${CARD} p-6`}>
                  <p className="text-[15px] font-semibold text-ink mb-1">Report this group</p>
                  <p className="text-[13px] text-mist mb-4">Something wrong? Let our team know.</p>
                  <div className="space-y-3">
                    <select value={reportCategory} onChange={e => setReportCategory(e.target.value)} className={selectCls}>
                      <option value="">Select a reason</option>
                      {GROUP_REPORT_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
                    </select>
                    <textarea value={reportDescription} onChange={e => setReportDescription(e.target.value)} rows={3} placeholder="Describe the issue…" className={`${FIELD} resize-none`}/>
                    <button onClick={handleGroupReport} disabled={reportLoading || !reportCategory || !reportDescription.trim()}
                      className="h-9 px-4 rounded-lg bg-red-600 text-white text-[12px] font-semibold hover:bg-red-700 disabled:opacity-50 transition-colors">
                      {reportLoading ? 'Submitting…' : 'Submit report'}
                    </button>
                  </div>
                </div>
              </div>
            )}

          </motion.div>
        </AnimatePresence>
      </div>

      {/* MODALS */}
      <Modal open={createPinModal} onClose={() => setCreatePinModal(false)} title="Create transaction PIN" size="sm"
        footer={<><Button variant="secondary" onClick={() => setCreatePinModal(false)}>Later</Button><Button onClick={handleCreatePin} loading={createPinLoading} disabled={newPin.length !== 4 || confirmPin.length !== 4}>Create PIN</Button></>}>
        <div className="space-y-4">
          <div className="bg-amber-50 border border-amber-100 rounded-lg p-4"><p className="text-[13px] text-amber-800">You'll need this 4-digit PIN to make contributions. Keep it safe.</p></div>
          <Input label="New PIN" type="password" maxLength={4} placeholder="••••" value={newPin} onChange={e => { setNewPin(e.target.value.replace(/\D/g,'')); setCreatePinError('') }}/>
          <Input label="Confirm PIN" type="password" maxLength={4} placeholder="••••" value={confirmPin} onChange={e => { setConfirmPin(e.target.value.replace(/\D/g,'')); setCreatePinError('') }}/>
          {createPinError && <p className="text-[12px] text-red-500">{createPinError}</p>}
        </div>
      </Modal>

      <Modal open={pinModal} onClose={() => { setPinModal(false); setPin('') }} title="Confirm payment" size="sm"
        footer={<><Button variant="secondary" onClick={() => { setPinModal(false); setPin('') }}>Cancel</Button><Button onClick={handlePinConfirm} loading={pinLoading} disabled={pin.length !== 4}>Confirm</Button></>}>
        <div className="space-y-3">
          <div className="bg-brand-pale/60 border border-brand/10 rounded-lg p-4"><p className="text-[13px] font-semibold text-brand">Paying {myPending ? fmt(myPending.amount) : ''} from your wallet</p></div>
          <Input label="Transaction PIN" type="password" maxLength={4} placeholder="••••" value={pin} onChange={e => setPin(e.target.value.replace(/\D/g,''))}/>
        </div>
      </Modal>

      <Modal open={codeModal} onClose={() => setCodeModal(false)} title="Enter invite code" size="sm"
        footer={<><Button variant="secondary" onClick={() => setCodeModal(false)}>Cancel</Button><Button onClick={handleJoinWithCode} loading={joinGroup.isPending} disabled={!inviteCode.trim()}>Join</Button></>}>
        <p className="text-[13px] text-dim mb-4">This is a private group. Ask the admin for the invite code.</p>
        <Input label="Invite code" placeholder="Enter code here" value={inviteCode} onChange={e => { setInviteCode(e.target.value); setCodeError('') }}/>
        {codeError && <p className="text-[12px] text-red-500 mt-2">{codeError}</p>}
      </Modal>

      <Modal open={editOpen} onClose={() => setEditOpen(false)} title="Group settings" size="lg"
        footer={<><Button variant="secondary" onClick={() => setEditOpen(false)}>Cancel</Button><Button onClick={handleEditSubmit(onEditSubmit)} loading={editLoading}>Save changes</Button></>}>
        <form className="grid grid-cols-2 gap-4">
          <div className="col-span-2"><Input label="Group name" error={editErrors.name?.message} {...regEdit('name')}/></div>
          <div className="col-span-2"><label className="block text-[12px] font-semibold text-dim mb-1.5">Description</label><textarea {...regEdit('description')} rows={2} className={`${FIELD} resize-none`}/></div>
          <div className="col-span-2"><Select label="Visibility" options={VIS_OPTS} error={editErrors.visibility?.message} {...regEdit('visibility')}/></div>
          <Input label="Deadline (days)" type="number" error={editErrors.deadlineDays?.message} {...regEdit('deadlineDays')}/>
          <Input label="Late penalty (₦)" type="number" error={editErrors.penaltyAmount?.message} {...regEdit('penaltyAmount')}/>
        </form>
      </Modal>

      <Modal open={!!removeTarget} onClose={() => setRemoveTarget(null)} title="Remove member" size="sm"
        footer={<><Button variant="secondary" onClick={() => setRemoveTarget(null)}>Cancel</Button><Button variant="danger" onClick={handleRemoveConfirm} loading={removeLoading}>Remove</Button></>}>
        <p className="text-[13px] text-dim">Remove <strong className="text-ink">{removeTarget?.user.firstName} {removeTarget?.user.lastName}</strong> from this group? They'll lose their payout position.</p>
      </Modal>

      <Modal open={!!approveTarget} onClose={() => setApproveTarget(null)} title="Approve member" size="sm"
        footer={<><Button variant="secondary" onClick={() => setApproveTarget(null)}>Cancel</Button><Button onClick={handleApproveConfirm} loading={approveLoading}>Approve</Button></>}>
        <p className="text-[13px] text-dim">Approve <strong className="text-ink">{approveTarget?.user.firstName} {approveTarget?.user.lastName}</strong> to join this group?</p>
      </Modal>

      <Modal open={!!rejectTarget} onClose={() => setRejectTarget(null)} title="Reject request" size="sm"
        footer={<><Button variant="secondary" onClick={() => setRejectTarget(null)}>Cancel</Button><Button variant="danger" onClick={handleRejectConfirm} loading={rejectLoading}>Reject</Button></>}>
        <p className="text-[13px] text-dim">Reject <strong className="text-ink">{rejectTarget?.user.firstName} {rejectTarget?.user.lastName}</strong>'s join request?</p>
      </Modal>

      <Modal open={!!banTarget} onClose={() => { setBanTarget(null); setBanReason('') }} title="Ban member" size="sm"
        footer={<><Button variant="secondary" onClick={() => { setBanTarget(null); setBanReason('') }}>Cancel</Button><Button variant="danger" onClick={handleBanConfirm} loading={banLoading}>Ban</Button></>}>
        <div className="space-y-3">
          <p className="text-[13px] text-dim">Ban <strong className="text-ink">{banTarget?.user.firstName} {banTarget?.user.lastName}</strong>? They won't be able to rejoin.</p>
          <Input label="Reason (optional)" placeholder="e.g. repeated non-payment" value={banReason} onChange={e => setBanReason(e.target.value)}/>
        </div>
      </Modal>

      <Modal open={!!transferTarget} onClose={() => setTransferTarget(null)} title="Transfer ownership" size="sm"
        footer={<><Button variant="secondary" onClick={() => setTransferTarget(null)}>Cancel</Button><Button variant="danger" onClick={handleTransferConfirm} loading={transferLoading}>Transfer</Button></>}>
        <div className="space-y-3">
          <div className="bg-red-50 border border-red-100 rounded-lg p-4"><p className="text-[13px] font-semibold text-red-700">This cannot be undone. You will lose admin rights.</p></div>
          <p className="text-[13px] text-dim">Transfer ownership to <strong className="text-ink">{transferTarget?.user.firstName} {transferTarget?.user.lastName}</strong>?</p>
        </div>
      </Modal>

      <Modal open={reorderOpen} onClose={() => setReorderOpen(false)} title="Reorder payout positions" size="sm"
        footer={<><Button variant="secondary" onClick={() => setReorderOpen(false)}>Cancel</Button><Button onClick={handleSaveOrder} loading={reorderLoading}>Save order</Button></>}>
        <p className="text-[12px] text-mist mb-3">Drag to set who gets paid first.</p>
        <div className="space-y-2">
          {dragOrder.map((m, i) => (
            <div key={m.id} draggable onDragStart={() => handleDragStart(i)} onDragEnter={() => handleDragEnter(i)} onDragEnd={handleDragEnd} onDragOver={e => e.preventDefault()}
              className={`flex items-center gap-3 p-3 bg-white border rounded-lg cursor-grab active:cursor-grabbing transition-all select-none ${dragOverIdx === i ? 'border-brand bg-brand-pale/40' : 'border-black/[0.09]'}`}>
              <span className="text-[12px] font-mono text-mist w-5">#{i+1}</span>
              <span className="text-stone text-[12px]">⠿</span>
              <Initials first={m.user.firstName} last={m.user.lastName} size={32} />
              <p className="text-[13px] font-medium text-ink flex-1">@{m.user.username}</p>
            </div>
          ))}
        </div>
      </Modal>

      <Modal open={!!memberReportTarget} onClose={() => { setMemberReportTarget(null); setMemberReportCategory(''); setMemberReportDescription('') }}
        title={`Report ${memberReportTarget?.user.firstName} ${memberReportTarget?.user.lastName}`} size="sm"
        footer={<><Button variant="secondary" onClick={() => { setMemberReportTarget(null); setMemberReportCategory(''); setMemberReportDescription('') }}>Cancel</Button><Button variant="danger" onClick={handleMemberReport} loading={memberReportLoading} disabled={!memberReportCategory || !memberReportDescription.trim()}>Submit report</Button></>}>
        <div className="space-y-4">
          <select value={memberReportCategory} onChange={e => setMemberReportCategory(e.target.value)} className={selectCls}>
            <option value="">Select a reason</option>
            {MEMBER_REPORT_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
          </select>
          <textarea value={memberReportDescription} onChange={e => setMemberReportDescription(e.target.value)} rows={4} placeholder="What happened? Include dates or specifics." className={`${FIELD} resize-none`}/>
        </div>
      </Modal>

      {/* AGREEMENT — shows the actual contribution, payout schedule, and late fee */}
      <Modal open={agreementModal} onClose={() => setAgreementModal(false)} title="Before you join" size="md"
        footer={<><Button variant="secondary" onClick={() => setAgreementModal(false)}>Cancel</Button><Button onClick={handleAcceptAgreement} loading={agreementLoading} disabled={!agreementChecked}>Accept & Join</Button></>}>
        <div className="space-y-4">
          <div className="rounded-lg border border-black/[0.07] overflow-hidden">
            <div className="px-4 py-2.5 bg-warm/60"><p className={LABEL}>This group's terms</p></div>
            <div className="divide-y divide-black/[0.05]">
              <div className="flex justify-between gap-4 px-4 py-2.5"><span className="text-[12px] text-mist">You contribute</span><span className="text-[12.5px] font-semibold text-ink text-right">{fmt(group.contributionAmount)} per {FREQ_PER[group.frequency] || 'cycle'}</span></div>
              <div className="flex justify-between gap-4 px-4 py-2.5"><span className="text-[12px] text-mist">Payout schedule</span><span className="text-[12.5px] font-semibold text-ink text-right">A member paid {FREQ_EVERY[group.payoutFrequency] || FREQ_EVERY[group.frequency] || 'each cycle'}</span></div>
              <div className="flex justify-between gap-4 px-4 py-2.5"><span className="text-[12px] text-mist">Late fee</span><span className="text-[12.5px] font-semibold text-ink text-right">{Number(group.penaltyAmount || 0) > 0 ? fmt(Number(group.penaltyAmount)) : 'None'}</span></div>
              <div className="flex justify-between gap-4 px-4 py-2.5"><span className="text-[12px] text-mist">Payment deadline</span><span className="text-[12.5px] font-semibold text-ink text-right">{group.deadlineDays || 3} day(s)</span></div>
            </div>
          </div>

          <div className="bg-amber-50 border border-amber-100 rounded-lg p-4">
            <p className="text-[13px] font-semibold text-amber-800 mb-1">Important notice</p>
            <p className="text-[12px] text-amber-700">By joining this contribution group, you agree to make every scheduled contribution on time.</p>
          </div>
          <div className="space-y-2.5 text-[12.5px] text-dim leading-relaxed">
            <p className="font-semibold text-ink">Please understand the following rules:</p>
            <div className="flex gap-2"><span className="text-mist">•</span><p>Missing your scheduled contribution will <strong>immediately pause the entire group</strong>, and every member is notified.</p></div>
            <div className="flex gap-2"><span className="text-mist">•</span><p>You'll have <strong>48 hours</strong> to complete the missed payment.</p></div>
            <div className="flex gap-2"><span className="text-mist">•</span><p>If paid within 48 hours, the group resumes automatically.</p></div>
            <div className="flex gap-2"><span className="text-mist">•</span><p>If <strong>not</strong> completed within 48 hours:</p></div>
            <div className="pl-6 space-y-1.5">
              <div className="flex gap-2"><span className="text-red-400">–</span><p>You'll be automatically removed from the group.</p></div>
              <div className="flex gap-2"><span className="text-red-400">–</span><p>A debt equal to the missed contribution, plus a late fee{Number(group.penaltyAmount || 0) > 0 ? ` of ${fmt(Number(group.penaltyAmount))}` : ''}, is added to your account.</p></div>
              <div className="flex gap-2"><span className="text-red-400">–</span><p>You won't be able to join or create another group until the debt is fully repaid.</p></div>
            </div>
            <p className="text-[12px] text-mist pt-1">Your NIN and BVN verification prevents opening another account to avoid repayment. Only join if you're confident you can complete every scheduled payment.</p>
          </div>

          <div className="bg-red-50 border border-red-200 rounded-lg p-4">
            <p className="text-[13px] font-semibold text-red-700 mb-1">Join at your own risk</p>
            <p className="text-[12px] text-red-600 leading-relaxed">
              This is a known risk in every rotating savings circle: a member paid out early in the rotation can stop contributing afterward and walk away with the pot. It's a real pattern — not everyone follows through. Our protections (48hr grace period, automatic removal, debt tracking, NIN/BVN verification) make it much harder to get away with, but they can't guarantee you'll get your money back if someone defaults after their payout. Only join groups with people you trust, or start with a small amount until the group proves reliable.
            </p>
            <p className="text-[12px] text-red-600 leading-relaxed mt-2">
              <strong>The safest option:</strong> join or create <strong>Private</strong> groups with people you personally know — friends, family, coworkers — rather than Public groups full of strangers. Private groups can only be joined with an invite code you control, so you decide exactly who's in the circle.
            </p>
          </div>

          <label className="flex items-start gap-3 bg-warm border border-black/[0.07] rounded-lg p-3.5 cursor-pointer">
            <input type="checkbox" checked={agreementChecked} onChange={e => setAgreementChecked(e.target.checked)} className="mt-0.5 w-4 h-4 rounded border-stone cursor-pointer accent-brand"/>
            <span className="text-[13px] font-semibold text-ink">I have read and understood these rules.</span>
          </label>
        </div>
      </Modal>
    </DashboardLayout>
  )
}