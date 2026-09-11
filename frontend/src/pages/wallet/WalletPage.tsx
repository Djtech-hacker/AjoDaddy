import { useState, useEffect, useRef } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { motion, AnimatePresence } from 'framer-motion'
import { useSearchParams, useNavigate } from 'react-router-dom'
import DashboardLayout from '@/components/layout/DashboardLayout'
import { Button, Skeleton, Modal, Input, Select } from '@/components/ui'
import { useWallet, useWalletTransactions, useInitiatePayment } from '@/hooks/useApi'
import { paymentsApi, authApi, kycApi } from '@/api/services'
import { useUIStore } from '@/stores/uiStore'
import { useAuthStore } from '@/stores/authStore'
import type { Transaction } from '@/types'
import dayjs from 'dayjs'

const fundSchema = z.object({
  amount:   z.coerce.number().min(100, 'Minimum ₦100'),
  provider: z.enum(['paystack']),
})
type FundData = z.infer<typeof fundSchema>

const withdrawSchema = z.object({
  amount:        z.coerce.number().min(500, 'Minimum ₦500'),
  accountNumber: z.string().length(10, 'Must be exactly 10 digits'),
  bankCode:      z.string().min(1, 'Please select a bank'),
  accountName:   z.string().min(1, 'Account name is required'),
})
type WithdrawData = z.infer<typeof withdrawSchema>

const setPinSchema = z.object({
  pin:        z.string().length(4, 'PIN must be 4 digits').regex(/^\d{4}$/, 'Digits only'),
  confirmPin: z.string().length(4, 'PIN must be 4 digits'),
}).refine(d => d.pin === d.confirmPin, { message: 'PINs do not match', path: ['confirmPin'] })
type SetPinData = z.infer<typeof setPinSchema>

// Change-PIN flow: (1) verify current account password via
// POST /auth/verify-password (authApi.verifyPassword) — replaces the old
// broken flow that relied on a "forgot password" reset LINK, not a code;
// (2) on success, backend emails a real OTP via POST /auth/send-pin-otp
// (authApi.sendPinChangeOtp); (3) user enters that OTP + new PIN, submitted
// together via POST /auth/change-pin (authApi.changePinWithOtp).
const changePinSchema = z.object({
  otp:        z.string().min(4, 'Enter the code sent to your email'),
  newPin:     z.string().length(4, 'PIN must be 4 digits').regex(/^\d{4}$/, 'Digits only'),
  confirmPin: z.string().length(4, 'PIN must be 4 digits'),
}).refine(d => d.newPin === d.confirmPin, { message: 'PINs do not match', path: ['confirmPin'] })
type ChangePinData = z.infer<typeof changePinSchema>

const TX_CREDIT = new Set(['WALLET_FUNDING', 'PAYOUT', 'REFUND', 'REVERSAL'])

const TX_META: Record<string, { label: string; icon: string; bg: string; color: string; badge: string; badgeCls: string }> = {
  WALLET_FUNDING: { label: 'Wallet Funding',      icon: '↓', bg: '#F0FDF4', color: '#16A34A', badge: 'Funding',      badgeCls: 'bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200' },
  PAYOUT:         { label: 'Payout received',      icon: '↓', bg: '#F0FDF4', color: '#16A34A', badge: 'Payout',       badgeCls: 'bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200' },
  REFUND:         { label: 'Refund',               icon: '↓', bg: '#F0FDF4', color: '#16A34A', badge: 'Funding',      badgeCls: 'bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200' },
  REVERSAL:       { label: 'Reversal',             icon: '↺', bg: '#FFFBEB', color: '#D97706', badge: 'Reversal',     badgeCls: 'bg-amber-50 text-amber-700 ring-1 ring-amber-200' },
  CONTRIBUTION:   { label: 'Group Contribution',   icon: '👥', bg: '#EFF6FF', color: '#2563EB', badge: 'Contribution', badgeCls: 'bg-blue-50 text-blue-700 ring-1 ring-blue-200' },
  WITHDRAWAL:     { label: 'Withdrawal to Bank',   icon: '↑', bg: '#FFF7ED', color: '#EA580C', badge: 'Withdrawal',   badgeCls: 'bg-orange-50 text-orange-600 ring-1 ring-orange-200' },
  PENALTY:        { label: 'Penalty',              icon: '⚠', bg: '#FEF2F2', color: '#DC2626', badge: 'Penalty',      badgeCls: 'bg-red-50 text-red-600 ring-1 ring-red-200' },
}

