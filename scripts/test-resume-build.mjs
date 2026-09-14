/**
 * Structured resume parsing and ATS-safe LaTeX generation.
 *
 * The properties that matter here are not "does it produce output" but:
 *   - sections are found by heading, so a sentence containing "experience"
 *     is not mistaken for the Experience heading
 *   - concurrent roles do not double-count toward total experience
 *   - LaTeX escaping cannot break the document or leak into math mode
 *   - the generator NEVER emits prose the candidate did not write
 *
 * That last one is the product's whole credibility, so it is checked
 * mechanically rather than trusted.
 */

import { parseResume, parseDateRange, splitSkillLine, isBullet } from '../lib/resume/parse.ts'
import { buildLatex, tex, scoreBullet, findFabrications, collapseSubPhrases } from '../lib/resume/latex.ts'
import { analyze } from '../lib/resume/analyze.ts'

let pass = 0, fail = 0
const t = (name, ok, detail) => {
  if (ok) { pass++; console.log(`  PASS  ${name}`) }
  else { fail++; console.log(`  FAIL  ${name}`); if (detail !== undefined) console.log('        ', JSON.stringify(detail)?.slice(0, 320)) }
}

const RESUME = `Ashutosh Kumar Singh
Bengaluru, India
ashutosh@example.com | +91 98765 43210
linkedin.com/in/ashutosh | github.com/ashutosh0x

SUMMARY
Backend engineer with 5 years of experience building payment systems.

EXPERIENCE
Senior Backend Engineer | FurlPay
Jan 2023 - Present
- Built a distributed rate limiter in Go handling 40k requests per second
- Migrated the settlement ledger to Postgres with zero downtime
- Wrote the Kubernetes operator that manages deployment rollouts
- Mentored two junior engineers through their first on-call rotation

Backend Engineer | Acme Corp
Jun 2021 - Dec 2022
- Maintained a Python monolith serving 2M users
- Added Redis caching that cut p99 latency by 60%

EDUCATION
B.Tech Computer Science | Indian Institute of Technology
2017 - 2021

TECHNICAL SKILLS
Languages: Go, Python, TypeScript, Rust
Infrastructure: Kubernetes, Docker, Terraform, AWS
Databases: Postgres, Redis, DynamoDB
`

const JOB = `Senior Platform Engineer

About the role
We are looking for a platform engineer to own our infrastructure.

Requirements
- Must have strong experience with Kubernetes in production
- 5+ years of backend engineering, ideally in Go
- Proven experience with Postgres at scale
- Experience with Terraform is required

Nice to have
- Familiarity with Rust
- Exposure to payment systems
`

/* --------------------------------- dates ---------------------------------- */
{
  const a = parseDateRange('Jan 2023 - Present')
  t('parses a current range', a?.current === true && a.startYear === 2023, a)

  const b = parseDateRange('Jun 2021 - Dec 2022')
  t('parses a closed range', b?.startYear === 2021 && b?.endYear === 2022, b)
  t('computes months with both endpoints', b?.months === 19, b)

  const c = parseDateRange('2017 - 2021')
  t('parses a year-only range', c?.startYear === 2017 && c?.endYear === 2021, c)

  t('rejects a line with no range', parseDateRange('Built a thing') === null)

  const d = parseDateRange('March 2020 – July 2021')
  t('handles en dash and full month names', d?.startYear === 2020 && d?.endYear === 2021, d)
}

/* ------------------------------- headings --------------------------------- */
{
  const p = parseResume(RESUME)
  const kinds = p.sections.map((s) => s.kind)
  t('finds the experience section', kinds.includes('experience'), kinds)
  t('finds the education section', kinds.includes('education'), kinds)
  t('finds the skills section', kinds.includes('skills'), kinds)
  t('finds the summary section', kinds.includes('summary'), kinds)

  // The regression the old extractor had: a sentence containing "experience"
  // was treated as the section heading.
  const tricky = parseResume(
    'Jane Doe\njane@example.com\n\nSUMMARY\n5 years of experience building payment systems at scale.\n\nEXPERIENCE\nEngineer | Acme\n2020 - 2024\n- Did a thing\n',
  )
  const expSec = tricky.sections.find((s) => s.kind === 'experience')
  t('a sentence containing "experience" is not a heading',
    expSec && expSec.lines.join(' ').includes('Did a thing') && !expSec.lines.join(' ').includes('5 years of experience building'),
    expSec?.lines)
}

/* ------------------------------- contact ---------------------------------- */
{
  const p = parseResume(RESUME)
  t('extracts the name', p.contact.name === 'Ashutosh Kumar Singh', p.contact.name)
  t('extracts the email', p.contact.email === 'ashutosh@example.com', p.contact.email)
  t('extracts an international phone', /98765/.test(p.contact.phone ?? ''), p.contact.phone)
  t('extracts the location', p.contact.location === 'Bengaluru, India', p.contact.location)
  t('finds the linkedin link', p.contact.links.some((l) => l.kind === 'linkedin'), p.contact.links)
  t('finds the github link', p.contact.links.some((l) => l.kind === 'github'), p.contact.links)

  // A year range must never be read as a phone number.
  const p2 = parseResume('Jane Doe\n2017 - 2021\njane@example.com\n')
  t('a year range is not a phone number', p2.contact.phone === null, p2.contact.phone)
}

