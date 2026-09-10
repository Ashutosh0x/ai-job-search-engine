const url='https://www.amazon.jobs/en/search.json?result_limit=100&offset=0&sort=recent'
const r = await fetch(url, { headers:{'User-Agent':'Mozilla/5.0'} })
console.log('status', r.status)
for (const [k,v] of r.headers) if (/encoding|length|type|transfer/i.test(k)) console.log('  ',k,'=',v)
const buf = Buffer.from(await r.arrayBuffer())
console.log('arrayBuffer bytes:', buf.length)
console.log('first 80:', JSON.stringify(buf.subarray(0,80).toString('utf8')))
console.log('last 60 :', JSON.stringify(buf.subarray(-60).toString('utf8')))
