// src/pages/vendor/BecomeVendorPage.tsx
//
// One page for the whole vendor application. What it shows depends on where the user is:
//   - already a vendor ............ a "you're a vendor" card
//   - identity not verified ....... sends them to /verify-identity first
//   - application under review .... a waiting card
//   - recently rejected ........... the reason and the date they can apply again
//   - otherwise ................... the form: business details, then documents, then submit
// (also used when we ask for more information: the note is shown and they fix and resubmit)
//
// Styled like KycVerificationPage (same cards, tick tiles and green accents), inside DashboardLayout.

import { useCallback, useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { motion, AnimatePresence } from 'framer-motion'
import DashboardLayout from '@/components/layout/DashboardLayout'
import { useUIStore } from '@/stores/uiStore'
import { vendorApi, vendorBankApi, uploadToCloudinary } from '@/api/smallSmall'
import { SsStyles, SsTabs } from '@/components/ss/ssShared'

type DocType = 'CAC' | 'SOCIAL_PROOF' | 'SALES_PROOF'

type Doc = {
  id: string
  type: DocType
  status: 'PENDING' | 'VERIFIED' | 'REJECTED'
  reviewerNote?: string | null
  fileName?: string | null
  mimeType?: string | null
}

type Application = {
  id: string
  status: string
  businessName: string
  category: string
  description?: string | null
  phone?: string | null
  address?: string | null
  cacNumber?: string | null
  socialLinks: string[]
  bankAccountId?: string | null
  rejectionReason?: string | null
  infoRequestedNote?: string | null
  reapplyAfter?: string | null
  submittedAt?: string | null
  documents: Doc[]
}

type Me = {
  isVendor: boolean
  profile: any
  application: Application | null
  kyc: { identityComplete: boolean; flag: string | null; verifiedName: string | null }
}

type Bank = { id: string; bankName: string; accountName: string; accountLast4: string; isDefault?: boolean }

const CATEGORIES = ['Phones & Gadgets', 'Electronics', 'Fashion', 'Home & Living', 'Beauty', 'Groceries', 'Vehicles & Parts', 'Other']

const DOC_RULES: Record<DocType, { label: string; hint: string; min: number; max: number }> = {
  CAC:          { label: 'CAC certificate',     hint: 'Your business registration certificate (a PDF or a clear photo).',                      min: 1, max: 2 },
  SOCIAL_PROOF: { label: 'Social media page',   hint: 'A screenshot of your business page showing its name, followers and recent posts.',      min: 1, max: 3 },
  SALES_PROOF:  { label: 'Successful sales',    hint: 'Screenshots of at least 2 real sales or happy customers (chats, receipts, reviews).',   min: 2, max: 6 },
}
const DOC_ORDER: DocType[] = ['CAC', 'SOCIAL_PROOF', 'SALES_PROOF']

const MAX_BYTES = 5 * 1024 * 1024
const ALLOWED_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'application/pdf']

function errMsg(err: any, fallback: string): string {
  const m = err?.response?.data?.message
  if (Array.isArray(m)) return m.join(', ')
  return m || err?.message || fallback
}

const fade = (delay = 0) => ({
  initial: { opacity: 0, y: 10 },
  animate: { opacity: 1, y: 0 },
  exit: { opacity: 0, y: -6 },
  transition: { duration: 0.3, ease: 'easeOut' as const, delay },
})

const Tick = () => (
  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3">
    <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
  </svg>
)

function normalizeLink(raw: string): string {
  const v = raw.trim()
  if (!v) return ''
  return /^https?:\/\//i.test(v) ? v : `https://${v}`
}

