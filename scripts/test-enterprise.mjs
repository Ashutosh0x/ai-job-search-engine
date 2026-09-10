const { getAdapter } = await import('../lib/sources/registry.ts')
const targets = [
  { source:'eightfold', token:'hsbc', companyName:'HSBC', companyDomain:'hsbc.com' },
  { source:'custom', token:'amazon', companyName:'Amazon', companyDomain:'amazon.com' },
  { source:'workday', token:'walmart', site:'WalmartExternal', host:'walmart.wd504.myworkdayjobs.com', companyName:'Walmart' },
  { source:'workday', token:'cba', site:'CommBank_Careers', host:'cba.wd3.myworkdayjobs.com', companyName:'Commonwealth Bank' },
]
for (const t of targets) {
  const a = getAdapter(t.source, t.token)
  if (!a) { console.log(`  NO ADAPTER  ${t.companyName}`); continue }
  const r = await a.fetchJobs(t, { maxPages: 2 })
  const j = r.jobs[0]
  console.log(`  ${String(r.jobs.length).padStart(4)} jobs  ${t.companyName.padEnd(20)} via ${a.displayName}`)
  if (j) {
    console.log(`         "${j.title.slice(0,52)}"`)
    console.log(`         loc: ${j.locationRaw} | posted: ${j.postedAt?.slice(0,10) ?? '-'}`)
    console.log(`         ${j.applicationUrl.slice(0,88)}`)
  }
  if (r.warnings.length) console.log(`         warnings: ${r.warnings.slice(0,2).join('; ')}`)
}
