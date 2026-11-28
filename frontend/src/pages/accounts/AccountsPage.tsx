import { useState, useEffect, useRef } from 'react'
import DashboardLayout from '@/components/layout/DashboardLayout'
import { Modal } from '@/components/ui'
import LivenessCapture from '@/components/LivenessCapture'
import { accountsApi, paymentsApi } from '@/api/services'
import { useAuthStore } from '@/stores/authStore'
import { useUIStore } from '@/stores/uiStore'
import dayjs from 'dayjs'

type Tab = 'owed' | 'movements' | 'check' | 'payments'

const card = 'bg-white border border-gray-100 rounded-2xl shadow-sm overflow-hidden'
const field = 'w-full h-10 border border-gray-200 rounded-lg px-3 text-[13px] text-gray-900 bg-gray-50 outline-none focus:border-emerald-500 focus:bg-white'
const label = 'block text-[10px] font-semibold text-gray-400 uppercase tracking-wider mb-1.5'
const primary = 'h-9 px-4 rounded-lg bg-[#0B3D2A] text-white text-[12px] font-semibold hover:bg-[#0F5138] disabled:opacity-40 disabled:cursor-not-allowed'
const ghost = 'h-9 px-4 rounded-lg border border-gray-200 text-gray-700 text-[12px] font-semibold hover:bg-gray-50 disabled:opacity-40'
const TH = 'px-5 py-3 text-left text-[12px] font-medium text-gray-500 whitespace-nowrap'
const TD = 'px-4 py-3 text-[12px] text-gray-700 whitespace-nowrap'

const TYPES = ['WALLET_FUNDING', 'CONTRIBUTION', 'PAYOUT', 'WITHDRAWAL', 'REFUND', 'PENALTY', 'ADJUSTMENT', 'REVERSAL']
const STATUSES = ['PENDING', 'PROCESSING', 'COMPLETED', 'FAILED', 'REVERSED']
const EMPTY_FORM = { category: 'SALARY', amount: '', note: '', bankCode: '', bankName: '', accountNumber: '', accountName: '' }

const OUTCOMES = ['All', 'Waiting', 'Processing', 'Successful', 'Failed', 'Rejected']
// what happened to a request, going by the bank's answer where there is one
const outcome = (e: any) => {
  if (e.status === 'PENDING') return 'Waiting'
  if (e.status === 'REJECTED') return 'Rejected'
  if (e.status === 'FAILED' || e.bankStatus === 'FAILED' || e.bankStatus === 'REVERSED') return 'Failed'
  return e.bankStatus === 'COMPLETED' ? 'Successful' : 'Processing'
}