// ── Receipt modal ──────────────────────────────────────────────
function ReceiptModal({ tx, onClose }: { tx: Transaction | null; onClose: () => void }) {
  if (!tx) return null
  const isCredit = TX_CREDIT.has(tx.type)
  const meta = (tx as any).metadata || {}
  const maskAcc = (a: string) => a ? a.slice(0,3) + '****' + a.slice(-3) : '—'
  // FIX: this used to read `meta.fee`, which never existed — the combined
  // fee (platform fee + Paystack transfer fee) is stored on the
  // transaction's own top-level `fee` column, not inside metadata. That's
  // why the receipt always showed ₦0 regardless of the real fee charged.
  const feeVal = tx.fee ? Number(tx.fee) : 0
  const rows = [
    { label: 'Transaction ID', val: tx.id },
    { label: 'Reference',      val: tx.reference || '—' },
    { label: 'Type',           val: tx.type.replace(/_/g,' ') },
    { label: 'Amount',         val: `${isCredit ? '+' : '-'}₦${tx.amount.toLocaleString()}` },
    { label: 'Status',         val: tx.status },
    { label: 'Date & time',    val: dayjs(tx.createdAt).format('MMM D, YYYY h:mm A') },
    ...(tx.type === 'WITHDRAWAL' ? [
      // FIX: `meta.bankName` never existed before — only `bankCode` was ever
      // sent/stored, so this always fell back to '—'. The bank's display
      // name is now sent from the withdraw form and stored in metadata.
      { label: 'Bank',           val: meta.bankName || '—' },
      { label: 'Account number', val: meta.accountNumber ? maskAcc(meta.accountNumber) : '—' },
      { label: 'Recipient',      val: meta.accountName || '—' },
      { label: 'Fee',            val: feeVal ? `₦${feeVal.toLocaleString()}` : '₦0' },
    ] : []),
  ]
  return (
    <Modal open={!!tx} onClose={onClose} title="Receipt" size="sm" footer={<Button onClick={onClose}>Close</Button>}>
      <div className="space-y-3">
        <div className="text-center py-4">
          <div className={`w-12 h-12 rounded-2xl mx-auto flex items-center justify-center text-[20px] mb-3 ${tx.status === 'COMPLETED' ? 'bg-emerald-50' : tx.status === 'FAILED' ? 'bg-red-50' : 'bg-amber-50'}`}>
            {tx.status === 'COMPLETED' ? '✓' : tx.status === 'FAILED' ? '✕' : '⏳'}
          </div>
          <p className="text-[24px] font-semibold text-gray-900 tabular-nums">{isCredit ? '+' : '-'}₦{tx.amount.toLocaleString()}</p>
        </div>
        <div className="bg-gray-50 rounded-xl p-4 space-y-2.5">
          {rows.map(r => (
            <div key={r.label} className="flex justify-between gap-4">
              <span className="text-[12px] text-gray-400 flex-shrink-0">{r.label}</span>
              <span className="text-[12px] font-medium text-gray-900 text-right break-all">{r.val}</span>
            </div>
          ))}
        </div>
      </div>
    </Modal>
  )
}

// ── Transaction row ────────────────────────────────────────────
function TxRow({ tx, onClick }: { tx: Transaction; onClick: () => void }) {
  const isCredit = TX_CREDIT.has(tx.type)
  const meta = (tx as any).metadata || {}
  const m = TX_META[tx.type] || { label: tx.type.replace(/_/g,' '), icon: '·', bg: '#F9FAFB', color: '#6B7280', badge: tx.type, badgeCls: 'bg-gray-100 text-gray-500' }
  const maskAcc = (a: string) => a ? a.slice(0,3) + '****' + a.slice(-3) : null

  const sub = tx.type === 'WITHDRAWAL' && meta.bankName
    ? `${meta.bankName}${meta.accountNumber ? ' • ' + maskAcc(meta.accountNumber) : ''} • ${dayjs(tx.createdAt).format('MMM D, YYYY')}`
    : `${tx.type === 'CONTRIBUTION' && meta.groupName ? `Group: ${meta.groupName} • ` : ''}${dayjs(tx.createdAt).format('MMM D, YYYY • h:mm A')}`

  return (
    <div onClick={onClick}
      className="flex items-center gap-3 py-3.5 border-b border-gray-50 last:border-0 hover:bg-gray-50/60 -mx-4 sm:-mx-6 px-4 sm:px-6 transition-colors cursor-pointer">
      <div className="w-9 h-9 sm:w-10 sm:h-10 rounded-full flex items-center justify-center text-[14px] sm:text-[16px] font-bold flex-shrink-0"
        style={{ background: m.bg, color: m.color }}>
        {m.icon}
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-[13px] sm:text-[14px] font-semibold text-gray-900 truncate">{m.label}</p>
        <p className="text-[11px] text-gray-400 mt-0.5 truncate">{sub}</p>
      </div>
      <span className={`hidden md:inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-semibold flex-shrink-0 ${m.badgeCls}`}>
        {m.badge}
      </span>
      <div className="text-right flex-shrink-0">
        <p className={`text-[13px] sm:text-[14px] font-bold tabular-nums ${isCredit ? 'text-emerald-600' : 'text-gray-900'}`}>
          {isCredit ? '+' : '-'}₦{tx.amount.toLocaleString()}
        </p>
        <p className={`text-[10px] sm:text-[11px] font-medium mt-0.5 ${tx.status === 'COMPLETED' ? 'text-emerald-600' : tx.status === 'FAILED' ? 'text-red-500' : 'text-amber-600'}`}>
          {tx.status === 'COMPLETED' ? 'Successful' : tx.status.charAt(0) + tx.status.slice(1).toLowerCase()}
        </p>
      </div>
    </div>
  )
}

// ── Payment verify hook ────────────────────────────────────────
function usePaymentVerify() {
  const [searchParams] = useSearchParams()
  const navigate = useNavigate()
  const { showToast } = useUIStore()
  const [verifying, setVerifying] = useState(false)
  const verifyCalledRef = useRef(false)
  useEffect(() => {
    const reference = searchParams.get('reference') || searchParams.get('trxref')
    if (!reference || verifyCalledRef.current) return
    verifyCalledRef.current = true
    setVerifying(true)
    paymentsApi.verify(reference, 'paystack')
      .then(() => { showToast('Payment verified — wallet funded!', 'success'); navigate('/wallet', { replace: true }) })
      .catch(() => { showToast('Verification failed. Contact support if funds were deducted.', 'error'); navigate('/wallet', { replace: true }) })
      .finally(() => setVerifying(false))
  }, [searchParams])
  return { verifying }
}

