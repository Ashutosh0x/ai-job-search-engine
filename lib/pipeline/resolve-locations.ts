import type { CanonicalJob } from '../sources/types'

/**
 * Second-pass location resolution: settle ambiguous country codes using the
 * corpus as its own gazetteer.
 *
 * THE PROBLEM
 * "Bangalore, IN" is unresolvable from the string alone -- `IN` is both India
 * and Indiana, and both readings are grammatical. Guessing put 210 Bangalore
 * postings in Indiana, United States, which is worse than useless: it is a
 * confident, specific, wrong answer.
 *
 * THE FIX
 * Other postings in the same corpus say "Bangalore, India" outright. So the
 * corpus already contains the evidence needed to settle it -- we just have to
 * look at the whole corpus rather than one row at a time.
 *
 * This pass:
 *   1. Counts city -> country over every UNAMBIGUOUS parse.
 *   2. Revisits each ambiguous row and adopts the majority country for that
 *      city, when the evidence is strong enough.
 *   3. Leaves the default reading in place when there is no evidence, and
 *      reports how many were changed, so the effect is measurable rather than
 *      invisible.
 *
 * No hardcoded city list; adding a new country to the corpus improves
 * resolution automatically.
 */

export interface ResolutionReport {
  ambiguousRows: number
  resolvedRows: number
  unresolvedRows: number
  /** city -> chosen country, for auditing. */
  decisions: { city: string; from: string; to: string; evidence: number; against: number }[]
}

/** Country each ambiguous code maps to when read as a country rather than a state. */
const CODE_AS_COUNTRY: Record<string, string> = {
  IN: 'India', CA: 'Canada', DE: 'Germany', ID: 'Indonesia', LA: 'Laos',
  MO: 'Macao', MD: 'Moldova', AL: 'Albania', MT: 'Malta', PA: 'Panama',
  NE: 'Niger', SC: 'Seychelles', SD: 'Sudan', VA: 'Vatican City',
  MS: 'Montserrat', AR: 'Argentina', CO: 'Colombia', DC: 'District of Columbia',
  IL: 'Israel', KY: 'Cayman Islands', MN: 'Mongolia', NC: 'New Caledonia',
  ND: 'North Dakota', NV: 'Nevada', TN: 'Tunisia', GA: 'Georgia',
}

/** How much more common the alternative must be before we override. */
const EVIDENCE_RATIO = 2

export function resolveAmbiguousLocations(
  jobs: CanonicalJob[]
): { jobs: CanonicalJob[]; report: ResolutionReport } {
  const report: ResolutionReport = {
    ambiguousRows: 0, resolvedRows: 0, unresolvedRows: 0, decisions: [],
  }

  // --- 1. Gather evidence from rows that were never ambiguous.
  const cityCountryCounts = new Map<string, Map<string, number>>()
  for (const job of jobs) {
    const anyJob = job as any
    if (anyJob.locationAmbiguous) continue // do not let a guess vote for itself
    if (!job.city || !job.country) continue
    const key = job.city.toLowerCase()
    const inner = cityCountryCounts.get(key) ?? new Map<string, number>()
    inner.set(job.country, (inner.get(job.country) ?? 0) + 1)
    cityCountryCounts.set(key, inner)
  }

  // --- 2. Decide, per city, once.
  const decisionByCity = new Map<string, string | null>()
  const decide = (city: string, currentCountry: string, code: string): string | null => {
    const key = city.toLowerCase()
    if (decisionByCity.has(key)) return decisionByCity.get(key)!

    const counts = cityCountryCounts.get(key)
    const alternative = CODE_AS_COUNTRY[code]
    let choice: string | null = null

    if (counts && alternative) {
      const forAlt = counts.get(alternative) ?? 0
      const forCurrent = counts.get(currentCountry) ?? 0
      // Require the alternative to be clearly more common, so a couple of
      // stray rows cannot flip a genuinely US city.
      if (forAlt >= 3 && forAlt > forCurrent * EVIDENCE_RATIO) {
        choice = alternative
        report.decisions.push({
          city, from: currentCountry, to: alternative, evidence: forAlt, against: forCurrent,
        })
      }
    }
    decisionByCity.set(key, choice)
    return choice
  }

  // --- 3. Apply.
  const out = jobs.map((job) => {
    const anyJob = job as any
    const code: string | null = anyJob.locationAmbiguous ?? null
    if (!code || !job.city || !job.country) return job

    report.ambiguousRows++
    const resolved = decide(job.city, job.country, code)
    if (!resolved) {
      report.unresolvedRows++
      return job
    }

    report.resolvedRows++
    const display = [job.city, resolved].filter(Boolean).join(', ')
    return {
      ...job,
      // The state reading was wrong, so drop it along with the country.
      state: null,
      country: resolved,
      locationDisplay: display,
      locations: job.locations.map((l, i) =>
        i === 0 ? { ...l, state: null, country: resolved, display } : l
      ),
    }
  })

  return { jobs: out, report }
}
