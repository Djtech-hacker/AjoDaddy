// Adds the public receipt check page to src/App.tsx
// Run from the FRONTEND folder:   node patch-app-verify.cjs
const fs = require('fs')
const file = 'src/App.tsx'
if (!fs.existsSync(file)) { console.log('!!  cannot find ' + file + ' (open CMD in the frontend folder)'); process.exit(1) }
let s = fs.readFileSync(file, 'utf8')
fs.writeFileSync(file + '.bak5', s)
const step = (name, ok) => console.log((ok ? 'ok  ' : '!!  ') + name)

if (!s.includes('VerifyReceiptPage')) {
  const imp = /(import NotFoundPage[^\n]*\n)/
  if (imp.test(s)) { s = s.replace(imp, "$1import VerifyReceiptPage from '@/pages/VerifyReceiptPage'\n"); step('import added', true) }
  else step('import (could not find the NotFoundPage import)', false)

  const route = /(\n[ \t]*)(<Route path="\/privacy")/
  if (route.test(s)) { s = s.replace(route, '$1<Route path="/verify-receipt/:code" element={<VerifyReceiptPage />} />$1$2'); step('public route added', true) }
  else step('route (could not find the /privacy route)', false)
} else step('already there', true)

fs.writeFileSync(file, s)
console.log('\nSaved. Backup: ' + file + '.bak5')
