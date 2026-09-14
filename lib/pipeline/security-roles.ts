/**
 * Security and cybersecurity role classification.
 *
 * WHY "security" IN THE TEXT IS NOT ENOUGH
 * ----------------------------------------
 * Almost every engineering job description mentions security. "Write secure
 * code", "follow security best practices", "partner with the security team",
 * "SOC 2 compliance" -- none of those make a role a security role. Counting
 * them does not produce a security facet, it produces a facet containing most
 * of the index.
 *
 * The inverse trap is just as real. These are NOT security engineering roles
 * even though the word is central to them:
 *
 *   Security Guard                    physical security
 *   Information Security Auditor      audit/compliance, not engineering
 *   Security Sales Engineer           sells the product
 *   Recruiter, Security               hires for the team
 *   Physical Security Manager         facilities
 *
 * So the title decides the category, the description only escalates confidence,
 * and a set of exclusions vetoes titles that carry the word for another reason.
 *
 * Deterministic and evidence-carrying, matching lib/pipeline/early-career.ts:
 * every result names the term that fired so a human can check it.
 */

export type SecurityCategory =
  | 'SECURITY_CORE'      // building or breaking security systems
  | 'CYBERSECURITY'      // threat/detection/IR/offensive operations
  | 'PRIVACY_SECURITY'   // privacy engineering
  | 'SAFETY_SECURITY'    // trust & safety, abuse, fraud, integrity
  | 'SECURITY_RELATED'   // engineering role with substantive security scope
  | 'NON_SECURITY'

export interface SecurityMatch {
  category: SecurityCategory
  /** The term that fired, as written in the vocabulary. */
  term: string
  field: 'title' | 'description'
  confidence: 'high' | 'medium' | 'low'
  /** Security technologies/practices named anywhere in the posting. */
  signals: string[]
}

/* ------------------------------ vocabulary -------------------------------- */

/** Title patterns that make a role security engineering outright. */
const TITLE_CORE: [RegExp, string][] = [
  [/\b(product|application|app|cloud|infrastructure|platform|network|data|hardware|firmware)\s+security\s+(engineer|engineering)\b/i, 'domain security engineer'],
  [/\bsecurity\s+(software\s+)?engineer(ing)?\b/i, 'security engineer'],
  [/\bsecurity\s+architect\b/i, 'security architect'],
  [/\bsecurity\s+researcher?\b/i, 'security researcher'],
  [/\bcyber\s?security\s+(engineer|analyst|specialist|architect)\b/i, 'cybersecurity engineer'],
  [/\bappsec\b/i, 'appsec'],
  [/\bcryptograph(er|y)\s+(engineer)?\b/i, 'cryptography'],
  [/\b(vulnerability|exploit)\s+(research|researcher|engineer)\b/i, 'vulnerability research'],
  [/\bpenetration\s+tester?\b|\bpentester\b/i, 'penetration testing'],
]

const TITLE_CYBER: [RegExp, string][] = [
  [/\b(threat|detection)\s+(engineer|engineering|researcher|analyst|intelligence)\b/i, 'threat/detection'],
  [/\bincident\s+response\b|\bIR\s+engineer\b/i, 'incident response'],
  [/\bsecurity\s+operations?\b|\bsoc\s+analyst\b/i, 'security operations'],
  [/\b(red|blue|purple)\s+team\b/i, 'red/blue team'],
  [/\b(offensive|defensive)\s+security\b/i, 'offensive/defensive security'],
  [/\bmalware\s+(analyst|researcher|engineer)\b/i, 'malware analysis'],
  [/\bforensics?\b/i, 'forensics'],
]

const TITLE_PRIVACY: [RegExp, string][] = [
  [/\bprivacy\s+(engineer|engineering|architect)\b/i, 'privacy engineering'],
  [/\bdata\s+protection\s+engineer\b/i, 'data protection engineering'],
]

const TITLE_SAFETY: [RegExp, string][] = [
  [/\btrust\s*(&|and)?\s*safety\s+(engineer|engineering)\b/i, 'trust & safety engineering'],
  // "Integrity Engineering" means trust & safety at some employers, but
  // "Signal Integrity", "Data Integrity" and "Structural Integrity" are
  // unrelated engineering disciplines. Measured: this rule was classifying
  // "Networking Signal Integrity Engineering Manager" as a safety role.
  [/(^|[^a-z])(?<!signal |data |structural |mechanical |material )integrity\s+(engineer|engineering)\b/i, 'integrity engineering'],
  [/\b(abuse|fraud|anti[- ]?fraud|anti[- ]?abuse)\s+(engineer|engineering|detection)\b/i, 'abuse/fraud engineering'],
]

