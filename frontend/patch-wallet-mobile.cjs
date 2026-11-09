// Makes the wallet page fit phones: transactions become cards, numbers shrink, bottom space for the Messages button.
// Run from the FRONTEND folder:   node patch-wallet-mobile.cjs
const fs = require('fs')
const file = 'src/pages/wallet/WalletPage.tsx'
if (!fs.existsSync(file)) { console.log('!!  cannot find ' + file + ' (open CMD in the frontend folder)'); process.exit(1) }
let s = fs.readFileSync(file, 'utf8')
fs.writeFileSync(file + '.bak', s)
const step = (name, ok) => console.log((ok ? 'ok  ' : '!!  ') + name)

// 1) the ledger: cards on phones, the table from tablet up
if (s.includes('sm:hidden divide-y divide-black/[0.05]')) {
  step('ledger (already done)', true)
} else {
  const open = /<div className="overflow-x-auto">\s*<table className="w-full min-w-\[640px\]">/.exec(s)
  if (!open) step('ledger table (could not find it)', false)
  else {
    const endRe = /<\/table>\s*<\/div>/g
    endRe.lastIndex = open.index
    const end = endRe.exec(s)
    if (!end) step('ledger table end (could not find it)', false)
    else {
      const tableBlock = s.slice(open.index, end.index + end[0].length)
      const cards = `{/* phones: one card per transaction */}
            <div className="sm:hidden divide-y divide-black/[0.05]">
              {transactions.map(tx => {
                const credit = TX_CREDIT.has(tx.type)
                return (
                  <button key={tx.id} type="button" onClick={() => setReceiptTx(tx)}
                    className="w-full text-left px-4 py-3 flex items-center justify-between gap-3 hover:bg-warm/50 transition-colors">
                    <div className="min-w-0">
                      <p className="text-[13px] font-medium text-ink truncate">{describe(tx)}</p>
                      <p className="text-[11px] text-mist mt-0.5">{dayjs(tx.createdAt).format('MMM D, YYYY · h:mm A')}</p>
                    </div>
                    <div className="text-right flex-shrink-0">
                      <p className={\`text-[13px] font-semibold tabular-nums \${credit ? 'text-emerald-700' : 'text-ink'}\`}>{credit ? '+' : '-'}₦{tx.amount.toLocaleString()}</p>
                      <div className="mt-1"><StatusPill status={tx.status}/></div>
                    </div>
                  </button>
                )
              })}
            </div>

            {/* tablet and desktop: the table */}
            <div className="hidden sm:block">
            ${tableBlock}
            </div>`
      s = s.slice(0, open.index) + cards + s.slice(end.index + end[0].length)
      step('transactions are cards on phones', true)
    }
  }
}

// 2) smaller numbers on phones
const swaps = [
  ['balance size', 'text-[40px] sm:text-[48px] leading-none', 'text-[30px] sm:text-[48px] leading-none'],
  ['breakdown padding', '<div key={m.label} className="p-4 sm:p-5">', '<div key={m.label} className="p-3 sm:p-5 min-w-0">'],
  ['breakdown size', 'text-[18px] sm:text-[22px] font-semibold tracking-tight text-ink tabular-nums mt-2 leading-none', 'text-[14px] sm:text-[22px] font-semibold tracking-tight text-ink tabular-nums mt-2 leading-none break-words'],
  ['bottom space', 'w-full max-w-6xl mx-auto p-4 sm:p-6 space-y-4', 'w-full max-w-6xl mx-auto p-4 pb-24 sm:p-6 sm:pb-6 space-y-4'],
]
for (const [name, from, to] of swaps) {
  if (s.includes(to)) step(name + ' (already done)', true)
  else if (s.includes(from)) { s = s.replace(from, to); step(name, true) }
  else step(name + ' (could not find it)', false)
}

fs.writeFileSync(file, s)
console.log('\nSaved. Backup: ' + file + '.bak')
