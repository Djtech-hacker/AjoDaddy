// src/components/ss/ssShared.tsx
//
// Shared pieces for every Pay Small Small page: the tab bar, small helpers, and the CSS.
// The tab bar is how people move around without touching your sidebar:
//
//    Shop  |  My plans  |  Sell  |  Staff (staff only)
//
// "Sell" goes to /vendor. If the person is not a vendor yet, that page shows a card that
// leads to /become-vendor (the application). Customer care and admins also see "Staff".

import { useEffect, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { useAuthStore } from '@/stores/authStore'

// ── helpers ──────────────────────────────────────────────────

export const naira = (n: number | string | null | undefined) =>
  '₦' + (Number(n) || 0).toLocaleString('en-NG', { maximumFractionDigits: 2 })

export const fmtDate = (d?: string | Date | null) =>
  d ? new Date(d).toLocaleDateString('en-NG', { day: 'numeric', month: 'short', year: 'numeric' }) : '—'

export function errMsg(err: any, fallback: string): string {
  const m = err?.response?.data?.message
  if (Array.isArray(m)) return m.join(', ')
  return m || err?.message || fallback
}

// responses are wrapped as { success, data }
export const unwrap = (res: any) => res?.data?.data ?? res?.data

// A fresh random key for each "confirm" screen. If the person taps twice, or the network
// retries, the server sees the SAME key and charges only once.
export const newKey = () => {
  const c: any = (globalThis as any).crypto
  const raw = c?.randomUUID ? c.randomUUID() : `${Date.now()}${Math.random().toString(16).slice(2)}`
  return String(raw).replace(/[^A-Za-z0-9]/g, '').slice(0, 32).padEnd(12, '0')
}

export function useDebounced<T>(value: T, ms: number): T {
  const [v, setV] = useState(value)
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms)
    return () => clearTimeout(t)
  }, [value, ms])
  return v
}

export const FREQ_LABEL: Record<string, string> = { DAILY: 'Daily', WEEKLY: 'Weekly', MONTHLY: 'Monthly', CUSTOM: 'Custom days' }

// ── tab bar ──────────────────────────────────────────────────

export function SsTabs() {
  const navigate = useNavigate()
  const { pathname } = useLocation()
  const { user } = useAuthStore() as any
  const staff = !!user && ['CUSTOMER_SERVICE', 'ADMIN', 'SUPER_ADMIN'].includes(user.role)

  const tabs = [
    { label: 'Shop',     to: '/shop',    on: pathname.startsWith('/shop') },
    { label: 'My plans', to: '/plans',   on: pathname.startsWith('/plans') },
    { label: 'Sell',     to: '/vendor',  on: pathname.startsWith('/vendor') || pathname.startsWith('/become-vendor') },
    ...(staff ? [{ label: 'Staff', to: '/ss-staff', on: pathname.startsWith('/ss-staff') }] : []),
  ]
  return (
    <nav className="ss-tabs" aria-label="Pay Small Small">
      {tabs.map(t => (
        <button key={t.to} type="button" className={t.on ? 'on' : ''} onClick={() => navigate(t.to)} aria-current={t.on ? 'page' : undefined}>
          {t.label}
        </button>
      ))}
    </nav>
  )
}

// ── small components ─────────────────────────────────────────

export function Pill({ tone = 'gray', children }: { tone?: 'gray' | 'green' | 'amber' | 'red' | 'blue'; children: React.ReactNode }) {
  return <span className={`ss-pill ${tone}`}>{children}</span>
}

export const statusTone = (s: string): 'gray' | 'green' | 'amber' | 'red' | 'blue' =>
  ({ ACTIVE: 'green', COMPLETED: 'blue', PAID: 'green', VERIFIED: 'green', APPROVED: 'green',
     PAUSED: 'amber', OUT_OF_STOCK: 'amber', DISPUTED: 'amber', PENDING: 'amber', SUBMITTED: 'amber', UNDER_REVIEW: 'amber', NEEDS_MORE_INFO: 'amber', OVERDUE: 'red',
     REFUNDED: 'gray', DEFAULTED: 'red', CANCELLED: 'gray', ARCHIVED: 'gray', REJECTED: 'red', SUSPENDED: 'red' } as any)[s] || 'gray'

