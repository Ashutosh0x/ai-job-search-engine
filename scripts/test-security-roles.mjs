/**
 * Security role classification.
 *
 * Almost every engineering description mentions security -- "write secure
 * code", "SOC 2", "partner with the security team". A classifier that counts
 * those produces a facet containing most of the index. So most of these
 * assertions are about what must NOT be classified as a security role.
 */

import { classifySecurity, SECURITY_CATEGORIES } from '../lib/pipeline/security-roles.ts'

let pass = 0, fail = 0
const t = (name, ok, detail) => {
  if (ok) { pass++; console.log(`  PASS  ${name}`) }
  else { fail++; console.log(`  FAIL  ${name}`); if (detail !== undefined) console.log('        ', JSON.stringify(detail)?.slice(0, 200)) }
}
const cat = (title, d = '') => classifySecurity(title, d)?.category ?? 'NON_SECURITY'

/* --------------------------------- core ----------------------------------- */
{
  for (const title of [
    'Security Engineer', 'Senior Security Engineer', 'Staff Security Engineer',
    'Principal Security Engineer', 'Security Software Engineer',
    'Product Security Engineer', 'Application Security Engineer',
    'Cloud Security Engineer', 'Infrastructure Security Engineer',
    'Security Architect', 'Security Researcher', 'Cybersecurity Engineer',
  ]) {
    t(`"${title}" is SECURITY_CORE`, cat(title) === 'SECURITY_CORE', classifySecurity(title))
  }
  t('"Cyber Security Engineer" (spaced)', cat('Cyber Security Engineer') === 'SECURITY_CORE')
  t('AppSec', cat('AppSec Engineer') === 'SECURITY_CORE')
  t('vulnerability research', cat('Vulnerability Researcher') === 'SECURITY_CORE')
  t('penetration testing', cat('Penetration Tester') === 'SECURITY_CORE')
  t('cryptography', cat('Cryptography Engineer') === 'SECURITY_CORE')
}

/* ----------------------------- cybersecurity ------------------------------- */
{
  t('detection engineer', cat('Detection Engineer') === 'CYBERSECURITY')
  t('threat intelligence', cat('Threat Intelligence Analyst') === 'CYBERSECURITY')
  t('incident response', cat('Incident Response Engineer') === 'CYBERSECURITY')
  t('security operations', cat('Security Operations Engineer') === 'CYBERSECURITY')
  t('red team', cat('Red Team Operator') === 'CYBERSECURITY')
  t('offensive security', cat('Offensive Security Engineer') === 'CYBERSECURITY')
  t('malware analysis', cat('Malware Researcher') === 'CYBERSECURITY')
}

/* -------------------------- privacy and safety ----------------------------- */
{
  t('privacy engineering', cat('Privacy Engineer') === 'PRIVACY_SECURITY')
  t('trust & safety engineering', cat('Trust and Safety Engineer') === 'SAFETY_SECURITY')
  t('integrity engineering', cat('Integrity Engineer') === 'SAFETY_SECURITY')
  t('anti-abuse engineering', cat('Anti-Abuse Engineer') === 'SAFETY_SECURITY')
  // "Integrity Engineering" is trust & safety at some employers, but these
  // are unrelated engineering disciplines that share the word. Measured on
  // the live index: the first rule flagged an HPE signal-integrity manager.
  t('Signal Integrity is NOT trust & safety',
    classifySecurity('Networking Signal Integrity Engineering Manager') === null,
    classifySecurity('Networking Signal Integrity Engineering Manager'))
  t('Data Integrity Engineer is NOT trust & safety',
    classifySecurity('Data Integrity Engineer') === null)
  t('Structural Integrity Engineer is NOT trust & safety',
    classifySecurity('Structural Integrity Engineer') === null)
  t('fraud engineering', cat('Fraud Detection Engineer') === 'SAFETY_SECURITY')
}

/* ------------------- the false positives that matter ----------------------- */
{
  // "security" in the title for a reason that is not security engineering.
  t('Security Guard is not a security ENGINEERING role',
    classifySecurity('Security Guard') === null, classifySecurity('Security Guard'))
  t('Physical Security Manager', classifySecurity('Physical Security Manager') === null)
  t('Security Sales Engineer sells the product',
    classifySecurity('Security Sales Engineer') === null, classifySecurity('Security Sales Engineer'))
  t('Recruiter, Security hires for the team',
    classifySecurity('Technical Recruiter, Security') === null)
  t('Information Security Auditor is audit, not engineering',
    classifySecurity('Information Security Auditor') === null)
  t('Security GRC is governance, not engineering',
    classifySecurity('Staff Security GRC Engineer') === null,
    classifySecurity('Staff Security GRC Engineer'))

  // Ordinary engineering roles that merely mention security.
  t('a backend role mentioning secure coding is not security',
    cat('Senior Backend Engineer', 'Write secure code and follow security best practices.') === 'NON_SECURITY',
    classifySecurity('Senior Backend Engineer', 'Write secure code.'))
  t('one incidental signal is not enough',
    cat('Platform Engineer', 'You will use TLS between services.') === 'NON_SECURITY')
  t('SOC 2 compliance alone is not a security role',
    cat('Engineering Manager', 'We maintain SOC 2 compliance.') === 'NON_SECURITY')

  // Plain non-security roles.
  for (const title of ['Staff Data Scientist', 'Product Manager', 'Accountant', 'Android Engineer']) {
    t(`"${title}" is not security`, classifySecurity(title) === null)
  }
}

/* ----------------------- description-based escalation ---------------------- */
{
  // Three concrete signals in an engineering role earns SECURITY_RELATED.
  const r = classifySecurity('Senior Platform Engineer',
    'You will run threat modeling, triage CVEs, and work with our bug bounty programme.')
  t('three concrete signals escalate an engineering role',
    r?.category === 'SECURITY_RELATED', r)
  t('escalation is low confidence', r?.confidence === 'low', r)
  t('reports the signals it found', (r?.signals ?? []).length >= 3, r?.signals)

  // Same description, non-engineering title -> not a security role.
  t('a non-engineering title does not escalate',
    classifySecurity('Office Manager', 'threat modeling CVE bug bounty') === null)
}

/* -------------------------------- evidence --------------------------------- */
{
  const r = classifySecurity('Application Security Engineer', 'OWASP, Burp, SAST and DAST.')
  t('reports the term that fired', typeof r.term === 'string' && r.term.length > 2, r)
  t('reports where it matched', r.field === 'title', r)
  t('title matches are high confidence', r.confidence === 'high', r)
  t('collects security signals', r.signals.includes('owasp') && r.signals.includes('sast'), r.signals)
  t('all categories reachable', SECURITY_CATEGORIES.length === 5, SECURITY_CATEGORIES)
}

/* -------------------------------- degraded --------------------------------- */
{
  t('empty title', classifySecurity('') === null)
  t('whitespace title', classifySecurity('   ') === null)
  t('undefined input', classifySecurity(undefined, undefined) === null)
  t('missing description', classifySecurity('Security Engineer', undefined)?.category === 'SECURITY_CORE')
}

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail === 0 ? 0 : 1)
