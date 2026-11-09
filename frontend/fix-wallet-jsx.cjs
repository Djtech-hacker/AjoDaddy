// Repairs WalletPage.tsx after patch-wallet-mobile.cjs: wraps the phone cards and the table in one wrapper.
// Run from the FRONTEND folder:   node fix-wallet-jsx.cjs
const fs = require('fs')
const file = 'src/pages/wallet/WalletPage.tsx'
if (!fs.existsSync(file)) { console.log('!!  cannot find ' + file + ' (open CMD in the frontend folder)'); process.exit(1) }
let s = fs.readFileSync(file, 'utf8')
fs.writeFileSync(file + '.bak2', s)
const step = (name, ok) => console.log((ok ? 'ok  ' : '!!  ') + name)

const phones = '{/* phones: one card per transaction */}'
const tablet = '{/* tablet and desktop: the table */}'
const p = s.indexOf(phones)
const t = s.indexOf(tablet)

if (p === -1 || t === -1) {
  step('could not find the phone/table markers (was patch-wallet-mobile.cjs run?)', false)
} else {
  // is it already wrapped?  look just before the phones comment for an opening fragment
  const before = s.slice(Math.max(0, p - 60), p)
  if (/<>\s*$/.test(before)) {
    step('already wrapped', true)
  } else {
    // 1) closing: right after the table block ends (</table> </div> </div>)
    const endRe = /<\/table>\s*<\/div>\s*<\/div>/g
    endRe.lastIndex = t
    const end = endRe.exec(s)
    if (!end) { step('could not find the end of the table block', false) }
    else {
      const closeAt = end.index + end[0].length
      s = s.slice(0, closeAt) + '\n            </>' + s.slice(closeAt)
      // 2) opening: just before the phones comment
      s = s.slice(0, p) + '<>\n            ' + s.slice(p)
      step('phone cards and table are now wrapped together', true)
    }
  }
}
fs.writeFileSync(file, s)
console.log('\nSaved. Backup: ' + file + '.bak2')
