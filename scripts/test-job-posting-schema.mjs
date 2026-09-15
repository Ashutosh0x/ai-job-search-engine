/**
 * JobPosting structured-data tests.
 *
 * Google reads this markup as a factual claim by the publisher, so the rule
 * that matters most is the one about when NOT to emit: a posting missing a
 * required field gets no schema rather than a schema with a guessed value.
 *
 * Measured over the 113,416-posting served index, only 34.8% qualify. These
 * tests pin that gate, the enum mapping (an invalid token invalidates the whole
 * block), and the TELECOMMUTE rule.
 */
const { jobPostingSchema, meetsRequiredFields, employmentTypeToken, validCurrency } =
  await import('../lib/seo/job-posting.ts')

let pass = 0, fail = 0
const t = (name, cond, got) => {
  if (cond) { pass++; console.log(`  ok   ${name}`) }
  else { fail++; console.log(`  FAIL ${name}`, got !== undefined ? `-> ${JSON.stringify(got)}` : '') }
}

const DESCRIPTION =
  'We are hiring a platform engineer to build and operate our data infrastructure at scale.'

/** A posting that meets every requirement; cases below remove one at a time. */
const base = () => ({
  externalId: 'greenhouse:acme:123',
  provider: 'greenhouse',
  companySlug: 'acme',
  companyName: 'Acme',
  companyDomain: 'acme.com',
  title: 'Platform Engineer',
  location: 'London, United Kingdom',
  department: 'Engineering',
  employmentType: 'Full-time',
  isRemote: false,
  descriptionText: DESCRIPTION,
  postedAt: '2026-09-01T00:00:00.000Z',
  applyUrl: 'https://acme.com/jobs/123',
  salaryMin: 90000,
  salaryMax: 120000,
  salaryCurrency: 'GBP',
  city: 'London',
  region: 'England',
  country: 'United Kingdom',
  skills: ['kubernetes', 'go'],
  isDirectApplication: true,
})

const company = { slug: 'acme', name: 'Acme', domain: 'acme.com', logoUrl: 'https://logo/acme.png' }

/* --------------------------- the eligibility gate ------------------------- */
{
  t('a complete posting is eligible', meetsRequiredFields(base()))

  t('no description -> not eligible',
    !meetsRequiredFields({ ...base(), descriptionText: '' }))
  t('a description under 50 chars -> not eligible',
    !meetsRequiredFields({ ...base(), descriptionText: 'Too short.' }))
  t('no postedAt -> not eligible',
    !meetsRequiredFields({ ...base(), postedAt: null }))
  t('an unparseable postedAt -> not eligible',
    !meetsRequiredFields({ ...base(), postedAt: 'not a date' }))
  t('no location and not remote -> not eligible',
    !meetsRequiredFields({ ...base(), city: null, country: null, isRemote: false }))
  t('remote with no city still IS eligible',
    meetsRequiredFields({ ...base(), city: null, country: null, isRemote: true }))

  t('an ineligible posting produces NO schema at all',
    jobPostingSchema({ ...base(), postedAt: null }, company) === null)
}

/* ------------------------------ the payload ------------------------------- */
{
  const s = jobPostingSchema(base(), company)
  t('emits a JobPosting', s?.['@type'] === 'JobPosting')
  t('carries the schema.org context', s?.['@context'] === 'https://schema.org')
  t('title is the posting title', s.title === 'Platform Engineer')
  t('description is the posting text', s.description === DESCRIPTION)
  t('datePosted is ISO 8601', s.datePosted === '2026-09-01T00:00:00.000Z')
  t('hiringOrganization names the employer', s.hiringOrganization.name === 'Acme')
  t('hiringOrganization links the domain', s.hiringOrganization.sameAs === 'https://acme.com')
  t('identifier carries the stable pipeline id', s.identifier.value === 'greenhouse:acme:123')
  t('jobLocation uses the normalised city', s.jobLocation.address.addressLocality === 'London')
  t('jobLocation uses the normalised country', s.jobLocation.address.addressCountry === 'United Kingdom')
  t('directApply reflects the application route', s.directApply === true)
  t('skills are a comma-joined string, as the spec wants', s.skills === 'kubernetes, go')
  t('occupationalCategory comes from department', s.occupationalCategory === 'Engineering')
}

