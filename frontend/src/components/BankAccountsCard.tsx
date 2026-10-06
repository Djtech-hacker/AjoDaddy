import { useState, useEffect } from 'react'
import { Modal } from '@/components/ui'
import { useAuthStore } from '@/stores/authStore'

const API_BASE = import.meta.env.VITE_API_URL || '/api'

async function apiFetch(path: string, options: RequestInit = {}) {
  const token = useAuthStore.getState().accessToken
  const res = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}), ...options.headers },
  })
  const body = await res.json().catch(() => ({}))
  if (!res.ok) {
    const msg = Array.isArray(body.message) ? body.message[0] : body.message
    throw new Error(msg || `Request failed (${res.status})`)
  }
  return body.data ?? body
}

interface SavedAccount { id: string; bankName: string; accountName: string; last4: string; isDefault: boolean; usableAfter: string }
interface Bank { name: string; code: string }
type Resolved = { matched: true; accountName: string } | { matched: false; reason: string }

const hoursLeft = (iso: string) => Math.ceil((new Date(iso).getTime() - Date.now()) / 3600_000)

const CSS = `
  .ba-select { width: 100%; height: 38px; border: 1px solid #E5E7EB; border-radius: 8px; background: #F9FAFB; padding: 0 10px; font: inherit; font-size: 12px; color: #111827; outline: none; }
  .ba-select:focus, .ba-in:focus { border-color: #22C55E; background: #fff; box-shadow: 0 0 0 3px rgba(34,197,94,.1); }
  .ba-in { width: 100%; height: 38px; border: 1px solid #E5E7EB; border-radius: 8px; background: #F9FAFB; padding: 0 12px; font-family: 'DM Mono', monospace; font-size: 13px; letter-spacing: .12em; color: #111827; outline: none; }
  .ba-lab { display: block; font-size: 9.5px; font-weight: 600; letter-spacing: .05em; text-transform: uppercase; color: #9CA3AF; margin-bottom: 5px; }
  .ba-stack { display: flex; flex-direction: column; gap: 14px; }
  .ba-ok { display: flex; gap: 10px; align-items: center; background: #F0FDF4; border-radius: 10px; padding: 12px; }
  .ba-ok b { display: block; font-size: 13px; color: #14532D; }
  .ba-ok span { font-size: 10.5px; color: #15803D; }
  .ba-tick { width: 22px; height: 22px; border-radius: 50%; background: #16A34A; color: #fff; display: flex; align-items: center; justify-content: center; flex-shrink: 0; }
  .ba-bad { background: #FEF2F2; color: #B91C1C; border-radius: 10px; padding: 12px; font-size: 12px; line-height: 1.5; }
  .ba-btn { height: 38px; padding: 0 18px; border: none; border-radius: 8px; background: #0B3D2A; color: #fff; font: inherit; font-size: 12px; font-weight: 600; cursor: pointer; }
  .ba-btn:hover:not(:disabled) { background: #0F5138; }
  .ba-btn:disabled { opacity: .45; cursor: not-allowed; }
  .ba-btn.ghost { background: #fff; color: #374151; border: 1px solid #D1D5DB; }
  .ba-btn.danger { background: #DC2626; }
  .ba-foot { display: flex; gap: 8px; justify-content: flex-end; width: 100%; }
  .ba-row-actions { display: flex; gap: 10px; margin-top: 8px; }
  .ba-lnk { background: none; border: none; padding: 0; font: inherit; font-size: 10.5px; font-weight: 600; color: #166534; cursor: pointer; }
  .ba-lnk.red { color: #B91C1C; }
  .ba-hold { font-size: 9px; font-weight: 700; letter-spacing: .04em; text-transform: uppercase; color: #B45309; background: #FEF3C7; padding: 3px 8px; border-radius: 6px; }
  .ba-err { font-size: 12px; color: #B91C1C; background: #FEF2F2; border-radius: 8px; padding: 9px 11px; }
`

