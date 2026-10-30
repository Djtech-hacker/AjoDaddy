// Safe rename: AjoDaddy / PayPaddy -> TAREVA (visible text only)
//
//   node rename-to-tareva.js           -> preview only, changes nothing
//   node rename-to-tareva.js --apply   -> really changes the files

const fs = require('fs')
const path = require('path')

const APPLY = process.argv.includes('--apply')
const ROOT = process.cwd()

// Things that must NEVER be renamed (kept exactly as they are).
// They are hidden behind placeholders while the rename runs, then put back.
const KEEP = [
  /[a-z0-9._-]+@[a-z0-9.-]*(ajo-?daddy|pay-?paddy)[a-z0-9.-]*\.[a-z]+/gi,            // emails
  /[a-z0-9.-]*(ajo-?daddy|pay-?paddy)[a-z0-9.-]*\.(onrender\.com|com|io|ng|app|co)\b/gi, // domains / URLs
  /paypaddy-kyc-key-32-chars-exact!!/gi,                                              // KYC encryption key
  /paypaddy_kyc_faces/gi,                                                             // Cloudinary preset
  /(ajodaddy|paypaddy)\/(vendor-docs|products|avatars|groups)/gi,                     // Cloudinary folders
  /paypaddy-(backend|frontend|monorepo|v2)/gi,                                        // package + folder names
]

// Visible text rules (longer / more specific first)
const RULES = [
  [/Ajo[\s_-]?Daddy/g, 'TAREVA'],
  [/AJO[\s_-]?DADDY/g, 'TAREVA'],
  [/ajo[\s_-]?daddy/g, 'tareva'],
  [/Pay[\s_-]?Paddy/g, 'TAREVA'],
  [/PAY[\s_-]?PADDY/g, 'TAREVA'],
  [/pay[\s_-]?paddy/g, 'tareva'],
]

const SKIP_DIRS = new Set(['node_modules', '.git', 'dist', 'build', '.next', 'coverage', '.vite', 'migrations'])
const SKIP_FILES = new Set(['package-lock.json', 'yarn.lock', 'pnpm-lock.yaml', 'rename-to-tareva.js'])
const TEXT_EXT = new Set(['.ts', '.tsx', '.js', '.jsx', '.json', '.html', '.css', '.md', '.txt', '.prisma', '.sql', '.yml', '.yaml', '.svg', '.mjs', '.cjs'])

const isEnv = f => path.basename(f).startsWith('.env')

// Rename one line, protecting the KEEP items. Returns [newLine, hits]
function transformLine(line) {
  const store = []
  let s = line
  for (const re of KEEP) {
    s = s.replace(re, m => { store.push(m); return `@@KEEP${store.length - 1}@@` })
  }
  let hits = 0
  for (const [re, to] of RULES) s = s.replace(re, () => { hits++; return to })
  s = s.replace(/@@KEEP(\d+)@@/g, (_, i) => store[i])
  return [s, hits]
}

let filesChanged = 0, totalHits = 0
const envHits = []

function walk(dir) {
  for (const name of fs.readdirSync(dir)) {
    const full = path.join(dir, name)
    let st
    try { st = fs.statSync(full) } catch { continue }
    if (st.isDirectory()) { if (!SKIP_DIRS.has(name)) walk(full); continue }
    if (SKIP_FILES.has(name)) continue
    if (isEnv(full)) {
      const t = fs.readFileSync(full, 'utf8')
      if (/ajo[\s_-]?daddy|pay[\s_-]?paddy/i.test(t)) envHits.push(path.relative(ROOT, full))
      continue
    }
    if (!TEXT_EXT.has(path.extname(name).toLowerCase())) continue
    if (st.size > 2_000_000) continue

    const text = fs.readFileSync(full, 'utf8')
    const lines = text.split('\n')
    let hits = 0, shown = 0
    const preview = []

    const outLines = lines.map((line, i) => {
      const [newLine, h] = transformLine(line)
      if (h > 0) {
        hits += h
        if (shown < 3) { preview.push(`    line ${i + 1}: ${newLine.trim().slice(0, 110)}`); shown++ }
      }
      return newLine
    })

    if (hits === 0) continue
    filesChanged++; totalHits += hits
    console.log(`${APPLY ? 'changed' : 'would change'}  ${path.relative(ROOT, full)}  (${hits})`)
    if (!APPLY) preview.forEach(p => console.log(p))
    else fs.writeFileSync(full, outLines.join('\n'), 'utf8')
  }
}

walk(ROOT)

console.log(`\n${APPLY ? 'Changed' : 'Would change'} ${totalHits} places in ${filesChanged} files.`)
if (envHits.length) {
  console.log('\nThese .env files mention the old name and were NOT touched. Check by hand:')
  envHits.forEach(f => console.log('  ' + f))
}
if (!APPLY) console.log('\nNothing was changed. Run again with --apply to make the changes.')