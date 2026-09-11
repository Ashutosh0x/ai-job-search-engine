import { deduplicate, normalizeTitle, normalizeUrl, jaccard } from '../lib/pipeline/dedupe.ts'

let pass=0, fail=0
const t=(n,c,g)=>{ if(c){pass++;console.log('  PASS  '+n)} else {fail++;console.log('  FAIL  '+n+'  got: '+JSON.stringify(g))} }

const base = (over={}) => ({
  id: over.id ?? Math.random().toString(36).slice(2),
  sourceId: over.sourceId ?? 'x', source: over.source ?? 'greenhouse',
  company: 'Acme', companyDomain: 'acme.com', companySlug: 'acme',
  title: over.title ?? 'Senior Software Engineer',
  normalizedTitle: normalizeTitle(over.title ?? 'Senior Software Engineer'),
  description: over.description ?? 'Build distributed systems in Go and Kubernetes.',
  locationRaw: null, locationDisplay: null,
  city: over.city ?? 'San Francisco', state: 'California', country: 'United States',
  locationType: 'onsite', locations: [],
  remote: over.remote ?? false, hybrid: false, onsite: true,
  employmentType: null, seniority: null, department: over.department ?? 'Engineering', team: null,
  salaryMin: over.salaryMin ?? null, salaryMax: null, salaryCurrency: null,
  postedAt: over.postedAt ?? '2026-09-01T00:00:00.000Z', updatedAt: null,
  firstSeenAt: '2026-09-01T00:00:00.000Z', lastSeenAt: '2026-09-10T00:00:00.000Z',
  lastVerifiedAt: null,
  applicationUrl: over.applicationUrl ?? 'https://boards.greenhouse.io/acme/jobs/1',
  canonicalUrl: over.canonicalUrl ?? 'https://boards.greenhouse.io/acme/jobs/1',
  sourceUrls: over.sourceUrls ?? [], sourceTypes: over.sourceTypes ?? [],
  isDirectApplication: over.isDirectApplication ?? true,
  skills: over.skills ?? [], technologies: [],
  companyValuationUsd: null, status: 'OPEN',
  freshnessScore: 0, sourceConfidence: over.sourceConfidence ?? 0.98,
  duplicateConfidence: 0, canonicalJobId: null, isRepost: false, contentHash: 'h',
  requisitionKey: over.requisitionKey ?? null,
})

console.log('\nnormalizeTitle')
t('order-insensitive', normalizeTitle('Engineer, Backend')===normalizeTitle('Backend Engineer'), normalizeTitle('Engineer, Backend'))
t('strips seniority noise', normalizeTitle('Senior Software Engineer')===normalizeTitle('Software Engineer'), null)
t('strips (m/w/d)', normalizeTitle('Software Engineer (m/w/d)')===normalizeTitle('Software Engineer'), null)
t('strips trailing req id', normalizeTitle('Data Engineer - 12345')===normalizeTitle('Data Engineer'), null)

console.log('\nnormalizeUrl')
t('drops utm params', normalizeUrl('https://x.com/a?utm_source=li&b=1')===normalizeUrl('https://x.com/a?b=1'), normalizeUrl('https://x.com/a?utm_source=li&b=1'))
t('drops www + trailing slash', normalizeUrl('https://www.x.com/a/')===normalizeUrl('https://x.com/a'), null)

console.log('\nTIER 1 requisition id')
{
  const r = deduplicate([
    base({id:'a', requisitionKey:'acme|greenhouse|REQ-1'}),
    base({id:'b', requisitionKey:'acme|greenhouse|REQ-1', applicationUrl:'https://other.com/z'}),
  ])
  t('same req id collapses to one', r.jobs.length===1, r.jobs.length)
  t('counted as requisition tier', r.tierCounts.requisition===1, r.tierCounts)
}

console.log('\nTIER 2 identical URL after normalisation')
{
  const r = deduplicate([
    base({id:'a', applicationUrl:'https://boards.greenhouse.io/acme/jobs/7'}),
    base({id:'b', applicationUrl:'https://boards.greenhouse.io/acme/jobs/7?utm_source=linkedin'}),
  ])
  t('tracking-param twin collapses', r.jobs.length===1, r.jobs.length)
}

