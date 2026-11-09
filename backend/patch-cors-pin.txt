// Lets the browser send the transaction PIN header (x-transaction-pin) to the backend.
// Run from the BACKEND folder:   node patch-cors-pin.cjs
const fs = require('fs')
const file = 'src/main.ts'
if (!fs.existsSync(file)) { console.log('!!  cannot find ' + file + ' (open CMD in the backend folder)'); process.exit(1) }
let s = fs.readFileSync(file, 'utf8')
fs.writeFileSync(file + '.bak', s)
const step = (name, ok) => console.log((ok ? 'ok  ' : '!!  ') + name)

if (/x-transaction-pin/i.test(s)) {
  step('already allowed', true)
} else {
  // case 1: allowedHeaders: [ 'a', 'b' ]
  const arr = /allowedHeaders\s*:\s*\[([^\]]*)\]/
  // case 2: allowedHeaders: 'a, b'  (or "a, b")
  const str = /allowedHeaders\s*:\s*(['"])([^'"]*)\1/
  if (arr.test(s)) {
    s = s.replace(arr, (m, inner) => {
      const trimmed = inner.trim().replace(/,\s*$/, '')
      return 'allowedHeaders: [' + (trimmed ? trimmed + ", " : '') + "'x-transaction-pin']"
    })
    step('x-transaction-pin added to allowedHeaders', true)
  } else if (str.test(s)) {
    s = s.replace(str, (m, q, inner) => 'allowedHeaders: ' + q + inner.replace(/[\s,]+$/, '') + ', x-transaction-pin' + q)
    step('x-transaction-pin added to allowedHeaders', true)
  } else {
    step('could not find allowedHeaders in main.ts. Paste your main.ts here and I will fix it.', false)
  }
}
fs.writeFileSync(file, s)
console.log('\nSaved. Backup: ' + file + '.bak  (now restart the backend)')
