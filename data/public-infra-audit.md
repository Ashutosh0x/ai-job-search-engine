# Public-Infrastructure & Crawler-Integrity Audit

Generated 2026-09-12. Method: public DNS (A/CNAME/MX/TXT/SPF/DMARC/NS) resolved via 1.1.1.1 and 8.8.8.8; the crt.sh certificate-transparency index; and live calls to **public job-board APIs intended for public consumption**.

Reproduce with:

```
node scripts/fingerprint-companies.mjs      -> data/company-fingerprint.{txt,json}
node scripts/recon-public-infra.mjs         -> data/public-infra-recon.json
node scripts/verify-banking-intel.mjs       -> scripts/banking-intel-verified.json
```

## Boundary actually observed

No authentication was attempted. No credential, password-reset, or mailbox-verification flow was touched. No WAF, CAPTCHA, or rate limit was circumvented. No tenant identifier was guessed. No host whose name suggests payment, payroll, treasury or banking was contacted — those appear below **only** as names present in a public certificate log.

One live-call category was used: public ATS job-board endpoints, which exist to be read anonymously by candidates and are the same endpoints a careers page calls from a browser.

---

## 1. Company infrastructure map

`ATS` is what answered a live call. `Career-site layer` is what a public CNAME names. `Mail` is from MX. Confidence applies to the ATS attribution.

| Company | Corporate domain | Alt domain | ATS (called) | Career-site layer (CNAME) | Mail | DMARC | Status | Conf. |
|---|---|---|---|---|---|---|---|---|
| JPMorgan Chase | jpmorganchase.com | jpmorgan.com (mail) | **Oracle Recruiting Cloud** `CX_1001` — **7,437** | self-hosted `gslbjpmchase.com` | MessageLabs | reject | VERIFIED | High |
| Morgan Stanley | morganstanley.com | — | **Workday** `ms/External` — **1,286** (corpus rank 115) | — | self-hosted | reject | VERIFIED | High |
| Citigroup | citi.com | citigroup.com | **Workday** `citi/2` — capped 2,000+ | **Radancy TalentBrew** | self-hosted | reject | VERIFIED | High |
| Bank of America | bankofamerica.com | bofa.com | **Workday** `ghr/Lateral-US` — 2,005 | Akamai (no vendor) | Proofpoint | reject | VERIFIED | High |
| Wells Fargo | wellsfargo.com | — | **Workday** `wf/WellsFargoJobs` — 1,796 | Akamai (no vendor) | Proofpoint | reject | VERIFIED | High |
| Goldman Sachs | gs.com | — | not established | A record, no CNAME | Proofpoint | reject | UNKNOWN | — |
| Citadel | citadel.com | — | UNKNOWN — Greenhouse claim **404** | — | Proofpoint | quarantine | FALSE POSITIVE | — |
| Citadel Securities | citadelsecurities.com | — | UNKNOWN — Greenhouse claim **404** | — | Proofpoint | quarantine | FALSE POSITIVE | — |
| Visa | visa.com | — | **Workday** `visa/Visa` — 760 | — | self-hosted | quarantine | VERIFIED | High |
| Mastercard | mastercard.com | — | **Workday** `mastercard/CorporateCareers` — 1,055 | **Phenom** | Proofpoint | reject | VERIFIED | High |
| PayPal | paypal.com | — | **Workday** `paypal/jobs` — 128 | — | self-hosted | reject | VERIFIED | High |
| Barclays | barclays.com | — | **Workday** `barclays/External_Career_Site_Barclays` — 1,014 | — | Proofpoint | reject | VERIFIED | High |
| HSBC | hsbc.com | — | Eightfold — adapter exists, not called here | — | Proofpoint | reject | PROBABLE | Med |
| Lloyds Banking Group | lloydsbanking.com | lloydsbankinggroup.com | **Workday** `lbg/lbg_Careers` — 113 | — | Microsoft 365 | reject | VERIFIED | High |
| NatWest Group | natwest.com | natwestgroup.com | **Workday** `rbs/RBS` — 107 | **TalentReef**; `apply.` self-hosted | self-hosted | reject | VERIFIED | High |
| Standard Chartered | sc.com | — | **Workday** `peopleplus/SCB_Careers` — 55 | **Beamery**; SuccessFactors TXT token | Proofpoint | reject | VERIFIED | High |
| Commonwealth Bank | cba.com.au | commbank.com.au | **Workday** `cba/CommBank_Careers` — 223 (+3 more boards) | — | Microsoft 365 | reject | VERIFIED | High |
| NAB | nab.com.au | — | **Workday** `nab/NAB_Careers` — 277 | Akamai (no vendor) | Microsoft 365 | reject | VERIFIED | High |
| Deutsche Bank | db.com | — | **Workday** `db/DBWebsite` — 1,136 | self-hosted `tec.db.com` | self-hosted | reject | VERIFIED | High |
| Commerzbank | commerzbank.com | — | SuccessFactors — no public JSON API | — | Microsoft 365 | reject | PROBABLE | Med |
| MUFG | mufg.jp | mufgamericas.com | **Workday** `mufgub/MUFG-Careers` — 660 | — | self-hosted | reject | VERIFIED | High |
| BNY Mellon | bny.com | bnymellon.com | **Oracle Recruiting Cloud** `BNY-Careers` — **1,369** | — | Proofpoint | reject | VERIFIED | High |
| HDFC Bank | hdfcbank.com | — | SuccessFactors — no public JSON API | — | Microsoft 365 | reject | PROBABLE | Med |
| State Bank of India | sbi.co.in | bank.sbi | in-house CRPD / TCS iON | — | Microsoft 365 | reject | PROBABLE | Med |
| NPCI | npci.org.in | — | **Zoho Recruit** — see §4 | **Zoho Recruit** `zohohost.in` | self-hosted | reject | VERIFIED | High |
| Jane Street | janestreet.com | — | **Greenhouse** `janestreet` — 230 | — | self-hosted | quarantine | VERIFIED | High |

