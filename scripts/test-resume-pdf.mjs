/**
 * The PDF renderer, verified the way an ATS reads it.
 *
 * Rendering a PDF proves nothing on its own -- a page of outlined glyphs looks
 * identical to a human and is empty to a parser. So this renders the document
 * and then reads the text layer back out of the PDF itself: it locates the
 * content stream, inflates it, and inspects the text-showing operands.
 *
 * WHY NOT JUST USE pdf-parse
 * --------------------------
 * pdf-parse (which this app uses for uploads) bundles a 2018-era pdf.js that
 * throws "Command token too long" on these files even though they are
 * structurally valid -- correct header, valid xref at the stated offset, 20
 * objects, %%EOF present. Verifying with it would fail for a reason that has
 * nothing to do with whether the resume is readable. Reading the operands
 * directly depends on no parser library at all, so a pass means the text is
 * genuinely in the file rather than that one library happened to cope.
 *
 * The other property guarded here is that the PDF and the LaTeX are rendered
 * from one plan, so every bullet in one is in the other.
 */

import zlib from 'zlib'
import { parseResume } from '../lib/resume/parse.ts'
import { planResume } from '../lib/resume/plan.ts'
import { toLatex } from '../lib/resume/latex.ts'
import { renderPdf } from '../lib/resume/pdf.ts'
import { analyze } from '../lib/resume/analyze.ts'

let pass = 0, fail = 0
const t = (name, ok, detail) => {
  if (ok) { pass++; console.log(`  PASS  ${name}`) }
  else { fail++; console.log(`  FAIL  ${name}`); if (detail !== undefined) console.log('        ', JSON.stringify(detail)?.slice(0, 300)) }
}

/** Concatenated text-showing operands from every content stream. */
function textLayer(buf) {
  const parts = []
  let i = 0
  while (true) {
    const s = buf.indexOf('stream', i)
    if (s < 0) break
    let b = s + 6
    if (buf[b] === 0x0d) b++
    if (buf[b] === 0x0a) b++
    const e = buf.indexOf('endstream', b)
    if (e < 0) break
    const raw = buf.slice(b, e)
    let text
    try { text = zlib.inflateSync(raw).toString('latin1') }
    catch { text = raw.toString('latin1') }
    if (text.includes('Tj') || text.includes('TJ')) {
      for (const op of text.match(/\((?:[^()\\]|\\.)*\)/g) || []) {
        parts.push(op.slice(1, -1).replace(/\\([()\\])/g, '$1'))
      }
    }
    i = e + 9
  }
  return parts.join(' ')
}

const RESUME = `Ashutosh Kumar Singh
Bengaluru, India
ashutosh@example.com | +91 98765 43210
linkedin.com/in/ashutosh

EXPERIENCE
Senior Backend Engineer | FurlPay
Jan 2023 - Present
- Built a distributed rate limiter in Go handling 40k requests per second
- Migrated the settlement ledger to Postgres with zero downtime
- Wrote the Kubernetes operator that manages deployment rollouts
- Ran the office social calendar

Backend Engineer | Acme Corp
Jun 2021 - Dec 2022
- Maintained a Python monolith serving 2M users

EDUCATION
B.Tech Computer Science | Indian Institute of Technology
2017 - 2021

TECHNICAL SKILLS
Languages: Go, Python, TypeScript
Infrastructure: Kubernetes, Docker, Terraform
`

const JOB = `Senior Platform Engineer

Requirements
- Must have strong experience with Kubernetes in production
- 5+ years of backend engineering, ideally in Go
- Proven experience with Postgres at scale
- Experience with Terraform is required
`

const parsed = parseResume(RESUME)
const analysis = analyze({ resumeText: RESUME, job: { text: JOB, title: 'Senior Platform Engineer' } })
const plan = planResume(parsed, analysis, { maxBulletsPerRole: 3 })

const out = await renderPdf(plan)
const buf = Buffer.from(await out.blob.arrayBuffer())
const text = textLayer(buf)
const raw = buf.toString('latin1')

/* ---------------------------- structural validity -------------------------- */
{
  t('produces a non-trivial file', buf.length > 1000, buf.length)
  t('starts with the PDF magic number', raw.slice(0, 5) === '%PDF-', raw.slice(0, 8))
  t('ends with %%EOF', raw.trimEnd().endsWith('%%EOF'))
  t('reports a page count', out.pageCount >= 1, out.pageCount)

  const m = raw.match(/startxref\s+(\d+)/)
  t('declares a startxref offset', !!m, m && m[1])
  t('that offset points at the xref table', !!m && raw.slice(Number(m[1]), Number(m[1]) + 4) === 'xref',
    m && raw.slice(Number(m[1]), Number(m[1]) + 10))
}

