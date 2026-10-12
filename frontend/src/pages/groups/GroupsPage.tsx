import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { motion, AnimatePresence } from 'framer-motion'
import DashboardLayout from '@/components/layout/DashboardLayout'
import { CARD, LABEL, FIELD, BTN_PRIMARY, BTN_SECONDARY, Pill } from '@/lib/ui'
import { Input, Select, Modal, Skeleton } from '@/components/ui'
import { useGroups, useCreateGroup, useJoinGroup } from '@/hooks/useApi'
import { useAuthStore } from '@/stores/authStore'
import { useUIStore } from '@/stores/uiStore'
import { groupsApi } from '@/api/services'
import type { Group } from '@/types'
import dayjs from 'dayjs'

const createSchema = z.object({
  name:               z.string().min(3, 'Min 3 characters').max(60),
  description:        z.string().max(300).optional(),
  contributionAmount: z.coerce.number().min(100, 'Min ₦100'),
  frequency:          z.enum(['DAILY', 'WEEKLY', 'BIWEEKLY', 'MONTHLY']),
  payoutFrequency:    z.enum(['DAILY', 'WEEKLY', 'BIWEEKLY', 'MONTHLY']),
  maxMembers:         z.coerce.number().min(2).max(100),
  startDate:          z.string().min(1, 'Pick a start date'),
  visibility:         z.enum(['PUBLIC', 'PRIVATE', 'INVITE_ONLY']),
  penaltyAmount:      z.coerce.number().min(0).optional(),
  rotations:          z.coerce.number().min(1).max(52).optional(),
})
type CreateData = z.infer<typeof createSchema>

const FREQ_OPTS = [
  { value: 'DAILY',    label: 'Daily'     },
  { value: 'WEEKLY',   label: 'Weekly'    },
  { value: 'BIWEEKLY', label: 'Bi-weekly' },
  { value: 'MONTHLY',  label: 'Monthly'   },
]
const PAYOUT_OPTS = [
  { value: 'DAILY',    label: 'Daily — a member is paid every day'       },
  { value: 'WEEKLY',   label: 'Weekly — a member is paid every week'     },
  { value: 'BIWEEKLY', label: 'Bi-weekly — a member is paid every 2 weeks' },
  { value: 'MONTHLY',  label: 'Monthly — a member is paid every month'   },
]
const VIS_OPTS = [
  { value: 'PUBLIC',      label: 'Public — anyone can find & join' },
  { value: 'PRIVATE',     label: 'Private — invite link only'      },
  { value: 'INVITE_ONLY', label: 'Invite only — admin approves'    },
]
const SORT_OPTS = [
  { value: 'newest',  label: 'Recent'         },
  { value: 'oldest',  label: 'Oldest first'   },
  { value: 'members', label: 'Most members'   },
  { value: 'amount',  label: 'Highest amount' },
]
const STATUS_FILTER_OPTS = [
  { value: 'all',       label: 'All'       },
  { value: 'ACTIVE',    label: 'Active'    },
  { value: 'PAUSED',    label: 'Paused'    },
  { value: 'COMPLETED', label: 'Completed' },
]

const PAGE_SIZE = 12

function GroupStatusBadge({ status }: { status: string }) {
  const tone: any = { ACTIVE: 'success', PAUSED: 'warn', DRAFT: 'neutral', COMPLETED: 'info', CANCELLED: 'danger' }[status] || 'neutral'
  return <Pill tone={tone}>{status.charAt(0) + status.slice(1).toLowerCase()}</Pill>
}