/* ------------------------------ experience -------------------------------- */
{
  const p = parseResume(RESUME)
  t('finds both roles', p.experience.length === 2, p.experience.map((e) => e.headerLine))
  t('splits title from organization',
    p.experience[0].title === 'Senior Backend Engineer' && p.experience[0].organization === 'FurlPay',
    p.experience[0])
  t('attaches the date line following the header',
    p.experience[0].dates?.current === true, p.experience[0].dates)
  t('collects bullets under the right role',
    p.experience[0].bullets.length === 4 && p.experience[1].bullets.length === 2,
    p.experience.map((e) => e.bullets.length))
  t('bullets are stripped of their marker',
    !p.experience[0].bullets[0].startsWith('-'), p.experience[0].bullets[0])
}

/* ------------------------- concurrent roles ------------------------------- */
{
  // Two overlapping roles: summing gives 48 months, the union gives 36.
  const overlap = parseResume(
    'Jane Doe\njane@example.com\n\nEXPERIENCE\nEngineer | A\nJan 2020 - Dec 2021\n- did a\n\nAdvisor | B\nJan 2021 - Dec 2022\n- did b\n',
  )
  const months = overlap.totalExperienceMonths
  t('does not double-count concurrent roles', months === 36, { months, expected: 36 })
}

/* -------------------------------- skills ---------------------------------- */
{
  t('drops the category label', splitSkillLine('Languages: Go, Python, Rust').join(',') === 'Go,Python,Rust',
    splitSkillLine('Languages: Go, Python, Rust'))
  t('keeps multi-word skills intact',
    splitSkillLine('ML: machine learning, computer vision').includes('machine learning'),
    splitSkillLine('ML: machine learning, computer vision'))

  const p = parseResume(RESUME)
  t('collects skills across category lines', p.skills.includes('Go') && p.skills.includes('Terraform'), p.skills)
  t('deduplicates skills', new Set(p.skills).size === p.skills.length)
}