/* ------------------- the text layer an ATS actually reads ------------------ */
{
  t('a text layer exists at all', text.length > 50, text.length)
  t('name is in the text layer', /ASHUTOSH KUMAR SINGH/i.test(text), text.slice(0, 120))
  t('email is in the text layer', text.includes('ashutosh@example.com'), text.slice(0, 200))
  t('phone is in the text layer', /98765/.test(text), text.slice(0, 200))
  t('location is in the text layer', /Bengaluru/i.test(text))

  t('section headings are present',
    /EXPERIENCE/i.test(text) && /EDUCATION/i.test(text) && /SKILLS/i.test(text))

  t('employer is present', /FurlPay/i.test(text))
  t('role title is present', /Senior Backend Engineer/i.test(text))
  t('the role date range is present', /Jan 2023 - Present/i.test(text), text.slice(0, 400))
  t('education institution is present', /Indian Institute of Technology/i.test(text))
  t('skills are present', /Kubernetes/i.test(text) && /Terraform/i.test(text))
}

/* --------------------- ligature words survive extraction ------------------- */
{
  // The failure the LaTeX preamble works around with \pdfgentounicode: "fi",
  // "fl" and "ff" collapsing into one glyph and taking the word out of the ATS
  // index. Helvetica with WinAnsi encoding has no such substitution, so these
  // must come back whole.
  const lig = parseResume(
    'Jane Doe\njane@example.com\n\nEXPERIENCE\nEngineer | Acme\n2020 - 2024\n- Improved workflow efficiency for affiliate office staff\n',
  )
  const o2 = await renderPdf(planResume(lig, null, {}))
  const t2 = textLayer(Buffer.from(await o2.blob.arrayBuffer()))

  for (const w of ['workflow', 'efficiency', 'affiliate', 'office']) {
    t(`ligature word "${w}" survives intact`, new RegExp(w, 'i').test(t2), t2.slice(0, 200))
  }
}

/* ------------------ special characters do not break the file --------------- */
{
  const sp = parseResume(
    'Jane Doe\njane@example.com\n\nEXPERIENCE\nEngineer | R&D Lab\n2020 - 2024\n' +
    '- Cut costs 50% and saved $1M across 3_000 items using C++ and C#\n',
  )
  const o3 = await renderPdf(planResume(sp, null, {}))
  const b3 = Buffer.from(await o3.blob.arrayBuffer())
  const t3 = textLayer(b3)
  t('ampersand survives', /R&D/.test(t3), t3.slice(0, 200))
  t('percent and dollar survive', /50%/.test(t3) && /\$1M/.test(t3), t3.slice(0, 200))
  t('C++ and C# survive', /C\+\+/.test(t3) && /C#/.test(t3), t3.slice(0, 200))
  t('the file is still well-formed', b3.toString('latin1').trimEnd().endsWith('%%EOF'))
}

/* ---------------------- the two renderers agree ---------------------------- */
{
  const latex = toLatex(plan)
  const kept = plan.roles.flatMap((r) => r.bullets.map((b) => b.text))
  t('plan kept some bullets', kept.length > 0, kept.length)

  t('every kept bullet appears in the LaTeX',
    kept.every((b) => latex.includes(b.replace(/&/g, '\\&'))),
    kept.map((b) => b.slice(0, 40)))

  t('every kept bullet appears in the PDF text layer',
    kept.every((b) => text.includes(b)),
    kept.map((b) => b.slice(0, 40)))

  const dropped = plan.roles.flatMap((r) => r.dropped.map((d) => d.text))
  t('dropped bullets appear in neither output',
    dropped.every((d) => !latex.includes(d) && !text.includes(d)),
    dropped)
}

/* ------------------------------ prioritisation ----------------------------- */
{
  // The social-calendar bullet evidences nothing, so with a cap of 3 it must
  // lose to the three bullets that do.
  const first = plan.roles[0]
  t('irrelevant bullet was dropped',
    first.dropped.some((d) => /social calendar/i.test(d.text)),
    first.dropped.map((d) => d.text))
  t('Kubernetes bullet was kept',
    first.bullets.some((b) => /Kubernetes/i.test(b.text)),
    first.bullets.map((b) => b.text))
  t('Postgres bullet was kept',
    first.bullets.some((b) => /Postgres/i.test(b.text)),
    first.bullets.map((b) => b.text))
}

/* -------------------------------- degraded --------------------------------- */
{
  const bare = planResume(parseResume('Jane Doe\njane@example.com\n'), null, {})
  const o = await renderPdf(bare)
  const b = Buffer.from(await o.blob.arrayBuffer())
  t('renders a near-empty resume without throwing', b.length > 500, b.length)
  t('and it is still a valid PDF', b.toString('latin1').trimEnd().endsWith('%%EOF'))
}

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail === 0 ? 0 : 1)
