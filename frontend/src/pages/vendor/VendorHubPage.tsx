// src/pages/vendor/VendorHubPage.tsx   (route: /vendor)
// The vendor's home: products and stock, customer plans by product (with dispatch and chat), messages, and customers who cancelled.
// If the person is not a vendor yet, it shows a card that leads to the application (/become-vendor).

import { useCallback, useEffect, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import DashboardLayout from '@/components/layout/DashboardLayout'
import { vendorApi, vendorShopApi, chatApi } from '@/api/smallSmall'
import {
  SsStyles, SsTabs, Empty, Pill, Progress, Modal, naira, fmtDate, errMsg, unwrap, statusTone, statusLabel,
} from '@/components/ss/ssShared'
import SsChat from '@/components/ss/SsChat'
import { COURIERS, OWN_DELIVERY, OTHER_COURIER } from '@/components/ss/couriers'
import { useUIStore } from '@/stores/uiStore'

type Tab = 'PRODUCTS' | 'ORDERS' | 'MESSAGES' | 'REFUNDS'

type VProduct = {
  id: string; referenceNumber: string; name: string; price: number; images: string[]
  totalStock: number; reservedCount: number; soldCount: number; availableStock: number
  status: string; isFlagged: boolean
}
type VOrder = {
  id: string; orderNumber: string; status: string; customer: string; chatThreadId: string | null
  product: { name: string }; totalPrice: number; amountPaid: number; percentPaid: number; payoutReleased?: boolean
  fulfillmentStatus: 'PENDING' | 'DISPATCHED' | 'DELIVERED'
  dispatchedAt: string | null; courier: string | null; trackingNumber: string | null; dispatchNote: string | null; deliveredAt: string | null
  deliveryAddress: string | null; gigWaybill: string | null
  deliveryMethod: 'DELIVERY' | 'PICKUP' | null
  deliveryOptionId: string | null; deliveryCarrier: string | null
}
type GigQuote = {
  carrier: string; service: string
  from: { name: string; phone: string; address: string; city: string; state: string }
  to: { name: string; phone: string; address: string; city: string; state: string }
  itemName: string; eta: string; simulated: boolean
  gigFee: number; companyFee: number; total: number; companyFeePercent: number
}
type VOrderProduct = {
  productId: string; name: string; referenceNumber: string; price: number; thumbnail: string | null
  counts: { paying: number; toDispatch: number; dispatched: number; delivered: number; cancelled: number; total: number }
}
type VRefund = {
  id: string; date: string; reason: string; customer: string; product: { name: string }
  amountPaid: number; percentPaid: number; yourShare: number
}

// a link like /vendor?tab=orders opens that tab (products, orders, messages or refunds)
const TAB_FROM_URL: Record<string, Tab> = { products: 'PRODUCTS', orders: 'ORDERS', messages: 'MESSAGES', refunds: 'REFUNDS' }
function tabFromSearch(search: string): Tab | null {
  const t = new URLSearchParams(search).get('tab')
  return t ? TAB_FROM_URL[t] ?? null : null
}

export default function VendorHubPage() {
  const navigate = useNavigate()
  const location = useLocation()
  const [checking, setChecking] = useState(true)
  const [isVendor, setIsVendor] = useState(false)
  const [loadError, setLoadError] = useState('')
  // a link from a "new message" email or notification opens the Messages tab
  const [tab, setTab] = useState<Tab>(() => tabFromSearch(window.location.search) ?? 'PRODUCTS')

  const check = useCallback(() => {
    setChecking(true)
    vendorApi.me()
      .then(res => { setIsVendor(!!(unwrap(res) as any)?.isVendor); setLoadError('') })
      .catch(e => setLoadError(errMsg(e, 'Could not load your vendor details.')))
      .finally(() => setChecking(false))
  }, [])
  useEffect(() => { check() }, [check])

  // when a notification link changes the tab while this page is already open
  useEffect(() => { const t = tabFromSearch(location.search); if (t) setTab(t) }, [location.search])

  return (
    <DashboardLayout title="Sell" subtitle="Your vendor area">
      <div className="ss-root">
        <SsStyles />
        <SsTabs />

        {checking ? (
          <div className="ss-skel" style={{ height: 160 }} />
        ) : loadError ? (
          <div className="ss-card">
            <div className="ss-note err">{loadError}</div>
            <div className="ss-row"><button type="button" className="ss-btn" onClick={check}>Try again →</button></div>
          </div>
        ) : !isVendor ? (
          <Empty
            title="Sell on Pay Small Small"
            text="Apply to become a vendor, and customers can pay for your products small small while the money is held safely until they finish."
            action={<button type="button" className="ss-btn" onClick={() => navigate('/become-vendor')}>Become a vendor →</button>}
          />
        ) : (
          <>
            <div className="ss-head">
              <div>
                <h2 className="ss-title">Your shop</h2>
                <p className="ss-sub">When a customer finishes paying, the money lands in your wallet. Withdraw it from the <button type="button" className="ss-linkbtn" onClick={() => navigate('/wallet')}>wallet</button>.</p>
              </div>
              <button type="button" className="ss-btn" onClick={() => navigate('/vendor/products/new')}>+ New product</button>
            </div>

            <div className="ss-checks">
              {([['PRODUCTS', 'Products'], ['ORDERS', 'Customer plans'], ['MESSAGES', 'Messages'], ['REFUNDS', 'Cancellations']] as [Tab, string][]).map(([k, l]) => (
                <button key={k} type="button" className={`ss-check ${tab === k ? 'on' : ''}`} onClick={() => setTab(k)}>{l}</button>
              ))}
            </div>

            {tab === 'PRODUCTS' && <ProductsTab />}
            {tab === 'ORDERS' && <OrdersTab />}
            {tab === 'MESSAGES' && <MessagesTab />}
            {tab === 'REFUNDS' && <RefundsTab />}
          </>
        )}
      </div>
    </DashboardLayout>
  )
}

// ── Products ─────────────────────────────────────────────────

function ProductsTab() {
  const navigate = useNavigate()
  const { showToast } = useUIStore()
  const [items, setItems] = useState<VProduct[] | null>(null)
  const [error, setError] = useState('')
  const [stockFor, setStockFor] = useState<VProduct | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [showArchived, setShowArchived] = useState(false)

  const load = useCallback(() => {
    vendorShopApi.list({ status: showArchived ? 'ARCHIVED' : undefined })
      .then(res => { setItems((unwrap(res) as any).items as VProduct[]); setError('') })
      .catch(e => setError(errMsg(e, 'Could not load your products.')))
  }, [showArchived])
  useEffect(() => { setItems(null); load() }, [load])

  const setStatus = async (p: VProduct, status: 'ACTIVE' | 'PAUSED' | 'ARCHIVED') => {
    if (status === 'ARCHIVED' && !window.confirm(`Archive "${p.name}"? Customers will not see it any more.`)) return
    setBusyId(p.id); setError('')
    try { await vendorShopApi.setStatus(p.id, status); load() }
    catch (e) { setError(errMsg(e, 'Could not change that product.')) }
    finally { setBusyId(null) }
  }

  return (
    <>
      {error && <div className="ss-note err" role="alert">{error}</div>}
      <div className="ss-row" style={{ marginTop: 0 }}>
        <span className="ss-hint">{showArchived ? 'Archived products' : 'Your live and paused products'}</span>
        <button type="button" className="ss-btn ghost sm" onClick={() => setShowArchived(a => !a)}>{showArchived ? 'Show current products' : 'Show archived'}</button>
      </div>

      {items === null ? (
        <div className="ss-list">{[1, 2].map(i => <div key={i} className="ss-skel" style={{ height: 78 }} />)}</div>
      ) : items.length === 0 ? (
        <Empty title={showArchived ? 'Nothing archived' : 'No products yet'} text={showArchived ? undefined : 'Post your first product so customers can start paying for it.'}
          action={!showArchived ? <button type="button" className="ss-btn" onClick={() => navigate('/vendor/products/new')}>+ New product</button> : undefined} />
      ) : (
        <div className="ss-list">
          {items.map(p => (
            <div key={p.id} className="ss-item">
              <div className="ss-thumb">{p.images[0] ? <img src={p.images[0]} alt="" /> : 'No photo'}</div>
              <div className="ss-item-main">
                <p className="ss-item-t">{p.name}</p>
                <p className="ss-item-s"><span className="ss-mono">{p.referenceNumber}</span> · {naira(p.price)}</p>
                <p className="ss-item-s">
                  <b>{p.availableStock}</b> in stock · {p.reservedCount} being paid for · {p.soldCount} sold
                </p>
              </div>
              <div className="ss-item-r" style={{ display: 'flex', flexDirection: 'column', gap: 6, alignItems: 'flex-end' }}>
                <span>
                  <Pill tone={statusTone(p.status)}>{statusLabel(p.status)}</Pill>
                  {p.isFlagged && <> <Pill tone="red">On hold by support</Pill></>}
                </span>
                {p.status !== 'ARCHIVED' && (
                  <span style={{ display: 'flex', gap: 6, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
                    <button type="button" className="ss-btn ghost sm" onClick={() => navigate(`/vendor/products/${p.id}`)}>Edit</button>
                    <button type="button" className="ss-btn ghost sm" onClick={() => setStockFor(p)}>Stock</button>
                    {p.status === 'ACTIVE' && <button type="button" className="ss-btn ghost sm" disabled={busyId === p.id} onClick={() => setStatus(p, 'PAUSED')}>Pause</button>}
                    {(p.status === 'PAUSED') && !p.isFlagged && <button type="button" className="ss-btn ghost sm" disabled={busyId === p.id} onClick={() => setStatus(p, 'ACTIVE')}>Turn on</button>}
                    <button type="button" className="ss-btn danger sm" disabled={busyId === p.id} onClick={() => setStatus(p, 'ARCHIVED')}>Archive</button>
                  </span>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {stockFor && (
        <StockModal product={stockFor} onClose={() => setStockFor(null)}
          onSaved={() => { setStockFor(null); showToast('Stock updated', 'success'); load() }} />
      )}
    </>
  )
}

function StockModal({ product, onClose, onSaved }: { product: VProduct; onClose: () => void; onSaved: () => void }) {
  const floor = product.reservedCount + product.soldCount
  const [total, setTotal] = useState(String(product.totalStock))
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const n = Number(total)
  const valid = Number.isInteger(n) && n >= floor && n <= 100000

  const save = async () => {
    setBusy(true); setError('')
    try { await vendorShopApi.setStock(product.id, { totalStock: n, reason: reason.trim() || undefined }); onSaved() }
    catch (e) { setError(errMsg(e, 'Could not update the stock.')); setBusy(false) }
  }

  return (
    <Modal title={`Stock: ${product.name}`} onClose={onClose}>
      <p className="ss-p">
        Total stock is everything you have, including units customers are still paying for. You can raise it any time. You cannot go below
        <b> {floor}</b> ({product.reservedCount} being paid for + {product.soldCount} sold).
      </p>
      <div className="ss-field" style={{ marginTop: 14 }}>
        <label htmlFor="ss-stock">Total stock</label>
        <input id="ss-stock" inputMode="numeric" value={total} onChange={e => setTotal(e.target.value.replace(/\D/g, ''))} />
      </div>
      <div className="ss-field">
        <label htmlFor="ss-sreason">Note (optional)</label>
        <input id="ss-sreason" value={reason} onChange={e => setReason(e.target.value)} maxLength={200} placeholder="e.g. new delivery arrived" />
      </div>
      {!valid && total !== '' && <div className="ss-note warn">Enter a number from {floor} up to 100,000.</div>}
      {error && <div className="ss-note err" role="alert">{error}</div>}
      <div className="ss-row end" style={{ marginTop: 12 }}>
        <button type="button" className="ss-btn ghost" onClick={onClose}>Cancel</button>
        <button type="button" className="ss-btn" disabled={!valid || busy || n === product.totalStock} onClick={save}>{busy ? 'Saving…' : 'Save stock'}</button>
      </div>
    </Modal>
  )
}

// ── Customer plans: pick a product, then see everyone paying for it ──

function OrdersTab() {
  const { showToast } = useUIStore()
  const [products, setProducts] = useState<VOrderProduct[] | null>(null)
  const [ready, setReady] = useState<VOrder[] | null>(null)
  const [readyTotal, setReadyTotal] = useState(0)
  const [error, setError] = useState('')
  const [picked, setPicked] = useState<VOrderProduct | null>(null)
  const [gigFor, setGigFor] = useState<VOrder | null>(null)
  const [otherFor, setOtherFor] = useState<VOrder | null>(null)
  const [pickupFor, setPickupFor] = useState<VOrder | null>(null)

  const loadAll = useCallback(() => {
    vendorShopApi.orderProducts()
      .then(res => { setProducts((unwrap(res) as any).items as VOrderProduct[]); setError('') })
      .catch(e => setError(errMsg(e, 'Could not load your orders.')))
    vendorShopApi.orders({ view: 'TO_DISPATCH', page: 1 })
      .then(res => { const d: any = unwrap(res); setReady(d.items as VOrder[]); setReadyTotal(d.total) })
      .catch(() => setReady([]))
  }, [])
  useEffect(() => { loadAll() }, [loadAll])

  if (picked) return <ProductOrders product={picked} onBack={() => { setPicked(null); loadAll() }} />

  if (error) return <div className="ss-note err" role="alert">{error}</div>
  if (products === null) return <div className="ss-list">{[1, 2].map(i => <div key={i} className="ss-skel" style={{ height: 84 }} />)}</div>
  if (products.length === 0) return <Empty title="No customer plans yet" text="When someone starts paying for one of your products, it shows up here." />

  return (
    <>
      <p className="ss-h">Ready to send{readyTotal > 0 ? ` (${readyTotal})` : ''}</p>
      {ready === null ? (
        <div className="ss-skel" style={{ height: 70 }} />
      ) : ready.length === 0 ? (
        <p className="ss-hint" style={{ marginBottom: 18 }}>Nothing to send right now. When a customer finishes paying, the order shows up here. If they want delivery, book the courier they chose in one tap. If they want to pick it up, tell them when it is ready.</p>
      ) : (
        <div className="ss-list" style={{ marginBottom: 18 }}>
          {ready.map(o => (
            <div key={o.id} className="ss-item" style={{ flexWrap: 'wrap' }}>
              <div className="ss-item-main" style={{ minWidth: 220 }}>
                <p className="ss-item-t">{o.product.name}</p>
                <p className="ss-item-s">{o.customer} · {naira(o.totalPrice)} paid in full · <span className="ss-mono">{o.orderNumber}</span></p>
                <p className="ss-item-s" style={{ marginTop: 6 }}>{deliveryNote(o)}</p>
              </div>
              <div className="ss-item-r" style={{ display: 'flex', flexDirection: 'column', gap: 6, alignItems: 'flex-end' }}>
                <SendButton o={o} onGig={setGigFor} onPickup={setPickupFor} />
                {o.chatThreadId && <span className="ss-item-s">Need the address? Use the chat.</span>}
              </div>
            </div>
          ))}
        </div>
      )}

      <p className="ss-h">All customers, by product</p>
      <div className="ss-list">
        {products.map(p => (
          <div key={p.productId} className="ss-item click" role="button" tabIndex={0}
            onClick={() => setPicked(p)} onKeyDown={e => { if (e.key === 'Enter') setPicked(p) }}>
            <div className="ss-thumb">{p.thumbnail ? <img src={p.thumbnail} alt="" /> : 'No photo'}</div>
            <div className="ss-item-main">
              <p className="ss-item-t">{p.name}</p>
              <p className="ss-item-s"><span className="ss-mono">{p.referenceNumber}</span> · {naira(p.price)} · {p.counts.total} customer{p.counts.total === 1 ? '' : 's'}</p>
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 8 }}>
                {p.counts.toDispatch > 0 && <Pill tone="red">{p.counts.toDispatch} to dispatch</Pill>}
                {p.counts.paying > 0 && <Pill tone={statusTone('ACTIVE')}>{p.counts.paying} paying</Pill>}
                {p.counts.dispatched > 0 && <Pill tone={statusTone('PAUSED')}>{p.counts.dispatched} dispatched</Pill>}
                {p.counts.delivered > 0 && <Pill tone={statusTone('COMPLETED')}>{p.counts.delivered} delivered</Pill>}
                {p.counts.cancelled > 0 && <Pill tone={statusTone('ARCHIVED')}>{p.counts.cancelled} cancelled</Pill>}
              </div>
            </div>
          </div>
        ))}
      </div>

      {gigFor && (
        <GigModal order={gigFor} onClose={() => setGigFor(null)}
          onSaved={msg => { setGigFor(null); showToast(msg, 'success'); loadAll() }}
          onOther={() => { setOtherFor(gigFor); setGigFor(null) }} />
      )}
      {otherFor && (
        <DispatchModal order={otherFor} onClose={() => setOtherFor(null)}
          onSaved={msg => { setOtherFor(null); showToast(msg, 'success'); loadAll() }} />
      )}
      {pickupFor && (
        <PickupModal order={pickupFor} onClose={() => setPickupFor(null)}
          onSaved={msg => { setPickupFor(null); showToast(msg, 'success'); loadAll() }} />
      )}
    </>
  )
}

const ORDER_VIEWS: [string, string][] = [
  ['PAYING', 'Paying'], ['TO_DISPATCH', 'To dispatch'], ['DISPATCHED', 'Dispatched'],
  ['DELIVERED', 'Delivered'], ['CANCELLED', 'Cancelled'], ['ALL', 'All'],
]

function ProductOrders({ product, onBack }: { product: VOrderProduct; onBack: () => void }) {
  const { showToast } = useUIStore()
  const c = product.counts
  const countFor: Record<string, number> = { PAYING: c.paying, TO_DISPATCH: c.toDispatch, DISPATCHED: c.dispatched, DELIVERED: c.delivered, CANCELLED: c.cancelled, ALL: c.total }

  // open on the tab that needs the vendor's attention
  const [view, setView] = useState(c.toDispatch > 0 ? 'TO_DISPATCH' : c.paying > 0 ? 'PAYING' : 'ALL')
  const [items, setItems] = useState<VOrder[] | null>(null)
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [error, setError] = useState('')
  const [chatFor, setChatFor] = useState<VOrder | null>(null)
  const [dispatchFor, setDispatchFor] = useState<VOrder | null>(null)
  const [gigFor, setGigFor] = useState<VOrder | null>(null)
  const [pickupFor, setPickupFor] = useState<VOrder | null>(null)

  const load = useCallback((p: number) => {
    vendorShopApi.orders({ productId: product.productId, view, page: p })
      .then(res => {
        const d: any = unwrap(res)
        setTotal(d.total)
        setItems(prev => (p === 1 || !prev ? d.items : [...prev, ...d.items]))
        setError('')
      })
      .catch(e => setError(errMsg(e, 'Could not load these orders.')))
  }, [product.productId, view])
  useEffect(() => { setItems(null); setPage(1); load(1) }, [load])

  const emptyText: Record<string, string> = {
    PAYING: 'Nobody is still paying for this product.',
    TO_DISPATCH: 'Nothing waiting for you to send. When a customer finishes paying, it shows up here.',
    DISPATCHED: 'No goods are on the way right now.',
    DELIVERED: 'No customer has confirmed delivery yet.',
    CANCELLED: 'No cancelled plans for this product.',
    ALL: 'No customers yet.',
  }

  return (
    <>
      <div className="ss-row" style={{ marginTop: 0, justifyContent: 'flex-start', gap: 12 }}>
        <button type="button" className="ss-btn ghost sm" onClick={onBack}>← All products</button>
        <div style={{ minWidth: 0 }}>
          <p className="ss-item-t" style={{ margin: 0 }}>{product.name}</p>
          <p className="ss-item-s" style={{ margin: 0 }}><span className="ss-mono">{product.referenceNumber}</span></p>
        </div>
      </div>

      <div className="ss-checks">
        {ORDER_VIEWS.map(([k, l]) => (
          <button key={k} type="button" className={`ss-check ${view === k ? 'on' : ''}`} onClick={() => setView(k)}>
            {l} ({countFor[k] ?? 0})
          </button>
        ))}
      </div>

      {error && <div className="ss-note err" role="alert">{error}</div>}

      {items === null ? (
        <div className="ss-list">{[1, 2].map(i => <div key={i} className="ss-skel" style={{ height: 80 }} />)}</div>
      ) : items.length === 0 ? (
        <Empty title="Nothing here" text={emptyText[view]} />
      ) : (
        <>
          <div className="ss-list">
            {items.map(o => (
              <div key={o.id} className="ss-item" style={{ flexWrap: 'wrap' }}>
                <div className="ss-item-main" style={{ minWidth: 220 }}>
                  <p className="ss-item-t">{o.customer}</p>
                  <p className="ss-item-s">{naira(o.amountPaid)} of {naira(o.totalPrice)} · <span className="ss-mono">{o.orderNumber}</span></p>
                  <div style={{ marginTop: 8 }}><Progress pct={o.percentPaid} /></div>
                  {o.status === 'COMPLETED' && o.fulfillmentStatus === 'DISPATCHED' && (
                    <p className="ss-item-s" style={{ marginTop: 8 }}>
                      {o.courier === 'Pickup in person' ? <>Ready for the customer to collect</> : <>Sent via <b>{o.courier}</b></>}{o.trackingNumber ? <> · <span className="ss-mono">{o.trackingNumber}</span></> : null}{o.dispatchedAt ? ` · ${fmtDate(o.dispatchedAt)}` : ''}
                    </p>
                  )}
                  {o.status === 'COMPLETED' && o.fulfillmentStatus === 'DELIVERED' && (
                    <p className="ss-item-s" style={{ marginTop: 8 }}>Customer confirmed delivery{o.deliveredAt ? ` · ${fmtDate(o.deliveredAt)}` : ''}</p>
                  )}
                </div>
                <div className="ss-item-r" style={{ display: 'flex', flexDirection: 'column', gap: 6, alignItems: 'flex-end' }}>
                  <Pill tone={statusTone(o.status)}>{statusLabel(o.status)}</Pill>
                  {o.status === 'COMPLETED' && o.fulfillmentStatus === 'PENDING' && (
                    <SendButton o={o} onGig={setGigFor} onPickup={setPickupFor} small />
                  )}
                  {o.status === 'COMPLETED' && o.fulfillmentStatus === 'DISPATCHED' && !o.gigWaybill && o.courier !== 'Pickup in person' && (
                    <button type="button" className="ss-btn ghost sm" onClick={() => setDispatchFor(o)}>Edit delivery</button>
                  )}
                  {o.chatThreadId && <button type="button" className="ss-btn ghost sm" onClick={() => setChatFor(o)}>Chat with {o.customer}</button>}
                </div>
              </div>
            ))}
          </div>
          {items.length < total && (
            <div className="ss-row" style={{ justifyContent: 'center' }}>
              <button type="button" className="ss-btn ghost sm" onClick={() => { const n = page + 1; setPage(n); load(n) }}>Load more</button>
            </div>
          )}
        </>
      )}

      {chatFor && chatFor.chatThreadId && (
        <Modal title={`Chat: ${chatFor.customer}`} onClose={() => setChatFor(null)}>
          <SsChat threadId={chatFor.chatThreadId} height={340} />
        </Modal>
      )}
      {dispatchFor && (
        <DispatchModal order={dispatchFor} onClose={() => setDispatchFor(null)}
          onSaved={msg => { setDispatchFor(null); showToast(msg, 'success'); setItems(null); setPage(1); load(1) }} />
      )}
      {gigFor && (
        <GigModal order={gigFor} onClose={() => setGigFor(null)}
          onSaved={msg => { setGigFor(null); showToast(msg, 'success'); setItems(null); setPage(1); load(1) }}
          onOther={() => { setDispatchFor(gigFor); setGigFor(null) }} />
      )}
      {pickupFor && (
        <PickupModal order={pickupFor} onClose={() => setPickupFor(null)}
          onSaved={msg => { setPickupFor(null); showToast(msg, 'success'); setItems(null); setPage(1); load(1) }} />
      )}
    </>
  )
}

// Book a GIG rider: shows where it is collected, where it goes and the price, then one tap to book
function GigModal({ order, onClose, onSaved, onOther }: { order: VOrder; onClose: () => void; onSaved: (message: string) => void; onOther: () => void }) {
  const [quote, setQuote] = useState<GigQuote | null>(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    vendorShopApi.gigQuote(order.id)
      .then(res => setQuote(unwrap(res) as GigQuote))
      .catch(e => setError(errMsg(e, 'Could not get the delivery price. Please try again.')))
  }, [order.id])

  const book = async () => {
    if (!quote || busy) return
    setBusy(true); setError('')
    try {
      const res: any = await vendorShopApi.gigBook(order.id)
      onSaved((unwrap(res) as any)?.message || 'Rider requested')
    } catch (e) {
      setError(errMsg(e, 'Could not book the rider. Please try again.'))
      setBusy(false)
    }
  }

  const box = { padding: 12, borderRadius: 10, background: 'rgba(0,0,0,0.04)', marginTop: 10 } as const

  return (
    <Modal title={`Book ${quote?.carrier ?? 'courier'}: ${order.product.name}`} onClose={onClose}>
      {!quote && !error && <div className="ss-skel" style={{ height: 160 }} />}

      {quote && (
        <>
          {quote.simulated && <div className="ss-note warn">Test mode: this price is an estimate and no real rider will be called.</div>}
          <div style={box}>
            <p className="ss-hint" style={{ margin: 0 }}>The {quote.carrier} rider ({quote.service}) collects from you</p>
            <p className="ss-p" style={{ margin: '4px 0 0' }}>{quote.from.name} · {quote.from.phone}<br />{quote.from.address}, {quote.from.city}, {quote.from.state}</p>
          </div>
          <div style={box}>
            <p className="ss-hint" style={{ margin: 0 }}>and delivers to {order.customer}</p>
            <p className="ss-p" style={{ margin: '4px 0 0' }}>{quote.to.name} · {quote.to.phone}<br />{quote.to.address}, {quote.to.city}, {quote.to.state}</p>
          </div>
          <div style={box}>
            <div className="ss-kv">
              <div><b>Courier price</b><span>{naira(quote.gigFee)}</span></div>
              <div><b>Service fee ({quote.companyFeePercent}%)</b><span>{naira(quote.companyFee)}</span></div>
              <div><b>Delivery total</b><span>{naira(quote.total)}</span></div>
              <div><b>Arrives in</b><span>{quote.eta}</span></div>
            </div>
          </div>
        </>
      )}

      {error && <div className="ss-note err" role="alert" style={{ marginTop: 10 }}>{error}</div>}

      <div className="ss-row end" style={{ marginTop: 14 }}>
        <button type="button" className="ss-btn ghost" onClick={onClose}>Cancel</button>
        <button type="button" className="ss-btn" disabled={!quote || busy} onClick={book}>{busy ? 'Booking…' : quote ? `Book ${quote.carrier}` : 'Book courier'}</button>
      </div>
      <p className="ss-hint" style={{ marginTop: 10, textAlign: 'center' }}>
        <button type="button" className="ss-linkbtn" onClick={onOther}>I will send it another way</button>
      </p>
    </Modal>
  )
}

// What the vendor should do next for a paid-up order
function deliveryNote(o: VOrder) {
  if (o.deliveryMethod === 'PICKUP') return 'The customer will pick it up in person.'
  if (o.deliveryMethod === 'DELIVERY') {
    if (!o.deliveryAddress) return 'Waiting for the customer to add a delivery address.'
    return o.deliveryOptionId ? `The customer chose ${o.deliveryCarrier ?? 'a courier'}.` : 'Waiting for the customer to choose a courier.'
  }
  return 'Waiting for the customer to choose delivery or pickup.'
}

function SendButton({ o, onGig, onPickup, small }: { o: VOrder; onGig: (o: VOrder) => void; onPickup: (o: VOrder) => void; small?: boolean }) {
  const cls = `ss-btn${small ? ' sm' : ''}`
  if (o.deliveryMethod === 'PICKUP') return <button type="button" className={cls} onClick={() => onPickup(o)}>Ready for pickup</button>
  if (o.deliveryMethod === 'DELIVERY' && o.deliveryAddress && o.deliveryOptionId) {
    return <button type="button" className={cls} onClick={() => onGig(o)}>Book {o.deliveryCarrier ?? 'courier'}</button>
  }
  const label = o.deliveryMethod === 'DELIVERY' ? (o.deliveryAddress ? 'Waiting for courier choice' : 'Waiting for address') : 'Waiting for choice'
  return <button type="button" className={cls} disabled>{label}</button>
}

// The customer collects in person: the vendor says when it is ready
function PickupModal({ order, onClose, onSaved }: { order: VOrder; onClose: () => void; onSaved: (message: string) => void }) {
  const [note, setNote] = useState('')
  const [location, setLocation] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const save = async () => {
    if (busy) return
    setBusy(true); setError('')
    try {
      const res: any = await vendorShopApi.readyForPickup(order.id, { note: note.trim() || undefined, location: location.trim() || undefined })
      onSaved((unwrap(res) as any)?.message || 'Saved')
    } catch (e) {
      setError(errMsg(e, 'Could not save. Please try again.'))
      setBusy(false)
    }
  }

  return (
    <Modal title={`Ready for pickup: ${order.product.name}`} onClose={onClose}>
      <p className="ss-p">{order.customer} chose to collect this in person. When you tell them it is ready, they see where to come and can collect it.</p>
      <div className="ss-field" style={{ marginTop: 12 }}>
        <label htmlFor="ss-ploc">Where should the customer come to collect it?</label>
        <textarea id="ss-ploc" rows={2} value={location} maxLength={300} onChange={e => setLocation(e.target.value)} placeholder="e.g. Shop 5, Ikeja City Mall, Lagos. Ask for David at the counter." />
        <p className="ss-hint">Leave this empty to use the address on your vendor profile.</p>
      </div>
      <div className="ss-field" style={{ marginTop: 12 }}>
        <label htmlFor="ss-pnote">Note for the customer (optional)</label>
        <textarea id="ss-pnote" rows={2} value={note} maxLength={300} onChange={e => setNote(e.target.value)} placeholder="e.g. Open 9am to 5pm. Call me when you arrive." />
      </div>
      {error && <div className="ss-note err" role="alert">{error}</div>}
      <div className="ss-row end" style={{ marginTop: 12 }}>
        <button type="button" className="ss-btn ghost" onClick={onClose}>Cancel</button>
        <button type="button" className="ss-btn" disabled={busy} onClick={save}>{busy ? 'Saving…' : 'Tell the customer'}</button>
      </div>
    </Modal>
  )
}

// The vendor says how the goods were sent: pick a logistics company, add a tracking number and a note
function DispatchModal({ order, onClose, onSaved }: { order: VOrder; onClose: () => void; onSaved: (message: string) => void }) {
  const known = !!order.courier && (COURIERS.includes(order.courier) || order.courier === OWN_DELIVERY)
  const [choice, setChoice] = useState(order.courier ? (known ? order.courier : OTHER_COURIER) : '')
  const [otherName, setOtherName] = useState(order.courier && !known ? order.courier : '')
  const [tracking, setTracking] = useState(order.trackingNumber || '')
  const [note, setNote] = useState(order.dispatchNote || '')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const own = choice === OWN_DELIVERY
  const courierName = choice === OTHER_COURIER ? otherName.trim() : choice
  const valid = courierName.length >= 2
  const editing = order.fulfillmentStatus === 'DISPATCHED'

  const save = async () => {
    if (!valid || busy) return
    setBusy(true); setError('')
    try {
      const res: any = await vendorShopApi.dispatch(order.id, {
        courier: courierName,
        trackingNumber: own ? undefined : tracking.trim() || undefined,
        note: note.trim() || undefined,
      })
      onSaved((unwrap(res) as any)?.message || 'Saved')
    } catch (e) {
      setError(errMsg(e, 'Could not save the delivery details.'))
      setBusy(false)
    }
  }

  return (
    <Modal title={`${editing ? 'Edit delivery' : 'Dispatch'}: ${order.product.name}`} onClose={onClose}>
      <p className="ss-p">For {order.customer}. The customer is told straight away and can confirm when the goods arrive.</p>

      <div className="ss-field" style={{ marginTop: 12 }}>
        <label htmlFor="ss-courier">How are you sending it?</label>
        <select id="ss-courier" value={choice} onChange={e => setChoice(e.target.value)}>
          <option value="">Choose a logistics company</option>
          {COURIERS.map(n => <option key={n} value={n}>{n}</option>)}
          <option value={OWN_DELIVERY}>{OWN_DELIVERY}</option>
          <option value={OTHER_COURIER}>Other (type the name)</option>
        </select>
      </div>

      {choice === OTHER_COURIER && (
        <div className="ss-field">
          <label htmlFor="ss-courier-other">Name of the company</label>
          <input id="ss-courier-other" value={otherName} maxLength={60} onChange={e => setOtherName(e.target.value)} />
        </div>
      )}

      {!own && choice && (
        <div className="ss-field">
          <label htmlFor="ss-track">Tracking or waybill number (optional)</label>
          <input id="ss-track" value={tracking} maxLength={60} onChange={e => setTracking(e.target.value)} />
        </div>
      )}

      <div className="ss-field">
        <label htmlFor="ss-dnote">Note for the customer (optional)</label>
        <textarea id="ss-dnote" rows={2} value={note} maxLength={300} onChange={e => setNote(e.target.value)} placeholder="e.g. It should arrive in 2 to 3 days. The rider will call you." />
      </div>

      {error && <div className="ss-note err" role="alert">{error}</div>}
      <div className="ss-row end" style={{ marginTop: 12 }}>
        <button type="button" className="ss-btn ghost" onClick={onClose}>Cancel</button>
        <button type="button" className="ss-btn" disabled={!valid || busy} onClick={save}>{busy ? 'Saving…' : editing ? 'Save changes' : 'Mark as dispatched'}</button>
      </div>
    </Modal>
  )
}

// ── Messages: everyone who wrote to me, even before buying ───

type VThread = {
  threadId: string; customerName: string; productName: string
  lastMessage: string | null; lastMessageAt: string | null; unread: number; hasPlan: boolean
}

function MessagesTab() {
  const [items, setItems] = useState<VThread[] | null>(null)
  const [error, setError] = useState('')
  const [open, setOpen] = useState<VThread | null>(null)

  const load = useCallback(() => {
    chatApi.vendorThreads()
      .then(res => { setItems((unwrap(res) as any).items as VThread[]); setError('') })
      .catch(e => setError(errMsg(e, 'Could not load your messages.')))
  }, [])
  useEffect(() => {
    load()
    const timer = setInterval(() => { if (document.visibilityState === 'visible') load() }, 15000)
    return () => clearInterval(timer)
  }, [load])

  if (error) return <div className="ss-note err" role="alert">{error}</div>
  if (items === null) return <div className="ss-list">{[1, 2].map(i => <div key={i} className="ss-skel" style={{ height: 70 }} />)}</div>
  if (items.length === 0) return <Empty title="No messages yet" text="When a customer writes to you about a product, the conversation shows up here." />
  return (
    <>
      <div className="ss-list">
        {items.map(t => (
          <div key={t.threadId} className="ss-item click" role="button" tabIndex={0}
            onClick={() => setOpen(t)} onKeyDown={e => { if (e.key === 'Enter') setOpen(t) }}>
            <div className="ss-item-main">
              <p className="ss-item-t">{t.customerName} · {t.productName}</p>
              <p className="ss-item-s" style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{t.lastMessage || 'No messages yet'}</p>
            </div>
            <div className="ss-item-r" style={{ display: 'flex', flexDirection: 'column', gap: 6, alignItems: 'flex-end' }}>
              {t.unread > 0 && <Pill tone={statusTone('ACTIVE')}>{t.unread} new</Pill>}
              <p className="ss-item-s">{t.hasPlan ? 'Paying' : 'Not bought yet'}{t.lastMessageAt ? ` · ${fmtDate(t.lastMessageAt)}` : ''}</p>
            </div>
          </div>
        ))}
      </div>

      {open && (
        <Modal title={`Chat: ${open.customerName}`} onClose={() => { setOpen(null); load() }}>
          <SsChat threadId={open.threadId} height={340} />
        </Modal>
      )}
    </>
  )
}

// ── Customers who cancelled (with my 3% share) ───────────────

function RefundsTab() {
  const [items, setItems] = useState<VRefund[] | null>(null)
  const [error, setError] = useState('')
  useEffect(() => {
    vendorShopApi.refunds({})
      .then(res => setItems((unwrap(res) as any).items as VRefund[]))
      .catch(e => setError(errMsg(e, 'Could not load cancellations.')))
  }, [])

  if (error) return <div className="ss-note err" role="alert">{error}</div>
  if (items === null) return <div className="ss-list">{[1, 2].map(i => <div key={i} className="ss-skel" style={{ height: 70 }} />)}</div>
  if (items.length === 0) return <Empty title="No cancellations" text="When a customer cancels and gets their money back, you see it here, with the share you received." />
  return (
    <div className="ss-list">
      {items.map(r => (
        <div key={r.id} className="ss-item">
          <div className="ss-item-main">
            <p className="ss-item-t">{r.product.name}</p>
            <p className="ss-item-s">{r.customer} · paid {naira(r.amountPaid)} ({r.percentPaid}%) · {fmtDate(r.date)}</p>
          </div>
          <div className="ss-item-r">
            <p className="ss-item-t" style={{ color: '#166534' }}>+{naira(r.yourShare)}</p>
            <p className="ss-item-s">{r.reason === 'DEFAULT' ? 'Missed payments' : 'Customer cancelled'}</p>
          </div>
        </div>
      ))}
    </div>
  )
}