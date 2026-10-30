// src/pages/vendor/VendorHubPage.tsx   (route: /vendor)
// The vendor's home: products and stock, orders from customers (with chat), and customers who cancelled.
// If the person is not a vendor yet, it shows a card that leads to the application (/become-vendor).

import { useCallback, useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import DashboardLayout from '@/components/layout/DashboardLayout'
import { vendorApi, vendorShopApi } from '@/api/smallSmall'
import {
  SsStyles, SsTabs, Empty, Pill, Progress, Modal, naira, fmtDate, errMsg, unwrap, statusTone, statusLabel,
} from '@/components/ss/ssShared'
import SsChat from '@/components/ss/SsChat'
import { useUIStore } from '@/stores/uiStore'

type Tab = 'PRODUCTS' | 'ORDERS' | 'REFUNDS'

type VProduct = {
  id: string; referenceNumber: string; name: string; price: number; images: string[]
  totalStock: number; reservedCount: number; soldCount: number; availableStock: number
  status: string; isFlagged: boolean
}
type VOrder = {
  id: string; orderNumber: string; status: string; customer: string; chatThreadId: string | null
  product: { name: string }; totalPrice: number; amountPaid: number; percentPaid: number; payoutReleased?: boolean
}
type VRefund = {
  id: string; date: string; reason: string; customer: string; product: { name: string }
  amountPaid: number; percentPaid: number; yourShare: number
}

export default function VendorHubPage() {
  const navigate = useNavigate()
  const [checking, setChecking] = useState(true)
  const [isVendor, setIsVendor] = useState(false)
  const [loadError, setLoadError] = useState('')
  const [tab, setTab] = useState<Tab>('PRODUCTS')

  const check = useCallback(() => {
    setChecking(true)
    vendorApi.me()
      .then(res => { setIsVendor(!!(unwrap(res) as any)?.isVendor); setLoadError('') })
      .catch(e => setLoadError(errMsg(e, 'Could not load your vendor details.')))
      .finally(() => setChecking(false))
  }, [])
  useEffect(() => { check() }, [check])

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
              {([['PRODUCTS', 'Products'], ['ORDERS', 'Customer plans'], ['REFUNDS', 'Cancellations']] as [Tab, string][]).map(([k, l]) => (
                <button key={k} type="button" className={`ss-check ${tab === k ? 'on' : ''}`} onClick={() => setTab(k)}>{l}</button>
              ))}
            </div>

            {tab === 'PRODUCTS' && <ProductsTab />}
            {tab === 'ORDERS' && <OrdersTab />}
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

// ── Customer plans on my products (with chat) ────────────────

function OrdersTab() {
  const [items, setItems] = useState<VOrder[] | null>(null)
  const [error, setError] = useState('')
  const [chatFor, setChatFor] = useState<VOrder | null>(null)

  useEffect(() => {
    vendorShopApi.orders({})
      .then(res => setItems((unwrap(res) as any).items as VOrder[]))
      .catch(e => setError(errMsg(e, 'Could not load orders.')))
  }, [])

  if (error) return <div className="ss-note err" role="alert">{error}</div>
  if (items === null) return <div className="ss-list">{[1, 2].map(i => <div key={i} className="ss-skel" style={{ height: 70 }} />)}</div>
  if (items.length === 0) return <Empty title="No customer plans yet" text="When someone starts paying for one of your products, it shows up here." />
  return (
    <>
      <div className="ss-list">
        {items.map(o => (
          <div key={o.id} className="ss-item">
            <div className="ss-item-main">
              <p className="ss-item-t">{o.product.name}</p>
              <p className="ss-item-s">{o.customer} · {naira(o.amountPaid)} of {naira(o.totalPrice)} · <span className="ss-mono">{o.orderNumber}</span></p>
              <div style={{ marginTop: 8 }}><Progress pct={o.percentPaid} /></div>
            </div>
            <div className="ss-item-r" style={{ display: 'flex', flexDirection: 'column', gap: 6, alignItems: 'flex-end' }}>
              <Pill tone={statusTone(o.status)}>{statusLabel(o.status)}</Pill>
              <p className="ss-item-s">{o.payoutReleased ? 'You have been paid' : 'Money held safely'}</p>
              {o.chatThreadId && <button type="button" className="ss-btn ghost sm" onClick={() => setChatFor(o)}>Chat with {o.customer}</button>}
            </div>
          </div>
        ))}
      </div>

      {chatFor && chatFor.chatThreadId && (
        <Modal title={`Chat: ${chatFor.customer}`} onClose={() => setChatFor(null)}>
          <SsChat threadId={chatFor.chatThreadId} height={340} />
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