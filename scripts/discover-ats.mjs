/**
 * Find which ATS an employer actually uses, by reading their careers page.
 *
 *   node scripts/discover-ats.mjs targets.json
 *
 * Guessing tokens is cheap and wrong often enough to matter -- bulk-probe.mjs
 * resolved 2 of 14 employers from plausible guesses. The remaining twelve were
 * not missing; they were on providers or hosts nobody would guess: Nokia's
 * Oracle pod is `fa-evmr-saasfaprod1`, not `fa-eomz`; Cisco and AMD are on
 * Phenom, not Workday; Qualcomm's Eightfold tenant is `qualcomm.eightfold.ai`.
 *
 * So this reads the page instead of guessing. It follows the careers URL,
 * looks for the fingerprints each vendor leaves in the HTML (CDN hosts, API
 * paths, tenant names), and reports what it found along with the evidence, so
 * a human can check the inference rather than trust it.
 *
 * It reports findings only. Nothing enters the registry until an endpoint has
 * actually returned live postings.
 */

import { readFileSync } from 'fs'

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0 Safari/537.36'
const TIMEOUT = 25_000

async function get(url, init = {}) {
  const ctl = new AbortController()
  const t = setTimeout(() => ctl.abort(), TIMEOUT)
  try {
    const r = await fetch(url, {
      redirect: 'follow',
      signal: ctl.signal,
      ...init,
      // Workday's search is a POST with a JSON body, so callers need to pass
      // method/headers/body through rather than only ever issuing a GET.
      headers: { 'user-agent': UA, accept: 'text/html,application/json,*/*', ...(init.headers || {}) },
    })
    return { ok: r.ok, status: r.status, url: r.url, text: await r.text() }
  } catch (e) {
    return { ok: false, status: 0, url, text: '', error: String(e.message || e) }
  } finally {
    clearTimeout(t)
  }
}

/**
 * Vendor fingerprints.
 *
 * Each returns the detail needed to build an API call, not merely the vendor
 * name -- "it's Workday" is useless without the tenant and site.
 */
