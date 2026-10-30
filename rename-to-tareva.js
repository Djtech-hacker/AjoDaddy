// Rename AjoDaddy / PayPaddy to TAREVA everywhere in your code.
//
// Run from the paypaddy-v2 folder (the one that contains backend and frontend):
//   node rename-to-tareva.js            -> only SHOWS what would change (safe)
//   node rename-to-tareva.js --apply    -> really changes the files
//
// Run it only after you have committed your code to git, so you can undo it.

const fs = require('fs')
const path = require('path')

const APPLY = process.argv.includes('--apply')
const ROOT = process.cwd()

// order matters: longer / more specific first
const RULES = [
  [/Ajo[\s_-]?Daddy/g, 'TAREVA'],
  [/AJO[\s_-]?DADDY/g, 'TAREVA'],
  [/ajo[\s_-]?daddy/g, 'tareva'],
  [/Pay[\s_-]?Paddy/g, 'TAREVA'],
  [/PAY[\s_-]?PADDY/g, 'TAREVA'],
  [/pay[\s_-]?paddy/g, 'tareva'],
]

const SKIP_DIRS = new Set(['node_modules', '.git', 'dist', 'build', '.next', 'coverage', '.vite', 'migrations'])
const SKIP_FILES = new Set(['package-lock.json', 'yarn.lock', 'pnpm-lock.yaml'])
const TEXT_EXT = new Set(['.ts', '.tsx', '.js', '.jsx', '.json', '.html', '.css', '.md', '.txt', '.prisma', '.sql', '.yml', '.yaml', '.svg', '.mjs', '.cjs'])

// .env files hold passwords and database names: never touched, only reported
const isEnv = f => path.basename(f).startsWith('.env')

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
      if (RULES.some(([re]) => { re.lastIndex = 0; return re.test(t) })) envHits.push(path.relative(ROOT, full))
      continue
    }
    if (!TEXT_EXT.has(path.extname(name).toLowerCase())) continue
    if (st.size > 2_000_000) continue

    const text = fs.readFileSync(full, 'utf8')
    let out = text, hits = 0
    for (const [re, to] of RULES) out = out.replace(re, () => { hits++; return to })
    if (hits === 0) continue

    filesChanged++; totalHits += hits
    console.log(`${APPLY ? 'changed' : 'would change'}  ${path.relative(ROOT, full)}  (${hits})`)
    if (!APPLY) {
      // show the first few lines that would change
      let shown = 0
      text.split('\n').forEach((line, i) => {
        if (shown < 3 && RULES.some(([re]) => { re.lastIndex = 0; return re.test(line) })) {
          console.log(`    line ${i + 1}: ${line.trim().slice(0, 110)}`); shown++
        }
      })
    } else {
      fs.writeFileSync(full, out, 'utf8')
    }
  }
}

walk(ROOT)

console.log(`\n${APPLY ? 'Changed' : 'Would change'} ${totalHits} places in ${filesChanged} files.`)
if (envHits.length) {
  console.log('\nThese .env files mention the old name and were NOT touched. Check them by hand:')
  envHits.forEach(f => console.log('  ' + f))
}
if (!APPLY) console.log('\nNothing was changed. Run again with --apply to make the changes.')