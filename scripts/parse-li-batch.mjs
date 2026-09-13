/**
 * Parse scripts/li-batch-out.json (authenticated LinkedIn search_people results)
 * into recruiter evidence records -- but ONLY for people the snippet actually
 * places at the target company in a recruiting role. Mutual-connection names
 * (which never head their own result block) are excluded by construction.
 *
 *   node scripts/parse-li-batch.mjs           # dry run: print what it found
 *   node scripts/parse-li-batch.mjs --write   # also write data/recruiter-evidence/<slug>.json
 */
import { readFileSync, writeFileSync } from 'fs'

const WRITE = process.argv.includes('--write')
const batch = JSON.parse(readFileSync('scripts/li-batch-out.json', 'utf8'))

// Company-name variants the snippet must mention for a result to count.
const NAME = {
  'bny-mellon': ['bny', 'bank of new york'],
  'morgan-stanley': ['morgan stanley'],
  'deutsche-bank': ['deutsche bank'],
  'mastercard': ['mastercard'],
  'barclays': ['barclays'],
  'visa': ['visa'],
  'mufg': ['mufg', 'mitsubishi ufj', 'union bank'],
  'clsa': ['clsa'],
  'national-australia-bank': ['nab', 'national australia bank'],
  'commonwealth-bank': ['commonwealth bank', 'commbank'],
  'lloyds-banking-group': ['lloyds'],
  'paypal': ['paypal'],
  'natwest': ['natwest'],
  'standard-chartered': ['standard chartered'],
}
const DISPLAY = {
  'bny-mellon': 'BNY', 'morgan-stanley': 'Morgan Stanley', 'deutsche-bank': 'Deutsche Bank',
  'mastercard': 'Mastercard', 'barclays': 'Barclays', 'visa': 'Visa', 'mufg': 'MUFG',
  'clsa': 'CLSA', 'national-australia-bank': 'National Australia Bank',
  'commonwealth-bank': 'Commonwealth Bank of Australia', 'lloyds-banking-group': 'Lloyds Banking Group',
  'paypal': 'PayPal', 'natwest': 'NatWest Group', 'standard-chartered': 'Standard Chartered',
}
const ROLE_RE = /recruit|talent acquisition|talent partner|sourc|hiring|\bta\b/i
const COUNTRY_RE = /(United States|United Kingdom|India|Singapore|Hong Kong|Australia|Germany|Japan|Canada|Ireland|Poland|Romania|France|Netherlands|Spain|Malaysia|Philippines|China|UAE|Metropolitan|Area|Region)/i

function blocks(text) {
  // Split into non-empty trimmed lines; a result person is any line immediately
  // followed by a "• <degree>" line. Everything up to the next such marker is
  // that person's block.
  const lines = text.split('\n').map((l) => l.trim()).filter(Boolean)
  const starts = []
  for (let i = 1; i < lines.length; i++) {
    if (/^•\s*(1st|2nd|3rd\+?)/i.test(lines[i])) starts.push(i - 1) // name is the previous line
  }
  const out = []
  for (let s = 0; s < starts.length; s++) {
    const nameIdx = starts[s]
    const end = s + 1 < starts.length ? starts[s + 1] : lines.length
    const name = lines[nameIdx]
    const body = lines.slice(nameIdx + 2, end) // skip name + degree line
    out.push({ name, body })
  }
  return out
}

function refUrl(refs, name) {
  const hit = refs.find((r) => (r.text || '').trim().toLowerCase() === name.trim().toLowerCase())
  return hit ? `https://www.linkedin.com${hit.url}` : null
}

