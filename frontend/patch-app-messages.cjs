// Adds the Messages page and the Messages button to src/App.tsx
// Run from the FRONTEND folder:   node patch-app-messages.js
const fs = require('fs')
const file = 'src/App.tsx'
if (!fs.existsSync(file)) { console.log('Cannot find ' + file + '. Open CMD in the frontend folder and try again.'); process.exit(1) }
let s = fs.readFileSync(file, 'utf8')
fs.writeFileSync(file + '.bak', s)

function step(name, ok) { console.log((ok ? 'ok  ' : '!!  ') + name) }

// 1) imports
if (!s.includes('MessagesBubble')) {
  const re = /(import SupportBubble from '@\/components\/SupportBubble'[^\n]*\n)/
  if (re.test(s)) {
    s = s.replace(re, "$1import MessagesBubble from '@/components/MessagesBubble'\nimport MessagesPage from '@/pages/messages/MessagesPage'\n")
    step('imports added', true)
  } else step('imports (could not find the SupportBubble import)', false)
} else step('imports already there', true)

// 2) the route
if (!s.includes('path="/messages"')) {
  const re = /(\n[ \t]*)(<Route path="\/wallet")/
  if (re.test(s)) {
    s = s.replace(re, '$1<Route path="/messages"        element={<RequireAuth><MessagesPage /></RequireAuth>} />$1$2')
    step('route added', true)
  } else step('route (could not find the /wallet route)', false)
} else step('route already there', true)

// 3) the button, next to the support bubble
if (!/<MessagesBubble/.test(s)) {
  const re = /([ \t]*)(<SupportBubble[^>]*\/>)/
  if (re.test(s)) {
    s = s.replace(re, '$1$2\n$1{user && <MessagesBubble />}')
    step('Messages button added', true)
  } else step('button (could not find <SupportBubble />)', false)
} else step('Messages button already there', true)

fs.writeFileSync(file, s)
console.log('\nSaved. Backup: src/App.tsx.bak')