// Makes vendor reports readable for staff (friendly name + keeps the chat messages on separate lines)
// Run from the FRONTEND folder:   node patch-report-labels.cjs
const fs = require('fs')

function patch(file, edits) {
  if (!fs.existsSync(file)) { console.log('!!  cannot find ' + file + ' (open CMD in the frontend folder)'); return }
  let s = fs.readFileSync(file, 'utf8')
  fs.writeFileSync(file + '.bak3', s)
  console.log(file)
  for (const [name, from, to] of edits) {
    if (s.includes(to) && !s.includes(from)) { console.log('  ok   ' + name + ' (already done)'); continue }
    if (s.includes(from)) { s = s.replace(from, to); console.log('  ok   ' + name) }
    else console.log('  !!   ' + name + ' (could not find it)')
  }
  fs.writeFileSync(file, s)
}

const helper = "const typeLabel = (t?: string) => (({ SS_VENDOR_REPORT: 'Vendor report' } as any)[t || ''] || t || '')"

patch('src/pages/support/CustomerServiceDashboardPage.tsx', [
  ['helper', "const pv  = (p: string) =>", helper + "\nconst pv  = (p: string) =>"],
  ['table type', '<td className="px-4 py-3 text-[12px] text-ink">{r.type}</td>', '<td className="px-4 py-3 text-[12px] text-ink">{typeLabel(r.type)}</td>'],
  ['modal title', "title={reportDetail?.dispute?.type || 'Report'}", "title={typeLabel(reportDetail?.dispute?.type) || 'Report'}"],
  ['keep line breaks', 'className="text-[13px] text-ink leading-relaxed bg-warm rounded-xl px-4 py-3">{reportDetail?.dispute?.description}', 'className="text-[13px] text-ink leading-relaxed bg-warm rounded-xl px-4 py-3 whitespace-pre-wrap">{reportDetail?.dispute?.description}'],
])

patch('src/pages/dashboard/AdminPage.tsx', [
  ['helper', "const TD = 'px-5 py-3'", "const TD = 'px-5 py-3'\n" + helper],
  ['table type', '>{d.type}</td>', '>{typeLabel(d.type)}</td>'],
  ['modal type', "queueDetail?._kind === 'ticket' ? queueDetail?.subject : queueDetail?.type}", "queueDetail?._kind === 'ticket' ? queueDetail?.subject : typeLabel(queueDetail?.type)}"],
  ['keep line breaks', '<p className="text-[13px] text-gray-600 leading-relaxed">{queueDetail?.description || queueDetail?.subject}</p>', '<p className="text-[13px] text-gray-600 leading-relaxed whitespace-pre-wrap">{queueDetail?.description || queueDetail?.subject}</p>'],
])
console.log('\nDone. Backups end in .bak3')
