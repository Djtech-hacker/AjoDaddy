// Fixes the chat part of prisma/schema.prisma.
// Run from the BACKEND folder:   node fix-schema.js
const fs = require('fs')
const file = 'prisma/schema.prisma'
if (!fs.existsSync(file)) { console.log('Cannot find ' + file + '. Open CMD in the backend folder and try again.'); process.exit(1) }

let s = fs.readFileSync(file, 'utf8')
fs.writeFileSync(file + '.bak', s)

const NEW_THREAD = `// ── Chat between customer and vendor (can start before buying; attached to the plan once they buy) ─

model SsChatThread {
  id            String    @id @default(uuid())
  orderId       String?   @unique
  productId     String?
  customerId    String
  vendorId      String
  isOpen        Boolean   @default(true)
  lastMessageAt DateTime?
  createdAt     DateTime  @default(now())

  order    SsOrder?        @relation(fields: [orderId], references: [id], onDelete: Cascade)
  product  SsProduct?      @relation(fields: [productId], references: [id], onDelete: Cascade)
  messages SsChatMessage[]

  @@index([customerId])
  @@index([vendorId])
  @@index([productId, customerId])
  @@map("ss_chat_threads")
}

`

// 1) the SsChatThread model (works whether it is the old one or the half-deleted one)
const re = /\/\/ ── Chat between customer and vendor[^\n]*\n[\s\S]*?(?=model SsChatMessage \{)/
if (re.test(s)) { s = s.replace(re, NEW_THREAD); console.log('ok  SsChatThread model fixed') }
else console.log('!!  could not find the chat section. Tell me.')

// 2) the one line SsProduct needs
const start = s.indexOf('model SsProduct {')
if (start === -1) console.log('!!  could not find model SsProduct')
else {
  const end = s.indexOf('\n}\n', start)
  const block = s.slice(start, end)
  if (block.includes('chatThreads')) console.log('ok  SsProduct already has chatThreads')
  else {
    const m = /(\n\s*notes\s+SsNote\[\][^\n]*)/.exec(block)
    if (!m) console.log('!!  could not find the notes line in SsProduct. Tell me.')
    else {
      const at = start + m.index + m[0].length
      s = s.slice(0, at) + '\n  chatThreads SsChatThread[]' + s.slice(at)
      console.log('ok  SsProduct got the chatThreads line')
    }
  }
}

fs.writeFileSync(file, s)
console.log('\nSaved. A backup is in prisma/schema.prisma.bak')
console.log('Next run:  npx prisma db push')