// ── Set PIN modal ──────────────────────────────────────────────
function SetPinModal({ open, onClose, onSuccess }: { open: boolean; onClose: () => void; onSuccess: () => void }) {
  const { showToast } = useUIStore()
  const { setUser, user } = useAuthStore()
  const [loading, setLoading] = useState(false)
  const { register, handleSubmit, formState: { errors }, reset } = useForm<SetPinData>({ resolver: zodResolver(setPinSchema) })
  const onSubmit = async (data: SetPinData) => {
    setLoading(true)
    try { await authApi.setTransactionPin(data.pin); showToast('Transaction PIN set', 'success'); if (user) setUser({ ...user, hasTransactionPin: true }); reset(); onSuccess(); onClose() }
    catch (err: any) { showToast(err?.response?.data?.message || 'Failed to set PIN', 'error') }
    finally { setLoading(false) }
  }
  return (
    <Modal open={open} onClose={onClose} title="Set transaction PIN" size="sm"
      footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button onClick={handleSubmit(onSubmit)} loading={loading}>Set PIN</Button></>}>
      <div className="space-y-4">
        <div className="bg-amber-50 border border-amber-100 rounded-xl p-4">
          <p className="text-[13px] font-semibold text-amber-800">Required for all payments</p>
          <p className="text-[12px] text-amber-600 mt-1">You'll enter this 4-digit PIN every time you make a contribution or withdrawal.</p>
        </div>
        <Input label="4-digit PIN" type="password" maxLength={4} placeholder="••••" error={errors.pin?.message} {...register('pin')}/>
        <Input label="Confirm PIN" type="password" maxLength={4} placeholder="••••" error={errors.confirmPin?.message} {...register('confirmPin')}/>
      </div>
    </Modal>
  )
}

// ── Change PIN modal ───────────────────────────────────────────
// FIX: this used to send an email via authApi.forgotPassword() and asked the
// user to paste an "OTP" — but that endpoint actually sends a password-reset
// LINK, not a code, so the flow was broken from step one (there was never
// a code to enter).
//
// New 3-step flow:
//   1. Password  — confirm identity via authApi.verifyPassword()
//   2. OTP       — backend emails a real one-time code via
//                  authApi.sendPinChangeOtp() (fired automatically once
//                  step 1 succeeds)
//   3. New PIN   — user enters the OTP + new PIN together, submitted via
//                  authApi.changePinWithOtp({ otp, newPin })
type ChangePinStep = 'password' | 'otp'

function ChangePinModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { showToast } = useUIStore()
  const { user } = useAuthStore()
  const [step, setStep]           = useState<ChangePinStep>('password')
  const [loading, setLoading]     = useState(false)
  const [verifying, setVerifying] = useState(false)
  const [sendingOtp, setSendingOtp] = useState(false)
  const [resending, setResending] = useState(false)
  const [password, setPassword]   = useState('')
  const [passwordError, setPasswordError] = useState('')

  const { register, handleSubmit, formState: { errors }, reset } = useForm<ChangePinData>({ resolver: zodResolver(changePinSchema) })

  const sendOtp = async () => {
    setSendingOtp(true)
    try {
      await authApi.sendPinChangeOtp()
      setStep('otp')
      showToast(`Code sent to ${user?.email}`, 'success')
    } catch (err: any) {
      showToast(err?.response?.data?.message || 'Could not send code', 'error')
    } finally {
      setSendingOtp(false)
    }
  }

  const verifyPassword = async () => {
    if (!password) { setPasswordError('Enter your password'); return }
    setVerifying(true)
    setPasswordError('')
    try {
      await authApi.verifyPassword(password)
      await sendOtp()
    } catch (err: any) {
      setPasswordError(err?.response?.data?.message || 'Incorrect password')
    } finally {
      setVerifying(false)
    }
  }

  const resendOtp = async () => {
    setResending(true)
    try {
      await authApi.sendPinChangeOtp()
      showToast(`Code resent to ${user?.email}`, 'success')
    } catch (err: any) {
      showToast(err?.response?.data?.message || 'Could not resend code', 'error')
    } finally {
      setResending(false)
    }
  }

  const onSubmit = async (data: ChangePinData) => {
    setLoading(true)
    try {
      await authApi.changePinWithOtp({ otp: data.otp, newPin: data.newPin })
      showToast('PIN changed', 'success')
      handleClose()
    } catch (err: any) {
      showToast(err?.response?.data?.message || 'Failed', 'error')
    } finally {
      setLoading(false)
    }
  }

  const handleClose = () => { reset(); setStep('password'); setPassword(''); setPasswordError(''); onClose() }

  return (
    <Modal open={open} onClose={handleClose} title="Change transaction PIN" size="sm"
      footer={<>
        <Button variant="secondary" onClick={handleClose}>Cancel</Button>
        {step === 'password'
          ? <Button onClick={verifyPassword} loading={verifying || sendingOtp}>Continue</Button>
          : <Button onClick={handleSubmit(onSubmit)} loading={loading}>Change PIN</Button>}
      </>}>
      <div className="space-y-4">
        {step === 'password' ? (
          <>
            <div className="bg-gray-50 border border-gray-100 rounded-xl p-4">
              <p className="text-[13px] font-semibold text-gray-900">Security check required</p>
              <p className="text-[12px] text-gray-500 mt-1">Enter your account password. We'll then email you a one-time code to confirm the change.</p>
            </div>
            <Input
              label="Password"
              type="password"
              placeholder="••••••••"
              value={password}
              onChange={e => setPassword(e.target.value)}
              error={passwordError}
              onKeyDown={e => { if (e.key === 'Enter') verifyPassword() }}
            />
          </>
        ) : (
          <>
            <div className="bg-gray-50 border border-gray-100 rounded-xl p-4">
              <p className="text-[13px] font-semibold text-gray-900">Enter the code we emailed you</p>
              <p className="text-[12px] text-gray-500 mt-1">Sent to <strong>{user?.email}</strong>. Didn't get it?{' '}
                <button type="button" onClick={resendOtp} disabled={resending} className="font-semibold text-gray-900 hover:text-gray-600 disabled:opacity-50">
                  {resending ? 'Resending…' : 'Resend'}
                </button>
              </p>
            </div>
            <Input label="OTP code" placeholder="Enter code from email" error={errors.otp?.message} {...register('otp')}/>
            <Input label="New 4-digit PIN" type="password" maxLength={4} placeholder="••••" error={errors.newPin?.message} {...register('newPin')}/>
            <Input label="Confirm new PIN" type="password" maxLength={4} placeholder="••••" error={errors.confirmPin?.message} {...register('confirmPin')}/>
          </>
        )}
      </div>
    </Modal>
  )
}

