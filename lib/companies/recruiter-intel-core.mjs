/**
 * Pure, dependency-free logic for the recruiter-intelligence layer.
 *
 * This file is plain ESM (no types) on purpose: the build script runs under
 * `node`, the Next app imports it through a typed .ts wrapper, and the test
 * suite runs it under tsx -- one implementation, three consumers, no drift.
 *
 * Everything here is deterministic. Given the same evidence in, it produces
 * the same records, confidence, and dedup out. There is no network here and no
 * guessing: an email is only ever "published" if a source URL carries it, MX
 * never touches a person's confidence, and a record can only be "confirmed"
 * with corroborating evidence.
 */

/* ------------------------------- taxonomy -------------------------------- */

/** Role families we recognise, most specific first. Drives department + filter. */
export const ROLE_FAMILIES = [
  { key: 'leadership', label: 'Leadership', re: /head of (talent|recruit)|recruiting director|director of (talent|recruit)|chief (people|human)|vp,? talent|vice president[ ,-]+talent/i },
  { key: 'executive', label: 'Executive Recruiting', re: /executive (recruit|talent|search)/i },
  { key: 'technology', label: 'Technology Recruiting', re: /(technical|technology|engineering|software|cyber|security|data) recruit/i },
  { key: 'campus', label: 'Campus Recruiting', re: /(campus|university|early care?er|graduate|student) recruit|early care?er/i },
  { key: 'sourcer', label: 'Talent Sourcer', re: /sourc(er|ing)/i },
  { key: 'talent_partner', label: 'Talent Partner', re: /talent (acquisition )?partner|talent partner|recruiting partner/i },
  { key: 'talent_acquisition', label: 'Talent Acquisition', re: /talent acquisition|\bta\b/i },
  { key: 'recruiter', label: 'Recruiters', re: /recruit(er|ing|ment)|talent/i },
]

/** Does this title read like a recruiting/talent role at all? */
export function isRecruitingTitle(title) {
  if (!title) return false
  return ROLE_FAMILIES.some((f) => f.re.test(title))
}

/** The single best-matching role family for a title (or null). */
export function roleFamily(title) {
  if (!title) return null
  for (const f of ROLE_FAMILIES) if (f.re.test(title)) return f.key
  return null
}

/** Roles used to generate discovery queries (spec section 3). */
export const DISCOVERY_ROLES = [
  'Recruiter', 'Technical Recruiter', 'Senior Recruiter', 'Talent Acquisition',
  'Talent Acquisition Partner', 'Talent Acquisition Manager', 'Talent Acquisition Lead',
  'Talent Partner', 'Recruiting Lead', 'Campus Recruiter', 'University Recruiter',
  'Executive Recruiter', 'Engineering Recruiter', 'Technology Recruiter',
  'Cybersecurity Recruiter', 'Talent Sourcer', 'Head of Talent Acquisition',
  'Head of Recruiting', 'Recruiting Director',
]

/**
 * The exact public-search queries the discovery pipeline would run for a
 * company. Deterministic and inspectable -- we generate them so a human (or a
 * future search-API integration) can execute them, rather than pretending a
 * generic search already happened.
 */
export function discoveryQueries(companyName, domain) {
  const q = []
  for (const role of DISCOVERY_ROLES) q.push(`"${companyName}" "${role}"`)
  q.push(`"${companyName}" recruiter`)
  q.push(`"${companyName}" "Talent Acquisition"`)
  q.push(`"${companyName}" "Talent Partner"`)
  q.push(`site:linkedin.com/in "${companyName}" recruiter`)
  q.push(`site:linkedin.com/in "${companyName}" "Talent Acquisition"`)
  if (domain) {
    q.push(`site:${domain} recruiter`)
    q.push(`site:${domain} "talent acquisition"`)
  }
  return q
}

/** Per-candidate corroboration queries once a name is known (spec section 5). */
export function corroborationQueries(fullName, companyName) {
  return [
    `"${fullName}" "${companyName}" recruiter`,
    `"${fullName}" "${companyName}" "Talent Acquisition"`,
    `"${fullName}" "${companyName}" "Recruiting"`,
    `site:linkedin.com/in "${fullName}" "${companyName}"`,
  ]
}

/* ---------------------------- normalisation ------------------------------ */

