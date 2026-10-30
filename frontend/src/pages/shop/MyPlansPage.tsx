// src/pages/shop/MyPlansPage.tsx
// All of the customer's plans with progress bars.

import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import DashboardLayout from '@/components/layout/DashboardLayout'
import { planApi } from '@/api/smallSmall'
import { SsStyles, SsTabs, Empty, Pill, Progress, naira, fmtDate, errMsg, unwrap, statusTone, statusLabel } from '@/components/ss/ssShared'

type Plan = {
  id: string
  orderNumber: string
  status: string
  product: { name: string; thumbnail: string | null }
  vendor: { businessName: string | null }
  totalPrice: number
  amountPaid: number
  percentPaid: number
  nextDueDate: string | null
}
type Page = { items: Plan[]; total: number; page: number; pageSize: number }

const FILTERS = [
  { key: '', label: 'All' },
  { key: 'ACTIVE', label: 'Active' },
  { key: 'COMPLETED', label: 'Finished' },
  { key: 'DISPUTED', label: 'With support' },
  { key: 'REFUNDED', label: 'Refunded' },
]

export default function MyPlansPage() {
  const navigate = useNavigate()
  const [status, setStatus] = useState('')
  const [page, setPage] = useState(1)
  const [data, setData] = useState<Page | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => { setPage(1) }, [status])

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    planApi.list({ status: status || undefined, page })
      .then(res => { if (!cancelled) { setData(unwrap(res) as Page); setError('') } })
      .catch(e => { if (!cancelled) setError(errMsg(e, 'Could not load your plans.')) })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [status, page])

  const pages = data ? Math.max(1, Math.ceil(data.total / data.pageSize)) : 1

  return (
    <DashboardLayout title="My plans" subtitle="Pay small small">
      <div className="ss-root ss-narrow">
        <SsStyles />
        <SsTabs />

        <div className="ss-head">
          <div>
            <h2 className="ss-title">My plans</h2>
            <p className="ss-sub">Everything you are paying for, and what is next.</p>
          </div>
        </div>

        <div className="ss-checks">
          {FILTERS.map(f => (
            <button key={f.key} type="button" className={`ss-check ${status === f.key ? 'on' : ''}`} onClick={() => setStatus(f.key)}>{f.label}</button>
          ))}
        </div>

        {error && <div className="ss-note err" role="alert">{error}</div>}

        {loading && !data ? (
          <div className="ss-list">{[1, 2, 3].map(i => <div key={i} className="ss-skel" style={{ height: 84 }} />)}</div>
        ) : data && data.items.length === 0 ? (
          <Empty
            title="No plans yet"
            text="When you start paying for something small small, it shows up here."
            action={<button type="button" className="ss-btn" onClick={() => navigate('/shop')}>Browse the shop →</button>}
          />
        ) : (
          <>
            <div className="ss-list">
              {data?.items.map(p => (
                <div key={p.id} className="ss-item click" role="button" tabIndex={0}
                  onClick={() => navigate(`/plans/${p.id}`)} onKeyDown={e => { if (e.key === 'Enter') navigate(`/plans/${p.id}`) }}>
                  <div className="ss-thumb">{p.product.thumbnail ? <img src={p.product.thumbnail} alt="" /> : 'No photo'}</div>
                  <div className="ss-item-main">
                    <p className="ss-item-t">{p.product.name}</p>
                    <p className="ss-item-s">{p.vendor.businessName || 'Vendor'} · {naira(p.amountPaid)} of {naira(p.totalPrice)}</p>
                    <div style={{ marginTop: 8 }}><Progress pct={p.percentPaid} /></div>
                  </div>
                  <div className="ss-item-r">
                    <Pill tone={statusTone(p.status)}>{statusLabel(p.status)}</Pill>
                    {p.status === 'ACTIVE' && p.nextDueDate && <p className="ss-item-s">Next: {fmtDate(p.nextDueDate)}</p>}
                  </div>
                </div>
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