---

## 2. Confirmed infrastructure

**ATS, by live call to a public board (18):** Workday for Morgan Stanley, Citi, BofA, Wells Fargo, Visa, Mastercard, PayPal, Barclays, Lloyds, NatWest, Standard Chartered, CBA, NAB, Deutsche Bank, MUFG. Greenhouse for Jane Street. **Oracle Recruiting Cloud for JPMorgan Chase (7,437 requisitions) and BNY (1,369)** — both fully public JSON, no key required.

**Career-site layer, by public CNAME (5):** these are the presentation/CRM tier in front of the ATS, not the ATS itself.

| Company | Hostname | Vendor |
|---|---|---|
| Citigroup | `jobs.citi.com` | Radancy TalentBrew |
| Mastercard | `careers.mastercard.com` | Phenom |
| NatWest | `jobs.natwest.com` | TalentReef |
| Standard Chartered | `talent.sc.com` | Beamery |
| NPCI | `careers.npci.org.in` | Zoho Recruit |

**Self-hosted careers fronts (3):** JPMorgan (`gslbjpmchase.com`), NatWest `apply.` (`glb2p.rbs.com`), Deutsche Bank (`tec.db.com`).

**Mail:** Proofpoint 10, self-hosted 9, Microsoft 365 6, Symantec/MessageLabs 1. No Google Workspace anywhere in the set.

**DMARC: 26/26 enforcing** — 22 `p=reject`, 4 `p=quarantine`. Not one domain is monitor-only. This matters directly to recruitment fraud: these specific domains are hardened against spoofing.

