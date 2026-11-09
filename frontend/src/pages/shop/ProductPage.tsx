// src/pages/shop/ProductPage.tsx
// One product, and the "start a plan" box: choose how often, how long and how much to pay now.
// A live preview (from the server, no money moves) shows the exact installments before you confirm.

import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import DashboardLayout from '@/components/layout/DashboardLayout'
import { shopApi, planApi, chatApi, type PlanChoice } from '@/api/smallSmall'
import { SsStyles, SsTabs, Pill, Modal, naira, fmtDate, errMsg, unwrap, newKey, useDebounced, FREQ_LABEL } from '@/components/ss/ssShared'
import VerifiedBadge from '@/components/ss/VerifiedBadge'
import SsPinModal from '@/components/ss/SsPinModal'
import SsChat from '@/components/ss/SsChat'
import SsReportModal from '@/components/ss/SsReportModal'
import { useUIStore } from '@/stores/uiStore'

// There is no percentage minimum any more. The only floor is ₦100, the smallest payment the wallet takes.
const MIN_FIRST_PAYMENT = 100

type Product = {
  id: string
  referenceNumber: string
  name: string
  description: string
  price: number
  images: string[]
  inStock: boolean
  allowedFrequencies: string[]
  customIntervalDays: number[]
  paymentDeadlineDays: number
  refundThresholdPercent: number
  vendor: { businessName: string | null; isVerified?: boolean }
}

type Preview = {
  price: number
  deposit: number
  remaining: number
  installmentCount: number
  installmentAmount: number
  deadlineAt: string
  schedule: { number: number; dueDate: string; amount: number }[]
  refund: { offered: boolean; belowPercent: number; feePercent: number }
}

