const { httpGet } = await import('../lib/sources/http.ts')
const url='https://www.amazon.jobs/en/search.json?result_limit=100&offset=0&sort=recent'
for (const hdrs of [ {}, {'User-Agent':'Mozilla/5.0 (compatible; JobSparkAI/1.0)'}, {'User-Agent':'Mozilla/5.0','Accept':'application/json'} ]) {
  const r = await httpGet(url, { headers: hdrs, retries: 0, cacheTtlMs: 0 })
  let n='-'
  try { n = (JSON.parse(r.body).jobs||[]).length } catch(e){ n='parse:'+String(e.message).slice(0,30) }
  console.log(`  status=${r.status} len=${String(r.body.length).padStart(7)} jobs=${n}  hdrs=${JSON.stringify(hdrs).slice(0,60)}`)
}
