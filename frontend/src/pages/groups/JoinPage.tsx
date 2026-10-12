import { useState, useEffect } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { useUIStore } from '@/stores/uiStore'
import { groupsApi } from '@/api/services'
import { useJoinGroup } from '@/hooks/useApi'
import { CARD, LABEL, BTN_PRIMARY, BTN_SECONDARY } from '@/lib/ui'
import { LOGO_URL } from '@/components/auth/AuthShell'

const FREQ_PER: Record<string, string>   = { DAILY: 'day', WEEKLY: 'week', BIWEEKLY: '2 weeks', MONTHLY: 'month', CUSTOM: 'cycle' }
const FREQ_EVERY: Record<string, string> = { DAILY: 'every day', WEEKLY: 'every week', BIWEEKLY: 'every 2 weeks', MONTHLY: 'every month', CUSTOM: 'each cycle' }
const fmt = (n: number) => `₦${Number(n).toLocaleString()}`

// Dark backdrop shared by every phase of this page.
function Backdrop({ children }: { children: React.ReactNode }) {
  return (
    <div className="relative min-h-screen bg-void flex items-center justify-center p-5 overflow-hidden">
      <div className="absolute -bottom-40 -left-32 w-[620px] h-[620px] pointer-events-none"
        style={{ background: 'radial-gradient(closest-side, rgba(27,92,60,0.4), transparent)' }} />
      <div className="absolute -top-40 -right-32 w-[560px] h-[560px] pointer-events-none"
        style={{ background: 'radial-gradient(closest-side, rgba(168,224,58,0.1), transparent)' }} />
      <div className="relative z-10 w-full flex justify-center">{children}</div>
    </div>
  )
}

