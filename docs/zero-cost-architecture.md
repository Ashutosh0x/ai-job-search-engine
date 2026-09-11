# Zero-Marginal-Cost Job Search Platform — engineering blueprint

**Strategic objective:** re-architect the premium features of Jobright.ai Turbo
($39.99/mo), Simplify+ ($19.99/mo) and Teal+ into a zero-marginal-cost, free,
privacy-first platform.

**Status of this document:** the architecture is the brief's, preserved. Every
load-bearing technical claim was verified against current sources before being
written down, and four were wrong. Corrections are marked **⚠ VERIFIED
CORRECTION** with the evidence. A blueprint that ships a wrong API shape
guarantees someone copies broken code, so they are fixed here rather than
discovered later.

---

## 1. The economic shift

Commercial platforms charge $30–40/month because of three centralised cost
centres, all of which are avoidable:

| Cost centre | Why it costs | Zero-cost alternative |
|---|---|---|
| Cloud LLM calls per edit | OpenAI/Anthropic per-token billing on every resume iteration | On-device inference, or an open-weight SLM at ~$0.0001/iteration |
| Data-enrichment subscriptions | Apollo / Proxycurl / RocketReach at $0.05–0.20 per contact reveal | Deep-link synthesis against the user's own authenticated session |
| Cloud browser farms | Remote Puppeteer/Selenium + residential proxies | Execution inside the user's own browser |

```
PROPRIETARY PAID MODEL ($40/mo)           ZERO-COST ARCHITECTURE ($0/mo)
┌─────────────────────────────────┐       ┌─────────────────────────────────┐
│ User Browser                    │       │ User Browser (Chrome Extension) │
│       │ (sends raw PII)         │       │  ├─ DOM heuristic engine        │
│       ▼                         │       │  ├─ Prompt API (Gemini Nano)    │
│ Central Server Farm             │       │  ├─ Local IndexedDB (user PII)  │
│  ├─ OpenAI API        ($$$)     │       │  └─ Client-side direct fetch    │
│  ├─ Proxycurl/Apollo  ($$$)     │       │       │                         │
│  ├─ Proxy pool        ($$$)     │       │       ▼                         │
│  └─ Headless browsers ($$$)     │       │ Edge API / free public feeds    │
└─────────────────────────────────┘       │  ├─ Public ATS JSON endpoints   │
                                          │  └─ Low-cost open-weight SLM    │
                                          └─────────────────────────────────┘
```

The privacy property falls out of the architecture rather than being a policy:
if PII never leaves the device, there is no PII to breach, subpoena or sell.

---

## 2. Feature implementations

### Feature 1 — Unlimited ATS resume tailoring

**Paywall:** Jobright caps free users at 1–3/day; unlimited requires Turbo.

#### Option A — Chrome Built-in Prompt API (on-device Gemini Nano)

> **⚠ VERIFIED CORRECTION — the brief's snippet uses a deprecated API shape.**
> `window.ai.languageModel.create()` is the old surface. The current API is the
> global `LanguageModel`, and availability **must** be checked first —
> `LanguageModel.availability()` returns `"available"`, `"downloadable"`,
> `"downloading"` or `"unavailable"`.

```js
// Runs on the user's hardware. $0 server cost, no network round-trip.
const status = await LanguageModel.availability()
if (status === 'unavailable') return fallbackToEdgeSLM()
if (status === 'downloadable' || status === 'downloading') {
  // ~4 GB model fetch. Never block the UI on this.
  await warnUserAboutFirstRunDownload()
}

const session = await LanguageModel.create({
  initialPrompts: [{
    role: 'system',
    content:
      'You are an ATS optimisation engine. Align resume bullets with job-description ' +
      'terminology. Never introduce a fact the resume does not already support.',
  }],
})
const tailored = await session.prompt(
  `Base resume:\n${userResume}\n\nJob description:\n${jobDescription}`
)
```

> **⚠ VERIFIED CORRECTION — Option A cannot be the primary path in 2026.**
> Hardware gate: **≥22 GB free disk and a GPU with ≥4 GB VRAM**, on Windows
> 10/11, macOS 13+ or Linux. **No Android or iOS.** Status is Origin Trial /
> Early Preview; **Stable is expected Chrome 145–150, late 2026 / early 2027.**
>
> Consequence for the economics: a large share of users — every mobile user, and
> every low-spec laptop — falls through to Option B *today*. Option B is the
> primary path and Option A is the optimisation, which is the reverse of the
> brief's framing. The $0.00 figure should be quoted as *"~$0.0001 per
> iteration, falling to $0 as on-device support lands"*.

