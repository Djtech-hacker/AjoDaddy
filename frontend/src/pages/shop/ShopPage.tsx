// src/pages/shop/ShopPage.tsx
// Browse and search products that customers can pay for small small.

import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import DashboardLayout from '@/components/layout/DashboardLayout'
import { shopApi } from '@/api/smallSmall'
import { SsStyles, SsTabs, Empty, Pill, naira, errMsg, unwrap, useDebounced, FREQ_LABEL } from '@/components/ss/ssShared'
import VerifiedBadge from '@/components/ss/VerifiedBadge'

type Product = {
  id: string
  name: string
  price: number
  thumbnail: string | null
  category?: string | null
  inStock: boolean
  minDepositPercent: number
  allowedFrequencies: string[]
  paymentDeadlineDays: number
  vendor: { businessName: string | null; isVerified?: boolean }
 
}

type Page = { items: Product[]; total: number; page: number; pageSize: number }

const CATEGORIES = ['Phones & Gadgets', 'Electronics', 'Fashion', 'Home & Living', 'Beauty', 'Groceries', 'Vehicles & Parts', 'Other']

export default function ShopPage() {
  const navigate = useNavigate()
  const [q, setQ] = useState('')
  const dq = useDebounced(q.trim(), 350)
  const [category, setCategory] = useState('')
  const [page, setPage] = useState(1)
  const [data, setData] = useState<Page | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => { setPage(1) }, [dq, category])

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    shopApi.list({ q: dq || undefined, category: category || undefined, page })
      .then(res => { if (!cancelled) { setData(unwrap(res) as Page); setError('') } })
      .catch(e => { if (!cancelled) setError(errMsg(e, 'Could not load products.')) })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [dq, category, page])

  const pages = data ? Math.max(1, Math.ceil(data.total / data.pageSize)) : 1

  return (
    <DashboardLayout title="Shop" subtitle="Pay small small">
      <div className="ss-root">
        <SsStyles />
        <SsTabs />

        <div className="ss-head">
          <div>
            <h2 className="ss-title">Get it now, pay small small</h2>
            <p className="ss-sub">Pick a product, choose how you want to pay, and take it home when you finish.</p>
          </div>
        </div>

        <div className="ss-two">
          <div className="ss-field">
            <label htmlFor="ss-q">Search</label>
            <input id="ss-q" value={q} onChange={e => setQ(e.target.value)} placeholder="Product name, or a reference like SS-2026-123456" />
          </div>
          <div className="ss-field">
            <label htmlFor="ss-cat">Category</label>
            <select id="ss-cat" value={category} onChange={e => setCategory(e.target.value)}>
              <option value="">All categories</option>
              {CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
            </select>
          </div>
        </div>

        {error && <div className="ss-note err" role="alert">{error}</div>}

        {loading && !data ? (
          <div className="ss-grid">{[1, 2, 3, 4].map(i => <div key={i} className="ss-skel" style={{ height: 230 }} />)}</div>
        ) : data && data.items.length === 0 ? (
          <Empty
            title={dq || category ? 'Nothing matches your search' : 'No products yet'}
            text={dq || category ? 'Try a different word, or clear the category.' : 'Vendors are getting set up. Check back soon.'}
          />
        ) : (
          <>
            <div className="ss-grid">
              {data?.items.map(p => (
                <button key={p.id} type="button" className="ss-prod" onClick={() => navigate(`/shop/${p.id}`)}>
                  <div className="ss-prod-img">{p.thumbnail ? <img src={p.thumbnail} alt={p.name} loading="lazy" /> : 'No photo'}</div>
                  <div className="ss-prod-b">
                    <span className="ss-prod-n">{p.name}</span>
                    <span className="ss-prod-p">{naira(p.price)}</span>
                    <span className="ss-prod-m">
                      From {naira(Math.ceil((p.price * p.minDepositPercent) / 100))} down · up to {p.paymentDeadlineDays} days
                    </span>
                    <span className="ss-prod-m">{p.allowedFrequencies.map(f => FREQ_LABEL[f] || f).join(' · ')}</span>
                                         <span className="ss-prod-m">
                      {p.vendor.businessName || 'Vendor'}
                      {p.vendor.isVerified && <VerifiedBadge />}
                    </span>
                    {!p.inStock && <Pill tone="amber">Sold out</Pill>}
                  </div>
                </button>
              ))}
            </div>

            {pages > 1 && (
              <div className="ss-pager">
                <button type="button" className="ss-btn ghost sm" disabled={page <= 1} onClick={() => setPage(p => p - 1)}>← Previous</button>
                <span>Page {page} of {pages}</span>
                <button type="button" className="ss-btn ghost sm" disabled={page >= pages} onClick={() => setPage(p => p + 1)}>Next →</button>
              </div>
            )}
          </>
        )}
      </div>
    </DashboardLayout>
  )
}