const FINGERPRINTS = [
  {
    vendor: 'workday',
    test: (html, url) => {
      const m = (url + html).match(/([a-z0-9-]+\.wd\d+\.myworkdayjobs\.com)\/(?:[a-z-]+\/)?([A-Za-z0-9_-]+)/)
      return m ? { host: m[1], site: m[2], token: `${m[1]}|${m[2]}` } : null
    },
  },
  {
    vendor: 'oracle',
    test: (html, url) => {
      // Oracle pods are not all named alike. The first version required
      // `fa-<x>-saasfaprod<n>.fa.ocs.oraclecloud.com`, which is Nokia's shape
      // and missed Fortinet's `edel.fa.us2.oraclecloud.com` entirely. Match any
      // oraclecloud host, then take the site number wherever it appears.
      const host = (url + html).match(/([a-z0-9-]+\.fa\.[a-z0-9.]*oraclecloud\.com)/i)
      const site =
        (url + html).match(/\/sites\/(CX(?:_\d+)?)/) ||
        html.match(/siteNumber["'= ]+(CX(?:_\d+)?)/)
      return host && site ? { host: host[1], site: site[1], token: `${host[1]}|${site[1]}` } : null
    },
  },
  {
    vendor: 'workday',
    // Declared twice on purpose: the entry above catches the canonical
    // myworkdayjobs URL, this one catches a tenant named only in page script.
    test: (html, url) => {
      const m = (url + html).match(/([a-z0-9-]+\.wd\d+\.myworkdayjobs\.com)/)
      if (!m) return null
      const site =
        html.match(/myworkdayjobs\.com\/(?:[a-z-]+\/)?([A-Za-z0-9_-]{2,40})(?:["'/?]|$)/)
      return site ? { host: m[1], site: site[1], token: `${m[1]}|${site[1]}` } : null
    },
  },
  {
    vendor: 'eightfold',
    test: (html, url) => {
      const m = (url + html).match(/([a-z0-9-]+\.eightfold\.ai)/)
      return m ? { host: m[1], token: m[1] } : null
    },
  },
  {
    vendor: 'phenom',
    test: (html, url) => {
      if (!/phenompeople\.com|CareerConnectResources/.test(html)) return null
      try { return { host: new URL(url).host, token: new URL(url).host } } catch { return null }
    },
  },
  {
    vendor: 'greenhouse',
    test: (html) => {
      const m = html.match(/(?:boards|job-boards)\.greenhouse\.io\/([a-z0-9_-]+)/i)
      return m ? { token: m[1] } : null
    },
  },
  {
    vendor: 'lever',
    test: (html) => {
      const m = html.match(/jobs\.lever\.co\/([a-z0-9_-]+)/i)
      return m ? { token: m[1] } : null
    },
  },
  {
    vendor: 'ashby',
    test: (html) => {
      const m = html.match(/jobs\.ashbyhq\.com\/([a-z0-9_.-]+)/i)
      return m ? { token: m[1] } : null
    },
  },
  {
    vendor: 'smartrecruiters',
    test: (html) => {
      const m = html.match(/jobs\.smartrecruiters\.com\/([A-Za-z0-9_-]+)/)
      return m ? { token: m[1] } : null
    },
  },
  {
    vendor: 'icims',
    test: (html, url) => {
      const m = (url + html).match(/([a-z0-9-]+)\.icims\.com/i)
      return m ? { host: `${m[1]}.icims.com`, token: m[1] } : null
    },
  },
  {
    vendor: 'successfactors',
    test: (html, url) => {
      const m = (url + html).match(/([a-z0-9-]+)\.successfactors\.(com|eu)/i)
      return m ? { host: m[0], token: m[1] } : null
    },
  },
]

/** Does the discovered endpoint actually return postings? */
const VERIFY = {
  async greenhouse(f) {
    const r = await get(`https://boards-api.greenhouse.io/v1/boards/${f.token}/jobs`)
    if (!r.ok) return null
    const d = JSON.parse(r.text)
    return d.jobs?.length ? { count: d.jobs.length, sample: d.jobs[0]?.title } : null
  },
  async lever(f) {
    const r = await get(`https://api.lever.co/v0/postings/${f.token}?mode=json`)
    if (!r.ok) return null
    const d = JSON.parse(r.text)
    return Array.isArray(d) && d.length ? { count: d.length, sample: d[0]?.text } : null
  },
  async ashby(f) {
    const r = await get(`https://api.ashbyhq.com/posting-api/job-board/${f.token}`)
    if (!r.ok) return null
    const d = JSON.parse(r.text)
    return d.jobs?.length ? { count: d.jobs.length, sample: d.jobs[0]?.title } : null
  },
  async smartrecruiters(f) {
    const r = await get(`https://api.smartrecruiters.com/v1/companies/${f.token}/postings?limit=100`)
    if (!r.ok) return null
    const d = JSON.parse(r.text)
    return d.content?.length ? { count: d.totalFound ?? d.content.length, sample: d.content[0]?.name } : null
  },
  async oracle(f) {
    const url =
      `https://${f.host}/hcmRestApi/resources/latest/recruitingCEJobRequisitions` +
      `?onlyData=true&expand=requisitionList&finder=findReqs;siteNumber=${f.site},limit=10,offset=0`
    const r = await get(url)
    if (!r.ok) return null
    const d = JSON.parse(r.text)
    const item = d.items?.[0]
    const rows = item?.requisitionList ?? []
    return rows.length ? { count: item?.TotalJobsCount ?? rows.length, sample: rows[0]?.Title } : null
  },
  /**
   * Workday. Its search is a POST, which is why the first version of this file
   * FOUND eight Workday tenants and verified none of them -- there was simply
   * no verifier for the vendor it detected most often.
   *
   * The site segment in a careers URL is frequently wrong (a locale, a vanity
   * path), so a failed site is retried against the handful of names Workday
   * tenants actually use before the tenant is written off.
   */
  async workday(f) {
    const tenant = f.host.split('.')[0]
    const candidates = [...new Set([f.site, 'External', 'Careers', 'External_Career_Site',
                                    `${tenant}careers`, `${tenant}_careers`, 'Search'])]
    for (const site of candidates) {
      if (!site) continue
      const r = await get(`https://${f.host}/wday/cxs/${tenant}/${site}/jobs`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ appliedFacets: {}, limit: 20, offset: 0, searchText: '' }),
      })
      if (!r.ok) continue
      try {
        const d = JSON.parse(r.text)
        const jobs = d.jobPostings ?? []
        if (jobs.length) {
          return { count: d.total ?? jobs.length, sample: jobs[0]?.title, site, token: `${f.host}|${site}` }
        }
      } catch { /* not JSON */ }
    }
    return null
  },
  async eightfold(f) {
    const domain = f.host.replace('.eightfold.ai', '.com')
    const r = await get(`https://${f.host}/api/apply/v2/jobs?domain=${domain}&start=0&num=10`)
    if (!r.ok) return null
    let d
    try { d = JSON.parse(r.text) } catch { return null }
    if (d.message) return null            // e.g. "Not authorized for PCSX"
    return d.positions?.length ? { count: d.count ?? d.positions.length, sample: d.positions[0]?.name } : null
  },
  async phenom(f) {
    // Phenom's public search endpoint. Tenants vary in path, so try the two
    // that cover most deployments before giving up.
    for (const path of ['/widgets/jobs', '/api/jobs']) {
      const r = await get(`https://${f.host}${path}?from=0&size=10`)
      if (!r.ok) continue
      try {
        const d = JSON.parse(r.text)
        const jobs = d.jobs ?? d.refineSearch?.data?.jobs ?? d.eagerLoadRefineSearch?.data?.jobs ?? []
        if (jobs.length) return { count: d.totalCount ?? jobs.length, sample: jobs[0]?.title, path }
      } catch { /* not JSON */ }
    }
    return null
  },
}

const targets = JSON.parse(readFileSync(process.argv[2], 'utf8'))
console.log(`discovering ${targets.length} employers\n`)

const resolved = []
const unresolved = []

for (const t of targets) {
  const page = await get(t.careers)
  if (!page.ok) {
    console.log(`  ??  ${t.name.padEnd(26)} careers page ${page.status || page.error}`)
    unresolved.push({ ...t, reason: `careers page ${page.status || page.error}` })
    continue
  }

  const found = []
  for (const fp of FINGERPRINTS) {
    const hit = fp.test(page.text, page.url)
    if (hit) found.push({ vendor: fp.vendor, ...hit })
  }

  if (!found.length) {
    console.log(`  --  ${t.name.padEnd(26)} no ATS fingerprint (landed ${page.url})`)
    unresolved.push({ ...t, reason: 'no fingerprint', landed: page.url })
    continue
  }

  let verified = null
  for (const f of found) {
    const v = VERIFY[f.vendor]
    if (!v) continue
    try {
      const live = await v(f)
      if (live) { verified = { ...f, ...live }; break }
    } catch { /* try the next fingerprint */ }
  }

  if (verified) {
    console.log(
      `  OK  ${t.name.padEnd(26)} ${verified.vendor.padEnd(16)} ${String(verified.count).padStart(6)} jobs  ${verified.token}`,
    )
    resolved.push({ ...t, ...verified })
  } else {
    const vendors = found.map((f) => `${f.vendor}(${f.token})`).join(' ')
    console.log(`  XX  ${t.name.padEnd(26)} found ${vendors} but none returned postings`)
    unresolved.push({ ...t, reason: 'fingerprint found, endpoint returned nothing', found: vendors })
  }
}

console.log(`\n${resolved.length}/${targets.length} verified live\n`)
if (resolved.length) {
  console.log('--- registry lines ---')
  for (const r of resolved) {
    const board =
      r.vendor === 'oracle' || r.vendor === 'workday'
        ? `{ provider: '${r.vendor}', token: '${r.host.split('.')[0]}', site: '${r.site}', host: '${r.host}' }`
        : `{ provider: '${r.vendor}', token: '${r.token}' }`
    console.log(`  // ${r.name}: ${r.count} jobs, verified`)
    console.log(`  { slug: '${r.slug}', name: '${r.name}', domain: '${r.domain}', valuationKind: 'unknown',`)
    console.log(`    boards: [${board}] },`)
  }
}
if (unresolved.length) {
  console.log('\n--- unresolved ---')
  for (const u of unresolved) console.log(`  ${u.name.padEnd(26)} ${u.reason}`)
}