// ── Withdraw modal ─────────────────────────────────────────────
// Manual bank selection, like the original flow: pick a bank, type the
// account number, one verify call fires once both are present. Kept
// deliberately simple (no auto-detect) since Paystack test mode caps
// real bank resolves at 3/day — auto-detect burned through that in a
// single keystroke by checking several banks in parallel. Two fixes
// from that experiment are kept here since they're unrelated to
// auto-detect: sending bankName so receipts/rows show a real bank
// name, and debouncing the fee calculation so a fast-typed amount
// can't get overwritten by a stale, slower response.
function WithdrawModal({ open, onClose, onSuccess }: { open: boolean; onClose: () => void; onSuccess: () => void }) {
  const { showToast } = useUIStore()
  const [banks, setBanks]               = useState<{ name: string; code: string }[]>([])
  const [verifying, setVerifying]       = useState(false)
  const [verifiedName, setVerifiedName] = useState('')
  const [fees, setFees]                 = useState<any>(null)
  const [submitting, setSubmitting]     = useState(false)
  const [step, setStep]                 = useState<'form' | 'confirm'>('form')
  const { register, handleSubmit, watch, setValue, formState: { errors }, reset } = useForm<WithdrawData>({ resolver: zodResolver(withdrawSchema) })
  const accountNumber = watch('accountNumber')
  const bankCode      = watch('bankCode')
  const amount        = watch('amount')

  useEffect(() => {
    if (!open) return
    paymentsApi.getBanks()
      .then(res => {
        const data = (res as any).data
        const list = Array.isArray(data) ? data : Array.isArray(data?.data) ? data.data : []
        setBanks(list.map((b: any) => ({ name: b.name, code: String(b.code) })))
      })
      .catch(() => showToast('Could not load banks', 'error'))
  }, [open])

  useEffect(() => {
    if (accountNumber?.length !== 10 || !bankCode) { setVerifiedName(''); return }
    setVerifying(true); setVerifiedName('')
    paymentsApi.verifyAccount(accountNumber, bankCode)
      .then(res => {
        const name = (res as any).data?.accountName ?? (res as any).data?.data?.accountName ?? ''
        if (name) { setVerifiedName(name); setValue('accountName', name) }
      })
      .catch(() => {})
      .finally(() => setVerifying(false))
  }, [accountNumber, bankCode])

  // FIX: previously fired one request per keystroke with no ordering
  // guard — typing 20000 → 200000 quickly meant the 20000 response
  // could resolve AFTER the 200000 one and silently overwrite it,
  // showing stale fee numbers. Now debounced, and a token discards
  // any response that isn't for the latest amount.
  const feesTokenRef = useRef(0)
  useEffect(() => {
    if (!amount || amount < 500) { setFees(null); return }
    const token = ++feesTokenRef.current
    const handle = setTimeout(() => {
      paymentsApi.getWithdrawalFees(amount)
        .then(res => {
          if (feesTokenRef.current !== token) return
          const d = (res as any).data
          setFees(d?.breakdown ? d : d?.data ?? null)
        })
        .catch(() => { if (feesTokenRef.current === token) setFees(null) })
    }, 350)
    return () => clearTimeout(handle)
  }, [amount])

  const handleClose = () => { reset(); setVerifiedName(''); setFees(null); setStep('form'); onClose() }
  const onSubmit = async (data: WithdrawData) => {
    if (step === 'form') { setStep('confirm'); return }
    setSubmitting(true)
    try {
      // FIX: the request never included the bank's display name — only
      // bankCode — so nothing was ever available for receipts/rows to show
      // as "Bank". The name is already sitting in local `banks` state from
      // the dropdown; just attach it before sending.
      const bankName = banks.find(b => b.code === data.bankCode)?.name
      await paymentsApi.withdraw({ ...data, bankName })
      showToast('Withdrawal initiated — funds on the way', 'success')
      handleClose()
      onSuccess()
    } catch (e: any) {
      showToast(e?.response?.data?.message || 'Withdrawal failed', 'error')
      setStep('form')
    } finally {
      setSubmitting(false)
    }
  }
  return (
    <Modal open={open} onClose={handleClose} title={step === 'confirm' ? 'Confirm withdrawal' : 'Withdraw funds'} size="sm"
      footer={<><Button variant="secondary" onClick={step === 'confirm' ? () => setStep('form') : handleClose}>{step === 'confirm' ? 'Back' : 'Cancel'}</Button><Button onClick={handleSubmit(onSubmit)} loading={submitting} disabled={verifying}>{step === 'confirm' ? 'Confirm withdrawal' : 'Continue'}</Button></>}>
      {step === 'form' ? (
        <div className="space-y-4">
          <Input label="Amount (₦)" type="number" placeholder="5000" error={errors.amount?.message} {...register('amount')}/>
          {fees && <div className="bg-gray-50 rounded-xl p-3.5 space-y-1.5">{fees.breakdown?.map((b: any) => <div key={b.label} className="flex justify-between text-[12px]"><span className="text-gray-400">{b.label}</span><span className={`font-medium tabular-nums ${b.amount < 0 ? 'text-red-500' : 'text-gray-900'}`}>{b.amount < 0 ? '-' : ''}₦{Math.abs(b.amount).toLocaleString()}</span></div>)}</div>}
          <Select label="Bank" placeholder="Select a bank…" options={banks.map(b => ({ value: String(b.code), label: b.name }))} error={errors.bankCode?.message} {...register('bankCode')}/>
          <div>
            <Input label="Account number" type="text" maxLength={10} placeholder="0123456789" error={errors.accountNumber?.message} {...register('accountNumber')}/>
            {verifying && <p className="text-[12px] text-gray-400 mt-1 flex items-center gap-1.5"><span className="w-3 h-3 rounded-full border border-gray-300 border-t-transparent animate-spin inline-block"/>Verifying…</p>}
            {verifiedName && !verifying && <p className="text-[12px] text-emerald-600 font-semibold mt-1">✓ {verifiedName}</p>}
          </div>
          <Input label="Account name" placeholder="e.g. John Doe" error={errors.accountName?.message} {...register('accountName')}/>
        </div>
      ) : (
        <div className="space-y-4">
          <div className="bg-gray-50 rounded-xl p-4 space-y-2.5">
            {[
              { label:'Account name',   val: verifiedName || watch('accountName') },
              { label:'Account number', val: watch('accountNumber') },
              { label:'Bank',           val: banks.find(b => b.code === watch('bankCode'))?.name || '—' },
              { label:'Amount',         val:`₦${Number(watch('amount')).toLocaleString()}` },
              { label:'You receive',    val: fees ? `₦${fees.youWillReceive?.toLocaleString()}` : '—' },
              { label:'Fee',            val: fees?.fee ? `₦${Number(fees.fee).toLocaleString()}` : '₦0' },
            ].map(r => <div key={r.label} className="flex justify-between text-[13px]"><span className="text-gray-400">{r.label}</span><span className="font-semibold text-gray-900">{r.val}</span></div>)}
          </div>
          <p className="text-[12px] text-gray-400">Funds typically arrive within 5 minutes. This cannot be undone.</p>
        </div>
      )}
    </Modal>
  )
}


