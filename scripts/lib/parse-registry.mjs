import { readFileSync } from 'fs'

/**
 * Read the company registry from lib/companies/registry.ts.
 *
 * WHY A SHARED PARSER, AND WHY IT COUNTS ITSELF
 * ---------------------------------------------
 * Three scripts each carried their own copy of this regex:
 *
 *   /slug:\s*'([^']+)',\s*name:\s*'([^']+)',\s*domain:\s*'([^']+)'/g
 *
 * It requires a SINGLE-quoted name. 114 of the registry's 387 entries are
 * written `name: "Ramp"` with double quotes, so every one of those companies
 * was skipped — Ramp, Plaid, Anduril, CoreWeave, Vanta, Sentry, Mercury among
 * them. Nothing reported a problem: the scripts printed "273 companies" and
 * crawled 273 companies perfectly, and the recruiter directory simply never
 * mentioned the other 114.
 *
 * That is the failure this module is built to make impossible. It accepts
 * either quote style, and `parseRegistry` compares what it matched against the
 * number of `domain:` lines in the file, throwing when the gap is wider than
 * `tolerance`. A future field reordering or format change then fails the build
 * instead of quietly shrinking the corpus.
 */

const ENTRY_RE =
  /slug:\s*(['"])(.+?)\1\s*,\s*name:\s*(['"])(.+?)\3\s*,\s*domain:\s*(['"])(.+?)\5/g

/** A crude lower bound on how many companies the file declares. */
const DOMAIN_LINE_RE = /\bdomain:\s*['"]/g

export function parseRegistry(
  path = 'lib/companies/registry.ts',
  { tolerance = 0.02 } = {}
) {
  const source = readFileSync(path, 'utf8')

  const companies = []
  const seen = new Set()
  for (const m of source.matchAll(ENTRY_RE)) {
    const slug = m[2]
    if (seen.has(slug)) continue
    seen.add(slug)
    companies.push({ slug, name: m[4], domain: m[6].toLowerCase() })
  }

  const declared = (source.match(DOMAIN_LINE_RE) ?? []).length

  if (companies.length === 0) {
    throw new Error(`Parsed 0 companies from ${path} — refusing to continue.`)
  }

  const missed = declared - companies.length
  if (declared > 0 && missed / declared > tolerance) {
    throw new Error(
      `Registry parse is incomplete: matched ${companies.length} entries but ${path} ` +
      `declares ${declared} domains (${missed} missed, ${((missed / declared) * 100).toFixed(1)}%). ` +
      `The entry format has probably changed — fix ENTRY_RE in scripts/lib/parse-registry.mjs ` +
      `rather than letting the corpus shrink silently.`
    )
  }

  return { companies, declared, missed }
}