#### Option B — Open-weight SLM fallback (primary path today)

Route to a lightweight open-weight model (Llama-3.2-3B, Qwen-2.5-7B) on a
serverless provider at roughly $0.05 per million tokens — about **$0.0001 per
resume iteration**. At 100k iterations/month that is ~$10/month total: small
enough to sponsor.

#### Token reduction — the deterministic pre-pass

Run a client-side TF-IDF / lemmatisation differential in WebAssembly to compute
the missing-term set *before* any model call. This trims prompt tokens
substantially and, more importantly, makes the keyword differential
**deterministic and explainable** — the model is then only asked to phrase the
change, not to decide it.

> **Architectural note.** This is the same principle as
> `docs/resume-intelligence-audit.md` §3.1: the LLM must not emit the number.
> Deterministic code computes the gap; the model writes the sentence.

---

### Feature 2 — 1-click autofill across 20+ ATS platforms

**Paywall:** daily autofill credits; unlimited only on Turbo.

Simplify does not run an LLM to work out what "First Name" means on each page.
It uses client-side heuristic pattern matching — cheap, instant, offline.

```ts
const FIELD_DICTIONARY = {
  firstName: ['input[name*="first_name"]', 'input[id*="first-name"]', 'input[autocomplete="given-name"]'],
  lastName:  ['input[name*="last_name"]',  'input[id*="last-name"]',  'input[autocomplete="family-name"]'],
  email:     ['input[type="email"]', 'input[name*="email"]'],
  phone:     ['input[type="tel"]',   'input[name*="phone"]'],
  linkedin:  ['input[name*="linkedin"]', 'input[id*="linkedin"]'],
  github:    ['input[name*="github"]',   'input[id*="github"]'],
  eeoGender: ['select[name*="gender"]',  'div[aria-label*="Gender"]'],
}

async function autofillATS() {
  const { user_profile: profile } = await chrome.storage.local.get('user_profile')
  for (const [key, selectors] of Object.entries(FIELD_DICTIONARY)) {
    const el = document.querySelector(selectors.join(', '))
    if (!el || el.value) continue
    // React/Vue track value on the DOM node; a plain assignment is reverted on
    // the next render. Set through the native setter, then fire both events.
    const proto = Object.getPrototypeOf(el)
    Object.getOwnPropertyDescriptor(proto, 'value')?.set?.call(el, profile[key])
    el.dispatchEvent(new Event('input',  { bubbles: true }))
    el.dispatchEvent(new Event('change', { bubbles: true }))
  }
}
```

> **⚠ VERIFIED CORRECTION — the brief's `el.value = …` fails on React ATS forms.**
> Greenhouse, Ashby and Lever render controlled React inputs. Assigning `.value`
> directly does not update React's internal value tracker, so the field visually
> fills and then submits **empty**. The native-setter form above is the working
> pattern. This is the single most common autofill bug and it fails silently.

**EEO fields are a deliberate exception.** Gender, race, veteran and disability
status must never be auto-filled from a stored default. They are voluntary
self-identification, legally distinct, and pre-filling them misrepresents the
candidate. Leave them blank and let the user choose.

**Custom-question caching.** Store generated answers to open-ended questions
("Why our company?") in IndexedDB, keyed by an embedding of the question, and
reuse on semantic match. This is where most of the LLM spend would otherwise go.

---

### Feature 3 — Agentic auto-apply (human-in-the-loop)

**Paywall:** restricted to paid tiers, served from cloud agent queues.

**Why the cloud approach is architecturally worse, not just costlier.** Remote
headless bots trip Cloudflare, DataDome and Workday's own protections, and the
blast radius lands on the *candidate*: a flagged IP range can get real
applications silently discarded.

Executing inside the user's own authenticated session inverts every one of those
properties. The extension:

1. detects and advances multi-step wizards,
2. fills inputs and eligibility radios,
3. uploads the pre-tailored PDF,
4. **stops before submission** — *"Application ready. Please review and submit."*

The stop is not a limitation, it is the design. It keeps a human accountable for
every claim submitted under their name, which is both the compliance story and
the quality story.

---

### Feature 4 — Insider connections and referral generation

**Paywall:** paid credits per employee reveal.

#### Step 1 — LinkedIn deep-link synthesis

Rather than paying a broker $0.15 per contact, construct a search URL the user
opens in their own logged-in session:

```
https://www.linkedin.com/search/results/people/
  ?keywords={role}%20OR%20{hiring_manager_title}
  &currentCompany=["{company_id}"]
  &schoolFilter=["{user_university_id}"]
```