**Non-ATS vendors named in DNS** (SPF include or verification token — the company's own declaration): Atlassian 22, DocuSign 17, Adobe 13, Salesforce 6, Amazon SES 3, Meta Workplace 2, SendGrid 1, SAP SuccessFactors 1 (Standard Chartered, `successfactors-site-verification`).

---

## 3. Probable infrastructure

- **HSBC → Eightfold.** Widely reported and an adapter exists in this repo, but no call was made in this audit. PROBABLE, not VERIFIED.
- **Commerzbank, HDFC Bank → SAP SuccessFactors.** No public JSON API to confirm; SuccessFactors has no distinctive public CNAME on their careers hosts.
- **SBI → in-house CRPD / TCS iON.** Consistent with public recruitment notices; no machine-readable endpoint.
- **Standard Chartered runs three layers** — Workday (board called), Beamery (CNAME), SuccessFactors (TXT token). All three signals are individually VERIFIED; that they form one coherent stack is inference.
- **Citadel banking relationships.** `treasury.scotia.citadel.com` and `treasury.jpm.citadel.com` exist in public CT logs, naming Scotiabank and JPMorgan. A public signal of a banking relationship; not confirmation of one. Not contacted.

---

## 4. False positives — crawler or source was wrong

| # | Claim | Public evidence | Verdict |
|---|---|---|---|
| 1 | Citi ATS is `citi.wd5…/citi_careers` | HTTP **404**; live board is `citi/2` | FALSE POSITIVE |
| 2 | Citadel & Citadel Securities on Greenhouse | `boards/citadel` and `boards/citadelsecurities` both **404**, as do other plausible tokens; citadel.com returns 403 to automated requests | FALSE POSITIVE — true ATS remains UNKNOWN |
| 3 | CBA has a `CommBank_India` board | **404**; four other CBA boards do answer | FALSE POSITIVE |
| 4 | **NPCI uses Darwinbox** (with an RBI-data-sovereignty rationale) | `careers.npci.org.in` CNAMEs to `zs-in1-lczhost-H2.zohohost.in` and redirects to `/jobs/Careers` — the Zoho Recruit career-page path — titled "Openings at NPCI" | **FALSE POSITIVE — it is Zoho Recruit** |
| 5 | Workday customers are identifiable from DNS | Workday appears in **0/26** apex SPF/TXT records despite 15 verified Workday customers | CONFIRMED: DNS cannot attribute an ATS |
| 6 | 11 institutions use Meta Workplace | Token was `facebook-domain-verification` — ownership of a Facebook **page**, marketing, not the enterprise product. True count: 2 | FALSE POSITIVE (our tooling) |
| 7 | JPMorgan publishes no MX / has no mail provider | `jpmorganchase.com` genuinely has no MX; mail is on `jpmorgan.com` via MessageLabs | FALSE POSITIVE (our tooling — wrong domain queried) |
| 8 | "0/26 careers CNAMEs name a vendor" | Our own pattern matched `phenompeople.com` but the real host is `phenompeople.**net**`; 5 vendors were present | FALSE POSITIVE (our tooling) |
| 9 | 40% of postings reuse a requisition | `bulletFields[0]` is not the requisition id — it is an employment type or city on many tenants | FALSE POSITIVE (our crawler) |
| 10a | JPMorgan and BNY have "no public JSON API / need a headless browser" | `recruitingCEJobRequisitions` returns JSON anonymously — 7,437 and 1,369 requisitions, with posted dates and working apply URLs. The repo's registry already had JPMorgan's `CX_1001` verified 11 Sep; the audit repeated the source's claim without checking it | FALSE POSITIVE (ours — trusted the source over our own repo) |
| 10 | Topgolf/Moog/Roche advertise one job ~1,000 times | Our repost-suffix stripper destroyed ids ending in a dash-number (`JR2023-22829` → `JR2023`) | FALSE POSITIVE (our crawler) |

Note the shape: **six of ten false positives were ours, not the source's.** Every one was found by checking a result that looked interesting, not by reading code.

---

## 5. Crawler fixes

| # | Fix | Status |
|---|---|---|
| 1 | A JSON endpoint returning HTML is a refusal: `expectJson` on the HTTP client, counted as `blocked`, kept out of cache, host named | **Done** — `lib/sources/http.ts` |
| 2 | Never guess a tenant/portal; Keka's portal segment is the literal `default` | **Done** — `KekaAdapter`, 19 tests |
| 3 | Requisition id from `externalPath`, never `bulletFields[0]` | **Done** — `workdayRequisition`, 10 tests |
| 4 | Repost suffix is 1–2 digits; longer trailing numbers are part of the id | **Done** — same function |
| 5 | Empty ≠ zero: a zero-job tenant is re-probed and classified `empty / refused / gone / unreachable` | **Done** — `diagnoseEmpty` in the crawler |
| 6 | Shard-level breaker so one throttled Workday shard is not read as N dead employers | **Done** |
| 7 | Registry: no duplicate slugs, no board claimed by two companies, intelligence profiles must join a real company | **Done** — 3 new tests |
| 8 | Resolve alternate domains before concluding "no mail provider" | **Done** — fingerprint script |
| 9 | Marketing tokens must not be read as enterprise tooling | **Done** — Facebook page vs Meta Workplace split |
| 10 | Vendor patterns must cover all TLDs a vendor uses (`.net` as well as `.com`) | **Done** — recon script |
| 11 | Board state must be separate from job count: `board_verified=true, jobs=0` ≠ `board_verified=false` | **Not built** — P0 below |
| 12 | Verify the application URL of each posting resolves | **Not built** — P0 below |

---

## 6. Legal / safety classification of next steps

**PASSIVE / PUBLIC — no permission needed, already how this audit ran**
- DNS: A/AAAA/CNAME/MX/TXT/SPF/DKIM/DMARC/NS
- Certificate-transparency queries (crt.sh)
- Public ATS job-board APIs — the endpoints a careers page calls anonymously
- Public developer-portal and trust-page documentation
- Public corporate filings and investor disclosures
- Following public redirects between corporate, careers and application domains
- Fetching a public job posting's own page to confirm it resolves

**AUTHORIZED ACTIVE — only with written permission from the domain owner**
- Any request to a host named for payment, payroll, treasury or banking
- Any authenticated flow, including candidate-account creation
- Submitting an application form
- Load or rate-limit testing of any endpoint
- Assessing the non-production hosts visible in CT logs (see below)

**Observation, offered without recommendation:** several institutions have non-production hostnames in public CT logs (`*-sit.*`, `*-nonprod.*`, `*.sandbox.*`, `*-uat.*`). This is a common consequence of certificate issuance and is visible to anyone reading a public log. This audit did not contact any of them, and assessing them would require authorization from the owner — out of scope here. It is noted only because *our crawler* must never treat such a host as a careers source.

---

## 7. Recommended verification model

Every attribution carries its own provenance. No field is stored without the record that justifies it.

```
company_id           stable internal id
source_type          ats_api | careers_cname | ct_log | dns_txt | dns_mx | filing | careers_page
source_url           what was read
provider             Workday | Greenhouse | Phenom | Beamery | ...
provider_tenant      tenant/board id, only when publicly visible — never guessed
provider_site        second path segment where the platform has one
evidence_type        http_json_200_with_schema | cname_chain | txt_token | spf_include | redirect
evidence_url         the exact record or endpoint
evidence_excerpt     the matched string, so a human can re-judge it
observed_at          when
verification_method  live_api_call | dns_resolution | ct_query | manual
status               VERIFIED | PROBABLE | UNKNOWN | FALSE_POSITIVE
confidence           0-1
last_verified_at     when last re-confirmed
supersedes           id of a claim this replaces (audit trail for corrections)
```

Two rules the model must enforce:

1. **UNKNOWN is never rendered as NO.** A board we could not read is not an employer without jobs. `board_verified` and `job_count` are separate columns, and the pair `(false, 0)` must display as "not established", never "0 open roles".
2. **Infrastructure fingerprints do not imply access or usage of a hiring system.** Mail infrastructure is not hiring infrastructure. A CNAME identifies the layer it points at and nothing behind it.

---

## 8. Backlog

**P0 — correctness of what we already publish**
1. Board state machine: `DISCOVERED → VERIFIED → LIVE/EMPTY/REFUSED/GONE`, stored, with `board_verified` separate from `job_count`.
2. Application-URL verification per posting; a job with a dead apply link is not publishable.
3. Re-crawl the Workday corpus on the fixed requisition logic and rebuild canonical ids — the present 630k-posting corpus predates that fix.
4. Report unique openings alongside raw postings. Current data: ~33% of Workday postings are additional copies of a requisition already counted (multi-location and reposts — platform mechanics, not deception).
5. Persist the evidence model in §7 for every ATS attribution now held as prose.

**P1 — coverage and freshness**
6. Zoho Recruit adapter — NPCI is a verified live tenant and the `/jobs/Careers` shape is now known.
7. Per-source re-crawl cadence instead of uniform full sweeps.
8. Cross-ATS dedupe: same requisition reached through several career-site paths.
9. Employer ↔ ATS identity graph, so Citi's Workday board, TalentBrew front and `citi`/`citigroup` domains resolve to one company.
10. Career-site-layer detection (Phenom, TalentBrew, Beamery, TalentReef) as a first-class field — it is not the ATS and must not be stored as one.

**P2 — intelligence, only on a trustworthy base**
11. Hiring-velocity metrics from job lifecycle history.
12. Source-quality scoring feeding search ranking.
13. Crawler health dashboard: per-adapter success, refusal and staleness rates.

**Deliberately not on the backlog:** contacting payment, payroll, treasury or banking hosts; any authenticated flow; anything requiring authorization we do not have.
