// Adds "how does the customer want the goods" (delivery or pickup) to model SsOrder
// Run from the BACKEND folder:   node patch-schema-pickup.cjs     then:   npx prisma db push   and   npx prisma generate
// (Run patch-schema-gig.cjs first if you have not already.)
const fs = require('fs')
const file = 'prisma/schema.prisma'
if (!fs.existsSync(file)) { console.log('!!  cannot find ' + file + ' (open CMD in the backend folder)'); process.exit(1) }
let s = fs.readFileSync(file, 'utf8')
fs.writeFileSync(file + '.bak4', s)

if (s.includes('deliveryMethod')) {
  console.log('ok   deliveryMethod (already there)')
} else {
  const start = s.indexOf('model SsOrder {')
  const end = start === -1 ? -1 : s.indexOf('\n}\n', start)
  const block = start === -1 ? '' : s.slice(start, end)
  const m = /\n[ \t]*gigSimulated[ \t]+Boolean[^\n]*/.exec(block)
  if (!m) {
    console.log('!!   could not find gigSimulated in SsOrder. Run patch-schema-gig.cjs first.')
    process.exit(1)
  }
  const at = start + m.index + m[0].length
  const field = '\n  deliveryMethod           String? // DELIVERY (GIG brings it) or PICKUP (customer collects from the vendor)'
  s = s.slice(0, at) + field + s.slice(at)
  console.log('ok   deliveryMethod added to SsOrder')
}
fs.writeFileSync(file, s)
console.log('\nSaved. Backup: ' + file + '.bak4')
console.log('Next: stop the backend, then run   npx prisma db push   and   npx prisma generate')