// Strip pronoun tags, parentheticals, and trailing credentials from a display name.
function cleanName(raw) {
  return String(raw)
    .replace(/\([^)]*\)/g, '')
    .replace(/,\s*(mba|phr|sphr|ihrp[-\s]?c?p?|cir|acir|assoc cipd|cipd|shrm[-\s]?cp)\b.*$/i, '')
    .replace(/\s{2,}/g, ' ')
    .trim()
}
// A "name" that is really an org/function account, not a person.
const ORG_NAME_RE = /\b(recruit(ing|ment)?|talent|careers?|hiring|sourcing|hr|human resources)\b/i
// The company is named only as a PAST employer in this block.
function companyIsPreviousOnly(bodyText, variants) {
  const lower = bodyText.toLowerCase()
  return variants.some((v) => {
    let idx = lower.indexOf(v), prevCtx = false, anyNonPrev = false
    while (idx !== -1) {
      const before = lower.slice(Math.max(0, idx - 24), idx)
      if (/previous|formerly|\bex[-\s]|prior\b|past:/.test(before)) prevCtx = true
      else anyNonPrev = true
      idx = lower.indexOf(v, idx + 1)
    }
    return prevCtx && !anyNonPrev
  })
}

const summary = []
for (const entry of batch) {
  const slug = entry.label
  const variants = NAME[slug] || []
  let parsed
  try { parsed = JSON.parse(entry.text) } catch { parsed = null }
  const text = parsed?.sections?.search_results || ''
  const refs = parsed?.references?.search_results || []
  const people = blocks(text)

  const records = []
  const skipped = []
  for (const p of people) {
    const name = cleanName(p.name)
    const bodyText = p.body.join(' \n ')
    const lower = bodyText.toLowerCase()
    if (ORG_NAME_RE.test(name)) { skipped.push(`${p.name} [org-account]`); continue }
    const companyHit = variants.some((v) => lower.includes(v))
    const roleHit = ROLE_RE.test(bodyText)
    if (!companyHit || !roleHit) { skipped.push(`${name} [${companyHit ? '' : 'no-company'}${roleHit ? '' : ' no-role'}]`); continue }
    if (companyIsPreviousOnly(bodyText, variants)) { skipped.push(`${name} [company-is-previous-only]`); continue }
    const url = refUrl(refs, p.name)
    if (!url) { skipped.push(`${name} [no-url]`); continue }
    // title: prefer "Current: ..." else the first (headline) field
    const currentLine = p.body.find((l) => /^current:/i.test(l))
    let title = currentLine ? currentLine.replace(/^current:\s*/i, '') : p.body[0]
    title = (title || '').split(/\s+at\s+/i)[0].slice(0, 120).trim()
    const location = p.body.find((l) => l.includes(',') && COUNTRY_RE.test(l)) || null
    records.push({
      fullName: name,
      currentTitle: title,
      location: location || undefined,
      sourceType: 'linkedin',
      linkedinUrl: url,
      sourceUrls: [url],
      evidence: [`Authenticated LinkedIn People search (retrieved 2026-09-12): '${name} — ${p.body[0] || title}'${location ? ', ' + location : ''}.`],
      lastVerifiedAt: '2026-09-12',
    })
  }
  // de-dupe by url within company
  const seen = new Set()
  const deduped = records.filter((r) => (seen.has(r.linkedinUrl) ? false : seen.add(r.linkedinUrl)))
  summary.push({ slug, kept: deduped.length, skipped: skipped.length })
  console.log(`\n== ${slug} (${DISPLAY[slug]}) : ${deduped.length} kept, ${skipped.length} skipped`)
  for (const r of deduped) console.log(`   + ${r.fullName} — ${r.currentTitle}${r.location ? ' — ' + r.location : ''}`)
  if (skipped.length) console.log(`   skipped: ${skipped.slice(0, 12).join(' | ')}`)

  if (WRITE && deduped.length) {
    const file = `data/recruiter-evidence/${slug}.json`
    writeFileSync(file, JSON.stringify({
      companySlug: slug,
      companyName: DISPLAY[slug],
      notes: `Named individuals from authenticated LinkedIn People search (search_people) via the user's own session on 2026-09-12 -- name, current title, company, location and public profile URL only; no private fields, no messaging. Kept only results whose snippet places the person at ${DISPLAY[slug]} in a recruiting/talent role; mutual-connection names and off-company matches excluded. Single source type (LinkedIn) -> at most 'corroborated'/medium.`,
      records: deduped,
    }, null, 2))
    console.log(`   wrote ${file}`)
  }
}
console.log('\nTOTAL kept:', summary.reduce((a, b) => a + b.kept, 0))
