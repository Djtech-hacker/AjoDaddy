// Adds delivery tracking to the database model (backend/prisma/schema.prisma)
// Run from the BACKEND folder:   node patch-schema-dispatch.cjs     then:   npx prisma db push
const fs = require('fs')
const file = 'prisma/schema.prisma'
if (!fs.existsSync(file)) { console.log('!!  cannot find ' + file + ' (open CMD in the backend folder)'); process.exit(1) }
let s = fs.readFileSync(file, 'utf8')
fs.writeFileSync(file + '.bak2', s)
const step = (name, ok) => console.log((ok ? 'ok  ' : '!!  ') + name)

// 1) the new "stage of delivery" list, placed just before model SsOrder
if (s.includes('enum SsFulfillment')) step('SsFulfillment list (already there)', true)
else {
  const at = s.indexOf('model SsOrder {')
  if (at === -1) step('SsFulfillment list (could not find model SsOrder)', false)
  else {
    s = s.slice(0, at) + 'enum SsFulfillment {\n  PENDING\n  DISPATCHED\n  DELIVERED\n}\n\n' + s.slice(at)
    step('SsFulfillment list added', true)
  }
}

// 2) the new fields inside model SsOrder
if (s.includes('fulfillmentStatus')) step('delivery fields (already there)', true)
else {
  const start = s.indexOf('model SsOrder {')
  const end = start === -1 ? -1 : s.indexOf('\n}\n', start)
  const block = start === -1 ? '' : s.slice(start, end)
  const m = /\n[ \t]*cancelledReason[ \t]+String\?[^\n]*/.exec(block)
  if (!m) step('delivery fields (could not find cancelledReason in SsOrder)', false)
  else {
    const at = start + m.index + m[0].length
    const fields = '\n\n  // delivery, after the customer has finished paying\n  fulfillmentStatus        SsFulfillment @default(PENDING)\n  dispatchedAt             DateTime?\n  courier                  String?\n  trackingNumber           String?\n  dispatchNote             String?\n  deliveredAt              DateTime?'
    s = s.slice(0, at) + fields + s.slice(at)
    step('delivery fields added to SsOrder', true)
  }
}

// 3) an index so the vendor screens stay quick
{
  const start = s.indexOf('model SsOrder {')
  const end = start === -1 ? -1 : s.indexOf('\n}\n', start)
  const block = start === -1 ? '' : s.slice(start, end)
  if (block.includes('@@index([vendorId, productId, status])')) step('index (already there)', true)
  else {
    const m = /\n[ \t]*@@index\(\[deadlineAt\]\)/.exec(block)
    if (!m) step('index (could not find the deadlineAt index; skipping, not needed)', true)
    else {
      const at = start + m.index + m[0].length
      s = s.slice(0, at) + '\n  @@index([vendorId, productId, status])' + s.slice(at)
      step('index added', true)
    }
  }
}

// 4) two new notification types
if (s.includes('SS_ORDER_DISPATCHED')) step('notification types (already there)', true)
else {
  const m = /\n[ \t]*SS_DISPUTE_OPENED[ \t]*(?=\n)/.exec(s)
  if (!m) step('notification types (could not find SS_DISPUTE_OPENED)', false)
  else {
    const at = m.index + m[0].length
    s = s.slice(0, at) + '\n  SS_ORDER_DISPATCHED\n  SS_ORDER_DELIVERED' + s.slice(at)
    step('notification types added', true)
  }
}

fs.writeFileSync(file, s)
console.log('\nSaved. Backup: ' + file + '.bak2')
console.log('Next: stop the backend, then run   npx prisma db push   and   npx prisma generate')
