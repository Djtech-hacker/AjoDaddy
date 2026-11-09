// src/components/ss/SsPinModal.tsx
// Asks for the 4-digit transaction PIN before money moves (same PIN as the wallet).

import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Modal } from '@/components/ss/ssShared'
import { useAuthStore } from '@/stores/authStore'

export default function SsPinModal({
  title = 'Enter your PIN', summary, confirmLabel = 'Confirm', onClose, onConfirm,
}: {
  title?: string
  summary?: string
  confirmLabel?: string
  onClose: () => void
  // should throw an Error (with a readable message) when the PIN is wrong
  onConfirm: (pin: string) => Promise<void>
}) {
  const navigate = useNavigate()
  const { user } = useAuthStore()
  const [pin, setPin] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const hasPin = !!user?.hasTransactionPin

  const submit = async () => {
    if (!/^\d{4}$/.test(pin) || busy) return
    setBusy(true); setError('')
    try {
      await onConfirm(pin)
    } catch (e: any) {
      setError(e?.message || 'Incorrect PIN')
      setPin('')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal title={title} onClose={onClose}>
      {!hasPin ? (
        <>
          <div className="ss-note warn">You need a transaction PIN before you can pay. Set it in your wallet, then come back.</div>
          <div className="ss-row end" style={{ marginTop: 14 }}>
            <button type="button" className="ss-btn ghost" onClick={onClose}>Cancel</button>
            <button type="button" className="ss-btn" onClick={() => navigate('/wallet')}>Set my PIN →</button>
          </div>
        </>
      ) : (
        <>
          {summary && <p className="ss-p">{summary}</p>}
          <div className="ss-field" style={{ marginTop: 12 }}>
            <label htmlFor="ss-pin">Transaction PIN</label>
            <input
              id="ss-pin" type="password" inputMode="numeric" autoComplete="off" autoFocus maxLength={4}
              placeholder="••••" value={pin}
              onChange={e => { setPin(e.target.value.replace(/\D/g, '')); setError('') }}
              onKeyDown={e => { if (e.key === 'Enter') submit() }}
            />
          </div>
          {error && <div className="ss-note err" role="alert">{error}</div>}
          <div className="ss-row end" style={{ marginTop: 14 }}>
            <button type="button" className="ss-btn ghost" onClick={onClose}>Cancel</button>
            <button type="button" className="ss-btn" disabled={pin.length !== 4 || busy} onClick={submit}>
              {busy ? <><span className="ss-spin" /> Please wait…</> : confirmLabel}
            </button>
          </div>
        </>
      )}
    </Modal>
  )
}