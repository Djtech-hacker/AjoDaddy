import { useState, useEffect } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { useUIStore } from '@/stores/uiStore'
import { groupsApi } from '@/api/services'
import { useJoinGroup } from '@/hooks/useApi'

const FREQ_PER: Record<string, string>   = { DAILY: 'day', WEEKLY: 'week', BIWEEKLY: '2 weeks', MONTHLY: 'month', CUSTOM: 'cycle' }
const FREQ_EVERY: Record<string, string> = { DAILY: 'every day', WEEKLY: 'every week', BIWEEKLY: 'every 2 weeks', MONTHLY: 'every month', CUSTOM: 'each cycle' }
const fmt = (n: number) => `₦${Number(n).toLocaleString()}`

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
      showToast('You joined the group! 🎉', 'success')
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
      <div className="min-h-screen flex items-center justify-center bg-warm">
        <div className="text-center space-y-3">
          <div className="w-12 h-12 border-4 border-brand border-t-transparent rounded-full animate-spin mx-auto" />
          <p className="text-[14px] font-semibold text-dim">{phase === 'joining' ? 'Joining group…' : 'Loading invite…'}</p>
        </div>
      </div>
    )
  }

  if (phase === 'error') {
    return (
      <div className="min-h-screen flex items-center justify-center bg-warm">
        <div className="text-center space-y-3 max-w-sm px-6">
          <p className="text-3xl">🔗</p>
          <p className="text-[15px] font-bold text-gray-900">{errorMsg}</p>
          <button onClick={() => navigate('/groups')}
            className="h-9 px-5 rounded-xl bg-brand text-white text-[13px] font-semibold">
            Back to groups
          </button>
        </div>
      </div>
    )
  }

  // phase === 'agreement'
  return (
    <div className="min-h-screen bg-warm flex items-center justify-center p-6">
      <div className="bg-white rounded-2xl border border-gray-200 shadow-sm max-w-lg w-full p-6 space-y-5">
        <div>
          <p className="text-[18px] font-bold text-gray-900">{group?.name}</p>
          {group?.description && <p className="text-[13px] text-gray-500 mt-1">{group.description}</p>}
        </div>

        <div className="bg-emerald-50 border border-emerald-100 rounded-xl p-4 space-y-2">
          <p className="text-[13px] font-bold text-emerald-800 mb-1">This group's terms</p>
          <div className="flex justify-between"><span className="text-[12px] text-emerald-700">You contribute</span><span className="text-[12.5px] font-bold text-emerald-900">{fmt(group?.contributionAmount || 0)} per {FREQ_PER[group?.frequency] || 'cycle'}</span></div>
          <div className="flex justify-between"><span className="text-[12px] text-emerald-700">Payout schedule</span><span className="text-[12.5px] font-bold text-emerald-900">A member paid {FREQ_EVERY[group?.payoutFrequency] || FREQ_EVERY[group?.frequency] || 'each cycle'}</span></div>
          <div className="flex justify-between"><span className="text-[12px] text-emerald-700">Late fee</span><span className="text-[12.5px] font-bold text-emerald-900">{Number(group?.penaltyAmount || 0) > 0 ? fmt(Number(group.penaltyAmount)) : 'None'}</span></div>
        </div>

        <div className="bg-amber-50 border border-amber-100 rounded-xl p-4">
          <p className="text-[13px] font-bold text-amber-800 mb-1">Important notice</p>
          <p className="text-[12px] text-amber-700">By joining this contribution group, you agree to make every scheduled contribution on time.</p>
        </div>

        <div className="space-y-2.5 text-[12.5px] text-gray-600 leading-relaxed">
          <p className="font-semibold text-gray-900">Please understand the following rules:</p>
          <div className="flex gap-2"><span className="text-gray-400">•</span><p>Missing your scheduled contribution will <strong>immediately pause the entire group</strong>, and every member is notified.</p></div>
          <div className="flex gap-2"><span className="text-gray-400">•</span><p>You'll have <strong>48 hours</strong> to complete the missed payment.</p></div>
          <div className="flex gap-2"><span className="text-gray-400">•</span><p>If <strong>not</strong> completed within 48 hours, you'll be automatically removed and a debt is added to your account.</p></div>
          <p className="text-[12px] text-gray-500 pt-1">Your NIN and BVN verification prevents opening another account to avoid repayment. Only join if you're confident you can complete every scheduled payment.</p>
        </div>

        <div className="bg-red-50 border border-red-200 rounded-xl p-4">
          <p className="text-[13px] font-bold text-red-700 mb-1">⚠️ Join at your own risk</p>
          <p className="text-[12px] text-red-600 leading-relaxed">
            This is a known risk in every rotating savings circle: a member paid out early in the rotation can stop contributing afterward and walk away with the pot. Our protections (48hr grace period, automatic removal, debt tracking, NIN/BVN verification) make it harder to get away with, but can't guarantee you'll get your money back. Only join groups with people you trust.
          </p>
        </div>

        <label className="flex items-start gap-3 bg-gray-50 border border-gray-200 rounded-xl p-3.5 cursor-pointer">
          <input type="checkbox" checked={checked} onChange={e => setChecked(e.target.checked)}
            className="mt-0.5 w-4 h-4 rounded border-gray-300 cursor-pointer accent-brand"/>
          <span className="text-[13px] font-semibold text-gray-800">I have read and understood these rules.</span>
        </label>

        <div className="flex gap-2">
          <button onClick={() => navigate('/groups')}
            className="flex-1 h-10 rounded-xl border border-gray-200 text-[13px] font-semibold text-gray-600 hover:bg-gray-50 transition-colors">
            Cancel
          </button>
          <button onClick={handleAcceptAndJoin} disabled={!checked}
            className="flex-1 h-10 rounded-xl bg-brand text-white text-[13px] font-semibold disabled:opacity-50 transition-colors">
            Accept & Join
          </button>
        </div>
      </div>
    </div>
  )
}