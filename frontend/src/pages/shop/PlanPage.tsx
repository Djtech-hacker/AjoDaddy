// src/pages/shop/PlanPage.tsx
// One plan: progress, what is due, pay now, switch auto/manual, delivery, chat with the vendor, cancel for a refund.

import { useCallback, useEffect, useRef, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import DashboardLayout from '@/components/layout/DashboardLayout'
import { planApi } from '@/api/smallSmall'
import {
  SsStyles, SsTabs, Pill, Progress, Modal, naira, fmtDate, errMsg, unwrap, newKey, statusTone, statusLabel, FREQ_LABEL,
} from '@/components/ss/ssShared'
import SsChat from '@/components/ss/SsChat'
import SsReportModal from '@/components/ss/SsReportModal'
import SsPinModal from '@/components/ss/SsPinModal'
import ExactLocation, { type GeoFix } from '@/components/ss/ExactLocation'
import { useUIStore } from '@/stores/uiStore'

const PICKUP_LABEL = 'Pickup in person'

type CourierOption = { id: string; carrier: string; service: string; eta: string; simulated: boolean; gigFee: number; companyFee: number; total: number }
type DeliveryQuote = { kind: string; companyFeePercent: number; options: CourierOption[] }

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
  // delivery (only used once the plan is COMPLETED)
  fulfillmentStatus: 'PENDING' | 'DISPATCHED' | 'DELIVERED'
  dispatchedAt: string | null
  courier: string | null
  trackingNumber: string | null
  dispatchNote: string | null
  deliveredAt: string | null
  deliveryName: string | null
  deliveryPhone: string | null
  deliveryAddress: string | null
  deliveryCity: string | null
  deliveryState: string | null
  suggestedAddress?: Address | null
  deliveryMethod: 'DELIVERY' | 'PICKUP' | null
  deliveryOptionId?: string | null
  deliveryLat?: number | null
  deliveryLng?: number | null
  deliveryCarrier?: string | null
  pickupAddress?: { name: string | null; phone: string | null; address: string } | null
  gigSimulated: boolean
  deliveryFee: number | null
  deliveryCompanyFee: number | null
  deliveryTotal: number | null
}

type Address = { name: string; phone: string; address: string; city: string; state: string }
const EMPTY_ADDRESS: Address = { name: '', phone: '', address: '', city: '', state: '' }