export default function BecomeVendorPage() {
  const navigate = useNavigate()
  const { showToast } = useUIStore()

  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState('')
  const [me, setMe] = useState<Me | null>(null)
  const [banks, setBanks] = useState<Bank[]>([])

  // form fields
  const [businessName, setBusinessName] = useState('')
  const [category, setCategory] = useState('')
  const [description, setDescription] = useState('')
  const [phone, setPhone] = useState('')
  const [address, setAddress] = useState('')
  const [cacNumber, setCacNumber] = useState('')
  const [links, setLinks] = useState<string[]>([''])
  const [bankAccountId, setBankAccountId] = useState('')
  const [accept, setAccept] = useState(false)

  const [saving, setSaving] = useState(false)
  const [uploading, setUploading] = useState<DocType | null>(null)
  const [removing, setRemoving] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')

  const load = useCallback(async (fillForm: boolean) => {
    try {
      const [meRes, bankRes] = await Promise.all([vendorApi.me(), vendorBankApi.list().catch(() => null)])
      const data = (meRes.data?.data ?? meRes.data) as Me
      setMe(data)

      const rawBanks: any = bankRes ? (bankRes.data?.data ?? bankRes.data) : []
      const list: Bank[] = Array.isArray(rawBanks) ? rawBanks : Array.isArray(rawBanks?.accounts) ? rawBanks.accounts : []
      setBanks(list)

      const a = data.application
      const editing = a && ['DRAFT', 'NEEDS_MORE_INFO'].includes(a.status) ? a : null
      if (fillForm && editing) {
        setBusinessName(editing.businessName || '')
        setCategory(editing.category || '')
        setDescription(editing.description || '')
        setPhone(editing.phone || '')
        setAddress(editing.address || '')
        setCacNumber(editing.cacNumber || '')
        setLinks(editing.socialLinks?.length ? editing.socialLinks : [''])
        setBankAccountId(editing.bankAccountId || '')
      } else if (fillForm && !bankAccountId && list.length) {
        const def = list.find(b => b.isDefault) || list[0]
        setBankAccountId(def.id)
      }
      setLoadError('')
    } catch (e) {
      setLoadError(errMsg(e, 'Could not load your vendor details.'))
    } finally {
      setLoading(false)
    }
  }, [bankAccountId])

  useEffect(() => { load(true) }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const retryLoad = () => { setLoading(true); setLoadError(''); load(true) }

  // ── What to show ─────────────────────────────────────────
  const app = me?.application ?? null
  const editable = app && ['DRAFT', 'NEEDS_MORE_INFO'].includes(app.status) ? app : null
  const waitUntil = app?.status === 'REJECTED' && app.reapplyAfter && new Date(app.reapplyAfter) > new Date() ? new Date(app.reapplyAfter) : null

  const mode: 'VENDOR' | 'KYC' | 'REVIEW' | 'WAIT' | 'FORM' | null = !me ? null
    : me.isVendor ? 'VENDOR'
    : !me.kyc.identityComplete ? 'KYC'
    : app && ['SUBMITTED', 'UNDER_REVIEW'].includes(app.status) ? 'REVIEW'
    : waitUntil ? 'WAIT'
    : 'FORM'

  const docs: Doc[] = editable?.documents ?? []
  const counts = useMemo(() => {
    const c: Record<DocType, number> = { CAC: 0, SOCIAL_PROOF: 0, SALES_PROOF: 0 }
    docs.forEach(d => { if (d.status !== 'REJECTED') c[d.type]++ })
    return c
  }, [docs])
  const hasRejectedDocs = docs.some(d => d.status === 'REJECTED')
  const docsReady = DOC_ORDER.every(t => counts[t] >= DOC_RULES[t].min) && !hasRejectedDocs

  // ── Step 1: save business details ────────────────────────
  const cleanLinks = links.map(normalizeLink).filter(Boolean)
  const cacClean = cacNumber.trim().toUpperCase().replace(/[\s-]/g, '')
  const detailsValid =
    businessName.trim().length >= 2 && !!category && /^(RC|BN|IT)?\d{3,10}$/.test(cacClean) &&
    cleanLinks.length >= 1 && !!bankAccountId

  const saveDetails = async () => {
    setError(''); setSaving(true)
    try {
      await vendorApi.saveApplication({
        businessName: businessName.trim(),
        category,
        description: description.trim() || undefined,
        phone: phone.trim() || undefined,
        address: address.trim() || undefined,
        cacNumber: cacClean,
        socialLinks: cleanLinks,
        bankAccountId,
      })
      showToast('Business details saved', 'success')
      await load(false)
    } catch (e) {
      setError(errMsg(e, 'Could not save your details. Please check them and try again.'))
    } finally {
      setSaving(false)
    }
  }

  // ── Step 2: upload a document ────────────────────────────
  const pickFile = async (type: DocType, file: File | undefined | null) => {
    if (!file || !editable) return
    setError('')
    if (!ALLOWED_TYPES.includes(file.type)) { setError('Use a JPG, PNG, WEBP or PDF file.'); return }
    if (file.size > MAX_BYTES) { setError('That file is too large. The maximum size is 5MB.'); return }
    if (counts[type] >= DOC_RULES[type].max) { setError(`You can upload at most ${DOC_RULES[type].max} files here.`); return }

    setUploading(type)
    try {
      const sigRes = await vendorApi.uploadSignature()
      const sig = sigRes.data?.data ?? sigRes.data
      const up = await uploadToCloudinary(sig, file)
      await vendorApi.addDocument(editable.id, { type, cloudinaryPublicId: up.public_id, fileName: file.name })
      await load(false)
    } catch (e) {
      setError(errMsg(e, 'The upload failed. Please try again.'))
    } finally {
      setUploading(null)
    }
  }

  const removeDoc = async (doc: Doc) => {
    if (!editable) return
    setError(''); setRemoving(doc.id)
    try {
      await vendorApi.removeDocument(editable.id, doc.id)
      await load(false)
    } catch (e) {
      setError(errMsg(e, 'Could not remove that file.'))
    } finally {
      setRemoving(null)
    }
  }

  // ── Step 3: submit ───────────────────────────────────────
  const submit = async () => {
    if (!editable) return
    setError(''); setSubmitting(true)
    try {
      await vendorApi.submit(editable.id, { acceptTerms: true })
      showToast('Application submitted', 'success')
      await load(false)
    } catch (e) {
      setError(errMsg(e, 'Could not submit your application.'))
    } finally {
      setSubmitting(false)
    }
  }

  const Spinner = () => <span className="bv-spin" aria-hidden />

  const tiles = [
    { num: 1, label: 'Business details', ok: !!editable, cur: !editable },
    { num: 2, label: 'Documents',        ok: !!editable && docsReady, cur: !!editable && !docsReady },
    { num: 3, label: 'Submit',           ok: false, cur: !!editable && docsReady },
  ]

  const setLink = (i: number, v: string) => setLinks(l => l.map((x, idx) => (idx === i ? v : x)))

  return (
    <DashboardLayout title="Become a vendor" subtitle="Sell on Pay Small Small">
      <div className="bv-root">
        <style>{CSS}</style>
        <SsStyles />
        <SsTabs />

        <motion.div className="bv-hero" {...fade(0)}>
          <div className="bv-icon">
            <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
              <path strokeLinecap="round" strokeLinejoin="round" d="M3 9l1-5h16l1 5M3 9v11h18V9M3 9h18M9 20v-6h6v6" />
            </svg>
          </div>
          <div>
            <p className="bv-eyebrow">Vendor application</p>
            <h2 className="bv-title">Sell to customers who pay small small</h2>
            <p className="bv-sub">Tell us about your business and upload a few documents. We review every application by hand.</p>
          </div>
        </motion.div>

        {loading ? (
          <div className="bv-skel" style={{ height: 120 }} />
        ) : loadError ? (
          <motion.div className="bv-card" {...fade(0.04)}>
            <p className="bv-h">We could not load your vendor details</p>
            <p className="bv-note err">{loadError}</p>
            <div className="bv-row"><button type="button" className="bv-btn" onClick={retryLoad}>Try again →</button></div>
          </motion.div>
        ) : (
          <AnimatePresence mode="wait">
            {mode === 'VENDOR' && (
              <motion.div key="vendor" className="bv-card" {...fade(0)}>
                <div className="bv-center">
                  <div className="bv-badge ok"><Tick /></div>
                  <p className="bv-h plain">You are an approved vendor</p>
                  <p className="bv-p">Your business is verified. Your products and customers are managed from your vendor area.</p>
                  <button type="button" className="bv-btn" onClick={() => navigate('/dashboard')}>Back to dashboard →</button>
                </div>
              </motion.div>
            )}

            {mode === 'KYC' && (
              <motion.div key="kyc" className="bv-card" {...fade(0)}>
                <p className="bv-h">Verify your identity first</p>
                <p className="bv-p">To protect customers, vendors must finish identity verification (NIN, BVN and a face scan) before applying.</p>
                <div className="bv-row">
                  <span className="bv-lock">It takes about two minutes.</span>
                  <button type="button" className="bv-btn" onClick={() => navigate('/verify-identity')}>Verify my identity →</button>
                </div>
              </motion.div>
            )}

            {mode === 'REVIEW' && app && (
              <motion.div key="review" className="bv-card" {...fade(0)}>
                <div className="bv-center">
                  <div className="bv-badge warn">⏳</div>
                  <p className="bv-h plain">Application under review</p>
                  <p className="bv-p">
                    {app.businessName} was submitted{app.submittedAt ? ` on ${new Date(app.submittedAt).toLocaleDateString()}` : ''}.
                    We will notify you as soon as there is a decision.
                  </p>
                </div>
              </motion.div>
            )}

            {mode === 'WAIT' && app && waitUntil && (
              <motion.div key="wait" className="bv-card" {...fade(0)}>
                <p className="bv-h">Your last application was not approved</p>
                {app.rejectionReason && <p className="bv-note err">{app.rejectionReason}</p>}
                <p className="bv-p" style={{ marginTop: 12 }}>You can apply again on {waitUntil.toLocaleDateString()}.</p>
              </motion.div>
            )}

            {mode === 'FORM' && (
              <motion.div key="form" className="bv-stack" {...fade(0)}>
                <div className="bv-grid">
                  {tiles.map(t => (
                    <div key={t.num} className={`bv-tile ${t.cur ? 'cur' : ''} ${t.ok ? 'ok' : ''}`}>
                      <p className="bv-tile-label">Step {t.num}</p>
                      <p className="bv-tile-value">{t.label}</p>
                      <span className={`bv-tick ${t.ok ? 'ok' : ''} ${t.cur ? 'cur' : ''}`}>{t.ok ? <Tick /> : <b>{t.num}</b>}</span>
                    </div>
                  ))}
                </div>

                {app?.status === 'NEEDS_MORE_INFO' && app.infoRequestedNote && (
                  <div className="bv-note warn"><b>We need a little more from you:</b> {app.infoRequestedNote}</div>
                )}
                {error && <div className="bv-note err" role="alert">{error}</div>}

                {/* ── Step 1 ── */}
                <div className="bv-card">
                  <p className="bv-h">Step 1 · Business details</p>

                  <div className="bv-two">
                    <div className="bv-field">
                      <label htmlFor="bv-name">Business name</label>
                      <input id="bv-name" value={businessName} onChange={e => setBusinessName(e.target.value)} maxLength={120} placeholder="e.g. Tobi Gadgets Ltd" />
                    </div>
                    <div className="bv-field">
                      <label htmlFor="bv-cat">What you sell</label>
                      <select id="bv-cat" value={category} onChange={e => setCategory(e.target.value)}>
                        <option value="">Choose a category</option>
                        {CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
                      </select>
                    </div>
                  </div>

                  <div className="bv-field">
                    <label htmlFor="bv-desc">About your business (optional)</label>
                    <textarea id="bv-desc" value={description} onChange={e => setDescription(e.target.value)} maxLength={1000} rows={3} placeholder="What do you sell, and where are you based?" />
                  </div>

                  <div className="bv-two">
                    <div className="bv-field">
                      <label htmlFor="bv-phone">Business phone (optional)</label>
                      <input id="bv-phone" inputMode="tel" value={phone} onChange={e => setPhone(e.target.value.replace(/[^\d+]/g, ''))} maxLength={16} placeholder="08012345678" />
                    </div>
                    <div className="bv-field">
                      <label htmlFor="bv-cac">CAC registration number</label>
                      <input id="bv-cac" value={cacNumber} onChange={e => setCacNumber(e.target.value)} maxLength={14} placeholder="RC1234567" className="mono" />
                    </div>
                  </div>

                  <div className="bv-field">
                    <label htmlFor="bv-addr">Business address (optional)</label>
                    <input id="bv-addr" value={address} onChange={e => setAddress(e.target.value)} maxLength={300} placeholder="Shop or office address" />
                  </div>

                  <div className="bv-field">
                    <label>Business social media links</label>
                    {links.map((l, i) => (
                      <div key={i} className="bv-linkrow">
                        <input value={l} onChange={e => setLink(i, e.target.value)} placeholder="instagram.com/yourbusiness" aria-label={`Social link ${i + 1}`} />
                        {links.length > 1 && (
                          <button type="button" className="bv-x" onClick={() => setLinks(ls => ls.filter((_, idx) => idx !== i))} aria-label="Remove link">×</button>
                        )}
                      </div>
                    ))}
                    {links.length < 5 && (
                      <button type="button" className="bv-link" onClick={() => setLinks(ls => [...ls, ''])}>+ Add another link</button>
                    )}
                    <p className="bv-hint">Instagram, Facebook, TikTok, X, LinkedIn, YouTube or WhatsApp.</p>
                  </div>

                  <div className="bv-field">
                    <label htmlFor="bv-bank">Payout bank account</label>
                    {banks.length === 0 ? (
                      <div className="bv-note warn">
                        You have no saved bank account. Add one in your wallet first, then come back.
                        <div style={{ marginTop: 8 }}><button type="button" className="bv-btn ghost" onClick={() => navigate('/wallet')}>Go to wallet →</button></div>
                      </div>
                    ) : (
                      <select id="bv-bank" value={bankAccountId} onChange={e => setBankAccountId(e.target.value)}>
                        <option value="">Choose the account you will withdraw to</option>
                        {banks.map(b => <option key={b.id} value={b.id}>{b.bankName} · ••••{b.accountLast4} · {b.accountName}</option>)}
                      </select>
                    )}
                    <p className="bv-hint">
                      The account name must match your verified name{me?.kyc.verifiedName ? ` (${me.kyc.verifiedName})` : ''}. Applications where the names differ are checked more closely.
                    </p>
                  </div>

                  <div className="bv-row">
                    <span className="bv-lock">{editable ? 'Saved. You can edit and save again.' : 'Save your details to unlock the document uploads.'}</span>
                    <button type="button" className="bv-btn" onClick={saveDetails} disabled={saving || !detailsValid}>
                      {saving ? <><Spinner /> Saving…</> : editable ? <>Save changes →</> : <>Save and continue →</>}
                    </button>
                  </div>
                </div>

                {/* ── Step 2 ── */}
                {editable && (
                  <div className="bv-card">
                    <p className="bv-h">Step 2 · Documents</p>
                    <p className="bv-p">JPG, PNG, WEBP or PDF, up to 5MB each. Only our review team can open these files.</p>

                    {DOC_ORDER.map(type => {
                      const rule = DOC_RULES[type]
                      const mine = docs.filter(d => d.type === type)
                      const enough = counts[type] >= rule.min
                      const full = counts[type] >= rule.max
                      return (
                        <div key={type} className="bv-doc">
                          <div className="bv-doc-head">
                            <div>
                              <p className="bv-doc-title">{rule.label} <span className={`bv-pill ${enough ? 'ok' : ''}`}>{counts[type]} of {rule.min}+</span></p>
                              <p className="bv-hint">{rule.hint}</p>
                            </div>
                            {!full && (
                              <label className={`bv-btn ghost ${uploading ? 'dis' : ''}`}>
                                {uploading === type ? <><Spinner /> Uploading…</> : <>+ Upload</>}
                                <input
                                  type="file" hidden disabled={!!uploading}
                                  accept="image/jpeg,image/png,image/webp,application/pdf"
                                  onChange={e => { pickFile(type, e.target.files?.[0]); e.target.value = '' }}
                                />
                              </label>
                            )}
                          </div>

                          {mine.length > 0 && (
                            <ul className="bv-files">
                              {mine.map(d => (
                                <li key={d.id}>
                                  <div className="bv-file">
                                    <span className="bv-fname">{d.fileName || 'Uploaded file'}</span>
                                    <span className={`bv-status ${d.status.toLowerCase()}`}>{d.status === 'PENDING' ? 'Waiting for review' : d.status === 'VERIFIED' ? 'Verified' : 'Rejected'}</span>
                                    {d.status !== 'VERIFIED' && (
                                      <button type="button" className="bv-x" onClick={() => removeDoc(d)} disabled={removing === d.id} aria-label={`Remove ${d.fileName || 'file'}`}>
                                        {removing === d.id ? '…' : '×'}
                                      </button>
                                    )}
                                  </div>
                                  {d.status === 'REJECTED' && d.reviewerNote && <p className="bv-reason">Why: {d.reviewerNote}. Remove this file and upload a new one.</p>}
                                </li>
                              ))}
                            </ul>
                          )}
                        </div>
                      )
                    })}
                  </div>
                )}

                {/* ── Step 3 ── */}
                {editable && (
                  <div className="bv-card">
                    <p className="bv-h">Step 3 · Submit</p>
                    <ul className="bv-check">
                      <li className={docsReady ? 'ok' : ''}><span>{docsReady ? <Tick /> : ''}</span>All required documents uploaded{hasRejectedDocs ? ' (replace the rejected ones)' : ''}</li>
                      <li className="ok"><span><Tick /></span>Identity verified{me?.kyc.verifiedName ? ` as ${me.kyc.verifiedName}` : ''}</li>
                    </ul>

                    <label className="bv-accept">
                      <input type="checkbox" checked={accept} onChange={e => setAccept(e.target.checked)} />
                      <span>
                        I agree to the vendor terms. Customers can cancel and get a refund while they have paid less than my refund
                        limit (a 10% fee applies: 3% to me, 7% to TAREVA), and I must deliver the goods once I am paid.
                      </span>
                    </label>

                    <div className="bv-row">
                      <span className="bv-lock">We review applications by hand, so it can take a little while.</span>
                      <button type="button" className="bv-btn" onClick={submit} disabled={submitting || !docsReady || !accept}>
                        {submitting ? <><Spinner /> Submitting…</> : <>Submit application →</>}
                      </button>
                    </div>
                  </div>
                )}
              </motion.div>
            )}
          </AnimatePresence>
        )}
      </div>
    </DashboardLayout>
  )
}

const CSS = `
  @import url('https://fonts.googleapis.com/css2?family=DM+Mono:wght@400;500&family=Inter:wght@300;400;500;600;700;800&display=swap');
  .bv-root { font-family: 'Inter', -apple-system, sans-serif; max-width: 760px; margin: 0 auto; padding: 24px 20px; display: flex; flex-direction: column; gap: 16px; color: #111827; background: #F8F9FB; min-height: 100vh; }
  .bv-stack { display: flex; flex-direction: column; gap: 16px; }

  .bv-hero { background: #fff; border: 1px solid #E5E7EB; border-radius: 20px; padding: 22px 24px; display: flex; align-items: center; gap: 16px; box-shadow: 0 1px 4px rgba(0,0,0,.04); }
  .bv-icon { width: 54px; height: 54px; border-radius: 50%; background: #F0FDF4; color: #16A34A; border: 1px solid #BBF7D0; display: flex; align-items: center; justify-content: center; flex-shrink: 0; }
  .bv-eyebrow { font-size: 12px; color: #22C55E; font-weight: 600; margin-bottom: 2px; }
  .bv-title { font-size: 21px; font-weight: 800; letter-spacing: -0.4px; color: #111827; }
  .bv-sub { font-size: 12.5px; color: #6B7280; margin-top: 3px; line-height: 1.5; }

  .bv-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 12px; }
  @media (max-width: 640px) { .bv-grid { grid-template-columns: 1fr; } }
  .bv-tile { position: relative; background: #fff; border: 1px solid #E5E7EB; border-radius: 14px; padding: 14px; transition: border-color .2s, background .2s; }
  .bv-tile.cur { border-color: #22C55E; background: #F0FDF4; box-shadow: 0 0 0 3px rgba(34,197,94,.08); }
  .bv-tile-label { font-size: 9px; font-weight: 600; letter-spacing: .05em; text-transform: uppercase; color: #9CA3AF; margin-bottom: 3px; }
  .bv-tile-value { font-size: 13px; font-weight: 600; color: #111827; }
  .bv-tick { position: absolute; top: 12px; right: 12px; width: 24px; height: 24px; border-radius: 50%; border: 1.5px solid #D1D5DB; display: flex; align-items: center; justify-content: center; color: #9CA3AF; font-size: 11px; background: #fff; }
  .bv-tick b { font-weight: 700; }
  .bv-tick.cur { border-color: #22C55E; color: #16A34A; }
  .bv-tick.ok { background: #16A34A; border-color: #16A34A; color: #fff; }

  .bv-card { position: relative; background: #fff; border: 1px solid #E5E7EB; border-radius: 18px; padding: 24px; box-shadow: 0 1px 4px rgba(0,0,0,.04); overflow: hidden; }
  .bv-card::before { content: ''; position: absolute; top: 0; left: 0; right: 0; height: 3px; background: linear-gradient(90deg, #22C55E, #0B3D2A); }
  .bv-h { font-size: 13px; font-weight: 700; color: #111827; padding-bottom: 12px; margin-bottom: 14px; border-bottom: 1px solid #F3F4F6; }
  .bv-h.plain { border: none; margin: 0; padding: 0; font-size: 15px; }
  .bv-p { font-size: 12.5px; color: #6B7280; line-height: 1.55; margin-bottom: 16px; }

  .bv-field { display: flex; flex-direction: column; margin-bottom: 16px; }
  .bv-field > label { font-size: 9px; font-weight: 600; letter-spacing: .05em; text-transform: uppercase; color: #9CA3AF; margin-bottom: 6px; }
  .bv-field input, .bv-field select, .bv-field textarea { font-family: inherit; font-size: 13.5px; color: #111827; background: #F9FAFB; border: 1px solid #E5E7EB; border-radius: 12px; padding: 12px 14px; outline: none; width: 100%; box-sizing: border-box; transition: border-color .15s, box-shadow .15s, background .15s; }
  .bv-field textarea { resize: vertical; }
  .bv-field input.mono { font-family: 'DM Mono', monospace; letter-spacing: .06em; text-transform: uppercase; }
  .bv-field input:focus, .bv-field select:focus, .bv-field textarea:focus { border-color: #22C55E; background: #fff; box-shadow: 0 0 0 3px rgba(34,197,94,.1); }
  .bv-two { display: grid; grid-template-columns: 1fr 1fr; gap: 14px; }
  @media (max-width: 640px) { .bv-two { grid-template-columns: 1fr; gap: 0; } }
  .bv-hint { font-size: 11px; color: #9CA3AF; margin-top: 6px; line-height: 1.5; }
  .bv-linkrow { display: flex; gap: 8px; margin-bottom: 8px; }
  .bv-link { align-self: flex-start; background: none; border: none; color: #16A34A; font-family: inherit; font-size: 12px; font-weight: 600; cursor: pointer; padding: 2px 0; }
  .bv-x { width: 34px; height: 34px; flex-shrink: 0; border-radius: 10px; border: 1px solid #E5E7EB; background: #fff; color: #6B7280; font-size: 18px; line-height: 1; cursor: pointer; }
  .bv-x:hover:not(:disabled) { border-color: #FCA5A5; color: #B91C1C; }

  .bv-row { display: flex; align-items: center; justify-content: space-between; gap: 14px; margin-top: 6px; flex-wrap: wrap; }
  .bv-lock { font-size: 11px; color: #6B7280; }
  .bv-btn { display: inline-flex; align-items: center; justify-content: center; gap: 8px; font-family: inherit; font-size: 13px; font-weight: 600; color: #fff; background: #0B3D2A; border: none; border-radius: 10px; padding: 12px 22px; cursor: pointer; transition: background .15s, transform .1s; }
  .bv-btn:hover:not(:disabled) { background: #0F5138; }
  .bv-btn:active:not(:disabled) { transform: scale(.98); }
  .bv-btn:disabled { opacity: .45; cursor: not-allowed; }
  .bv-btn.ghost { background: #fff; color: #0B3D2A; border: 1px solid #BBF7D0; padding: 9px 16px; font-size: 12px; }
  .bv-btn.ghost:hover:not(:disabled) { background: #F0FDF4; }
  .bv-btn.dis { opacity: .5; pointer-events: none; }
  .bv-spin { width: 13px; height: 13px; border-radius: 50%; border: 2px solid rgba(11,61,42,.25); border-top-color: #0B3D2A; animation: bv-rot .7s linear infinite; }
  .bv-btn:not(.ghost) .bv-spin { border-color: rgba(255,255,255,.4); border-top-color: #fff; }
  @keyframes bv-rot { to { transform: rotate(360deg); } }

  .bv-doc { padding: 14px 0; border-top: 1px solid #F3F4F6; }
  .bv-doc:first-of-type { border-top: none; padding-top: 0; }
  .bv-doc-head { display: flex; align-items: flex-start; justify-content: space-between; gap: 12px; }
  .bv-doc-title { font-size: 13px; font-weight: 600; color: #111827; display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
  .bv-pill { font-size: 10px; font-weight: 600; padding: 2px 8px; border-radius: 99px; background: #F3F4F6; color: #6B7280; }
  .bv-pill.ok { background: #DCFCE7; color: #166534; }
  .bv-files { list-style: none; margin: 10px 0 0; padding: 0; display: flex; flex-direction: column; gap: 8px; }
  .bv-file { display: flex; align-items: center; gap: 10px; background: #F9FAFB; border: 1px solid #E5E7EB; border-radius: 10px; padding: 8px 10px; }
  .bv-fname { flex: 1; min-width: 0; font-size: 12px; color: #374151; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .bv-status { font-size: 10px; font-weight: 600; padding: 2px 8px; border-radius: 99px; white-space: nowrap; }
  .bv-status.pending { background: #FEF3C7; color: #92400E; }
  .bv-status.verified { background: #DCFCE7; color: #166534; }
  .bv-status.rejected { background: #FEE2E2; color: #991B1B; }
  .bv-reason { font-size: 11.5px; color: #B91C1C; margin: 6px 2px 0; }

  .bv-check { list-style: none; margin: 0 0 16px; padding: 0; display: flex; flex-direction: column; gap: 10px; }
  .bv-check li { display: flex; align-items: center; gap: 10px; font-size: 12.5px; color: #6B7280; }
  .bv-check li span { width: 20px; height: 20px; border-radius: 50%; border: 1.5px solid #D1D5DB; display: flex; align-items: center; justify-content: center; flex-shrink: 0; color: #fff; }
  .bv-check li.ok { color: #374151; }
  .bv-check li.ok span { background: #16A34A; border-color: #16A34A; }
  .bv-accept { display: flex; gap: 10px; align-items: flex-start; font-size: 12px; color: #374151; line-height: 1.55; background: #F9FAFB; border: 1px solid #E5E7EB; border-radius: 12px; padding: 12px 14px; margin-bottom: 14px; cursor: pointer; }
  .bv-accept input { margin-top: 3px; accent-color: #16A34A; }

  .bv-note { font-size: 12px; font-weight: 500; padding: 11px 14px; border-radius: 10px; line-height: 1.5; }
  .bv-note.err { color: #B91C1C; background: #FEF2F2; border: 1px solid #FECACA; }
  .bv-note.warn { color: #92400E; background: #FFFBEB; border: 1px solid #FDE68A; }

  .bv-center { display: flex; flex-direction: column; align-items: center; text-align: center; gap: 10px; padding: 14px 0; }
  .bv-badge { width: 56px; height: 56px; border-radius: 50%; display: flex; align-items: center; justify-content: center; font-size: 22px; }
  .bv-badge.ok { background: #16A34A; color: #fff; box-shadow: 0 0 0 8px rgba(34,197,94,.12); }
  .bv-badge.ok svg { width: 24px; height: 24px; }
  .bv-badge.warn { background: #FEF3C7; }

  .bv-skel { background: linear-gradient(90deg, #F3F4F6 25%, #E5E7EB 50%, #F3F4F6 75%); background-size: 200% 100%; animation: bv-shimmer 1.5s infinite; border-radius: 14px; }
  @keyframes bv-shimmer { 0% { background-position: 200% 0; } 100% { background-position: -200% 0; } }
  @media (prefers-reduced-motion: reduce) { .bv-spin, .bv-skel { animation: none; } }
`