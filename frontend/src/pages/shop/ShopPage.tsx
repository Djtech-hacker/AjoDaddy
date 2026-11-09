// src/pages/shop/ShopPage.tsx
// Browse and search products that customers can pay for small small.
// Products sit side by side (2 across on a phone, 3 on a tablet, 4 on a computer)
// and slide in one after another. The look for this page lives in ShopStyles below.

import { useEffect, useState } from 'react'
import type { CSSProperties } from 'react'
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

// Page-only styles. Everything starts with .ss-shop so nothing else in the app is touched.
function ShopStyles() {
  return (
    <style>{`
      /* ── the grid: products side by side ── */
      .ss-shop .ss-grid {
        display: grid;
        grid-template-columns: repeat(2, minmax(0, 1fr));
        gap: 12px;
      }
      @media (min-width: 640px)  { .ss-shop .ss-grid { grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 16px; } }
      @media (min-width: 1000px) { .ss-shop .ss-grid { grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 18px; } }

      /* ── a product card ── */
      .ss-shop .ss-prod {
        display: flex;
        flex-direction: column;
        width: 100%;
        padding: 0;
        overflow: hidden;
        text-align: left;
        cursor: pointer;
        background: #fff;
        border: 1px solid rgba(15, 23, 42, 0.08);
        border-radius: 16px;
        box-shadow: 0 1px 2px rgba(15, 23, 42, 0.04);
        transition: transform .28s cubic-bezier(.2,.8,.2,1), box-shadow .28s ease, border-color .28s ease;
        animation: ssShopIn .5s cubic-bezier(.2,.8,.2,1) both;
        animation-delay: calc(var(--i, 0) * 50ms);
      }
      .ss-shop .ss-prod:hover {
        transform: translateY(-4px);
        box-shadow: 0 14px 30px rgba(15, 23, 42, 0.12);
        border-color: rgba(22, 163, 74, 0.45);
      }
      .ss-shop .ss-prod:active { transform: translateY(-1px) scale(.99); }
      .ss-shop .ss-prod:focus-visible { outline: 2px solid #16a34a; outline-offset: 2px; }

      /* ── the photo: square, fills the card, zooms a little on hover ── */
      .ss-shop .ss-prod-img {
        width: 100%;
        aspect-ratio: 1 / 1;
        overflow: hidden;
        display: flex;
        align-items: center;
        justify-content: center;
        font-size: 12px;
        color: #94a3b8;
        background: #f1f5f2;
      }
      .ss-shop .ss-prod-img img {
        width: 100%;
        height: 100%;
        object-fit: cover;
        transition: transform .6s cubic-bezier(.2,.8,.2,1);
      }
      .ss-shop .ss-prod:hover .ss-prod-img img { transform: scale(1.07); }

      /* ── the text under the photo ── */
      .ss-shop .ss-prod-b { display: flex; flex-direction: column; align-items: flex-start; gap: 3px; padding: 10px 12px 12px; }
      .ss-shop .ss-prod-n {
        font-size: 14px; font-weight: 600; line-height: 1.25;
        display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden;
      }
      .ss-shop .ss-prod-p { font-size: 15px; font-weight: 700; color: #14532d; }
      .ss-shop .ss-prod-m { font-size: 11px; line-height: 1.35; opacity: .72; }

      /* ── loading placeholders: a soft shimmer ── */
      .ss-shop .ss-skel {
        height: auto !important;
        aspect-ratio: 3 / 4;
        border-radius: 16px;
        background: linear-gradient(100deg, #eef2ef 30%, #f8faf8 50%, #eef2ef 70%);
        background-size: 220% 100%;
        animation: ssShopShimmer 1.3s linear infinite;
      }

      /* ── the top of the page fades in too ── */
      .ss-shop .ss-head, .ss-shop .ss-two { animation: ssShopFade .45s ease both; }
      .ss-shop .ss-two { animation-delay: .06s; }

      @keyframes ssShopIn {
        from { opacity: 0; transform: translateY(16px) scale(.97); }
        to   { opacity: 1; transform: none; }
      }
      @keyframes ssShopFade {
        from { opacity: 0; transform: translateY(8px); }
        to   { opacity: 1; transform: none; }
      }
      @keyframes ssShopShimmer {
        from { background-position: 120% 0; }
        to   { background-position: -120% 0; }
      }

      /* people who turn animations off on their phone get a calm page */
      @media (prefers-reduced-motion: reduce) {
        .ss-shop .ss-prod, .ss-shop .ss-head, .ss-shop .ss-two, .ss-shop .ss-skel { animation: none !important; }
        .ss-shop .ss-prod, .ss-shop .ss-prod-img img { transition: none; }
      }
    `}</style>
  )
}

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
      <div className="ss-root ss-shop">
        <SsStyles />
        <ShopStyles />
        <SsTabs />

        <div className="ss-head">
          <div>
            <h2 className="ss-title">Pay small small</h2>
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
          <div className="ss-grid">{[1, 2, 3, 4].map(i => <div key={i} className="ss-skel" />)}</div>
        ) : data && data.items.length === 0 ? (
          <Empty
            title={dq || category ? 'Nothing matches your search' : 'No products yet'}
            text={dq || category ? 'Try a different word, or clear the category.' : 'Vendors are getting set up. Check back soon.'}
          />
        ) : (
          <>
            {data && <p className="ss-hint">{data.total} product{data.total === 1 ? '' : 's'}</p>}

            {/* the key makes the cards slide in again whenever the search, category or page changes */}
            <div className="ss-grid" key={`${dq}|${category}|${page}`}>
              {data?.items.map((p, i) => (
                <button
                  key={p.id}
                  type="button"
                  className="ss-prod"
                  style={{ '--i': Math.min(i, 12) } as CSSProperties}
                  onClick={() => navigate(`/shop/${p.id}`)}
                >
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