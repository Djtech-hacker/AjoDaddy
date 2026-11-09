// Hides the final Approve / Reject buttons from customer care (admins still see them).
// Run from the FRONTEND folder:   node patch-staff-buttons.cjs
const fs = require('fs')
const file = 'src/pages/staff/SmallSmallStaffPage.tsx'
if (!fs.existsSync(file)) { console.log('!!  cannot find ' + file + ' (open CMD in the frontend folder)'); process.exit(1) }
let s = fs.readFileSync(file, 'utf8')
fs.writeFileSync(file + '.bak', s)

if (s.includes('{isAdmin && (\n                  <>')) {
  console.log('ok  already done')
} else {
  const re = /([ \t]*)(<button type="button" className="ss-btn sm" disabled=\{busy\} onClick=\{\(\) => \{ setOverride\(false\); setDecision\('APPROVE'\) \}\}>Approve<\/button>\s*<button type="button" className="ss-btn danger sm" disabled=\{busy\} onClick=\{\(\) => setDecision\('REJECT'\)\}>Reject<\/button>)/
  if (re.test(s)) {
    s = s.replace(re, (m, indent, buttons) =>
      `${indent}{isAdmin && (\n${indent}  <>\n${indent}    ${buttons}\n${indent}  </>\n${indent})}`)
    console.log('ok  Approve and Reject are now admin-only on screen')
  } else {
    console.log('!!  could not find the Approve / Reject buttons. Tell me.')
  }
}
fs.writeFileSync(file, s)
console.log('\nSaved. Backup: ' + file + '.bak')