/* ------------------------------ TELECOMMUTE ------------------------------- */
// Claiming both "anywhere" and a specific city about one job is a contradiction.
{
  const placed = jobPostingSchema(base(), company)
  t('a non-remote placed role is not TELECOMMUTE', placed.jobLocationType === undefined)

  const hybrid = jobPostingSchema({ ...base(), isRemote: true }, company)
  t('remote WITH a city does not claim TELECOMMUTE', hybrid.jobLocationType === undefined)
  t('remote WITH a city still states the place', hybrid.jobLocation.address.addressLocality === 'London')

  const anywhere = jobPostingSchema(
    { ...base(), isRemote: true, city: null, region: null, country: null },
    company,
  )
  t('remote with NO place claims TELECOMMUTE', anywhere.jobLocationType === 'TELECOMMUTE')
  t('and states no jobLocation', anywhere.jobLocation === undefined)
}

/* --------------------------- employmentType enum -------------------------- */
// An unrecognised token invalidates the whole block, so unmapped free text is
// dropped rather than passed through.
{
  t('"Full-time" -> FULL_TIME', employmentTypeToken('Full-time') === 'FULL_TIME')
  t('"full time" -> FULL_TIME', employmentTypeToken('full time') === 'FULL_TIME')
  t('"Regular Full-Time" -> FULL_TIME', employmentTypeToken('Regular Full-Time') === 'FULL_TIME')
  t('"Part Time" -> PART_TIME', employmentTypeToken('Part Time') === 'PART_TIME')
  t('"Contractor" -> CONTRACTOR', employmentTypeToken('Contractor') === 'CONTRACTOR')
  t('"Fixed Term" -> TEMPORARY', employmentTypeToken('Fixed Term') === 'TEMPORARY')
  t('"Internship" -> INTERN', employmentTypeToken('Internship') === 'INTERN')
  t('null stays null', employmentTypeToken(null) === null)
  t('an unmappable value is dropped, not invented', employmentTypeToken('CDI') === null)
  t('a dropped employmentType is simply absent',
    jobPostingSchema({ ...base(), employmentType: 'CDI' }, company).employmentType === undefined)
}

/* -------------------------------- salary ---------------------------------- */
{
  const s = jobPostingSchema(base(), company)
  t('baseSalary carries the currency', s.baseSalary.currency === 'GBP')
  t('baseSalary carries min', s.baseSalary.value.minValue === 90000)
  t('baseSalary carries max', s.baseSalary.value.maxValue === 120000)
  t('no unitText is invented', s.baseSalary.value.unitText === undefined)

  t('ISO 4217 only', validCurrency('USD') === 'USD')
  t('a non-ISO code is rejected', validCurrency('Dollars') === null)
  t('null currency is rejected', validCurrency(null) === null)

  t('no salary -> no baseSalary',
    jobPostingSchema({ ...base(), salaryMin: null, salaryMax: null }, company).baseSalary === undefined)
  t('a figure with no valid currency is NOT published',
    jobPostingSchema({ ...base(), salaryCurrency: 'dollars' }, company).baseSalary === undefined)
}

/* ------------------------- serialises without markup ---------------------- */
// The page escapes "<" before writing the block; this checks the payload also
// survives a description that tries to close the script tag.
{
  const nasty = jobPostingSchema(
    { ...base(), descriptionText: `${DESCRIPTION} </script><img src=x onerror=alert(1)>` },
    company,
  )
  const serialised = JSON.stringify(nasty).replace(/</g, '\\u003c')
  t('no raw "<" survives serialisation', !serialised.includes('<'))
  t('no closing script tag survives', !serialised.includes('</script'))
  t('and it still parses back to the same object',
    JSON.parse(serialised.replace(/\\u003c/g, '<')).title === 'Platform Engineer')
}

/* ------------------------- absent optionals stay absent ------------------- */
{
  const bare = jobPostingSchema(
    {
      ...base(),
      department: null,
      skills: [],
      salaryMin: null,
      salaryMax: null,
      salaryCurrency: null,
      employmentType: null,
      companyDomain: '',
    },
    null,
  )
  t('a bare posting still emits valid schema', bare?.['@type'] === 'JobPosting')
  t('no skills key when there are none', bare.skills === undefined)
  t('no occupationalCategory when there is no department', bare.occupationalCategory === undefined)
  t('no logo when there is no company record', bare.hiringOrganization.logo === undefined)
  t('no sameAs when there is no domain', bare.hiringOrganization.sameAs === undefined)
}

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
