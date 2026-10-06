import { useState, useEffect, useRef } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { motion, AnimatePresence } from 'framer-motion'
import { useSearchParams, useNavigate } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import DashboardLayout from '@/components/layout/DashboardLayout'
import { Button, Skeleton, Modal, Input, Select } from '@/components/ui'
import { useWallet, useWalletTransactions, useInitiatePayment } from '@/hooks/useApi'
import { paymentsApi, authApi, kycApi, walletApi, supportApi } from '@/api/services'
import api from '@/lib/api'
import { useUIStore } from '@/stores/uiStore'
import { useAuthStore } from '@/stores/authStore'
import type { Transaction } from '@/types'
import dayjs from 'dayjs'

const fundSchema = z.object({ amount: z.coerce.number().min(100, 'Minimum ₦100'), provider: z.enum(['paystack']) })
type FundData = z.infer<typeof fundSchema>

const setPinSchema = z.object({
  pin:        z.string().length(4, 'PIN must be 4 digits').regex(/^\d{4}$/, 'Digits only'),
  confirmPin: z.string().length(4, 'PIN must be 4 digits'),
}).refine(d => d.pin === d.confirmPin, { message: 'PINs do not match', path: ['confirmPin'] })
type SetPinData = z.infer<typeof setPinSchema>

// Change-PIN: verify password -> emailed OTP -> OTP + new PIN.
const changePinSchema = z.object({
  otp:        z.string().min(4, 'Enter the code sent to your email'),
  newPin:     z.string().length(4, 'PIN must be 4 digits').regex(/^\d{4}$/, 'Digits only'),
  confirmPin: z.string().length(4, 'PIN must be 4 digits'),
}).refine(d => d.newPin === d.confirmPin, { message: 'PINs do not match', path: ['confirmPin'] })
type ChangePinData = z.infer<typeof changePinSchema>

const TX_CREDIT = new Set(['WALLET_FUNDING', 'PAYOUT', 'REFUND', 'REVERSAL'])
const TX_LABEL: Record<string, string> = {
  WALLET_FUNDING: 'Wallet funded via Paystack', PAYOUT: 'Payout received', REFUND: 'Refund', REVERSAL: 'Reversal',
  CONTRIBUTION: 'Group contribution', WITHDRAWAL: 'Withdrawal to bank', PENALTY: 'Penalty',
}

function describe(tx: Transaction) {
  const meta = (tx as any).metadata || {}
  if (tx.type === 'WITHDRAWAL' && meta.bankName) return `Withdrawal to ${meta.bankName}`
  if (tx.type === 'CONTRIBUTION' && meta.groupName) return `Contribution to ${meta.groupName}`
  return TX_LABEL[tx.type] || tx.type.replace(/_/g, ' ')
}

function StatusPill({ status }: { status: string }) {
  const cls = status === 'COMPLETED' ? 'bg-emerald-100 text-emerald-700' : status === 'FAILED' ? 'bg-red-100 text-red-600' : 'bg-amber-100 text-amber-700'
  return <span className={`inline-block px-2 py-0.5 rounded-full text-[10px] font-bold ${cls}`}>{status === 'COMPLETED' ? 'Successful' : status.charAt(0) + status.slice(1).toLowerCase()}</span>
}

