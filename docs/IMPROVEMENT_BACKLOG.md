# Improvement backlog

Evidence-backed only. Each item names its proof; "done" means verified, not
just written. Updated 2026-10-02. Findings detail: [AUDIT-2026.md §6](../AUDIT-2026.md).

## Done (2026-10-02)

| Item | Evidence of completion |
|---|---|
| Recovery links no longer returned to anonymous callers (`/api/generate-magic-link`) | `scripts/test-auth-link-exposure.mjs` passes; fails 4/5 on the original code |
| SSRF via caller-supplied `domain` closed (`lib/contacts/domain.ts`, enforced in `discoverContact`) | `scripts/test-contact-domain.mjs` 34/34 |
| Rate limit on anonymous `/api/contacts/discover` (10/min) and `/api/recruiters` | code review; per-process caveat applies |
| `/api/docs/*` off unless `DOCS_PROXY_ORIGIN` is set | code review |
| Six Singapore employers added (Simular, CSIT, Open Government Products, Singapore Public Service incl. GovTech, Singtel, SAP) | `--only` ingest: 6/6 sources OK, 1,691 jobs, 80/80 HTTP 2xx |
| Repository index and codebase map | `docs/REPOSITORY_INDEX.md`, `docs/CODEBASE_MAP.md` |

## Next

| # | Priority | Problem (evidence) | Proposal | Risk | Acceptance |
|---|---|---|---|---|---|
| B-0 | **Critical** | `npm audit --omit=dev` (2026-10-02): `next@14.2.35` carries 24 advisories, incl. unauthenticated RCE in the Image Optimization API with AVIF (GHSA-2xp9-vwfh-vxw4), SSRF in rewrites and Server Actions, cache poisoning; `postcss` (via next) high; `dompurify` low. All fixes are in Next >= 15.5.24 (npm suggests 16.3.8) | Planned major upgrade on a branch: Next 15.5.x LTS or 16, React 19, async request APIs, then the full test suite + preview | Breaking changes across App Router APIs | `npm audit --omit=dev` shows no critical/high in next/postcss; tests and build green |
| B-1 | High | Rate limits are per-process; prod allowed 46/46 against a 40/min limit (`lib/api-guard.ts`). Password reset, OTP and contact discovery rely on them. | Shared limiter (Upstash Redis, or a Postgres table with an atomic upsert) behind the existing `checkRateLimit` signature | Needs an Upstash account or a migration | A burst against prod returns 429s across instances |
| B-2 | High | Lint never runs (no ESLint config; `ignoreDuringBuilds: true`) | Commit `eslint.config.mjs` with `next/core-web-vitals`, fix or baseline the findings, then turn `ignoreDuringBuilds` off and add a CI step | Initial warning volume unknown | `next lint` exits 0 non-interactively; CI step green |
| B-3 | Medium | Local `tsc` is unusable while sibling projects live inside the repo (22,898 foreign errors, OOM) | Move the untracked `furlpay-*`, `arc-remote-signer`, `malachite` folders out of the repo, **or** narrow `tsconfig.json` `include` to app paths | Moving folders is the owner's call | `npx tsc --noEmit` exits 0 locally without a heap flag |
| B-4 | Low | Per-hop DNS validation is done (`fetchPublicFollowingRedirects`, 13 tests). Remaining: a race between the check's DNS lookup and fetch's own resolution | Pin the connection to the validated address (undici dispatcher with a custom `lookup`) | Must keep TLS SNI and redirects working | Test: a resolver answering public, then private on the second lookup, is refused |
| B-5 | Low | Extension ships `http://localhost/*` in `externally_connectable` | Separate dev and prod manifests; prod lists only the production origin | Breaks local extension testing unless the dev manifest is used | Prod manifest has no localhost entry |
| B-6 | Low | Extension's `bulk-discover` call is always 401 (no session sent) | Use the existing `get-linkedin-profile` bridge so the web app (signed in) makes the call, or send a bearer token | Product decision on extension auth | Bulk discovery from the extension saves contacts for a signed-in user |
| B-7 | Low | `SAP` shows as "SAP IT Business Systeme" (SmartRecruiters' entity name) | Prefer the registry `name` over the source's company name at normalise time | Touches all providers' naming | `--only sap` shows "SAP" |
| B-8 | Info | `docs/SECURITY.md` "Open issues" was stale (CI, middleware auth, Next version, build errors are done) | Updated in this pass | none | matches code |

## Needs your decision

- **Production has no environment variables** (`vercel env ls` on
  `ai-job-search-engine`: none). Sign-in, password reset, resume upload and
  parsing, AI analysis, AI interviews and Stripe all depend on Supabase, Gemini,
  Turnstile and Stripe keys, so they cannot work on the deployed site. Public
  job search, companies and recruiters work because they read committed data.
  Adding secrets is an account-owner action.
- **B-1:** which shared store (Upstash, or Postgres).
- **B-3:** whether to move the sibling project folders out of this repository.
- **B-6:** how the extension should authenticate.
- **MyCareersFuture:** it's a government aggregator, not an employer. Its listings
  duplicate employers' own postings, and this index links to employers' own
  postings. Adding it needs a decision on aggregator sources and a check of
  its terms of use.
