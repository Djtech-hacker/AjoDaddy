// src/components/ss/SsReportModal.tsx
// "Report vendor": pick a reason, say what happened, send it to customer care.

import { useState } from 'react'
import { Modal, errMsg } from '@/components/ss/ssShared'
import { reportApi } from '@/api/smallSmall'
import { useUIStore } from '@/stores/uiStore'

const REASONS: [string, string][] = [
  ['SCAM', 'Scam or fraud'],
  ['NOT_AS_DESCRIBED', 'Product is fake or not as described'],
  ['NO_DELIVERY', 'Not delivering the goods'],
  ['OFF_PLATFORM', 'Asked me to pay or chat outside TAREVA'],
  ['ABUSE', 'Rude, threatening or abusive'],
  ['OTHER', 'Something else'],
]

export default function SsReportModal({
  vendorName, threadId, orderId, productId, onClose,
}: {
  vendorName?: string
  threadId?: string
  orderId?: string
  productId?: string
  onClose: () => void
}) {
  const { showToast } = useUIStore()
  const [reason, setReason] = useState('')
  const [details, setDetails] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [done, setDone] = useState(false)

  const valid = !!reason && details.trim().length >= 10

  const submit = async () => {
    if (!valid || busy) return
    setBusy(true); setError('')
    try {
      await reportApi.vendor({ reason, details: details.trim(), threadId, orderId, productId })
      setDone(true)
      showToast('Report sent to customer care', 'success')
    } catch (e) {
      setError(errMsg(e, 'Could not send your report. Please try again.'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal title={`Report ${vendorName || 'this vendor'}`} onClose={onClose}>
      {done ? (
        <>
          <div className="ss-note ok">Thank you. Our team will look into this and follow up with you. The vendor is not told who reported them.</div>
          <div className="ss-row end" style={{ marginTop: 14 }}>
            <button type="button" className="ss-btn" onClick={onClose}>Close</button>
          </div>
        </>
      ) : (
        <>
          <p className="ss-p">Tell us what went wrong. Customer care reviews every report, and the vendor is not told who reported them.</p>

          <div className="ss-field" style={{ marginTop: 12 }}>
            <label htmlFor="ss-rep-reason">What is the problem?</label>
            <select id="ss-rep-reason" value={reason} onChange={e => setReason(e.target.value)}>
              <option value="">Choose a reason</option>
              {REASONS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
            </select>
          </div>

          <div className="ss-field">
            <label htmlFor="ss-rep-details">What happened?</label>
            <textarea id="ss-rep-details" rows={4} maxLength={1500} value={details} onChange={e => setDetails(e.target.value)}
              placeholder="Tell us in your own words, so we can help." />
            <p className="ss-hint">{threadId ? 'The last messages of this chat are sent with your report so we can see what was said.' : 'The more detail you give, the faster we can help.'}</p>
          </div>

          {error && <div className="ss-note err" role="alert">{error}</div>}

          <div className="ss-row end" style={{ marginTop: 12 }}>
            <button type="button" className="ss-btn ghost" onClick={onClose}>Cancel</button>
            <button type="button" className="ss-btn" disabled={!valid || busy} onClick={submit}>{busy ? 'Sending…' : 'Send report'}</button>
          </div>
        </>
      )}
    </Modal>
  )
} 