// ── Outstanding debts ──────────────────────────────────────────
// Shows any debt created after a missed contribution + expired grace
// period (see GraceService.handleExpiredGrace / KycService.createDebt).
// Lets the user pay it off directly from their wallet balance via
// POST /kyc/debts/:debtId/settle — this was the only piece missing;
// the backend logic already existed but nothing surfaced it anywhere.
function DebtsSection({ onSettled }: { onSettled: () => void }) {
  const { showToast } = useUIStore()
  const [debts, setDebts]         = useState<any[] | null>(null)
  const [loading, setLoading]     = useState(true)
  const [settlingId, setSettlingId] = useState<string | null>(null)

  const loadDebts = () => {
    setLoading(true)
    kycApi.getDebts()
      .then(res => setDebts((res.data as any)?.data || res.data || []))
      .catch(() => setDebts([]))
      .finally(() => setLoading(false))
  }

  useEffect(() => { loadDebts() }, [])

  const outstanding = (debts || []).filter(d => d.status === 'OUTSTANDING')

  const handleSettle = async (debtId: string) => {
    setSettlingId(debtId)
    try {
      await kycApi.settleDebt(debtId)
      showToast('Debt settled ✅', 'success')
      loadDebts()
      onSettled()
    } catch (err: any) {
      showToast(err?.response?.data?.message || 'Could not settle this debt', 'error')
    } finally {
      setSettlingId(null)
    }
  }

  if (loading) return null
  if (outstanding.length === 0) return null

  const totalOwed = outstanding.reduce((s, d) => s + Number(d.totalOwed), 0)

  return (
    <motion.div className="bg-red-50 border border-red-200 rounded-2xl overflow-hidden"
      initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }}>
      <div className="px-4 sm:px-5 py-4 flex items-start gap-3">
        <div className="w-9 h-9 rounded-xl bg-red-100 flex items-center justify-center flex-shrink-0">
          <svg className="w-5 h-5 text-red-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 9v2m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"/>
          </svg>
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-[13px] sm:text-[14px] font-bold text-red-800">
            You have an outstanding debt — ₦{totalOwed.toLocaleString()}
          </p>
          <p className="text-[12px] text-red-600 mt-0.5">
            This must be settled before you can join or create another group.
          </p>
        </div>
      </div>
      <div className="border-t border-red-100 divide-y divide-red-100">
        {outstanding.map(d => (
          <div key={d.id} className="px-4 sm:px-5 py-3.5 flex items-center justify-between gap-3 flex-wrap">
            <div className="min-w-0">
              <p className="text-[12.5px] font-semibold text-red-800">{d.description || 'Missed contribution'}</p>
              <p className="text-[11px] text-red-500 mt-0.5">
                ₦{Number(d.amount).toLocaleString()} owed + ₦{Number(d.lateFee).toLocaleString()} late fee
                {d.createdAt ? ` · ${dayjs(d.createdAt).format('MMM D, YYYY')}` : ''}
              </p>
            </div>
            <div className="flex items-center gap-3 flex-shrink-0">
              <p className="text-[14px] font-bold text-red-800 tabular-nums">₦{Number(d.totalOwed).toLocaleString()}</p>
              <button
                onClick={() => handleSettle(d.id)}
                disabled={settlingId === d.id}
                className="h-8 px-3.5 rounded-lg bg-red-600 text-white text-[12px] font-semibold hover:bg-red-700 disabled:opacity-60 transition-colors"
              >
                {settlingId === d.id ? 'Paying…' : 'Pay from wallet'}
              </button>
            </div>
          </div>
        ))}
      </div>
    </motion.div>
  )
}

// ── Main page ──────────────────────────────────────────────────
const PAGE_SIZE = 15
const ALL_SIZE  = 500 // effectively "no limit" for a single wallet's history

