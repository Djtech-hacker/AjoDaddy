// ============================================================
// ProfilePage.tsx — AjoDaddy Profile (original features + Figma settings)
// ============================================================
// KEPT: hero, identity verification, Recent Activity, Edit modal, avatar upload.
// REMOVED: Trust Score, Streak, Stats, Badges, Leaderboard.
// ADDED (from Figma): email + Verified badge in hero, Personal
//       Information, Residential Address, Security & Authentication,
//       Bank & Payment Methods and "Save settings changes".
// UPDATED: Bank & Payment Methods is now <BankAccountsCard /> (add / default / remove
//       saved bank accounts, name-matched to the verified identity, PIN-confirmed).
import { useState, useEffect, useRef } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { useForm, UseFormRegister, UseFormSetFocus } from 'react-hook-form'
import { motion, AnimatePresence } from 'framer-motion'
import { useAuthStore } from '@/stores/authStore'
import DashboardLayout from '@/components/layout/DashboardLayout'
import BankAccountsCard from '@/components/BankAccountsCard'
import { kycApi } from '@/api/services'

const API_BASE = import.meta.env.VITE_API_URL || '/api'

async function apiFetch(path: string, options: RequestInit = {}) {
  const token = useAuthStore.getState().accessToken
  const res = await fetch(`${API_BASE}${path}`, {
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

// multipart — no manual Content-Type; field name 'file' matches UsersService.uploadAvatar
async function uploadAvatarFile(file: File): Promise<string> {
  const token = useAuthStore.getState().accessToken
  const formData = new FormData()
  formData.append('file', file)
  const res = await fetch(`${API_BASE}/users/me/avatar`, {
    method: 'POST',
    headers: token ? { Authorization: `Bearer ${token}` } : {},
    body: formData,
  })
  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    throw new Error(err.message || 'Upload failed')
  }
  const data = await res.json()
  return (data.data ?? data).avatarUrl
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
interface BankAccount { bankName?: string; accountType?: string; accountNumberMasked?: string }
interface FullProfile {
  id: string; username: string; firstName: string; lastName: string; email: string
  bio: string; avatarUrl: string; createdAt: string; created_at: string
  reputationScore?: number; reputation_score?: number
  currentStreak: number; longestStreak: number
  streak: UserStreak; achievements: Achievement[]; stats: ProfileStats
  activity: ActivityFeedItem[]; rank: LeaderboardRank
  // new settings fields
  phone?: string; phoneNumber?: string; dateOfBirth?: string
  streetAddress?: string; city?: string; state?: string; postalCode?: string; country?: string
  twoFactorEnabled?: boolean; passwordChangedAt?: string; lastLoginAt?: string; lastLoginInfo?: string
  bankAccount?: BankAccount
}

async function fetchFullProfile(usernameOrId: string, byUsername = false): Promise<FullProfile | null> {
  try {
    const path = byUsername ? `/users/by-username/${usernameOrId}/profile` : `/users/${usernameOrId}/profile`
    const res = await apiFetch(path)
    return res.data ?? res
  } catch { return null }
}

const TIERS = [
  { name: 'Bronze',   min: 0,   max: 199,  color: '#92400E', bg: '#FEF3C7' },
  { name: 'Silver',   min: 200, max: 399,  color: '#6B7280', bg: '#F3F4F6' },
  { name: 'Gold',     min: 400, max: 649,  color: '#B45309', bg: '#FEF3C7' },
  { name: 'Platinum', min: 650, max: 849,  color: '#1D4ED8', bg: '#EFF6FF' },
  { name: 'Elite',    min: 850, max: 1000, color: '#6D28D9', bg: '#F5F3FF' },
]
function getTier(score: number) { return TIERS.find(t => score >= t.min && score <= t.max) || TIERS[0] }

const ACTIVITY_ICONS: Record<string, string> = {
  JOINED_GROUP: '👥', CONTRIBUTION: '💳', BADGE_EARNED: '🏅', CYCLE_COMPLETE: '🔄', PAYOUT_RECEIVED: '💵',
}

const fade = (delay = 0) => ({
  initial: { opacity: 0, y: 10 },
  animate: { opacity: 1, y: 0 },
  transition: { duration: 0.35, ease: [0.16, 1, 0.3, 1], delay },
})

function timeAgo(iso?: string) {
  if (!iso) return null
  const days = Math.floor((Date.now() - new Date(iso).getTime()) / 86400000)
  if (days < 1) return 'today'
  if (days < 31) return `${days} day${days === 1 ? '' : 's'} ago`
  const months = Math.floor(days / 30)
  if (months < 12) return `${months} month${months === 1 ? '' : 's'} ago`
  const years = Math.floor(months / 12)
  return `${years} year${years === 1 ? '' : 's'} ago`
}

// ── Identity verification (styled like the settings cards) ──────
const TickIcon = ({ ok }: { ok: boolean }) => (
  <span className={`kyc-tick ${ok ? 'ok' : ''}`} aria-hidden>
    {ok && <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3"><path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7"/></svg>}
  </span>
)

function KycStatusCard({ isOwn, onStatus }: { isOwn: boolean; onStatus?: (s: any) => void }) {
  const navigate = useNavigate()
  const [kycStatus, setKycStatus] = useState<any>(null)
  const [loading, setLoading]     = useState(true)

  useEffect(() => {
    kycApi.getStatus()
      .then(r => { const s = r.data?.data || r.data; setKycStatus(s); onStatus?.(s) })
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [])

  const isVerified    = kycStatus?.status === 'VERIFIED'
  const isUnderReview = kycStatus?.status === 'MANUAL_REVIEW'
  const isRejected    = kycStatus?.status === 'REJECTED'
  const ninOk = !!kycStatus?.ninVerified && !isRejected
  const bvnOk = !!kycStatus?.bvnVerified && !isRejected

  const pill = isVerified ? { cls: 'ok', text: 'Verified' }
    : isUnderReview ? { cls: 'warn', text: 'Under review' }
    : isRejected ? { cls: 'err', text: 'Rejected' }
    : { cls: 'err', text: 'Not verified' }

  const steps = [
    { label: 'NIN', value: ninOk ? kycStatus?.ninMasked : 'Not verified', ok: ninOk },
    { label: 'BVN', value: bvnOk ? kycStatus?.bvnMasked : 'Not verified', ok: bvnOk },
    { label: 'Face scan', value: isVerified ? 'Completed' : 'Not completed', ok: isVerified },
  ]

  const cta = isRejected ? 'Resubmit verification' : bvnOk ? 'Complete face scan' : ninOk ? 'Complete BVN verification' : 'Start identity verification'

  return (
    <section className="pp-card">
      <div className="ps-h kyc-hd">
        <span>Identity verification</span>
        <span className={`kyc-pill ${pill.cls}`}>{pill.text}</span>
      </div>

      {loading ? (
        <div className="kyc-grid">{[1,2,3].map(i => <div key={i} className="pp-skel" style={{ height:58, borderRadius:10 }}/>)}</div>
      ) : (
        <>
          <div className="kyc-grid">
            {steps.map(st => (
              <div key={st.label} className="kyc-item">
                <div>
                  <p className="kyc-label">{st.label}</p>
                  <p className={`kyc-value ${st.ok ? '' : 'muted'}`}>{st.value}</p>
                </div>
                <TickIcon ok={st.ok} />
              </div>
            ))}
          </div>

          {isOwn && isRejected && (
            <p className="kyc-note err">Your identity verification was rejected.{kycStatus?.rejectionReason ? ` Reason: ${kycStatus.rejectionReason}` : ''}</p>
          )}
          {isOwn && isUnderReview && <p className="kyc-note warn">Your identity is under manual review. We'll notify you within 24 hours.</p>}
          {isOwn && isVerified && <p className="kyc-note ok">Identity fully verified. All AjoDaddy features are unlocked.</p>}

          {isOwn && !isVerified && !isUnderReview && (
            <div className="ps-save-row" style={{ marginTop: 14 }}>
              <button type="button" className="ps-save" onClick={() => navigate('/verify-identity')}>{cta} →</button>
            </div>
          )}
        </>
      )}
    </section>
  )
}

// ── Settings (Figma): Personal, Address, Security, Bank, Save ──
type SettingsValues = {
  firstName: string; lastName: string; email: string; phone: string; dateOfBirth: string
  streetAddress: string; city: string; state: string; postalCode: string; country: string
}

// Defined at module level so inputs are not remounted on re-render
function Field({ name, label, register, setFocus, type = 'text', locked = false, wide = false }: {
  name: keyof SettingsValues; label: string; register: UseFormRegister<SettingsValues>; setFocus: UseFormSetFocus<SettingsValues>
  type?: string; locked?: boolean; wide?: boolean
}) {
  return (
    <div className={`ps-field ${wide ? 'ps-wide' : ''}`}>
      <label htmlFor={`f-${name}`}>{label}</label>
      <div className={`ps-input ${locked ? 'ps-locked' : ''}`}>
        <input id={`f-${name}`} type={type} readOnly={locked} {...register(name)} />
        {!locked && (
          <button type="button" className="ps-pen" aria-label={`Edit ${label.toLowerCase()}`} onClick={() => setFocus(name)}>
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path strokeLinecap="round" strokeLinejoin="round" d="M12 20h9M16.5 3.5a2.121 2.121 0 013 3L7 19l-4 1 1-4L16.5 3.5z"/></svg>
          </button>
        )}
      </div>
    </div>
  )
}

function SettingsForm({ profile, userId, onSaved }: { profile: FullProfile; userId: string; onSaved: (d: Partial<FullProfile>) => void }) {
  const navigate = useNavigate()
  const [twoFA, setTwoFA] = useState(!!profile.twoFactorEnabled)
  const [status, setStatus] = useState<{ type: 'ok' | 'err'; msg: string } | null>(null)
  const { register, handleSubmit, reset, setFocus, formState: { isSubmitting, isDirty } } = useForm<SettingsValues>({
    defaultValues: {
      firstName: profile.firstName ?? '', lastName: profile.lastName ?? '', email: profile.email ?? '',
      phone: profile.phone ?? profile.phoneNumber ?? '',
      dateOfBirth: profile.dateOfBirth ? profile.dateOfBirth.slice(0, 10) : '',
      streetAddress: profile.streetAddress ?? '', city: profile.city ?? '', state: profile.state ?? '',
      postalCode: profile.postalCode ?? '', country: profile.country ?? 'Nigeria',
    },
  })

  async function onSave(values: SettingsValues) {
    setStatus(null)
    try {
      const { email, ...payload } = values // email is read-only
      await apiFetch(`/users/${userId}`, { method: 'PATCH', body: JSON.stringify({ ...payload, twoFactorEnabled: twoFA }) })
      onSaved({ ...payload, twoFactorEnabled: twoFA })
      reset(values)
      const cur = useAuthStore.getState().user
      if (cur) useAuthStore.getState().setUser({ ...cur, firstName: values.firstName, lastName: values.lastName })
      setStatus({ type: 'ok', msg: 'Settings saved' })
    } catch (e: any) {
      setStatus({ type: 'err', msg: e?.message || 'Could not save your changes. Try again.' })
    }
  }

  const pwChanged = timeAgo(profile.passwordChangedAt)
  const f = { register, setFocus }
  const twoFAChanged = twoFA !== !!profile.twoFactorEnabled

  return (
    <form className="ps-form" onSubmit={handleSubmit(onSave)}>
      <div className="ps-grid">
        <section className="pp-card">
          <h3 className="ps-h">Personal information</h3>
          <div className="ps-fields">
            <Field name="firstName" label="First name" {...f} />
            <Field name="lastName" label="Last name" {...f} />
            <Field name="email" label="Email address" type="email" locked wide {...f} />
            <Field name="phone" label="Phone number" type="tel" {...f} />
            <Field name="dateOfBirth" label="Date of birth" type="date" {...f} />
          </div>
        </section>

        <section className="pp-card">
          <h3 className="ps-h">Residential address</h3>
          <div className="ps-fields">
            <Field name="streetAddress" label="Street address" wide {...f} />
            <Field name="city" label="City" {...f} />
            <Field name="state" label="State / Region" {...f} />
            <Field name="postalCode" label="ZIP / Postal code" {...f} />
            <Field name="country" label="Country" {...f} />
          </div>
        </section>
      </div>

      <div className="ps-grid">
        <section className="pp-card">
          <h3 className="ps-h">Security &amp; authentication</h3>
          <div className="ps-row">
            <span className="ps-row-title">Two-factor authentication (2FA)</span>
            <button type="button" role="switch" aria-checked={twoFA} aria-label="Two-factor authentication"
              className={`ps-switch ${twoFA ? 'on' : ''}`} onClick={() => setTwoFA(v => !v)}><span /></button>
          </div>
          <div className="ps-row ps-row-line">
            <div>
              <span className="ps-row-title">Password</span>
              {pwChanged && <p className="ps-tiny">Last changed: {pwChanged}</p>}
            </div>
            <button type="button" className="ps-ghost" onClick={() => navigate('/forgot-password')}>Change password</button>
          </div>
          {(profile.lastLoginInfo || profile.lastLoginAt) && (
            <p className="ps-login">Last login: {profile.lastLoginInfo ?? new Date(profile.lastLoginAt!).toLocaleString('en-NG')}</p>
          )}
        </section>

        {/* Saved bank accounts: add / make default / remove (PIN-confirmed) */}
        <BankAccountsCard />
      </div>

      <div className="ps-save-row">
        {status && <span className={`ps-status ${status.type}`} role="status">{status.msg}</span>}
        <button type="submit" className="ps-save" disabled={isSubmitting || (!isDirty && !twoFAChanged)}>
          {isSubmitting ? 'Saving…' : 'Save settings changes'} →
        </button>
      </div>
    </form>
  )
}

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
  const { user: me }  = useAuthStore()
  const [profile, setProfile]   = useState<FullProfile | null>(null)
  const [loading, setLoading]   = useState(true)
  const [showEdit, setShowEdit] = useState(false)
  const [copied, setCopied]     = useState(false)
  const [uploadingAvatar, setUploadingAvatar] = useState(false)
  const [avatarError, setAvatarError] = useState<string | null>(null)
  const [kycVerified, setKycVerified] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)
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

  function copyLink() {
    navigator.clipboard.writeText(`${window.location.origin}/u/${profile?.username}`)
    setCopied(true); setTimeout(() => setCopied(false), 2000)
  }

  async function onPickAvatar(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file || !me?.id) return
    setAvatarError(null)
    if (!file.type.startsWith('image/')) { setAvatarError('Choose an image file.'); return }
    if (file.size > 5 * 1024 * 1024) { setAvatarError('Image must be under 5 MB.'); return }
    setUploadingAvatar(true)
    try {
      const avatarUrl = await uploadAvatarFile(file)
      setProfile(prev => prev ? { ...prev, avatarUrl } : prev)
      // sidebar/topbar read from authStore, so update it too
      const currentUser = useAuthStore.getState().user
      if (currentUser) useAuthStore.getState().setUser({ ...currentUser, avatarUrl })
    } catch (err: any) { setAvatarError(err?.message || 'Photo upload failed.') }
    finally { setUploadingAvatar(false) }
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
  const rawCreated = profile.createdAt ?? profile.created_at
  const memberSince = rawCreated ? new Date(rawCreated).toLocaleDateString('en-NG', { month:'long', year:'numeric' }) : '—'
  const score      = profile.reputationScore ?? profile.reputation_score ?? 0
  const tier       = getTier(score)
  const stats = profile.stats || {}
  const groupsJoined      = stats.groupsJoined ?? stats.groups_joined ?? 0
  const completedCycles   = stats.completedCycles ?? stats.completed_cycles ?? 0
  const totalPayouts      = stats.totalPayoutsReceived ?? stats.total_payouts_received ?? 0

  return (
    <DashboardLayout title={isOwn ? 'My Profile' : `@${profile.username}`}>
      <div className="pp-root">
        <style>{CSS}</style>

        {/* ── Hero card ── */}
        <motion.div className="pp-hero-card" {...fade(0)}>
          <div className="pp-hero-inner">
            <div
              className="pp-av-wrap"
              onClick={() => isOwn && fileInputRef.current?.click()}
              style={isOwn ? { cursor: 'pointer' } : undefined}
            >
              <div className="pp-av-inner">
                {profile.avatarUrl
                  ? <img src={profile.avatarUrl} className="pp-av-img" alt={initials}/>
                  : <span className="pp-av-letters">{initials}</span>}
                {uploadingAvatar && (
                  <div style={{ position:'absolute', inset:0, background:'rgba(0,0,0,.5)', display:'flex', alignItems:'center', justifyContent:'center', borderRadius:'50%' }}>
                    <span style={{ fontSize:10, color:'#fff', fontWeight:600 }}>...</span>
                  </div>
                )}
              </div>
              <div className="pp-av-dot"/>
              {isOwn && (
                <div className="pp-av-edit">
                  <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path strokeLinecap="round" strokeLinejoin="round" d="M12 20h9M16.5 3.5a2.121 2.121 0 013 3L7 19l-4 1 1-4L16.5 3.5z"/></svg>
                </div>
              )}
              {isOwn && (
                <input ref={fileInputRef} type="file" accept="image/*" style={{ display:'none' }} onChange={onPickAvatar}/>
              )}
            </div>
            <div className="pp-hero-info">
              <p className="pp-welcome">Welcome back,</p>
              <div className="pp-name-row">
                <span className="pp-name">{profile.firstName} {profile.lastName}</span>
                {kycVerified && <span className="ps-badge">Verified member</span>}
                <span className="pp-tier-pill" style={{ color:tier.color, background:tier.bg, borderColor:tier.color+'40' }}>{tier.name} Member</span>
              </div>
              {isOwn && profile.email && <p className="ps-hero-email">{profile.email}</p>}
              {avatarError && <p className="ps-hero-err" role="alert">{avatarError}</p>}
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

        {/* ── Settings from Figma (own profile only) ── */}
        {isOwn && me?.id && (
          <motion.div {...fade(0.04)}>
            <SettingsForm profile={profile} userId={me.id} onSaved={d => setProfile(prev => prev ? { ...prev, ...d } : prev)} />
          </motion.div>
        )}

        {/* ── KYC Status (own profile only) ── */}
        {isOwn && (
          <motion.div {...fade(0.06)}>
            <KycStatusCard isOwn={isOwn} onStatus={s => setKycVerified(s?.status === 'VERIFIED')}/>
          </motion.div>
        )}

        {/* ── Activity ── */}
        {(profile.activity ?? []).length > 0 && (
          <motion.div className="pp-card" {...fade(0.22)}>
            <p className="pp-section-label">Recent Activity</p>
            {profile.activity.map(item => {
              const icon = ACTIVITY_ICONS[item.type] || '📌'
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
  .pp-av-inner { width: 72px; height: 72px; border-radius: 50%; background: #111827; border: 3px solid #fff; box-shadow: 0 0 0 2px #22C55E; display: flex; align-items: center; justify-content: center; overflow: hidden; position: relative; }
  .pp-av-letters { color: #fff; font-weight: 800; font-size: 22px; }
  .pp-av-img { width: 100%; height: 100%; object-fit: cover; }
  .pp-av-dot { position: absolute; bottom: 3px; right: 3px; width: 14px; height: 14px; background: #22C55E; border-radius: 50%; border: 2px solid #fff; }
  .pp-av-edit { position: absolute; bottom: -2px; left: -2px; width: 22px; height: 22px; background: #111827; border: 2px solid #fff; border-radius: 50%; display: flex; align-items: center; justify-content: center; color: #fff; pointer-events: none; }
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

  /* ── Figma settings sections ── */
  .ps-hero-email { font-size: 12px; color: #6B7280; margin: -2px 0 2px; }
  .ps-hero-err { font-size: 11px; color: #DC2626; margin-top: 2px; }
  .ps-badge { font-size: 9px; font-weight: 700; letter-spacing: .04em; text-transform: uppercase; color: #15803D; background: #DCFCE7; padding: 4px 8px; border-radius: 6px; }
  .ps-form { display: flex; flex-direction: column; gap: 16px; }
  .ps-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; }
  @media (max-width: 760px) { .ps-grid { grid-template-columns: 1fr; } }
  .ps-h { font-size: 13px; font-weight: 700; color: #111827; padding-bottom: 12px; margin-bottom: 14px; border-bottom: 1px solid #F3F4F6; }
  .ps-fields { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
  .ps-wide { grid-column: 1 / -1; }
  .ps-field label { display: block; font-size: 9px; font-weight: 600; letter-spacing: .05em; text-transform: uppercase; color: #9CA3AF; margin-bottom: 5px; }
  .ps-input { display: flex; align-items: center; background: #F9FAFB; border: 1px solid #E5E7EB; border-radius: 8px; padding: 0 10px; transition: border-color .15s, box-shadow .15s; }
  .ps-input:focus-within { border-color: #22C55E; background: #fff; box-shadow: 0 0 0 3px rgba(34,197,94,.1); }
  .ps-input input { flex: 1; min-width: 0; height: 38px; border: none; background: transparent; outline: none; font-family: inherit; font-size: 12px; color: #111827; }
  .ps-locked input { color: #6B7280; }
  .ps-pen { border: none; background: none; color: #9CA3AF; cursor: pointer; padding: 4px; display: flex; }
  .ps-pen:hover, .ps-pen:focus-visible { color: #16A34A; }
  .ps-row { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 4px 0 12px; }
  .ps-row-line { border-top: 1px solid #F3F4F6; padding-top: 12px; }
  .ps-row-title { font-size: 12px; font-weight: 600; }
  .ps-tiny { font-size: 10px; color: #9CA3AF; margin-top: 2px; }
  .ps-switch { width: 38px; height: 22px; border-radius: 99px; border: none; background: #D1D5DB; padding: 2px; cursor: pointer; transition: background .2s; flex-shrink: 0; }
  .ps-switch span { display: block; width: 18px; height: 18px; border-radius: 50%; background: #fff; transition: transform .2s; }
  .ps-switch.on { background: #16A34A; }
  .ps-switch.on span { transform: translateX(16px); }
  .ps-switch:focus-visible { outline: 2px solid #16A34A; outline-offset: 2px; }
  .ps-ghost { font-family: inherit; font-size: 11px; font-weight: 600; color: #166534; background: #fff; border: 1px solid #D1D5DB; border-radius: 8px; padding: 6px 12px; cursor: pointer; white-space: nowrap; }
  .ps-ghost:hover { background: #F9FAFB; }
  .ps-login { font-size: 10px; color: #6B7280; margin-top: 12px; padding-top: 12px; border-top: 1px solid #F3F4F6; }
  .ps-bank { display: flex; align-items: center; gap: 12px; background: #F9FAFB; border: 1px solid #E5E7EB; border-radius: 10px; padding: 12px; }
  .ps-bank-ic { width: 34px; height: 34px; border-radius: 8px; background: #fff; border: 1px solid #E5E7EB; display: flex; align-items: center; justify-content: center; color: #6B7280; }
  .ps-bank-info { flex: 1; font-size: 12px; font-weight: 600; }
  .ps-default { font-size: 9px; font-weight: 700; letter-spacing: .04em; text-transform: uppercase; color: #15803D; background: #DCFCE7; padding: 3px 8px; border-radius: 6px; }
  .ps-nobank { padding: 12px 0; }
  .ps-link { width: 100%; margin-top: 12px; padding: 14px; background: none; border: 1px dashed #D1D5DB; border-radius: 10px; font-family: inherit; font-size: 11px; font-weight: 600; color: #166534; cursor: pointer; }
  .ps-link:hover { background: #F0FDF4; border-color: #86EFAC; }
  .ps-save-row { display: flex; align-items: center; justify-content: flex-end; gap: 14px; }
  .ps-save { font-family: inherit; font-size: 12px; font-weight: 600; color: #fff; background: #0B3D2A; border: none; border-radius: 8px; padding: 11px 20px; cursor: pointer; }
  .ps-save:hover:not(:disabled) { background: #0F5138; }
  .ps-save:disabled { opacity: .45; cursor: not-allowed; }
  .ps-status { font-size: 12px; font-weight: 600; }
  .ps-status.ok { color: #15803D; }
  .ps-status.err { color: #DC2626; }
  .kyc-hd { display: flex; align-items: center; justify-content: space-between; }
  .kyc-pill { font-size: 9px; font-weight: 700; letter-spacing: .04em; text-transform: uppercase; padding: 4px 8px; border-radius: 6px; }
  .kyc-pill.ok { color: #15803D; background: #DCFCE7; }
  .kyc-pill.warn { color: #B45309; background: #FEF3C7; }
  .kyc-pill.err { color: #B91C1C; background: #FEE2E2; }
  .kyc-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 12px; }
  @media (max-width: 760px) { .kyc-grid { grid-template-columns: 1fr; } }
  .kyc-item { display: flex; align-items: center; justify-content: space-between; gap: 10px; background: #F9FAFB; border: 1px solid #E5E7EB; border-radius: 10px; padding: 12px; }
  .kyc-label { font-size: 9px; font-weight: 600; letter-spacing: .05em; text-transform: uppercase; color: #9CA3AF; margin-bottom: 3px; }
  .kyc-value { font-size: 12px; font-weight: 600; color: #111827; font-family: 'DM Mono', monospace; }
  .kyc-value.muted { color: #9CA3AF; font-family: inherit; font-weight: 500; }
  .kyc-tick { width: 20px; height: 20px; border-radius: 50%; border: 1.5px solid #D1D5DB; display: flex; align-items: center; justify-content: center; flex-shrink: 0; color: #fff; }
  .kyc-tick.ok { background: #16A34A; border-color: #16A34A; }
  .kyc-note { font-size: 11px; font-weight: 500; margin-top: 12px; padding: 10px 12px; border-radius: 8px; }
  .kyc-note.ok { color: #15803D; background: #F0FDF4; }
  .kyc-note.warn { color: #B45309; background: #FFFBEB; }
  .kyc-note.err { color: #B91C1C; background: #FEF2F2; }
  @media (prefers-reduced-motion: reduce) { .ps-switch, .ps-switch span { transition: none; } }
`

export default ProfilePage