/* ------------------------------- escaping --------------------------------- */
{
  t('escapes ampersand', tex('R&D') === 'R\\&D', tex('R&D'))
  t('escapes percent', tex('99% uptime') === '99\\% uptime', tex('99% uptime'))
  t('escapes underscore', tex('user_id') === 'user\\_id', tex('user_id'))
  t('escapes dollar', tex('$5M ARR') === '\\$5M ARR', tex('$5M ARR'))
  t('escapes hash', tex('C# developer') === 'C\\# developer', tex('C# developer'))

  // Backslash must be handled first, or its replacement gets re-escaped.
  const bs = tex('a\\b')
  t('escapes backslash without cascading', bs === 'a\\textbackslash{}b', bs)

  // Combined: the case that breaks naive implementations.
  const combo = tex('50% of $1M & 3_000 items #1 C++')
  t('escapes a combined string compilably',
    !/(^|[^\\])[&%$#_]/.test(combo), combo)

  t('normalises smart quotes', tex('“quoted”') === '"quoted"', tex('“quoted”'))
  t('normalises an em dash', tex('a—b') === 'a--b', tex('a—b'))
}

/* ------------------------------- ranking ---------------------------------- */
{
  const reqs = [
    { normalized: 'kubernetes', term: 'Kubernetes', importance: 0.9 },
    { normalized: 'go', term: 'Go', importance: 0.7 },
    { normalized: 'postgres', term: 'Postgres', importance: 0.5 },
  ]
  const k = scoreBullet('Wrote the Kubernetes operator that manages rollouts', reqs)
  t('scores a matching bullet above zero', k.score > 0, k)
  t('names the matched requirement', k.matched.includes('Kubernetes'), k.matched)

  const none = scoreBullet('Organised the office party', reqs)
  t('scores an unrelated bullet at zero', none.score === 0, none)

  // Word-boundary matching: "Go" must not match "Google" or "going".
  const goog = scoreBullet('Interned at Google going to meetings', reqs)
  t('does not match Go inside Google', !goog.matched.includes('Go'), goog.matched)

  const real = scoreBullet('Built a service in Go', reqs)
  t('does match Go as a word', real.matched.includes('Go'), real.matched)
}

/* ------------------------------ generation -------------------------------- */
{
  const p = parseResume(RESUME)
  const a = analyze({ resumeText: RESUME, job: { text: JOB, title: 'Senior Platform Engineer' } })
  const r = buildLatex(p, a, { maxBulletsPerRole: 3 })

  t('emits a complete document',
    r.latex.includes('\\begin{document}') && r.latex.includes('\\end{document}'))
  t('emits the ATS unicode map', r.latex.includes('\\pdfgentounicode=1'))
  t('uses standard section names',
    r.latex.includes('\\section{Experience}') && r.latex.includes('\\section{Education}'))
  t('puts the name in the body, not a header',
    r.latex.includes('Ashutosh Kumar Singh') && !r.latex.includes('\\fancyhead'))
  t('uses hfill for dates rather than a table',
    r.latex.includes('\\hfill') && !r.latex.includes('\\begin{tabular}'))
  t('respects the bullet cap',
    r.decisions[0].keptBullets.length <= 3, r.decisions[0].keptBullets.length)
  t('records why a bullet was dropped',
    r.decisions[0].droppedBullets.every((d) => typeof d.reason === 'string' && d.reason.length > 0),
    r.decisions[0].droppedBullets)
  t('promotes the Kubernetes bullet into the kept set',
    r.decisions[0].keptBullets.some((b) => /Kubernetes/.test(b.text)),
    r.decisions[0].keptBullets.map((b) => b.text))

  // Every brace that opens must close, or the document will not compile.
  //
  // Scanned character by character rather than with a regex: a pattern like
  // /(^|[^\\])\{/ consumes the preceding character, so in "{{" only the first
  // brace is counted and the check reports a false imbalance.
  let depth = 0, minDepth = 0
  for (let i = 0; i < r.latex.length; i++) {
    if (r.latex[i] === '\\') { i++; continue }   // skip the escaped character
    if (r.latex[i] === '{') depth++
    else if (r.latex[i] === '}') { depth--; minDepth = Math.min(minDepth, depth) }
  }
  t('braces balance', depth === 0, { depth })
  t('no brace closes before it opens', minDepth === 0, { minDepth })
}

/* --------------------------- no fabrication -------------------------------- */
{
  const p = parseResume(RESUME)
  const a = analyze({ resumeText: RESUME, job: { text: JOB, title: 'Senior Platform Engineer' } })
  const r = buildLatex(p, a, { maxBulletsPerRole: 4 })

  const invented = findFabrications(r.latex, p)
  t('generates no prose the candidate did not write', invented.length === 0, invented.slice(0, 12))

  // The detector must actually be capable of failing, or the check above is
  // worthless -- a test that cannot fail proves nothing.
  const tampered = r.latex.replace('\\end{document}',
    '\\resumeItem{Led a team of eight engineers across three continents}\n\\end{document}')
  const caught = findFabrications(tampered, p)
  t('the fabrication detector catches inserted prose',
    caught.some((w) => /continents|eight/i.test(w)), caught.slice(0, 10))
}

/* ------------------------- unevidenced requirements ------------------------ */
{
  const thin = parseResume(
    'Jane Doe\njane@example.com\n\nEXPERIENCE\nEngineer | Acme\n2020 - 2024\n- Wrote Python scripts\n\nTECHNICAL SKILLS\nLanguages: Python\n',
  )
  const a = analyze({ resumeText: 'Jane Doe\nWrote Python scripts\nPython', job: { text: JOB, title: 'Senior Platform Engineer' } })
  const r = buildLatex(thin, a, {})
  t('reports requirements the resume cannot evidence',
    r.unevidencedRequirements.length > 0, r.unevidencedRequirements.slice(0, 8))
  t('does not claim an unevidenced requirement in the document',
    !/kubernetes/i.test(r.latex), r.latex.slice(0, 200))
}

/* ----------------------------- degraded input ------------------------------ */
{
  const empty = parseResume('')
  t('empty input does not throw', Array.isArray(empty.sections))
  t('empty input reports a warning', empty.warnings.length > 0, empty.warnings)

  const noHeadings = parseResume('Jane Doe\njane@example.com\nDid some things at a company')
  t('flags a document with no recognisable headings',
    noHeadings.warnings.some((w) => /no section headings/i.test(w)), noHeadings.warnings)

  const r = buildLatex(parseResume(RESUME), null, {})
  t('builds without a target job', r.latex.includes('\\begin{document}'))
  t('says nothing was prioritised without a job',
    r.warnings.some((w) => /paste a job description/i.test(w)), r.warnings)
}

/* --------------------------- phrase collapsing ----------------------------- */
{
  // The extractor emits overlapping windows; showing all of them as separate
  // gaps is noise. This is the real list it produced for one Kafka bullet.
  const raw = ['event', 'event streaming', 'kafka', 'kafka event', 'scale', 'rust']
  const c = collapseSubPhrases(raw)
  t('drops fragments covered by a longer phrase',
    !c.includes('event') && !c.includes('kafka'), c)
  t('keeps the covering phrases', c.includes('kafka event') && c.includes('event streaming'), c)
  t('keeps unrelated single terms', c.includes('scale') && c.includes('rust'), c)
  t('preserves posting order', c.indexOf('event streaming') < c.indexOf('scale'), c)

  // Word-level, not substring: "go" must survive alongside "golang".
  const g = collapseSubPhrases(['go', 'golang'])
  t('does not swallow a word inside a longer word', g.includes('go') && g.includes('golang'), g)
}

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail === 0 ? 0 : 1)