export default function WalletPage() {
  const [fundOpen,      setFundOpen]      = useState(false)
  const [withdrawOpen,  setWithdrawOpen]  = useState(false)
  const [setPinOpen,    setSetPinOpen]    = useState(false)
  const [changePinOpen, setChangePinOpen] = useState(false)
  const [txType,        setTxType]        = useState('')
  const [typeOpen,      setTypeOpen]      = useState(false)
  const [page,          setPage]          = useState(1)
  const [showAll,       setShowAll]       = useState(false)
  const [receiptTx,     setReceiptTx]     = useState<Transaction | null>(null)

  const { verifying }     = usePaymentVerify()
  const { user }          = useAuthStore()
  const { data: wallet, isLoading: walletLoading, refetch: refetchWallet } = useWallet()
  const { data: txData,  isLoading: txLoading } = useWalletTransactions({
    page:  showAll ? 1 : page,
    limit: showAll ? ALL_SIZE : PAGE_SIZE,
    type:  txType || undefined,
  })
  const initPayment = useInitiatePayment()

  const { register, handleSubmit, formState: { errors }, reset } = useForm<FundData>({
    resolver: zodResolver(fundSchema),
    defaultValues: { provider: 'paystack' },
  })

  useEffect(() => { if (!verifying) refetchWallet() }, [verifying])

  const onFund = async (data: FundData) => {
    await initPayment.mutateAsync({ ...data, purpose: 'wallet_funding' })
    setFundOpen(false); reset()
  }

  const transactions: Transaction[] = (txData as any)?.transactions || []
  const pagination = (txData as any)?.pagination
  const w = wallet as any
  const hasPin = user?.hasTransactionPin

  const totalFunded: number =
    w?.totalFunded ?? w?.totalDeposited ??
    transactions
      .filter((tx: Transaction) => tx.type === 'WALLET_FUNDING' && tx.status === 'COMPLETED')
      .reduce((s: number, tx: Transaction) => s + tx.amount, 0)

  const TX_TYPE_LABELS: Record<string, string> = {
    '': 'All types',
    WALLET_FUNDING: 'Funding',
    CONTRIBUTION:   'Contributions',
    PAYOUT:         'Payouts',
    WITHDRAWAL:     'Withdrawals',
  }

  return (
    <DashboardLayout title="Wallet" subtitle="Manage your funds securely">
      <div className="bg-[#F8F9FB] min-h-screen">
        <div className="w-full max-w-4xl mx-auto px-4 sm:px-6 py-5 sm:py-8 space-y-4 sm:space-y-6">

          {/* ── Outstanding debts — shown first, above everything else ── */}
          <DebtsSection onSettled={() => refetchWallet()}/>

          {/* ── Verifying banner ── */}
          <AnimatePresence>
            {verifying && (
              <motion.div className="bg-white border border-gray-100 rounded-2xl p-4 flex items-center gap-3 shadow-sm"
                initial={{ opacity:0, y:-8 }} animate={{ opacity:1, y:0 }} exit={{ opacity:0, y:-8 }}>
                <div className="w-5 h-5 rounded-full border-2 border-emerald-500 border-t-transparent animate-spin flex-shrink-0"/>
                <p className="text-[13px] font-medium text-gray-900">Verifying your payment…</p>
              </motion.div>
            )}
          </AnimatePresence>

          {/* ── PIN banner ── */}
          {!hasPin && (
            <motion.div className="bg-amber-50 border border-amber-200 rounded-2xl p-4 flex items-center justify-between gap-3 flex-wrap"
              initial={{ opacity:0, y:-8 }} animate={{ opacity:1, y:0 }}>
              <div>
                <p className="text-[13px] font-semibold text-amber-800">Set your transaction PIN</p>
                <p className="text-[12px] text-amber-600 mt-0.5">Required for contributions and withdrawals.</p>
              </div>
              <button onClick={() => setSetPinOpen(true)}
                className="h-8 px-4 rounded-lg bg-amber-600 text-white text-[12px] font-semibold hover:bg-amber-700 transition-colors flex-shrink-0">
                Set PIN
              </button>
            </motion.div>
          )}

          {/* ── Hero balance card ── */}
          {walletLoading ? (
            <Skeleton className="h-44 sm:h-52 w-full rounded-3xl"/>
          ) : (
            <motion.div
              className="relative rounded-3xl overflow-hidden min-h-[180px] sm:min-h-[220px]"
              style={{ background: 'linear-gradient(135deg, #0a0a0a 0%, #111827 60%, #0f1f0f 100%)' }}
              initial={{ opacity:0, y:12 }} animate={{ opacity:1, y:0 }}
              transition={{ duration:0.4, ease:[0.16,1,0.3,1] }}>

              {/* Illustration — hidden on small screens */}
              <div className="hidden sm:block absolute right-0 top-0 bottom-0 w-48 md:w-56 pointer-events-none select-none overflow-hidden">
                <img
                  src="https://res.cloudinary.com/dmjakrnby/image/upload/v1785357030/real_logo_s3jtjp.png"
                  alt="wallet illustration"
                  className="h-full w-full object-contain object-bottom"
                  style={{ filter: 'drop-shadow(0 20px 40px rgba(0,0,0,0.5))' }}
                />
              </div>

              {/* Decorative dots — desktop only */}
              <div className="hidden sm:block absolute top-5 right-48 w-2 h-2 rounded-full bg-emerald-500/40"/>
              <div className="hidden sm:block absolute top-10 right-36 w-1.5 h-1.5 rounded-full bg-emerald-400/30"/>
              <div className="hidden sm:block absolute bottom-8 right-52 w-3 h-3 rounded-full bg-emerald-500/20"/>

              {/* Content */}
              <div className="relative z-10 p-5 sm:p-7 sm:pr-52 md:pr-60">
                <p className="text-[10px] sm:text-[11px] font-semibold text-white/40 uppercase tracking-[0.12em] mb-2">
                  Available Balance
                </p>
                <p className="text-[32px] sm:text-[44px] font-bold text-white tracking-tight leading-none tabular-nums mb-3 sm:mb-4">
                  ₦{(w?.balance ?? 0).toLocaleString()}
                </p>
                {(w?.lockedBalance || 0) > 0 && (
                  <p className="text-[11px] text-white/30 mb-2">₦{(w?.lockedBalance || 0).toLocaleString()} pending</p>
                )}
                <div className="flex items-center gap-2 mb-4 sm:mb-5">
                  <div className="w-2 h-2 rounded-full bg-emerald-400"/>
                  <span className="text-[11px] sm:text-[12px] font-medium text-emerald-400">Wallet is active</span>
                </div>
                <div className="flex items-center gap-2 sm:gap-3 flex-wrap">
                  <button onClick={() => setFundOpen(true)}
                    className="inline-flex items-center gap-2 h-9 sm:h-11 px-4 sm:px-5 rounded-xl font-semibold text-[13px] sm:text-[14px] text-white transition-all hover:opacity-90 active:scale-95"
                    style={{ background: '#16A34A', boxShadow: '0 4px 20px rgba(22,163,74,0.4)' }}>
                    <svg className="w-3.5 h-3.5 sm:w-4 sm:h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M19 9l-7 7-7-7"/>
                    </svg>
                    Fund wallet
                  </button>
                  <button onClick={() => setWithdrawOpen(true)}
                    className="inline-flex items-center gap-2 h-9 sm:h-11 px-4 sm:px-5 rounded-xl font-semibold text-[13px] sm:text-[14px] text-white transition-all hover:bg-white/10 active:scale-95 border border-white/10"
                    style={{ background: 'rgba(255,255,255,0.06)' }}>
                    <svg className="w-3.5 h-3.5 sm:w-4 sm:h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 15l7-7 7 7"/>
                    </svg>
                    Withdraw
                  </button>
                </div>
              </div>
            </motion.div>
          )}

          {/* ── Stats cards ── */}
          {!walletLoading && (
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 sm:gap-4">
              {/* Total funded */}
              <div className="bg-white rounded-2xl border border-gray-100 p-4 sm:p-5 shadow-sm flex items-center gap-3 sm:gap-4">
                <div className="w-10 h-10 sm:w-12 sm:h-12 rounded-xl bg-emerald-50 flex items-center justify-center flex-shrink-0">
                  <svg className="w-5 h-5 sm:w-6 sm:h-6 text-emerald-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M3 10h18M7 15h1m4 0h1m-7 4h12a3 3 0 003-3V8a3 3 0 00-3-3H6a3 3 0 00-3 3v8a3 3 0 003 3z"/>
                  </svg>
                </div>
                <div className="min-w-0">
                  <p className="text-[10px] sm:text-[11px] font-semibold text-gray-400 uppercase tracking-wider">Total Funded</p>
                  <p className="text-[16px] sm:text-[20px] font-bold text-gray-900 tracking-tight mt-0.5 truncate">₦{totalFunded.toLocaleString()}</p>
                  <p className="text-[10px] sm:text-[11px] text-emerald-600 font-semibold mt-0.5">↑ 0% this month</p>
                </div>
              </div>

              {/* Currency */}
              <div className="bg-white rounded-2xl border border-gray-100 p-4 sm:p-5 shadow-sm flex items-center gap-3 sm:gap-4">
                <div className="w-10 h-10 sm:w-12 sm:h-12 rounded-xl bg-blue-50 flex items-center justify-center flex-shrink-0">
                  <svg className="w-5 h-5 sm:w-6 sm:h-6 text-blue-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M3.055 11H5a2 2 0 012 2v1a2 2 0 002 2 2 2 0 012 2v2.945M8 3.935V5.5A2.5 2.5 0 0010.5 8h.5a2 2 0 012 2 2 2 0 104 0 2 2 0 012-2h1.064M15 20.488V18a2 2 0 012-2h3.064"/>
                  </svg>
                </div>
                <div>
                  <p className="text-[10px] sm:text-[11px] font-semibold text-gray-400 uppercase tracking-wider">Currency</p>
                  <p className="text-[16px] sm:text-[20px] font-bold text-gray-900 tracking-tight mt-0.5">{w?.currency || 'NGN'}</p>
                  <p className="text-[10px] sm:text-[11px] text-gray-400 mt-0.5">Nigerian Naira</p>
                </div>
              </div>

              {/* Status */}
              <div className="bg-white rounded-2xl border border-gray-100 p-4 sm:p-5 shadow-sm flex items-center gap-3 sm:gap-4">
                <div className="w-10 h-10 sm:w-12 sm:h-12 rounded-xl bg-violet-50 flex items-center justify-center flex-shrink-0">
                  <svg className="w-5 h-5 sm:w-6 sm:h-6 text-violet-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z"/>
                  </svg>
                </div>
                <div>
                  <p className="text-[10px] sm:text-[11px] font-semibold text-gray-400 uppercase tracking-wider">Status</p>
                  <p className="text-[16px] sm:text-[20px] font-bold text-gray-900 tracking-tight mt-0.5">{w?.isActive ? 'Active' : 'Inactive'}</p>
                  <p className="text-[10px] sm:text-[11px] text-gray-400 mt-0.5">Your wallet is active</p>
                </div>
              </div>
            </div>
          )}

          {/* ── Security ── */}
          <div className="bg-white rounded-2xl border border-gray-100 p-4 sm:p-5 shadow-sm">
            <div className="flex items-center gap-3 sm:gap-4">
              <div className="w-10 h-10 sm:w-12 sm:h-12 rounded-xl bg-gray-50 flex items-center justify-center flex-shrink-0">
                <svg className="w-5 h-5 sm:w-6 sm:h-6 text-gray-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z"/>
                </svg>
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-[13px] sm:text-[15px] font-bold text-gray-900">Security</p>
                <p className="text-[12px] sm:text-[13px] font-semibold text-gray-600 mt-0.5">Transaction PIN</p>
                <p className="text-[11px] sm:text-[12px] text-gray-400 truncate">
                  {hasPin ? 'PIN is set — required for all payments' : 'No PIN set yet — required for payments'}
                </p>
              </div>
              <button
                onClick={() => hasPin ? setChangePinOpen(true) : setSetPinOpen(true)}
                className="flex items-center gap-1 sm:gap-1.5 text-[12px] sm:text-[13px] font-semibold text-gray-900 hover:text-gray-600 transition-colors flex-shrink-0">
                <span className="hidden sm:inline">{hasPin ? 'Manage PIN' : 'Set PIN'}</span>
                <span className="sm:hidden">{hasPin ? 'Manage' : 'Set'}</span>
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7"/>
                </svg>
              </button>
            </div>
          </div>

          {/* ── Transactions ── */}
          <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
            <div className="px-4 sm:px-6 py-4 sm:py-5 border-b border-gray-50 flex items-center justify-between gap-3">
              <div className="min-w-0">
                <p className="text-[14px] sm:text-[16px] font-bold text-gray-900">Transactions</p>
                <p className="text-[11px] sm:text-[12px] text-gray-400 mt-0.5 hidden sm:block">View all your wallet activity</p>
              </div>

              {/* Dropdown */}
              <div className="relative flex-shrink-0">
                <button onClick={() => setTypeOpen(v => !v)}
                  className="h-9 sm:h-10 pl-3 sm:pl-4 pr-2 sm:pr-3 rounded-xl border border-gray-200 bg-white text-[12px] sm:text-[13px] font-medium text-gray-700 flex items-center gap-1.5 sm:gap-2 hover:border-gray-300 transition-colors min-w-[100px] sm:min-w-[130px] justify-between">
                  <span className="truncate">{TX_TYPE_LABELS[txType] || 'All types'}</span>
                  <svg className="w-3.5 h-3.5 sm:w-4 sm:h-4 text-gray-400 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7"/>
                  </svg>
                </button>
                <AnimatePresence>
                  {typeOpen && (
                    <motion.div className="absolute right-0 top-11 sm:top-12 bg-white border border-gray-100 rounded-2xl shadow-xl z-20 overflow-hidden min-w-[160px] sm:min-w-[180px]"
                      initial={{ opacity:0, y:-8, scale:0.95 }} animate={{ opacity:1, y:0, scale:1 }} exit={{ opacity:0, y:-8, scale:0.95 }}
                      transition={{ duration:0.15 }}>
                      {Object.entries(TX_TYPE_LABELS).map(([val, label]) => (
                        <button key={val} onClick={() => { setTxType(val); setPage(1); setShowAll(false); setTypeOpen(false) }}
                          className={`w-full flex items-center justify-between px-4 py-3 text-[13px] font-medium hover:bg-gray-50 transition-colors ${txType === val ? 'text-emerald-600' : 'text-gray-700'}`}>
                          {label}
                          {txType === val && (
                            <svg className="w-4 h-4 text-emerald-600 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7"/>
                            </svg>
                          )}
                        </button>
                      ))}
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
            </div>

            <div className="px-4 sm:px-6">
              {txLoading ? (
                <div className="space-y-3 py-4">
                  {[...Array(5)].map((_,i) => <Skeleton key={i} className="h-14 sm:h-16 w-full rounded-xl"/>)}
                </div>
              ) : transactions.length === 0 ? (
                <div className="py-12 sm:py-16 text-center">
                  <p className="text-2xl mb-3">📄</p>
                  <p className="text-[14px] font-semibold text-gray-800">No transactions yet</p>
                  <p className="text-[12px] text-gray-400 mt-1">Fund your wallet to get started</p>
                </div>
              ) : (
                <>
                  {transactions.map(tx => <TxRow key={tx.id} tx={tx} onClick={() => setReceiptTx(tx)}/>)}

                  {/* Prev/Next pagination — only relevant when NOT showing everything */}
                  {!showAll && pagination && pagination.totalPages > 1 && (
                    <div className="py-4 border-t border-gray-50 flex items-center justify-between flex-wrap gap-2">
                      <p className="text-[11px] sm:text-[12px] text-gray-400">
                        Page {pagination.page} of {pagination.totalPages}
                      </p>
                      <div className="flex gap-2">
                        <button disabled={page === 1} onClick={() => setPage(p => p-1)}
                          className="h-8 px-3 rounded-lg border border-gray-200 text-[12px] font-semibold text-gray-600 hover:bg-gray-50 disabled:opacity-40 transition-colors">
                          Prev
                        </button>
                        <button disabled={page >= pagination.totalPages} onClick={() => setPage(p => p+1)}
                          className="h-8 px-3 rounded-lg border border-gray-200 text-[12px] font-semibold text-gray-600 hover:bg-gray-50 disabled:opacity-40 transition-colors">
                          Next
                        </button>
                      </div>
                    </div>
                  )}
                </>
              )}
            </div>

            {transactions.length > 0 && !txLoading && (
              <div className="px-4 sm:px-6 py-3 sm:py-4 border-t border-gray-50 text-center">
                {showAll ? (
                  <button
                    onClick={() => { setShowAll(false); setPage(1) }}
                    className="text-[12px] sm:text-[13px] font-semibold text-gray-500 hover:text-gray-700 transition-colors inline-flex items-center gap-1.5">
                    Show less
                  </button>
                ) : (
                  <button
                    onClick={() => setShowAll(true)}
                    className="text-[12px] sm:text-[13px] font-semibold text-emerald-600 hover:text-emerald-700 transition-colors inline-flex items-center gap-1.5">
                    View all transactions
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7"/>
                    </svg>
                  </button>
                )}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* ── Modals ── */}
      <Modal open={fundOpen} onClose={() => setFundOpen(false)} title="Fund your wallet" size="sm"
        footer={<><Button variant="secondary" onClick={() => setFundOpen(false)}>Cancel</Button><Button onClick={handleSubmit(onFund)} loading={initPayment.isPending}>Continue to payment</Button></>}>
        <p className="text-[13px] text-gray-500 mb-5">You'll be redirected to Paystack to complete payment. Funds reflect instantly.</p>
        <div className="space-y-4">
          <Input label="Amount (₦)" type="number" placeholder="10000" error={errors.amount?.message} {...register('amount')}/>
          <Select label="Payment provider" options={[{ value: 'paystack', label: 'Paystack — Cards, bank transfer, USSD' }]} error={errors.provider?.message} {...register('provider')}/>
        </div>
      </Modal>

      <WithdrawModal  open={withdrawOpen}  onClose={() => setWithdrawOpen(false)}  onSuccess={() => refetchWallet()}/>
      <SetPinModal    open={setPinOpen}    onClose={() => setSetPinOpen(false)}    onSuccess={() => refetchWallet()}/>
      <ChangePinModal open={changePinOpen} onClose={() => setChangePinOpen(false)}/>
      <ReceiptModal   tx={receiptTx}       onClose={() => setReceiptTx(null)}/>
    </DashboardLayout>
  )
}