function GroupCard({
  g, isMember, isAdmin, onLeave, onJoin, joinLoading,
}: {
  g: Group; isMember: boolean; isAdmin: boolean
  onLeave: (g: Group) => void; onJoin: (g: Group) => void; joinLoading: boolean
}) {
  const pct = g.memberCount > 0 ? Math.round((g.memberCount / g.maxMembers) * 100) : 0
  const cyclePct = g.totalCycles > 0 ? Math.round((g.currentCycle / g.totalCycles) * 100) : 0
  const freqLabel: Record<string, string> = { DAILY: 'Daily', WEEKLY: 'Weekly', BIWEEKLY: 'Bi-weekly', MONTHLY: 'Monthly' }
  const visLabel: Record<string, string>  = { PUBLIC: 'Public', PRIVATE: 'Private', INVITE_ONLY: 'Members only' }
  const isFull = g.memberCount >= g.maxMembers

  return (
    <div className={`${CARD} p-5 flex flex-col gap-4 hover:border-brand/40 transition-colors`}>
      <Link to={`/groups/${g.slug}`} className="flex flex-col gap-4">
        {/* Name + status */}
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-[15px] font-semibold text-ink leading-tight truncate">{g.name}</p>
            <p className="text-[11.5px] text-mist mt-1">
              {freqLabel[g.frequency] || g.frequency} · {visLabel[g.visibility] || g.visibility}
            </p>
          </div>
          <GroupStatusBadge status={g.status}/>
        </div>

        {/* Amount */}
        <div className="flex items-baseline gap-2">
          <p className="text-[26px] font-semibold text-ink tracking-tight tabular-nums leading-none">₦{g.contributionAmount.toLocaleString()}</p>
          <p className="text-[12px] text-mist">per {(freqLabel[g.frequency] || g.frequency).toLowerCase()}</p>
        </div>

        {/* Progress */}
        <div className="space-y-3">
          <div>
            <div className="flex justify-between text-[11px] mb-1.5">
              <span className={LABEL}>Members</span>
              <span className="text-dim tabular-nums">{g.memberCount} / {g.maxMembers}</span>
            </div>
            <div className="h-1 rounded-full bg-sand overflow-hidden">
              <div className="h-full rounded-full bg-brand transition-all duration-700" style={{ width: `${pct}%` }}/>
            </div>
          </div>
          <div>
            <div className="flex justify-between text-[11px] mb-1.5">
              <span className={LABEL}>Cycle</span>
              <span className="text-dim tabular-nums">{g.currentCycle} of {g.totalCycles}</span>
            </div>
            <div className="h-1 rounded-full bg-sand overflow-hidden">
              <div className="h-full rounded-full transition-all duration-700" style={{ width: `${cyclePct}%`, background: 'linear-gradient(90deg, #1B5C3C, #A8E03A)' }}/>
            </div>
          </div>
        </div>
      </Link>

      {/* Action buttons */}
      {!isMember && !isFull && g.status === 'ACTIVE' && (
        <button onClick={() => onJoin(g)} disabled={joinLoading} className={`${BTN_PRIMARY} w-full`}>
          {joinLoading ? 'Joining…' : g.visibility === 'PRIVATE' ? 'Enter code' : g.visibility === 'INVITE_ONLY' ? 'Request to join' : 'Join group'}
        </button>
      )}
      {!isMember && isFull && (
        <div className="w-full h-9 rounded-lg bg-sand flex items-center justify-center text-[12px] text-mist font-medium">
          Group full
        </div>
      )}
      {isMember && !isAdmin && (
        <button onClick={() => onLeave(g)}
          className="w-full h-9 rounded-lg border border-black/[0.1] text-[12px] font-medium text-dim hover:bg-red-50 hover:border-red-200 hover:text-red-600 transition-colors">
          Leave group
        </button>
      )}
    </div>
  )
}

