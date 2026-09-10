import { canonicalCountryName, isCountryName, stripFacilityDecoration } from '../location'
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

  /** Rows that had a city but no country at all. */
  orphanRows: number
  /** Filled because the "city" is itself an ISO country/territory. */
  filledAsCityState: number
  /** Filled from corpus evidence about that city. */
  filledFromEvidence: number
  /** Left alone because the evidence was too thin to trust. */
  orphansLeftUnfilled: number
  /** City names cleaned of legal-entity / facility decoration. */
  citiesCleaned: number
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
    orphanRows: 0, filledAsCityState: 0, filledFromEvidence: 0,
    orphansLeftUnfilled: 0, citiesCleaned: 0,
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

  return { jobs: fillMissingCountries(out, report), report }
}

/* -------------------------- missing-country backfill ------------------------ */

/**
 * Fill in the country for rows that have a city and no country.
 *
 * Bank ATS feeds are full of these: NatWest writes "Bangalore", MUFG writes
 * "Mufg Global Service Private Ltd. - Bengaluru (bcit)". Both are plainly in
 * India, and both were invisible to a country filter -- 47% of one bank crawl
 * had a city but no country.
 *
 * Two rules, in order of confidence:
 *
 *   1. The "city" is itself an ISO region. Singapore, Hong Kong, Luxembourg and
 *      Macao are city-states or territories, so the country is not being
 *      inferred at all -- it is already written in the field.
 *
 *   2. Corpus evidence, under a deliberately strict gate. The naive version of
 *      this rule is dangerous: a plain majority vote assigned Hong Kong to
 *      SINGAPORE on the strength of three mislabelled rows. So a fill requires
 *      MIN_EVIDENCE rows AND DOMINANCE of the vote, and rule 1 runs first so
 *      that territories never reach the vote at all.
 *
 * Anything that fails both rules keeps its null country and is counted, so the
 * remaining gap stays visible instead of being papered over.
 */
const MIN_EVIDENCE = 5
const DOMINANCE = 0.8

function fillMissingCountries(
  jobs: CanonicalJob[],
  report: ResolutionReport
): CanonicalJob[] {
  // Evidence only from rows that already have both parts.
  const evidence = new Map<string, Map<string, number>>()
  for (const j of jobs) {
    if (!j.city || !j.country) continue
    const key = j.city.toLowerCase()
    const inner = evidence.get(key) ?? new Map<string, number>()
    inner.set(j.country, (inner.get(j.country) ?? 0) + 1)
    evidence.set(key, inner)
  }

  const voteCache = new Map<string, string | null>()
  const vote = (city: string): string | null => {
    const key = city.toLowerCase()
    if (voteCache.has(key)) return voteCache.get(key)!
    const counts = evidence.get(key)
    let choice: string | null = null
    if (counts) {
      const total = [...counts.values()].reduce((a, b) => a + b, 0)
      const [best, n] = [...counts].sort((a, b) => b[1] - a[1])[0]
      if (n >= MIN_EVIDENCE && n / total >= DOMINANCE) choice = best
    }
    voteCache.set(key, choice)
    return choice
  }

  return jobs.map((job) => {
    // Clean the city name regardless of whether the country is known, so the
    // same office stops appearing as several different cities.
    let city = job.city
    let cleaned = false
    if (city) {
      const stripped = stripFacilityDecoration(city)
      if (stripped !== city) { city = stripped; cleaned = true; report.citiesCleaned++ }
    }

    if (!city) return job
    if (job.country) return cleaned ? withCity(job, city) : job

    report.orphanRows++

    // Rule 1: the city is itself a country or territory. Store the canonical
    // spelling so "Hong Kong" and "Hong Kong SAR China" do not become two
    // separate entries in the country facet.
    const asRegion = canonicalCountryName(city)
    if (asRegion) {
      report.filledAsCityState++
      return withCity(job, city, asRegion)
    }

    // Rule 2: corpus evidence, strictly gated.
    const voted = vote(city)
    if (voted) {
      report.filledFromEvidence++
      return withCity(job, city, voted)
    }

    report.orphansLeftUnfilled++
    return cleaned ? withCity(job, city) : job
  })
}

/** Rewrite city (and optionally country), keeping display strings consistent. */
function withCity(job: CanonicalJob, city: string, country?: string): CanonicalJob {
  const nextCountry = country ?? job.country
  const display = [city, job.state, nextCountry].filter(Boolean).join(', ')
  return {
    ...job,
    city,
    country: nextCountry,
    locationDisplay: display,
    locations: job.locations.map((l, i) =>
      i === 0 ? { ...l, city, country: nextCountry, display } : l
    ),
  }
}
