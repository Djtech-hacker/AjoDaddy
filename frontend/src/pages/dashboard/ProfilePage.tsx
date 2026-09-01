// ============================================================
// ProfilePage.tsx — PayPaddy Premium Profile + KYC Status
// ============================================================
// FIX: several fields were only read in snake_case (groups_joined,
// reputation_score, created_at, etc.) while your Prisma schema defines
// them camelCase (groupsJoined, reputationScore, createdAt). Prisma
// returns whatever casing is in the schema, so these were silently
// always undefined — Trust Score showed 0/1000 for everyone, the whole
// stats grid showed 0/—/₦0 for everyone, and Recent Activity dates
// rendered as "Invalid Date". Every read below now checks BOTH casings
// (camelCase first, snake_case as fallback) so it works correctly
// whichever your backend actually sends — I don't have users.module.ts
// to confirm the exact response shape, so this is the safe fix rather
// than guessing and possibly breaking it the other way.
import { useState, useEffect } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { useForm } from 'react-hook-form'
import { motion, AnimatePresence } from 'framer-motion'
import { useAuthStore } from '@/stores/authStore'
import DashboardLayout from '@/components/layout/DashboardLayout'
import { kycApi } from '@/api/services'

async function apiFetch(path: string, options: RequestInit = {}) {
  const token = useAuthStore.getState().accessToken
  const res = await fetch(`/api${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...options.headers,
    },
  })
  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    throw new Error(err.message || `API error ${res.status}`)
  }
  return res.json()
}

interface UserStreak { userId: string; currentStreak: number; longestStreak: number; lastContributionDate: string }
interface Achievement { id: string; userId?: string; user_id?: string; type: string; earnedAt?: string; earned_at?: string }
interface LeaderboardRank { userId?: string; user_id?: string; globalRank?: number; global_rank?: number; groupRank?: number; group_rank?: number; weeklyMovement?: number; weekly_movement?: number; category: string }
interface ActivityFeedItem { id: string; userId?: string; user_id?: string; type: string; description: string; metadata: any; createdAt?: string; created_at?: string }
interface ProfileStats {
  groupsJoined?: number; groups_joined?: number
  groupsCreated?: number; groups_created?: number
  completedCycles?: number; completed_cycles?: number
  onTimePaymentPct?: number; on_time_payment_pct?: number
  contributionSuccessRate?: number; contribution_success_rate?: number
  totalPayoutsReceived?: number; total_payouts_received?: number
  totalContributed?: number; total_contributed?: number
}
interface FullProfile {
  id: string; username: string; firstName: string; lastName: string; email: string
  bio: string; avatarUrl: string; createdAt: string; created_at: string
  reputationScore?: number; reputation_score?: number
  currentStreak: number; longestStreak: number
  streak: UserStreak; achievements: Achievement[]; stats: ProfileStats
  activity: ActivityFeedItem[]; rank: LeaderboardRank
}

async function fetchFullProfile(usernameOrId: string, byUsername = false): Promise<FullProfile | null> {
  try {
    const path = byUsername ? `/users/by-username/${usernameOrId}/profile` : `/users/${usernameOrId}/profile`
    const res = await apiFetch(path)
    return res.data ?? res
  } catch { return null }
}

async function fetchLeaderboard(category: string) {
  try { const res = await apiFetch(`/users/leaderboard?category=${category}&limit=10`); return res.data ?? res }
  catch { return [] }
}

const TIERS = [
  { name: 'Bronze',   min: 0,   max: 199,  color: '#92400E', bg: '#FEF3C7' },
  { name: 'Silver',   min: 200, max: 399,  color: '#6B7280', bg: '#F3F4F6' },
  { name: 'Gold',     min: 400, max: 649,  color: '#B45309', bg: '#FEF3C7' },
  { name: 'Platinum', min: 650, max: 849,  color: '#1D4ED8', bg: '#EFF6FF' },
  { name: 'Elite',    min: 850, max: 1000, color: '#6D28D9', bg: '#F5F3FF' },
]
function getTier(score: number) { return TIERS.find(t => score >= t.min && score <= t.max) || TIERS[0] }

const BADGE_META: Record<string, { icon: string; label: string; desc: string }> = {
  FIRST_CONTRIBUTION: { icon: '🌱', label: 'New Saver',         desc: 'Made your first contribution' },
  STREAK_7:           { icon: '🔥', label: 'Early Contributor', desc: 'Contributed 7 times in a row' },
  STREAK_30:          { icon: '⚡', label: 'Streak Starter',    desc: '30 consecutive contributions' },
  STREAK_90:          { icon: '💎', label: 'Consistent Saver',  desc: '90 consecutive contributions' },
  PERFECT_CYCLE:      { icon: '🏆', label: 'Trusted Member',    desc: 'Completed a perfect cycle' },
  CONTRIBUTED_100K:   { icon: '👥', label: 'Group Builder',     desc: 'Contributed ₦100,000 total' },
  EARLY_SUPPORTER:    { icon: '🎯', label: 'Active Saver',      desc: 'Joined in the first 30 days' },
  TOP_SAVER:          { icon: '🥇', label: 'Cycle Champ',       desc: 'Top 10% of all contributors' },
  VERIFIED:           { icon: '✅', label: 'Reliable',          desc: 'Identity verified' },
  VETERAN:            { icon: '🎖️', label: 'Top Contributor',   desc: '1 year as a member' },
}

const ACTIVITY_ICONS: Record<string, string> = {
  JOINED_GROUP: '👥', CONTRIBUTION: '💳', BADGE_EARNED: '🏅', CYCLE_COMPLETE: '🔄', PAYOUT_RECEIVED: '💵',
}

const fade = (delay = 0) => ({
  initial: { opacity: 0, y: 10 },
  animate: { opacity: 1, y: 0 },
  transition: { duration: 0.35, ease: [0.16, 1, 0.3, 1], delay },
})

// ── KYC Status Card ────────────────────────────────────────────
function KycStatusCard({ isOwn }: { isOwn: boolean }) {
  const navigate = useNavigate()
  const [kycStatus, setKycStatus] = useState<any>(null)
  const [loading, setLoading]     = useState(true)

  useEffect(() => {
    kycApi.getStatus()
      .then(r => setKycStatus(r.data?.data || r.data))
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [])

  const isVerified     = kycStatus?.status === 'VERIFIED'
  const isUnderReview  = kycStatus?.status === 'MANUAL_REVIEW'
  const isRejected     = kycStatus?.status === 'REJECTED'
  const isNotStarted   = !kycStatus || kycStatus?.status === 'NOT_STARTED' || kycStatus?.status === 'PENDING'
  // Only show a verified tick if the whole KYC passed — not if it was later rejected
  const ninOk          = kycStatus?.ninVerified && !isRejected
  const bvnOk          = kycStatus?.bvnVerified && !isRejected

  return (
    <div className="pp-card">
      <div className="pp-card-hd">
        <p className="pp-section-label">Identity Verification</p>
        {isVerified     && <span style={{ fontSize:11, fontWeight:700, color:'#16A34A', background:'#F0FDF4', padding:'3px 10px', borderRadius:20, border:'1px solid #BBF7D0' }}>✓ Verified</span>}
        {isUnderReview  && <span style={{ fontSize:11, fontWeight:700, color:'#B45309', background:'#FEF3C7', padding:'3px 10px', borderRadius:20, border:'1px solid #FDE68A' }}>⏳ Under review</span>}
        {isRejected     && <span style={{ fontSize:11, fontWeight:700, color:'#DC2626', background:'#FEF2F2', padding:'3px 10px', borderRadius:20, border:'1px solid #FECACA' }}>❌ Rejected</span>}
        {isNotStarted   && <span style={{ fontSize:11, fontWeight:700, color:'#DC2626', background:'#FEF2F2', padding:'3px 10px', borderRadius:20, border:'1px solid #FECACA' }}>Not verified</span>}
      </div>

      {loading ? (
        <div style={{ display:'flex', flexDirection:'column', gap:8 }}>
          {[1,2].map(i => <div key={i} className="pp-skel" style={{ height:52, borderRadius:12 }}/>)}
        </div>
      ) : (
        <div style={{ display:'flex', flexDirection:'column', gap:8 }}>
          {/* NIN row */}
          <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', background:'#F9FAFB', border:'1px solid #E5E7EB', borderRadius:12, padding:'12px 14px' }}>
            <div>
              <p style={{ fontSize:10, fontWeight:700, color:'#9CA3AF', textTransform:'uppercase', letterSpacing:'.06em', marginBottom:2 }}>NIN</p>
              <p style={{ fontSize:14, fontFamily:'DM Mono, monospace', fontWeight:700, color:'#111827' }}>
                {ninOk ? kycStatus.ninMasked : '— Not verified'}
              </p>
            </div>
            <span style={{ fontSize:18 }}>{ninOk ? '✅' : '○'}</span>
          </div>

          {/* BVN row */}
          <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', background:'#F9FAFB', border:'1px solid #E5E7EB', borderRadius:12, padding:'12px 14px' }}>
            <div>
              <p style={{ fontSize:10, fontWeight:700, color:'#9CA3AF', textTransform:'uppercase', letterSpacing:'.06em', marginBottom:2 }}>BVN</p>
              <p style={{ fontSize:14, fontFamily:'DM Mono, monospace', fontWeight:700, color:'#111827' }}>
                {bvnOk ? kycStatus.bvnMasked : '— Not verified'}
              </p>
            </div>
            <span style={{ fontSize:18 }}>{bvnOk ? '✅' : '○'}</span>
          </div>

        

          {/* CTA */}
          {isOwn && !isVerified && !isUnderReview && (
            <button onClick={() => navigate('/verify-identity')}
              style={{ marginTop:4, height:40, borderRadius:10, background: isRejected ? '#DC2626' : '#111827', color:'#fff', border:'none', fontSize:13, fontWeight:600, cursor:'pointer', fontFamily:'Inter, sans-serif' }}>
              {isRejected ? 'Resubmit Verification →' : bvnOk ? 'Complete Face Scan →' : ninOk ? 'Complete BVN Verification →' : 'Start Identity Verification →'}
            </button>
          )}
          {isOwn && isRejected && (
            <div style={{ background:'#FEF2F2', border:'1px solid #FECACA', borderRadius:10, padding:'10px 12px', marginTop:2 }}>
              <p style={{ fontSize:12, color:'#DC2626', fontWeight:600 }}>❌ Your identity verification was rejected.</p>
              {kycStatus?.rejectionReason && <p style={{ fontSize:11, color:'#B91C1C', marginTop:4 }}>Reason: {kycStatus.rejectionReason}</p>}
            </div>
          )}
          {isOwn && isUnderReview && (
            <div style={{ background:'#FFFBEB', border:'1px solid #FDE68A', borderRadius:10, padding:'10px 12px', marginTop:2 }}>
              <p style={{ fontSize:12, color:'#B45309', fontWeight:600 }}>⏳ Your identity is under manual review. We'll notify you within 24 hours.</p>
            </div>
          )}
          {isOwn && isVerified && (
            <div style={{ background:'#F0FDF4', border:'1px solid #BBF7D0', borderRadius:10, padding:'10px 12px', marginTop:2 }}>
              <p style={{ fontSize:12, color:'#16A34A', fontWeight:600 }}>✅ Identity fully verified. All PayPaddy features are unlocked.</p>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

function LeaderboardCard() {
  const [tab, setTab]     = useState('STREAK')
  const [rows, setRows]   = useState<any[]>([])
  const [loading, setLoading] = useState(false)
  const tabs = [{ id:'STREAK', label:'Streak' }, { id:'REPUTATION', label:'Trust' }, { id:'CONTRIBUTED', label:'Savings' }, { id:'CREATORS', label:'Builders' }]
  useEffect(() => {
    setLoading(true)
    fetchLeaderboard(tab).then(d => { setRows(Array.isArray(d) ? d : []); setLoading(false) })
  }, [tab])
  const colors = ['#B45309','#6B7280','#92400E','#7C3AED','#BE185D','#1D4ED8','#065F46','#B91C1C']
  return (
    <div className="pp-card">
      <p className="pp-section-label">Leaderboard</p>
      <div className="pp-tabs">
        {tabs.map(t => <button key={t.id} className={`pp-tab ${tab===t.id?'pp-tab-on':''}`} onClick={()=>setTab(t.id)}>{t.label}</button>)}
      </div>
      {loading ? (
        [...Array(5)].map((_,i) => <div key={i} className="pp-skel" style={{ height:44, borderRadius:10, marginBottom:4 }}/>)
      ) : rows.length === 0 ? (
        <div className="pp-lb-empty">
          <div className="pp-lb-empty-icon">🏆</div>
          <p className="pp-lb-empty-title">No data yet</p>
          <p className="pp-lb-empty-sub">Check back later to see the leaderboard.</p>
        </div>
      ) : rows.map((row, i) => {
        const u = row.user || row.users || {}
        const initials = ((u.firstName?.[0]||'')+(u.lastName?.[0]||''))||'?'
        const medals = ['🥇','🥈','🥉']
        return (
          <div key={row.userId||i} className={`pp-lb-row ${i===0?'pp-lb-top':''}`}>
            <div className="pp-lb-rank">{i<3?medals[i]:`${i+1}`}</div>
            <div className="pp-lb-av" style={{ background:colors[i%colors.length] }}>{initials}</div>
            <div className="pp-lb-info">
              <div className="pp-lb-name">{u.firstName} {u.lastName}</div>
              <div className="pp-lb-handle">@{u.username}</div>
            </div>
            <div className="pp-lb-score">{row.score??'—'}</div>
          </div>
        )
      })}
    </div>
  )
}

// FIX: removed the email field — the backend's UpdateProfileDto only
// accepts firstName, lastName, bio, phone. There's no email property at
// all, so typing a new email here and hitting Save silently did nothing;
// the change was dropped before it ever reached the database. Changing
// email properly needs re-verification + a uniqueness check, which is a
// bigger feature for later — for now this just stops the form from
// lying about what it can do.
function EditModal({ profile, onClose, onSave }: { profile: FullProfile; onClose: () => void; onSave: (d: any) => void }) {
  const { register, handleSubmit, formState: { isSubmitting } } = useForm({
    defaultValues: { firstName: profile.firstName, lastName: profile.lastName, bio: profile.bio },
  })
  return (
    <motion.div className="pp-overlay" initial={{ opacity:0 }} animate={{ opacity:1 }} exit={{ opacity:0 }} onClick={onClose}>
      <motion.div className="pp-modal" initial={{ y:40, opacity:0 }} animate={{ y:0, opacity:1 }} exit={{ y:40, opacity:0 }}
        transition={{ duration:0.25, ease:[0.16,1,0.3,1] }} onClick={e=>e.stopPropagation()}>
        <div className="pp-modal-hd">
          <span className="pp-modal-title">Edit Profile</span>
          <button className="pp-modal-x" onClick={onClose}>✕</button>
        </div>
        <form onSubmit={handleSubmit(onSave)} className="pp-modal-form">
          <div className="pp-form-row">
            <div className="pp-form-field"><label>First name</label><input {...register('firstName')} placeholder="First name"/></div>
            <div className="pp-form-field"><label>Last name</label><input {...register('lastName')} placeholder="Last name"/></div>
          </div>
          <div className="pp-form-field"><label>Bio</label><textarea {...register('bio')} rows={3} placeholder="Tell your circle about yourself…"/></div>
          <button type="submit" className="pp-submit" disabled={isSubmitting}>{isSubmitting ? 'Saving…' : 'Save changes'}</button>
        </form>
      </motion.div>
    </motion.div>
  )
}

function SkeletonPage() {
  return (
    <div className="pp-root">
      <style>{CSS}</style>
      <div className="pp-skel-stack">
        {[120,180,120,200,160].map((h,i) => <div key={i} className="pp-skel" style={{ height:h, borderRadius:18 }}/>)}
      </div>
    </div>
  )
}

export function ProfilePage() {
  const { username }  = useParams<{ username?: string }>()
  const navigate      = useNavigate()
  const { user: me }  = useAuthStore()
  const [profile, setProfile]   = useState<FullProfile | null>(null)
  const [loading, setLoading]   = useState(true)
  const [showEdit, setShowEdit] = useState(false)
  const [copied, setCopied]     = useState(false)
  const [claiming, setClaiming] = useState(false)
  const isOwn = !username || username === me?.username

  useEffect(() => {
    if (isOwn && me?.id) {
      fetchFullProfile(me.id).then(p => { setProfile(p); setLoading(false) })
    } else if (username) {
      fetchFullProfile(username, true).then(p => { setProfile(p); setLoading(false) })
    } else { setLoading(false) }
  }, [username, me?.id, isOwn])

  async function handleSave(data: any) {
    if (!me?.id) return
    await apiFetch(`/users/${me.id}`, { method:'PATCH', body:JSON.stringify(data) })
    setProfile(prev => prev ? { ...prev, ...data } : prev)
    setShowEdit(false)
  }

  async function claimStreak() {
    if (!me?.id || !profile) return
    const today = new Date().toLocaleDateString('en-CA')
    setClaiming(true)
    try {
      const res = await apiFetch(`/users/${me.id}/streak/claim`, { method:'POST' })
      const updated = res.data ?? res
      setProfile(prev => prev ? { ...prev, streak: { ...prev.streak, ...updated, lastContributionDate: updated.lastContributionDate ?? today }, currentStreak: updated.currentStreak, longestStreak: updated.longestStreak } : prev)
    } catch (err: any) {
      if (err?.message?.toLowerCase().includes('already claimed')) {
        setProfile(prev => prev ? { ...prev, streak: { ...prev.streak, lastContributionDate: today } } : prev)
      }
    } finally { setClaiming(false) }
  }

  // FIX: was building /profile/${username}, but App.tsx only defines
  // /u/:username for viewing someone else's profile — /profile/:username
  // doesn't exist anywhere in the router, so the copied link always 404'd.
  function copyLink() {
    navigator.clipboard.writeText(`${window.location.origin}/u/${profile?.username}`)
    setCopied(true); setTimeout(() => setCopied(false), 2000)
  }

  if (loading) return <DashboardLayout title="Profile"><SkeletonPage /></DashboardLayout>
  if (!profile) return (
    <DashboardLayout title="Profile">
      <div className="pp-root"><style>{CSS}</style>
        <div className="pp-empty"><div className="pp-empty-icon">👤</div><div className="pp-empty-text">User not found</div></div>
      </div>
    </DashboardLayout>
  )

  const initials   = `${profile.firstName?.[0]||''}${profile.lastName?.[0]||''}`
  const memberSince = new Date(profile.createdAt ?? profile.created_at).toLocaleDateString('en-NG', { month:'long', year:'numeric' })
  // FIX: reputationScore (camelCase, matches Prisma) with reputation_score
  // as a fallback — was previously reputation_score only, which was always
  // undefined, so every user's Trust Score showed 0/1000 "Bronze".
  const score      = profile.reputationScore ?? profile.reputation_score ?? 0
  const tier       = getTier(score)
  const tierIdx    = TIERS.findIndex(t => t.name === tier.name)
  const nextTier   = TIERS[tierIdx + 1]
  const pct        = nextTier ? Math.min(100, ((score - tier.min) / Math.max(1, nextTier.min - tier.min)) * 100) : 100
  const streak     = profile.streak
  const today      = new Date().toLocaleDateString('en-CA')
  const lastDate   = streak?.lastContributionDate ? new Date(streak.lastContributionDate + 'T12:00:00').toLocaleDateString('en-CA') : null
  const alreadyClaimed = lastDate === today
  const calDays    = Array.from({ length:28 }, (_,i) => ({ isToday: i===27, isDone: i>=28-(streak?.currentStreak??0) && i!==27 }))

  // FIX: every stat below now reads camelCase first (matches your Prisma
  // ProfileStats model) with the old snake_case as a fallback — previously
  // ONLY the snake_case names were read, so this whole grid always showed
  // 0 / — / ₦0 regardless of the user's real activity.
  const stats = profile.stats || {}
  const groupsJoined      = stats.groupsJoined ?? stats.groups_joined ?? 0
  const groupsCreated     = stats.groupsCreated ?? stats.groups_created ?? 0
  const completedCycles   = stats.completedCycles ?? stats.completed_cycles ?? 0
  const onTimePaymentPct  = stats.onTimePaymentPct ?? stats.on_time_payment_pct ?? 0
  const totalPayouts      = stats.totalPayoutsReceived ?? stats.total_payouts_received ?? 0
  const totalContributed  = stats.totalContributed ?? stats.total_contributed ?? 0

  const STATS = [
    { icon:'👥', val: groupsJoined,   label:'Groups Joined',  sub:'All time' },
    { icon:'🔗', val: groupsCreated,  label:'Groups Created', sub:'All time' },
    { icon:'🔄', val: completedCycles,label:'Cycles Done',    sub:'All time' },
    { icon:'📦', val: onTimePaymentPct > 0 ? `${onTimePaymentPct}%` : '—', label:'On-time Rate', sub:'' },
    { icon:'💰', val: totalPayouts > 0 ? `₦${totalPayouts.toLocaleString()}` : '₦0', label:'Total Payouts', sub:'All time' },
    { icon:'📈', val: totalContributed > 0 ? `₦${totalContributed.toLocaleString()}` : '₦0', label:'Contributed', sub:'All time' },
  ]

  const earned = new Set((profile.achievements ?? []).map(a => a.type))

  return (
    <DashboardLayout title={isOwn ? 'My Profile' : `@${profile.username}`}>
      <div className="pp-root">
        <style>{CSS}</style>

        {/* ── Hero card ── */}
        <motion.div className="pp-hero-card" {...fade(0)}>
          <div className="pp-hero-inner">
            <div className="pp-av-wrap">
              <div className="pp-av-inner">
                {profile.avatarUrl
                  ? <img src={profile.avatarUrl} className="pp-av-img" alt={initials}/>
                  : <span className="pp-av-letters">{initials}</span>}
              </div>
              <div className="pp-av-dot"/>
            </div>
            <div className="pp-hero-info">
              <p className="pp-welcome">Welcome back,</p>
              <div className="pp-name-row">
                <span className="pp-name">{profile.firstName} {profile.lastName}</span>
                <span className="pp-tier-pill" style={{ color:tier.color, background:tier.bg, borderColor:tier.color+'40' }}>{tier.name} Member</span>
              </div>
              <div className="pp-meta-row">
                <span className="pp-meta-item"><svg className="pp-meta-icon" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z"/></svg>Member since <strong>{memberSince}</strong></span>
                <span className="pp-meta-item"><svg className="pp-meta-icon" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z"/></svg>Member ID <strong>PP-{profile.id?.slice(0,5).toUpperCase()}</strong></span>
                <span className="pp-meta-item"><svg className="pp-meta-icon" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z"/></svg>Trust Rank <strong style={{ color:tier.color }}>{tier.name}</strong></span>
              </div>
            </div>
            <div className="pp-hero-kpi">
              {[
                { label:'Groups',        val: groupsJoined,   icon:<svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z"/></svg> },
                { label:'Total Payouts', val: totalPayouts > 0 ? `₦${totalPayouts.toLocaleString()}` : '₦0', icon:<svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M3 10h18M7 15h1m4 0h1m-7 4h12a3 3 0 003-3V8a3 3 0 00-3-3H6a3 3 0 00-3 3v8a3 3 0 003 3z"/></svg> },
                { label:'Contributions', val: completedCycles,  icon:<svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z"/></svg> },
                { label:'Cycles',        val: groupsJoined || 1, icon:<svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"/></svg> },
              ].map(k => (
                <div key={k.label} className="pp-kpi-item">
                  <div className="pp-kpi-icon">{k.icon}</div>
                  <div><p className="pp-kpi-val">{k.val}</p><p className="pp-kpi-label">{k.label}</p></div>
                </div>
              ))}
            </div>
            <div className="pp-hero-actions">
              {isOwn && (
                <button className="pp-btn-outline" onClick={() => setShowEdit(true)}>
                  <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z"/></svg>
                  Edit Profile
                </button>
              )}
              <button className="pp-btn-green" onClick={copyLink}>
                <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8.684 13.342C8.886 12.938 9 12.482 9 12c0-.482-.114-.938-.316-1.342m0 2.684a3 3 0 110-2.684m0 2.684l6.632 3.316m-6.632-6l6.632-3.316m0 0a3 3 0 105.367-2.684 3 3 0 00-5.367 2.684zm0 9.316a3 3 0 105.368 2.684 3 3 0 00-5.368-2.684z"/></svg>
                {copied ? 'Copied!' : 'Share Profile'}
              </button>
            </div>
          </div>
        </motion.div>

        {/* ── KYC Status (own profile only) ── */}
        {isOwn && (
          <motion.div {...fade(0.06)}>
            <KycStatusCard isOwn={isOwn}/>
          </motion.div>
        )}

        {/* ── Trust + Streak ── */}
        <div className="pp-two-col">
          <motion.div className="pp-card" {...fade(0.08)}>
            <div className="pp-card-hd">
              <p className="pp-section-label">Trust Score</p>
            </div>
            <div className="pp-trust-row">
              <span className="pp-trust-num">{score}</span>
              <span className="pp-trust-denom">/1000</span>
              <span className="pp-tier-pill ml-3" style={{ color:tier.color, background:tier.bg, borderColor:tier.color+'40' }}>🏅 {tier.name}</span>
            </div>
            <div className="pp-prog-track">
              <motion.div className="pp-prog-fill" initial={{ width:0 }} animate={{ width:`${pct}%` }}
                transition={{ duration:1.4, ease:[0.16,1,0.3,1], delay:0.4 }} style={{ background:tier.color }}/>
            </div>
            <div className="pp-tier-labels">
              {TIERS.map(t => <span key={t.name} style={t.name===tier.name?{color:tier.color,fontWeight:700}:{}}>{t.name}</span>)}
            </div>
            <div className="pp-trust-footer">
              <div className="pp-tf-item"><p className="pp-tf-val" style={{ color:'#22C55E' }}>+102</p><p className="pp-tf-sub">vs last month</p></div>
              <div className="pp-tf-item"><p className="pp-tf-val">{onTimePaymentPct > 0 ? `${onTimePaymentPct}%` : '— —'}</p><p className="pp-tf-sub">On-time rate</p></div>
              <div className="pp-tf-item"><p className="pp-tf-val">Excellent</p><p className="pp-tf-sub">Reliability</p></div>
            </div>
          </motion.div>

          <motion.div className="pp-card" {...fade(0.1)}>
            <div className="pp-card-hd"><p className="pp-section-label">Contribution Streak</p></div>
            <div className="pp-streak-row">
              <span className="pp-streak-fire">🔥</span>
              <span className="pp-streak-num">{streak?.currentStreak ?? 0}</span>
              <span className="pp-streak-sub">days streak</span>
            </div>
            <div className="pp-cal-hd">
              <span className="pp-cal-label">Last 28 days</span>
              <span className="pp-cal-done" style={{ color:'#22C55E' }}>{streak?.currentStreak ?? 0} / 28 days</span>
            </div>
            <div className="pp-cal">
              {calDays.map((d,i) => <div key={i} className={`pp-cd ${d.isToday?'pp-cd-today':d.isDone?'pp-cd-done':''}`}/>)}
            </div>
            {isOwn && (
              <button className="pp-claim-btn" onClick={claimStreak} disabled={alreadyClaimed||claiming}
                style={alreadyClaimed?{opacity:.5,cursor:'not-allowed'}:{}}>
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z"/></svg>
                {claiming ? 'Claiming…' : alreadyClaimed ? '✓ Claimed today' : "Claim today's streak"}
              </button>
            )}
          </motion.div>
        </div>

        {/* ── Stats ── */}
        <motion.div className="pp-stats-grid" {...fade(0.14)}>
          {STATS.map(s => (
            <div key={s.label} className="pp-stat">
              <div className="pp-stat-icon">{s.icon}</div>
              <div><p className="pp-stat-val">{s.val}</p><p className="pp-stat-label">{s.label}</p><p className="pp-stat-sub">{s.sub}</p></div>
            </div>
          ))}
        </motion.div>

        {/* ── Badges + Leaderboard ── */}
        <div className="pp-badges-lb-grid">
          <motion.div className="pp-card" {...fade(0.18)}>
            <div className="pp-card-hd">
              <p className="pp-section-label">Badges</p>
              <span style={{ fontSize:12, color:'#22C55E', fontWeight:600 }}>{earned.size} / {Object.keys(BADGE_META).length} earned</span>
            </div>
            <div className="pp-badges">
              {Object.entries(BADGE_META).map(([type, meta]) => {
                const isEarned = earned.has(type)
                return (
                  <div key={type} className={`pp-badge ${isEarned?'pp-badge-on':'pp-badge-off'}`} title={isEarned?meta.desc:`🔒 ${meta.desc}`}>
                    <div className="pp-badge-icon">{meta.icon}</div>
                    <div className="pp-badge-name">{meta.label}</div>
                  </div>
                )
              })}
            </div>
          </motion.div>
          <motion.div {...fade(0.2)}><LeaderboardCard/></motion.div>
        </div>

        {/* ── Activity ── */}
        {(profile.activity ?? []).length > 0 && (
          <motion.div className="pp-card" {...fade(0.22)}>
            <p className="pp-section-label">Recent Activity</p>
            {profile.activity.map(item => {
              const icon = ACTIVITY_ICONS[item.type] || '📌'
              // FIX: createdAt first, created_at as fallback — was
              // created_at-only, which rendered as "Invalid Date" for
              // every activity entry since the field never existed.
              const rawDate = item.createdAt ?? item.created_at
              const date = rawDate ? new Date(rawDate).toLocaleDateString('en-NG', { month:'short', day:'numeric' }) : ''
              const amt  = item.metadata?.amount
              return (
                <div key={item.id} className="pp-feed-item">
                  <div className="pp-feed-dot">{icon}</div>
                  <div className="pp-feed-body"><p className="pp-feed-desc">{item.description}</p><p className="pp-feed-time">{date}</p></div>
                  {amt && <div className="pp-feed-amt">{item.type==='CONTRIBUTION'?'−':'+'}₦{Number(amt).toLocaleString()}</div>}
                </div>
              )
            })}
          </motion.div>
        )}

        <AnimatePresence>
          {showEdit && profile && <EditModal profile={profile} onClose={() => setShowEdit(false)} onSave={handleSave}/>}
        </AnimatePresence>
      </div>
    </DashboardLayout>
  )
}

const CSS = `
  @import url('https://fonts.googleapis.com/css2?family=DM+Mono:wght@400;500&family=Inter:wght@300;400;500;600;700;800&display=swap');
  .pp-root { font-family: 'Inter', -apple-system, sans-serif; max-width: 1000px; margin: 0 auto; padding: 24px 20px; display: flex; flex-direction: column; gap: 16px; color: #111827; background: #F8F9FB; min-height: 100vh; }
  .pp-hero-card { background: #fff; border: 1px solid #E5E7EB; border-radius: 20px; padding: 24px; box-shadow: 0 1px 4px rgba(0,0,0,.04); }
  .pp-hero-inner { display: flex; align-items: flex-start; gap: 16px; flex-wrap: wrap; }
  .pp-av-wrap { position: relative; width: 72px; height: 72px; flex-shrink: 0; }
  .pp-av-inner { width: 72px; height: 72px; border-radius: 50%; background: #111827; border: 3px solid #fff; box-shadow: 0 0 0 2px #22C55E; display: flex; align-items: center; justify-content: center; overflow: hidden; }
  .pp-av-letters { color: #fff; font-weight: 800; font-size: 22px; }
  .pp-av-img { width: 100%; height: 100%; object-fit: cover; }
  .pp-av-dot { position: absolute; bottom: 3px; right: 3px; width: 14px; height: 14px; background: #22C55E; border-radius: 50%; border: 2px solid #fff; }
  .pp-welcome { font-size: 12px; color: #22C55E; font-weight: 600; margin-bottom: 2px; }
  .pp-hero-info { flex: 1; min-width: 200px; }
  .pp-name-row { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; margin-bottom: 6px; }
  .pp-name { font-size: 22px; font-weight: 800; letter-spacing: -0.5px; color: #111827; }
  .pp-tier-pill { font-size: 11px; font-weight: 700; padding: 3px 10px; border-radius: 20px; border-width: 1px; border-style: solid; }
  .pp-meta-row { display: flex; gap: 16px; flex-wrap: wrap; margin-top: 6px; }
  .pp-meta-item { display: flex; align-items: center; gap: 5px; font-size: 12px; color: #6B7280; }
  .pp-meta-item strong { color: #111827; font-weight: 600; }
  .pp-meta-icon { width: 14px; height: 14px; color: #9CA3AF; flex-shrink: 0; }
  .pp-hero-kpi { display: flex; flex-wrap: wrap; gap: 0; border: 1px solid #E5E7EB; border-radius: 12px; overflow: hidden; align-self: center; }
  .pp-kpi-item { display: flex; align-items: center; gap: 10px; padding: 12px 16px; border-right: 1px solid #E5E7EB; min-width: 0; }
  .pp-kpi-item:last-child { border-right: none; }
  .pp-kpi-icon { color: #9CA3AF; }
  .pp-kpi-val { font-size: 15px; font-weight: 700; color: #111827; white-space: nowrap; }
  /* FIX: on narrow phones this row previously stayed in one un-wrapping
     flex line and got clipped by the card's overflow:hidden (the
     "CONTRIBUTIONS" label showing as "CONT" in mobile testing). Now it
     wraps to 2 columns under 420px so nothing gets cut off. */
  @media (max-width: 420px) {
    .pp-hero-kpi { border-radius: 12px; }
    .pp-kpi-item { flex: 1 1 50%; border-right: 1px solid #E5E7EB; border-bottom: 1px solid #E5E7EB; }
    .pp-kpi-item:nth-child(2n) { border-right: none; }
    .pp-kpi-item:nth-last-child(-n+2) { border-bottom: none; }
  }
  .pp-kpi-label { font-size: 10px; color: #9CA3AF; text-transform: uppercase; letter-spacing: .05em; margin-top: 1px; font-weight: 500; }
  .pp-hero-actions { display: flex; flex-direction: column; gap: 8px; flex-shrink: 0; align-self: flex-start; }
  .pp-btn-outline { display: flex; align-items: center; gap: 6px; padding: 8px 14px; border-radius: 10px; border: 1px solid #E5E7EB; background: #fff; font-size: 12px; font-weight: 600; color: #374151; cursor: pointer; font-family: 'Inter', sans-serif; transition: all .15s; white-space: nowrap; }
  .pp-btn-outline:hover { background: #F9FAFB; border-color: #D1D5DB; }
  .pp-btn-green { display: flex; align-items: center; gap: 6px; padding: 8px 14px; border-radius: 10px; border: none; background: #22C55E; font-size: 12px; font-weight: 600; color: #fff; cursor: pointer; font-family: 'Inter', sans-serif; transition: all .15s; white-space: nowrap; }
  .pp-btn-green:hover { background: #16A34A; }
  .pp-two-col { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; }
  @media (max-width: 680px) { .pp-two-col { grid-template-columns: 1fr; } }
  .pp-card { background: #fff; border: 1px solid #E5E7EB; border-radius: 18px; padding: 20px; box-shadow: 0 1px 4px rgba(0,0,0,.04); }
  .pp-card-hd { display: flex; align-items: center; justify-content: space-between; margin-bottom: 14px; }
  .pp-section-label { font-size: 11px; font-weight: 700; letter-spacing: .08em; text-transform: uppercase; color: #9CA3AF; }
  .pp-trust-row { display: flex; align-items: flex-end; gap: 6px; margin-bottom: 10px; }
  .pp-trust-num { font-size: 52px; font-weight: 800; letter-spacing: -3px; color: #111827; line-height: 1; font-family: 'DM Mono', monospace; }
  .pp-trust-denom { font-size: 16px; color: #9CA3AF; padding-bottom: 8px; }
  .pp-prog-track { height: 5px; background: #F3F4F6; border-radius: 99px; overflow: hidden; margin: 12px 0 8px; }
  .pp-prog-fill { height: 100%; border-radius: 99px; }
  .pp-tier-labels { display: flex; justify-content: space-between; font-size: 10px; color: #9CA3AF; font-weight: 500; margin-bottom: 14px; }
  .pp-trust-footer { display: flex; padding-top: 14px; border-top: 1px solid #F3F4F6; }
  .pp-tf-item { flex: 1; border-right: 1px solid #F3F4F6; padding: 0 12px; }
  .pp-tf-item:first-child { padding-left: 0; }
  .pp-tf-item:last-child { border-right: none; }
  .pp-tf-val { font-size: 14px; font-weight: 700; color: #111827; }
  .pp-tf-sub { font-size: 10px; color: #9CA3AF; margin-top: 2px; }
  .pp-streak-row { display: flex; align-items: center; gap: 10px; margin-bottom: 14px; }
  .pp-streak-fire { font-size: 36px; }
  .pp-streak-num { font-size: 52px; font-weight: 800; letter-spacing: -3px; color: #111827; line-height: 1; font-family: 'DM Mono', monospace; }
  .pp-streak-sub { font-size: 13px; color: #6B7280; margin-left: 4px; }
  .pp-cal-hd { display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px; }
  .pp-cal-label { font-size: 10px; font-weight: 600; color: #9CA3AF; text-transform: uppercase; letter-spacing: .06em; }
  .pp-cal-done { font-size: 11px; font-weight: 600; }
  .pp-cal { display: grid; grid-template-columns: repeat(7, 1fr); gap: 4px; margin-bottom: 14px; }
  .pp-cd { aspect-ratio: 1; border-radius: 5px; background: #F3F4F6; }
  .pp-cd-done { background: #22C55E; }
  .pp-cd-today { background: #111827; outline: 2px solid rgba(34,197,94,.3); outline-offset: 1px; }
  .pp-claim-btn { width: 100%; padding: 10px; border-radius: 11px; background: #111827; color: #fff; border: none; font-family: 'Inter', sans-serif; font-size: 13px; font-weight: 600; cursor: pointer; display: flex; align-items: center; justify-content: center; gap: 7px; transition: all .15s; }
  .pp-claim-btn:hover:not(:disabled) { background: #1F2937; }
  .pp-stats-grid { display: grid; grid-template-columns: repeat(6, 1fr); gap: 10px; }
  @media (max-width: 720px) { .pp-stats-grid { grid-template-columns: repeat(3, 1fr); } }
  @media (max-width: 480px) { .pp-stats-grid { grid-template-columns: repeat(2, 1fr); } }
  .pp-stat { background: #fff; border: 1px solid #E5E7EB; border-radius: 14px; padding: 14px; display: flex; flex-direction: column; gap: 6px; box-shadow: 0 1px 3px rgba(0,0,0,.03); transition: all .15s; cursor: default; }
  .pp-stat:hover { border-color: #D1D5DB; box-shadow: 0 2px 8px rgba(0,0,0,.06); transform: translateY(-1px); }
  .pp-stat-icon { font-size: 20px; }
  .pp-stat-val { font-size: 16px; font-weight: 800; color: #111827; letter-spacing: -0.3px; }
  .pp-stat-label { font-size: 10px; font-weight: 700; color: #374151; text-transform: uppercase; letter-spacing: .05em; }
  .pp-stat-sub { font-size: 10px; color: #9CA3AF; }
  .pp-badges-lb-grid { display: grid; grid-template-columns: 3fr 2fr; gap: 16px; }
  @media (max-width: 720px) { .pp-badges-lb-grid { grid-template-columns: 1fr; } }
  .pp-badges { display: grid; grid-template-columns: repeat(5, 1fr); gap: 8px; margin-top: 4px; }
  @media (max-width: 480px) { .pp-badges { grid-template-columns: repeat(4, 1fr); } }
  .pp-badge { border-radius: 14px; border: 1px solid #E5E7EB; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 5px; padding: 12px 6px; cursor: default; transition: all .18s; background: #fff; }
  .pp-badge-on:hover { border-color: #BBF7D0; background: #F0FDF4; transform: translateY(-2px); box-shadow: 0 4px 12px rgba(34,197,94,.1); }
  .pp-badge-off { opacity: .35; filter: grayscale(1); }
  .pp-badge-icon { font-size: 22px; }
  .pp-badge-name { font-size: 9px; font-weight: 600; color: #6B7280; text-align: center; line-height: 1.2; text-transform: uppercase; letter-spacing: .03em; }
  .pp-badge-on .pp-badge-name { color: #16A34A; }
  .pp-tabs { display: flex; gap: 2px; background: #F3F4F6; border-radius: 10px; padding: 3px; margin-bottom: 14px; }
  .pp-tab { flex: 1; padding: 6px; border-radius: 7px; font-size: 11px; font-weight: 600; color: #6B7280; cursor: pointer; border: none; background: none; font-family: 'Inter', sans-serif; transition: all .12s; }
  .pp-tab-on { background: #fff; color: #111827; box-shadow: 0 1px 3px rgba(0,0,0,.08); }
  .pp-lb-row { display: flex; align-items: center; gap: 8px; padding: 8px; border-radius: 10px; transition: background .12s; cursor: default; margin-bottom: 2px; }
  .pp-lb-row:hover { background: #F9FAFB; }
  .pp-lb-top { background: #FFFBEB; }
  .pp-lb-rank { width: 20px; text-align: center; font-size: 12px; font-weight: 700; color: #6B7280; font-family: 'DM Mono', monospace; flex-shrink: 0; }
  .pp-lb-av { width: 28px; height: 28px; border-radius: 50%; display: flex; align-items: center; justify-content: center; font-weight: 800; font-size: 10px; color: #fff; flex-shrink: 0; }
  .pp-lb-info { flex: 1; }
  .pp-lb-name { font-size: 12px; font-weight: 600; color: #111827; }
  .pp-lb-handle { font-size: 10px; color: #9CA3AF; }
  .pp-lb-score { font-weight: 700; font-size: 12px; color: #111827; font-family: 'DM Mono', monospace; }
  .pp-lb-empty { text-align: center; padding: 32px 16px; }
  .pp-lb-empty-icon { font-size: 36px; margin-bottom: 8px; }
  .pp-lb-empty-title { font-size: 13px; font-weight: 600; color: #374151; }
  .pp-lb-empty-sub { font-size: 11px; color: #9CA3AF; margin-top: 3px; }
  .pp-feed-item { display: flex; align-items: flex-start; gap: 10px; padding: 10px 0; border-bottom: 1px solid #F3F4F6; }
  .pp-feed-item:last-child { border-bottom: none; }
  .pp-feed-dot { width: 30px; height: 30px; border-radius: 50%; background: #F3F4F6; display: flex; align-items: center; justify-content: center; font-size: 13px; flex-shrink: 0; }
  .pp-feed-body { flex: 1; }
  .pp-feed-desc { font-size: 13px; color: #111827; }
  .pp-feed-time { font-size: 11px; color: #9CA3AF; margin-top: 2px; }
  .pp-feed-amt { font-size: 12px; font-weight: 700; color: #22C55E; flex-shrink: 0; }
  .pp-overlay { position: fixed; inset: 0; background: rgba(0,0,0,.45); display: flex; align-items: center; justify-content: center; z-index: 100; padding: 16px; backdrop-filter: blur(2px); }
  .pp-modal { background: #fff; border: 1px solid #E5E7EB; border-radius: 20px; width: 100%; max-width: 440px; overflow: hidden; box-shadow: 0 24px 60px rgba(0,0,0,.15); }
  .pp-modal-hd { display: flex; align-items: center; justify-content: space-between; padding: 18px 20px; border-bottom: 1px solid #F3F4F6; }
  .pp-modal-title { font-size: 15px; font-weight: 700; color: #111827; }
  .pp-modal-x { width: 28px; height: 28px; border-radius: 50%; background: #F3F4F6; border: none; cursor: pointer; font-size: 12px; color: #6B7280; display: flex; align-items: center; justify-content: center; }
  .pp-modal-form { padding: 20px; display: flex; flex-direction: column; gap: 14px; }
  .pp-form-row { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
  .pp-form-field { display: flex; flex-direction: column; gap: 5px; }
  .pp-form-field label { font-size: 11px; font-weight: 600; color: #6B7280; text-transform: uppercase; letter-spacing: .06em; }
  .pp-form-field input, .pp-form-field textarea { background: #F9FAFB; border: 1px solid #E5E7EB; color: #111827; font-family: 'Inter', sans-serif; font-size: 13px; padding: 9px 12px; border-radius: 10px; outline: none; resize: none; transition: border-color .2s; }
  .pp-form-field input:focus, .pp-form-field textarea:focus { border-color: #22C55E; background: #fff; box-shadow: 0 0 0 3px rgba(34,197,94,.08); }
  .pp-submit { background: #111827; color: #fff; border: none; border-radius: 10px; font-family: 'Inter', sans-serif; font-size: 13px; font-weight: 600; padding: 11px; cursor: pointer; transition: all .15s; }
  .pp-submit:hover { background: #1F2937; }
  .pp-submit:disabled { opacity: .5; cursor: not-allowed; }
  .pp-skel-stack { display: flex; flex-direction: column; gap: 14px; }
  .pp-skel { background: linear-gradient(90deg, #F3F4F6 25%, #E5E7EB 50%, #F3F4F6 75%); background-size: 200% 100%; animation: pp-shimmer 1.5s infinite; }
  @keyframes pp-shimmer { 0% { background-position: 200% 0; } 100% { background-position: -200% 0; } }
  .pp-empty { text-align: center; padding: 80px 20px; }
  .pp-empty-icon { font-size: 40px; margin-bottom: 10px; }
  .pp-empty-text { color: #9CA3AF; font-size: 14px; }
`

export default ProfilePage