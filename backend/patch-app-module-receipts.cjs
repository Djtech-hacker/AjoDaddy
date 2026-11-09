// Registers the receipts module in backend/src/app.module.ts
// Run from the BACKEND folder:   node patch-app-module-receipts.cjs
const fs = require('fs')
const file = 'src/app.module.ts'
if (!fs.existsSync(file)) { console.log('!!  cannot find ' + file + ' (open CMD in the backend folder)'); process.exit(1) }
let s = fs.readFileSync(file, 'utf8')
fs.writeFileSync(file + '.bak', s)
const step = (name, ok) => console.log((ok ? 'ok  ' : '!!  ') + name)

if (s.includes('ReceiptsModule')) { step('already there', true) }
else {
  // import line after the last import
  let last = -1
  const re = /^import[^;]*;[ \t]*$/gm
  let m
  while ((m = re.exec(s)) !== null) last = m.index + m[0].length
  if (last === -1) step('import (could not find imports)', false)
  else { s = s.slice(0, last) + "\nimport { ReceiptsModule } from './receipts/receipts.module';" + s.slice(last); step('import added', true) }

  const imports = /imports:\s*\[/
  if (imports.test(s)) { s = s.replace(imports, m2 => m2 + '\n    ReceiptsModule,'); step('module registered', true) }
  else step('module (could not find the imports list)', false)
}
fs.writeFileSync(file, s)
console.log('\nSaved. Backup: ' + file + '.bak')