// ── Receipt modal ──────────────────────────────────────────────
function ReceiptModal({ tx, onClose }: { tx: Transaction | null; onClose: () => void }) {
  const { showToast } = useUIStore()
  const [reporting, setReporting] = useState(false)
  const [issueText, setIssueText] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [sent, setSent] = useState(false)

  useEffect(() => { setReporting(false); setIssueText(''); setSent(false) }, [tx?.id])

  if (!tx) return null
  const isCredit = TX_CREDIT.has(tx.type)
  const meta = (tx as any).metadata || {}
  const maskAcc = (a: string) => a ? a.slice(0,3) + '****' + a.slice(-3) : '—'
  const accountDisplay = meta.accountLast4 ? `••••${meta.accountLast4}` : meta.accountNumber ? maskAcc(meta.accountNumber) : '—'
  const feeVal = tx.fee ? Number(tx.fee) : 0
  const rows = [
    { label: 'Transaction ID', val: tx.id },
    { label: 'Reference',      val: tx.reference || '—' },
    { label: 'Type',           val: tx.type.replace(/_/g,' ') },
    { label: 'Amount',         val: `${isCredit ? '+' : '-'}₦${tx.amount.toLocaleString()}` },
    { label: 'Status',         val: tx.status },
    { label: 'Date & time',    val: dayjs(tx.createdAt).format('MMM D, YYYY h:mm A') },
    ...(tx.type === 'WITHDRAWAL' ? [
      { label: 'Bank',           val: meta.bankName || '—' },
      { label: 'Account number', val: accountDisplay },
      { label: 'Recipient',      val: meta.accountName || '—' },
      { label: 'Fee',            val: feeVal ? `₦${feeVal.toLocaleString()}` : '₦0' },
    ] : []),
  ]

  const submitIssue = async () => {
    if (!issueText.trim()) { showToast('Tell us what happened first', 'error'); return }
    setSubmitting(true)
    try {
      const details = rows.map(r => `${r.label}: ${r.val}`).join('\n')
      await supportApi.createTicket({
        subject: `Issue with transaction ${tx.id}`,
        message: `${issueText.trim()}\n\n— Transaction details —\n${details}`,
        priority: 'MEDIUM',
      })
      setSent(true)
      showToast('Sent to customer care', 'success')
    } catch (err: any) {
      showToast(err?.response?.data?.message || 'Could not send report', 'error')
    } finally { setSubmitting(false) }
  }

  return (
    <Modal open={!!tx} onClose={onClose} title="Receipt" size="sm"
      footer={
        sent ? <Button onClick={onClose}>Close</Button>
        : reporting ? (<><Button variant="secondary" onClick={() => setReporting(false)}>Back</Button><Button onClick={submitIssue} loading={submitting}>Send to customer care</Button></>)
        : (<><Button variant="secondary" onClick={() => setReporting(true)}>Report an issue</Button><Button onClick={onClose}>Close</Button></>)
      }>
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
        {sent ? (
          <div className="bg-emerald-50 border border-emerald-100 rounded-xl p-4 text-center">
            <p className="text-[13px] font-semibold text-emerald-700">✓ Report sent</p>
            <p className="text-[11px] text-emerald-600 mt-1">Customer care has this transaction's details and will follow up by email.</p>
          </div>
        ) : reporting ? (
          <div className="space-y-2">
            <label className="text-[12px] font-semibold text-gray-700">What happened?</label>
            <textarea autoFocus rows={4} value={issueText} onChange={e => setIssueText(e.target.value)}
              placeholder="e.g. Money was deducted but my wallet wasn't credited…"
              className="w-full rounded-xl border border-gray-200 p-3 text-[13px] text-gray-900 placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-emerald-500/30 focus:border-emerald-400 resize-none"/>
            <p className="text-[11px] text-gray-400">The transaction details above are sent along with your message automatically.</p>
          </div>
        ) : null}
      </div>
    </Modal>
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
    try { await authApi.sendPinChangeOtp(); setStep('otp'); showToast(`Code sent to ${user?.email}`, 'success') }
    catch (err: any) { showToast(err?.response?.data?.message || 'Could not send code', 'error') }
    finally { setSendingOtp(false) }
  }
  const verifyPassword = async () => {
    if (!password) { setPasswordError('Enter your password'); return }
    setVerifying(true); setPasswordError('')
    try { await authApi.verifyPassword(password); await sendOtp() }
    catch (err: any) { setPasswordError(err?.response?.data?.message || 'Incorrect password') }
    finally { setVerifying(false) }
  }
  const resendOtp = async () => {
    setResending(true)
    try { await authApi.sendPinChangeOtp(); showToast(`Code resent to ${user?.email}`, 'success') }
    catch (err: any) { showToast(err?.response?.data?.message || 'Could not resend code', 'error') }
    finally { setResending(false) }
  }
  const handleClose = () => { reset(); setStep('password'); setPassword(''); setPasswordError(''); onClose() }
  const onSubmit = async (data: ChangePinData) => {
    setLoading(true)
    try { await authApi.changePinWithOtp({ otp: data.otp, newPin: data.newPin }); showToast('PIN changed', 'success'); handleClose() }
    catch (err: any) { showToast(err?.response?.data?.message || 'Failed', 'error') }
    finally { setLoading(false) }
  }

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
            <Input label="Password" type="password" placeholder="••••••••" value={password}
              onChange={e => setPassword(e.target.value)} error={passwordError}
              onKeyDown={e => { if (e.key === 'Enter') verifyPassword() }}/>
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

// ── Withdraw modal (saved bank accounts + transaction PIN) ─────
interface SavedAccount {
  id: string; bankName: string; accountName: string; last4: string
  isDefault: boolean; usableAfter: string
}
const hoursLeft = (iso: string) => Math.ceil((new Date(iso).getTime() - Date.now()) / 3600_000)

function WithdrawModal({ open, onClose, onSuccess }: { open: boolean; onClose: () => void; onSuccess: () => void }) {
  const { showToast } = useUIStore()
  const navigate = useNavigate()
  const { user } = useAuthStore()

  const [accounts, setAccounts]       = useState<SavedAccount[]>([])
  const [loadingAcc, setLoadingAcc]   = useState(false)
  const [accountId, setAccountId]     = useState('')
  const [amount, setAmount]           = useState('')
  const [amountError, setAmountError] = useState('')
  const [pin, setPin]                 = useState('')
  const [pinError, setPinError]       = useState('')
  const [fees, setFees]               = useState<any>(null)
  const [submitting, setSubmitting]   = useState(false)
  const [step, setStep]               = useState<'form' | 'confirm'>('form')
  const amountNum = Number(amount)

  // Load the user's saved bank accounts each time the modal opens.
  useEffect(() => {
    if (!open) return
    setLoadingAcc(true)
    api.get('/bank-accounts')
      .then(res => {
        const body: any = res.data
        const list: SavedAccount[] = Array.isArray(body) ? body : Array.isArray(body?.data) ? body.data : []
        setAccounts(list)
        const ready = list.find(a => a.isDefault && hoursLeft(a.usableAfter) <= 0) ?? list.find(a => hoursLeft(a.usableAfter) <= 0)
        setAccountId(ready?.id ?? list[0]?.id ?? '')
      })
      .catch(() => showToast('Could not load your bank accounts', 'error'))
      .finally(() => setLoadingAcc(false))
  }, [open])

  // Debounced fee lookup; token discards stale responses.
  const feesTokenRef = useRef(0)
  useEffect(() => {
    if (!amountNum || amountNum < 500) { setFees(null); return }
    const token = ++feesTokenRef.current
    const handle = setTimeout(() => {
      paymentsApi.getWithdrawalFees(amountNum)
        .then(res => {
          if (feesTokenRef.current !== token) return
          const d = (res as any).data
          setFees(d?.breakdown ? d : d?.data ?? null)
        })
        .catch(() => { if (feesTokenRef.current === token) setFees(null) })
    }, 350)
    return () => clearTimeout(handle)
  }, [amountNum])

  const selected       = accounts.find(a => a.id === accountId)
  const selectedLocked = !!selected && hoursLeft(selected.usableAfter) > 0
  const hasPin         = !!user?.hasTransactionPin

  const handleClose = () => {
    setAmount(''); setAmountError(''); setPin(''); setPinError(''); setFees(null); setStep('form'); onClose()
  }

  const goConfirm = () => {
    if (!amountNum || amountNum < 500) { setAmountError('Minimum ₦500'); return }
    if (!selected) return
    if (selectedLocked) return
    setAmountError(''); setStep('confirm')
  }

  const submit = async () => {
    if (!/^\d{4}$/.test(pin)) { setPinError('Enter your 4-digit PIN'); return }
    setPinError(''); setSubmitting(true)
    try {
      // 60s timeout: the backend can take 15–20s while it talks to Paystack.
      await api.post('/payments/withdraw', { amount: amountNum, accountId, transactionPin: pin }, { timeout: 60000 })
      showToast('Withdrawal initiated — funds on the way', 'success')
      handleClose(); onSuccess()
    } catch (e: any) {
      if (e?.code === 'ECONNABORTED') {
        // The request may still have gone through. Don't claim failure.
        showToast('This is taking longer than usual. Check your transaction history before trying again.', 'error')
        handleClose(); onSuccess()
        return
      }
      const msg = e?.response?.data?.message || 'Withdrawal failed'
      showToast(Array.isArray(msg) ? msg[0] : msg, 'error')
      setPin('')
      if (e?.response?.status === 403) setPinError('Incorrect PIN')
      else setStep('form')
    } finally { setSubmitting(false) }
  }

  const noAccounts = !loadingAcc && accounts.length === 0

  return (
    <Modal open={open} onClose={handleClose} title={step === 'confirm' ? 'Confirm withdrawal' : 'Withdraw funds'} size="sm"
      footer={
        <>
          <Button variant="secondary" onClick={step === 'confirm' ? () => { setStep('form'); setPin(''); setPinError('') } : handleClose}>
            {step === 'confirm' ? 'Back' : 'Cancel'}
          </Button>
          {step === 'form'
            ? <Button onClick={goConfirm} disabled={noAccounts || loadingAcc || !selected || selectedLocked}>Continue</Button>
            : <Button onClick={submit} loading={submitting} disabled={!hasPin || pin.length !== 4}>Confirm withdrawal</Button>}
        </>
      }>
      {step === 'form' ? (
        <div className="space-y-4">
          <Input label="Amount (₦)" type="number" placeholder="5000" value={amount}
            onChange={e => { setAmount(e.target.value); setAmountError('') }} error={amountError}/>

          {fees && (
            <div className="bg-gray-50 rounded-xl p-3.5 space-y-1.5">
              {fees.breakdown?.map((b: any) => (
                <div key={b.label} className="flex justify-between text-[12px]">
                  <span className="text-gray-400">{b.label}</span>
                  <span className={`font-medium tabular-nums ${b.amount < 0 ? 'text-red-500' : 'text-gray-900'}`}>
                    {b.amount < 0 ? '-' : ''}₦{Math.abs(b.amount).toLocaleString()}
                  </span>
                </div>
              ))}
            </div>
          )}

          <div>
            <p className="text-[12px] font-semibold text-gray-700 mb-2">Withdraw to</p>
            {loadingAcc ? (
              <Skeleton className="h-14 w-full rounded-xl"/>
            ) : noAccounts ? (
              <div className="bg-amber-50 border border-amber-100 rounded-xl p-4">
                <p className="text-[13px] font-semibold text-amber-800">No bank account saved yet</p>
                <p className="text-[12px] text-amber-600 mt-1">For your security, you can only withdraw to a bank account you've added to your profile, in your own name.</p>
                <button type="button" onClick={() => { handleClose(); navigate('/profile') }}
                  className="mt-3 h-8 px-4 rounded-lg bg-amber-600 text-white text-[12px] font-semibold hover:bg-amber-700">
                  Add bank account
                </button>
              </div>
            ) : (
              <div className="space-y-2">
                {accounts.map(a => {
                  const hold = hoursLeft(a.usableAfter)
                  const isSel = a.id === accountId
                  return (
                    <button key={a.id} type="button" onClick={() => setAccountId(a.id)}
                      className={`w-full text-left rounded-xl border p-3 flex items-center gap-3 transition-colors ${isSel ? 'border-emerald-500 bg-emerald-50/50' : 'border-gray-200 hover:bg-gray-50'}`}>
                      <span className={`w-4 h-4 rounded-full border-2 flex-shrink-0 ${isSel ? 'border-emerald-500 bg-emerald-500' : 'border-gray-300'}`}/>
                      <span className="min-w-0 flex-1">
                        <span className="block text-[13px] font-semibold text-gray-900 truncate">{a.bankName} ••••{a.last4}</span>
                        <span className="block text-[11px] text-gray-400 truncate">{a.accountName}</span>
                      </span>
                      {hold > 0 && <span className="text-[9px] font-bold uppercase text-amber-700 bg-amber-100 px-2 py-1 rounded-md whitespace-nowrap">Ready in {hold}h</span>}
                      {a.isDefault && hold <= 0 && <span className="text-[9px] font-bold uppercase text-emerald-700 bg-emerald-100 px-2 py-1 rounded-md">Default</span>}
                    </button>
                  )
                })}
                {selectedLocked && (
                  <p className="text-[11px] text-amber-700">This account was added recently and can receive withdrawals in about {hoursLeft(selected!.usableAfter)}h. Pick another account or try again later.</p>
                )}
              </div>
            )}
          </div>
        </div>
      ) : (
        <div className="space-y-4">
          <div className="bg-gray-50 rounded-xl p-4 space-y-2.5">
            {[
              { label: 'Account name', val: selected?.accountName || '—' },
              { label: 'Bank',         val: selected ? `${selected.bankName} ••••${selected.last4}` : '—' },
              { label: 'Amount',       val: `₦${amountNum.toLocaleString()}` },
              { label: 'You receive',  val: fees ? `₦${fees.youWillReceive?.toLocaleString()}` : '—' },
              { label: 'Fees',         val: fees?.totalFees ? `₦${Number(fees.totalFees).toLocaleString()}` : '₦0' },
            ].map(r => (
              <div key={r.label} className="flex justify-between text-[13px]">
                <span className="text-gray-400">{r.label}</span>
                <span className="font-semibold text-gray-900">{r.val}</span>
              </div>
            ))}
          </div>

          {hasPin ? (
            <Input label="Transaction PIN" type="password" maxLength={4} placeholder="••••" value={pin}
              onChange={e => { setPin(e.target.value.replace(/\D/g, '')); setPinError('') }} error={pinError}
              onKeyDown={e => { if (e.key === 'Enter' && pin.length === 4) submit() }}/>
          ) : (
            <div className="bg-amber-50 border border-amber-100 rounded-xl p-4">
              <p className="text-[13px] font-semibold text-amber-800">Set your transaction PIN first</p>
              <p className="text-[12px] text-amber-600 mt-1">You need a PIN to confirm withdrawals. Close this and tap "Set PIN" on the wallet page.</p>
            </div>
          )}

          <p className="text-[12px] text-gray-400">Funds typically arrive within 5 minutes. This cannot be undone.</p>
        </div>
      )}
    </Modal>
  )
}

// ── Outstanding debts ──────────────────────────────────────────
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
    try { await kycApi.settleDebt(debtId); showToast('Debt settled ✅', 'success'); loadDebts(); onSettled() }
    catch (err: any) { showToast(err?.response?.data?.message || 'Could not settle this debt', 'error') }
    finally { setSettlingId(null) }
  }
  if (loading || outstanding.length === 0) return null
  const totalOwed = outstanding.reduce((s, d) => s + Number(d.totalOwed), 0)

  return (
    <motion.div className="bg-red-50 border border-red-200 rounded-2xl overflow-hidden" initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }}>
      <div className="px-4 sm:px-5 py-4">
        <p className="text-[13px] sm:text-[14px] font-bold text-red-800">You have an outstanding debt — ₦{totalOwed.toLocaleString()}</p>
        <p className="text-[12px] text-red-600 mt-0.5">This must be settled before you can join or create another group.</p>
      </div>
      <div className="border-t border-red-100 divide-y divide-red-100">
        {outstanding.map(d => (
          <div key={d.id} className="px-4 sm:px-5 py-3.5 flex items-center justify-between gap-3 flex-wrap">
            <div className="min-w-0">
              <p className="text-[12.5px] font-semibold text-red-800">{d.description || 'Missed contribution'}</p>
              <p className="text-[11px] text-red-500 mt-0.5">₦{Number(d.amount).toLocaleString()} owed + ₦{Number(d.lateFee).toLocaleString()} late fee{d.createdAt ? ` · ${dayjs(d.createdAt).format('MMM D, YYYY')}` : ''}</p>
            </div>
            <div className="flex items-center gap-3 flex-shrink-0">
              <p className="text-[14px] font-bold text-red-800 tabular-nums">₦{Number(d.totalOwed).toLocaleString()}</p>
              <button onClick={() => handleSettle(d.id)} disabled={settlingId === d.id}
                className="h-8 px-3.5 rounded-lg bg-red-600 text-white text-[12px] font-semibold hover:bg-red-700 disabled:opacity-60 transition-colors">
                {settlingId === d.id ? 'Paying…' : 'Pay from wallet'}
              </button>
            </div>
          </div>
        ))}
      </div>
    </motion.div>
  )
}

