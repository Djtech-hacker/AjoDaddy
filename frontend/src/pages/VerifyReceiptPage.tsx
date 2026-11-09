// src/pages/VerifyReceiptPage.tsx   (route: /verify-receipt/:code, PUBLIC)
// Anyone holding a TAREVA receipt can open its link and see the real record.

import { useEffect, useState } from 'react'
import { useParams, Link } from 'react-router-dom'
import dayjs from 'dayjs'
import api from '@/lib/api'
import { LOGO_URL } from '@/components/auth/AuthShell'

type Result = {
  valid: boolean
  type?: string; status?: string; amount?: number; date?: string
  purpose?: string; planNumber?: string | null; reference?: string; name?: string
}

export default function VerifyReceiptPage() {
  const { code = '' } = useParams()
  const [data, setData] = useState<Result | null>(null)
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    let cancelled = false
    api.get('/receipts/verify/' + encodeURIComponent(code))
      .then(res => { if (!cancelled) { const b: any = res.data; setData((b?.data ?? b) as Result) } })
      .catch(() => { if (!cancelled) setFailed(true) })
    return () => { cancelled = true }
  }, [code])

  const rows: [string, string][] = data?.valid ? [
    ['Amount', '₦' + Number(data.amount).toLocaleString()],
    ['Status', data.status === 'COMPLETED' ? 'Successful' : String(data.status)],
    ['Type', String(data.type).replace(/_/g, ' ')],
    ['What it was for', data.purpose || '—'],
    ...(data.planNumber ? [['Plan number', data.planNumber] as [string, string]] : []),
    ['Account holder', data.name || '—'],
    ['Date and time', dayjs(data.date).format('MMM D, YYYY h:mm A')],
    ['Reference', data.reference || '—'],
  ] : []

  return (
    <div className="min-h-screen bg-[#F8F6F1] flex items-start sm:items-center justify-center p-4">
      <div className="w-full max-w-md bg-white rounded-2xl border border-black/[0.07] shadow-sm p-5 sm:p-6 space-y-4">
        <img src={LOGO_URL} alt="TAREVA" className="h-14 w-auto object-contain mx-auto" />
        <h1 className="text-center text-[18px] font-semibold text-ink">Receipt check</h1>

        {!data && !failed && <div className="h-40 rounded-xl bg-black/[0.04] animate-pulse" />}

        {failed && (
          <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 text-[13px] text-amber-800">
            We could not check this receipt right now. Please try again in a moment.
          </div>
        )}

        {data && !data.valid && (
          <div className="bg-red-50 border border-red-200 rounded-xl p-4">
            <p className="text-[14px] font-semibold text-red-700">We could not find this receipt.</p>
            <p className="text-[12.5px] text-red-600 mt-1 leading-relaxed">
              It may be fake or changed. Do not hand over goods or money based on it. Ask the person to show you the payment inside their TAREVA app.
            </p>
          </div>
        )}

        {data?.valid && (
          <>
            <div className="bg-emerald-50 border border-emerald-200 rounded-xl p-4">
              <p className="text-[14px] font-semibold text-emerald-700">This receipt is in TAREVA's records.</p>
              <p className="text-[12.5px] text-emerald-700 mt-1 leading-relaxed">
                Compare every detail below with the receipt you were shown. If anything is different, the receipt has been changed. Do not accept it.
              </p>
            </div>
            <div className="rounded-xl border border-black/[0.07] divide-y divide-black/[0.06]">
              {rows.map(([l, v]) => (
                <div key={l} className="flex justify-between gap-4 px-4 py-2.5">
                  <span className="text-[12px] text-mist flex-shrink-0">{l}</span>
                  <span className="text-[12.5px] font-semibold text-ink text-right break-all">{v}</span>
                </div>
              ))}
            </div>
          </>
        )}

        <p className="text-center text-[11px] text-mist">
          <Link to="/" className="hover:underline">Go to TAREVA</Link>
        </p>
      </div>
    </div>
  )
}