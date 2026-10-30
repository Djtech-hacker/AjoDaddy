// src/pages/vendor/VendorProductFormPage.tsx
// Routes: /vendor/products/new  and  /vendor/products/:id
// Post or edit a product: photos, price, stock, how customers can pay, refund limit, and when you are paid.
// The checks here match the server's rules, so people see what is wrong before they press save.

import { useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import DashboardLayout from '@/components/layout/DashboardLayout'
import { vendorShopApi, uploadToCloudinary, type ProductPayload } from '@/api/smallSmall'
import { SsStyles, SsTabs, errMsg, unwrap, FREQ_LABEL } from '@/components/ss/ssShared'
import { useUIStore } from '@/stores/uiStore'

type Img = { publicId: string; url: string }

const CATEGORIES = ['Phones & Gadgets', 'Electronics', 'Fashion', 'Home & Living', 'Beauty', 'Groceries', 'Vehicles & Parts', 'Other']
const FREQS = ['DAILY', 'WEEKLY', 'MONTHLY', 'CUSTOM']
const FIXED_DAYS: Record<string, number> = { DAILY: 1, WEEKLY: 7, MONTHLY: 30 }
const ALLOWED_TYPES = ['image/jpeg', 'image/png', 'image/webp']
const MAX_IMAGES = 5
const MAX_BYTES = 5 * 1024 * 1024
const DEADLINE_CHIPS = [30, 60, 90, 180, 365]

// "2, 14" -> [2, 14]   (NaN marks anything that is not a whole number)
function parseDays(text: string): number[] {
  return text.split(/[,\s]+/).filter(Boolean).map(x => (/^\d+$/.test(x) ? Number(x) : NaN))
}

export default function VendorProductFormPage() {
  const { id } = useParams()
  const isEdit = !!id
  const navigate = useNavigate()
  const { showToast } = useUIStore()

  const [loading, setLoading] = useState(isEdit)
  const [loadError, setLoadError] = useState('')
  const [reference, setReference] = useState('')
  const [currentStock, setCurrentStock] = useState(0)

  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [category, setCategory] = useState('')
  const [price, setPrice] = useState('')
  const [totalStock, setTotalStock] = useState('1')
  const [freqs, setFreqs] = useState<string[]>(['WEEKLY'])
  const [customText, setCustomText] = useState('')
  const [deadline, setDeadline] = useState('90')
  const [refundPct, setRefundPct] = useState('30')
  const [images, setImages] = useState<Img[]>([])

  const [uploading, setUploading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    if (!id) return
    let cancelled = false
    vendorShopApi.get(id)
      .then(res => {
        if (cancelled) return
        const p: any = unwrap(res)
        setReference(p.referenceNumber); setCurrentStock(p.totalStock)
        setName(p.name); setDescription(p.description); setCategory(p.category || ''); setPrice(String(p.price))
        setFreqs(p.allowedFrequencies)
        setCustomText((p.customIntervalDays || []).join(', ')); setDeadline(String(p.paymentDeadlineDays))
        setRefundPct(String(p.refundThresholdPercent));
        setImages((p.imagePublicIds || []).map((pid: string, i: number) => ({ publicId: pid, url: p.images[i] })))
      })
      .catch(e => { if (!cancelled) setLoadError(errMsg(e, 'Could not load that product.')) })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [id])

  const toggleFreq = (f: string) => setFreqs(cur => (cur.includes(f) ? cur.filter(x => x !== f) : [...cur, f]))

  // ── the same rules the server applies ──
  const priceN = Number(price), stockN = Number(totalStock)
  const deadlineN = Number(deadline), refundN = Number(refundPct)
  const customDays = freqs.includes('CUSTOM') ? parseDays(customText) : []

  const validate = (): string => {
    if (name.trim().length < 3) return 'Give the product a name (at least 3 letters).'
    if (description.trim().length < 10) return 'Describe the product in a sentence or two (at least 10 characters).'
    if (!(priceN >= 500)) return 'The price must be at least ₦500.'
    if (images.length < 1) return 'Add at least one photo.'
    if (!isEdit && !(Number.isInteger(stockN) && stockN >= 1)) return 'How many do you have? Enter at least 1.'
    if (freqs.length < 1) return 'Choose at least one way customers can pay (daily, weekly, monthly or custom).'
    if (freqs.includes('CUSTOM')) {
      if (customDays.length < 1) return 'Enter your custom days, for example 2, 14.'
      if (customDays.length > 5) return 'Use at most 5 custom options.'
      if (customDays.some(d => !Number.isInteger(d) || d < 2 || d > 365)) return 'Custom days must be whole numbers from 2 to 365.'
      if (new Set(customDays).size !== customDays.length) return 'Each custom option must be different.'
    }
    if (!(Number.isInteger(deadlineN) && deadlineN >= 7 && deadlineN <= 730)) return 'The payment time must be from 7 to 730 days.'
    const intervals = freqs.flatMap(f => (f === 'CUSTOM' ? customDays : [FIXED_DAYS[f]]))
    const longest = Math.max(...intervals)
    if (deadlineN < longest) return `The payment time (${deadlineN} days) must be at least as long as your longest interval (${longest} days).`
    if (!(Number.isInteger(refundN) && refundN >= 0 && refundN <= 100)) return 'The refund limit must be from 0 to 100.'
    return ''
  }
  const problem = validate()

  const pickPhoto = async (file: File | undefined | null) => {
    if (!file) return
    setError('')
    if (!ALLOWED_TYPES.includes(file.type)) { setError('Photos must be JPG, PNG or WEBP.'); return }
    if (file.size > MAX_BYTES) { setError('That photo is too large. The maximum size is 5MB.'); return }
    if (images.length >= MAX_IMAGES) { setError(`You can add up to ${MAX_IMAGES} photos.`); return }
    setUploading(true)
    try {
      const sig: any = unwrap(await vendorShopApi.signature())
      const up = await uploadToCloudinary(sig, file)
      setImages(cur => [...cur, { publicId: up.public_id, url: `https://res.cloudinary.com/${sig.cloudName}/image/upload/c_limit,w_320/${up.public_id}` }])
    } catch (e) {
      setError(errMsg(e, 'The upload failed. Please try again.'))
    } finally {
      setUploading(false)
    }
  }

  const save = async () => {
    if (problem) { setError(problem); return }
    setError(''); setSaving(true)
    const body: ProductPayload = {
      name: name.trim(), description: description.trim(), category: category || undefined, price: priceN,
      imagePublicIds: images.map(i => i.publicId), allowedFrequencies: freqs,
      customIntervalDays: customDays, paymentDeadlineDays: deadlineN, refundThresholdPercent: refundN,
      payoutMode: 'ON_FULL_PAYMENT',
    }
    try {
      if (isEdit && id) await vendorShopApi.update(id, body)
      else await vendorShopApi.create({ ...body, totalStock: stockN })
      showToast(isEdit ? 'Product saved' : 'Product posted', 'success')
      navigate('/vendor')
    } catch (e) {
      setError(errMsg(e, 'Could not save the product.'))
      setSaving(false)
    }
  }

  return (
    <DashboardLayout title={isEdit ? 'Edit product' : 'New product'} subtitle="Your vendor area">
      <div className="ss-root ss-narrow">
        <SsStyles />
        <SsTabs />
        <div><button type="button" className="ss-btn ghost sm" onClick={() => navigate('/vendor')}>← Back to my shop</button></div>

        {loading ? <div className="ss-skel" style={{ height: 300 }} /> : loadError ? <div className="ss-note err">{loadError}</div> : (
          <>
            {isEdit && <div className="ss-note ok">Changes apply to <b>new</b> customers. Customers who already started a plan keep the terms they agreed to. Reference <span className="ss-mono">{reference}</span>.</div>}
            {error && <div className="ss-note err" role="alert">{error}</div>}

            <div className="ss-card accent">
              <p className="ss-h">The product</p>
              <div className="ss-field">
                <label htmlFor="pf-name">Name</label>
                <input id="pf-name" value={name} onChange={e => setName(e.target.value)} maxLength={120} placeholder="e.g. Samsung Galaxy A15 128GB" />
              </div>
              <div className="ss-field">
                <label htmlFor="pf-desc">Description</label>
                <textarea id="pf-desc" rows={4} value={description} onChange={e => setDescription(e.target.value)} maxLength={3000} placeholder="What is it, what condition, what is included?" />
              </div>
              <div className="ss-field">
                <label htmlFor="pf-cat">Category</label>
                <select id="pf-cat" value={category} onChange={e => setCategory(e.target.value)}>
                  <option value="">Choose a category</option>
                  {CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
                </select>
              </div>

              <div className="ss-field">
                <label>Photos ({images.length} of {MAX_IMAGES})</label>
                <div className="ss-gallery-t" style={{ flexWrap: 'wrap' }}>
                  {images.map((im, i) => (
                    <div key={im.publicId} style={{ position: 'relative' }}>
                      <img src={im.url} alt={`Photo ${i + 1}`} style={{ width: 80, height: 80, objectFit: 'cover', borderRadius: 10, border: '1px solid #E5E7EB' }} />
                      <button type="button" className="ss-x" style={{ position: 'absolute', top: -8, right: -8, width: 24, height: 24, fontSize: 14 }}
                        onClick={() => setImages(cur => cur.filter(x => x.publicId !== im.publicId))} aria-label={`Remove photo ${i + 1}`}>×</button>
                    </div>
                  ))}
                  {images.length < MAX_IMAGES && (
                    <label className={`ss-btn ghost ${uploading ? '' : ''}`} style={{ width: 80, height: 80, flexDirection: 'column', padding: 0, cursor: uploading ? 'wait' : 'pointer' }}>
                      {uploading ? <span className="ss-spin" /> : <><span style={{ fontSize: 22, lineHeight: 1 }}>+</span><span style={{ fontSize: 10 }}>Add photo</span></>}
                      <input type="file" hidden disabled={uploading} accept="image/jpeg,image/png,image/webp"
                        onChange={e => { pickPhoto(e.target.files?.[0]); e.target.value = '' }} />
                    </label>
                  )}
                </div>
                <p className="ss-hint">Clear photos sell. JPG, PNG or WEBP, up to 5MB each.</p>
              </div>
            </div>

            <div className="ss-card">
              <p className="ss-h">Price and stock</p>
              <div className="ss-two">
                <div className="ss-field">
                  <label htmlFor="pf-price">Full price (₦)</label>
                  <input id="pf-price" inputMode="decimal" value={price} onChange={e => setPrice(e.target.value.replace(/[^\d.]/g, ''))} />
                </div>
                <div className="ss-field">
                  <label htmlFor="pf-stock">{isEdit ? 'Total stock' : 'How many do you have?'}</label>
                  {isEdit
                    ? <input id="pf-stock" value={currentStock} disabled />
                    : <input id="pf-stock" inputMode="numeric" value={totalStock} onChange={e => setTotalStock(e.target.value.replace(/\D/g, ''))} />}
                  {isEdit && <p className="ss-hint">Change stock from your shop page, so every change is recorded.</p>}
                </div>
              </div>
            </div>

            <div className="ss-card">
              <p className="ss-h">How customers can pay</p>
              <div className="ss-field">
                <label>Payment rhythm you allow</label>
                <div className="ss-checks">
                  {FREQS.map(f => (
                    <label key={f} className={`ss-check ${freqs.includes(f) ? 'on' : ''}`}>
                      <input type="checkbox" checked={freqs.includes(f)} onChange={() => toggleFreq(f)} /> {FREQ_LABEL[f]}
                    </label>
                  ))}
                </div>
              </div>
              {freqs.includes('CUSTOM') && (
                <div className="ss-field">
                  <label htmlFor="pf-custom">Custom options (days between payments)</label>
                  <input id="pf-custom" value={customText} onChange={e => setCustomText(e.target.value)} placeholder="e.g. 2, 14" />
                  <p className="ss-hint">Customers can pick any of these, for example "every 2 days" or "every 14 days".</p>
                </div>
              )}
              <div className="ss-field">
                <label htmlFor="pf-dead">Longest time to finish paying (days)</label>
                <input id="pf-dead" inputMode="numeric" value={deadline} onChange={e => setDeadline(e.target.value.replace(/\D/g, ''))} />
                <div className="ss-quick" style={{ marginTop: 8, marginBottom: 0 }}>
                  {DEADLINE_CHIPS.map(d => <button key={d} type="button" className="ss-btn ghost sm" onClick={() => setDeadline(String(d))}>{d >= 365 ? '1 year' : `${d / 30} month${d / 30 === 1 ? '' : 's'}`}</button>)}
                </div>
                <p className="ss-hint">Customers pay any amount they like, from start to finish, until the full price is covered.</p>
              </div>
            </div>

            <div className="ss-card">
              <p className="ss-h">Refunds and when you are paid</p>
              <div className="ss-field">
                <label htmlFor="pf-refund">Customers can cancel for a refund while they have paid LESS than (%)</label>
                <input id="pf-refund" inputMode="numeric" value={refundPct} onChange={e => setRefundPct(e.target.value.replace(/\D/g, ''))} />
                <p className="ss-hint">
                  {refundN === 0 ? 'No refunds on this product.' : `Below ${refundN}% a customer can cancel. A 10% fee is kept: you receive 3% of what they paid and TAREVA 7%.`}
                </p>
              </div>

              <p className="ss-hint">You are paid when the customer finishes paying.</p>
            </div>

            <div className="ss-row end">
              <button type="button" className="ss-btn ghost" onClick={() => navigate('/vendor')}>Cancel</button>
              <button type="button" className="ss-btn" disabled={saving || uploading || !!problem} onClick={save}>
                {saving ? <><span className="ss-spin" /> Saving…</> : isEdit ? <>Save changes →</> : <>Post product →</>}
              </button>
            </div>
            {problem && <p className="ss-hint" style={{ textAlign: 'right', marginTop: 0 }}>{problem}</p>}
          </>
        )}
      </div>
    </DashboardLayout>
  )
}