console.log('\nTIER 3/4 cross-source same job')
{
  const direct = base({id:'gh', source:'greenhouse', sourceConfidence:0.98, isDirectApplication:true,
    applicationUrl:'https://boards.greenhouse.io/acme/jobs/9'})
  const agg = base({id:'agg', source:'search', sourceConfidence:0.70, isDirectApplication:false,
    applicationUrl:'https://www.linkedin.com/jobs/view/9', title:'Software Engineer, Senior'})
  const r = deduplicate([direct, agg])
  t('same job from two sources collapses', r.jobs.length===1, r.jobs.length)
  t('direct application wins as canonical', r.jobs[0].isDirectApplication===true, r.jobs[0].applicationUrl)
  t('aggregator url preserved in sourceUrls', r.jobs[0].sourceUrls.some(u=>u.includes('linkedin')), r.jobs[0].sourceUrls)
  t('both source types recorded', r.jobs[0].sourceTypes.length>=2, r.jobs[0].sourceTypes)
}

console.log('\nMust NOT merge genuinely different jobs')
{
  const sf = base({id:'sf', city:'San Francisco', applicationUrl:'https://boards.greenhouse.io/acme/jobs/100'})
  const ldn = base({id:'ldn', city:'London', applicationUrl:'https://boards.greenhouse.io/acme/jobs/101'})
  const r = deduplicate([sf, ldn])
  t('same title different city stays separate', r.jobs.length===2, r.jobs.length)
}
{
  const a = base({id:'a', title:'Software Engineer', description:'Frontend React work.', applicationUrl:'https://boards.greenhouse.io/acme/jobs/200'})
  const b = base({id:'b', title:'Product Manager', description:'Own the roadmap.', applicationUrl:'https://boards.greenhouse.io/acme/jobs/201'})
  const r = deduplicate([a,b])
  t('different roles stay separate', r.jobs.length===2, r.jobs.length)
}

console.log('\nMerging fills gaps')
{
  const thin = base({id:'thin', sourceConfidence:0.99, salaryMin:null, department:null,
    requisitionKey:'acme|greenhouse|R9'})
  const rich = base({id:'rich', sourceConfidence:0.60, salaryMin:150000, department:'Platform',
    requisitionKey:'acme|greenhouse|R9'})
  const r = deduplicate([thin, rich])
  t('salary filled from the lesser source', r.jobs[0].salaryMin===150000, r.jobs[0].salaryMin)
}


/* -------------------- degenerate requisition ids ---------------------- */
//
// Regression: Greenhouse's `requisition_id` is free text the employer fills in.
// Airbnb puts the literal string "ONE" in it, so tier 1 -- which treats a
// shared requisition as definitive -- collapsed 167 distinct roles into 12 and
// the employer disappeared from the index with no error anywhere.
console.log('\ndegenerate requisition ids')
{
  const shared = 'airbnb|greenhouse|ONE'
  const many = [
    base({ id: 'a', title: 'Account Manager',    requisitionKey: shared, city: 'London',  applicationUrl: 'https://x.com/1' }),
    base({ id: 'b', title: 'Data Scientist',     requisitionKey: shared, city: 'Berlin',  applicationUrl: 'https://x.com/2' }),
    base({ id: 'c', title: 'Complex Claims Lead', requisitionKey: shared, city: 'Toronto', applicationUrl: 'https://x.com/3' }),
  ]
  const r = deduplicate(many)
  t('different roles sharing one req id are NOT merged', r.jobs.length === 3, r.jobs.length)
  t('the bad key is reported, not silently handled', r.degenerateRequisitionKeys === 1, r.degenerateRequisitionKeys)

  // The legitimate case tier 1 exists for must still work: one requisition,
  // one role, several locations.
  const multiLocation = [
    base({ id: 'd', title: 'Staff Engineer', requisitionKey: 'acme|greenhouse|R-4821', city: 'Austin',  applicationUrl: 'https://x.com/4' }),
    base({ id: 'e', title: 'Staff Engineer', requisitionKey: 'acme|greenhouse|R-4821', city: 'Chicago', applicationUrl: 'https://x.com/5' }),
  ]
  const r2 = deduplicate(multiLocation)
  t('one real requisition across locations still merges', r2.jobs.length === 1, r2.jobs.length)
  t('and is not flagged degenerate', r2.degenerateRequisitionKeys === 0, r2.degenerateRequisitionKeys)
}

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail===0?0:1)