export default function GroupsPage() {
  const { user }      = useAuthStore()
  const { showToast } = useUIStore()

  const [tab, setTab]                   = useState<'mine' | 'public'>('mine')
  const [search, setSearch]             = useState('')
  const [sortBy, setSortBy]             = useState('newest')
  const [statusFilter, setStatusFilter] = useState('all')
  const [page, setPage]                 = useState(1)
  const [createOpen, setCreateOpen]     = useState(false)
  const [joinOpen, setJoinOpen]         = useState(false)
  const [joinCode, setJoinCode]         = useState('')
  const [showFilters, setShowFilters]   = useState(false)

  const [joinTarget, setJoinTarget]           = useState<Group | null>(null)
  const [cardJoinCode, setCardJoinCode]       = useState('')
  const [cardJoinError, setCardJoinError]     = useState('')
  const [cardJoinLoading, setCardJoinLoading] = useState<string | null>(null)

  const [leaveGroup, setLeaveGroup]         = useState<Group | null>(null)
  const [leaveLoading, setLeaveLoading]     = useState(false)
  const [pendingWarning, setPendingWarning] = useState(false)

  // ── Agreement gate ──
  const [agreementGroup, setAgreementGroup]     = useState<Group | null>(null)
  const [agreementChecked, setAgreementChecked] = useState(false)
  const [agreementLoading, setAgreementLoading] = useState(false)

  const { data, isLoading, refetch } = useGroups({ visibility: tab, search: search || undefined })
  const createGroup = useCreateGroup()
  const joinGroup   = useJoinGroup()

  const rawGroups: Group[] = (data as any)?.groups || []

  const filteredGroups = rawGroups.filter(g => {
    if (statusFilter !== 'all' && g.status !== statusFilter) return false
    return true
  })

  const sortedGroups = [...filteredGroups].sort((a, b) => {
    if (sortBy === 'newest')  return dayjs(b.createdAt).unix() - dayjs(a.createdAt).unix()
    if (sortBy === 'oldest')  return dayjs(a.createdAt).unix() - dayjs(b.createdAt).unix()
    if (sortBy === 'members') return b.memberCount - a.memberCount
    if (sortBy === 'amount')  return b.contributionAmount - a.contributionAmount
    return 0
  })

  const totalPages = Math.ceil(sortedGroups.length / PAGE_SIZE)
  const groups     = sortedGroups.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE)

  const { register, handleSubmit, formState: { errors }, reset } = useForm<CreateData>({
    resolver: zodResolver(createSchema),
    defaultValues: { frequency: 'MONTHLY', payoutFrequency: 'MONTHLY', visibility: 'PRIVATE', penaltyAmount: 0, rotations: 1 },
  })

  const onCreateSubmit = async (data: CreateData) => {
    await createGroup.mutateAsync(data)
    setCreateOpen(false); reset()
  }

  const onJoin = async () => {
    if (!joinCode.trim()) return
    try {
      const res = await groupsApi.findByInviteCode(joinCode.trim())
      const group = res.data?.data || res.data
      // Gate the code-join behind the agreement too
      setJoinOpen(false)
      setJoinCode('')
      setAgreementChecked(false)
      setAgreementGroup({ ...group, _pendingCode: joinCode.trim() } as any)
    } catch (err: any) { showToast(err?.response?.data?.message || 'Invalid invite code', 'error') }
  }

  // Card "Join" click → always open the agreement first
  const handleCardJoin = (g: Group) => {
    setAgreementChecked(false)
    setAgreementGroup(g)
  }

  // After the agreement is accepted, run the correct join path
  const handleAcceptAgreement = async () => {
    const g = agreementGroup as any
    if (!g || !agreementChecked) return
    setAgreementLoading(true)
    try {
      const deviceInfo = `${navigator.userAgent} · ${window.screen.width}x${window.screen.height}`
      await groupsApi.acceptAgreement(g.id, deviceInfo)

      // Now perform the join the user originally intended
      if (g._pendingCode) {
        // came from "Join with code" flow
        await joinGroup.mutateAsync({ id: g.id, inviteCode: g._pendingCode })
        showToast('You joined the group', 'success')
        setAgreementGroup(null); refetch()
      } else if (g.visibility === 'PRIVATE') {
        // needs an invite code — open the code modal next
        setAgreementGroup(null)
        setJoinTarget(g); setCardJoinCode(''); setCardJoinError('')
      } else {
        setCardJoinLoading(g.id)
        await joinGroup.mutateAsync({ id: g.id })
        showToast(g.visibility === 'INVITE_ONLY' ? 'Request sent — waiting for admin approval' : 'You joined the group', 'success')
        setAgreementGroup(null); refetch()
      }
    } catch (err: any) {
      showToast(err?.response?.data?.message || 'Failed to join', 'error')
      setAgreementGroup(null)
    } finally {
      setAgreementLoading(false)
      setCardJoinLoading(null)
    }
  }

  const handleCardJoinWithCode = async () => {
    if (!joinTarget) return
    if (!cardJoinCode.trim()) { setCardJoinError('Please enter an invite code'); return }
    setCardJoinLoading(joinTarget.id)
    try {
      await joinGroup.mutateAsync({ id: joinTarget.id, inviteCode: cardJoinCode.trim() })
      showToast('You joined the group', 'success'); setJoinTarget(null); refetch()
    } catch (err: any) { setCardJoinError(err?.response?.data?.message || 'Invalid invite code') }
    finally { setCardJoinLoading(null) }
  }

  const handleLeaveConfirm = async () => {
    if (!leaveGroup) return
    const myMembership = (leaveGroup as any).myMembership
    if (myMembership?.role === 'ADMIN') { showToast('Admins cannot leave. Transfer ownership first.', 'error'); setLeaveGroup(null); return }
    setLeaveLoading(true)
    try {
      await groupsApi.removeMember(leaveGroup.id, user?.id || '')
      showToast('You left the group', 'success'); setLeaveGroup(null); refetch()
    } catch (err: any) {
      const msg = err?.response?.data?.message || ''
      if (msg.toLowerCase().includes('pending') || msg.toLowerCase().includes('contribution')) setPendingWarning(true)
      else showToast(msg || 'Failed to leave group', 'error')
    } finally { setLeaveLoading(false) }
  }

  const selectCls = 'h-10 pl-3 pr-8 bg-white border border-black/[0.1] rounded-lg text-[13px] text-dim font-medium outline-none cursor-pointer appearance-none focus:border-brand'

  return (
    <DashboardLayout title="My Groups" subtitle="Manage your savings circles">
      <div className="p-4 sm:p-6 max-w-6xl mx-auto space-y-5">

        {/* ── Header row ── */}
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div className="inline-flex items-center bg-sand/70 rounded-lg p-1">
            {(['mine', 'public'] as const).map(t => (
              <button key={t} onClick={() => { setTab(t); setPage(1); setStatusFilter('all') }}
                className={`px-4 h-8 rounded-md text-[13px] font-medium transition-all ${
                  tab === t ? 'bg-white text-ink shadow-sm' : 'text-mist hover:text-ink'
                }`}>
                {t === 'mine' ? 'My groups' : 'Discover'}
              </button>
            ))}
          </div>

          <div className="flex items-center gap-2">
            <button onClick={() => setJoinOpen(true)} className={BTN_SECONDARY}>Join with code</button>
            <button onClick={() => setCreateOpen(true)} className={BTN_PRIMARY}>
              <svg width="13" height="13" viewBox="0 0 14 14" fill="none"><path d="M7 2v10M2 7h10" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round"/></svg>
              New group
            </button>
          </div>
        </div>

        {/* ── Search + filter row ── */}
        <div className="flex items-center gap-3">
          <div className="flex-1 relative">
            <svg className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-mist" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"/>
            </svg>
            <input value={search} onChange={e => { setSearch(e.target.value); setPage(1) }}
              placeholder="Search groups…"
              className="w-full h-10 pl-10 pr-4 bg-white border border-black/[0.1] rounded-lg text-[13px] text-ink placeholder:text-mist outline-none focus:border-brand focus:ring-2 focus:ring-brand/10 transition-all"/>
          </div>

          <AnimatePresence>
            {showFilters && (
              <motion.div className="flex items-center gap-2" initial={{ opacity:0, x:8 }} animate={{ opacity:1, x:0 }} exit={{ opacity:0, x:8 }}>
                <select value={statusFilter} onChange={e => { setStatusFilter(e.target.value); setPage(1) }} className={selectCls}>
                  {STATUS_FILTER_OPTS.map(o => <option key={o.value} value={o.value}>Status: {o.label}</option>)}
                </select>
                <select value={sortBy} onChange={e => { setSortBy(e.target.value); setPage(1) }} className={selectCls}>
                  {SORT_OPTS.map(o => <option key={o.value} value={o.value}>Sort: {o.label}</option>)}
                </select>
              </motion.div>
            )}
          </AnimatePresence>

          <button onClick={() => setShowFilters(v => !v)}
            className={`h-10 px-4 rounded-lg border text-[13px] font-medium flex items-center gap-2 transition-all ${
              showFilters ? 'bg-void text-white border-transparent' : 'bg-white border-black/[0.1] text-dim hover:bg-warm'
            }`}>
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M3 4h18M7 8h10M10 12h4"/>
            </svg>
            Filters
          </button>
        </div>

        {/* ── Count ── */}
        {!isLoading && sortedGroups.length > 0 && (
          <p className="text-[12px] text-mist">
            Showing {groups.length} of {sortedGroups.length} group{sortedGroups.length !== 1 ? 's' : ''}
          </p>
        )}

        {/* ── Grid ── */}
        {isLoading ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {[...Array(3)].map((_, i) => <Skeleton key={i} className="h-60 rounded-xl"/>)}
          </div>
        ) : groups.length === 0 ? (
          <div className={`${CARD} border-dashed py-16 px-6 text-center`}>
            <div className="w-10 h-10 mx-auto rounded-lg bg-warm text-brand flex items-center justify-center mb-4">
              <svg width="18" height="18" viewBox="0 0 16 16" fill="none"><circle cx="5.5" cy="5" r="2.2" stroke="currentColor" strokeWidth="1.3"/><circle cx="10.5" cy="5" r="2.2" stroke="currentColor" strokeWidth="1.3"/><path d="M1 13c0-2.21 2.015-4 4.5-4s4.5 1.79 4.5 4" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/><path d="M10.5 9c2.485 0 4.5 1.79 4.5 4" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/></svg>
            </div>
            <p className="text-[14px] font-semibold text-ink mb-1.5">
              {tab === 'mine' ? "You haven't joined any groups yet" : 'No groups found'}
            </p>
            <p className="text-[12.5px] text-mist mb-6 max-w-sm mx-auto">
              {tab === 'mine' ? 'Create your own Ajo circle, or join one with an invite code.' : 'Try adjusting your search or filters.'}
            </p>
            {tab === 'mine' && (
              <button onClick={() => setCreateOpen(true)} className={`${BTN_PRIMARY} !px-6`}>Create your first group</button>
            )}
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {groups.map((g, i) => {
              const myMembership = (g as any).myMembership
              const isMember = myMembership?.status === 'ACTIVE'
              const isAdmin  = myMembership?.role === 'ADMIN' || myMembership?.role === 'MODERATOR'
              return (
                <motion.div key={g.id}
                  initial={{ opacity:0, y:12 }} animate={{ opacity:1, y:0 }}
                  transition={{ delay: i*0.04, duration:0.35, ease:[0.16,1,0.3,1] }}>
                  <GroupCard g={g} isMember={isMember} isAdmin={isAdmin}
                    onLeave={g => { setLeaveGroup(g); setPendingWarning(false) }}
                    onJoin={handleCardJoin} joinLoading={cardJoinLoading === g.id}/>
                </motion.div>
              )
            })}
          </div>
        )}

        {/* ── Pagination ── */}
        {totalPages > 1 && (
          <div className="flex items-center justify-center gap-2 pt-2">
            <button disabled={page === 1} onClick={() => setPage(p => p - 1)}
              className="h-9 w-9 rounded-lg border border-black/[0.1] bg-white text-[13px] text-dim hover:bg-warm transition-all disabled:opacity-40 flex items-center justify-center">←</button>
            {Array.from({ length: totalPages }, (_, i) => i + 1).map(p => (
              <button key={p} onClick={() => setPage(p)}
                className={`h-9 w-9 rounded-lg text-[12px] font-medium transition-all ${page === p ? 'bg-void text-white' : 'border border-black/[0.1] bg-white text-dim hover:bg-warm'}`}>
                {p}
              </button>
            ))}
            <button disabled={page === totalPages} onClick={() => setPage(p => p + 1)}
              className="h-9 w-9 rounded-lg border border-black/[0.1] bg-white text-[13px] text-dim hover:bg-warm transition-all disabled:opacity-40 flex items-center justify-center">→</button>
          </div>
        )}
      </div>

      {/* ════ CREATE GROUP ════ */}
      <Modal open={createOpen} onClose={() => setCreateOpen(false)} title="Create a new group" size="lg"
        footer={
          <div className="flex gap-2 justify-end">
            <button onClick={() => setCreateOpen(false)} className={BTN_SECONDARY}>Cancel</button>
            <button onClick={handleSubmit(onCreateSubmit)} disabled={createGroup.isPending} className={BTN_PRIMARY}>
              {createGroup.isPending ? 'Creating…' : 'Create group'}
            </button>
          </div>
        }>
        <form className="space-y-4">
          <Input label="Group name" placeholder="e.g. Lagos Tech Circle" error={errors.name?.message} {...register('name')}/>
          <div>
            <label className="block text-[12px] font-semibold text-dim mb-1.5">Description (optional)</label>
            <textarea {...register('description')} placeholder="What is this group about?" rows={2} className={`${FIELD} resize-none`}/>
          </div>
          <Input label="Contribution amount (₦)" type="number" placeholder="50000" error={errors.contributionAmount?.message} {...register('contributionAmount')}/>

          <Select label="How often do members contribute?" options={FREQ_OPTS} error={errors.frequency?.message} {...register('frequency')}/>
          <Select label="How often is the payout made?" options={PAYOUT_OPTS} error={errors.payoutFrequency?.message} {...register('payoutFrequency')}/>

          <div className="grid grid-cols-2 gap-4">
            <Input label="Max members" type="number" placeholder="12" error={errors.maxMembers?.message} {...register('maxMembers')}/>
            <Input label="Start date" type="date" error={errors.startDate?.message} {...register('startDate')} min={dayjs().add(1,'day').format('YYYY-MM-DD')}/>
          </div>
          <Select label="Visibility" options={VIS_OPTS} error={errors.visibility?.message} {...register('visibility')}/>
          <div className="grid grid-cols-2 gap-4">
            <Input label="Number of rotations" type="number" placeholder="1" error={errors.rotations?.message} {...register('rotations')}/>
            <Input label="Late fee (₦)" type="number" placeholder="0" error={errors.penaltyAmount?.message} {...register('penaltyAmount')}/>
          </div>
          <p className="text-[11px] text-mist -mt-2">
            How many times the group loops through every member's payout turn. Leave at 1 for a classic single-round Ajo — e.g. 5 members × 3 rotations means each person is paid 3 times before the group completes.
          </p>
        </form>
      </Modal>

      {/* ════ JOIN WITH CODE ════ */}
      <Modal open={joinOpen} onClose={() => setJoinOpen(false)} title="Join with invite code" size="sm"
        footer={
          <div className="flex gap-2 justify-end">
            <button onClick={() => setJoinOpen(false)} className={BTN_SECONDARY}>Cancel</button>
            <button onClick={onJoin} disabled={joinGroup.isPending || !joinCode.trim()} className={BTN_PRIMARY}>
              {joinGroup.isPending ? 'Checking…' : 'Continue'}
            </button>
          </div>
        }>
        <p className="text-[13px] text-dim mb-4">Got an invite code? Paste it below to join a savings group.</p>
        <Input label="Invite code" placeholder="e.g. clxyz123abc" value={joinCode} onChange={e => setJoinCode(e.target.value)}/>
      </Modal>

      {/* ════ JOIN PRIVATE GROUP ════ */}
      <Modal open={!!joinTarget} onClose={() => { setJoinTarget(null); setCardJoinCode(''); setCardJoinError('') }}
        title="Enter invite code" size="sm"
        footer={
          <div className="flex gap-2 justify-end">
            <button onClick={() => setJoinTarget(null)} className={BTN_SECONDARY}>Cancel</button>
            <button onClick={handleCardJoinWithCode} disabled={!!cardJoinLoading || !cardJoinCode.trim()} className={BTN_PRIMARY}>
              {cardJoinLoading ? 'Joining…' : 'Join'}
            </button>
          </div>
        }>
        <p className="text-[13px] text-dim mb-4"><strong className="text-ink">{joinTarget?.name}</strong> is private. Ask the group admin for the invite code.</p>
        <Input label="Invite code" placeholder="Enter code here" value={cardJoinCode} onChange={e => { setCardJoinCode(e.target.value); setCardJoinError('') }}/>
        {cardJoinError && <p className="text-[12px] text-red-500 mt-2">{cardJoinError}</p>}
      </Modal>

      {/* ════ GROUP AGREEMENT — must accept before joining ════ */}
      <Modal open={!!agreementGroup} onClose={() => setAgreementGroup(null)} title="Before you join" size="md"
        footer={
          <div className="flex gap-2 justify-end">
            <button onClick={() => setAgreementGroup(null)} className={BTN_SECONDARY}>Cancel</button>
            <button onClick={handleAcceptAgreement} disabled={!agreementChecked || agreementLoading} className={BTN_PRIMARY}>
              {agreementLoading ? 'Please wait…' : 'Accept & join'}
            </button>
          </div>
        }>
        <div className="space-y-4">
          <div className="bg-amber-50 border border-amber-100 rounded-lg p-4">
            <p className="text-[13px] font-semibold text-amber-800 mb-1">Important notice</p>
            <p className="text-[12px] text-amber-700">By joining this contribution group, you agree to make every scheduled contribution on time.</p>
          </div>

          <div className="space-y-2.5 text-[12.5px] text-dim leading-relaxed">
            <p className="font-semibold text-ink">Please understand the following rules:</p>
            <div className="flex gap-2"><span className="text-mist">•</span><p>Missing your scheduled contribution will <strong>immediately pause the entire group</strong>, and every member is notified.</p></div>
            <div className="flex gap-2"><span className="text-mist">•</span><p>You'll have <strong>48 hours</strong> to complete the missed payment.</p></div>
            <div className="flex gap-2"><span className="text-mist">•</span><p>If paid within 48 hours, the group resumes automatically and continues normally.</p></div>
            <div className="flex gap-2"><span className="text-mist">•</span><p>If <strong>not</strong> completed within 48 hours:</p></div>
            <div className="pl-6 space-y-1.5">
              <div className="flex gap-2"><span className="text-red-400">–</span><p>You'll be automatically removed from the group.</p></div>
              <div className="flex gap-2"><span className="text-red-400">–</span><p>A debt equal to the missed contribution, plus a late fee, is added to your account.</p></div>
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
            <input type="checkbox" checked={agreementChecked} onChange={e => setAgreementChecked(e.target.checked)}
              className="mt-0.5 w-4 h-4 rounded border-stone cursor-pointer accent-brand"/>
            <span className="text-[13px] font-semibold text-ink">I have read and understood these rules.</span>
          </label>
        </div>
      </Modal>

      {/* ════ LEAVE GROUP ════ */}
      <Modal open={!!leaveGroup} onClose={() => { setLeaveGroup(null); setPendingWarning(false) }}
        title="Leave group" size="sm"
        footer={
          <div className="flex gap-2 justify-end">
            <button onClick={() => { setLeaveGroup(null); setPendingWarning(false) }} className={BTN_SECONDARY}>Cancel</button>
            <button onClick={handleLeaveConfirm} disabled={leaveLoading}
              className="h-9 px-4 rounded-lg bg-red-600 text-white text-[13px] font-medium hover:bg-red-700 disabled:opacity-50 transition-colors">
              {leaveLoading ? 'Leaving…' : pendingWarning ? 'Leave anyway' : 'Yes, leave group'}
            </button>
          </div>
        }>
        {pendingWarning ? (
          <div className="space-y-3">
            <div className="bg-red-50 border border-red-100 rounded-lg p-4">
              <p className="text-[13px] font-semibold text-red-600 mb-1">You have pending contributions</p>
              <p className="text-[12px] text-red-500">Leaving now may affect your reputation score and you may lose your payout position.</p>
            </div>
          </div>
        ) : (
          <div className="space-y-3">
            <p className="text-[13px] text-dim">Are you sure you want to leave <strong className="text-ink">{leaveGroup?.name}</strong>?</p>
            <div className="bg-warm rounded-lg p-4 border border-black/[0.06] space-y-1.5">
              {['You will lose your payout position','You will need an invite to rejoin','Your contribution history will be preserved'].map(t => (
                <p key={t} className="text-[12px] text-dim">• {t}</p>
              ))}
            </div>
          </div>
        )}
      </Modal>
    </DashboardLayout>
  )
}