const money = (n: number) => '₦' + Number(n || 0).toLocaleString()
const unwrap = (res: any) => res?.data?.data ?? res?.data
const problem = (err: any, fallback: string) => {
  const m = err?.response?.data?.message
  return Array.isArray(m) ? m.join(', ') : m || fallback
}
// stops a spreadsheet from running text that starts like a formula
const cell = (v: any) => {
  let s = String(v ?? '')
  if (typeof v !== 'number' && /^[=+\-@\t\r]/.test(s)) s = "'" + s
  return '"' + s.replace(/"/g, '""') + '"'
}

// plain words and one colour for each state of a payment
const TONE: Record<string, string> = {
  Waiting: 'bg-amber-50 text-amber-800',
  Processing: 'bg-sky-50 text-sky-800',
  Successful: 'bg-emerald-50 text-emerald-800',
  Failed: 'bg-red-50 text-red-700',
  Rejected: 'bg-gray-100 text-gray-600',
}
const nice = (v: string) => v.charAt(0) + v.slice(1).toLowerCase().replace(/_/g, ' ')
const initials = (name: string) => name.split(' ').filter(Boolean).slice(0, 2).map(w => w[0]).join('').toUpperCase()

function Pill({ state, text }: { state: string; text?: string }) {
  return <span className={`inline-block rounded-full px-2 py-0.5 text-[11px] font-semibold ${TONE[state] || TONE.Rejected}`}>{text || state}</span>
}

function Empty({ title, hint }: { title: string; hint?: string }) {
  return (
    <div className="px-6 py-14 text-center">
      <p className="text-[14px] font-semibold text-gray-800">{title}</p>
      {hint && <p className="text-[12px] text-gray-500 mt-1">{hint}</p>}
    </div>
  )
}

// one line of money: what it is on the left, how much on the right
function Line({ dot, title, note, value }: { dot?: string; title: string; note: string; value: string }) {
  return (
    <div className="flex items-center gap-3 px-4 sm:px-5 py-3.5">
      {dot && <span className={`w-2.5 h-2.5 shrink-0 rounded-full ${dot}`} />}
      <div className="min-w-0 flex-1">
        <p className="text-[13px] font-semibold text-gray-900">{title}</p>
        <p className="text-[12px] text-gray-500">{note}</p>
      </div>
      <p className="shrink-0 text-[14px] font-bold tabular-nums text-gray-900">{value}</p>
    </div>
  )
}

// the green card: the money that can actually be spent
function Balance({ overview, children }: { overview: any; children?: React.ReactNode }) {
  return (
    <section className="rounded-3xl bg-[#0B3D2A] text-white p-5 sm:p-6 flex flex-col sm:flex-row sm:items-end gap-5">
      <div className="flex-1 min-w-0">
        <p className="text-[12px] text-emerald-100/80">Company's own money</p>
        <p className="text-[34px] sm:text-[40px] leading-tight font-extrabold tracking-tight tabular-nums break-words">{money(overview?.ownMoney)}</p>
        <p className="text-[12px] text-emerald-100/80 mt-1">Owed for delivery, kept apart: <b className="text-white">{money(overview?.owedForDelivery)}</b></p>
      </div>
      {children}
    </section>
  )
}

function Spinner() {
  return <span className="inline-block w-3.5 h-3.5 rounded-full border-2 border-emerald-200 border-t-emerald-700 animate-spin" />
}

function Loader() {
  return (
    <div role="status" className="min-h-[360px] flex flex-col items-center justify-center gap-3">
      <span className="w-10 h-10 rounded-full border-4 border-emerald-100 border-t-emerald-700 animate-spin" />
      <p className="text-[13px] font-semibold text-gray-500">Loading, please wait…</p>
    </div>
  )
}

const CARDS = 'lg:hidden divide-y divide-gray-100 border-t border-gray-100'

function Table({ heads, children }: { heads: string[]; children: React.ReactNode }) {
  return (
    <div className="hidden lg:block overflow-x-auto">
      <table className="w-full">
        <thead className="border-y border-gray-100"><tr>{heads.map(h => <th key={h} className={TH}>{h}</th>)}</tr></thead>
        <tbody className="divide-y divide-gray-50">{children}</tbody>
      </table>
    </div>
  )
}

export default function AccountsPage() {
  const { user } = useAuthStore()
  const { showToast } = useUIStore()
  const canApprove = user?.role === 'SUPER_ADMIN'

  const [tab, setTab] = useState<Tab>('owed')
  // starts true so the loader shows from the first moment
  const [loading, setLoading] = useState(true)
  const latest = useRef(0)
  const [overview, setOverview] = useState<any>(null)
  const [moves, setMoves] = useState<any>(null)
  const [page, setPage] = useState(1)
  const [type, setType] = useState('')
  const [status, setStatus] = useState('')
  const [search, setSearch] = useState('')
  const [check, setCheck] = useState<any>(null)
  const [expenses, setExpenses] = useState<any[]>([])
  const [show, setShow] = useState('All')
  const [openId, setOpenId] = useState('')
  const shown = show === 'All' ? expenses : expenses.filter(e => outcome(e) === show)

  const [requestOpen, setRequestOpen] = useState(false)
  const [form, setForm] = useState(EMPTY_FORM)
  const [banks, setBanks] = useState<any[]>([])
  const [saving, setSaving] = useState(false)
  const [banksLoading, setBanksLoading] = useState(false)
  const [verifying, setVerifying] = useState(false)
  const [verifyError, setVerifyError] = useState('')

  const [approving, setApproving] = useState<any>(null)
  const [password, setPassword] = useState('')
  const [photo, setPhoto] = useState('')
  const [liveCheck, setLiveCheck] = useState(false)

  const load = async () => {
    // only the newest request may update the screen, so a slow older one cannot overwrite it
    const mine = ++latest.current
    const current = () => mine === latest.current
    setLoading(true)
    try {
      if (tab === 'owed') {
        const data = unwrap(await accountsApi.getOverview())
        if (current()) setOverview(data)
      }
      if (tab === 'movements') {
        const data = unwrap(await accountsApi.getMovements({ page, limit: 30, type: type || undefined, status: status || undefined, search: search || undefined }))
        if (current()) setMoves(data)
      }
      if (tab === 'check') {
        const data = unwrap(await accountsApi.getBalanceCheck())
        if (current()) setCheck(data)
      }
      if (tab === 'payments') {
        const [list, figures] = await Promise.all([accountsApi.getExpenses(), accountsApi.getOverview()])
        if (current()) { setExpenses(unwrap(list) || []); setOverview(unwrap(figures)) }
      }
    } catch (err) {
      if (!current()) return
      // do not leave old rows on screen as if they were the answer
      if (tab === 'movements') setMoves(null)
      showToast(problem(err, 'Could not load'), 'error')
    }
    finally { if (current()) setLoading(false) }
  }

  // changing tab or filter shows the loader at once, with no flash of old rows
  const openTab = (id: Tab) => { if (id !== tab) { setLoading(true); setTab(id) } }
  const changeFilter = (set: (v: string) => void, value: string) => { setLoading(true); set(value); setPage(1) }
  const goToPage = (next: number) => { setLoading(true); setPage(next) }

  useEffect(() => { load() }, [tab, page, type, status])

  const exportCsv = async () => {
    try {
      const data = unwrap(await accountsApi.getMovements({ page: 1, limit: 5000, type: type || undefined, status: status || undefined, search: search || undefined }))
      const lines = [['Date', 'Who', 'Type', 'Status', 'Amount (NGN)', 'Reference', 'Description'].map(cell).join(',')]
      for (const r of data.rows) lines.push([r.createdAt, r.who, r.type, r.status, r.amount, r.reference, r.description].map(cell).join(','))
      const url = URL.createObjectURL(new Blob(['﻿' + lines.join('\n')], { type: 'text/csv' }))
      const a = document.createElement('a')
      a.href = url
      a.download = `money-movements-${dayjs().format('YYYY-MM-DD')}.csv`
      // some browsers ignore a link that is not on the page, or cancel if the file is released at once
      document.body.appendChild(a)
      a.click()
      a.remove()
      setTimeout(() => URL.revokeObjectURL(url), 30000)
      showToast(data.total > data.rows.length
        ? `Exporting the newest ${data.rows.length} of ${data.total} rows`
        : `Exporting ${data.rows.length} rows. Check your Downloads.`, 'success')
    } catch (err) { showToast(problem(err, 'Export failed'), 'error') }
  }

  // ── New request ──
  const openRequest = async () => {
    setForm(EMPTY_FORM)
    setRequestOpen(true)
    try { setOverview(unwrap(await accountsApi.getOverview())) } catch { /* the server still checks the limit */ }
    if (!banks.length) {
      setBanksLoading(true)
      try { setBanks(unwrap(await paymentsApi.getBanks()) || []) }
      catch { showToast('Could not load banks', 'error') }
      finally { setBanksLoading(false) }
    }
  }

  const isDelivery = form.category === 'DELIVERY'
  const limit: number | undefined = isDelivery ? overview?.availableForDelivery : overview?.availableForExpenses
  const tooMuch = limit !== undefined && Number(form.amount) > limit

  // delivery fills in what the courier is due; the other kinds start empty
  const chooseCategory = (category: string) => {
    const due = Number(overview?.courierDue || 0)
    setForm(f => ({
      ...f,
      category,
      amount: category === 'DELIVERY' && due > 0 ? String(due) : '',
      note: category === 'DELIVERY' ? 'Courier payment' : '',
    }))
  }

  useEffect(() => {
    setForm(f => ({ ...f, accountName: '' }))
    setVerifyError('')
    setVerifying(false)
    if (form.accountNumber.length !== 10 || !form.bankCode) return
    let current = true
    setVerifying(true)
    paymentsApi.verifyAccount(form.accountNumber, form.bankCode)
      .then(res => {
        if (!current) return
        const name = unwrap(res)?.accountName || ''
        setForm(f => ({ ...f, accountName: name }))
        if (!name) setVerifyError('No account name found. Check the bank and number.')
      })
      .catch(err => { if (current) setVerifyError(problem(err, 'Could not verify account')) })
      .finally(() => { if (current) setVerifying(false) })
    return () => { current = false }
  }, [form.accountNumber, form.bankCode])

  const sendRequest = async () => {
    setSaving(true)
    try {
      await accountsApi.createExpense({ ...form, amount: Number(form.amount) })
      showToast('Request sent for approval', 'success')
      setRequestOpen(false)
      load()
    } catch (err) { showToast(problem(err, 'Could not send request'), 'error') }
    finally { setSaving(false) }
  }

  // ── Approve / reject (Super Admin) ──
  const closeApprove = () => { setLiveCheck(false); setApproving(null); setPassword(''); setPhoto('') }

  const approve = async () => {
    setSaving(true)
    try {
      const res = unwrap(await accountsApi.approveExpense(approving.id, { password, facePhotoUrl: photo }))
      showToast(res?.message || 'Payment sent', 'success')
      closeApprove()
    } catch (err) {
      const message = problem(err, 'Payment failed')
      showToast(message, 'error')
      // a wrong password can be retried; anything else needs a fresh look at the list
      if (message !== 'Incorrect password') closeApprove()
    }
    finally { setSaving(false); load() }
  }

  const reject = async (e: any) => {
    const reason = window.prompt('Why are you rejecting this request?')
    if (!reason) return
    try {
      await accountsApi.rejectExpense(e.id, reason)
      showToast('Request rejected', 'success')
      load()
    } catch (err) { showToast(problem(err, 'Could not reject'), 'error') }
  }

  const tabs: [Tab, string][] = [['owed', 'Money'], ['payments', 'Payments'], ['movements', 'History'], ['check', 'Check']]

  return (
    <DashboardLayout title="Accounts" subtitle="Company money and payments">
      {/* bottom space lets the last row scroll clear of the floating chat button */}
      <div className="p-4 pb-28 md:p-6 md:pb-28 space-y-4 max-w-6xl mx-auto">
        <div className="flex items-center gap-2">
          <nav className="flex-1 sm:flex-none grid grid-cols-4 gap-1 rounded-2xl bg-black/[0.05] p-1">
            {tabs.map(([id, name]) => (
              <button key={id} onClick={() => openTab(id)} aria-current={tab === id ? 'page' : undefined}
                className={`h-9 sm:px-6 rounded-xl text-[12px] font-semibold transition-colors ${tab === id ? 'bg-white text-[#0B3D2A] shadow-sm' : 'text-gray-500 hover:text-gray-800'}`}>
                {name}
              </button>
            ))}
          </nav>
          <button onClick={load} disabled={loading} aria-label="Refresh" title="Refresh"
            className="ml-auto w-11 h-11 shrink-0 grid place-items-center rounded-2xl border border-gray-200 bg-white text-gray-600 disabled:opacity-40">
            <svg viewBox="0 0 24 24" className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 12a9 9 0 1 1-2.6-6.4M21 3v5h-5" /></svg>
          </button>
        </div>

        {tab !== 'movements' && loading && <div className={card}><Loader /></div>}

        {tab === 'owed' && !loading && (!overview ? <Empty title="Could not load" hint="Press the refresh button." /> : (() => {
          const parts = [
            { dot: 'bg-emerald-600', title: "Company's own", note: 'For salaries and expenses', value: overview.ownMoney },
            { dot: 'bg-sky-500', title: 'Delivery', note: `Owed out. Paid so far: ${money(overview.deliveryPaid)}`, value: overview.owedForDelivery },
            { dot: 'bg-amber-400', title: 'Shop escrow', note: "Customers' money held for orders", value: overview.shopEscrow },
          ]
          const total = parts.reduce((sum, p) => sum + Math.max(p.value, 0), 0)
          return (
            <>
              <Balance overview={overview} />
              <section className={card}>
                <div className="px-4 sm:px-5 pt-4 pb-2">
                  <div className="flex items-baseline justify-between gap-3">
                    <h2 className="text-[14px] font-bold text-gray-900">Company wallet</h2>
                    <p className="text-[16px] font-extrabold tabular-nums text-gray-900">{money(overview.companyWallet)}</p>
                  </div>
                  <div className="mt-3 flex h-3 gap-0.5 overflow-hidden rounded-full bg-gray-100">
                    {total > 0 && parts.filter(p => p.value > 0).map(p => <span key={p.title} className={p.dot} style={{ width: `${(p.value / total) * 100}%` }} />)}
                  </div>
                </div>
                <div className="divide-y divide-gray-100">
                  {parts.map(p => <Line key={p.title} dot={p.dot} title={p.title} note={p.note} value={money(p.value)} />)}
                </div>
              </section>
              <section className={card}>
                <h2 className="px-4 sm:px-5 pt-4 pb-1 text-[14px] font-bold text-gray-900">Belongs to other people</h2>
                <div className="divide-y divide-gray-100">
                  <Line title="Users' wallets" note={`Locked: ${money(overview.userLocked)}`} value={money(overview.userWallets)} />
                  <Line title="Group savings" note="Belongs to group members" value={money(overview.groupPools)} />
                </div>
              </section>
              {overview.pendingCount > 0 && (
                <button onClick={() => { setShow('Waiting'); openTab('payments') }} className="w-full flex items-center justify-between gap-3 rounded-2xl bg-amber-50 border border-amber-200 px-4 py-3.5 text-left">
                  <span className="text-[13px] font-semibold text-amber-900">{overview.pendingCount} waiting for approval</span>
                  <span className="text-[14px] font-bold tabular-nums text-amber-900">{money(overview.pendingTotal)}</span>
                </button>
              )}
            </>
          )
        })())}

        {tab === 'movements' && (
          <div className={card}>
            <div className="p-3 sm:p-4 grid grid-cols-2 gap-2 sm:flex sm:flex-wrap">
              <input value={search} onChange={e => setSearch(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') { if (page === 1) load(); else setPage(1) } }}
                placeholder="Search, then press Enter" aria-label="Search username, reference or text" className={`${field} col-span-2 sm:!w-64`} />
              <select value={type} onChange={e => changeFilter(setType, e.target.value)} aria-label="Type" className={`${field} sm:!w-44`}>
                <option value="">All types</option>{TYPES.map(t => <option key={t} value={t}>{nice(t)}</option>)}
              </select>
              <select value={status} onChange={e => changeFilter(setStatus, e.target.value)} aria-label="Status" className={`${field} sm:!w-40`}>
                <option value="">All statuses</option>{STATUSES.map(t => <option key={t} value={t}>{nice(t)}</option>)}
              </select>
              <button onClick={exportCsv} className="col-span-2 sm:ml-auto h-9 px-2 text-[12px] font-semibold text-emerald-800 hover:underline">Export CSV</button>
            </div>
            {loading ? <Loader /> : !moves ? <Empty title="Could not load" hint="Press the refresh button." /> : moves.rows.length === 0 ? <Empty title="Nothing found" hint="Try another search or filter." /> : (
              <>
                <div className={CARDS}>
                  {moves.rows.map((r: any) => (
                    <details key={r.id} className="px-4 py-3">
                      <summary className="flex items-center gap-3 cursor-pointer list-none [&::-webkit-details-marker]:hidden">
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-[13px] font-semibold text-gray-900">{nice(r.type)}</p>
                          <p className="truncate text-[12px] text-gray-500">{r.who}, {dayjs(r.createdAt).format('D MMM, h:mm A')}</p>
                        </div>
                        <div className="shrink-0 text-right">
                          <p className="text-[14px] font-bold tabular-nums text-gray-900">{money(r.amount)}</p>
                          <p className={`text-[11px] ${r.status === 'FAILED' ? 'text-red-600' : 'text-gray-500'}`}>{nice(r.status)}</p>
                        </div>
                      </summary>
                      <div className="mt-2 rounded-xl bg-gray-50 p-3 space-y-1">
                        <p className="text-[12px] text-gray-700 break-words">{r.description || 'No description'}</p>
                        <p className="text-[11px] text-gray-400 break-all">{r.reference}</p>
                      </div>
                    </details>
                  ))}
                </div>
                <Table heads={['When', 'Who', 'Type', 'Status', 'Amount', 'Description', 'Reference']}>
                  {moves.rows.map((r: any) => (
                    <tr key={r.id}>
                      <td className={TD}>{dayjs(r.createdAt).format('D MMM YY, h:mm A')}</td>
                      <td className={TD}>{r.who}</td>
                      <td className={TD}>{nice(r.type)}</td>
                      <td className={TD}>{nice(r.status)}</td>
                      <td className={`${TD} font-bold tabular-nums`}>{money(r.amount)}</td>
                      <td className={`${TD} max-w-[240px] truncate`} title={r.description}>{r.description}</td>
                      <td className={`${TD} max-w-[180px] truncate !text-[11px] text-gray-400`} title={r.reference}>{r.reference}</td>
                    </tr>
                  ))}
                </Table>
                <div className="p-3 sm:p-4 flex items-center justify-between gap-3 text-center border-t border-gray-100">
                  <button disabled={page <= 1} onClick={() => goToPage(page - 1)} className={ghost}>Previous</button>
                  <p className="text-[12px] text-gray-500">Page {moves.page} of {moves.totalPages}</p>
                  <button disabled={page >= moves.totalPages} onClick={() => goToPage(page + 1)} className={ghost}>Next</button>
                </div>
              </>
            )}
          </div>
        )}

        {tab === 'check' && !loading && (!check ? <Empty title="Could not load" hint="Press the refresh button." /> : (
          <>
            <section className={`rounded-3xl p-5 ${check.mismatches.length ? 'bg-red-50 text-red-800' : 'bg-emerald-50 text-emerald-800'}`}>
              <p className="text-[18px] font-extrabold">{check.mismatches.length ? `${check.mismatches.length} of ${check.checked} wallets don't match` : `All ${check.checked} wallets match`}</p>
              <p className="text-[12px] mt-1">{check.mismatches.length ? 'Check these before any money leaves them.' : 'Every user wallet agrees with its records.'}</p>
            </section>
            {check.mismatches.map((m: any) => (
              <section key={m.username} className={card}>
                <div className="px-4 sm:px-5 pt-4 flex items-baseline justify-between gap-3">
                  <h2 className="min-w-0 truncate text-[14px] font-bold text-gray-900">{m.username}</h2>
                  <p className="shrink-0 text-[14px] font-extrabold tabular-nums text-red-600">{money(m.difference)} off</p>
                </div>
                <div className="divide-y divide-gray-100">
                  <Line title="Wallet holds" note="Balance now" value={money(m.holds)} />
                  <Line title="Records say" note="From transactions" value={money(m.records)} />
                </div>
              </section>
            ))}
          </>
        ))}

        {tab === 'payments' && !loading && (
          <>
            <Balance overview={overview}>
              <button onClick={openRequest} className="h-11 px-6 shrink-0 rounded-xl bg-white text-[#0B3D2A] text-[13px] font-bold hover:bg-emerald-50">New payment</button>
            </Balance>

            <div className="-mx-4 px-4 md:mx-0 md:px-0 flex gap-2 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
              {OUTCOMES.map(name => {
                const count = name === 'All' ? expenses.length : expenses.filter(e => outcome(e) === name).length
                return (
                  <button key={name} onClick={() => { setShow(name); setOpenId('') }} aria-pressed={show === name}
                    className={`h-9 px-3.5 shrink-0 rounded-full text-[12px] font-semibold border ${show === name ? 'bg-[#0B3D2A] border-[#0B3D2A] text-white' : 'bg-white border-gray-200 text-gray-600'}`}>
                    {name} <span className="opacity-60">{count}</span>
                  </button>
                )
              })}
            </div>

            <div className={card}>
              {shown.length === 0 ? <Empty title={show === 'All' ? 'No payments yet' : `No ${show.toLowerCase()} payments`} hint={show === 'All' ? 'Press New payment to request one.' : 'Choose another filter.'} /> : (
                <ul className="divide-y divide-gray-100">
                  {shown.map((e: any) => {
                    const state = outcome(e)
                    const open = openId === e.id
                    return (
                      <li key={e.id}>
                        <button onClick={() => setOpenId(open ? '' : e.id)} aria-expanded={open} className="w-full flex items-center gap-3 px-4 sm:px-5 py-3.5 text-left hover:bg-gray-50">
                          <span className="w-10 h-10 shrink-0 grid place-items-center rounded-full bg-emerald-50 text-[12px] font-bold text-emerald-900">{initials(e.accountName)}</span>
                          <span className="min-w-0 flex-1">
                            <span className="block truncate text-[13px] font-semibold text-gray-900">{e.accountName}</span>
                            <span className="block truncate text-[12px] text-gray-500">{nice(e.category)}, {dayjs(e.createdAt).format('D MMM, h:mm A')}</span>
                          </span>
                          <span className="shrink-0 text-right">
                            <span className="block text-[14px] font-bold tabular-nums text-gray-900">{money(e.amount)}</span>
                            <Pill state={state} />
                          </span>
                        </button>
                        {open && (
                          <dl className="mx-4 sm:mx-5 mb-3 rounded-xl bg-gray-50 p-3 grid grid-cols-[auto,1fr] gap-x-4 gap-y-1.5 text-[12px]">
                            {[['Bank', e.bankName], ['Account', e.accountNumber], ['Note', e.note], ['Requested by', e.requestedByName], ['Decided by', e.decidedByName], ['Reason', e.rejectReason]]
                              .filter(([, v]) => v).map(([k, v]) => (
                                <div key={k} className="contents">
                                  <dt className="text-gray-500">{k}</dt>
                                  <dd className="min-w-0 break-words text-gray-900">{v}</dd>
                                </div>
                              ))}
                          </dl>
                        )}
                        {canApprove && e.status === 'PENDING' && (
                          <div className="px-4 sm:px-5 pb-3.5 grid grid-cols-2 gap-2 sm:flex sm:justify-end">
                            <button onClick={() => reject(e)} className={ghost}>Reject</button>
                            <button onClick={() => setApproving(e)} className={primary}>Approve</button>
                          </div>
                        )}
                      </li>
                    )
                  })}
                </ul>
              )}
            </div>
          </>
        )}
      </div>

      <Modal open={requestOpen} onClose={() => setRequestOpen(false)} title="New payment request" size="md"
        footer={
          <div className="flex gap-2 justify-end w-full">
            <button onClick={() => setRequestOpen(false)} className={ghost}>Cancel</button>
            <button onClick={sendRequest} disabled={saving || verifying || tooMuch || Number(form.amount) < 100 || form.note.trim().length < 3 || !form.accountName} className={primary}>
              {saving ? <span className="inline-flex items-center gap-2"><Spinner /> Sending…</span> : 'Send for approval'}
            </button>
          </div>
        }>
        <div className="space-y-4">
          <div>
            <label className={label}>What is it for</label>
            <select value={form.category} onChange={e => chooseCategory(e.target.value)} className={field}>
              <option value="SALARY">Salary</option><option value="DELIVERY">Delivery (courier)</option><option value="OTHER">Other expense</option>
            </select>
          </div>
          <div className={`rounded-xl px-3 py-2.5 text-[12px] ${isDelivery ? 'bg-blue-50 text-blue-800' : 'bg-emerald-50 text-emerald-800'}`}>
            Paid from <b>{isDelivery ? 'delivery money' : "the company's own money"}</b>. Available: <b>{limit === undefined ? '…' : money(limit)}</b>
          </div>
          <div>
            <label className={label}>Amount (₦)</label>
            <input type="number" min={100} value={form.amount} onChange={e => setForm({ ...form, amount: e.target.value })} className={field} />
            {tooMuch && <p className="text-[12px] text-red-600 mt-1">That is more than the {money(limit || 0)} available.</p>}
          </div>
          <div><label className={label}>Note</label><input maxLength={200} value={form.note} onChange={e => setForm({ ...form, note: e.target.value })} placeholder="e.g. November salary for Ada" className={field} /></div>
          <div>
            <label className={label}>Bank</label>
            <select value={form.bankCode} onChange={e => setForm({ ...form, bankCode: e.target.value, bankName: banks.find(b => b.code === e.target.value)?.name || '' })} className={field}>
              <option value="">{banksLoading ? 'Loading banks…' : 'Select bank…'}</option>{banks.map(b => <option key={b.code} value={b.code}>{b.name}</option>)}
            </select>
          </div>
          <div>
            <label className={label}>Account number</label>
            <input inputMode="numeric" maxLength={10} value={form.accountNumber} onChange={e => setForm({ ...form, accountNumber: e.target.value.replace(/\D/g, '') })} className={field} />
            {verifying && <p className="text-[12px] text-gray-500 mt-1.5 flex items-center gap-2"><Spinner /> Looking for the account…</p>}
            {verifyError && <p className="text-[12px] text-red-600 mt-1">{verifyError}</p>}
            {form.accountName && <p className="text-[12px] text-emerald-600 font-semibold mt-1">✓ {form.accountName}</p>}
          </div>
        </div>
      </Modal>

      <Modal open={!!approving} onClose={closeApprove} title="Approve payment" size="md"
        footer={
          <div className="flex gap-2 justify-end w-full">
            <button onClick={closeApprove} className={ghost}>Cancel</button>
            <button onClick={approve} disabled={saving || !password || !photo} className={primary}>{saving ? 'Sending…' : 'Send the money'}</button>
          </div>
        }>
        {approving && (
          <div className="space-y-4">
            <p className="text-[13px] text-gray-700">
              This sends <b>{money(approving.amount)}</b> of real money to <b>{approving.accountName}</b> ({approving.accountNumber}, {approving.bankName}) for: {approving.note}
            </p>
            <div><label className={label}>Your password</label><input type="password" value={password} onChange={e => setPassword(e.target.value)} className={field} /></div>
            <div>
              <label className={label}>Face verification</label>
              {!liveCheck && !photo && <button onClick={() => setLiveCheck(true)} className={`${ghost} w-full`}>Start live check</button>}
              {liveCheck && (
                <LivenessCapture
                  onCapture={image => { setPhoto(image); setLiveCheck(false) }}
                  onCancel={() => setLiveCheck(false)}
                />
              )}
              {photo && !liveCheck && (
                <div className="flex items-center gap-3">
                  <img src={photo} alt="Captured face" className="w-16 h-16 rounded-xl object-cover" />
                  <p className="flex-1 text-[12px] text-emerald-600 font-semibold">Live check passed</p>
                  <button onClick={() => { setPhoto(''); setLiveCheck(true) }} className={ghost}>Redo</button>
                </div>
              )}
            </div>
          </div>
        )}
      </Modal>
    </DashboardLayout>
  )
}