export function normalizeName(name) {
  return String(name || '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

/**
 * A name is "full" only if it has two real name tokens. Aggregators frequently
 * truncate to "Sandra S." or "Carly N." -- those cannot be a confirmed
 * identity and must not be treated as one.
 */
export function isFullName(name) {
  const parts = normalizeName(name).split(' ').filter(Boolean)
  if (parts.length < 2) return false
  // last token must be a real surname, not a single initial like "s"
  const last = parts[parts.length - 1]
  return last.length >= 2
}

export function splitName(name) {
  const parts = String(name || '').trim().split(/\s+/)
  if (parts.length < 2) return { firstName: parts[0] || undefined, lastName: undefined }
  return { firstName: parts[0], lastName: parts[parts.length - 1] }
}

/** Canonical LinkedIn identity: host + /in/<handle>, lowercased, no query. */
export function canonicalLinkedin(url) {
  if (!url) return null
  try {
    const u = new URL(url)
    if (!/linkedin\.com$/i.test(u.hostname.replace(/^www\./, ''))) return null
    const m = u.pathname.match(/\/in\/([^/]+)/i)
    if (!m) return null
    return `linkedin.com/in/${decodeURIComponent(m[1]).toLowerCase()}`
  } catch {
    return null
  }
}

export function isValidUrl(url) {
  if (!url) return false
  try {
    const u = new URL(url)
    return u.protocol === 'http:' || u.protocol === 'https:'
  } catch {
    return false
  }
}

export function hostOf(url) {
  try {
    return new URL(url).hostname.replace(/^www\./, '').toLowerCase()
  } catch {
    return null
  }
}

/* ------------------------------- email ----------------------------------- */

export const EMAIL_RE = /^[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}$/i
const ROLE_LOCAL = /^(careers?|recruit(ing|ment)?|jobs?|hiring|talent|hr|humanresources|people|campus|graduates?|earlycareers?|resourcing|staffing|applications?|candidate)([._-][a-z0-9]+)?$/i

export function isValidEmail(email) {
  return typeof email === 'string' && EMAIL_RE.test(email.trim())
}

export function isRoleEmail(email) {
  if (!isValidEmail(email)) return false
  return ROLE_LOCAL.test(email.split('@')[0])
}

/**
 * Classify an email for a PERSON record. There are exactly three outcomes and
 * a guessed address is never one of them, because "published" demands a source.
 *
 *   published          -> an exact personal address a public source prints
 *   company_published  -> a role address (careers@ ...) -- not an individual
 *   not_found          -> no exact public address exists (the common case)
 */
export function classifyPersonEmail(email, hasSource) {
  if (!isValidEmail(email)) return 'not_found'
  if (isRoleEmail(email)) return 'company_published'
  if (!hasSource) return 'not_found' // an address without a source is a guess
  return 'published'
}

/* --------------------------- confidence engine --------------------------- */

/**
 * Deterministic identity + confidence. The only inputs that matter are: is the
 * current company confirmed, is a recruiting role confirmed, how many
 * INDEPENDENT public sources exist, and is the name a real full name.
 *
 * MX/SPF/DMARC deliberately play no part -- domain mail posture says nothing
 * about whether a named person is who a source claims.
 */
export function scoreIdentity({ companyConfirmed, roleConfirmed, independentSources, fullName }) {
  if (companyConfirmed && roleConfirmed && fullName && independentSources >= 2) {
    return { identityStatus: 'confirmed', confidence: 'high' }
  }
  if (companyConfirmed && roleConfirmed && fullName && independentSources >= 1) {
    return { identityStatus: 'corroborated', confidence: 'medium' }
  }
  return { identityStatus: 'uncertain', confidence: 'low' }
}

/** Count distinct source hosts -- two links on one site is still one source. */
export function independentSourceCount(sourceUrls) {
  const hosts = new Set()
  for (const u of sourceUrls || []) {
    const h = hostOf(u)
    if (h) hosts.add(h)
  }
  return hosts.size
}

/* ------------------------------ validation ------------------------------- */

/**
 * Structural + integrity validation for one record. Returns { ok, errors }.
 * A "confirmed" record with no evidence is a hard failure -- the build must
 * refuse to ship a claim it cannot back.
 */
export function validateRecord(r) {
  const errors = []
  if (!r.fullName || !r.fullName.trim()) errors.push('missing fullName')
  if (!r.companySlug) errors.push('missing companySlug')
  const urls = [
    ...(r.sourceUrls || []),
    r.linkedinUrl,
    r.officialCompanyProfileUrl,
    ...(r.otherPublicSourceUrls || []),
  ].filter(Boolean)
  for (const u of urls) if (!isValidUrl(u)) errors.push(`malformed URL: ${u}`)
  if ((r.sourceUrls || []).length === 0) errors.push('no source URLs')
  if (r.identityStatus === 'confirmed' && (r.evidence || []).length === 0) {
    errors.push('confirmed record has no evidence')
  }
  if (r.email) {
    if (!isValidEmail(r.email)) errors.push(`malformed email: ${r.email}`)
    if (r.emailStatus === 'published' && !r.emailSourceUrl) {
      errors.push('published email has no source')
    }
  }
  if (r.confidence === 'high' && r.identityStatus !== 'confirmed') {
    errors.push('high confidence without confirmed identity')
  }
  return { ok: errors.length === 0, errors }
}

/* ----------------------------- deduplication ----------------------------- */

/**
 * Merge records that are the SAME person; never merge two different people who
 * happen to share a name. Precedence:
 *   1. identical canonical LinkedIn URL  -> same person
 *   2. identical name + company + title  -> same record
 * Same name + company but DIFFERENT titles are kept apart: it may be a title
 * change or it may be two people, and we do not guess.
 */
export function deduplicateRecruiters(records) {
  const byLinkedin = new Map()
  const byNameCompanyTitle = new Map()
  const out = []
  let merged = 0

  const mergeInto = (target, r) => {
    merged++
    target.sourceUrls = [...new Set([...(target.sourceUrls || []), ...(r.sourceUrls || [])])]
    target.evidence = [...new Set([...(target.evidence || []), ...(r.evidence || [])])]
    target.otherPublicSourceUrls = [
      ...new Set([...(target.otherPublicSourceUrls || []), ...(r.otherPublicSourceUrls || [])]),
    ]
    // Prefer the more specific / non-empty field values.
    for (const f of ['currentTitle', 'department', 'location', 'linkedinUrl', 'officialCompanyProfileUrl', 'email', 'emailSourceUrl']) {
      if (!target[f] && r[f]) target[f] = r[f]
    }
  }

  for (const r of records) {
    const li = canonicalLinkedin(r.linkedinUrl)
    if (li && byLinkedin.has(li)) {
      mergeInto(byLinkedin.get(li), r)
      continue
    }
    const nkey = `${normalizeName(r.fullName)}|${r.companySlug}|${normalizeName(r.currentTitle || '')}`
    if (byNameCompanyTitle.has(nkey)) {
      mergeInto(byNameCompanyTitle.get(nkey), r)
      continue
    }
    out.push(r)
    if (li) byLinkedin.set(li, r)
    byNameCompanyTitle.set(nkey, r)
  }
  return { records: out, merged }
}

/**
 * Take a raw evidence entry and finalise it into a scored, classified record.
 * Pure: no network. `targetCompany` is the company we are building for.
 */
export function finalizeRecord(raw, targetCompany, nowIso) {
  const sourceUrls = (raw.sourceUrls || []).filter(isValidUrl)
  const independent = independentSourceCount(sourceUrls)
  const companyConfirmed =
    normalizeName(raw.companyName || targetCompany.name).includes(normalizeName(targetCompany.name).split(' ')[0]) ||
    raw.companyConfirmed === true
  const roleConfirmed = isRecruitingTitle(raw.currentTitle)
  const full = isFullName(raw.fullName)
  const { identityStatus, confidence } = scoreIdentity({
    companyConfirmed,
    roleConfirmed,
    independentSources: independent,
    fullName: full,
  })
  const { firstName, lastName } = splitName(raw.fullName)
  const emailStatus = classifyPersonEmail(raw.email, Boolean(raw.emailSourceUrl))
  const email = emailStatus === 'published' ? raw.email : undefined

  return {
    id: raw.id || `${targetCompany.slug}:${normalizeName(raw.fullName).replace(/\s+/g, '-')}:${canonicalLinkedin(raw.linkedinUrl) || independent}`,
    companySlug: targetCompany.slug,
    companyName: targetCompany.name,
    fullName: raw.fullName.trim(),
    firstName,
    lastName,
    currentTitle: raw.currentTitle || undefined,
    department: roleFamily(raw.currentTitle) || undefined,
    location: raw.location || undefined,
    linkedinUrl: raw.linkedinUrl || undefined,
    officialCompanyProfileUrl: raw.officialCompanyProfileUrl || undefined,
    otherPublicSourceUrls: raw.otherPublicSourceUrls || [],
    email,
    emailStatus,
    emailSourceUrl: email ? raw.emailSourceUrl : undefined,
    identityStatus,
    sourceType: raw.sourceType || 'other',
    sourceUrls,
    evidence: raw.evidence || [],
    lastVerifiedAt: raw.lastVerifiedAt || nowIso,
    confidence,
    notes: raw.notes || undefined,
  }
}