export const statusLabel = (s: string) => s.replace(/_/g, ' ').toLowerCase().replace(/^\w/, c => c.toUpperCase())

export function Progress({ pct }: { pct: number }) {
  const v = Math.max(0, Math.min(100, Number(pct) || 0))
  return (
    <div className="ss-bar" role="progressbar" aria-valuenow={v} aria-valuemin={0} aria-valuemax={100}>
      <i style={{ width: `${v}%` }} />
    </div>
  )
}

export function Empty({ title, text, action }: { title: string; text?: string; action?: React.ReactNode }) {
  return (
    <div className="ss-empty">
      <p className="ss-empty-t">{title}</p>
      {text && <p className="ss-empty-p">{text}</p>}
      {action}
    </div>
  )
}

export function Modal({ title, onClose, children, wide }: { title: string; onClose: () => void; children: React.ReactNode; wide?: boolean }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])
  return (
    <div className="ss-overlay" onMouseDown={e => { if (e.target === e.currentTarget) onClose() }}>
      <div className={`ss-modal ${wide ? 'wide' : ''}`} role="dialog" aria-modal="true" aria-label={title}>
        <div className="ss-modal-head">
          <p>{title}</p>
          <button type="button" className="ss-x" onClick={onClose} aria-label="Close">×</button>
        </div>
        <div className="ss-modal-body">{children}</div>
      </div>
    </div>
  )
}

// asks for a written reason, then calls onConfirm(reason)
export function ReasonModal({ title, label, confirmText, required = true, busy, onClose, onConfirm }: {
  title: string; label: string; confirmText: string; required?: boolean; busy?: boolean
  onClose: () => void; onConfirm: (reason: string) => void
}) {
  const [text, setText] = useState('')
  const ok = !required || text.trim().length >= 3
  return (
    <Modal title={title} onClose={onClose}>
      <div className="ss-field">
        <label htmlFor="ss-reason">{label}</label>
        <textarea id="ss-reason" rows={3} value={text} onChange={e => setText(e.target.value)} maxLength={500} autoFocus />
      </div>
      <div className="ss-row end">
        <button type="button" className="ss-btn ghost" onClick={onClose}>Cancel</button>
        <button type="button" className="ss-btn" disabled={!ok || busy} onClick={() => onConfirm(text.trim())}>{busy ? 'Please wait…' : confirmText}</button>
      </div>
    </Modal>
  )
}

export function SsStyles() { return <style>{CSS}</style> }