export default function ProductPage() {
  const { id = '' } = useParams()
  const navigate = useNavigate()
  const { showToast } = useUIStore()

  const [product, setProduct] = useState<Product | null>(null)
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState('')
  const [photo, setPhoto] = useState(0)

  const [frequency, setFrequency] = useState<PlanChoice['frequency']>('WEEKLY')
  const [customDays, setCustomDays] = useState<number>(0)
  const [duration, setDuration] = useState('')
  const [deposit, setDeposit] = useState('')
  const [mode, setMode] = useState<'MANUAL' | 'AUTO'>('MANUAL')

  const [preview, setPreview] = useState<Preview | null>(null)
  const [previewError, setPreviewError] = useState('')
  const [previewing, setPreviewing] = useState(false)

  const [starting, setStarting] = useState(false)
  const [startError, setStartError] = useState('')
  const [pinOpen, setPinOpen] = useState(false)
  const [chatThreadId, setChatThreadId] = useState<string | null>(null)
  const [chatBusy, setChatBusy] = useState(false)
  const [chatError, setChatError] = useState('')
  const [reportOpen, setReportOpen] = useState(false)
  const keyRef = useRef(newKey())   // same key on a double tap = only one plan, charged once

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    shopApi.get(id)
      .then(res => {
        if (cancelled) return
        const p = unwrap(res) as Product
        setProduct(p)
        const firstFreq = (p.allowedFrequencies[0] || 'WEEKLY') as PlanChoice['frequency']
        setFrequency(firstFreq)
        setCustomDays(p.customIntervalDays[0] || 0)
        setDuration(String(p.paymentDeadlineDays))
        setDeposit(String(Math.min(MIN_FIRST_PAYMENT, p.price)))
        setLoadError('')
      })
      .catch(e => { if (!cancelled) setLoadError(errMsg(e, 'We could not find that product.')) })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [id])

  const minDeposit = product ? Math.min(MIN_FIRST_PAYMENT, product.price) : 0
  const durationNum = Number(duration)
  const depositNum = Number(deposit)

  // what we ask the server about
  const choice: PlanChoice | null = useMemo(() => {
    if (!product) return null
    if (!Number.isInteger(durationNum) || durationNum < 1 || durationNum > product.paymentDeadlineDays) return null
    if (!(depositNum >= minDeposit) || depositNum > product.price) return null
    if (frequency === 'CUSTOM' && !customDays) return null
    return {
      productId: product.id, frequency,
      customIntervalDays: frequency === 'CUSTOM' ? customDays : undefined,
      durationDays: durationNum, depositAmount: depositNum,
    }
  }, [product, frequency, customDays, durationNum, depositNum, minDeposit])

  const debounced = useDebounced(choice, 400)

  useEffect(() => {
    if (!debounced) { setPreview(null); return }
    let cancelled = false
    setPreviewing(true)
    planApi.preview(debounced)
      .then(res => { if (!cancelled) { setPreview(unwrap(res) as Preview); setPreviewError('') } })
      .catch(e => { if (!cancelled) { setPreview(null); setPreviewError(errMsg(e, 'Could not work out that plan.')) } })
      .finally(() => { if (!cancelled) setPreviewing(false) })
    return () => { cancelled = true }
  }, [debounced])

  // local hints so people know what is wrong before the server says so
  const localError =
    !product ? '' :
    !Number.isInteger(durationNum) || durationNum < 1 ? 'Enter how many days you want to take to pay.' :
    durationNum > product.paymentDeadlineDays ? `The vendor allows at most ${product.paymentDeadlineDays} days.` :
    !(depositNum >= minDeposit) ? `Your first payment must be at least ${naira(minDeposit)}.` :
    depositNum > product.price ? 'The first payment cannot be more than the price.' :
    frequency === 'CUSTOM' && !customDays ? 'Choose how many days between payments.' : ''

  const start = async (pin: string) => {
    if (!choice) return
    setStartError(''); setStarting(true)
    try {
      const res = await planApi.start({ ...choice, paymentMode: mode, idempotencyKey: keyRef.current }, pin)
      const order = unwrap(res)
      keyRef.current = newKey()
      setPinOpen(false)
      showToast('Your plan has started', 'success')
      navigate(`/plans/${order?.id ?? ''}`)
    } catch (e) {
      const m = errMsg(e, 'Could not start your plan. Please try again.')
      // a PIN problem stays inside the PIN box; anything else shows on the page
      if (/pin/i.test(m) && !/insufficient/i.test(m)) throw new Error(m)
      setPinOpen(false); setStartError(m)
    } finally {
      setStarting(false)
    }
  }

  // Ask the vendor a question before buying
  const openChat = async () => {
    if (!product) return
    setChatError(''); setChatBusy(true)
    try {
      const res = await chatApi.startForProduct(product.id)
      setChatThreadId((unwrap(res) as any).threadId)
    } catch (e) {
      setChatError(errMsg(e, 'Could not open the chat. Please try again.'))
    } finally {
      setChatBusy(false)
    }
  }

  const insufficient = /insufficient|fund your wallet/i.test(startError)

  return (
    <DashboardLayout title={product?.name || 'Product'} subtitle="Pay small small">
      <div className="ss-root">
        <SsStyles />
        <SsTabs />

        <div><button type="button" className="ss-btn ghost sm" onClick={() => navigate('/shop')}>← Back to shop</button></div>

        {loading ? (
          <div className="ss-skel" style={{ height: 320 }} />
        ) : loadError || !product ? (
          <div className="ss-note err">{loadError || 'We could not find that product.'}</div>
        ) : (
          <div className="ss-split">
            {/* left: the product */}
            <div className="ss-stack">
              <div className="ss-gallery">
                <div className="ss-gallery-main">
                  {product.images[photo] ? <img src={product.images[photo]} alt={product.name} /> : 'No photo'}
                </div>
                {product.images.length > 1 && (
                  <div className="ss-gallery-t">
                    {product.images.map((u, i) => (
                      <button key={u} type="button" className={i === photo ? 'on' : ''} onClick={() => setPhoto(i)} aria-label={`Photo ${i + 1}`}>
                        <img src={u} alt="" />
                      </button>
                    ))}
                  </div>
                )}
              </div>

              <div className="ss-card">
                <h2 className="ss-title">{product.name}</h2>
                <p className="ss-prod-p" style={{ fontSize: 22, margin: '6px 0 10px' }}>{naira(product.price)}</p>
                <p className="ss-p" style={{ whiteSpace: 'pre-wrap' }}>{product.description}</p>
                <p className="ss-hint">
                  Sold by {product.vendor.businessName || 'a vendor'}
                  {product.vendor.isVerified && <VerifiedBadge />}
                  {' '}· Ref {product.referenceNumber}
                </p>
                <div style={{ marginTop: 10 }}>
                  <button type="button" className="ss-btn ghost sm" disabled={chatBusy} onClick={openChat}>
                    {chatBusy ? 'Opening…' : '💬 Message the vendor'}
                  </button>
                  {' '}<button type="button" className="ss-btn ghost sm" onClick={() => setReportOpen(true)}>🚩 Report this vendor</button>
                  {chatError && <div className="ss-note err" role="alert" style={{ marginTop: 8 }}>{chatError}</div>}
                </div>
              </div>
            </div>

            {/* right: start a plan */}
            <div className="ss-card accent">
              <p className="ss-h">Start a plan</p>

              {!product.inStock ? (
                <div className="ss-note warn">This product is sold out right now.</div>
              ) : (
                <>
                  <div className="ss-two">
                    <div className="ss-field">
                      <label htmlFor="ss-freq">How often will you pay?</label>
                      <select id="ss-freq" value={frequency} onChange={e => setFrequency(e.target.value as PlanChoice['frequency'])}>
                        {product.allowedFrequencies.map(f => <option key={f} value={f}>{FREQ_LABEL[f] || f}</option>)}
                      </select>
                    </div>
                    {frequency === 'CUSTOM' ? (
                      <div className="ss-field">
                        <label htmlFor="ss-cd">Pay every how many days?</label>
                        <select id="ss-cd" value={customDays} onChange={e => setCustomDays(Number(e.target.value))}>
                          {product.customIntervalDays.map(d => <option key={d} value={d}>Every {d} days</option>)}
                        </select>
                      </div>
                    ) : (
                      <div className="ss-field">
                        <label htmlFor="ss-dur">Pay it all within how many days?</label>
                        <input id="ss-dur" inputMode="numeric" value={duration} onChange={e => setDuration(e.target.value.replace(/\D/g, ''))} />
                      </div>
                    )}
                  </div>
                  {frequency === 'CUSTOM' && (
                    <div className="ss-field">
                      <label htmlFor="ss-dur2">Pay it all within how many days?</label>
                      <input id="ss-dur2" inputMode="numeric" value={duration} onChange={e => setDuration(e.target.value.replace(/\D/g, ''))} />
                    </div>
                  )}

                  <div className="ss-field">
                    <label htmlFor="ss-dep">How much will you pay today? (₦)</label>
                    <input id="ss-dep" inputMode="decimal" value={deposit} onChange={e => setDeposit(e.target.value.replace(/[^\d.]/g, ''))} />
                    <p className="ss-hint">Pay at least {naira(minDeposit)} today. The rest is split into equal payments below. You must finish within {product.paymentDeadlineDays} days.</p>
                  </div>

                  <div className="ss-field">
                    <label>How should we collect each payment?</label>
                    <div className="ss-checks">
                      <label className={`ss-check ${mode === 'MANUAL' ? 'on' : ''}`}>
                        <input type="radio" name="mode" checked={mode === 'MANUAL'} onChange={() => setMode('MANUAL')} /> I will pay myself
                      </label>
                      <label className={`ss-check ${mode === 'AUTO' ? 'on' : ''}`}>
                        <input type="radio" name="mode" checked={mode === 'AUTO'} onChange={() => setMode('AUTO')} /> Take it from my wallet automatically
                      </label>
                    </div>
                  </div>

                  {localError ? (
                    <div className="ss-note warn">{localError}</div>
                  ) : previewError ? (
                    <div className="ss-note err" role="alert">{previewError}</div>
                  ) : previewing && !preview ? (
                    <div className="ss-skel" style={{ height: 80 }} />
                  ) : preview ? (
                    <div className="ss-stack" style={{ gap: 12 }}>
                      <p className="ss-hint" style={{ margin: 0 }}>Your payment plan</p>
                      <ul className="ss-sched" aria-label="Payment plan" style={{ maxHeight: 260, overflowY: 'auto' }}>
                        <li><span><b>Today</b></span><b>{naira(preview.deposit)}</b></li>
                        {preview.schedule.map(sc => (
                          <li key={sc.number}><span>{fmtDate(sc.dueDate)}</span><b>{naira(sc.amount)}</b></li>
                        ))}
                        <li><span><b>Total</b></span><b>{naira(preview.price)}</b></li>
                      </ul>
                      <p className="ss-hint" style={{ margin: 0 }}>
                        {preview.installmentCount > 0
                          ? <>{preview.installmentCount} payment{preview.installmentCount === 1 ? '' : 's'} after today. All paid by {fmtDate(preview.deadlineAt)}.</>
                          : <>You pay the full price today.</>}
                      </p>
                      <div className="ss-note ok">
                        {preview.refund.offered
                          ? <>You can cancel and get a refund while you have paid less than {preview.refund.belowPercent}% of the price. A {preview.refund.feePercent}% fee is kept.</>
                          : <>This vendor does not offer refunds on this product.</>}
                      </div>
                    </div>
                  ) : null}

                  {startError && (
                    <div className="ss-note err" role="alert" style={{ marginTop: 12 }}>
                      {startError}
                      {insufficient && <div style={{ marginTop: 8 }}><button type="button" className="ss-btn ghost sm" onClick={() => navigate('/wallet')}>Fund my wallet →</button></div>}
                    </div>
                  )}

                  <div className="ss-row">
                    <span className="ss-hint">The first payment comes from your wallet now.</span>
                    <button type="button" className="ss-btn" onClick={() => setPinOpen(true)} disabled={starting || !choice || !preview || !!localError}>
                      {starting ? <><span className="ss-spin" /> Starting…</> : <>Pay {naira(depositNum || 0)} and start →</>}
                    </button>
                  </div>
                </>
              )}
              <div style={{ marginTop: 10 }}><Pill tone="gray">Money is held safely until the plan is finished</Pill></div>
            </div>
          </div>
        )}
        {reportOpen && product && (
          <SsReportModal productId={product.id} vendorName={product.vendor.businessName || undefined} onClose={() => setReportOpen(false)} />
        )}
        {chatThreadId && (
          <Modal title={`Chat with ${product?.vendor.businessName || 'the vendor'}`} onClose={() => setChatThreadId(null)}>
            <SsChat threadId={chatThreadId} height={340} />
          </Modal>
        )}
        {pinOpen && (
          <SsPinModal
            title="Confirm with your PIN"
            summary={`${naira(depositNum || 0)} will be taken from your wallet to start this plan.`}
            confirmLabel={`Pay ${naira(depositNum || 0)} and start`}
            onClose={() => setPinOpen(false)}
            onConfirm={start}
          />
        )}
      </div>
    </DashboardLayout>
  )
}