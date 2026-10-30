// src/pages/shop/PlanPage.tsx
// One plan: progress, what is due, pay now, switch auto/manual, chat with the vendor, cancel for a refund.

import { useCallback, useEffect, useRef, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import DashboardLayout from '@/components/layout/DashboardLayout'
import { planApi } from '@/api/smallSmall'
import {
  SsStyles, SsTabs, Pill, Progress, Modal, naira, fmtDate, errMsg, unwrap, newKey, statusTone, statusLabel, FREQ_LABEL,
} from '@/components/ss/ssShared'
import SsChat from '@/components/ss/SsChat'
import { useUIStore } from '@/stores/uiStore'

type Installment = { number: number; dueDate: string; amount: number; paidAmount: number; status: string; paidAt: string | null }
type Plan = {
  id: string
  orderNumber: string
  status: string
  product: { id: string; name: string; thumbnail: string | null }
  vendor: { businessName: string | null }
  chatThreadId: string | null
  totalPrice: number
  depositAmount: number
  amountPaid: number
  amountRemaining: number
  percentPaid: number
  paymentMode: 'MANUAL' | 'AUTO'
  frequency: string
  intervalDays: number
  installmentCount: number
  installmentAmount: number
  deadlineAt: string
  nextDueDate: string | null
  missedCount: number
  graceExpiresAt: string | null
  refundThresholdPercent: number
  refund: { allowed: boolean; reason: string | null; preview: { youPaid: number; feeTotal: number; feePercent: number; youGetBack: number } | null }
  refundDetails?: { paid: number; fee: number; refunded: number }
  installments: Installment[]
  payments: { amount: number; mode: string; paidAt: string }[]
}

export default function PlanPage() {
  const { id = '' } = useParams()
  const navigate = useNavigate()
  const { showToast } = useUIStore()

  const [plan, setPlan] = useState<Plan | null>(null)
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState('')
  const [error, setError] = useState('')

  const [amount, setAmount] = useState('')
  const [paying, setPaying] = useState(false)
  const payKey = useRef(newKey())          // one key per "pay" attempt: a double tap charges once

  const [modeBusy, setModeBusy] = useState(false)
  const [confirmRefund, setConfirmRefund] = useState(false)
  const [refunding, setRefunding] = useState(false)
  const [chatOpen, setChatOpen] = useState(false)

  const load = useCallback(async () => {
    try {
      const res = await planApi.get(id)
      const p = unwrap(res) as Plan
      setPlan(p)
      setLoadError('')
      return p
    } catch (e) {
      setLoadError(errMsg(e, 'We could not load this plan.'))
      return null
    } finally {
      setLoading(false)
    }
  }, [id])

  useEffect(() => { load() }, [load])

  // what is due right now (installments whose date has come and are not fully paid)
  const now = Date.now()
  const dueNow = plan ? plan.installments.reduce((t, i) => (i.status !== 'PAID' && new Date(i.dueDate).getTime() <= now ? t + (i.amount - i.paidAmount) : t), 0) : 0
  const nextInst = plan?.installments.find(i => i.status !== 'PAID')
  const nextAmount = nextInst ? nextInst.amount - nextInst.paidAmount : 0

  // pre-fill the amount with what is due (or the next installment)
  useEffect(() => {
    if (plan && plan.status === 'ACTIVE' && amount === '') {
      const suggested = dueNow > 0 ? dueNow : nextAmount
      if (suggested > 0) setAmount(String(Math.min(suggested, plan.amountRemaining)))
    }
  }, [plan]) // eslint-disable-line react-hooks/exhaustive-deps

  const amountNum = Number(amount)
  const amountOk = plan ? amountNum >= Math.min(100, plan.amountRemaining) && amountNum <= plan.amountRemaining : false

  const pay = async () => {
    if (!plan || !amountOk) return
    setError(''); setPaying(true)
    try {
      await planApi.pay(plan.id, { amount: amountNum, idempotencyKey: payKey.current })
      payKey.current = newKey()
      setAmount('')
      showToast('Payment received', 'success')
      await load()
    } catch (e) {
      setError(errMsg(e, 'Could not take that payment. Please try again.'))
    } finally {
      setPaying(false)
    }
  }

  const switchMode = async (mode: 'MANUAL' | 'AUTO') => {
    if (!plan || plan.paymentMode === mode) return
    setError(''); setModeBusy(true)
    try { await planApi.setMode(plan.id, mode); await load() }
    catch (e) { setError(errMsg(e, 'Could not change how you pay.')) }
    finally { setModeBusy(false) }
  }

  const refund = async () => {
    if (!plan) return
    setError(''); setRefunding(true)
    try {
      await planApi.refund(plan.id)
      setConfirmRefund(false)
      showToast('Your refund was sent to your wallet', 'success')
      await load()
    } catch (e) {
      setConfirmRefund(false)
      setError(errMsg(e, 'Could not process the refund.'))
    } finally {
      setRefunding(false)
    }
  }

  const active = plan?.status === 'ACTIVE'
  const insufficient = /insufficient|fund your wallet/i.test(error)

  return (
    <DashboardLayout title="Plan" subtitle="Pay small small">
      <div className="ss-root ss-narrow">
        <SsStyles />
        <SsTabs />
        <div><button type="button" className="ss-btn ghost sm" onClick={() => navigate('/plans')}>← My plans</button></div>

        {loading ? (
          <div className="ss-skel" style={{ height: 280 }} />
        ) : loadError || !plan ? (
          <div className="ss-note err">{loadError || 'We could not load this plan.'}</div>
        ) : (
          <>
            <div className="ss-card accent">
              <div className="ss-head" style={{ marginBottom: 14 }}>
                <div>
                  <h2 className="ss-title">{plan.product.name}</h2>
                  <p className="ss-sub">{plan.vendor.businessName || 'Vendor'} · Plan {plan.orderNumber}</p>
                </div>
                <Pill tone={statusTone(plan.status)}>{statusLabel(plan.status)}</Pill>
              </div>
              <Progress pct={plan.percentPaid} />
              <div className="ss-kv" style={{ marginTop: 14 }}>
                <div><b>Paid</b><span>{naira(plan.amountPaid)}</span></div>
                <div><b>Still to pay</b><span>{naira(plan.amountRemaining)}</span></div>
                <div><b>Price</b><span>{naira(plan.totalPrice)}</span></div>
                <div><b>Finish by</b><span>{fmtDate(plan.deadlineAt)}</span></div>
              </div>
            </div>

            {plan.status === 'DISPUTED' && (
              <div className="ss-note warn">This plan has missed payments and is with customer care. They will contact you. Nothing has been taken from you.</div>
            )}
            {plan.status === 'DEFAULTED' && plan.refundDetails && (
              <div className="ss-note warn">This plan was cancelled for missed payments. {naira(plan.refundDetails.refunded)} was returned to your wallet.</div>
            )}
            {plan.status === 'REFUNDED' && plan.refundDetails && (
              <div className="ss-note ok">You cancelled this plan. {naira(plan.refundDetails.refunded)} was returned to your wallet ({naira(plan.refundDetails.fee)} cancellation fee).</div>
            )}
            {plan.status === 'COMPLETED' && (
              <div className="ss-note ok">You finished paying. The vendor has been paid and will send your goods.</div>
            )}
            {active && plan.graceExpiresAt && (
              <div className="ss-note warn">A payment is overdue. Pay by {fmtDate(plan.graceExpiresAt)} to avoid a missed payment{plan.missedCount > 0 ? ` (you have ${plan.missedCount} already)` : ''}.</div>
            )}
            {error && (
              <div className="ss-note err" role="alert">
                {error}
                {insufficient && <div style={{ marginTop: 8 }}><button type="button" className="ss-btn ghost sm" onClick={() => navigate('/wallet')}>Fund my wallet →</button></div>}
              </div>
            )}

            {plan.chatThreadId && (
              <div className="ss-card">
                <div className="ss-head" style={{ marginBottom: chatOpen ? 12 : 0 }}>
                  <p className="ss-h" style={{ margin: 0 }}>Chat with {plan.vendor.businessName || 'the vendor'}</p>
                  <button type="button" className="ss-btn ghost sm" onClick={() => setChatOpen(o => !o)}>{chatOpen ? 'Close chat' : 'Open chat'}</button>
                </div>
                {chatOpen && <SsChat threadId={plan.chatThreadId} />}
              </div>
            )}

            {active && (
              <div className="ss-card">
                <p className="ss-h">Pay now</p>
                <div className="ss-quick">
                  {dueNow > 0 && <button type="button" className="ss-btn ghost sm" onClick={() => setAmount(String(Math.min(dueNow, plan.amountRemaining)))}>Amount due ({naira(dueNow)})</button>}
                  {nextAmount > 0 && <button type="button" className="ss-btn ghost sm" onClick={() => setAmount(String(Math.min(nextAmount, plan.amountRemaining)))}>Next installment ({naira(nextAmount)})</button>}
                  <button type="button" className="ss-btn ghost sm" onClick={() => setAmount(String(plan.amountRemaining))}>Pay everything ({naira(plan.amountRemaining)})</button>
                </div>
                <div className="ss-field">
                  <label htmlFor="ss-amt">Amount (₦)</label>
                  <input id="ss-amt" inputMode="decimal" value={amount} onChange={e => setAmount(e.target.value.replace(/[^\d.]/g, ''))} />
                  <p className="ss-hint">Comes from your wallet. The smallest payment is ₦100, unless it finishes the plan.</p>
                </div>
                <div className="ss-row end">
                  <button type="button" className="ss-btn" disabled={paying || !amountOk} onClick={pay}>
                    {paying ? <><span className="ss-spin" /> Paying…</> : <>Pay {naira(amountNum || 0)} →</>}
                  </button>
                </div>
              </div>
            )}

            {active && (
              <div className="ss-card">
                <p className="ss-h">How you pay</p>
                <div className="ss-checks">
                  <label className={`ss-check ${plan.paymentMode === 'MANUAL' ? 'on' : ''}`}>
                    <input type="radio" name="pm" checked={plan.paymentMode === 'MANUAL'} disabled={modeBusy} onChange={() => switchMode('MANUAL')} /> I pay myself
                  </label>
                  <label className={`ss-check ${plan.paymentMode === 'AUTO' ? 'on' : ''}`}>
                    <input type="radio" name="pm" checked={plan.paymentMode === 'AUTO'} disabled={modeBusy} onChange={() => switchMode('AUTO')} /> Take it from my wallet automatically
                  </label>
                </div>
                <p className="ss-hint">
                  {plan.paymentMode === 'AUTO'
                    ? 'On each due date we take the installment from your wallet. If it is short, you get 48 hours to top up.'
                    : `${FREQ_LABEL[plan.frequency] || plan.frequency}: ${plan.installmentCount} payments of about ${naira(plan.installmentAmount)}. We remind you the day before.`}
                </p>
              </div>
            )}

            <div className="ss-card">
              <p className="ss-h">Payment schedule</p>
              {plan.installments.length === 0 ? (
                <p className="ss-p">You paid the full price upfront. Nothing left to schedule.</p>
              ) : (
                <div style={{ overflowX: 'auto' }}>
                  <table className="ss-table">
                    <thead><tr><th>#</th><th>Due</th><th>Amount</th><th>Paid</th><th>Status</th></tr></thead>
                    <tbody>
                      {plan.installments.map(i => (
                        <tr key={i.number}>
                          <td>{i.number}</td><td>{fmtDate(i.dueDate)}</td><td>{naira(i.amount)}</td><td>{naira(i.paidAmount)}</td>
                          <td><Pill tone={statusTone(i.status)}>{statusLabel(i.status)}</Pill></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>

            {plan.payments.length > 0 && (
              <div className="ss-card">
                <p className="ss-h">Payments you made</p>
                <ul className="ss-sched">
                  {plan.payments.map((p, i) => (
                    <li key={i}><span>{fmtDate(p.paidAt)} · {p.mode === 'AUTO' ? 'automatic' : 'by you'}</span><b>{naira(p.amount)}</b></li>
                  ))}
                </ul>
              </div>
            )}

            {active && (
              <div className="ss-card">
                <p className="ss-h">Cancel and get a refund</p>
                {plan.refund.allowed && plan.refund.preview ? (
                  <>
                    <p className="ss-p">
                      You have paid {naira(plan.refund.preview.youPaid)}. If you cancel now, {plan.refund.preview.feePercent}% ({naira(plan.refund.preview.feeTotal)}) is kept
                      and <b>{naira(plan.refund.preview.youGetBack)}</b> goes back to your wallet.
                    </p>
                    <div className="ss-row end"><button type="button" className="ss-btn danger" onClick={() => setConfirmRefund(true)}>Cancel this plan…</button></div>
                  </>
                ) : (
                  <p className="ss-p">{plan.refund.reason || 'A refund is not available for this plan.'}</p>
                )}
              </div>
            )}

            {confirmRefund && plan.refund.preview && (
              <Modal title="Cancel this plan?" onClose={() => setConfirmRefund(false)}>
                <p className="ss-p">
                  You paid {naira(plan.refund.preview.youPaid)}. We keep {naira(plan.refund.preview.feeTotal)} ({plan.refund.preview.feePercent}%) and send
                  {' '}<b>{naira(plan.refund.preview.youGetBack)}</b> to your wallet. You will lose your place on this product.
                </p>
                <div className="ss-row end" style={{ marginTop: 16 }}>
                  <button type="button" className="ss-btn ghost" onClick={() => setConfirmRefund(false)}>Keep my plan</button>
                  <button type="button" className="ss-btn" disabled={refunding} onClick={refund}>{refunding ? 'Please wait…' : 'Yes, cancel and refund'}</button>
                </div>
              </Modal>
            )}
          </>
        )}
      </div>
    </DashboardLayout>
  )
}