export default function BankAccountsCard() {
  const [accounts, setAccounts] = useState<SavedAccount[]>([])
  const [loading, setLoading] = useState(true)
  const [listError, setListError] = useState('')

  // add flow
  const [addOpen, setAddOpen] = useState(false)
  const [banks, setBanks] = useState<Bank[]>([])
  const [bankCode, setBankCode] = useState('')
  const [acctNo, setAcctNo] = useState('')
  const [resolving, setResolving] = useState(false)
  const [resolved, setResolved] = useState<Resolved | null>(null)
  const [pin, setPin] = useState('')
  const [saving, setSaving] = useState(false)
  const [formError, setFormError] = useState('')

  // PIN-confirmed actions on existing accounts
  const [pinAction, setPinAction] = useState<{ kind: 'default' | 'remove'; id: string } | null>(null)
  const [actPin, setActPin] = useState('')
  const [actBusy, setActBusy] = useState(false)
  const [actError, setActError] = useState('')

  const load = async () => {
    try { setAccounts(await apiFetch('/bank-accounts')); setListError('') }
    catch (e: any) { setListError(e.message) }
    finally { setLoading(false) }
  }
  useEffect(() => { load() }, [])

  const openAdd = async () => {
    setAddOpen(true)
    if (banks.length) return
    try {
      const raw = await apiFetch('/payments/banks')
      const arr = Array.isArray(raw) ? raw : raw?.banks ?? []
      setBanks(arr.map((b: any) => ({ name: b.name ?? b.bankName, code: String(b.code ?? b.bankCode) })).filter((b: Bank) => b.name && b.code))
    } catch { setFormError('Could not load the bank list. Try again.') }
  }

  const closeAdd = () => {
    setAddOpen(false); setBankCode(''); setAcctNo(''); setResolved(null); setPin(''); setFormError('')
  }

  const verify = async () => {
    setFormError(''); setResolved(null); setResolving(true)
    try { setResolved(await apiFetch('/bank-accounts/resolve', { method: 'POST', body: JSON.stringify({ bankCode, accountNumber: acctNo }) })) }
    catch (e: any) { setFormError(e.message) }
    finally { setResolving(false) }
  }

  const save = async () => {
    setFormError(''); setSaving(true)
    try {
      await apiFetch('/bank-accounts', { method: 'POST', body: JSON.stringify({ bankCode, accountNumber: acctNo, pin }) })
      closeAdd(); await load()
    } catch (e: any) { setFormError(e.message) }
    finally { setSaving(false) }
  }

  const runAction = async () => {
    if (!pinAction) return
    setActError(''); setActBusy(true)
    try {
      await apiFetch(pinAction.kind === 'remove' ? `/bank-accounts/${pinAction.id}` : `/bank-accounts/${pinAction.id}/default`, {
        method: pinAction.kind === 'remove' ? 'DELETE' : 'PATCH', body: JSON.stringify({ pin: actPin }),
      })
      setPinAction(null); setActPin(''); await load()
    } catch (e: any) { setActError(e.message) }
    finally { setActBusy(false) }
  }

  const canVerify = !!bankCode && acctNo.length === 10 && !resolving
  const matched = resolved?.matched === true

  return (
    // Enter inside these inputs must not submit the surrounding settings <form>
    <section className="pp-card" onKeyDown={e => { if (e.key === 'Enter' && (e.target as HTMLElement).tagName === 'INPUT') e.preventDefault() }}>
      <style>{CSS}</style>
      <h3 className="ps-h">Bank &amp; payment methods</h3>

      {loading ? (
        <div className="pp-skel" style={{ height: 58, borderRadius: 10 }} />
      ) : listError ? (
        <p className="ba-err" role="alert">{listError}</p>
      ) : accounts.length === 0 ? (
        <p className="ps-tiny ps-nobank">No bank account linked yet. Add one to withdraw your payouts.</p>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {accounts.map(a => {
            const hold = hoursLeft(a.usableAfter)
            return (
              <div key={a.id} className="ps-bank" style={{ alignItems: 'flex-start' }}>
                <div className="ps-bank-ic">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><path strokeLinecap="round" strokeLinejoin="round" d="M3 10l9-6 9 6M5 10v8M9 10v8M15 10v8M19 10v8M3 21h18" /></svg>
                </div>
                <div className="ps-bank-info">
                  <p>{a.bankName} ••••{a.last4}</p>
                  <p className="ps-tiny">{a.accountName}</p>
                  <div className="ba-row-actions">
                    {!a.isDefault && <button type="button" className="ba-lnk" onClick={() => { setPinAction({ kind: 'default', id: a.id }); setActPin(''); setActError('') }}>Make default</button>}
                    <button type="button" className="ba-lnk red" onClick={() => { setPinAction({ kind: 'remove', id: a.id }); setActPin(''); setActError('') }}>Remove</button>
                  </div>
                </div>
                {hold > 0 && <span className="ba-hold">Ready in {hold}h</span>}
                {a.isDefault && <span className="ps-default">Default</span>}
              </div>
            )
          })}
        </div>
      )}

      {accounts.length < 3 && !loading && (
        <button type="button" className="ps-link" onClick={openAdd}>+ Add bank account</button>
      )}

      {/* ── Add account ── */}
      <Modal open={addOpen} onClose={closeAdd} title="Add a bank account" size="sm"
        footer={
          <div className="ba-foot">
            <button type="button" className="ba-btn ghost" onClick={closeAdd}>Cancel</button>
            {matched
              ? <button type="button" className="ba-btn" onClick={save} disabled={saving || pin.length !== 4}>{saving ? 'Saving…' : 'Confirm and add'}</button>
              : <button type="button" className="ba-btn" onClick={verify} disabled={!canVerify}>{resolving ? 'Checking…' : 'Verify account'}</button>}
          </div>
        }>
        <div className="ba-stack">
          <div>
            <label className="ba-lab" htmlFor="ba-bank">Bank</label>
            <select id="ba-bank" className="ba-select" value={bankCode} disabled={matched}
              onChange={e => { setBankCode(e.target.value); setResolved(null); setFormError('') }}>
              <option value="">Select your bank</option>
              {banks.map(b => <option key={b.code} value={b.code}>{b.name}</option>)}
            </select>
          </div>
          <div>
            <label className="ba-lab" htmlFor="ba-no">Account number</label>
            <input id="ba-no" className="ba-in" inputMode="numeric" autoComplete="off" maxLength={10} value={acctNo} disabled={matched}
              placeholder="10-digit account number"
              onChange={e => { setAcctNo(e.target.value.replace(/\D/g, '')); setResolved(null); setFormError('') }} />
          </div>

          {resolved && resolved.matched && (
            <>
              <div className="ba-ok">
                <span className="ba-tick"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3"><path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" /></svg></span>
                <div><b>{resolved.accountName}</b><span>Matches your verified identity</span></div>
              </div>
              <div>
                <label className="ba-lab" htmlFor="ba-pin">Transaction PIN</label>
                <input id="ba-pin" className="ba-in" type="password" inputMode="numeric" autoComplete="off" maxLength={4} value={pin}
                  placeholder="••••" onChange={e => setPin(e.target.value.replace(/\D/g, ''))} />
                <p className="ps-tiny" style={{ marginTop: 6 }}>New accounts can receive withdrawals after a short security hold.</p>
              </div>
            </>
          )}
          {resolved && !resolved.matched && <p className="ba-bad" role="alert">{resolved.reason}</p>}
          {formError && <p className="ba-err" role="alert">{formError}</p>}
        </div>
      </Modal>

      {/* ── PIN confirm (make default / remove) ── */}
      <Modal open={!!pinAction} onClose={() => setPinAction(null)} size="sm"
        title={pinAction?.kind === 'remove' ? 'Remove this account?' : 'Make this your default account?'}
        footer={
          <div className="ba-foot">
            <button type="button" className="ba-btn ghost" onClick={() => setPinAction(null)}>Cancel</button>
            <button type="button" className={`ba-btn ${pinAction?.kind === 'remove' ? 'danger' : ''}`} onClick={runAction} disabled={actBusy || actPin.length !== 4}>
              {actBusy ? 'Working…' : pinAction?.kind === 'remove' ? 'Remove' : 'Confirm'}
            </button>
          </div>
        }>
        <div className="ba-stack">
          <div>
            <label className="ba-lab" htmlFor="ba-act-pin">Transaction PIN</label>
            <input id="ba-act-pin" className="ba-in" type="password" inputMode="numeric" autoComplete="off" maxLength={4} value={actPin}
              placeholder="••••" onChange={e => setActPin(e.target.value.replace(/\D/g, ''))} />
          </div>
          {actError && <p className="ba-err" role="alert">{actError}</p>}
        </div>
      </Modal>
    </section>
  )
}