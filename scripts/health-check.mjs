/** Health of every registered ATS adapter (§26 healthCheck, §24 observability). */
const { healthCheckAll, adapterIds } = await import('../lib/sources/registry.ts')
console.log(`Registered adapters: ${adapterIds().join(', ')}\n`)
const results = await healthCheckAll()
results.sort((a,b)=> Number(b.healthy)-Number(a.healthy) || (a.latencyMs??0)-(b.latencyMs??0))
for (const r of results) {
  const mark = r.healthy ? 'UP  ' : 'DOWN'
  console.log(`  ${mark} ${String(r.source).padEnd(16)} ${String(r.latencyMs ?? '-').padStart(6)}ms  ${r.error ?? ''}`)
}
const up = results.filter(r=>r.healthy).length
console.log(`\n${up}/${results.length} platforms reachable`)
