// Adds the delivery address and GIG booking fields to model SsOrder (backend/prisma/schema.prisma)
// Run from the BACKEND folder:   node patch-schema-gig.cjs     then:   npx prisma db push   and   npx prisma generate
// (Run patch-schema-dispatch.cjs first if you have not already.)
const fs = require('fs')
const file = 'prisma/schema.prisma'
if (!fs.existsSync(file)) { console.log('!!  cannot find ' + file + ' (open CMD in the backend folder)'); process.exit(1) }
let s = fs.readFileSync(file, 'utf8')
fs.writeFileSync(file + '.bak3', s)

if (s.includes('gigWaybill')) {
  console.log('ok   GIG fields (already there)')
} else {
  const start = s.indexOf('model SsOrder {')
  const end = start === -1 ? -1 : s.indexOf('\n}\n', start)
  const block = start === -1 ? '' : s.slice(start, end)
  const m = /\n[ \t]*deliveredAt[ \t]+DateTime\?[^\n]*/.exec(block)
  if (!m) {
    console.log('!!   could not find deliveredAt in SsOrder. Run patch-schema-dispatch.cjs first.')
    process.exit(1)
  }
  const at = start + m.index + m[0].length
  const fields = [
    '',
    '',
    '  // where to deliver (the customer fills this in) and the GIG Logistics booking',
    '  deliveryName             String?',
    '  deliveryPhone            String?',
    '  deliveryAddress          String?',
    '  deliveryCity             String?',
    '  deliveryState            String?',
    '  deliveryFee              BigInt? // what GIG charges (kobo)',
    '  deliveryCompanyFee       BigInt? // our 2% on top (kobo)',
    '  gigWaybill               String?',
    '  gigStatus                String?',
    '  gigSimulated             Boolean       @default(false)',
  ].join('\n')
  s = s.slice(0, at) + fields + s.slice(at)
  console.log('ok   GIG fields added to SsOrder')
}
fs.writeFileSync(file, s)
console.log('\nSaved. Backup: ' + file + '.bak3')
console.log('Next: stop the backend, then run   npx prisma db push   and   npx prisma generate')
