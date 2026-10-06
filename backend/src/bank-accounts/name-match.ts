// Compares the name Paystack resolved for a bank account with the name we
// hold for the user (ideally the BVN/NIN name). Banks write names in
// different orders and drop middle names, so we match on name PARTS.

const TITLES = new Set(['MR', 'MRS', 'MISS', 'MS', 'DR', 'CHIEF', 'ALHAJI', 'ALHAJA', 'ENGR', 'PROF', 'PST'])

export function nameTokens(name: string): string[] {
  return name
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toUpperCase()
    .replace(/['’`-]/g, '')
    .replace(/[^A-Z\s]/g, ' ')
    .split(/\s+/)
    .filter(t => t.length >= 2 && !TITLES.has(t))
}

function levenshtein(a: string, b: string): number {
  const dp = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)])
  for (let j = 1; j <= b.length; j++) dp[0][j] = j
  for (let i = 1; i <= a.length; i++)
    for (let j = 1; j <= b.length; j++)
      dp[i][j] = Math.min(dp[i - 1][j] + 1, dp[i][j - 1] + 1, dp[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1))
  return dp[a.length][b.length]
}

function similar(a: string, b: string): boolean {
  if (a === b) return true
  return Math.min(a.length, b.length) >= 5 && levenshtein(a, b) <= 1
}

export interface NameMatchResult { matched: boolean; shared: number; required: number }

export function nameMatch(reference: string, resolved: string): NameMatchResult {
  const a = nameTokens(reference)
  const b = nameTokens(resolved)
  if (!a.length || !b.length) return { matched: false, shared: 0, required: 2 }

  const used = new Set<number>()
  let shared = 0
  for (const t of a) {
    const i = b.findIndex((u, idx) => !used.has(idx) && similar(t, u))
    if (i >= 0) { used.add(i); shared++ }
  }
  // two name parts must agree (one only if we hold a single name for the user)
  const required = Math.min(2, a.length)
  return { matched: shared >= required, shared, required }
}

export function matchesAny(references: string[], resolved: string): boolean {
  return references.filter(Boolean).some(r => nameMatch(r, resolved).matched)
}