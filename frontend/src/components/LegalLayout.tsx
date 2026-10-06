import { Link } from 'react-router-dom'
import { ReactNode } from 'react'

export default function LegalLayout({ title, updated, children }: { title: string; updated: string; children: ReactNode }) {
  return (
    <div className="min-h-screen bg-warm">
      <div className="max-w-3xl mx-auto px-5 sm:px-6 py-12">
        <Link to="/" className="text-sm text-dim hover:text-ink">← Back to home</Link>
        <h1 className="text-3xl sm:text-4xl font-extrabold tracking-tight text-ink mt-6 mb-2">{title}</h1>
        <p className="text-sm text-mist mb-10">Last updated: {updated}</p>
        <div className="space-y-6 text-[15px] leading-relaxed text-dim [&_h2]:text-ink [&_h2]:font-bold [&_h2]:text-lg [&_h2]:mt-8 [&_ul]:list-disc [&_ul]:pl-6 [&_ul]:space-y-1">
          {children}
        </div>
        <p className="text-sm text-mist mt-12 border-t border-black/10 pt-6">
          AjoDaddy is a product of Banji Digital Technologies (Business Name Registration No. 9693887),
          [FULL STREET ADDRESS], Ikeja, Lagos State, Nigeria. Contact: [SUPPORT EMAIL]
        </p>
      </div>
    </div>
  )
}