Zero server scraping; the user's own session does the work. **This must remain a
link the user clicks.** Automating the result page is scraping and breaches
LinkedIn's terms — the same reason this repo reads ATS boards rather than
aggregators (`lib/ats/types.ts`).

#### Step 2 — Corporate email permutation

> **⚠ VERIFIED CORRECTION — MX records do not verify a mailbox.**
> The brief states the extension "queries public DNS MX records to verify valid
> mail exchangers". That is true but does not do what the surrounding text
> implies. **An MX record proves the *domain* accepts mail. It says nothing
> about whether `first.last@domain` exists.**
>
> Worse, most large corporates run **catch-all**: the server returns `250` for
> every address including nonexistent ones, so mailbox-level verification is
> *structurally impossible* via SMTP. Every verifier hits this ceiling.
>
> Second correction: **a browser cannot issue raw DNS queries.** MX lookup from
> an extension requires DNS-over-HTTPS, e.g.
> `https://cloudflare-dns.com/dns-query?name={domain}&type=MX` with
> `Accept: application/dns-json`.

Honest framing for the UI: present permutations as **candidates ranked by
convention frequency**, never as "verified". Label them "likely format — unverified".
Presenting a guessed address as verified is the fabrication failure this codebase
forbids, and it costs the user a bounced first impression.

**Ethical boundary.** Guessing an address to send unsolicited mail engages
GDPR/CAN-SPAM. Prefer the LinkedIn route, which is consented contact.

---

### Feature 5 — Career copilot and mock interviewer

**Paywall:** daily Orion rate limit; unlimited needs Turbo.

Most interview questions are standardised (behavioural/STAR, system design,
algorithmic). So:

1. parse the target job's stated requirements locally,
2. select questions matching those requirements,
3. run the simulation with the **Web Speech API**
   (`SpeechRecognition` / `SpeechSynthesis`) — zero cloud audio cost.

> **⚠ Caveat.** Chrome's `SpeechRecognition` sends audio to Google's servers for
> transcription; it is free but **not local**. Claiming "voice never leaves the
> device" would be false. For genuine on-device transcription, ship Whisper via
> WebAssembly/WebGPU and say which one is in use.

Company-pattern data indexed from public discussion must carry provenance and a
date, and be labelled as anecdote rather than fact.

---

### Feature 6 — Sub-hour job discovery

**Paywall:** real-time indexing and "first 50 applicants" alerts behind Turbo.

**This repository already implements this feature, at scale.** It is not a
roadmap item here — it is the existing backend:

| Blueprint asks for | This repo has today |
|---|---|
| Poll public Greenhouse/Lever/Ashby/SmartRecruiters JSON | **13 source adapters** (`lib/sources/adapters/`) incl. Workday, Oracle Recruiting, Eightfold |
| "10,000+ endpoints" | **1,239 boards** crawling, 0 failures |
| Job corpus | **225,601 canonical postings** |
| No proxies / headless browsers | Correct — all public JSON, no scraping |
| Dedupe across boards | 4-tier cascade, 53,494 duplicates collapsed |
| Direct employer apply link | **100%** of postings |

The gap is not ingestion; it is **delivery**. What is missing is a delta
endpoint the extension can poll (`?since=<iso>`) plus push. See §5.

> **⚠ Correction on cadence.** "Sub-hour" is achievable for Greenhouse/Ashby/
> Lever (fast, small payloads). It is **not** achievable for all 1,239 boards:
> the measured full crawl is ~20 minutes wall-clock at concurrency 8, and
> Workday averages 23.5s *per board*. The honest design is the tiered scheduler
> already specified in `docs/INGESTION.md` — poll high-velocity boards every
> 15 min, long-tail boards daily.

---

### Feature 7 — Autonomous application tracking

```js
chrome.webNavigation.onCompleted.addListener(({ url }) => {
  if (/thank-you|application-submitted|confirmation/i.test(url)) {
    saveApplication({ company: extractCompanyFromURL(url), date: new Date().toISOString(), status: 'APPLIED' })
  }
})
```

Stored in IndexedDB, optionally exported to Sheets/Notion by user-initiated
OAuth. Zero hosted-database cost.

> **⚠ Caveat.** URL-pattern detection is a heuristic, not a guarantee — many ATS
> confirm submission without a URL change (SPA state) or use an opaque URL.
> Treat detections as *suggested* entries the user confirms, and always allow
> manual add. Silently missing applications is worse than asking.

