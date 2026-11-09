const fs = require('fs')
const file = 'src/App.tsx'
if (!fs.existsSync(file)) { console.log('Cannot find ' + file + '. Open CMD in the frontend folder and try again.'); process.exit(1) }
let s = fs.readFileSync(file, 'utf8')
fs.writeFileSync(file + '.bak2', s)
const step = (name, ok) => console.log((ok ? 'ok  ' : '!!  ') + name)

const bubble = /[ \t]*<SupportBubble[^>]*\/>[ \t]*\n/
if (bubble.test(s)) { s = s.replace(bubble, ''); step('support bubble removed', true) }
else step('support bubble (not found, maybe already removed)', false)

const imp = /import SupportBubble from '@\/components\/SupportBubble'[^\n]*\n/
if (imp.test(s)) { s = s.replace(imp, ''); step('import removed', true) }
else step('import (not found)', false)

const nameBlock = /[ \t]*\/\/ Name sent in the WhatsApp message[\s\S]*?u\?\.username \|\|\s*\n\s*undefined\n/
if (nameBlock.test(s)) { s = s.replace(nameBlock, ''); step('support name code removed', true) }
else step('support name code (not found, harmless, leave it)', false)

fs.writeFileSync(file, s)
console.log('\nSaved. Backup: src/App.tsx.bak2')