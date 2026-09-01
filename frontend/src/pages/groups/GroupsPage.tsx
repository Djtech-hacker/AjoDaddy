import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { motion, AnimatePresence } from 'framer-motion'
import DashboardLayout from '@/components/layout/DashboardLayout'
import { Button, Input, Select, Modal, Skeleton } from '@/components/ui'
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

const DARK_GREEN = '#166534'
const DARK_GREEN_BG = '#14532d'

function GroupStatusBadge({ status }: { status: string }) {
  const cfg: any = {
    ACTIVE:    { label: 'active',    cls: 'bg-emerald-50 text-emerald-700' },
    PAUSED:    { label: 'paused',    cls: 'bg-amber-50 text-amber-700' },
    DRAFT:     { label: 'draft',     cls: 'bg-gray-100 text-gray-500' },
    COMPLETED: { label: 'completed', cls: 'bg-blue-50 text-blue-700' },
    CANCELLED: { label: 'cancelled', cls: 'bg-red-50 text-red-600' },
  }
  const c = cfg[status] || { label: status.toLowerCase(), cls: 'bg-gray-100 text-gray-500' }
  return (
    <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-[11px] font-semibold ${c.cls}`}>
      {c.label}
    </span>
  )
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
    <motion.div
      className="bg-white rounded-2xl border border-gray-200 p-5 hover:shadow-md hover:-translate-y-0.5 transition-all duration-200 flex flex-col gap-3"
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
    >
      <Link to={`/groups/${g.slug}`} className="flex flex-col gap-3">
        {/* Name + status */}
        <div className="flex items-start justify-between">
          <div className="min-w-0">
            <p className="text-[18px] font-bold text-gray-900 leading-tight">{g.name}</p>
            <p className="text-[12px] text-gray-400 mt-0.5">
              {g.memberCount} / {g.maxMembers} members · {freqLabel[g.frequency] || g.frequency}
            </p>
          </div>
          <GroupStatusBadge status={g.status}/>
        </div>

        {/* Visibility pill */}
        <div>
          <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-semibold border ${
            g.visibility === 'PUBLIC'
              ? 'bg-gray-50 text-gray-600 border-gray-200'
              : g.visibility === 'PRIVATE'
              ? 'bg-amber-50 text-amber-700 border-amber-200'
              : 'bg-purple-50 text-purple-700 border-purple-200'
          }`}>
            {g.visibility === 'PUBLIC'      && <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3.055 11H5a2 2 0 012 2v1a2 2 0 002 2 2 2 0 012 2v2.945M8 3.935V5.5A2.5 2.5 0 0010.5 8h.5a2 2 0 012 2 2 2 0 104 0 2 2 0 012-2h1.064M15 20.488V18a2 2 0 012-2h3.064"/></svg>}
            {g.visibility === 'PRIVATE'     && <span>🔒</span>}
            {g.visibility === 'INVITE_ONLY' && <span>👥</span>}
            {visLabel[g.visibility] || g.visibility}
          </span>
        </div>

        {/* Amount */}
        <div className="flex items-baseline justify-between">
          <p className="text-[22px] font-bold text-gray-900 tracking-tight">
            ₦{g.contributionAmount.toLocaleString()}
          </p>
          <p className="text-[12px] text-gray-400">per {(freqLabel[g.frequency] || g.frequency).toLowerCase()}</p>
        </div>

        {/* Member fill bar */}
        <div className="h-2 rounded-full overflow-hidden" style={{ background: '#e5e7eb' }}>
          <div className="h-full rounded-full transition-all duration-700"
            style={{ width: `${pct}%`, background: DARK_GREEN }}/>
        </div>

        {/* Cycle progress bar */}
        <div className="h-1.5 rounded-full overflow-hidden" style={{ background: '#e5e7eb' }}>
          <div className="h-full rounded-full transition-all duration-700"
            style={{ width: `${cyclePct}%`, background: DARK_GREEN }}/>
        </div>

        {/* Cycle label */}
        <p className="text-[11px] font-medium" style={{ color: DARK_GREEN }}>
          Cycle {g.currentCycle} of {g.totalCycles}
        </p>
      </Link>

      {/* Action buttons */}
      {!isMember && !isFull && g.status === 'ACTIVE' && (
        <button onClick={() => onJoin(g)} disabled={joinLoading}
          className="w-full h-9 rounded-xl text-[12px] font-bold text-white transition-colors disabled:opacity-50"
          style={{ background: DARK_GREEN }}>
          {joinLoading ? 'Joining…' : g.visibility === 'PRIVATE' ? 'Enter code →' : g.visibility === 'INVITE_ONLY' ? 'Request →' : 'Join →'}
        </button>
      )}
      {!isMember && isFull && (
        <div className="w-full h-9 rounded-xl bg-gray-100 flex items-center justify-center text-[12px] text-gray-400 font-semibold">
          Group full
        </div>
      )}
      {isMember && !isAdmin && (
        <button onClick={() => onLeave(g)}
          className="w-full h-9 rounded-xl border border-gray-200 text-[12px] font-semibold text-gray-500 hover:bg-red-50 hover:border-red-200 hover:text-red-600 transition-colors">
          Leave group
        </button>
      )}
    </motion.div>
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
        showToast('You joined! 🎉', 'success')
        setAgreementGroup(null); refetch()
      } else if (g.visibility === 'PRIVATE') {
        // needs an invite code — open the code modal next
        setAgreementGroup(null)
        setJoinTarget(g); setCardJoinCode(''); setCardJoinError('')
      } else {
        setCardJoinLoading(g.id)
        await joinGroup.mutateAsync({ id: g.id })
        showToast(g.visibility === 'INVITE_ONLY' ? 'Request sent — waiting for admin approval' : 'You joined! 🎉', 'success')
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
      showToast('You joined! 🎉', 'success'); setJoinTarget(null); refetch()
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

  return (
    <DashboardLayout title="My Groups" subtitle="Manage your savings circles">
      <div className="p-6 max-w-7xl space-y-5">

        {/* ── Header row ── */}
        <div className="flex items-center justify-between gap-3 flex-wrap">
          {/* Tabs */}
          <div className="flex items-center gap-1 bg-white border border-gray-200 rounded-xl p-1">
            {(['mine', 'public'] as const).map(t => (
              <button key={t} onClick={() => { setTab(t); setPage(1); setStatusFilter('all') }}
                className={`px-5 py-2 rounded-lg text-[13px] font-semibold transition-all ${
                  tab === t
                    ? 'text-white'
                    : 'text-gray-500 hover:text-gray-800 bg-transparent'
                }`}
                style={tab === t ? { background: DARK_GREEN_BG } : {}}>
                {t === 'mine' ? 'My Groups' : 'Discover'}
              </button>
            ))}
          </div>

          {/* Action buttons */}
          <div className="flex items-center gap-2">
            <button onClick={() => setJoinOpen(true)}
              className="h-10 px-4 rounded-xl border border-gray-200 bg-white text-[13px] font-semibold text-gray-700 hover:bg-gray-50 transition-colors">
              Join with code
            </button>
            <button onClick={() => setCreateOpen(true)}
              className="h-10 px-4 rounded-xl text-white text-[13px] font-semibold transition-colors flex items-center gap-1.5"
              style={{ background: DARK_GREEN_BG }}>
              + New
            </button>
          </div>
        </div>

        {/* ── Search + filter row ── */}
        <div className="flex items-center gap-3">
          <div className="flex-1 relative">
            <svg className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"/>
            </svg>
            <input value={search} onChange={e => { setSearch(e.target.value); setPage(1) }}
              placeholder="Search groups…"
              className="w-full h-11 pl-10 pr-4 bg-white border border-gray-200 rounded-xl text-[13px] text-gray-900 placeholder-gray-400 outline-none focus:border-gray-400 transition-all"/>
          </div>

          <AnimatePresence>
            {showFilters && (
              <motion.div className="flex items-center gap-2" initial={{ opacity:0, x:8 }} animate={{ opacity:1, x:0 }} exit={{ opacity:0, x:8 }}>
                <select value={statusFilter} onChange={e => { setStatusFilter(e.target.value); setPage(1) }}
                  className="h-11 pl-3 pr-8 bg-white border border-gray-200 rounded-xl text-[13px] text-gray-700 font-medium outline-none cursor-pointer appearance-none">
                  {STATUS_FILTER_OPTS.map(o => <option key={o.value} value={o.value}>Status: {o.label}</option>)}
                </select>
                <select value={sortBy} onChange={e => { setSortBy(e.target.value); setPage(1) }}
                  className="h-11 pl-3 pr-8 bg-white border border-gray-200 rounded-xl text-[13px] text-gray-700 font-medium outline-none cursor-pointer appearance-none">
                  {SORT_OPTS.map(o => <option key={o.value} value={o.value}>Sort: {o.label}</option>)}
                </select>
              </motion.div>
            )}
          </AnimatePresence>

          <button onClick={() => setShowFilters(v => !v)}
            className={`h-11 px-4 rounded-xl border text-[13px] font-semibold flex items-center gap-2 transition-all ${
              showFilters ? 'text-white border-transparent' : 'bg-white border-gray-200 text-gray-700 hover:border-gray-300'
            }`}
            style={showFilters ? { background: DARK_GREEN_BG } : {}}>
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M3 4h18M7 8h10M10 12h4"/>
            </svg>
            Filters
          </button>
        </div>

        {/* ── Count ── */}
        {!isLoading && sortedGroups.length > 0 && (
          <p className="text-[12px] text-gray-400">
            Showing {groups.length} of {sortedGroups.length} group{sortedGroups.length !== 1 ? 's' : ''}
          </p>
        )}

        {/* ── Grid ── */}
        {isLoading ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
            {[...Array(4)].map((_, i) => <Skeleton key={i} className="h-56 rounded-2xl"/>)}
          </div>
        ) : groups.length === 0 ? (
          <div className="bg-white rounded-2xl border border-gray-200 p-16 text-center">
            <p className="text-3xl mb-4">🏦</p>
            <p className="text-[15px] font-bold text-gray-900 mb-2">
              {tab === 'mine' ? "You haven't joined any groups yet" : "No groups found"}
            </p>
            <p className="text-[13px] text-gray-400 mb-6">
              {tab === 'mine' ? "Create your own Ajo circle or join one with an invite code." : "Try adjusting your search or filters."}
            </p>
            {tab === 'mine' && (
              <button onClick={() => setCreateOpen(true)}
                className="h-10 px-6 rounded-xl text-white text-[13px] font-semibold transition-colors"
                style={{ background: DARK_GREEN_BG }}>
                Create your first group
              </button>
            )}
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
            {groups.map((g, i) => {
              const myMembership = (g as any).myMembership
              const isMember = myMembership?.status === 'ACTIVE'
              const isAdmin  = myMembership?.role === 'ADMIN' || myMembership?.role === 'MODERATOR'
              return (
                <motion.div key={g.id}
                  initial={{ opacity:0, y:14 }} animate={{ opacity:1, y:0 }}
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
              className="h-9 w-9 rounded-xl border border-gray-200 bg-white text-[13px] text-gray-500 hover:text-gray-900 transition-all disabled:opacity-40 flex items-center justify-center">
              ←
            </button>
            {Array.from({ length: totalPages }, (_, i) => i + 1).map(p => (
              <button key={p} onClick={() => setPage(p)}
                className="h-9 w-9 rounded-xl text-[12px] font-semibold transition-all"
                style={page === p ? { background: DARK_GREEN_BG, color: '#fff' } : { border:'1px solid #E5E7EB', background:'#fff', color:'#6B7280' }}>
                {p}
              </button>
            ))}
            <button disabled={page === totalPages} onClick={() => setPage(p => p + 1)}
              className="h-9 w-9 rounded-xl border border-gray-200 bg-white text-[13px] text-gray-500 hover:text-gray-900 transition-all disabled:opacity-40 flex items-center justify-center">
              →
            </button>
          </div>
        )}
      </div>

      {/* ════ CREATE GROUP ════ */}
      <Modal open={createOpen} onClose={() => setCreateOpen(false)} title="Create a new group" size="lg"
        footer={
          <div className="flex gap-2 justify-end">
            <button onClick={() => setCreateOpen(false)} className="h-9 px-4 rounded-lg border border-gray-200 text-[12px] font-semibold text-gray-600 hover:bg-gray-50 transition-colors">Cancel</button>
            <button onClick={handleSubmit(onCreateSubmit)} disabled={createGroup.isPending}
              className="h-9 px-5 rounded-lg text-white text-[12px] font-semibold disabled:opacity-50 transition-colors"
              style={{ background: DARK_GREEN_BG }}>
              {createGroup.isPending ? 'Creating…' : 'Create group'}
            </button>
          </div>
        }>
        <form className="space-y-4">
          <Input label="Group name" placeholder="e.g. Lagos Tech Circle" error={errors.name?.message} {...register('name')}/>
          <div>
            <label className="block text-[12px] font-semibold text-gray-500 mb-1.5">Description (optional)</label>
            <textarea {...register('description')} placeholder="What is this group about?" rows={2}
              className="w-full border border-gray-200 rounded-xl px-4 py-2.5 text-[13px] text-gray-900 outline-none focus:border-gray-400 resize-none transition-all"/>
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
          <p className="text-[11px] text-gray-400 -mt-2">
            How many times the group loops through every member's payout turn. Leave at 1 for a classic single-round Ajo — e.g. 5 members × 3 rotations means each person is paid 3 times before the group completes.
          </p>
        </form>
      </Modal>

      {/* ════ JOIN WITH CODE ════ */}
      <Modal open={joinOpen} onClose={() => setJoinOpen(false)} title="Join with invite code" size="sm"
        footer={
          <div className="flex gap-2 justify-end">
            <button onClick={() => setJoinOpen(false)} className="h-9 px-4 rounded-lg border border-gray-200 text-[12px] font-semibold text-gray-600 hover:bg-gray-50 transition-colors">Cancel</button>
            <button onClick={onJoin} disabled={joinGroup.isPending || !joinCode.trim()}
              className="h-9 px-5 rounded-lg text-white text-[12px] font-semibold disabled:opacity-50 transition-colors"
              style={{ background: DARK_GREEN_BG }}>
              {joinGroup.isPending ? 'Checking…' : 'Continue'}
            </button>
          </div>
        }>
        <p className="text-[13px] text-gray-500 mb-4">Got an invite code? Paste it below to join a savings group.</p>
        <Input label="Invite code" placeholder="e.g. clxyz123abc" value={joinCode} onChange={e => setJoinCode(e.target.value)}/>
      </Modal>

      {/* ════ JOIN PRIVATE GROUP ════ */}
      <Modal open={!!joinTarget} onClose={() => { setJoinTarget(null); setCardJoinCode(''); setCardJoinError('') }}
        title="Enter invite code" size="sm"
        footer={
          <div className="flex gap-2 justify-end">
            <button onClick={() => setJoinTarget(null)} className="h-9 px-4 rounded-lg border border-gray-200 text-[12px] font-semibold text-gray-600 hover:bg-gray-50 transition-colors">Cancel</button>
            <button onClick={handleCardJoinWithCode} disabled={!!cardJoinLoading || !cardJoinCode.trim()}
              className="h-9 px-5 rounded-lg text-white text-[12px] font-semibold disabled:opacity-50 transition-colors"
              style={{ background: DARK_GREEN_BG }}>
              {cardJoinLoading ? 'Joining…' : 'Join'}
            </button>
          </div>
        }>
        <p className="text-[13px] text-gray-500 mb-4"><strong className="text-gray-900">{joinTarget?.name}</strong> is private. Ask the group admin for the invite code.</p>
        <Input label="Invite code" placeholder="Enter code here" value={cardJoinCode} onChange={e => { setCardJoinCode(e.target.value); setCardJoinError('') }}/>
        {cardJoinError && <p className="text-[12px] text-red-500 mt-2">{cardJoinError}</p>}
      </Modal>

      {/* ════ GROUP AGREEMENT — must accept before joining ════ */}
      <Modal open={!!agreementGroup} onClose={() => setAgreementGroup(null)} title="Before you join" size="md"
        footer={
          <div className="flex gap-2 justify-end">
            <button onClick={() => setAgreementGroup(null)} className="h-9 px-4 rounded-lg border border-gray-200 text-[12px] font-semibold text-gray-600 hover:bg-gray-50 transition-colors">Cancel</button>
            <button onClick={handleAcceptAgreement} disabled={!agreementChecked || agreementLoading}
              className="h-9 px-5 rounded-lg text-white text-[12px] font-semibold disabled:opacity-50 transition-colors"
              style={{ background: DARK_GREEN_BG }}>
              {agreementLoading ? 'Please wait…' : 'Accept & Join'}
            </button>
          </div>
        }>
        <div className="space-y-4">
          <div className="bg-amber-50 border border-amber-100 rounded-xl p-4">
            <p className="text-[13px] font-bold text-amber-800 mb-1">Important notice</p>
            <p className="text-[12px] text-amber-700">By joining this contribution group, you agree to make every scheduled contribution on time.</p>
          </div>

          <div className="space-y-2.5 text-[12.5px] text-gray-600 leading-relaxed">
            <p className="font-semibold text-gray-900">Please understand the following rules:</p>
            <div className="flex gap-2"><span className="text-gray-400">•</span><p>Missing your scheduled contribution will <strong>immediately pause the entire group</strong>, and every member is notified.</p></div>
            <div className="flex gap-2"><span className="text-gray-400">•</span><p>You'll have <strong>48 hours</strong> to complete the missed payment.</p></div>
            <div className="flex gap-2"><span className="text-gray-400">•</span><p>If paid within 48 hours, the group resumes automatically and continues normally.</p></div>
            <div className="flex gap-2"><span className="text-gray-400">•</span><p>If <strong>not</strong> completed within 48 hours:</p></div>
            <div className="pl-6 space-y-1.5">
              <div className="flex gap-2"><span className="text-red-400">–</span><p>You'll be automatically removed from the group.</p></div>
              <div className="flex gap-2"><span className="text-red-400">–</span><p>A debt equal to the missed contribution, plus a late fee, is added to your account.</p></div>
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
            <input type="checkbox" checked={agreementChecked} onChange={e => setAgreementChecked(e.target.checked)}
              className="mt-0.5 w-4 h-4 rounded border-gray-300 cursor-pointer" style={{ accentColor: DARK_GREEN }}/>
            <span className="text-[13px] font-semibold text-gray-800">I have read and understood these rules.</span>
          </label>
        </div>
      </Modal>

      {/* ════ LEAVE GROUP ════ */}
      <Modal open={!!leaveGroup} onClose={() => { setLeaveGroup(null); setPendingWarning(false) }}
        title="Leave group" size="sm"
        footer={
          <div className="flex gap-2 justify-end">
            <button onClick={() => { setLeaveGroup(null); setPendingWarning(false) }} className="h-9 px-4 rounded-lg border border-gray-200 text-[12px] font-semibold text-gray-600 hover:bg-gray-50 transition-colors">Cancel</button>
            <button onClick={handleLeaveConfirm} disabled={leaveLoading}
              className="h-9 px-5 rounded-lg bg-red-500 text-white text-[12px] font-semibold hover:bg-red-600 disabled:opacity-50 transition-colors">
              {leaveLoading ? 'Leaving…' : pendingWarning ? 'Leave anyway' : 'Yes, leave group'}
            </button>
          </div>
        }>
        {pendingWarning ? (
          <div className="space-y-3">
            <div className="bg-red-50 border border-red-100 rounded-xl p-4">
              <p className="text-[13px] font-bold text-red-600 mb-1">⚠️ You have pending contributions</p>
              <p className="text-[12px] text-red-500">Leaving now may affect your reputation score and you may lose your payout position.</p>
            </div>
          </div>
        ) : (
          <div className="space-y-3">
            <p className="text-[13px] text-gray-600">Are you sure you want to leave <strong className="text-gray-900">{leaveGroup?.name}</strong>?</p>
            <div className="bg-gray-50 rounded-xl p-4 border border-gray-100 space-y-1.5">
              {['You will lose your payout position','You will need an invite to rejoin','Your contribution history will be preserved'].map(t => (
                <p key={t} className="text-[12px] text-gray-500">• {t}</p>
              ))}
            </div>
          </div>
        )}
      </Modal>
    </DashboardLayout>
  )
}