const NG_STATES = ['Abia','Adamawa','Akwa Ibom','Anambra','Bauchi','Bayelsa','Benue','Borno','Cross River','Delta','Ebonyi','Edo','Ekiti','Enugu','FCT Abuja','Gombe','Imo','Jigawa','Kaduna','Kano','Katsina','Kebbi','Kogi','Kwara','Lagos','Nasarawa','Niger','Ogun','Ondo','Osun','Oyo','Plateau','Rivers','Sokoto','Taraba','Yobe','Zamfara']

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
  const [pinOpen, setPinOpen] = useState(false)
  const [reportOpen, setReportOpen] = useState(false)
  const [receiving, setReceiving] = useState(false)
  const [method, setMethod] = useState<'DELIVERY' | 'PICKUP' | null>(null)
  const [quote, setQuote] = useState<DeliveryQuote | null>(null)
  const [quoteError, setQuoteError] = useState('')
  const [pickedOpt, setPickedOpt] = useState<string | null>(null)
  const [geo, setGeo] = useState<GeoFix | null>(null)
  const [addr, setAddr] = useState<Address>(EMPTY_ADDRESS)
  const [addrOpen, setAddrOpen] = useState(false)
  const [addrBusy, setAddrBusy] = useState(false)

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

  // fill the address form: the saved address, or the one from the customer's profile
  useEffect(() => {
    if (!plan) return
    if (plan.deliveryAddress) {
      setAddr({ name: plan.deliveryName || '', phone: plan.deliveryPhone || '', address: plan.deliveryAddress, city: plan.deliveryCity || '', state: plan.deliveryState || '' })
      setAddrOpen(false)
    } else {
      setAddr(plan.suggestedAddress || EMPTY_ADDRESS)
      setAddrOpen(true)
    }
  }, [plan?.id, plan?.deliveryAddress]) // eslint-disable-line react-hooks/exhaustive-deps

  // the courier the customer picked (kept locally so the tick appears instantly)
  useEffect(() => { if (plan) setPickedOpt(plan.deliveryOptionId ?? null) }, [plan?.id, plan?.deliveryOptionId]) // eslint-disable-line react-hooks/exhaustive-deps

  // the exact spot shared from the customer's phone
  useEffect(() => {
    if (plan && typeof plan.deliveryLat === 'number' && typeof plan.deliveryLng === 'number') setGeo({ lat: plan.deliveryLat, lng: plan.deliveryLng, acc: 0 })
    else setGeo(null)
  }, [plan?.id, plan?.deliveryLat, plan?.deliveryLng]) // eslint-disable-line react-hooks/exhaustive-deps

  // how the customer wants the goods (delivery or pickup)
  useEffect(() => { if (plan) setMethod(plan.deliveryMethod ?? null) }, [plan?.id, plan?.deliveryMethod]) // eslint-disable-line react-hooks/exhaustive-deps

  // the delivery price: asked for once delivery is chosen and an address is saved
  useEffect(() => {
    setQuote(null); setQuoteError('')
    if (!plan || plan.deliveryMethod !== 'DELIVERY' || !plan.deliveryAddress || plan.fulfillmentStatus !== 'PENDING') return
    let alive = true
    planApi.deliveryQuote(plan.id)
      .then(res => { if (alive) setQuote(unwrap(res) as DeliveryQuote) })
      .catch(e => { if (alive) setQuoteError(errMsg(e, 'Could not get the delivery price right now.')) })
    return () => { alive = false }
  }, [plan?.id, plan?.deliveryMethod, plan?.deliveryAddress, plan?.deliveryCity, plan?.deliveryState, plan?.fulfillmentStatus]) // eslint-disable-line react-hooks/exhaustive-deps

  // what is due right now (installments whose date has come and are not fully paid)
  const now = Date.now()
  const leftOf = (i: Installment) => Math.max(0, Math.round((i.amount - i.paidAmount) * 100) / 100)
  const dueNow = plan ? plan.installments.reduce((t, i) => (i.status !== 'PAID' && new Date(i.dueDate).getTime() <= now ? t + leftOf(i) : t), 0) : 0
  const nextInst = plan?.installments.find(i => i.status !== 'PAID')
  const nextAmount = nextInst ? leftOf(nextInst) : 0

  // pre-fill the amount with what is due (or the next installment)
  useEffect(() => {
    if (plan && plan.status === 'ACTIVE' && amount === '') {
      const suggested = dueNow > 0 ? dueNow : nextAmount
      if (suggested > 0) setAmount(String(Math.min(suggested, plan.amountRemaining)))
    }
  }, [plan]) // eslint-disable-line react-hooks/exhaustive-deps

  const amountNum = Number(amount)
  const amountOk = plan ? amountNum >= Math.min(100, plan.amountRemaining) && amountNum <= plan.amountRemaining : false

  const pay = async (pin: string) => {
    if (!plan || !amountOk) return
    setError(''); setPaying(true)
    try {
      await planApi.pay(plan.id, { amount: amountNum, idempotencyKey: payKey.current }, pin)
      payKey.current = newKey()
      setAmount('')
      setPinOpen(false)
      showToast('Payment received', 'success')
      await load()
    } catch (e) {
      const m = errMsg(e, 'Could not take that payment. Please try again.')
      if (/pin/i.test(m) && !/insufficient/i.test(m)) throw new Error(m)
      setPinOpen(false); setError(m)
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

  const addrOk = addr.name.trim().length > 1 && addr.phone.trim().length >= 7 && addr.address.trim().length >= 5 && addr.city.trim().length > 0 && addr.state.trim().length > 0

  const saveAddress = async () => {
    if (!plan || !addrOk) return
    setError(''); setAddrBusy(true)
    try { await planApi.setAddress(plan.id, { ...addr, latitude: geo?.lat, longitude: geo?.lng }); showToast('Delivery address saved', 'success'); await load() }
    catch (e) { setError(errMsg(e, 'Could not save the address. Please try again.')) }
    finally { setAddrBusy(false) }
  }

  const chooseOption = async (optionId: string) => {
    if (!plan || pickedOpt === optionId) return
    const before = pickedOpt
    setError(''); setPickedOpt(optionId) // tick it straight away, save it in the background
    try { await planApi.setOption(plan.id, optionId); load() }
    catch (e) { setPickedOpt(before); setError(errMsg(e, 'Could not save your courier choice. Please try again.')) }
  }

  const chooseMethod = async (m: 'DELIVERY' | 'PICKUP') => {
    if (!plan || method === m) return
    const before = method
    setError(''); setMethod(m) // show the choice straight away, save it in the background
    try { await planApi.setMethod(plan.id, m); load() }
    catch (e) { setMethod(before); setError(errMsg(e, 'Could not save your choice. Please try again.')) }
  }

  // The customer says the goods arrived
  const markReceived = async () => {
    if (!plan) return
    if (!window.confirm('Confirm that you received your goods?')) return
    setError(''); setReceiving(true)
    try { await planApi.received(plan.id); showToast('Thanks for confirming', 'success'); await load() }
    catch (e) { setError(errMsg(e, 'Could not save that. Please try again.')) }
    finally { setReceiving(false) }
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
            {(plan.status === 'ACTIVE' || plan.status === 'COMPLETED') && plan.fulfillmentStatus === 'PENDING' && (
              <div className="ss-card">
                <p className="ss-h">How do you want your goods?</p>
                <div className="ss-checks">
                  <button type="button" className={`ss-check ${method === 'DELIVERY' ? 'on' : ''}`} onClick={() => chooseMethod('DELIVERY')}>🚚 Deliver to me</button>
                  <button type="button" className={`ss-check ${method === 'PICKUP' ? 'on' : ''}`} onClick={() => chooseMethod('PICKUP')}>🏬 I will pick it up</button>
                </div>
                {method === null && <p className="ss-hint">Choose one. You can change your mind until the vendor sends your goods or says they are ready.</p>}
                {method === 'PICKUP' && (
                  <p className="ss-p">You will collect your goods from the vendor yourself. When they are ready, the vendor tells you and you will see where to go right here.</p>
                )}
                {method === 'DELIVERY' && (!addrOpen && plan.deliveryAddress ? (
                  <>
                    <p className="ss-p">{plan.deliveryName} · {plan.deliveryPhone}<br />{plan.deliveryAddress}, {plan.deliveryCity}, {plan.deliveryState}</p>
                    {plan.deliveryLat != null && <p className="ss-hint">📍 Your exact location is saved for the rider.</p>}
                    {quote ? (
                      <div style={{ marginTop: 10 }}>
                        <p className="ss-hint" style={{ margin: '0 0 6px' }}><b>{quote.kind}</b> · choose a courier</p>
                        <div className="ss-list">
                          {quote.options.map(op => {
                            const on = pickedOpt === op.id
                            return (
                              <div key={op.id} className="ss-item click" role="button" tabIndex={0}
                                style={on ? { borderColor: '#16a34a', background: 'rgba(22,163,74,0.06)' } : undefined}
                                onClick={() => chooseOption(op.id)} onKeyDown={e => { if (e.key === 'Enter') chooseOption(op.id) }}>
                                <div className="ss-item-main">
                                  <p className="ss-item-t">{op.carrier} · {op.service}{on ? ' ✓' : ''}</p>
                                  <p className="ss-item-s">Arrives: {op.eta} · courier {naira(op.gigFee)} + {quote.companyFeePercent}% service fee {naira(op.companyFee)}</p>
                                </div>
                                <div className="ss-item-r"><p className="ss-item-t">{naira(op.total)}</p></div>
                              </div>
                            )
                          })}
                        </div>
                        {quote.options.some(op => op.simulated) && <p className="ss-hint">Test mode: these prices are only estimates.</p>}
                        {!pickedOpt && <p className="ss-hint">Tap one to choose it. The vendor can book it once you have chosen.</p>}
                      </div>
                    ) : quoteError ? (
                      <p className="ss-hint">{quoteError}</p>
                    ) : (
                      <p className="ss-hint">Getting the delivery price…</p>
                    )}
                    <div className="ss-row end"><button type="button" className="ss-btn ghost sm" onClick={() => setAddrOpen(true)}>Change address</button></div>
                  </>
                ) : (
                  <>
                    <p className="ss-hint">The delivery rider uses this when your goods are ready. You can add it now or after you finish paying.</p>
                    <div className="ss-field"><label htmlFor="ss-a-name">Receiver's name</label>
                      <input id="ss-a-name" value={addr.name} maxLength={80} onChange={e => setAddr({ ...addr, name: e.target.value })} /></div>
                    <div className="ss-field"><label htmlFor="ss-a-phone">Phone number</label>
                      <input id="ss-a-phone" inputMode="tel" value={addr.phone} maxLength={20} onChange={e => setAddr({ ...addr, phone: e.target.value })} /></div>
                    <div className="ss-field"><label htmlFor="ss-a-addr">House number and street</label>
                      <input id="ss-a-addr" value={addr.address} maxLength={200} onChange={e => setAddr({ ...addr, address: e.target.value })} /></div>
                    <div className="ss-field"><label htmlFor="ss-a-city">City or area</label>
                      <input id="ss-a-city" value={addr.city} maxLength={60} onChange={e => setAddr({ ...addr, city: e.target.value })} /></div>
                    <div className="ss-field"><label htmlFor="ss-a-state">State</label>
                      <select id="ss-a-state" value={addr.state} onChange={e => setAddr({ ...addr, state: e.target.value })}>
                        <option value="">Choose a state</option>
                        {NG_STATES.map(s => <option key={s} value={s}>{s}</option>)}
                      </select></div>

                    <ExactLocation
                      value={geo}
                      onChange={setGeo}
                      onAddress={a => setAddr(prev => ({
                        ...prev,
                        address: prev.address || a.address,
                        city: prev.city || a.city,
                        state: NG_STATES.includes(a.state) ? a.state : prev.state,
                      }))}
                    />

                    {!addrOk && (
                      <p className="ss-hint">
                        To save, fill in: {[
                          addr.name.trim().length <= 1 && "receiver's name",
                          addr.phone.trim().length < 7 && 'phone number',
                          addr.address.trim().length < 5 && 'house number and street',
                          !addr.city.trim() && 'city or area',
                          !addr.state.trim() && 'state',
                        ].filter(Boolean).join(', ')}.
                      </p>
                    )}
                    <div className="ss-row end">
                      {plan.deliveryAddress && <button type="button" className="ss-btn ghost" onClick={() => setAddrOpen(false)}>Cancel</button>}
                      <button type="button" className="ss-btn" disabled={!addrOk || addrBusy} onClick={saveAddress}>{addrBusy ? 'Saving…' : 'Save address'}</button>
                    </div>
                  </>
                ))}
              </div>
            )}
            {plan.status === 'COMPLETED' && (
              <div className="ss-card">
                <p className="ss-h">Delivery</p>
                {plan.fulfillmentStatus === 'DELIVERED' ? (
                  <p className="ss-p">You confirmed you received your goods{plan.deliveredAt ? ` on ${fmtDate(plan.deliveredAt)}` : ''}. Thank you.</p>
                ) : plan.fulfillmentStatus === 'DISPATCHED' ? (
                  <>
                    {plan.courier === PICKUP_LABEL ? (
                      <>
                        <p className="ss-p"><b>Your goods are ready for pickup.</b></p>
                        {plan.pickupAddress && (
                          <>
                            <p className="ss-p" style={{ whiteSpace: 'pre-wrap' }}>
                              {plan.pickupAddress.name}{plan.pickupAddress.phone ? ` · ${plan.pickupAddress.phone}` : ''}<br />{plan.pickupAddress.address}
                            </p>
                            <p className="ss-hint">
                              <a href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(plan.pickupAddress.address)}`} target="_blank" rel="noreferrer">Open in Google Maps</a>
                            </p>
                          </>
                        )}
                      </>
                    ) : (
                      <p className="ss-p">
                        Dispatched via <b>{plan.courier}</b>
                        {plan.trackingNumber ? <> · tracking <span className="ss-mono">{plan.trackingNumber}</span></> : null}
                        {plan.dispatchedAt ? ` · ${fmtDate(plan.dispatchedAt)}` : ''}.
                      </p>
                    )}
                    {plan.dispatchNote && <p className="ss-hint">{plan.dispatchNote}</p>}
                    {plan.deliveryTotal != null && (
                      <p className="ss-hint">Delivery cost: {naira(plan.deliveryTotal)} (courier {naira(plan.deliveryFee ?? 0)} + service fee {naira(plan.deliveryCompanyFee ?? 0)})</p>
                    )}
                    {plan.gigSimulated && <p className="ss-hint">Test mode: this is a simulated booking, no real rider was called.</p>}
                    <div className="ss-row end">
                      <button type="button" className="ss-btn" disabled={receiving} onClick={markReceived}>{receiving ? 'Please wait…' : 'I have received my goods'}</button>
                    </div>
                  </>
                ) : (
                  <p className="ss-p">{method === 'PICKUP' ? 'Waiting for the vendor to get your goods ready for pickup. You will be told as soon as they are, and you can chat with them below.' : 'Waiting for the vendor to dispatch your goods. You will be told as soon as they do, and you can chat with them below.'}</p>
                )}
              </div>
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
                  <span style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                    <button type="button" className="ss-btn ghost sm" onClick={() => setReportOpen(true)}>🚩 Report vendor</button>
                    <button type="button" className="ss-btn ghost sm" onClick={() => setChatOpen(o => !o)}>{chatOpen ? 'Close chat' : 'Open chat'}</button>
                  </span>
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
                  <button type="button" className="ss-btn" disabled={paying || !amountOk} onClick={() => setPinOpen(true)}>
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
              {nextInst && nextInst.paidAmount > 0 && (
                <p className="ss-hint" style={{ marginTop: 0 }}>
                  Installment {nextInst.number}: you have paid {naira(nextInst.paidAmount)} of {naira(nextInst.amount)}, so {naira(leftOf(nextInst))} is left on it.
                </p>
              )}
              {plan.installments.length === 0 ? (
                <p className="ss-p">You paid the full price upfront. Nothing left to schedule.</p>
              ) : (
                <div style={{ overflowX: 'auto' }}>
                  <table className="ss-table">
                    <thead><tr><th>#</th><th>Due</th><th>Amount</th><th>Left to pay</th><th>Status</th></tr></thead>
                    <tbody>
                      {plan.installments.map(i => (
                        <tr key={i.number}>
                          <td>{i.number}</td><td>{fmtDate(i.dueDate)}</td>
                          <td>
                            {naira(i.amount)}
                            {i.status !== 'PAID' && i.paidAmount > 0 && <div className="ss-hint" style={{ margin: 0 }}>paid {naira(i.paidAmount)}</div>}
                          </td>
                          <td>{i.status === 'PAID' ? '—' : <b>{naira(leftOf(i))}</b>}</td>
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

            {reportOpen && (
              <SsReportModal orderId={plan.id} vendorName={plan.vendor.businessName || undefined} onClose={() => setReportOpen(false)} />
            )}

            {pinOpen && (
              <SsPinModal
                title="Confirm with your PIN"
                summary={`${naira(amountNum || 0)} will be taken from your wallet.`}
                confirmLabel={`Pay ${naira(amountNum || 0)}`}
                onClose={() => setPinOpen(false)}
                onConfirm={pay}
              />
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