// ── Quick operation card ───────────────────────────────────────
function OpCard({ title, sub, icon, onClick }: { title: string; sub: string; icon: React.ReactNode; onClick: () => void }) {
  return (
    <button onClick={onClick} className="text-left bg-warm hover:bg-emerald-50 rounded-xl p-4 transition-colors">
      <div className="w-8 h-8 rounded-lg bg-white flex items-center justify-center text-brand mb-3">{icon}</div>
      <p className="text-[13px] font-bold text-gray-900">{title}</p>
      <p className="text-[11px] text-gray-400 mt-0.5 leading-snug">{sub}</p>
    </button>
  )
}
const ico = (d: string) => <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d={d}/></svg>

// ── Main page ──────────────────────────────────────────────────
const PAGE_SIZE = 15
const ALL_SIZE  = 500
const BALANCE_HIDDEN_KEY = 'walletBalanceHidden'

export default function WalletPage() {
  const navigate = useNavigate()
  const [fundOpen,      setFundOpen]      = useState(false)
  const [withdrawOpen,  setWithdrawOpen]  = useState(false)
  const [setPinOpen,    setSetPinOpen]    = useState(false)
  const [changePinOpen, setChangePinOpen] = useState(false)
  const [txType,        setTxType]        = useState('')
  const [page,          setPage]          = useState(1)
  const [showAll,       setShowAll]       = useState(false)
  const [receiptTx,     setReceiptTx]     = useState<Transaction | null>(null)

  const [balanceHidden, setBalanceHidden] = useState(() => localStorage.getItem(BALANCE_HIDDEN_KEY) === 'true')
  const toggleBalance = () => setBalanceHidden(prev => { const next = !prev; localStorage.setItem(BALANCE_HIDDEN_KEY, String(next)); return next })

  const { verifying } = usePaymentVerify()
  const { user }      = useAuthStore()
  const { data: wallet, isLoading: walletLoading, refetch: refetchWallet } = useWallet()
  const { data: txData, isLoading: txLoading } = useWalletTransactions({
    page: showAll ? 1 : page, limit: showAll ? ALL_SIZE : PAGE_SIZE, type: txType || undefined,
  })
  const initPayment = useInitiatePayment()

  const { data: statsData } = useQuery({
    queryKey: ['wallet-stats'],
    queryFn:  () => walletApi.getStats(),
    select:   (res) => (res.data as any)?.data || res.data,
  })

  const { register, handleSubmit, formState: { errors }, reset } = useForm<FundData>({
    resolver: zodResolver(fundSchema), defaultValues: { provider: 'paystack' },
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
  const totalFunded: number = statsData?.totalFunded ?? statsData?.totalDeposited ?? w?.totalFunded ?? w?.totalDeposited ?? 0
  const mask = (v: string) => balanceHidden ? '₦••••••' : v
  const balance = w?.balance ?? 0
  const locked  = w?.lockedBalance ?? 0

  const TX_TYPE_LABELS: Record<string, string> = {
    '': 'All Transactions', WALLET_FUNDING: 'Funding', CONTRIBUTION: 'Contributions', PAYOUT: 'Payouts', WITHDRAWAL: 'Withdrawals',
  }

  return (
    <DashboardLayout title="Wallet" subtitle="Manage your funds securely">
      <div className="bg-[#F8F9FB] min-h-screen">
        <div className="w-full max-w-5xl mx-auto px-4 sm:px-6 py-5 sm:py-8 space-y-4">

          <DebtsSection onSettled={() => refetchWallet()}/>

          <AnimatePresence>
            {verifying && (
              <motion.div className="bg-white border border-gray-100 rounded-2xl p-4 flex items-center gap-3 shadow-sm"
                initial={{ opacity:0, y:-8 }} animate={{ opacity:1, y:0 }} exit={{ opacity:0, y:-8 }}>
                <div className="w-5 h-5 rounded-full border-2 border-emerald-500 border-t-transparent animate-spin flex-shrink-0"/>
                <p className="text-[13px] font-medium text-gray-900">Verifying your payment…</p>
              </motion.div>
            )}
          </AnimatePresence>

          {!hasPin && (
            <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 flex items-center justify-between gap-3 flex-wrap">
              <div>
                <p className="text-[13px] font-semibold text-amber-800">Set your transaction PIN</p>
                <p className="text-[12px] text-amber-600 mt-0.5">Required for contributions and withdrawals.</p>
              </div>
              <button onClick={() => setSetPinOpen(true)} className="h-8 px-4 rounded-lg bg-amber-600 text-white text-[12px] font-semibold hover:bg-amber-700">Set PIN</button>
            </div>
          )}

          {/* Balance card */}
          {walletLoading ? <Skeleton className="h-40 w-full rounded-2xl"/> : (
            <div className="rounded-2xl bg-brand p-5 sm:p-7 flex items-start justify-between gap-4 flex-wrap">
              <div className="min-w-0">
                <p className="text-[12px] text-white/60 font-medium">Total Wallet Balance</p>
                <div className="flex items-center gap-2 mt-1">
                  <p className="text-[34px] sm:text-[44px] font-extrabold text-white tracking-tight leading-none tabular-nums">{mask(`₦${balance.toLocaleString()}`)}</p>
                  <button onClick={toggleBalance} aria-label={balanceHidden ? 'Show balance' : 'Hide balance'}
                    className="w-8 h-8 rounded-full flex items-center justify-center text-white/60 hover:text-white hover:bg-white/10 transition-colors">
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      {balanceHidden
                        ? <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M3 3l3.59 3.59m0 0A9.953 9.953 0 0112 5c4.478 0 8.268 2.943 9.543 7a10.025 10.025 0 01-4.132 5.411m0 0L21 21"/>
                        : <><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"/><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z"/></>}
                    </svg>
                  </button>
                </div>
                <p className="text-[11px] text-lime mt-3">
                  Available: {mask(`₦${Math.max(balance - locked, 0).toLocaleString()}`)} • Pending lock: {mask(`₦${locked.toLocaleString()}`)} • Total funded: {mask(`₦${totalFunded.toLocaleString()}`)}
                </p>
              </div>
              <button onClick={() => setFundOpen(true)}
                className="h-10 px-5 rounded-lg bg-lime text-black text-[13px] font-bold hover:opacity-90 active:scale-95 transition-all">
                Fund Wallet
              </button>
            </div>
          )}

          {/* Quick operations */}
          <div className="bg-white rounded-2xl border border-gray-100 p-4 sm:p-5">
            <p className="text-[14px] font-bold text-gray-900 mb-3">Quick Operations</p>
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
              <OpCard title="Fund via Paystack" sub="Instant deposits via bank or card" onClick={() => setFundOpen(true)}
                icon={ico('M3 10h18M7 15h1m4 0h1m-7 4h12a3 3 0 003-3V8a3 3 0 00-3-3H6a3 3 0 00-3 3v8a3 3 0 003 3z')}/>
              <OpCard title="Withdraw to Bank" sub="Send money to your saved bank account" onClick={() => setWithdrawOpen(true)}
                icon={ico('M12 19l9 2-9-18-9 18 9-2zm0 0v-8')}/>
              <OpCard title="Circle Escrow Settle" sub="Check pending locks and releases" onClick={() => navigate('/groups')}
                icon={ico('M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z')}/>
              <OpCard title="Transaction PIN" sub={hasPin ? 'Change your secure verification PIN' : 'Set up your secure verification PIN'}
                onClick={() => hasPin ? setChangePinOpen(true) : setSetPinOpen(true)}
                icon={ico('M15 7a2 2 0 012 2m4 0a6 6 0 01-7.743 5.743L11 17H9v2H7v2H4a1 1 0 01-1-1v-2.586a1 1 0 01.293-.707l5.964-5.964A6 6 0 1121 9z')}/>
            </div>
          </div>

          {/* Ledger */}
          <div className="bg-white rounded-2xl border border-gray-100 overflow-hidden">
            <div className="px-4 sm:px-5 py-4 flex items-center justify-between gap-3">
              <p className="text-[14px] font-bold text-gray-900">Transaction Ledger</p>
              <select value={txType} onChange={e => { setTxType(e.target.value); setPage(1); setShowAll(false) }}
                className="h-8 rounded-lg border border-gray-200 bg-white px-2 text-[12px] font-medium text-gray-700 outline-none focus:border-brand cursor-pointer">
                {Object.entries(TX_TYPE_LABELS).map(([val, label]) => <option key={val} value={val}>{label}</option>)}
              </select>
            </div>

            {txLoading ? (
              <div className="space-y-3 p-4">{[...Array(5)].map((_,i) => <Skeleton key={i} className="h-10 w-full rounded-lg"/>)}</div>
            ) : transactions.length === 0 ? (
              <div className="py-14 text-center">
                <p className="text-[14px] font-semibold text-gray-800">No transactions yet</p>
                <p className="text-[12px] text-gray-400 mt-1">Fund your wallet to get started</p>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[640px]">
                  <thead className="bg-warm">
                    <tr>{['Type', 'Description', 'Date', 'Status', 'Amount'].map((h, i) => (
                      <th key={h} className={`px-4 py-2.5 text-[11px] font-semibold text-gray-400 ${i === 4 ? 'text-right' : 'text-left'}`}>{h}</th>
                    ))}</tr>
                  </thead>
                  <tbody>
                    {transactions.map(tx => {
                      const credit = TX_CREDIT.has(tx.type)
                      return (
                        <tr key={tx.id} onClick={() => setReceiptTx(tx)} className="border-t border-gray-50 hover:bg-gray-50/70 cursor-pointer transition-colors">
                          <td className="px-4 py-3 text-[12px] font-semibold whitespace-nowrap">
                            <span className={credit ? 'text-emerald-600' : 'text-red-500'}>{credit ? '↓ Credit' : '↑ Debit'}</span>
                          </td>
                          <td className="px-4 py-3 text-[12px] text-gray-800">{describe(tx)}</td>
                          <td className="px-4 py-3 text-[11px] text-gray-400 whitespace-nowrap">{dayjs(tx.createdAt).format('MMM D, YYYY • h:mm A')}</td>
                          <td className="px-4 py-3"><StatusPill status={tx.status}/></td>
                          <td className={`px-4 py-3 text-[12px] font-bold text-right tabular-nums whitespace-nowrap ${credit ? 'text-emerald-600' : 'text-gray-900'}`}>
                            {credit ? '+' : '-'}₦{tx.amount.toLocaleString()}
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            )}

            {!showAll && pagination && pagination.totalPages > 1 && (
              <div className="px-4 py-3 border-t border-gray-50 flex items-center justify-between flex-wrap gap-2">
                <p className="text-[11px] text-gray-400">Page {pagination.page} of {pagination.totalPages}</p>
                <div className="flex gap-2">
                  <button disabled={page === 1} onClick={() => setPage(p => p-1)} className="h-8 px-3 rounded-lg border border-gray-200 text-[12px] font-semibold text-gray-600 hover:bg-gray-50 disabled:opacity-40">Prev</button>
                  <button disabled={page >= pagination.totalPages} onClick={() => setPage(p => p+1)} className="h-8 px-3 rounded-lg border border-gray-200 text-[12px] font-semibold text-gray-600 hover:bg-gray-50 disabled:opacity-40">Next</button>
                </div>
              </div>
            )}

            {transactions.length > 0 && !txLoading && (
              <div className="px-4 py-3 border-t border-gray-50 text-center">
                {showAll
                  ? <button onClick={() => { setShowAll(false); setPage(1) }} className="text-[12px] font-semibold text-gray-500 hover:text-gray-700">Show less</button>
                  : <button onClick={() => setShowAll(true)} className="text-[12px] font-semibold text-brand hover:opacity-80">View all transactions</button>}
              </div>
            )}
          </div>
        </div>
      </div>

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