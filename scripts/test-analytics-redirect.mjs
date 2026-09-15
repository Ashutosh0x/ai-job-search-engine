/**
 * Apply-redirect security.
 *
 * /go/job is the one endpoint on this site whose entire job is to send a
 * browser somewhere else, which makes it the one endpoint where a mistake turns
 * a job board into a phishing relay. The structural defence is that the
 * destination is NEVER taken from the request -- the URL carries a job id and
 * the destination is looked up in the index.
 *
 * This file tests the second line: validation of the STORED value. The index is
 * built from third-party ATS responses, so `applyUrl` is untrusted data that
 * happens to live in our own database.
 */
import { isSafeApplyUrl, cleanApplyUrl } from '../lib/analytics/redirect.ts'

let pass = 0, fail = 0
const t = (name, cond, got) => {
  if (cond) { pass++; console.log(`  ok   ${name}`) }
  else { fail++; console.log(`  FAIL ${name}`, got !== undefined ? `-> ${JSON.stringify(got)}` : '') }
}

/* ======================= legitimate destinations ========================= */
// These are the real shapes in the corpus. Breaking any of them breaks Apply
// for thousands of postings, which is a worse and quieter failure than the
// attacks below.
{
  const good = [
    'https://boards.greenhouse.io/stripe/jobs/4567890',
    'https://jobs.lever.co/figma/abc-123',
    'https://jobs.ashbyhq.com/openai/9471b38b-f65c-4a01-9626-bd33fca90f1d',
    'https://accenture.wd103.myworkdayjobs.com/AccentureCareers/job/Bengaluru/Engineer_ATCI-1',
    'https://careers.microsoft.com/us/en/job/1234567',
    'https://www.smartrecruiters.com/DeliveryHero/744000149418279',
    'http://careers.example-employer.com/apply/42',
    'https://jobs.example.co.uk/role?gh_jid=12345&utm_source=x',
    'https://careers.acme.com/apply#section',
  ]
  for (const u of good) t(`accepts ${u.slice(0, 58)}`, isSafeApplyUrl(u), u)
}

/* ============================ open redirect ============================== */
{
  // Credentials in the authority read as the employer to a human and resolve
  // somewhere else in a browser. The classic disguised redirect.
  t('rejects userinfo disguise', !isSafeApplyUrl('https://boards.greenhouse.io@evil.example/x'))
  t('rejects user:pass disguise', !isSafeApplyUrl('https://user:pass@evil.example/x'))

  // Non-http schemes.
  for (const u of [
    'javascript:alert(document.cookie)',
    'data:text/html;base64,PHNjcmlwdD5hbGVydCgxKTwvc2NyaXB0Pg==',
    'file:///etc/passwd',
    'ftp://files.example.com/x',
    'vbscript:msgbox(1)',
    'jar:http://evil.example!/x',
    'chrome://settings',
    'about:blank',
    'intent://evil#Intent;scheme=http;end',
  ]) {
    t(`rejects scheme ${u.split(':')[0]}`, !isSafeApplyUrl(u), u)
  }

  // Protocol-relative and relative forms name no host.
  t('rejects protocol-relative', !isSafeApplyUrl('//evil.example/x'))
  t('rejects a relative path', !isSafeApplyUrl('/admin'))
  t('rejects a bare hostname', !isSafeApplyUrl('evil.example'))
  t('rejects the empty string', !isSafeApplyUrl(''))
  t('rejects whitespace only', !isSafeApplyUrl('   '))
  t('rejects null', !isSafeApplyUrl(null))
  t('rejects undefined', !isSafeApplyUrl(undefined))
  t('rejects a non-string', !isSafeApplyUrl(12345))
}

