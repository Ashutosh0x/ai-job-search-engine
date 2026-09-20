/** robots.txt policy regression tests for CustomSiteAdapter. */
import { parseRobots, robotsDecision } from '../lib/sources/robots.ts'

let pass = 0
let fail = 0
const t = (name, ok, detail) => {
  if (ok) { pass++; console.log(`  PASS  ${name}`) }
  else { fail++; console.log(`  FAIL  ${name}`); if (detail !== undefined) console.log('        ', JSON.stringify(detail)) }
}

{
  const policy = parseRobots(`
    User-agent: *
    Disallow: /

    User-agent: JobSparkAI
    Disallow: /internal/
    Allow: /internal/public/
    Sitemap: https://careers.example.com/jobs.xml
  `, 'JobSparkAI/1.0 (+https://example.com)')

  t('uses the named crawler group instead of the wildcard fallback',
    robotsDecision(policy, 'https://careers.example.com/jobs/123').allowed)
  t('blocks a named disallow rule',
    !robotsDecision(policy, 'https://careers.example.com/internal/roles').allowed)
  t('uses the more-specific allow rule',
    robotsDecision(policy, 'https://careers.example.com/internal/public/roles').allowed)
  t('keeps sitemap declarations outside groups',
    policy.sitemaps[0] === 'https://careers.example.com/jobs.xml', policy.sitemaps)
}

{
  const policy = parseRobots(`
    User-agent: *
    Disallow: /jobs/*/draft$
    Allow: /jobs/public/
  `, 'JobSparkAI/1.0')

  t('supports wildcard rules and end anchors',
    !robotsDecision(policy, 'https://example.com/jobs/42/draft').allowed)
  t('does not overmatch past an end anchor',
    robotsDecision(policy, 'https://example.com/jobs/42/draft/history').allowed)
  t('uses Allow when rules tie in specificity',
    robotsDecision(parseRobots('User-agent: *\nDisallow: /jobs\nAllow: /jobs', 'JobSparkAI/1.0'), 'https://example.com/jobs').allowed)
}

{
  const policy = parseRobots('User-agent: *\nDisallow:', 'JobSparkAI/1.0')
  t('treats an empty Disallow as no restriction',
    robotsDecision(policy, 'https://example.com/anything').allowed)
  t('rejects malformed URLs conservatively',
    !robotsDecision(policy, 'not a url').allowed)
}

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail === 0 ? 0 : 1)