const CSS = `
  @import url('https://fonts.googleapis.com/css2?family=DM+Mono:wght@400;500&family=Inter:wght@300;400;500;600;700;800&display=swap');
  .ss-root { font-family: 'Inter', -apple-system, sans-serif; max-width: 980px; margin: 0 auto; padding: 20px; display: flex; flex-direction: column; gap: 16px; color: #111827; background: #F8F9FB; min-height: 100vh; }
  .ss-narrow { max-width: 760px; }
  .ss-stack { display: flex; flex-direction: column; gap: 16px; }

  .ss-tabs { display: flex; gap: 6px; background: #fff; border: 1px solid #E5E7EB; border-radius: 14px; padding: 5px; overflow-x: auto; }
  .ss-tabs button { flex: 1; min-width: 84px; font-family: inherit; font-size: 13px; font-weight: 600; color: #6B7280; background: transparent; border: none; border-radius: 10px; padding: 10px 14px; cursor: pointer; white-space: nowrap; transition: background .15s, color .15s; }
  .ss-tabs button:hover { background: #F3F4F6; }
  .ss-tabs button.on { background: #0B3D2A; color: #fff; }

  .ss-head { display: flex; align-items: flex-end; justify-content: space-between; gap: 12px; flex-wrap: wrap; }
  .ss-title { font-size: 21px; font-weight: 800; letter-spacing: -0.4px; }
  .ss-sub { font-size: 12.5px; color: #6B7280; margin-top: 3px; line-height: 1.5; }

  .ss-card { position: relative; background: #fff; border: 1px solid #E5E7EB; border-radius: 18px; padding: 22px; box-shadow: 0 1px 4px rgba(0,0,0,.04); overflow: hidden; }
  .ss-card.accent::before { content: ''; position: absolute; top: 0; left: 0; right: 0; height: 3px; background: linear-gradient(90deg, #22C55E, #0B3D2A); }
  .ss-h { font-size: 13px; font-weight: 700; color: #111827; padding-bottom: 12px; margin-bottom: 14px; border-bottom: 1px solid #F3F4F6; display: flex; align-items: center; justify-content: space-between; gap: 10px; }
  .ss-p { font-size: 12.5px; color: #6B7280; line-height: 1.55; }
  .ss-hint { font-size: 11px; color: #9CA3AF; margin-top: 6px; line-height: 1.5; }

  .ss-field { display: flex; flex-direction: column; margin-bottom: 14px; }
  .ss-field > label, .ss-lbl { font-size: 9px; font-weight: 600; letter-spacing: .05em; text-transform: uppercase; color: #9CA3AF; margin-bottom: 6px; }
  .ss-field input:not([type=checkbox]):not([type=radio]), .ss-field select, .ss-field textarea, .ss-input { font-family: inherit; font-size: 13.5px; color: #111827; background: #F9FAFB; border: 1px solid #E5E7EB; border-radius: 12px; padding: 11px 13px; outline: none; width: 100%; box-sizing: border-box; transition: border-color .15s, box-shadow .15s, background .15s; }
  .ss-field input:focus, .ss-field select:focus, .ss-field textarea:focus, .ss-input:focus { border-color: #22C55E; background: #fff; box-shadow: 0 0 0 3px rgba(34,197,94,.1); }
  .ss-field textarea { resize: vertical; }
  .ss-two { display: grid; grid-template-columns: 1fr 1fr; gap: 14px; }
  .ss-three { display: grid; grid-template-columns: repeat(3, 1fr); gap: 14px; }
  @media (max-width: 640px) { .ss-two, .ss-three { grid-template-columns: 1fr; gap: 0; } }
  .ss-checks { display: flex; flex-wrap: wrap; gap: 8px; }
  .ss-check { display: inline-flex; align-items: center; gap: 7px; font-size: 12.5px; font-weight: 500; color: #374151; background: #F9FAFB; border: 1px solid #E5E7EB; border-radius: 10px; padding: 8px 12px; cursor: pointer; }
  .ss-check.on { background: #F0FDF4; border-color: #22C55E; color: #166534; }
  .ss-check input { accent-color: #16A34A; }

  .ss-row { display: flex; align-items: center; justify-content: space-between; gap: 12px; flex-wrap: wrap; margin-top: 6px; }
  .ss-row.end { justify-content: flex-end; }
  .ss-btn { display: inline-flex; align-items: center; justify-content: center; gap: 8px; font-family: inherit; font-size: 13px; font-weight: 600; color: #fff; background: #0B3D2A; border: none; border-radius: 10px; padding: 11px 20px; cursor: pointer; transition: background .15s, transform .1s; text-decoration: none; }
  .ss-btn:hover:not(:disabled) { background: #0F5138; }
  .ss-btn:active:not(:disabled) { transform: scale(.98); }
  .ss-btn:disabled { opacity: .45; cursor: not-allowed; }
  .ss-btn.ghost { background: #fff; color: #0B3D2A; border: 1px solid #BBF7D0; padding: 8px 14px; font-size: 12px; }
  .ss-btn.ghost:hover:not(:disabled) { background: #F0FDF4; }
  .ss-btn.danger { background: #fff; color: #B91C1C; border: 1px solid #FECACA; padding: 8px 14px; font-size: 12px; }
  .ss-btn.danger:hover:not(:disabled) { background: #FEF2F2; }
  .ss-btn.sm { padding: 7px 12px; font-size: 11.5px; }
  .ss-spin { width: 13px; height: 13px; border-radius: 50%; border: 2px solid rgba(255,255,255,.4); border-top-color: #fff; animation: ss-rot .7s linear infinite; display: inline-block; }
  .ss-btn.ghost .ss-spin, .ss-btn.danger .ss-spin { border-color: rgba(11,61,42,.25); border-top-color: #0B3D2A; }
  @keyframes ss-rot { to { transform: rotate(360deg); } }
  .ss-x { width: 30px; height: 30px; flex-shrink: 0; border-radius: 9px; border: 1px solid #E5E7EB; background: #fff; color: #6B7280; font-size: 17px; line-height: 1; cursor: pointer; }
  .ss-x:hover:not(:disabled) { border-color: #FCA5A5; color: #B91C1C; }

  .ss-note { font-size: 12px; font-weight: 500; padding: 11px 14px; border-radius: 10px; line-height: 1.5; }
  .ss-note.err { color: #B91C1C; background: #FEF2F2; border: 1px solid #FECACA; }
  .ss-note.warn { color: #92400E; background: #FFFBEB; border: 1px solid #FDE68A; }
  .ss-note.ok { color: #166534; background: #F0FDF4; border: 1px solid #BBF7D0; }

  .ss-pill { display: inline-block; font-size: 10px; font-weight: 600; padding: 2px 9px; border-radius: 99px; white-space: nowrap; }
  .ss-pill.gray { background: #F3F4F6; color: #6B7280; }
  .ss-pill.green { background: #DCFCE7; color: #166534; }
  .ss-pill.amber { background: #FEF3C7; color: #92400E; }
  .ss-pill.red { background: #FEE2E2; color: #991B1B; }
  .ss-pill.blue { background: #DBEAFE; color: #1E40AF; }

  .ss-bar { height: 8px; background: #E5E7EB; border-radius: 99px; overflow: hidden; }
  .ss-bar i { display: block; height: 100%; background: linear-gradient(90deg, #86EFAC, #22C55E, #16A34A); border-radius: 99px; transition: width .4s cubic-bezier(.16,1,.3,1); }

  .ss-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(210px, 1fr)); gap: 14px; }
  .ss-prod { background: #fff; border: 1px solid #E5E7EB; border-radius: 16px; overflow: hidden; cursor: pointer; text-align: left; font-family: inherit; padding: 0; transition: box-shadow .15s, transform .15s, border-color .15s; display: flex; flex-direction: column; }
  .ss-prod:hover { box-shadow: 0 6px 20px rgba(0,0,0,.08); transform: translateY(-2px); border-color: #BBF7D0; }
  .ss-prod-img { aspect-ratio: 4/3; background: #F3F4F6; display: flex; align-items: center; justify-content: center; color: #9CA3AF; font-size: 12px; overflow: hidden; }
  .ss-prod-img img { width: 100%; height: 100%; object-fit: cover; }
  .ss-prod-b { padding: 12px 14px 14px; display: flex; flex-direction: column; gap: 4px; }
  .ss-prod-n { font-size: 13.5px; font-weight: 600; color: #111827; line-height: 1.3; }
  .ss-prod-p { font-size: 16px; font-weight: 800; color: #0B3D2A; letter-spacing: -.3px; }
  .ss-prod-m { font-size: 11px; color: #6B7280; line-height: 1.4; }

  .ss-list { display: flex; flex-direction: column; gap: 10px; }
  .ss-item { display: flex; align-items: center; gap: 14px; background: #fff; border: 1px solid #E5E7EB; border-radius: 14px; padding: 12px 14px; }
  .ss-item.click { cursor: pointer; transition: border-color .15s, box-shadow .15s; }
  .ss-item.click:hover { border-color: #BBF7D0; box-shadow: 0 2px 10px rgba(0,0,0,.05); }
  .ss-thumb { width: 56px; height: 56px; border-radius: 10px; background: #F3F4F6; flex-shrink: 0; overflow: hidden; display: flex; align-items: center; justify-content: center; color: #9CA3AF; font-size: 10px; }
  .ss-thumb img { width: 100%; height: 100%; object-fit: cover; }
  .ss-item-main { flex: 1; min-width: 0; }
  .ss-item-t { font-size: 13.5px; font-weight: 600; color: #111827; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .ss-item-s { font-size: 11.5px; color: #6B7280; margin-top: 2px; line-height: 1.45; }
  .ss-item-r { text-align: right; flex-shrink: 0; }
  .ss-mono { font-family: 'DM Mono', monospace; }

  .ss-kv { display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 12px; }
  .ss-kv > div { background: #F9FAFB; border: 1px solid #F3F4F6; border-radius: 12px; padding: 12px 14px; }
  .ss-kv b { display: block; font-size: 9px; font-weight: 600; letter-spacing: .05em; text-transform: uppercase; color: #9CA3AF; margin-bottom: 4px; }
  .ss-kv span { font-size: 15px; font-weight: 700; color: #111827; }

  .ss-table { width: 100%; border-collapse: collapse; font-size: 12.5px; }
  .ss-table th { text-align: left; font-size: 9px; font-weight: 600; letter-spacing: .05em; text-transform: uppercase; color: #9CA3AF; padding: 6px 8px; border-bottom: 1px solid #F3F4F6; }
  .ss-table td { padding: 9px 8px; border-bottom: 1px solid #F9FAFB; color: #374151; }

  .ss-empty { text-align: center; padding: 34px 16px; background: #fff; border: 1px dashed #D1D5DB; border-radius: 16px; display: flex; flex-direction: column; align-items: center; gap: 8px; }
  .ss-empty-t { font-size: 14px; font-weight: 700; }
  .ss-empty-p { font-size: 12.5px; color: #6B7280; max-width: 360px; line-height: 1.5; }

  .ss-skel { background: linear-gradient(90deg, #F3F4F6 25%, #E5E7EB 50%, #F3F4F6 75%); background-size: 200% 100%; animation: ss-shimmer 1.5s infinite; border-radius: 14px; }
  @keyframes ss-shimmer { 0% { background-position: 200% 0; } 100% { background-position: -200% 0; } }

  .ss-overlay { position: fixed; inset: 0; background: rgba(17,24,39,.5); display: flex; align-items: center; justify-content: center; padding: 16px; z-index: 1000; }
  .ss-modal { background: #fff; border-radius: 18px; width: 100%; max-width: 460px; max-height: 90vh; display: flex; flex-direction: column; box-shadow: 0 20px 60px rgba(0,0,0,.3); }
  .ss-modal.wide { max-width: 820px; }
  .ss-modal-head { display: flex; align-items: center; justify-content: space-between; gap: 10px; padding: 16px 20px; border-bottom: 1px solid #F3F4F6; }
  .ss-modal-head p { font-size: 14px; font-weight: 700; }
  .ss-modal-body { padding: 20px; overflow-y: auto; }

  .ss-linkbtn { background: none; border: none; padding: 0; font: inherit; color: #16A34A; font-weight: 600; cursor: pointer; text-decoration: underline; }
  .ss-pager { display: flex; align-items: center; justify-content: center; gap: 12px; font-size: 12px; color: #6B7280; }
  .ss-gallery { display: flex; flex-direction: column; gap: 10px; }
  .ss-gallery-main { aspect-ratio: 4/3; background: #F3F4F6; border-radius: 14px; overflow: hidden; display: flex; align-items: center; justify-content: center; color: #9CA3AF; font-size: 12px; }
  .ss-gallery-main img { width: 100%; height: 100%; object-fit: cover; }
  .ss-gallery-t { display: flex; gap: 8px; }
  .ss-gallery-t button { width: 54px; height: 54px; border-radius: 9px; overflow: hidden; border: 2px solid transparent; padding: 0; cursor: pointer; background: #F3F4F6; }
  .ss-gallery-t button.on { border-color: #22C55E; }
  .ss-gallery-t img { width: 100%; height: 100%; object-fit: cover; }
  .ss-split { display: grid; grid-template-columns: 1fr 1fr; gap: 18px; align-items: start; }
  @media (max-width: 760px) { .ss-split { grid-template-columns: 1fr; } }
  .ss-sched { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 6px; font-size: 12px; color: #374151; }
  .ss-sched li { display: flex; justify-content: space-between; background: #F9FAFB; border-radius: 8px; padding: 7px 10px; }
  .ss-quick { display: flex; gap: 8px; flex-wrap: wrap; margin-bottom: 10px; }

  @media (prefers-reduced-motion: reduce) { .ss-spin, .ss-skel, .ss-bar i { animation: none; transition: none; } }
`