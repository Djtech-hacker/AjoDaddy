// Replace the two old logo URLs with the new TAREVA logo URL.
//
//   node replace-logos.js           -> preview only, changes nothing
//   node replace-logos.js --apply   -> really changes the files

const fs = require('fs')
const path = require('path')

const APPLY = process.argv.includes('--apply')
const ROOT = process.cwd()

const OLD_URLS = [
  'https://res.cloudinary.com/dmjakrnby/image/upload/v1785357030/real_logo_s3jtjp.png',
  'https://res.cloudinary.com/dmjakrnby/image/upload/v1785166848/AjoDaddy_Black_yv047m.png',
]
const NEW_URL = 'https://res.cloudinary.com/dmjakrnby/image/upload/v1793386985/Tareva_Green_Leaf_Logo_mrzfsd.png'

// leftovers check: same images used with a different URL (e.g. with w_200 resize)
const OLD_IDS = ['real_logo_s3jtjp', 'AjoDaddy_Black_yv047m']

const SKIP_DIRS = new Set(['node_modules', '.git', 'dist', 'build', '.next', 'coverage', '.vite', 'migrations'])
const SKIP_FILES = new Set(['package-lock.json', 'yarn.lock', 'pnpm-lock.yaml', 'replace-logos.js', 'rename-to-tareva.js'])
const TEXT_EXT = new Set(['.ts', '.tsx', '.js', '.jsx', '.json', '.html', '.css', '.md', '.txt', '.svg', '.mjs', '.cjs', '.yml', '.yaml'])

const isEnv = f => path.basename(f).startsWith('.env')

let filesChanged = 0, totalHits = 0
const leftovers = []

function walk(dir) {
  for (const name of fs.readdirSync(dir)) {
    const full = path.join(dir, name)
    let st
    try { st = fs.statSync(full) } catch { continue }
    if (st.isDirectory()) { if (!SKIP_DIRS.has(name)) walk(full); continue }
    if (SKIP_FILES.has(name)) continue
    if (!isEnv(full) && !TEXT_EXT.has(path.extname(name).toLowerCase())) continue
    if (st.size > 2_000_000) continue

    const text = fs.readFileSync(full, 'utf8')
    let out = text, hits = 0
    for (const oldUrl of OLD_URLS) {
      out = out.split(oldUrl).join(NEW_URL === oldUrl ? oldUrl : '\u0000NEW\u0000')
    }
    hits = (out.match(/\u0000NEW\u0000/g) || []).length
    out = out.split('\u0000NEW\u0000').join(NEW_URL)

    // anything still mentioning the old image ids after replacing
    const rel = path.relative(ROOT, full)
    out.split('\n').forEach((line, i) => {
      if (OLD_IDS.some(id => line.includes(id))) leftovers.push(`  ${rel}  line ${i + 1}: ${line.trim().slice(0, 110)}`)
    })

    if (hits === 0) continue
    filesChanged++; totalHits += hits
    console.log(`${APPLY ? 'changed' : 'would change'}  ${rel}  (${hits})`)
    if (APPLY) fs.writeFileSync(full, out, 'utf8')
  }
}

walk(ROOT)

console.log(`\n${APPLY ? 'Changed' : 'Would change'} ${totalHits} places in ${filesChanged} files.`)
if (leftovers.length) {
  console.log('\nThese lines still use the old logo in a different URL form. Fix by hand:')
  leftovers.forEach(l => console.log(l))
}
if (!APPLY) console.log('\nNothing was changed. Run again with --apply to make the changes.')