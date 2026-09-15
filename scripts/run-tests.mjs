/**
 * Run every assertion suite and summarise.
 *
 *   npm test
 *
 * There is no test framework here; each suite is a standalone script that
 * prints "N passed, M failed" and exits non-zero on failure. This runner just
 * executes them and aggregates, so `npm test` means something and a CI job has
 * one command to call.
 *
 * Most suites import extensionless `.ts` paths, which Node's resolver will not
 * follow -- they need `tsx`. `test-job-matching` is plain JS and runs either
 * way, so everything goes through tsx for consistency.
 *
 * Diagnostic scripts (smoke-normalize, test-enterprise, show-examples,
 * benchmark, health-check) are deliberately excluded: they print findings
 * rather than asserting, and several make live network calls.
 *
 * test-oracle-adapter.mjs is excluded for the same reason, and it is worth
 * naming explicitly because it DOES assert. It crawls Nokia's live Oracle
 * board, so it depends on a third party being up and on the board still
 * holding roles. That belongs in a manual check, not in a gate that blocks
 * merges:
 *
 *   npx tsx scripts/test-oracle-adapter.mjs
 *
 * Run it after touching the Oracle adapter or Nokia's board config.
 *
 * scripts/test-radancy-adapter.mjs is excluded for the same reason: it crawls
 * Boeing's live career site. Run it after touching the Radancy adapter --
 * that one parses generated HTML, so a template change on the vendor's side
 * breaks it without any code change here.
 */

import { spawn } from 'child_process'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'

const HERE = dirname(fileURLToPath(import.meta.url))

const SUITES = [
  'test-location.mjs',
  'test-location-filter.mjs',
  'test-index-selection.mjs',
  'test-job-posting-schema.mjs',
  'test-ssr-render.mjs',
  'test-search-recall.mjs',
  'test-search-invariants.mjs',
  'test-search-normalize.mjs',
  'test-diversify.mjs',
  'test-analytics.mjs',
  'test-analytics-redirect.mjs',
  'test-analytics-funnel.mjs',
  'test-retrieval.mjs',
  'test-registry-slugs.mjs',
  'test-merge.mjs',
  'test-hydration.mjs',
  'test-resume.mjs',
  'test-resume-falsepos.mjs',
  'test-resume-build.mjs',
  'test-resume-pdf.mjs',
  'test-route-guard.mjs',
  'test-api-guard.mjs',
  'test-backfill.mjs',
  'test-sponsors.mjs',
  'test-ssrf-guard.mjs',
  'test-intent.mjs',
  'test-job-matching.mjs',
  'test-visa.mjs',
  'test-quality.mjs',
  'test-dedupe.mjs',
  'test-deploy-index.mjs',
  'test-rank.mjs',
  'test-workplace.mjs',
  'test-skills.mjs',
  'test-early-career.mjs',
  'test-parse-query.mjs',
  'test-android-classify.mjs',
  'test-security-roles.mjs',
  'test-pagination.mjs',
  'test-workday-cap.mjs',
  'test-workday-location.mjs',
  'test-workday-identity.mjs',
  'test-keka.mjs',
  'test-html.mjs',
  'test-recruiter-intel.mjs',
  'test-financial-enrichment.mjs',
  'test-rate-limit.mjs',
  'test-saved-searches.mjs',
]

const isWindows = process.platform === 'win32'

function run(suite) {
  return new Promise((resolve) => {
    // Pass a RELATIVE path. `shell: true` is needed for npx on Windows, and the
    // shell re-splits arguments on spaces -- so an absolute path breaks the
    // moment the checkout lives somewhere like "C:\...\Ai Job search engine".
    const child = spawn(
      isWindows ? 'npx.cmd' : 'npx',
      ['tsx', `scripts/${suite}`],
      { cwd: join(HERE, '..'), shell: isWindows }
    )

    let out = ''
    child.stdout.on('data', (d) => (out += d))
    child.stderr.on('data', (d) => (out += d))

    child.on('close', (code) => {
      // Suites report their own tally; trust it over the exit code, but treat a
      // missing tally as a failure rather than silently counting zero.
      const m = out.match(/(\d+) passed, (\d+) failed/)
      resolve({
        suite,
        passed: m ? Number(m[1]) : 0,
        failed: m ? Number(m[2]) : 0,
        crashed: !m,
        code,
        out,
      })
    })
  })
}

const results = []
for (const suite of SUITES) {
  const r = await run(suite)
  results.push(r)

  const name = suite.replace(/^test-|\.mjs$/g, '').padEnd(16)
  if (r.crashed) {
    console.log(`  CRASH  ${name} exit ${r.code}`)
  } else if (r.failed > 0) {
    console.log(`  FAIL   ${name} ${r.passed} passed, ${r.failed} failed`)
  } else {
    console.log(`  ok     ${name} ${r.passed} passed`)
  }
}

const passed = results.reduce((s, r) => s + r.passed, 0)
const failed = results.reduce((s, r) => s + r.failed, 0)
const crashed = results.filter((r) => r.crashed)

console.log(
  `\n${passed} assertions passed, ${failed} failed, ` +
    `${results.length - crashed.length}/${results.length} suites ran`
)

// Print the output of anything that went wrong -- a summary with no detail is
// not actionable.
for (const r of results.filter((x) => x.crashed || x.failed > 0)) {
  console.log(`\n--- ${r.suite} ---\n${r.out.trim()}`)
}

process.exit(failed === 0 && crashed.length === 0 ? 0 : 1)