/**
 * Titles carrying "security" for a reason that is not security engineering.
 *
 * Checked before everything else, because "Security Sales Engineer" matches
 * the security-engineer pattern and is a sales role.
 */
const NOT_SECURITY_ENGINEERING = [
  /\bsecurity\s+(guard|officer|patrol|attendant)\b/i,
  /\bphysical\s+security\b/i,
  /\bsecurity\s+(sales|account)\b/i,
  /\b(sales|account|marketing|recruit\w*|talent|legal|counsel|hr|people)\b.*\bsecurity\b/i,
  /\bsecurity\b.*\b(recruiter|recruiting|marketing|sales representative|account executive)\b/i,
  /\b(auditor|audit|compliance|grc|governance)\b/i,
]

/** Security technologies. Presence is evidence; absence is not disproof. */
const SIGNALS = [
  'owasp', 'burp', 'metasploit', 'nmap', 'wireshark', 'siem', 'splunk', 'edr', 'xdr',
  'soc 2', 'iso 27001', 'nist', 'mitre att&ck', 'cve', 'cvss', 'threat model',
  'threat modeling', 'threat modelling', 'penetration test', 'pentest', 'red team',
  'blue team', 'reverse engineering', 'fuzzing', 'static analysis', 'sast', 'dast',
  'cryptography', 'tls', 'pki', 'zero trust', 'iam', 'siem', 'vulnerability',
  'exploit', 'malware', 'incident response', 'forensics', 'bug bounty',
]

const wordRe = (term: string) =>
  new RegExp(`(^|[^a-z0-9+#&])${term.replace(/[+#&]/g, '\\$&')}([^a-z0-9+#&]|$)`, 'i')

const IS_ENGINEERING = /\b(engineer|engineering|developer|architect|researcher|analyst|scientist)\b/i

/* ------------------------------- matching --------------------------------- */

export function classifySecurity(title: string, description = ''): SecurityMatch | null {
  const t = (title || '').trim()
  if (!t) return null
  const d = (description || '').slice(0, 3000)
  const hay = `${t} ${d}`

  // Signal matching tolerates ordinary English suffixes. Postings say "triage
  // CVEs" and "threat modeling", not "triage CVE" and "threat model"; a strict
  // word boundary missed both and pushed a genuinely security-heavy role below
  // the three-signal threshold.
  const signalRe = (term: string) =>
    new RegExp(
      `(^|[^a-z0-9+#&])${term.replace(/[+#&]/g, '\\$&')}(s|es|ing|ed)?([^a-z0-9+#&]|$)`,
      'i',
    )
  const signals = SIGNALS.filter((s) => signalRe(s).test(hay))

  // Veto first: a title can carry "security" for reasons that are not this.
  if (NOT_SECURITY_ENGINEERING.some((re) => re.test(t))) return null

  // Order is load-bearing. The specific vocabularies run BEFORE the generic
  // "security engineer" rule, because "Offensive Security Engineer" matches
  // both and the specific reading is the useful one. Safety runs before cyber
  // so "Fraud Detection Engineer" reads as fraud rather than as detection.
  const byTitle: [typeof TITLE_CORE, SecurityCategory][] = [
    [TITLE_SAFETY, 'SAFETY_SECURITY'],
    [TITLE_PRIVACY, 'PRIVACY_SECURITY'],
    [TITLE_CYBER, 'CYBERSECURITY'],
    [TITLE_CORE, 'SECURITY_CORE'],
  ]
  for (const [rules, category] of byTitle) {
    for (const [re, term] of rules) {
      if (re.test(t)) {
        return { category, term, field: 'title', confidence: 'high', signals }
      }
    }
  }

  // No security title. An engineering role only counts when the description
  // carries several concrete security signals -- one mention of "vulnerability"
  // or "TLS" is ordinary engineering vocabulary, not a security role.
  if (IS_ENGINEERING.test(t) && signals.length >= 3) {
    return {
      category: 'SECURITY_RELATED',
      term: signals.slice(0, 3).join(', '),
      field: 'description',
      confidence: 'low',
      signals,
    }
  }

  return null
}

export const SECURITY_CATEGORIES: SecurityCategory[] = [
  'SECURITY_CORE', 'CYBERSECURITY', 'PRIVACY_SECURITY', 'SAFETY_SECURITY', 'SECURITY_RELATED',
]