export default function JoinPage() {
  const { code }      = useParams<{ code: string }>()
  const navigate      = useNavigate()
  const { showToast } = useUIStore()
  const joinGroup     = useJoinGroup()

  const [phase, setPhase]     = useState<'loading' | 'agreement' | 'joining' | 'error'>('loading')
  const [group, setGroup]     = useState<any>(null)
  const [errorMsg, setErrorMsg] = useState('')
  const [checked, setChecked] = useState(false)

  // Step 1 — look up the group by invite code, then show the agreement.
  // FIX: this used to go straight into joinGroup.mutateAsync() here, which
  // the backend always rejected with "You must read and accept the group
  // agreement before joining" — because acceptAgreement() was never called.
  useEffect(() => {
    if (!code) { navigate('/groups'); return }

    groupsApi.findByInviteCode(code)
      .then((res: any) => {
        const g = res.data?.data || res.data
        setGroup(g)
        setPhase('agreement')
      })
      .catch((err: any) => {
        setErrorMsg(err?.response?.data?.message || 'Invalid or expired invite link')
        setPhase('error')
      })
  }, [code])

  // Step 2 — only after the user checks the box do we accept the agreement, then join.
  const handleAcceptAndJoin = async () => {
    if (!group || !checked || !code) return
    setPhase('joining')
    try {
      const deviceInfo = `${navigator.userAgent} · ${window.screen.width}x${window.screen.height}`
      await groupsApi.acceptAgreement(group.id, deviceInfo)
      const joinRes: any = await joinGroup.mutateAsync({ id: group.id, inviteCode: code })
      showToast('You joined the group', 'success')
      const slug = joinRes?.data?.slug || joinRes?.slug || group.slug
      navigate(slug ? `/groups/${slug}` : '/groups')
    } catch (err: any) {
      const msg = err?.response?.data?.message || 'Failed to join'
      showToast(msg, 'error')
      setPhase('agreement')
    }
  }

  if (phase === 'loading' || phase === 'joining') {
    return (
      <Backdrop>
        <div className="text-center space-y-4">
          <img src={LOGO_URL} alt="AjoDaddy" className="h-14 w-auto object-contain mx-auto" />
          <div className="w-8 h-8 border-2 border-lime border-t-transparent rounded-full animate-spin mx-auto" />
          <p className="text-[13px] font-medium text-white/60">{phase === 'joining' ? 'Joining group…' : 'Loading invite…'}</p>
        </div>
      </Backdrop>
    )
  }

  if (phase === 'error') {
    return (
      <Backdrop>
        <div className="text-center space-y-4 max-w-sm px-6">
          <img src={LOGO_URL} alt="AjoDaddy" className="h-14 w-auto object-contain mx-auto" />
          <p className="text-[15px] font-semibold text-white">{errorMsg}</p>
          <button onClick={() => navigate('/groups')}
            className="h-10 px-5 rounded-lg bg-lime text-ink text-[13px] font-semibold hover:bg-lime/90 transition-colors">
            Back to groups
          </button>
        </div>
      </Backdrop>
    )
  }

  // phase === 'agreement'
  return (
    <Backdrop>
      <div className="w-full max-w-lg">
        <img src={LOGO_URL} alt="AjoDaddy" className="h-14 w-auto object-contain mx-auto mb-5" />
        <div className={`${CARD} shadow-[0_30px_80px_-20px_rgba(0,0,0,0.6)] p-6 space-y-5`}>
          <div>
            <p className={LABEL}>You've been invited to</p>
            <p className="text-[20px] font-semibold text-ink tracking-tight mt-1.5">{group?.name}</p>
            {group?.description && <p className="text-[13px] text-dim mt-1">{group.description}</p>}
          </div>

          <div className="rounded-lg border border-black/[0.07] overflow-hidden">
            <div className="px-4 py-2.5 bg-warm/60"><p className={LABEL}>This group's terms</p></div>
            <div className="divide-y divide-black/[0.05]">
              <div className="flex justify-between gap-4 px-4 py-2.5"><span className="text-[12px] text-mist">You contribute</span><span className="text-[12.5px] font-semibold text-ink text-right">{fmt(group?.contributionAmount || 0)} per {FREQ_PER[group?.frequency] || 'cycle'}</span></div>
              <div className="flex justify-between gap-4 px-4 py-2.5"><span className="text-[12px] text-mist">Payout schedule</span><span className="text-[12.5px] font-semibold text-ink text-right">A member paid {FREQ_EVERY[group?.payoutFrequency] || FREQ_EVERY[group?.frequency] || 'each cycle'}</span></div>
              <div className="flex justify-between gap-4 px-4 py-2.5"><span className="text-[12px] text-mist">Late fee</span><span className="text-[12.5px] font-semibold text-ink text-right">{Number(group?.penaltyAmount || 0) > 0 ? fmt(Number(group.penaltyAmount)) : 'None'}</span></div>
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
            <div className="flex gap-2"><span className="text-mist">•</span><p>If <strong>not</strong> completed within 48 hours, you'll be automatically removed and a debt is added to your account.</p></div>
            <p className="text-[12px] text-mist pt-1">Your NIN and BVN verification prevents opening another account to avoid repayment. Only join if you're confident you can complete every scheduled payment.</p>
          </div>

          <div className="bg-red-50 border border-red-200 rounded-lg p-4">
            <p className="text-[13px] font-semibold text-red-700 mb-1">Join at your own risk</p>
            <p className="text-[12px] text-red-600 leading-relaxed">
              This is a known risk in every rotating savings circle: a member paid out early in the rotation can stop contributing afterward and walk away with the pot. Our protections (48hr grace period, automatic removal, debt tracking, NIN/BVN verification) make it harder to get away with, but can't guarantee you'll get your money back. Only join groups with people you trust.
            </p>
          </div>

          <label className="flex items-start gap-3 bg-warm border border-black/[0.07] rounded-lg p-3.5 cursor-pointer">
            <input type="checkbox" checked={checked} onChange={e => setChecked(e.target.checked)}
              className="mt-0.5 w-4 h-4 rounded border-stone cursor-pointer accent-brand"/>
            <span className="text-[13px] font-semibold text-ink">I have read and understood these rules.</span>
          </label>

          <div className="flex gap-2">
            <button onClick={() => navigate('/groups')} className={`${BTN_SECONDARY} flex-1 !h-10`}>Cancel</button>
            <button onClick={handleAcceptAndJoin} disabled={!checked} className={`${BTN_PRIMARY} flex-1 !h-10`}>Accept & join</button>
          </div>
        </div>hi
        
      </div>
    </Backdrop>
  )
}