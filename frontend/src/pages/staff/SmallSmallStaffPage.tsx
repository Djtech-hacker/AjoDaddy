// src/pages/staff/SmallSmallStaffPage.tsx   (route: /ss-staff, customer care + admins only)
//
//   Applications : review vendor applications (documents, name checks, notes, decision)
//   Vendors      : suspend or reinstate vendors (admins)
//   Products     : search by reference number, put products on hold, add notes
//
// Who can do what is decided by the server (customer care recommends, admins give the final
// decision unless the platform setting says otherwise). This page just shows the server's answer.

import { useCallback, useEffect, useState } from 'react'
import DashboardLayout from '@/components/layout/DashboardLayout'
import { staffApi } from '@/api/smallSmall'
import {
  SsStyles, SsTabs, Empty, Pill, Modal, ReasonModal, naira, fmtDate, errMsg, unwrap, useDebounced, statusTone, statusLabel,
} from '@/components/ss/ssShared'
import VerifiedBadge from '@/components/ss/VerifiedBadge'
import { useAuthStore } from '@/stores/authStore'
import { useUIStore } from '@/stores/uiStore'

type Tab = 'APPS' | 'VENDORS' | 'PRODUCTS'

export default function SmallSmallStaffPage() {
  const { user } = useAuthStore() as any
  const { showToast } = useUIStore()
  const isAdmin = !!user && ['ADMIN', 'SUPER_ADMIN'].includes(user.role)
  const [tab, setTab] = useState<Tab>('APPS')
  const [checking, setChecking] = useState(false)
  const [summary, setSummary] = useState<any>(null)

  const runChecks = async () => {
    setChecking(true); setSummary(null)
    try { setSummary(unwrap(await staffApi.runChecks())); showToast('Checks finished', 'success') }
    catch (e) { showToast(errMsg(e, 'Could not run the checks.'), 'error') }
    finally { setChecking(false) }
  }

  return (
    <DashboardLayout title="Pay Small Small: Staff" subtitle="Applications, vendors and products">
      <div className="ss-root">
        <SsStyles />
        <SsTabs />

        <div className="ss-head">
          <div>
            <h2 className="ss-title">Review and support</h2>
            <p className="ss-sub">
              {isAdmin ? 'You can approve or reject applications and suspend vendors.' : 'You can review documents, add notes and recommend. An admin gives the final decision.'}
            </p>
          </div>
          {isAdmin && (
            <button type="button" className="ss-btn ghost" onClick={runChecks} disabled={checking}>
              {checking ? 'Running…' : 'Run daily checks now'}
            </button>
          )}
        </div>

        {summary && (
          <div className="ss-note ok">
            Reminders sent: {summary.reminders ?? 0} · Auto-payments taken: {summary.autoDebited ?? 0} · Failed: {summary.autoDebitFailed ?? 0} ·
            Grace started: {summary.graceStarted ?? 0} · Missed: {summary.missed ?? 0} · Cancelled and refunded: {summary.defaultedRefunded ?? 0} ·
            Sent to support: {summary.escalated ?? 0}{summary.skipped ? ` · ${summary.skipped}` : ''}{summary.message ? ` · ${summary.message}` : ''}
          </div>
        )}

        <div className="ss-checks">
          {([['APPS', 'Applications'], ['VENDORS', 'Vendors'], ['PRODUCTS', 'Products']] as [Tab, string][]).map(([k, l]) => (
            <button key={k} type="button" className={`ss-check ${tab === k ? 'on' : ''}`} onClick={() => setTab(k)}>{l}</button>
          ))}
        </div>

        {tab === 'APPS' && <ApplicationsTab isAdmin={isAdmin} />}
        {tab === 'VENDORS' && <VendorsTab isAdmin={isAdmin} />}
        {tab === 'PRODUCTS' && <ProductsTab />}
      </div>
    </DashboardLayout>
  )
}

// ══════════════════════════════════════════════════════════════
// APPLICATIONS
// ══════════════════════════════════════════════════════════════

type AppRow = {
  id: string; status: string; businessName: string; category: string; kycFlag: string | null
  recommendation: string | null; submittedAt: string | null; documentCount: number
  applicant: { firstName: string; lastName: string; username: string; email: string }
}