---

## 3. Comparison

| Capability | Jobright Turbo | Simplify+ | This architecture |
|---|---|---|---|
| Monthly cost | $29.99–39.99 | $19.99 | **$0** to the seeker |
| Resume tailoring | Cloud LLM | Cloud LLM (capped) | On-device Nano, SLM fallback (~$0.0001/iter) |
| Autofill | Extension, cloud-dependent | Extension | Local DOM heuristics ($0) |
| Auto-apply | Server-side queue | Semi-assisted | Client-side, human-confirmed |
| Insider networking | Paid broker APIs | — | Deep-link + permutation *(labelled unverified)* |
| Job data | Aggregated | Aggregated | **Direct from 1,239 ATS boards** |
| PII location | Vendor servers | Vendor servers | **User's device** |
| Anti-bot risk | Moderate | Low | Minimal — native session |

---

## 4. Sustaining a free product

1. **B2B employer marketplace.** Seekers free; employers pay to sponsor roles or
   search opted-in candidates. Employers hold the budget. (Simplify, Handshake,
   Indeed.)
2. **Lean overhead.** With DOM parsing, autofill, speech and storage on-device,
   server cost is a CDN, a domain and a small Postgres registry.
   *Caveat: the ingestion corpus here is ~275 MB of JSON refreshed continuously —
   real but modest bandwidth/storage, not zero. Budget for it explicitly.*
3. **Bring-your-own-key.** Power users supply their own API key for frontier
   models, removing platform AI cost entirely.

---

## 5. Roadmap

```
PHASE 1 — Extension + autofill            (weeks 1–3)
├── Manifest V3 extension scaffold
├── Selector dictionary: Greenhouse, Lever, Ashby, Workday, SmartRecruiters
├── Native-setter fill (§Feature 2 correction) + React event dispatch
└── Local profile manager (IndexedDB, zero cloud PII)

PHASE 2 — Free local AI tailoring         (weeks 4–5)
├── LanguageModel.availability() gate + SLM fallback routing
├── WASM TF-IDF keyword differential (deterministic pre-pass)
└── Client-side PDF/DOCX export

PHASE 3 — Networking + tracking           (weeks 6–7)
├── LinkedIn deep-link builder
├── DoH MX lookup, results labelled "unverified"
└── webNavigation listener → confirmable tracker entries

PHASE 4 — Live feed integration           (weeks 8–9)   ← backend already exists
├── GET /api/jobs/delta?since=<iso>   (the missing piece)
├── Tiered polling scheduler (15 min hot / daily long-tail)
└── Push notification on match
```

**Phase 4 is the shortest path to visible value**, because ingestion is done.
The one missing server component is a delta endpoint.

---

## 6. Verified-correction summary

| # | Brief said | Verified reality |
|---|---|---|
| 1 | `window.ai.languageModel.create()` | Deprecated. Use global `LanguageModel` + `availability()` gate. |
| 2 | On-device Nano is the default path | Needs ≥22 GB disk, ≥4 GB VRAM, desktop only; Stable ~Chrome 145–150. Fallback is primary today. |
| 3 | `el.value = …` autofills ATS forms | Fails silently on React-controlled inputs. Use the native value setter. |
| 4 | MX lookup "verifies" permuted emails | MX proves the domain accepts mail, not that a mailbox exists; catch-all makes it structurally unverifiable. Browsers also need DoH. |
| 5 | Sub-hour discovery across all boards | True for Greenhouse/Ashby/Lever; not for 1,239 boards at ~20 min/crawl. Tier the scheduler. |
| 6 | Web Speech API = zero cloud | Free, but Chrome sends audio to Google. Local needs Whisper WASM. |

## Sources

- [Chrome Prompt API — Gemini Nano guide](https://www.computeleap.com/blog/chrome-gemini-nano-prompt-api-window-ai-may-2026/)
- [Chrome built-in AI and the Prompt API — Thinktecture Labs](https://labs.thinktecture.com/local-small-language-models-in-the-browser-a-first-glance-at-chromes-built-in-ai-and-prompt-api-with-gemini-nano/)
- [Chrome officially launches the Prompt API](https://news.aibase.com/news/27634)
- [MX record validation vs SMTP verification — MailTester](https://mailtester.com/blog/mx-record-validation-vs-smtp-verification/)
- [Catch-all email verification, 2026](https://www.emailaddress.ai/blog/catch-all-email-verification-fix-unknowns)
- [Email permutator: how it works and its limits, 2026](https://www.zeliq.com/blog/email-permutator)