/* ====================== SSRF-adjacent destinations ======================= */
/**
 * The request here is made by the VICTIM's browser, from inside their network,
 * so a loopback or private address can reach routers, printers and admin panels
 * that the public internet cannot.
 */
{
  for (const u of [
    'http://localhost:3000/admin',
    'http://127.0.0.1/admin',
    'http://127.0.0.1:8080/',
    'http://0.0.0.0/',
    'http://[::1]/admin',
    'http://169.254.169.254/latest/meta-data/',
    'http://metadata.google.internal/computeMetadata/v1/',
    'http://10.0.0.5/internal',
    'http://192.168.1.1/',
    'http://172.16.0.9/',
    'http://172.31.255.254/',
    'http://100.64.0.1/',
    'http://224.0.0.1/',
  ]) {
    t(`rejects ${u.slice(0, 48)}`, !isSafeApplyUrl(u), u)
  }

  // ...while a PUBLIC address that merely looks similar is still fine.
  t('accepts a public 172.32.x address', isSafeApplyUrl('http://172.32.0.1/apply'))
  t('accepts a public 11.x address', isSafeApplyUrl('http://11.0.0.1/apply'))
}

/* ==================== header injection / splitting ======================= */
{
  // A newline in a Location header terminates it early and lets the rest be
  // chosen by whoever controls the value.
  t('rejects an embedded newline', !isSafeApplyUrl('https://ok.example/x\nX-Injected: 1'))
  t('rejects an embedded CR', !isSafeApplyUrl('https://ok.example/x\rX-Injected: 1'))
  t('rejects a CRLF pair', !isSafeApplyUrl('https://ok.example/\r\nSet-Cookie: a=b'))
  t('rejects a NUL byte', !isSafeApplyUrl('https://ok.example/\u0000'))
  t('rejects a DEL byte', !isSafeApplyUrl('https://ok.example/\u007f'))

  /**
   * Control characters are tested MID-STRING.
   *
   * A TRAILING one is a different case: trim() treats vertical tab, form feed
   * and friends as whitespace and removes them, so the value reaching the check
   * is already clean and the resulting URL is genuinely safe. Injection needs
   * the character to survive INSIDE the value, which is what these assert.
   */
  t('rejects a mid-string vertical tab', !isSafeApplyUrl('https://ok.example/a\u000bb'))
  t('rejects a mid-string form feed', !isSafeApplyUrl('https://ok.example/a\u000cb'))
  t('rejects a mid-string escape char', !isSafeApplyUrl('https://ok.example/a\u001bb'))
  t('rejects a mid-string NUL', !isSafeApplyUrl('https://ok.example/a\u0000b'))
  t('a trailing whitespace control char is trimmed, leaving a safe URL',
    isSafeApplyUrl('https://ok.example/path\u000b'))
}

/* ========================= cleaning the URL ============================== */
{
  // Forwarding campaign parameters attributes our traffic to someone else and
  // tells a third party how the visitor arrived.
  const cleaned = cleanApplyUrl(
    'https://jobs.example.com/apply?gh_jid=99&utm_source=jobspark&utm_campaign=x&gclid=abc&fbclid=d',
  )
  t('keeps the parameters the ATS needs', cleaned.includes('gh_jid=99'), cleaned)
  t('strips utm_source', !cleaned.includes('utm_source'), cleaned)
  t('strips utm_campaign', !cleaned.includes('utm_campaign'), cleaned)
  t('strips gclid', !cleaned.includes('gclid'), cleaned)
  t('strips fbclid', !cleaned.includes('fbclid'), cleaned)

  t('drops the fragment', !cleanApplyUrl('https://x.example/a#frag').includes('#'))
  t('leaves a clean URL essentially unchanged',
    cleanApplyUrl('https://boards.greenhouse.io/stripe/jobs/1').startsWith('https://boards.greenhouse.io/stripe/jobs/1'))

  /**
   * The type makes the unsafe case unrepresentable: an invalid URL yields null
   * rather than a string, so a caller cannot use an unvalidated value by
   * forgetting to check first.
   */
  t('returns null for an unsafe URL', cleanApplyUrl('javascript:alert(1)') === null)
  t('returns null for a private address', cleanApplyUrl('http://127.0.0.1/') === null)
  t('returns null for null', cleanApplyUrl(null) === null)
}

/* ============================ case handling ============================== */
{
  t('scheme case is ignored', isSafeApplyUrl('HTTPS://careers.example.com/apply'))
  t('host case is ignored for blocking', !isSafeApplyUrl('http://LOCALHOST/admin'))
  t('uppercase metadata host is blocked', !isSafeApplyUrl('http://169.254.169.254/'))
}

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