const STATUS_FILTERS = [
  { key: '', label: 'Waiting' },
  { key: 'NEEDS_MORE_INFO', label: 'Needs info' },
  { key: 'APPROVED', label: 'Approved' },
  { key: 'REJECTED', label: 'Rejected' },
]

function ApplicationsTab({ isAdmin }: { isAdmin: boolean }) {
  const [status, setStatus] = useState('')
  const [rows, setRows] = useState<AppRow[] | null>(null)
  const [error, setError] = useState('')
  const [openId, setOpenId] = useState<string | null>(null)

  const load = useCallback(() => {
    staffApi.applications({ status: status || undefined })
      .then(res => { setRows((unwrap(res) as any).items as AppRow[]); setError('') })
      .catch(e => setError(errMsg(e, 'Could not load applications.')))
  }, [status])
  useEffect(() => { setRows(null); load() }, [load])

  return (
    <>
      <div className="ss-checks">
        {STATUS_FILTERS.map(f => (
          <button key={f.key} type="button" className={`ss-check ${status === f.key ? 'on' : ''}`} onClick={() => setStatus(f.key)}>{f.label}</button>
        ))}
      </div>
      {error && <div className="ss-note err" role="alert">{error}</div>}

      {rows === null ? (
        <div className="ss-list">{[1, 2].map(i => <div key={i} className="ss-skel" style={{ height: 70 }} />)}</div>
      ) : rows.length === 0 ? (
        <Empty title="Nothing here" text="No applications match this filter right now." />
      ) : (
        <div className="ss-list">
          {rows.map(r => (
            <div key={r.id} className="ss-item click" role="button" tabIndex={0} onClick={() => setOpenId(r.id)} onKeyDown={e => { if (e.key === 'Enter') setOpenId(r.id) }}>
              <div className="ss-item-main">
                <p className="ss-item-t">{r.businessName}</p>
                <p className="ss-item-s">{r.applicant.firstName} {r.applicant.lastName} (@{r.applicant.username}) · {r.category} · {r.documentCount} files · {fmtDate(r.submittedAt)}</p>
              </div>
              <div className="ss-item-r" style={{ display: 'flex', gap: 6, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
                {r.kycFlag && <Pill tone="red">Name check flagged</Pill>}
                {r.recommendation && <Pill tone="blue">{statusLabel(r.recommendation.replace('RECOMMEND_', ''))}</Pill>}
                <Pill tone={statusTone(r.status)}>{statusLabel(r.status)}</Pill>
              </div>
            </div>
          ))}
        </div>
      )}

      {openId && <ApplicationPanel id={openId} isAdmin={isAdmin} onClose={() => setOpenId(null)} onChanged={load} />}
    </>
  )
}

type Detail = any

function ApplicationPanel({ id, isAdmin, onClose, onChanged }: { id: string; isAdmin: boolean; onClose: () => void; onChanged: () => void }) {
  const { showToast } = useUIStore()
  const [d, setD] = useState<Detail | null>(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [note, setNote] = useState('')
  const [rejectDoc, setRejectDoc] = useState<any | null>(null)
  const [decision, setDecision] = useState<'APPROVE' | 'REJECT' | 'NEEDS_MORE_INFO' | null>(null)
  const [recommend, setRecommend] = useState<'RECOMMEND_APPROVE' | 'RECOMMEND_REJECT' | 'NEEDS_MORE_INFO' | null>(null)
  const [override, setOverride] = useState(false)

  const load = useCallback(() => {
    return staffApi.application(id)
      .then(res => { setD(unwrap(res)); setError('') })
      .catch(e => setError(errMsg(e, 'Could not load this application.')))
  }, [id])
  useEffect(() => { load() }, [load])

  const open = d && ['SUBMITTED', 'UNDER_REVIEW'].includes(d.status)

  const run = async (fn: () => Promise<any>, ok: string, closeAfter = false) => {
    setBusy(true); setError('')
    try {
      await fn()
      showToast(ok, 'success')
      await load(); onChanged()
      if (closeAfter) onClose()
      return true
    } catch (e) {
      setError(errMsg(e, 'That did not work.'))
      return false
    } finally { setBusy(false) }
  }

  const viewDoc = async (doc: any) => {
    setError('')
    try {
      const res = await staffApi.docFile(doc.id)
      const url = URL.createObjectURL(res.data as Blob)
      window.open(url, '_blank', 'noopener')
      setTimeout(() => URL.revokeObjectURL(url), 60_000)
    } catch (e) { setError(errMsg(e, 'Could not open that file.')) }
  }

  const docsByType = (type: string) => (d?.documents || []).filter((x: any) => x.type === type)
  const typeLabel: Record<string, string> = { CAC: 'CAC certificate', SOCIAL_PROOF: 'Social media page', SALES_PROOF: 'Successful sales' }

  return (
    <Modal title={d ? d.businessName : 'Application'} onClose={onClose} wide>
      {!d ? (
        error ? <div className="ss-note err">{error}</div> : <div className="ss-skel" style={{ height: 200 }} />
      ) : (
        <div className="ss-stack">
          {error && <div className="ss-note err" role="alert">{error}</div>}

          <div className="ss-kv">
            <div><b>Applicant</b><span style={{ fontSize: 13 }}>{d.user.firstName} {d.user.lastName}</span></div>
            <div><b>Status</b><span><Pill tone={statusTone(d.status)}>{statusLabel(d.status)}</Pill></span></div>
            <div><b>CAC number</b><span className="ss-mono" style={{ fontSize: 13 }}>{d.cacNumber || '—'}</span></div>
            <div><b>Submitted</b><span style={{ fontSize: 13 }}>{fmtDate(d.submittedAt)}</span></div>
          </div>

          {/* identity and name checks */}
          <div className="ss-card" style={{ padding: 16 }}>
            <p className="ss-h">Identity and name check</p>
            <div className="ss-kv">
              <div><b>Verified name (BVN)</b><span style={{ fontSize: 13 }}>{d.kycVerifiedName || d.identity?.firstName ? (d.kycVerifiedName || `${d.identity.firstName} ${d.identity.lastName}`) : '—'}</span></div>
              <div><b>Payout account</b><span style={{ fontSize: 13 }}>{d.payoutAccount ? `${d.payoutAccount.accountName} · ${d.payoutAccount.bankName} ••••${d.payoutAccount.accountLast4}` : '—'}</span></div>
              <div><b>Account name matches</b><span style={{ fontSize: 13 }}>{d.kycNameMatched === null ? '—' : d.kycNameMatched ? 'Yes' : 'NO'}</span></div>
              <div><b>Payout name matches</b><span style={{ fontSize: 13 }}>{d.payoutNameMatched === null ? '—' : d.payoutNameMatched ? 'Yes' : 'NO'}</span></div>
            </div>
            {d.kycFlag && <div className="ss-note warn" style={{ marginTop: 10 }}>The name check was flagged ({d.kycFlag}). Only an admin can approve this, with a written reason.</div>}
            {d.identity && <p className="ss-hint">NIN {d.identity.ninMasked || '—'} · BVN {d.identity.bvnMasked || '—'} · face scan {d.identity.faceScannedAt ? fmtDate(d.identity.faceScannedAt) : 'missing'}</p>}
          </div>

          <div className="ss-card" style={{ padding: 16 }}>
            <p className="ss-h">Business</p>
            <p className="ss-p"><b>{d.category}</b>{d.description ? ` · ${d.description}` : ''}</p>
            {d.address && <p className="ss-p">{d.address}</p>}
            <ul className="ss-sched" style={{ marginTop: 8 }}>
              {(d.socialLinks || []).map((l: string) => <li key={l}><a href={l} target="_blank" rel="noopener noreferrer">{l}</a><span /></li>)}
            </ul>
          </div>

          {/* documents */}
          <div className="ss-card" style={{ padding: 16 }}>
            <p className="ss-h">Documents</p>
            {['CAC', 'SOCIAL_PROOF', 'SALES_PROOF'].map(t => (
              <div key={t} style={{ marginBottom: 12 }}>
                <p className="ss-lbl">{typeLabel[t]} ({docsByType(t).length})</p>
                {docsByType(t).length === 0 && <p className="ss-hint">Nothing uploaded.</p>}
                {docsByType(t).map((doc: any) => (
                  <div key={doc.id} className="ss-item" style={{ marginBottom: 6 }}>
                    <div className="ss-item-main">
                      <p className="ss-item-t">{doc.fileName || 'File'}</p>
                      {doc.reviewerNote && <p className="ss-item-s">Note: {doc.reviewerNote}</p>}
                    </div>
                    <Pill tone={statusTone(doc.status)}>{statusLabel(doc.status)}</Pill>
                    <button type="button" className="ss-btn ghost sm" onClick={() => viewDoc(doc)}>View</button>
                    {open && doc.status !== 'VERIFIED' && (
                      <button type="button" className="ss-btn ghost sm" disabled={busy}
                        onClick={() => run(() => staffApi.reviewDoc(doc.id, { status: 'VERIFIED' }), 'Document verified')}>Verify</button>
                    )}
                    {open && doc.status !== 'REJECTED' && (
                      <button type="button" className="ss-btn danger sm" disabled={busy} onClick={() => setRejectDoc(doc)}>Reject</button>
                    )}
                  </div>
                ))}
              </div>
            ))}
          </div>

          {/* notes */}
          <div className="ss-card" style={{ padding: 16 }}>
            <p className="ss-h">Notes</p>
            {(d.notes || []).length === 0 && <p className="ss-hint">No notes yet.</p>}
            <ul className="ss-sched">
              {(d.notes || []).map((n: any) => <li key={n.id}><span>{n.text}</span><span className="ss-hint">{n.author} · {fmtDate(n.createdAt)}</span></li>)}
            </ul>
            <div className="ss-field" style={{ marginTop: 10 }}>
              <label htmlFor="ss-note">Add a note (only staff see it)</label>
              <textarea id="ss-note" rows={2} value={note} onChange={e => setNote(e.target.value)} maxLength={1000} />
            </div>
            <div className="ss-row end">
              <button type="button" className="ss-btn ghost sm" disabled={busy || !note.trim()}
                onClick={async () => { if (await run(() => staffApi.addNote(id, note.trim()), 'Note added')) setNote('') }}>Add note</button>
            </div>
          </div>

          {/* decision */}
          {open && (
            <div className="ss-card accent" style={{ padding: 16 }}>
              <p className="ss-h">Decision</p>
              {d.status === 'SUBMITTED' && (
                <div className="ss-row" style={{ marginBottom: 10 }}>
                  <span className="ss-hint">Mark it as under review so others know you are on it.</span>
                  <button type="button" className="ss-btn ghost sm" disabled={busy} onClick={() => run(() => staffApi.start(id), 'Review started')}>Start review</button>
                </div>
              )}
              <p className="ss-lbl">Your recommendation</p>
              <div className="ss-quick">
                <button type="button" className="ss-btn ghost sm" disabled={busy} onClick={() => setRecommend('RECOMMEND_APPROVE')}>Recommend approve</button>
                <button type="button" className="ss-btn ghost sm" disabled={busy} onClick={() => setRecommend('RECOMMEND_REJECT')}>Recommend reject</button>
                <button type="button" className="ss-btn ghost sm" disabled={busy} onClick={() => setRecommend('NEEDS_MORE_INFO')}>Needs more info</button>
              </div>
              {d.recommendation && <p className="ss-hint">Current recommendation: {statusLabel(d.recommendation.replace('RECOMMEND_', ''))}</p>}

              <p className="ss-lbl" style={{ marginTop: 14 }}>Final decision</p>
              {!isAdmin && <p className="ss-hint">Approving and rejecting is for admins. Asking for more information is open to you.</p>}
              <div className="ss-quick">
                {isAdmin && (
                  <>
                    <button type="button" className="ss-btn sm" disabled={busy} onClick={() => { setOverride(false); setDecision('APPROVE') }}>Approve</button>
                <button type="button" className="ss-btn danger sm" disabled={busy} onClick={() => setDecision('REJECT')}>Reject</button>
                  </>
                )}
                <button type="button" className="ss-btn ghost sm" disabled={busy} onClick={() => setDecision('NEEDS_MORE_INFO')}>Ask for more information</button>
              </div>
            </div>
          )}
        </div>
      )}

      {rejectDoc && (
        <ReasonModal title="Reject this document" label="Tell the applicant what is wrong with it" confirmText="Reject document" busy={busy}
          onClose={() => setRejectDoc(null)}
          onConfirm={async reason => { if (await run(() => staffApi.reviewDoc(rejectDoc.id, { status: 'REJECTED', note: reason }), 'Document rejected')) setRejectDoc(null) }} />
      )}

      {recommend && (
        <ReasonModal title="Save your recommendation" label="A short note for the admin (optional)" confirmText="Save" required={false} busy={busy}
          onClose={() => setRecommend(null)}
          onConfirm={async n => { if (await run(() => staffApi.recommend(id, { recommendation: recommend, note: n || undefined }), 'Recommendation saved')) setRecommend(null) }} />
      )}

      {decision && d && (
        <Modal title={decision === 'APPROVE' ? 'Approve this vendor' : decision === 'REJECT' ? 'Reject this application' : 'Ask for more information'} onClose={() => setDecision(null)}>
          <DecisionForm
            kind={decision} flagged={!!d.kycFlag} isAdmin={isAdmin} busy={busy} override={override} setOverride={setOverride}
            onCancel={() => setDecision(null)}
            onConfirm={async reason => {
              const ok = await run(() => staffApi.decide(id, { decision, reason: reason || undefined, overrideKycFlag: override || undefined }),
                decision === 'APPROVE' ? 'Vendor approved' : decision === 'REJECT' ? 'Application rejected' : 'Applicant asked for more information', true)
              if (ok) setDecision(null)
            }}
          />
        </Modal>
      )}
    </Modal>
  )
}

function DecisionForm({ kind, flagged, isAdmin, busy, override, setOverride, onCancel, onConfirm }: {
  kind: 'APPROVE' | 'REJECT' | 'NEEDS_MORE_INFO'; flagged: boolean; isAdmin: boolean; busy: boolean
  override: boolean; setOverride: (v: boolean) => void; onCancel: () => void; onConfirm: (reason: string) => void
}) {
  const [reason, setReason] = useState('')
  const needsReason = kind !== 'APPROVE' || (flagged && override)
  const blocked = kind === 'APPROVE' && flagged && !isAdmin
  const ok = (!needsReason || reason.trim().length >= 3) && !blocked && (kind !== 'APPROVE' || !flagged || override)
  return (
    <>
      {kind === 'APPROVE' && (
        <p className="ss-p">All documents must be verified first. The vendor can then post products straight away.</p>
      )}
      {kind === 'APPROVE' && flagged && (
        <div className="ss-note warn" style={{ margin: '10px 0' }}>
          The name check was flagged. {isAdmin ? 'Tick the box and give a reason to approve anyway.' : 'Only an admin can approve this.'}
          {isAdmin && (
            <label className="ss-check" style={{ marginTop: 8 }}>
              <input type="checkbox" checked={override} onChange={e => setOverride(e.target.checked)} /> I checked and approve despite the flag
            </label>
          )}
        </div>
      )}
      {needsReason && (
        <div className="ss-field">
          <label htmlFor="ss-dec">{kind === 'APPROVE' ? 'Reason for the override' : kind === 'REJECT' ? 'Reason (the applicant sees this)' : 'What is missing? (the applicant sees this)'}</label>
          <textarea id="ss-dec" rows={3} value={reason} onChange={e => setReason(e.target.value)} maxLength={500} />
        </div>
      )}
      {kind === 'REJECT' && <p className="ss-hint">They can apply again after the waiting period set by the platform.</p>}
      <div className="ss-row end">
        <button type="button" className="ss-btn ghost" onClick={onCancel}>Cancel</button>
        <button type="button" className="ss-btn" disabled={!ok || busy} onClick={() => onConfirm(reason.trim())}>
          {busy ? 'Please wait…' : kind === 'APPROVE' ? 'Approve' : kind === 'REJECT' ? 'Reject' : 'Send request'}
        </button>
      </div>
    </>
  )
}

// ══════════════════════════════════════════════════════════════
// VENDORS
// ══════════════════════════════════════════════════════════════

type VendorRow = { userId: string;  businessName: string; verifiedName: string; status: string;isVerified?: boolean; cacNumber: string | null; suspendedReason: string | null; user: { username: string; email: string } }

function VendorsTab({ isAdmin }: { isAdmin: boolean }) {
  const { showToast } = useUIStore()
  const [rows, setRows] = useState<VendorRow[] | null>(null)
  const [error, setError] = useState('')
  const [suspendFor, setSuspendFor] = useState<VendorRow | null>(null)
  const [busy, setBusy] = useState(false)

  const load = useCallback(() => {
    staffApi.accounts({})
      .then(res => { setRows(unwrap(res) as VendorRow[]); setError('') })
      .catch(e => setError(errMsg(e, 'Could not load vendors.')))
  }, [])
  useEffect(() => { load() }, [load])

  const act = async (fn: () => Promise<any>, ok: string) => {
    setBusy(true); setError('')
    try { await fn(); showToast(ok, 'success'); load(); return true }
    catch (e) { setError(errMsg(e, 'That did not work.')); return false }
    finally { setBusy(false) }
  }

  if (error && !rows) return <div className="ss-note err" role="alert">{error}</div>
  if (!rows) return <div className="ss-list">{[1, 2].map(i => <div key={i} className="ss-skel" style={{ height: 70 }} />)}</div>
  if (rows.length === 0) return <Empty title="No vendors yet" text="Approved vendors show up here." />

  return (
    <>
      {error && <div className="ss-note err" role="alert">{error}</div>}
      <div className="ss-list">
        {rows.map(v => (
                   <div key={v.userId} className="ss-item">
            <div className="ss-item-main">
              <p className="ss-item-t">
                {v.businessName}
                {v.isVerified && <span style={{ marginLeft: 8, color: '#16a34a', fontSize: 12, fontWeight: 700 }}>{v.isVerified && <VerifiedBadge />}</span>}
              </p>
              <p className="ss-item-s">{v.verifiedName} · @{v.user.username} · {v.user.email || 'no email'} · {v.cacNumber || 'no CAC'}</p>
              {v.status === 'SUSPENDED' && v.suspendedReason && <p className="ss-item-s">Suspended: {v.suspendedReason}</p>}
            </div>
            <Pill tone={statusTone(v.status)}>{statusLabel(v.status)}</Pill>
            {isAdmin && !v.isVerified && (
              <button type="button" className="ss-btn sm" disabled={busy}
                onClick={() => { if (window.confirm(`Give ${v.businessName} the Verified badge?`)) act(() => staffApi.verifyVendor(v.userId), 'Verified badge given') }}>Give badge</button>
            )}
            {isAdmin && v.isVerified && (
              <button type="button" className="ss-btn ghost sm" disabled={busy}
                onClick={() => { if (window.confirm(`Remove the Verified badge from ${v.businessName}?`)) act(() => staffApi.unverifyVendor(v.userId), 'Verified badge removed') }}>Remove badge</button>
            )}
            {isAdmin && v.status === 'ACTIVE' && <button type="button" className="ss-btn danger sm" onClick={() => setSuspendFor(v)}>Suspend</button>}
            {isAdmin && v.status === 'SUSPENDED' && (
              <button type="button" className="ss-btn ghost sm" disabled={busy}
                onClick={() => { if (window.confirm(`Reinstate ${v.businessName}? Their products stay paused until they turn them on.`)) act(() => staffApi.reinstate(v.userId), 'Vendor reinstated') }}>Reinstate</button>
            )}
          </div>
                ))}
      </div>
      {suspendFor && (
        <ReasonModal title={`Suspend ${suspendFor.businessName}`} label="Reason (the vendor is told)" confirmText="Suspend vendor" busy={busy}
          onClose={() => setSuspendFor(null)}
          onConfirm={async reason => { if (await act(() => staffApi.suspend(suspendFor.userId, reason), 'Vendor suspended')) setSuspendFor(null) }} />
      )}
    </>
  )
}

// ══════════════════════════════════════════════════════════════
// PRODUCTS
// ══════════════════════════════════════════════════════════════

type ProdRow = { id: string; referenceNumber: string; name: string; price: number; status: string; isFlagged: boolean; availableStock: number; vendor: { businessName: string | null; username: string } }

function ProductsTab() {
  const { showToast } = useUIStore()
  const [q, setQ] = useState('')
  const dq = useDebounced(q.trim(), 350)
  const [rows, setRows] = useState<ProdRow[] | null>(null)
  const [error, setError] = useState('')
  const [flagFor, setFlagFor] = useState<{ p: ProdRow; flagged: boolean } | null>(null)
  const [noteFor, setNoteFor] = useState<ProdRow | null>(null)
  const [busy, setBusy] = useState(false)

  const load = useCallback(() => {
    staffApi.products({ q: dq || undefined })
      .then(res => { setRows((unwrap(res) as any).items as ProdRow[]); setError('') })
      .catch(e => setError(errMsg(e, 'Could not load products.')))
  }, [dq])
  useEffect(() => { setRows(null); load() }, [load])

  const act = async (fn: () => Promise<any>, ok: string) => {
    setBusy(true); setError('')
    try { await fn(); showToast(ok, 'success'); load(); return true }
    catch (e) { setError(errMsg(e, 'That did not work.')); return false }
    finally { setBusy(false) }
  }

  return (
    <>
      <div className="ss-field">
        <label htmlFor="ss-pq">Search by reference number, product name or vendor</label>
        <input id="ss-pq" value={q} onChange={e => setQ(e.target.value)} placeholder="SS-2026-123456" />
      </div>
      {error && <div className="ss-note err" role="alert">{error}</div>}

      {rows === null ? (
        <div className="ss-list">{[1, 2].map(i => <div key={i} className="ss-skel" style={{ height: 70 }} />)}</div>
      ) : rows.length === 0 ? (
        <Empty title="No products found" text="Try a reference number or a different name." />
      ) : (
        <div className="ss-list">
          {rows.map(p => (
            <div key={p.id} className="ss-item">
              <div className="ss-item-main">
                <p className="ss-item-t">{p.name}</p>
                <p className="ss-item-s"><span className="ss-mono">{p.referenceNumber}</span> · {naira(p.price)} · {p.vendor.businessName || p.vendor.username} · {p.availableStock} left</p>
              </div>
              <span style={{ display: 'flex', gap: 6, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
                <Pill tone={statusTone(p.status)}>{statusLabel(p.status)}</Pill>
                {p.isFlagged && <Pill tone="red">On hold</Pill>}
              </span>
              <button type="button" className="ss-btn ghost sm" onClick={() => setNoteFor(p)}>Note</button>
              {p.isFlagged
                ? <button type="button" className="ss-btn ghost sm" onClick={() => setFlagFor({ p, flagged: false })}>Release</button>
                : <button type="button" className="ss-btn danger sm" onClick={() => setFlagFor({ p, flagged: true })}>Hold</button>}
            </div>
          ))}
        </div>
      )}

      {flagFor && (
        <ReasonModal
          title={flagFor.flagged ? `Put "${flagFor.p.name}" on hold` : `Release "${flagFor.p.name}"`}
          label={flagFor.flagged ? 'Reason (the vendor is told). It is paused and they cannot turn it back on.' : 'Reason (the vendor is told). They can then turn it back on.'}
          confirmText={flagFor.flagged ? 'Put on hold' : 'Release'} busy={busy}
          onClose={() => setFlagFor(null)}
          onConfirm={async reason => { if (await act(() => staffApi.flagProduct(flagFor.p.id, { flagged: flagFor.flagged, reason }), flagFor.flagged ? 'Product on hold' : 'Product released')) setFlagFor(null) }} />
      )}
      {noteFor && (
        <ReasonModal title={`Note on "${noteFor.name}"`} label="Your note (only staff see it)" confirmText="Save note" busy={busy}
          onClose={() => setNoteFor(null)}
          onConfirm={async text => { if (await act(() => staffApi.productNote(noteFor.id, text), 'Note saved')) setNoteFor(null) }} />
      )}
    </>
  )
}
export function VendorReviewPanels({ isAdmin }: { isAdmin: boolean }) {
  const [tab, setTab] = useState<Tab>('APPS')
  return (
    <div className="ss-stack">
      <SsStyles />
      <div className="ss-checks">
        {([['APPS', 'Applications'], ['VENDORS', 'Vendors'], ['PRODUCTS', 'Products']] as [Tab, string][]).map(([k, l]) => (
          <button key={k} type="button" className={`ss-check ${tab === k ? 'on' : ''}`} onClick={() => setTab(k)}>{l}</button>
        ))}
      </div>
      {tab === 'APPS' && <ApplicationsTab isAdmin={isAdmin} />}
      {tab === 'VENDORS' && <VendorsTab isAdmin={isAdmin} />}
      {tab === 'PRODUCTS' && <ProductsTab />}
    </div>
  )
}