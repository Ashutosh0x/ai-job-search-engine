// Boards here feed the v2 ingest pipeline, so the provider is a SourceId --
// the wider union that includes the enterprise platforms (Eightfold) and the
// bespoke portals (`custom`: Amazon, Oracle Recruiting Cloud). AtsProvider is
// the narrower v1 connector union and cannot name them.
import type { SourceId } from '../sources/types'

/**
 * Company registry.
 *
 * Each entry is an employer we have VERIFIED by reaching its own ATS board and
 * seeing live postings (see scripts/verify-ats-boards.mjs). That verification
 * is what "genuine company" means here -- not a name scraped off a listings
 * page, but an employer whose own applicant tracking system is answering.
 *
 * VALUATION PROVENANCE
 * --------------------
 * Valuation is only as good as its source, so every figure carries one.
 *
 *  - `public`  : market capitalisation, computed at ingest time from SEC EDGAR
 *                shares-outstanding x last close. Both inputs are free and
 *                authoritative; the number is derived, not asserted.
 *  - `private` : last publicly reported post-money valuation, entered by hand
 *                with a source and an as-of date. There is no free API that
 *                reports private valuations reliably, so these are curated
 *                rather than fetched, and the UI must show the as-of date.
 *                A stale private valuation presented as current is exactly the
 *                kind of confident-but-wrong number worth avoiding.
 *  - `unknown` : we genuinely do not know. Shown as "Not disclosed", never
 *                guessed or interpolated.
 */

export type ValuationKind = 'public' | 'private' | 'unknown'

export interface CompanyBoard {
  provider: SourceId
  token: string
  site?: string
  host?: string
  /**
   * Public careers host, when it differs from the API host.
   *
   * Oracle Recruiting Cloud serves its API from an unguessable pod
   * (`fa-evmr-saasfaprod1.fa.ocs.oraclecloud.com`) while candidates apply on
   * the employer's own domain (`jobs.nokia.com`). Links must use the latter:
   * this index points at the employer's own posting, never an intermediary.
   */
  applyHost?: string
}

export interface CompanyRecord {
  slug: string
  name: string
  /** Primary domain; drives the logo and is the join key for enrichment. */
  domain: string
  boards: CompanyBoard[]
  valuationKind: ValuationKind
  /** SEC ticker, for `public`. Market cap is derived from this at ingest. */
  ticker?: string
  /** USD. For `private` only -- last reported post-money. */
  reportedValuationUsd?: number
  /** ISO date the private figure refers to. */
  valuationAsOf?: string
  /** Where the private figure came from. */
  valuationSource?: string
  industry?: string
  hqLocation?: string
  foundedYear?: number
}

/**
 * Seeded from boards confirmed live on 10 Sep 2026. Only companies whose board
 * actually answered with open roles are included.
 */
export const COMPANIES: CompanyRecord[] = [
  // ---- Public companies: valuation derived from SEC EDGAR + last close ----
  { slug: 'salesforce', name: 'Salesforce', domain: 'salesforce.com', ticker: 'CRM', valuationKind: 'public', industry: 'Enterprise Software', hqLocation: 'San Francisco, CA', foundedYear: 1999,
    boards: [{ provider: 'workday', token: 'salesforce', site: 'External_Career_Site', host: 'salesforce.wd12.myworkdayjobs.com' }] },
  { slug: 'adobe', name: 'Adobe', domain: 'adobe.com', ticker: 'ADBE', valuationKind: 'public', industry: 'Creative Software', hqLocation: 'San Jose, CA', foundedYear: 1982,
    boards: [{ provider: 'workday', token: 'adobe', site: 'external_experienced', host: 'adobe.wd5.myworkdayjobs.com' }] },
  { slug: 'airbnb', name: 'Airbnb', domain: 'airbnb.com', ticker: 'ABNB', valuationKind: 'public', industry: 'Travel Marketplace', hqLocation: 'San Francisco, CA', foundedYear: 2008,
    boards: [{ provider: 'greenhouse', token: 'airbnb' }] },
  { slug: 'coinbase', name: 'Coinbase', domain: 'coinbase.com', ticker: 'COIN', valuationKind: 'public', industry: 'Crypto Exchange', hqLocation: 'Remote-first, USA', foundedYear: 2012,
    boards: [{ provider: 'greenhouse', token: 'coinbase' }] },
  { slug: 'robinhood', name: 'Robinhood', domain: 'robinhood.com', ticker: 'HOOD', valuationKind: 'public', industry: 'Fintech / Brokerage', hqLocation: 'Menlo Park, CA', foundedYear: 2013,
    boards: [{ provider: 'greenhouse', token: 'robinhood' }] },
  { slug: 'reddit', name: 'Reddit', domain: 'reddit.com', ticker: 'RDDT', valuationKind: 'public', industry: 'Social Media', hqLocation: 'San Francisco, CA', foundedYear: 2005,
    boards: [{ provider: 'greenhouse', token: 'reddit' }] },
  { slug: 'pinterest', name: 'Pinterest', domain: 'pinterest.com', ticker: 'PINS', valuationKind: 'public', industry: 'Social Media', hqLocation: 'San Francisco, CA', foundedYear: 2010,
    boards: [{ provider: 'greenhouse', token: 'pinterest' }] },
  { slug: 'lyft', name: 'Lyft', domain: 'lyft.com', ticker: 'LYFT', valuationKind: 'public', industry: 'Mobility', hqLocation: 'San Francisco, CA', foundedYear: 2012,
    boards: [{ provider: 'greenhouse', token: 'lyft' }] },
  { slug: 'twilio', name: 'Twilio', domain: 'twilio.com', ticker: 'TWLO', valuationKind: 'public', industry: 'Communications API', hqLocation: 'San Francisco, CA', foundedYear: 2008,
    boards: [{ provider: 'greenhouse', token: 'twilio' }] },
  { slug: 'dropbox', name: 'Dropbox', domain: 'dropbox.com', ticker: 'DBX', valuationKind: 'public', industry: 'Cloud Storage', hqLocation: 'San Francisco, CA', foundedYear: 2007,
    boards: [{ provider: 'greenhouse', token: 'dropbox' }] },
  { slug: 'affirm', name: 'Affirm', domain: 'affirm.com', ticker: 'AFRM', valuationKind: 'public', industry: 'Fintech / BNPL', hqLocation: 'San Francisco, CA', foundedYear: 2012,
    boards: [{ provider: 'greenhouse', token: 'affirm' }] },
  { slug: 'samsara', name: 'Samsara', domain: 'samsara.com', ticker: 'IOT', valuationKind: 'public', industry: 'IoT / Fleet', hqLocation: 'San Francisco, CA', foundedYear: 2015,
    boards: [{ provider: 'greenhouse', token: 'samsara' }] },
  { slug: 'sofi', name: 'SoFi', domain: 'sofi.com', ticker: 'SOFI', valuationKind: 'public', industry: 'Fintech / Banking', hqLocation: 'San Francisco, CA', foundedYear: 2011,
    boards: [{ provider: 'greenhouse', token: 'sofi' }] },
  { slug: 'gitlab', name: 'GitLab', domain: 'gitlab.com', ticker: 'GTLB', valuationKind: 'public', industry: 'DevOps', hqLocation: 'All-remote', foundedYear: 2011,
    boards: [{ provider: 'greenhouse', token: 'gitlab' }] },
  { slug: 'instacart', name: 'Instacart', domain: 'instacart.com', ticker: 'CART', valuationKind: 'public', industry: 'Grocery Delivery', hqLocation: 'San Francisco, CA', foundedYear: 2012,
    boards: [{ provider: 'greenhouse', token: 'instacart' }] },
  // Token is `doordashusa`, not `doordash` -- the obvious guess 404s. Found by
  // probing rather than assumed. Verified 11 Sep 2026.
  { slug: 'doordash', name: 'DoorDash', domain: 'doordash.com', ticker: 'DASH', valuationKind: 'public', industry: 'Food Delivery', hqLocation: 'San Francisco, CA', foundedYear: 2013,
    boards: [{ provider: 'greenhouse', token: 'doordashusa' }] },
  // LinkedIn: verified live, 53 postings on Greenhouse. The obvious guess was
  // right here, which is not the norm -- see Razorpay below.
  { slug: 'linkedin', name: 'LinkedIn', domain: 'linkedin.com', valuationKind: 'unknown',
    industry: 'Professional Network', hqLocation: 'Sunnyvale, CA', foundedYear: 2003,
    boards: [{ provider: 'greenhouse', token: 'linkedin' }] },
  // Safe Security: Lever token is `safe`, not `safesecurity`. Verified, 21 postings.
  { slug: 'safe-security', name: 'Safe Security', domain: 'safe.security', valuationKind: 'private',
    industry: 'Cyber Risk Management', hqLocation: 'Palo Alto, CA', foundedYear: 2012,
    boards: [{ provider: 'lever', token: 'safe' }] },
  // Nokia: Oracle Recruiting Cloud, 590 postings verified. The pod name was
  // read off jobs.nokia.com -- `fa-evmr`, where the obvious guess was `fa-eomz`.
  { slug: 'nokia', name: 'Nokia', domain: 'nokia.com', ticker: 'NOK', valuationKind: 'public',
    industry: 'Telecom Infrastructure', hqLocation: 'Espoo, Finland', foundedYear: 1865,
    boards: [{
      provider: 'oracle',
      token: 'nokia',
      site: 'CX_1',
      host: 'fa-evmr-saasfaprod1.fa.ocs.oraclecloud.com',
      applyHost: 'jobs.nokia.com',
    }] },
  // Netskope: 142 postings verified live.
  { slug: 'netskope', name: 'Netskope', domain: 'netskope.com', valuationKind: 'unknown',
    industry: 'Cloud Security (SASE)', hqLocation: 'Santa Clara, CA', foundedYear: 2012,
    boards: [{ provider: 'greenhouse', token: 'netskope' }] },
  // Tailscale: 59 postings verified live.
  { slug: 'tailscale', name: 'Tailscale', domain: 'tailscale.com', valuationKind: 'unknown',
    industry: 'Zero Trust Networking', hqLocation: 'Toronto, Canada', foundedYear: 2019,
    boards: [{ provider: 'greenhouse', token: 'tailscale' }] },
  // Dragos: 58 postings verified live.
  { slug: 'dragos', name: 'Dragos', domain: 'dragos.com', valuationKind: 'unknown',
    industry: 'Industrial (OT) Cybersecurity', hqLocation: 'Hanover, MD', foundedYear: 2016,
    boards: [{ provider: 'greenhouse', token: 'dragos' }] },
  // Huntress: 35 postings verified live.
  { slug: 'huntress', name: 'Huntress', domain: 'huntress.com', valuationKind: 'unknown',
    industry: 'Managed Detection & Response', hqLocation: 'Columbia, MD', foundedYear: 2015,
    boards: [{ provider: 'greenhouse', token: 'huntress' }] },
  // Recorded Future: 39 postings verified live.
  { slug: 'recorded-future', name: 'Recorded Future', domain: 'recordedfuture.com', valuationKind: 'unknown',
    industry: 'Threat Intelligence', hqLocation: 'Somerville, MA', foundedYear: 2009,
    boards: [{ provider: 'greenhouse', token: 'recordedfuture' }] },
  // Orca Security: 9 postings verified live.
  { slug: 'orca-security', name: 'Orca Security', domain: 'orca.security', valuationKind: 'unknown',
    industry: 'Cloud Security Posture', hqLocation: 'Portland, OR', foundedYear: 2019,
    boards: [{ provider: 'greenhouse', token: 'orcasecurity' }] },
  // Expel: 8 postings verified live.
  { slug: 'expel', name: 'Expel', domain: 'expel.com', valuationKind: 'unknown',
    industry: 'Managed Detection & Response', hqLocation: 'Herndon, VA', foundedYear: 2016,
    boards: [{ provider: 'greenhouse', token: 'expel' }] },
  // Cybereason: 8 postings verified live.
  { slug: 'cybereason', name: 'Cybereason', domain: 'cybereason.com', valuationKind: 'unknown',
    industry: 'Endpoint Detection & Response', hqLocation: 'Boston, MA', foundedYear: 2012,
    boards: [{ provider: 'greenhouse', token: 'cybereason' }] },
  // Snyk: 1 postings verified live.
  { slug: 'snyk', name: 'Snyk', domain: 'snyk.io', valuationKind: 'unknown',
    industry: 'Developer Security', hqLocation: 'Boston, MA', foundedYear: 2015,
    boards: [{ provider: 'ashby', token: 'snyk' }] },
  // Tenable: 41 postings verified live.
  { slug: 'tenable', name: 'Tenable', domain: 'tenable.com', valuationKind: 'unknown',
    industry: 'Exposure Management', hqLocation: 'Columbia, MD', foundedYear: 2002,
    boards: [{ provider: 'greenhouse', token: 'tenableinc' }] },
  // Qualys: 162 postings verified live.
  { slug: 'qualys', name: 'Qualys', domain: 'qualys.com', valuationKind: 'unknown',
    industry: 'Vulnerability Management', hqLocation: 'Foster City, CA', foundedYear: 1999,
    boards: [{ provider: 'workday', token: 'qualys', site: 'Careers', host: 'qualys.wd5.myworkdayjobs.com' }] },
  // Arctic Wolf: 111 postings verified live.
  { slug: 'arctic-wolf', name: 'Arctic Wolf', domain: 'arcticwolf.com', valuationKind: 'unknown',
    industry: 'Security Operations', hqLocation: 'Eden Prairie, MN', foundedYear: 2012,
    boards: [{ provider: 'workday', token: 'arcticwolf', site: 'External', host: 'arcticwolf.wd1.myworkdayjobs.com' }] },
  // Proofpoint: 147 postings verified live.
  { slug: 'proofpoint', name: 'Proofpoint', domain: 'proofpoint.com', valuationKind: 'unknown',
    industry: 'Email & Data Security', hqLocation: 'Sunnyvale, CA', foundedYear: 2002,
    boards: [{ provider: 'workday', token: 'proofpoint', site: 'proofpointcareers', host: 'proofpoint.wd5.myworkdayjobs.com' }] },
  // Darktrace: 76 postings verified live.
  { slug: 'darktrace', name: 'Darktrace', domain: 'darktrace.com', valuationKind: 'unknown',
    industry: 'AI Cyber Defence', hqLocation: 'Cambridge, UK', foundedYear: 2013,
    boards: [{ provider: 'workday', token: 'darktrace', site: 'DarktaceExternal', host: 'darktrace.wd3.myworkdayjobs.com' }] },
  // Fortinet: 939 postings verified live.
  { slug: 'fortinet', name: 'Fortinet', domain: 'fortinet.com', valuationKind: 'unknown',
    industry: 'Network Security', hqLocation: 'Sunnyvale, CA', foundedYear: 2000,
    boards: [{ provider: 'oracle', token: 'fortinet', site: 'CX_2001', host: 'edel.fa.us2.oraclecloud.com', applyHost: 'careers.fortinet.com' }] },
  // KLA: 1004 postings verified live.
  { slug: 'kla', name: 'KLA', domain: 'kla.com', valuationKind: 'unknown',
    industry: 'Semiconductor Process Control', hqLocation: 'Milpitas, CA', foundedYear: 1997,
    boards: [{ provider: 'workday', token: 'kla', site: 'Search', host: 'kla.wd1.myworkdayjobs.com' }] },
  // Analog Devices: 802 postings verified live.
  { slug: 'analog-devices', name: 'Analog Devices', domain: 'analog.com', valuationKind: 'unknown',
    industry: 'Analog & Mixed-Signal Semiconductors', hqLocation: 'Wilmington, MA', foundedYear: 1965,
    boards: [{ provider: 'workday', token: 'analogdevices', site: 'External', host: 'analogdevices.wd1.myworkdayjobs.com' }] },
  // Texas Instruments: 706 postings verified live.
  { slug: 'texas-instruments', name: 'Texas Instruments', domain: 'ti.com', valuationKind: 'unknown',
    industry: 'Semiconductors', hqLocation: 'Dallas, TX', foundedYear: 1930,
    boards: [{ provider: 'oracle', token: 'ti', site: 'CX', host: 'edbz.fa.us2.oraclecloud.com', applyHost: 'careers.ti.com' }] },
  // Marvell Technology: 176 postings verified live.
  { slug: 'marvell', name: 'Marvell Technology', domain: 'marvell.com', valuationKind: 'unknown',
    industry: 'Data Infrastructure Semiconductors', hqLocation: 'Santa Clara, CA', foundedYear: 1995,
    boards: [{ provider: 'workday', token: 'marvell', site: 'MarvellCareers', host: 'marvell.wd1.myworkdayjobs.com' }] },
  // SiFive: 121 postings verified live.
  { slug: 'sifive', name: 'SiFive', domain: 'sifive.com', valuationKind: 'unknown',
    industry: 'RISC-V Processor IP', hqLocation: 'Santa Clara, CA', foundedYear: 2015,
    boards: [{ provider: 'workday', token: 'sifive', site: 'sifivecareers', host: 'sifive.wd1.myworkdayjobs.com' }] },
  // Astera Labs: 46 postings verified live.
  { slug: 'astera-labs', name: 'Astera Labs', domain: 'asteralabs.com', valuationKind: 'unknown',
    industry: 'Connectivity Semiconductors', hqLocation: 'Santa Clara, CA', foundedYear: 2017,
    boards: [{ provider: 'ashby', token: 'astera' }] },
  // Relativity Space: 336 postings verified live.
  { slug: 'relativity-space', name: 'Relativity Space', domain: 'relativityspace.com', valuationKind: 'unknown',
    industry: 'Aerospace / Launch', hqLocation: 'Long Beach, CA', foundedYear: 2015,
    boards: [{ provider: 'greenhouse', token: 'relativity' }] },
  // Boom Supersonic: 10 postings verified live.
  { slug: 'boom-supersonic', name: 'Boom Supersonic', domain: 'boomsupersonic.com', valuationKind: 'unknown',
    industry: 'Aerospace', hqLocation: 'Denver, CO', foundedYear: 2014,
    boards: [{ provider: 'ashby', token: 'boom' }] },
  // SanDisk: 313 postings verified 2026-09-14.
  { slug: 'sandisk', name: 'SanDisk', domain: 'sandisk.com', valuationKind: 'unknown',
    boards: [{ provider: 'smartrecruiters', token: 'Sandisk' }] },
  // Western Digital: 348 postings verified 2026-09-14.
  { slug: 'western-digital', name: 'Western Digital', domain: 'westerndigital.com', valuationKind: 'unknown',
    boards: [{ provider: 'smartrecruiters', token: 'WesternDigital' }] },
  // Honeywell: 1340 postings verified 2026-09-14.
  { slug: 'honeywell', name: 'Honeywell', domain: 'honeywell.com', valuationKind: 'unknown',
    boards: [{ provider: 'oracle', token: 'ibqbjb', site: 'CX_1', host: 'ibqbjb.fa.ocs.oraclecloud.com' }] },
  // Caterpillar: 914 postings verified 2026-09-14.
  { slug: 'caterpillar', name: 'Caterpillar', domain: 'caterpillar.com', valuationKind: 'unknown',
    boards: [{ provider: 'workday', token: 'cat', site: 'CaterpillarCareers', host: 'cat.wd5.myworkdayjobs.com' }] },
  // Ford Motor Company: 813 postings verified 2026-09-14.
  { slug: 'ford-motor-company', name: 'Ford Motor Company', domain: 'ford.com', valuationKind: 'unknown',
    boards: [{ provider: 'oracle', token: 'efds', site: 'CX_1', host: 'efds.fa.em5.oraclecloud.com' }] },
  // Mozilla: 60 postings verified live on Greenhouse board `mozilla`.
  // mozilla.org/careers/listings shows only 21 of them -- the website is a
  // filtered view and the board is the complete source. Both job ids sampled
  // from the website resolve on the board.
  { slug: 'mozilla', name: 'Mozilla', domain: 'mozilla.org', valuationKind: 'unknown',
    industry: 'Browsers & Open Web', hqLocation: 'San Francisco, CA', foundedYear: 1998,
    boards: [{ provider: 'greenhouse', token: 'mozilla' }] },
  // Octopus Energy: 157 postings verified 2026-09-14.
  { slug: 'octopus-energy', name: 'Octopus Energy', domain: 'octopus.energy', valuationKind: 'unknown',
    boards: [{ provider: 'lever', token: 'octoenergy' }] },
  // Contentsquare: 27 postings verified 2026-09-14.
  { slug: 'contentsquare', name: 'Contentsquare', domain: 'contentsquare.com', valuationKind: 'unknown',
    boards: [{ provider: 'lever', token: 'contentsquare' }] },
  // Dataiku: 28 postings verified 2026-09-14.
  { slug: 'dataiku', name: 'Dataiku', domain: 'dataiku.com', valuationKind: 'unknown',
    boards: [{ provider: 'greenhouse', token: 'dataiku' }] },
  // Alan: 119 postings verified 2026-09-14.
  { slug: 'alan', name: 'Alan', domain: 'alan.com', valuationKind: 'unknown',
    boards: [{ provider: 'ashby', token: 'alan' }] },
  // Qonto: 43 postings verified 2026-09-14.
  { slug: 'qonto', name: 'Qonto', domain: 'qonto.com', valuationKind: 'unknown',
    boards: [{ provider: 'lever', token: 'qonto' }] },
  // Pennylane: 148 postings verified 2026-09-14.
  { slug: 'pennylane', name: 'Pennylane', domain: 'pennylane.com', valuationKind: 'unknown',
    boards: [{ provider: 'ashby', token: 'pennylane' }] },
  // Zeptolab: 3 postings verified 2026-09-14.
  { slug: 'zeptolab', name: 'Zeptolab', domain: 'zeptolab.com', valuationKind: 'unknown',
    boards: [{ provider: 'workable', token: 'zeptolab' }] },
  // Freshworks: 138 postings verified 2026-09-14.
  { slug: 'freshworks', name: 'Freshworks', domain: 'freshworks.com', valuationKind: 'unknown',
    boards: [{ provider: 'smartrecruiters', token: 'Freshworks' }] },
  // BrowserStack: 31 postings verified 2026-09-14.
  { slug: 'browserstack', name: 'BrowserStack', domain: 'browserstack.com', valuationKind: 'unknown',
    boards: [{ provider: 'workday', token: 'browserstack', site: 'External', host: 'browserstack.wd3.myworkdayjobs.com' }] },
  // InMobi: 44 postings verified 2026-09-14.
  { slug: 'inmobi', name: 'InMobi', domain: 'inmobi.com', valuationKind: 'unknown',
    boards: [{ provider: 'greenhouse', token: 'glance' }] },
  // SafetyCulture: 39 postings verified 2026-09-14.
  { slug: 'safetyculture', name: 'SafetyCulture', domain: 'safetyculture.com', valuationKind: 'unknown',
    boards: [{ provider: 'ashby', token: 'mitti' }] },
  // Rakuten: 16 postings verified 2026-09-14.
  { slug: 'rakuten', name: 'Rakuten', domain: 'rakuten.com', valuationKind: 'unknown',
    boards: [{ provider: 'workday', token: 'rakuten', site: 'RakutenRewards', host: 'rakuten.wd1.myworkdayjobs.com' }] },
  // Nubank: 119 postings verified 2026-09-14.
  { slug: 'nubank', name: 'Nubank', domain: 'nubank.com.br', valuationKind: 'unknown',
    boards: [{ provider: 'ashby', token: 'nubank' }] },
  // Rappi: 24 postings verified 2026-09-14.
  { slug: 'rappi', name: 'Rappi', domain: 'rappi.com', valuationKind: 'unknown',
    boards: [{ provider: 'workday', token: 'rappi', site: 'Rappi_jobs', host: 'rappi.wd12.myworkdayjobs.com' }] },
  // dLocal: 56 postings verified 2026-09-14.
  { slug: 'dlocal', name: 'dLocal', domain: 'dlocal.com', valuationKind: 'unknown',
    boards: [{ provider: 'lever', token: 'dlocal' }] },
  // Andela: 17 postings verified 2026-09-14.
  { slug: 'andela', name: 'Andela', domain: 'andela.com', valuationKind: 'unknown',
    boards: [{ provider: 'ashby', token: 'andela' }] },
  // Delivery Hero: 980 postings verified live on SmartRecruiters, deep
  // pagination confirmed at offset 500. Autodiscovery's fingerprint pass missed
  // this one -- careers.deliveryhero.com names no vendor anywhere in its HTML --
  // and it was recovered by the token-guess fallback.
  { slug: 'delivery-hero', name: 'Delivery Hero', domain: 'deliveryhero.com',
    ticker: 'DHER.DE', valuationKind: 'public', industry: 'Food Delivery / Q-Commerce',
    hqLocation: 'Berlin, Germany', foundedYear: 2011,
    boards: [{ provider: 'smartrecruiters', token: 'DeliveryHero' }] },
  // Deliveroo: 226 postings verified 2026-09-14.
  { slug: 'deliveroo', name: 'Deliveroo', domain: 'deliveroo.co.uk', valuationKind: 'unknown',
    boards: [{ provider: 'ashby', token: 'Deliveroo' }] },
  // Improbable: 5 postings verified 2026-09-14.
  { slug: 'improbable', name: 'Improbable', domain: 'improbable.io', valuationKind: 'unknown',
    boards: [{ provider: 'ashby', token: 'Improbable' }] },
  // Trainline: 34 postings verified 2026-09-14.
  { slug: 'trainline', name: 'Trainline', domain: 'thetrainline.com', valuationKind: 'unknown',
    boards: [{ provider: 'ashby', token: 'Trainline' }] },
  // Adyen: 223 postings verified 2026-09-14.
  { slug: 'adyen', name: 'Adyen', domain: 'adyen.com', valuationKind: 'unknown',
    boards: [{ provider: 'greenhouse', token: 'Adyen' }] },
  // Mollie: 49 postings verified 2026-09-14.
  { slug: 'mollie', name: 'Mollie', domain: 'mollie.com', valuationKind: 'unknown',
    boards: [{ provider: 'ashby', token: 'Mollie' }] },
  // Wolt: 238 postings verified 2026-09-14.
  { slug: 'wolt', name: 'Wolt', domain: 'wolt.com', valuationKind: 'unknown',
    boards: [{ provider: 'greenhouse', token: 'Wolt' }] },
  // N26: 73 postings verified 2026-09-14.
  { slug: 'n26', name: 'N26', domain: 'n26.com', valuationKind: 'unknown',
    boards: [{ provider: 'greenhouse', token: 'N26' }] },
  // Celonis: 263 postings verified 2026-09-14.
  { slug: 'celonis', name: 'Celonis', domain: 'celonis.com', valuationKind: 'unknown',
    boards: [{ provider: 'greenhouse', token: 'Celonis' }] },
  // Doctolib: 126 postings verified 2026-09-14.
  { slug: 'doctolib', name: 'Doctolib', domain: 'doctolib.fr', valuationKind: 'unknown',
    boards: [{ provider: 'greenhouse', token: 'Doctolib' }] },
  // BlaBlaCar: 11 postings verified 2026-09-14.
  { slug: 'blablacar', name: 'BlaBlaCar', domain: 'blablacar.com', valuationKind: 'unknown',
    boards: [{ provider: 'lever', token: 'blablacar' }] },
  // Cabify: 66 postings verified 2026-09-14.
  { slug: 'cabify', name: 'Cabify', domain: 'cabify.com', valuationKind: 'unknown',
    boards: [{ provider: 'greenhouse', token: 'Cabify' }] },
  // Satispay: 92 postings verified 2026-09-14.
  { slug: 'satispay', name: 'Satispay', domain: 'satispay.com', valuationKind: 'unknown',
    boards: [{ provider: 'ashby', token: 'Satispay' }] },
  // Zego: 1 postings verified 2026-09-14.
  { slug: 'zego', name: 'Zego', domain: 'zego.com', valuationKind: 'unknown',
    boards: [{ provider: 'ashby', token: 'Zego' }] },
  // Swile: 29 postings verified 2026-09-14.
  { slug: 'swile', name: 'Swile', domain: 'swile.co', valuationKind: 'unknown',
    boards: [{ provider: 'lever', token: 'swile' }] },
  // Swiggy: 78 postings verified 2026-09-14.
  { slug: 'swiggy', name: 'Swiggy', domain: 'swiggy.com', valuationKind: 'unknown',
    boards: [{ provider: 'smartrecruiters', token: 'Swiggy' }] },
  // Grab: 421 postings verified 2026-09-14.
  { slug: 'grab', name: 'Grab', domain: 'grab.com', valuationKind: 'unknown',
    boards: [{ provider: 'smartrecruiters', token: 'Grab' }] },
  // GoTo Group: 35 postings verified 2026-09-14.
  { slug: 'goto-group', name: 'GoTo Group', domain: 'gotocompany.com', valuationKind: 'unknown',
    boards: [{ provider: 'lever', token: 'GoToGroup' }] },
  // Canva: 252 postings verified 2026-09-14.
  { slug: 'canva', name: 'Canva', domain: 'canva.com', valuationKind: 'unknown',
    boards: [{ provider: 'smartrecruiters', token: 'Canva' }] },
  // ---- Japan-relevant employers, verified 2026-09-15 -------------------
  // Found by reading each employer's own careers page (scripts/discover-ats.mjs)
  // and probing the platforms already supported here. Japan coverage was 2,393
  // of 130,863 postings; most Japanese companies sit on domestic ATS platforms
  // (HERP, Talentio, jobcan) that have no adapter yet, so these are the ones
  // reachable today.
  // PayPay: 85 postings verified 2026-09-15.
  { slug: 'paypay', name: 'PayPay', domain: 'paypay.ne.jp', valuationKind: 'unknown',
    industry: 'Fintech', hqLocation: 'Tokyo, Japan', foundedYear: 2018,
    boards: [{ provider: 'greenhouse', token: 'paypay' }] },
  // SmartNews: 30 postings verified 2026-09-15.
  { slug: 'smartnews', name: 'SmartNews', domain: 'smartnews.com', valuationKind: 'unknown',
    industry: 'News & Media', hqLocation: 'Tokyo, Japan', foundedYear: 2012,
    boards: [{ provider: 'workable', token: 'smartnews' }] },
  // Autify: 1 posting verified 2026-09-15.
  { slug: 'autify', name: 'Autify', domain: 'autify.com', valuationKind: 'unknown',
    industry: 'Developer Tools', hqLocation: 'Tokyo, Japan', foundedYear: 2016,
    boards: [{ provider: 'lever', token: 'Autify' }] },
  // Tanium: 48 postings verified 2026-09-15. US-headquartered, hires in Japan.
  { slug: 'tanium', name: 'Tanium', domain: 'tanium.com', valuationKind: 'unknown',
    industry: 'Security', hqLocation: 'Kirkland, WA', foundedYear: 2007,
    boards: [{ provider: 'greenhouse', token: 'tanium' }] },
  // Agoda: 299 postings verified 2026-09-15. APAC-wide, including Japan.
  { slug: 'agoda', name: 'Agoda', domain: 'agoda.com', valuationKind: 'unknown',
    industry: 'Travel Marketplace', hqLocation: 'Singapore', foundedYear: 2005,
    boards: [{ provider: 'greenhouse', token: 'agoda' }] },
  // Mercari: 2 postings verified 2026-09-14.
  { slug: 'mercari', name: 'Mercari', domain: 'mercari.com', valuationKind: 'unknown',
    // Workable, not Greenhouse. MEASURED 2026-09-15: greenhouse:Mercari returns
    // 2 postings, workable:mercari returns 142 -- all in Minato City, Tokyo.
    // The Greenhouse board is a near-empty remnant; Workable is where Mercari
    // actually posts.
    boards: [{ provider: 'workable', token: 'mercari' }] },
  // Coupang: 697 postings verified 2026-09-14.
  { slug: 'coupang', name: 'Coupang', domain: 'coupang.com', valuationKind: 'unknown',
    boards: [{ provider: 'greenhouse', token: 'Coupang' }] },
  // Careem: 21 postings verified 2026-09-14.
  { slug: 'careem', name: 'Careem', domain: 'careem.com', valuationKind: 'unknown',
    boards: [{ provider: 'greenhouse', token: 'Careem' }] },
  // Kavak: 9 postings verified 2026-09-14.
  { slug: 'kavak', name: 'Kavak', domain: 'kavak.com', valuationKind: 'unknown',
    boards: [{ provider: 'lever', token: 'kavak' }] },
  // Jumia: 15 postings verified 2026-09-14.
  { slug: 'jumia', name: 'Jumia', domain: 'jumia.com', valuationKind: 'unknown',
    boards: [{ provider: 'greenhouse', token: 'Jumia' }] },
  { slug: 'palantir', name: 'Palantir', domain: 'palantir.com', ticker: 'PLTR', valuationKind: 'public', industry: 'Data Analytics', hqLocation: 'Denver, CO', foundedYear: 2003,
    boards: [{ provider: 'lever', token: 'palantir' }] },
  { slug: 'spotify', name: 'Spotify', domain: 'spotify.com', ticker: 'SPOT', valuationKind: 'public', industry: 'Audio Streaming', hqLocation: 'Stockholm, Sweden', foundedYear: 2006,
    boards: [{ provider: 'lever', token: 'spotify' }] },
  { slug: 'wise', name: 'Wise', domain: 'wise.com', valuationKind: 'unknown', industry: 'Fintech / Payments', hqLocation: 'London, UK', foundedYear: 2011,
    boards: [{ provider: 'greenhouse', token: 'wise' }] },

  // ---- Private companies: curated, each with a source and an as-of date ----
  { slug: 'openai', name: 'OpenAI', domain: 'openai.com', valuationKind: 'private',
    reportedValuationUsd: 500_000_000_000, valuationAsOf: '2025-10-02',
    valuationSource: 'Secondary share sale reported by Reuters/Bloomberg, Oct 2025',
    industry: 'Artificial Intelligence', hqLocation: 'San Francisco, CA', foundedYear: 2015,
    boards: [{ provider: 'ashby', token: 'openai' }] },
  { slug: 'anthropic', name: 'Anthropic', domain: 'anthropic.com', valuationKind: 'private',
    reportedValuationUsd: 183_000_000_000, valuationAsOf: '2025-09-02',
    valuationSource: 'Series F, announced Sep 2025',
    industry: 'Artificial Intelligence', hqLocation: 'San Francisco, CA', foundedYear: 2021,
    boards: [{ provider: 'greenhouse', token: 'anthropic' }] },
  { slug: 'databricks', name: 'Databricks', domain: 'databricks.com', valuationKind: 'private',
    reportedValuationUsd: 100_000_000_000, valuationAsOf: '2025-08-01',
    valuationSource: 'Series K, reported Aug 2025',
    industry: 'Data & AI Platform', hqLocation: 'San Francisco, CA', foundedYear: 2013,
    boards: [{ provider: 'greenhouse', token: 'databricks' }] },
  // ---- Frontier AI labs and AI-native products, verified 11 Sep 2026 ------
  // Valuations here are last publicly reported post-money rounds. They are
  // curated with a source and an as-of date because no free API reports private
  // valuations; the UI must show the date rather than imply currency.
  { slug: 'xai', name: 'xAI', domain: 'x.ai', valuationKind: 'private',
    reportedValuationUsd: 200_000_000_000, valuationAsOf: '2025-12-31',
    valuationSource: 'Last widely reported private round; figure is contested -- treat as approximate',
    industry: 'Artificial Intelligence', hqLocation: 'Palo Alto, CA', foundedYear: 2023,
    boards: [{ provider: 'greenhouse', token: 'xai' }] },
  { slug: 'perplexity', name: 'Perplexity AI', domain: 'perplexity.ai', valuationKind: 'private',
    reportedValuationUsd: 20_000_000_000, valuationAsOf: '2025-09-01',
    valuationSource: 'Reported funding round, Sep 2025',
    industry: 'AI Search', hqLocation: 'San Francisco, CA', foundedYear: 2022,
    boards: [{ provider: 'ashby', token: 'perplexity' }] },
  { slug: 'cursor-anysphere', name: 'Cursor (Anysphere)', domain: 'cursor.com', valuationKind: 'private',
    reportedValuationUsd: 29_300_000_000, valuationAsOf: '2025-11-01',
    valuationSource: 'Series D, reported Nov 2025',
    industry: 'AI Developer Tools', hqLocation: 'San Francisco, CA', foundedYear: 2022,
    boards: [{ provider: 'ashby', token: 'cursor' }] },
  { slug: 'harvey', name: 'Harvey', domain: 'harvey.ai', valuationKind: 'private',
    reportedValuationUsd: 8_000_000_000, valuationAsOf: '2025-06-01',
    valuationSource: 'Series E, reported Jun 2025',
    industry: 'Legal AI', hqLocation: 'San Francisco, CA', foundedYear: 2022,
    boards: [{ provider: 'ashby', token: 'harvey' }] },
  { slug: 'sierra', name: 'Sierra', domain: 'sierra.ai', valuationKind: 'private',
    reportedValuationUsd: 10_000_000_000, valuationAsOf: '2025-09-01',
    valuationSource: 'Reported round, Sep 2025',
    industry: 'Conversational AI', hqLocation: 'San Francisco, CA', foundedYear: 2023,
    boards: [{ provider: 'ashby', token: 'sierra' }] },
  { slug: 'cognition', name: 'Cognition', domain: 'cognition.ai', valuationKind: 'private',
    reportedValuationUsd: 10_200_000_000, valuationAsOf: '2025-08-01',
    valuationSource: 'Reported round following Windsurf acquisition, Aug 2025',
    industry: 'AI Software Engineering', hqLocation: 'San Francisco, CA', foundedYear: 2023,
    boards: [{ provider: 'ashby', token: 'cognition' }] },
  { slug: 'suno', name: 'Suno', domain: 'suno.com', valuationKind: 'private',
    reportedValuationUsd: 2_450_000_000, valuationAsOf: '2025-11-01',
    valuationSource: 'Series C, reported Nov 2025',
    industry: 'Generative Audio', hqLocation: 'Cambridge, MA', foundedYear: 2022,
    boards: [{ provider: 'ashby', token: 'suno' }] },
  // Two distinct employers share the name "Figure" and they are NOT the same
  // company: `figureai` is the humanoid-robotics firm, `figure` is Figure
  // Technologies, a lending/fintech business. Merging them on name would
  // attribute robotics roles to a mortgage company. Separate slugs, separate
  // domains, and this comment so nobody "fixes" it later.
  { slug: 'figure-ai', name: 'Figure AI', domain: 'figure.ai', valuationKind: 'private',
    reportedValuationUsd: 39_000_000_000, valuationAsOf: '2025-09-01',
    valuationSource: 'Series C, reported Sep 2025',
    industry: 'Humanoid Robotics', hqLocation: 'San Jose, CA', foundedYear: 2022,
    boards: [{ provider: 'greenhouse', token: 'figureai' }] },
  { slug: 'figure-technologies', name: 'Figure Technologies', domain: 'figure.com', valuationKind: 'unknown',
    industry: 'Fintech / Lending', hqLocation: 'New York, NY', foundedYear: 2018,
    boards: [{ provider: 'greenhouse', token: 'figure' }] },
  { slug: 'runway', name: 'Runway', domain: 'runwayml.com', valuationKind: 'private',
    reportedValuationUsd: 3_000_000_000, valuationAsOf: '2025-04-01',
    valuationSource: 'Series D, reported Apr 2025',
    industry: 'Generative Video', hqLocation: 'New York, NY', foundedYear: 2018,
    boards: [{ provider: 'ashby', token: 'runway' }] },
  // The Ashby board name is `mistral.ai` -- WITH the dot. `mistral` 404s. The
  // token is whatever the employer typed when they set the board up, and it is
  // not derivable from the company name; this one was read off the careers
  // page's own link to jobs.ashbyhq.com/mistral.ai.
  { slug: 'mistral-ai', name: 'Mistral AI', domain: 'mistral.ai', valuationKind: 'private',
    reportedValuationUsd: 13_700_000_000, valuationAsOf: '2025-09-09',
    valuationSource: 'Series C led by ASML, reported Sep 2025',
    industry: 'Artificial Intelligence', hqLocation: 'Paris, France', foundedYear: 2023,
    boards: [{ provider: 'ashby', token: 'mistral.ai' }] },
  { slug: 'decagon', name: 'Decagon', domain: 'decagon.ai', valuationKind: 'private',
    reportedValuationUsd: 1_500_000_000, valuationAsOf: '2025-06-01',
    valuationSource: 'Series C, reported Jun 2025',
    industry: 'Conversational AI', hqLocation: 'San Francisco, CA', foundedYear: 2023,
    boards: [{ provider: 'ashby', token: 'decagon' }] },
  // Glean and Together AI both render an Ashby board at jobs.ashbyhq.com/<name>
  // whose posting API 404s -- Ashby's JSON feed is opt-in per employer, so a
  // board page existing does not mean a readable feed exists. Both are actually
  // reachable on Greenhouse, which is where we read them.
  { slug: 'glean', name: 'Glean', domain: 'glean.com', valuationKind: 'private',
    reportedValuationUsd: 7_200_000_000, valuationAsOf: '2025-06-01',
    valuationSource: 'Series F, reported Jun 2025',
    industry: 'Enterprise AI Search', hqLocation: 'Palo Alto, CA', foundedYear: 2019,
    boards: [{ provider: 'greenhouse', token: 'gleanwork' }] },
  { slug: 'together-ai', name: 'Together AI', domain: 'together.ai', valuationKind: 'private',
    reportedValuationUsd: 3_300_000_000, valuationAsOf: '2025-02-01',
    valuationSource: 'Series B, reported Feb 2025',
    industry: 'AI Cloud Infrastructure', hqLocation: 'San Francisco, CA', foundedYear: 2022,
    boards: [{ provider: 'greenhouse', token: 'togetherai' }] },

  // ---- Global enterprise, verified live 11 Sep 2026 via scripts/bulk-probe --
  // Each token below answered with live postings before being written down.
  // The ones that took two attempts are noted, because the obvious guess being
  // wrong is the normal case, not the exception.
  { slug: 'hp', name: 'HP', domain: 'hp.com', ticker: 'HPQ', valuationKind: 'public',
    industry: 'Computing Hardware', hqLocation: 'Palo Alto, CA', foundedYear: 1939,
    boards: [{ provider: 'workday', token: 'hp', site: 'ExternalCareerSite', host: 'hp.wd5.myworkdayjobs.com' }] },
  { slug: 'philips', name: 'Philips', domain: 'philips.com', ticker: 'PHG', valuationKind: 'public',
    industry: 'Health Technology', hqLocation: 'Amsterdam, Netherlands', foundedYear: 1891,
    boards: [{ provider: 'workday', token: 'philips', site: 'jobs-and-careers', host: 'philips.wd3.myworkdayjobs.com' }] },
  // Dell runs Oracle Recruiting Cloud, not Workday -- found by following
  // jobs.dell.com, which 302s to enterpriseplatform.dell.com/hcmUI/...
  //
  // The token was `CX_1`, which Oracle's own entry also uses on a different
  // host. Board keys (`source|token`) and job ids (`source:token:sourceId`)
  // carry no host, so the two employers shared a merge key and would have filed
  // roles under each other outright had a requisition number ever repeated --
  // 467 and 2,170 postings that happened not to overlap. Now `careers`, which
  // is the site name jobs.dell.com itself redirects to. Safe to change because
  // this tenant ignores `siteNumber` entirely: CX_1, CX_2, CX_1001 and DELL all
  // return the identical 468 requisitions.
  { slug: 'dell', name: 'Dell Technologies', domain: 'dell.com', ticker: 'DELL', valuationKind: 'public',
    industry: 'Computing Hardware', hqLocation: 'Round Rock, TX', foundedYear: 1984,
    boards: [{ provider: 'custom', token: 'careers', host: 'enterpriseplatform.dell.com' }] },
  { slug: 'servicenow', name: 'ServiceNow', domain: 'servicenow.com', ticker: 'NOW', valuationKind: 'public',
    industry: 'Enterprise Software', hqLocation: 'Santa Clara, CA', foundedYear: 2004,
    boards: [{ provider: 'smartrecruiters', token: 'servicenow' }] },
  // SmartRecruiters tokens are case-sensitive: `BoschGroup` answers, the
  // lowercase `bosch-group` in an older discovered-boards entry does not.
  { slug: 'bosch', name: 'Bosch', domain: 'bosch.com', valuationKind: 'unknown',
    industry: 'Industrial Engineering', hqLocation: 'Gerlingen, Germany', foundedYear: 1886,
    boards: [{ provider: 'smartrecruiters', token: 'BoschGroup' }] },
  { slug: 'datadog', name: 'Datadog', domain: 'datadoghq.com', ticker: 'DDOG', valuationKind: 'public',
    industry: 'Observability', hqLocation: 'New York, NY', foundedYear: 2010,
    boards: [{ provider: 'greenhouse', token: 'datadog' }] },
  { slug: 'spacex', name: 'SpaceX', domain: 'spacex.com', valuationKind: 'private',
    reportedValuationUsd: 400_000_000_000, valuationAsOf: '2025-12-01',
    valuationSource: 'Reported tender offer, Dec 2025',
    industry: 'Aerospace', hqLocation: 'Hawthorne, CA', foundedYear: 2002,
    boards: [{ provider: 'greenhouse', token: 'spacex' }] },
  // Workday site names are not always words: Citi's is the literal "2".
  { slug: 'citi', name: 'Citi', domain: 'citi.com', ticker: 'C', valuationKind: 'public',
    industry: 'Banking', hqLocation: 'New York, NY', foundedYear: 1812,
    // The early-careers site is a second board on the same tenant holding
    // different postings; verified live 2026-09-12 (30 roles).
    boards: [
      { provider: 'workday', token: 'citi', site: '2', host: 'citi.wd5.myworkdayjobs.com' },
      { provider: 'workday', token: 'citi', site: 'Citi_Early_Careers_Events_Site', host: 'citi.wd5.myworkdayjobs.com' },
    ] },
  // CLSA is Citi-adjacent in name only -- a separate tenant, found via Common
  // Crawl and verified live 2026-09-12 (337 roles).
  { slug: 'clsa', name: 'CLSA', domain: 'clsa.com', valuationKind: 'unknown',
    industry: 'Investment Banking', hqLocation: 'Hong Kong', foundedYear: 1986,
    boards: [{ provider: 'workday', token: 'citicclsa', site: 'External', host: 'citicclsa.wd3.myworkdayjobs.com' }] },
  // wd103 -- shard numbers go well beyond the wd1/wd3/wd5 most tenants use, so
  // a sweep that only tries the common ones misses employers this large.
  { slug: 'accenture', name: 'Accenture', domain: 'accenture.com', ticker: 'ACN', valuationKind: 'public',
    industry: 'Consulting', hqLocation: 'Dublin, Ireland', foundedYear: 1989,
    boards: [{ provider: 'workday', token: 'accenture', site: 'AccentureCareers', host: 'accenture.wd103.myworkdayjobs.com' }] },
  { slug: 'micron', name: 'Micron Technology', domain: 'micron.com', ticker: 'MU', valuationKind: 'public',
    industry: 'Semiconductors', hqLocation: 'Boise, ID', foundedYear: 1978,
    boards: [{ provider: 'workday', token: 'micron', site: 'External', host: 'micron.wd1.myworkdayjobs.com' }] },
  { slug: 'applied-materials', name: 'Applied Materials', domain: 'appliedmaterials.com', ticker: 'AMAT', valuationKind: 'public',
    industry: 'Semiconductor Equipment', hqLocation: 'Santa Clara, CA', foundedYear: 1967,
    boards: [{ provider: 'workday', token: 'amat', site: 'External', host: 'amat.wd1.myworkdayjobs.com' }] },
  { slug: 'target', name: 'Target', domain: 'target.com', ticker: 'TGT', valuationKind: 'public',
    industry: 'Retail', hqLocation: 'Minneapolis, MN', foundedYear: 1902,
    boards: [{ provider: 'workday', token: 'target', site: 'targetcareers', host: 'target.wd5.myworkdayjobs.com' }] },
  { slug: 'boeing', name: 'Boeing', domain: 'boeing.com', ticker: 'BA', valuationKind: 'public',
    industry: 'Aerospace & Defense', hqLocation: 'Arlington, VA', foundedYear: 1916,
    boards: [{ provider: 'workday', token: 'boeing', site: 'EXTERNAL_CAREERS', host: 'boeing.wd1.myworkdayjobs.com' }] },

  // ---- Solana ecosystem, verified live 11 Sep 2026 ------------------------
  //
  // A note on what "Solana" means as an employer, because it is not one thing:
  //
  //   solana.com/careers  302s to jobs.solana.com, which is an ECOSYSTEM board
  //     aggregating postings from independent companies building on Solana. It
  //     is not Solana Labs' own board, and treating it as one would file other
  //     companies' jobs under Solana.
  //
  //   Solana Labs' own board is Ashby `solanalabs`. SOLANA MOBILE IS NOT A
  //     SEPARATE EMPLOYER -- its roles post to the same board and are
  //     distinguished by Ashby's `team` field ("Solana Mobile" vs "Solana
  //     Labs"). Registering it separately would double-count the same postings.
  //
  // The ecosystem companies below were discovered from that board's own links
  // and each verified against its ATS before being added here.
  { slug: 'solana-labs', name: 'Solana Labs', domain: 'solanalabs.com', valuationKind: 'unknown',
    industry: 'Blockchain Infrastructure', hqLocation: 'San Francisco, CA', foundedYear: 2018,
    boards: [{ provider: 'ashby', token: 'solanalabs' }] },
  { slug: 'phantom', name: 'Phantom', domain: 'phantom.com', valuationKind: 'private',
    reportedValuationUsd: 3_000_000_000, valuationAsOf: '2025-01-01',
    valuationSource: 'Series C, reported Jan 2025',
    industry: 'Crypto Wallet', hqLocation: 'Remote-first', foundedYear: 2021,
    boards: [{ provider: 'ashby', token: 'phantom' }] },
  { slug: 'ondo-finance', name: 'Ondo Finance', domain: 'ondo.finance', valuationKind: 'unknown',
    industry: 'Tokenised Securities', hqLocation: 'New York, NY', foundedYear: 2021,
    boards: [{ provider: 'greenhouse', token: 'ondofinance' }] },
  { slug: 'wormhole-labs', name: 'Wormhole Labs', domain: 'wormhole.com', valuationKind: 'unknown',
    industry: 'Cross-chain Infrastructure', hqLocation: 'Remote-first', foundedYear: 2021,
    boards: [{ provider: 'ashby', token: 'wormholelabs' }] },
  // Ashby token carries the .xyz -- `dourolabs` alone 404s, same trap as Mistral.
  { slug: 'douro-labs', name: 'Douro Labs', domain: 'dourolabs.xyz', valuationKind: 'unknown',
    industry: 'Blockchain Oracles (Pyth)', hqLocation: 'Remote-first', foundedYear: 2023,
    boards: [{ provider: 'ashby', token: 'dourolabs.xyz' }] },
  { slug: 'magic-eden', name: 'Magic Eden', domain: 'magiceden.io', valuationKind: 'private',
    reportedValuationUsd: 1_600_000_000, valuationAsOf: '2022-06-01',
    valuationSource: 'Series B, Jun 2022 -- note the age of this figure',
    industry: 'NFT Marketplace', hqLocation: 'Remote-first', foundedYear: 2021,
    boards: [{ provider: 'ashby', token: 'magiceden' }] },
  { slug: 'helius', name: 'Helius', domain: 'helius.dev', valuationKind: 'unknown',
    industry: 'Blockchain RPC Infrastructure', hqLocation: 'Remote-first', foundedYear: 2022,
    boards: [{ provider: 'ashby', token: 'helius' }] },
  { slug: 'rain-cards', name: 'Rain', domain: 'rain.xyz', valuationKind: 'unknown',
    industry: 'Crypto Card Issuing', hqLocation: 'Remote-first', foundedYear: 2021,
    boards: [{ provider: 'ashby', token: 'rain' }] },
  { slug: 'baton', name: 'Baton', domain: 'baton.finance', valuationKind: 'unknown',
    industry: 'Crypto Finance', hqLocation: 'Remote-first',
    boards: [{ provider: 'ashby', token: 'batoncorporation' }] },
  { slug: 'edisyl', name: 'Edisyl', domain: 'edisyl.com', valuationKind: 'unknown',
    industry: 'Crypto', hqLocation: 'Remote-first',
    boards: [{ provider: 'ashby', token: 'edisyl' }] },
  { slug: 'fomo-labs', name: 'Fomo Labs', domain: 'fomo.xyz', valuationKind: 'unknown',
    industry: 'Crypto', hqLocation: 'Remote-first',
    boards: [{ provider: 'ashby', token: 'fomo-labs' }] },

  // ---- Blockchain / digital assets, verified live 11 Sep 2026 -------------
  // Exchanges, infrastructure and protocol teams. Valuations are almost all
  // `unknown` here on purpose: private crypto valuations are widely repeated
  // from funding rounds that are years stale, and a token's market cap is not
  // the company's worth -- inventing either would be exactly the confident
  // wrong number this registry avoids.
  { slug: 'anza', name: 'Anza', domain: 'anza.xyz', valuationKind: 'unknown',
    industry: 'Blockchain Core Engineering', hqLocation: 'Remote-first', foundedYear: 2024,
    boards: [{ provider: 'workable', token: 'anza-xyz' }] },
  { slug: 'jito', name: 'Jito', domain: 'jito.network', valuationKind: 'unknown',
    industry: 'Solana MEV Infrastructure', hqLocation: 'Remote-first', foundedYear: 2022,
    boards: [{ provider: 'lever', token: 'jito' }] },
  { slug: 'binance', name: 'Binance', domain: 'binance.com', valuationKind: 'unknown',
    industry: 'Crypto Exchange', hqLocation: 'Remote-first', foundedYear: 2017,
    boards: [{ provider: 'lever', token: 'binance' }] },
  { slug: 'okx', name: 'OKX', domain: 'okx.com', valuationKind: 'unknown',
    industry: 'Crypto Exchange', hqLocation: 'Seychelles', foundedYear: 2017,
    boards: [{ provider: 'greenhouse', token: 'okx' }] },
  { slug: 'bybit', name: 'Bybit', domain: 'bybit.com', valuationKind: 'unknown',
    industry: 'Crypto Exchange', hqLocation: 'Dubai, UAE', foundedYear: 2018,
    boards: [{ provider: 'greenhouse', token: 'bybit' }] },
  { slug: 'gemini', name: 'Gemini', domain: 'gemini.com', valuationKind: 'unknown',
    industry: 'Crypto Exchange', hqLocation: 'New York, NY', foundedYear: 2014,
    boards: [{ provider: 'greenhouse', token: 'gemini' }] },
  { slug: 'bitso', name: 'Bitso', domain: 'bitso.com', valuationKind: 'unknown',
    industry: 'Crypto Exchange (LatAm)', hqLocation: 'Mexico City, Mexico', foundedYear: 2014,
    boards: [{ provider: 'greenhouse', token: 'bitso' }] },
  { slug: 'bitpanda', name: 'Bitpanda', domain: 'bitpanda.com', valuationKind: 'unknown',
    industry: 'Crypto Exchange (EU)', hqLocation: 'Vienna, Austria', foundedYear: 2014,
    boards: [{ provider: 'greenhouse', token: 'bitpanda' }] },
  { slug: 'fireblocks', name: 'Fireblocks', domain: 'fireblocks.com', valuationKind: 'unknown',
    industry: 'Digital Asset Custody', hqLocation: 'New York, NY', foundedYear: 2018,
    boards: [{ provider: 'greenhouse', token: 'fireblocks' }] },
  { slug: 'anchorage-digital', name: 'Anchorage Digital', domain: 'anchorage.com', valuationKind: 'unknown',
    industry: 'Digital Asset Bank', hqLocation: 'San Francisco, CA', foundedYear: 2017,
    boards: [{ provider: 'lever', token: 'anchorage' }] },
  { slug: 'alchemy', name: 'Alchemy', domain: 'alchemy.com', valuationKind: 'unknown',
    industry: 'Blockchain Developer Platform', hqLocation: 'San Francisco, CA', foundedYear: 2017,
    boards: [{ provider: 'ashby', token: 'alchemy' }] },
  { slug: 'uniswap-labs', name: 'Uniswap Labs', domain: 'uniswap.org', valuationKind: 'unknown',
    industry: 'Decentralised Exchange', hqLocation: 'New York, NY', foundedYear: 2018,
    boards: [{ provider: 'ashby', token: 'uniswap' }] },
  { slug: 'offchain-labs', name: 'Offchain Labs', domain: 'offchainlabs.com', valuationKind: 'unknown',
    industry: 'Ethereum L2 (Arbitrum)', hqLocation: 'Princeton, NJ', foundedYear: 2018,
    boards: [{ provider: 'lever', token: 'offchainlabs' }] },
  { slug: 'aptos-labs', name: 'Aptos Labs', domain: 'aptoslabs.com', valuationKind: 'unknown',
    industry: 'Layer 1 Blockchain', hqLocation: 'Palo Alto, CA', foundedYear: 2022,
    boards: [{ provider: 'greenhouse', token: 'aptoslabs' }] },
  { slug: 'mysten-labs', name: 'Mysten Labs', domain: 'mystenlabs.com', valuationKind: 'unknown',
    industry: 'Layer 1 Blockchain (Sui)', hqLocation: 'Palo Alto, CA', foundedYear: 2021,
    boards: [{ provider: 'ashby', token: 'mystenlabs' }] },
  { slug: 'immutable', name: 'Immutable', domain: 'immutable.com', valuationKind: 'unknown',
    industry: 'Blockchain Gaming', hqLocation: 'Sydney, Australia', foundedYear: 2018,
    boards: [{ provider: 'lever', token: 'immutable' }] },
  { slug: 'blockdaemon', name: 'Blockdaemon', domain: 'blockdaemon.com', valuationKind: 'unknown',
    industry: 'Blockchain Node Infrastructure', hqLocation: 'Los Angeles, CA', foundedYear: 2017,
    boards: [{ provider: 'ashby', token: 'blockdaemon' }] },
  { slug: 'ledger', name: 'Ledger', domain: 'ledger.com', valuationKind: 'unknown',
    industry: 'Hardware Wallets', hqLocation: 'Paris, France', foundedYear: 2014,
    boards: [{ provider: 'lever', token: 'ledger' }] },
  // Crypto-native venture firms. They hire engineers directly, and their
  // portfolio-company boards are a discovery surface of their own.
  { slug: 'a16z-crypto', name: 'a16z crypto', domain: 'a16zcrypto.com', valuationKind: 'unknown',
    industry: 'Venture Capital (Crypto)', hqLocation: 'Menlo Park, CA', foundedYear: 2018,
    boards: [{ provider: 'greenhouse', token: 'a16z' }] },
  { slug: 'paradigm-vc', name: 'Paradigm', domain: 'paradigm.xyz', valuationKind: 'unknown',
    industry: 'Venture Capital (Crypto)', hqLocation: 'San Francisco, CA', foundedYear: 2018,
    boards: [{ provider: 'greenhouse', token: 'paradigm' }] },

  // ---- Stablecoins, custody and security audit, verified 11 Sep 2026 ------
  // The employers behind tokenised-dollar rails and the firms that audit them.
  { slug: 'blackrock', name: 'BlackRock', domain: 'blackrock.com', ticker: 'BLK', valuationKind: 'public',
    industry: 'Asset Management', hqLocation: 'New York, NY', foundedYear: 1988,
    boards: [{ provider: 'workday', token: 'blackrock', site: 'BlackRock_Professional', host: 'blackrock.wd1.myworkdayjobs.com' }] },
  // Recruitee, not the usual three -- found by following tether.io/careers.
  { slug: 'tether', name: 'Tether', domain: 'tether.io', valuationKind: 'unknown',
    industry: 'Stablecoin Issuer (USDT)', hqLocation: 'El Salvador', foundedYear: 2014,
    boards: [{ provider: 'recruitee', token: 'tether' }] },
  { slug: 'paxos', name: 'Paxos', domain: 'paxos.com', valuationKind: 'unknown',
    industry: 'Stablecoin Infrastructure (USDP/PYUSD)', hqLocation: 'New York, NY', foundedYear: 2012,
    boards: [{ provider: 'ashby', token: 'paxos' }] },
  // Ashby token carries the TLD: `kraken.com`, not `kraken`. Third instance of
  // this shape in the registry (Mistral, Douro Labs) -- it is a convention some
  // employers pick at setup, not a one-off.
  { slug: 'kraken', name: 'Kraken', domain: 'kraken.com', valuationKind: 'unknown',
    industry: 'Crypto Exchange', hqLocation: 'San Francisco, CA', foundedYear: 2011,
    boards: [{ provider: 'ashby', token: 'kraken.com' }] },
  { slug: 'animoca-brands', name: 'Animoca Brands', domain: 'animocabrands.com', valuationKind: 'unknown',
    industry: 'Web3 Gaming & Ventures', hqLocation: 'Hong Kong', foundedYear: 2014,
    boards: [{ provider: 'lever', token: 'animocabrands' }] },

  // Security audit and bug-bounty firms. They sit next to the issuers in the
  // same supply chain, and they hire the reverse-engineering skill set that has
  // no other obvious home in this registry.
  { slug: 'certik', name: 'CertiK', domain: 'certik.com', valuationKind: 'unknown',
    industry: 'Smart Contract Auditing', hqLocation: 'New York, NY', foundedYear: 2018,
    boards: [{ provider: 'lever', token: 'certik' }] },
  { slug: 'openzeppelin', name: 'OpenZeppelin', domain: 'openzeppelin.com', valuationKind: 'unknown',
    industry: 'Smart Contract Security', hqLocation: 'Remote-first', foundedYear: 2015,
    boards: [{ provider: 'greenhouse', token: 'openzeppelin' }] },
  { slug: 'trail-of-bits', name: 'Trail of Bits', domain: 'trailofbits.com', valuationKind: 'unknown',
    industry: 'Security Research & Auditing', hqLocation: 'New York, NY', foundedYear: 2012,
    boards: [{ provider: 'workable', token: 'trailofbits' }] },
  { slug: 'hackerone', name: 'HackerOne', domain: 'hackerone.com', valuationKind: 'unknown',
    industry: 'Bug Bounty Platform', hqLocation: 'San Francisco, CA', foundedYear: 2012,
    boards: [{ provider: 'ashby', token: 'hackerone' }] },
  { slug: 'bugcrowd', name: 'Bugcrowd', domain: 'bugcrowd.com', valuationKind: 'unknown',
    industry: 'Bug Bounty Platform', hqLocation: 'San Francisco, CA', foundedYear: 2012,
    boards: [{ provider: 'greenhouse', token: 'bugcrowd' }] },

  // ---- Alphabet subsidiaries, verified live 11 Sep 2026 ------------------
  //
  // GOOGLE ITSELF IS DELIBERATELY ABSENT. www.google.com/robots.txt line 249:
  //
  //     Disallow: /about/careers/applications/jobs/results
  //
  // That is a prefix rule, so it covers the listing AND every individual job
  // page. Google prohibits crawling its own job pages, and this project reads
  // only what an employer permits -- the same rule that keeps LinkedIn and
  // Indeed out (lib/ats/types.ts).
  //
  // Independently confirmed: Common Crawl, which honours robots.txt, has ZERO
  // records for that path while returning results for careers.google.com's
  // homepage. Two sources agreeing is what makes this a fact rather than a
  // reading of the syntax.
  //
  // These subsidiaries are separate legal entities running ordinary public
  // Greenhouse boards, so they are read the same way as any other employer.
  { slug: 'waymo', name: 'Waymo', domain: 'waymo.com', valuationKind: 'private',
    reportedValuationUsd: 45_000_000_000, valuationAsOf: '2024-10-25',
    valuationSource: 'Series C, reported Oct 2024',
    industry: 'Autonomous Vehicles', hqLocation: 'Mountain View, CA', foundedYear: 2009,
    boards: [{ provider: 'greenhouse', token: 'waymo' }] },
  { slug: 'wing', name: 'Wing', domain: 'wing.com', valuationKind: 'unknown',
    industry: 'Drone Delivery', hqLocation: 'Palo Alto, CA', foundedYear: 2012,
    boards: [{ provider: 'greenhouse', token: 'wing' }] },
  // The board token is `moonshot`, not `x` or `xdevelopment` -- X's own
  // shorthand for itself ("the moonshot factory"), and not derivable from
  // either its legal or trading name.
  { slug: 'x-development', name: 'X, the moonshot factory', domain: 'x.company', valuationKind: 'unknown',
    industry: 'Advanced Technology R&D', hqLocation: 'Mountain View, CA', foundedYear: 2010,
    boards: [{ provider: 'greenhouse', token: 'moonshot' }] },
  { slug: 'isomorphic-labs', name: 'Isomorphic Labs', domain: 'isomorphiclabs.com', valuationKind: 'unknown',
    industry: 'AI Drug Discovery', hqLocation: 'London, UK', foundedYear: 2021,
    boards: [{ provider: 'greenhouse', token: 'isomorphiclabs' }] },

  // ---- India tech, verified live 11 Sep 2026 ------------------------------
  //
  // FLIPKART AND JUSPAY ARE DELIBERATELY ABSENT -- see the note below this block.
  { slug: 'postman', name: 'Postman', domain: 'postman.com', valuationKind: 'private',
    reportedValuationUsd: 5_600_000_000, valuationAsOf: '2021-08-01',
    valuationSource: 'Series D, Aug 2021 -- note the age of this figure',
    industry: 'API Developer Tools', hqLocation: 'San Francisco, CA', foundedYear: 2014,
    boards: [{ provider: 'greenhouse', token: 'postman' }] },
  // The board token is the full legal name, `razorpaysoftwareprivatelimited`.
  // `razorpay` 404s. Read off razorpay.com/jobs, not guessed.
  { slug: 'razorpay', name: 'Razorpay', domain: 'razorpay.com', valuationKind: 'private',
    reportedValuationUsd: 7_500_000_000, valuationAsOf: '2021-12-01',
    valuationSource: 'Series F, Dec 2021 -- note the age of this figure',
    industry: 'Payments', hqLocation: 'Bangalore, India', foundedYear: 2014,
    boards: [{ provider: 'greenhouse', token: 'razorpaysoftwareprivatelimited' }] },
  { slug: 'meesho', name: 'Meesho', domain: 'meesho.com', valuationKind: 'unknown',
    industry: 'E-commerce', hqLocation: 'Bangalore, India', foundedYear: 2015,
    boards: [{ provider: 'lever', token: 'meesho' }] },
  { slug: 'cred', name: 'CRED', domain: 'cred.club', valuationKind: 'unknown',
    industry: 'Fintech', hqLocation: 'Bangalore, India', foundedYear: 2018,
    boards: [{ provider: 'lever', token: 'cred' }] },
  { slug: 'zeta', name: 'Zeta', domain: 'zeta.tech', valuationKind: 'unknown',
    industry: 'Banking Technology', hqLocation: 'Bangalore, India', foundedYear: 2015,
    boards: [{ provider: 'lever', token: 'zeta' }] },
  { slug: 'navi', name: 'Navi', domain: 'navi.com', valuationKind: 'unknown',
    industry: 'Fintech', hqLocation: 'Bangalore, India', foundedYear: 2018,
    boards: [{ provider: 'ashby', token: 'navi' }] },
  { slug: 'groww', name: 'Groww', domain: 'groww.in', valuationKind: 'unknown',
    industry: 'Investing Platform', hqLocation: 'Bangalore, India', foundedYear: 2016,
    boards: [{ provider: 'greenhouse', token: 'groww' }] },

  // eBay runs Phenom People, which exposes no public JSON feed -- but its
  // careers site publishes a sitemap listing every posting, and each job page
  // carries complete schema.org JobPosting markup. Its robots.txt explicitly
  // allows those pages (only */apply and chatbot paths are disallowed), so this
  // is read the way the employer intends search engines to read it.
  //
  // Notably this yields BETTER data than most ATS list endpoints: full
  // descriptions (7-10k chars) and real posted dates, both of which Workday and
  // SmartRecruiters omit at list time.
  //
  // `site` is the careers landing page; CustomSiteAdapter finds the sitemap.
  { slug: 'ebay', name: 'eBay', domain: 'ebay.com', ticker: 'EBAY', valuationKind: 'public',
    industry: 'E-commerce Marketplace', hqLocation: 'San Jose, CA', foundedYear: 1995,
    boards: [{ provider: 'custom', token: 'ebay', host: 'jobs.ebayinc.com', site: 'https://jobs.ebayinc.com/us/en' }] },

  { slug: 'stripe', name: 'Stripe', domain: 'stripe.com', valuationKind: 'private',
    reportedValuationUsd: 106_500_000_000, valuationAsOf: '2025-02-27',
    valuationSource: 'Tender offer, Feb 2025',
    industry: 'Payments Infrastructure', hqLocation: 'South San Francisco, CA', foundedYear: 2010,
    boards: [{ provider: 'greenhouse', token: 'stripe' }] },
  { slug: 'figma', name: 'Figma', domain: 'figma.com', valuationKind: 'unknown',
    industry: 'Design Software', hqLocation: 'San Francisco, CA', foundedYear: 2012,
    boards: [{ provider: 'greenhouse', token: 'figma' }] },
  // Cloudflare's Greenhouse board puts the WORKPLACE TYPE in `location.name`
  // -- every posting reads "Hybrid", "Remote" or "In-Office" -- and keeps the
  // real geography in `offices`. See greenhouseLocation() in
  // lib/sources/adapters/ats.ts; without it 274 of their 283 indexed roles had
  // no city and no country and matched no location filter.
  { slug: 'cloudflare', name: 'Cloudflare', domain: 'cloudflare.com', ticker: 'NET', valuationKind: 'public',
    industry: 'Internet Infrastructure', hqLocation: 'San Francisco, CA', foundedYear: 2009,
    boards: [{ provider: 'greenhouse', token: 'cloudflare' }] },

  // AT&T runs two Workday sites on the same `att` tenant and they are NOT
  // duplicates: ATTGeneral carries the standing requisitions (1,288 live at
  // registration) and ATTCollege carries the internship and graduate-programme
  // intake (9). Registering only the first silently drops every early-career
  // role, which is the half this site most needs.
  //
  // att.jobs is their marketing careers site and its robots.txt disallows
  // /search-jobs/, so the Workday feed below is the route the employer
  // actually publishes.
  { slug: 'att', name: 'AT&T', domain: 'att.com', ticker: 'T', valuationKind: 'public',
    industry: 'Telecommunications', hqLocation: 'Dallas, TX', foundedYear: 1983,
    boards: [
      { provider: 'workday', token: 'att', site: 'ATTGeneral', host: 'att.wd1.myworkdayjobs.com' },
      { provider: 'workday', token: 'att', site: 'ATTCollege', host: 'att.wd1.myworkdayjobs.com' },
    ] },
  { slug: 'scale-ai', name: 'Scale AI', domain: 'scale.com', valuationKind: 'private',
    reportedValuationUsd: 29_000_000_000, valuationAsOf: '2025-06-13',
    valuationSource: 'Meta investment, Jun 2025',
    industry: 'AI Data Infrastructure', hqLocation: 'San Francisco, CA', foundedYear: 2016,
    boards: [{ provider: 'greenhouse', token: 'scaleai' }] },
  { slug: 'brex', name: 'Brex', domain: 'brex.com', valuationKind: 'private',
    reportedValuationUsd: 12_300_000_000, valuationAsOf: '2024-10-01',
    valuationSource: 'Series D-2, Oct 2024',
    industry: 'Corporate Fintech', hqLocation: 'San Francisco, CA', foundedYear: 2017,
    boards: [{ provider: 'greenhouse', token: 'brex' }] },
  { slug: 'discord', name: 'Discord', domain: 'discord.com', valuationKind: 'private',
    reportedValuationUsd: 14_800_000_000, valuationAsOf: '2021-09-15',
    valuationSource: 'Series H, Sep 2021 (no newer public figure)',
    industry: 'Communications', hqLocation: 'San Francisco, CA', foundedYear: 2015,
    boards: [{ provider: 'greenhouse', token: 'discord' }] },
  { slug: 'flexport', name: 'Flexport', domain: 'flexport.com', valuationKind: 'private',
    reportedValuationUsd: 8_000_000_000, valuationAsOf: '2022-02-01',
    valuationSource: 'Series E, Feb 2022',
    industry: 'Logistics', hqLocation: 'San Francisco, CA', foundedYear: 2013,
    boards: [{ provider: 'greenhouse', token: 'flexport' }] },
  { slug: 'monzo', name: 'Monzo', domain: 'monzo.com', valuationKind: 'private',
    reportedValuationUsd: 5_900_000_000, valuationAsOf: '2025-03-01',
    valuationSource: 'Secondary sale reported Mar 2025',
    industry: 'Digital Banking', hqLocation: 'London, UK', foundedYear: 2015,
    boards: [{ provider: 'greenhouse', token: 'monzo' }] },
  { slug: 'supabase', name: 'Supabase', domain: 'supabase.com', valuationKind: 'private',
    reportedValuationUsd: 5_000_000_000, valuationAsOf: '2025-09-01',
    valuationSource: 'Series E, reported Sep 2025',
    industry: 'Developer Platform', hqLocation: 'Remote-first', foundedYear: 2020,
    boards: [{ provider: 'ashby', token: 'supabase' }] },
  { slug: 'replit', name: 'Replit', domain: 'replit.com', valuationKind: 'private',
    reportedValuationUsd: 3_000_000_000, valuationAsOf: '2025-09-01',
    valuationSource: 'Series C, reported Sep 2025',
    industry: 'Developer Tools', hqLocation: 'Foster City, CA', foundedYear: 2016,
    boards: [{ provider: 'ashby', token: 'replit' }] },
  { slug: 'linear', name: 'Linear', domain: 'linear.app', valuationKind: 'private',
    reportedValuationUsd: 1_250_000_000, valuationAsOf: '2025-06-01',
    valuationSource: 'Series C, Jun 2025',
    industry: 'Developer Tools', hqLocation: 'Remote-first', foundedYear: 2019,
    boards: [{ provider: 'ashby', token: 'linear' }] },
  { slug: 'notion', name: 'Notion', domain: 'notion.so', valuationKind: 'private',
    reportedValuationUsd: 10_000_000_000, valuationAsOf: '2021-10-08',
    valuationSource: 'Series C, Oct 2021 (no newer public figure)',
    industry: 'Productivity Software', hqLocation: 'San Francisco, CA', foundedYear: 2013,
    boards: [{ provider: 'ashby', token: 'notion' }] },
  { slug: 'cohere', name: 'Cohere', domain: 'cohere.com', valuationKind: 'private',
    reportedValuationUsd: 6_800_000_000, valuationAsOf: '2025-08-14',
    valuationSource: 'Series D extension, Aug 2025',
    industry: 'Artificial Intelligence', hqLocation: 'Toronto, Canada', foundedYear: 2019,
    boards: [{ provider: 'ashby', token: 'cohere' }] },
  { slug: 'posthog', name: 'PostHog', domain: 'posthog.com', valuationKind: 'private',
    reportedValuationUsd: 920_000_000, valuationAsOf: '2025-05-01',
    valuationSource: 'Series D, May 2025',
    industry: 'Product Analytics', hqLocation: 'Remote-first', foundedYear: 2020,
    boards: [{ provider: 'ashby', token: 'posthog' }] },
  { slug: 'clickhouse', name: 'ClickHouse', domain: 'clickhouse.com', valuationKind: 'private',
    reportedValuationUsd: 6_350_000_000, valuationAsOf: '2025-05-28',
    valuationSource: 'Series C, May 2025',
    industry: 'Database', hqLocation: 'Portola Valley, CA', foundedYear: 2021,
    boards: [{ provider: 'ashby', token: 'clickhouse' }] },
  { slug: 'elevenlabs', name: 'ElevenLabs', domain: 'elevenlabs.io', valuationKind: 'private',
    reportedValuationUsd: 3_300_000_000, valuationAsOf: '2025-01-30',
    valuationSource: 'Series C, Jan 2025',
    industry: 'Artificial Intelligence', hqLocation: 'New York, NY', foundedYear: 2022,
    boards: [{ provider: 'ashby', token: 'elevenlabs' }] },

  // ---- Banks and financial institutions ----------------------------------
  // Every board below answered with live postings on 10 Sep 2026 (see
  // scripts/probe-tokens.mjs). Workday tenant names are NOT derivable from
  // company names -- Standard Chartered runs on `peopleplus`, NatWest on `rbs`,
  // Bank of America on `ghr` -- so each was found and verified, not guessed.
  { slug: 'bank-of-america', name: 'Bank of America', domain: 'bankofamerica.com', ticker: 'BAC', valuationKind: 'public', industry: 'Banking', hqLocation: 'Charlotte, NC', foundedYear: 1904,
    boards: [{ provider: 'workday', token: 'ghr', site: 'Lateral-US', host: 'ghr.wd1.myworkdayjobs.com' }] },
  // JPMorgan runs Oracle Recruiting Cloud, not Workday -- so the board rides
  // the `custom` SourceId and is routed to OracleRecruitingAdapter by its
  // *.oraclecloud.com host (see lib/sources/registry.ts). The token is the ORC
  // site number. 7,464 live requisitions, verified 11 Sep 2026.
  { slug: 'jpmorgan-chase', name: 'JPMorgan Chase', domain: 'jpmorganchase.com', ticker: 'JPM', valuationKind: 'public', industry: 'Banking', hqLocation: 'New York, NY', foundedYear: 1799,
    boards: [{ provider: 'custom', token: 'CX_1001', host: 'jpmc.fa.oraclecloud.com' }] },
  // Trip.com Group runs MokaHR. `token` is the MokaHR org id and `site` is the
  // numeric site id, both taken from the link careers.trip.com publishes:
  // hire-r1.mokahr.com/apply/tripoverseas/100000877
  //
  // This is the Experienced Hire Portal (site type "social"). The group also
  // runs a separate CAMPUS site on app.mokahr.com and Chinese-market portals at
  // careers.ctrip.com; those are different sites and are not covered by this
  // entry. 216 live postings, verified 12 Sep 2026.
  { slug: 'trip-com-group', name: 'Trip.com Group', domain: 'trip.com', ticker: 'TCOM', valuationKind: 'public', industry: 'Online Travel', hqLocation: 'Shanghai, China', foundedYear: 1999,
    boards: [{ provider: 'mokahr', token: 'tripoverseas', site: '100000877', host: 'hire-r1.mokahr.com' }] },
  // BNY also runs Oracle Recruiting Cloud, on a different pod. The token here
  // is the site NAME rather than a `CX_<n>` number, taken from the link on
  // bny.com's own careers page; the host is what routes it to the ORC adapter.
  //
  // Worth knowing: this tenant ignores `siteNumber` entirely -- BNY-Careers,
  // CX_1, CX_2 and CX_3 all return the identical 1,374 requisitions. So a
  // "working" site number here is NOT evidence that the number is right, and
  // probing one proves nothing about the others. The name is used because it is
  // the one the employer publishes. 1,374 live requisitions, verified 11 Sep 2026.
  { slug: 'bny-mellon', name: 'BNY', domain: 'bny.com', ticker: 'BK', valuationKind: 'public', industry: 'Custody Banking / Asset Servicing', hqLocation: 'New York, NY', foundedYear: 1784,
    boards: [{ provider: 'custom', token: 'BNY-Careers', host: 'eofe.fa.us2.oraclecloud.com' }] },
  { slug: 'wells-fargo', name: 'Wells Fargo', domain: 'wellsfargo.com', ticker: 'WFC', valuationKind: 'public', industry: 'Banking', hqLocation: 'San Francisco, CA', foundedYear: 1852,
    boards: [{ provider: 'workday', token: 'wf', site: 'WellsFargoJobs', host: 'wf.wd1.myworkdayjobs.com' }] },
  { slug: 'morgan-stanley', name: 'Morgan Stanley', domain: 'morganstanley.com', ticker: 'MS', valuationKind: 'public', industry: 'Investment Banking', hqLocation: 'New York, NY', foundedYear: 1935,
    boards: [{ provider: 'workday', token: 'ms', site: 'External', host: 'ms.wd5.myworkdayjobs.com' }] },
  { slug: 'deutsche-bank', name: 'Deutsche Bank', domain: 'db.com', ticker: 'DB', valuationKind: 'public', industry: 'Investment Banking', hqLocation: 'Frankfurt, Germany', foundedYear: 1870,
    boards: [{ provider: 'workday', token: 'db', site: 'DBWebsite', host: 'db.wd3.myworkdayjobs.com' }] },
  { slug: 'barclays', name: 'Barclays', domain: 'barclays.com', ticker: 'BCS', valuationKind: 'public', industry: 'Investment Banking', hqLocation: 'London, UK', foundedYear: 1690,
    boards: [{ provider: 'workday', token: 'barclays', site: 'External_Career_Site_Barclays', host: 'barclays.wd3.myworkdayjobs.com' }] },
  { slug: 'mufg', name: 'MUFG', domain: 'mufg.jp', ticker: 'MUFG', valuationKind: 'public', industry: 'Banking', hqLocation: 'Tokyo, Japan', foundedYear: 1880,
    boards: [{ provider: 'workday', token: 'mufgub', site: 'MUFG-Careers', host: 'mufgub.wd3.myworkdayjobs.com' }] },
  { slug: 'natwest', name: 'NatWest Group', domain: 'natwestgroup.com', ticker: 'NWG', valuationKind: 'public', industry: 'Banking', hqLocation: 'Edinburgh, UK', foundedYear: 1727,
    boards: [{ provider: 'workday', token: 'rbs', site: 'RBS', host: 'rbs.wd3.myworkdayjobs.com' }] },
  // Two boards on one tenant: experienced hire and the graduate scheme are
  // separate Workday sites, so both are listed or the graduate roles are missed.
  { slug: 'lloyds-banking-group', name: 'Lloyds Banking Group', domain: 'lloydsbankinggroup.com', ticker: 'LYG', valuationKind: 'public', industry: 'Banking', hqLocation: 'London, UK', foundedYear: 1765,
    boards: [
      { provider: 'workday', token: 'lbg', site: 'lbg_Careers', host: 'lbg.wd3.myworkdayjobs.com' },
      { provider: 'workday', token: 'lbg', site: 'Graduate_careers', host: 'lbg.wd3.myworkdayjobs.com' },
    ] },
  // Not an SEC filer, so no market cap can be derived. Shown as "Not disclosed"
  // rather than filled in from a secondary source.
  { slug: 'commonwealth-bank', name: 'Commonwealth Bank of Australia', domain: 'commbank.com.au', valuationKind: 'unknown', industry: 'Banking', hqLocation: 'Sydney, Australia', foundedYear: 1911,
    // Four boards on one tenant, holding different postings. Bankwest and x15
    // are CBA-owned brands; all four verified live 2026-09-12. (A
    // 'CommBank_India' site is sometimes claimed for this tenant -- it 404s.)
    boards: [
      { provider: 'workday', token: 'cba', site: 'CommBank_Careers', host: 'cba.wd3.myworkdayjobs.com' },
      { provider: 'workday', token: 'cba', site: 'Bankwest_Careers', host: 'cba.wd3.myworkdayjobs.com' },
      { provider: 'workday', token: 'cba', site: 'Private_Ad', host: 'cba.wd3.myworkdayjobs.com' },
      { provider: 'workday', token: 'cba', site: 'x15_Careers', host: 'cba.wd3.myworkdayjobs.com' },
    ] },
  // NAB runs three careers surfaces and only one is machine-readable:
  //   nab.wd3.myworkdayjobs.com/NAB_Careers  Workday CxS, 273 live roles, used here.
  //   careers.nab.com.au                     the Australian retail/banking site.
  //                                          Returns HTTP 202 (bot challenge) to
  //                                          any non-browser client and its
  //                                          sitemap is stale, so it is not a
  //                                          source we can read honestly.
  //   nab.eightfold.ai                       "Global Careers Portal". The portal
  //                                          renders, but its own jobs API
  //                                          (?domain=nab.com.au) answers 403 to
  //                                          every request we can make.
  // Verified 11 Sep 2026. Also ASX-listed rather than an SEC filer, so -- like
  // CommBank above -- no market cap can be derived and none is asserted.
  { slug: 'national-australia-bank', name: 'National Australia Bank', domain: 'nab.com.au', valuationKind: 'unknown', industry: 'Banking', hqLocation: 'Melbourne, Australia', foundedYear: 1858,
    boards: [{ provider: 'workday', token: 'nab', site: 'NAB_Careers', host: 'nab.wd3.myworkdayjobs.com' }] },
  { slug: 'standard-chartered', name: 'Standard Chartered', domain: 'sc.com', valuationKind: 'unknown', industry: 'Banking', hqLocation: 'London, UK', foundedYear: 1969,
    boards: [{ provider: 'workday', token: 'peopleplus', site: 'SCB_Careers', host: 'peopleplus.wd3.myworkdayjobs.com' }] },
  { slug: 'lloyds-of-london', name: "Lloyd's of London", domain: 'lloyds.com', valuationKind: 'unknown', industry: 'Insurance Market', hqLocation: 'London, UK', foundedYear: 1686,
    boards: [{ provider: 'workday', token: 'lloyds', site: 'Lloyds-of-London', host: 'lloyds.wd3.myworkdayjobs.com' }] },

  // ---- Quantitative trading and hedge funds ------------------------------
  // These are private partnerships. Assets under management is widely reported
  // for several of them, but AUM is money managed on behalf of clients -- it is
  // NOT the firm's own valuation, and presenting it as one would be wrong by an
  // order of magnitude. So every one of these is `unknown`.
  { slug: 'jane-street', name: 'Jane Street', domain: 'janestreet.com', valuationKind: 'unknown', industry: 'Quantitative Trading', hqLocation: 'New York, NY', foundedYear: 2000,
    boards: [{ provider: 'greenhouse', token: 'janestreet' }] },
  { slug: 'point72', name: 'Point72', domain: 'point72.com', valuationKind: 'unknown', industry: 'Hedge Fund', hqLocation: 'Stamford, CT', foundedYear: 2014,
    boards: [{ provider: 'greenhouse', token: 'point72' }] },
  { slug: 'imc-trading', name: 'IMC Trading', domain: 'imc.com', valuationKind: 'unknown', industry: 'Market Making', hqLocation: 'Amsterdam, Netherlands', foundedYear: 1989,
    boards: [{ provider: 'greenhouse', token: 'imc' }] },
  { slug: 'optiver', name: 'Optiver', domain: 'optiver.com', valuationKind: 'unknown', industry: 'Market Making', hqLocation: 'Amsterdam, Netherlands', foundedYear: 1986,
    boards: [{ provider: 'greenhouse', token: 'optiverus' }] },
  { slug: 'drw', name: 'DRW', domain: 'drw.com', valuationKind: 'unknown', industry: 'Quantitative Trading', hqLocation: 'Chicago, IL', foundedYear: 1992,
    boards: [{ provider: 'greenhouse', token: 'drweng' }] },
  { slug: 'jump-trading', name: 'Jump Trading', domain: 'jumptrading.com', valuationKind: 'unknown', industry: 'Quantitative Trading', hqLocation: 'Chicago, IL', foundedYear: 1999,
    boards: [{ provider: 'greenhouse', token: 'jumptrading' }] },
  { slug: 'squarepoint', name: 'Squarepoint Capital', domain: 'squarepoint-capital.com', valuationKind: 'unknown', industry: 'Quantitative Trading', hqLocation: 'London, UK', foundedYear: 2014,
    boards: [{ provider: 'greenhouse', token: 'squarepointcapital' }] },
  { slug: 'hudson-river-trading', name: 'Hudson River Trading', domain: 'hudsonrivertrading.com', valuationKind: 'unknown', industry: 'Quantitative Trading', hqLocation: 'New York, NY', foundedYear: 2002,
    boards: [{ provider: 'greenhouse', token: 'wehrtyou' }] },
  { slug: 'schonfeld', name: 'Schonfeld', domain: 'schonfeld.com', valuationKind: 'unknown', industry: 'Hedge Fund', hqLocation: 'New York, NY', foundedYear: 1988,
    boards: [{ provider: 'greenhouse', token: 'schonfeld' }] },
  { slug: 'aqr', name: 'AQR Capital Management', domain: 'aqr.com', valuationKind: 'unknown', industry: 'Quantitative Asset Management', hqLocation: 'Greenwich, CT', foundedYear: 1998,
    boards: [{ provider: 'greenhouse', token: 'aqr' }] },
  { slug: 'virtu', name: 'Virtu Financial', domain: 'virtu.com', ticker: 'VIRT', valuationKind: 'public', industry: 'Market Making', hqLocation: 'New York, NY', foundedYear: 2008,
    boards: [{ provider: 'greenhouse', token: 'virtu' }] },
  { slug: 'akuna-capital', name: 'Akuna Capital', domain: 'akunacapital.com', valuationKind: 'unknown', industry: 'Market Making', hqLocation: 'Chicago, IL', foundedYear: 2011,
    boards: [{ provider: 'greenhouse', token: 'akunacapital' }] },

  // ---- Big tech and large enterprises ------------------------------------
  // Verified live 11 Sep 2026. These employers run enterprise ATS platforms or
  // bespoke portals rather than the mid-market boards, which is why they were
  // absent: the adapters existed but no registry entry ever invoked them.
  { slug: 'amazon', name: 'Amazon', domain: 'amazon.com', ticker: 'AMZN', valuationKind: 'public', industry: 'E-commerce / Cloud', hqLocation: 'Seattle, WA', foundedYear: 1994,
    // One portal serves AWS, Whole Foods and the other subsidiaries; the
    // business unit is preserved as the department rather than split out.
    boards: [{ provider: 'custom', token: 'amazon', host: 'www.amazon.jobs' }] },
  { slug: 'nvidia', name: 'NVIDIA', domain: 'nvidia.com', ticker: 'NVDA', valuationKind: 'public', industry: 'Semiconductors / AI', hqLocation: 'Santa Clara, CA', foundedYear: 1993,
    boards: [{ provider: 'workday', token: 'nvidia', site: 'NVIDIAExternalCareerSite', host: 'nvidia.wd5.myworkdayjobs.com' }] },
  { slug: 'hsbc', name: 'HSBC', domain: 'hsbc.com', ticker: 'HSBC', valuationKind: 'public', industry: 'Banking', hqLocation: 'London, UK', foundedYear: 1865,
    boards: [{ provider: 'eightfold', token: 'hsbc', host: 'hsbc.eightfold.ai' }] },
  { slug: 'hpe', name: 'Hewlett Packard Enterprise', domain: 'hpe.com', ticker: 'HPE', valuationKind: 'public', industry: 'Enterprise IT', hqLocation: 'Spring, TX', foundedYear: 2015,
    boards: [{ provider: 'workday', token: 'hpe', site: 'Jobsathpe', host: 'hpe.wd5.myworkdayjobs.com' }] },
  { slug: 'oracle', name: 'Oracle', domain: 'oracle.com', ticker: 'ORCL', valuationKind: 'public', industry: 'Enterprise Software / Cloud', hqLocation: 'Austin, TX', foundedYear: 1977,
    // Oracle Recruiting Cloud: token is the careers site number, host is the
    // Fusion pod. Both vary per customer, so neither is inferred.
    boards: [{ provider: 'custom', token: 'CX_1', host: 'eeho.fa.us2.oraclecloud.com' }] },
  { slug: 'netflix', name: 'Netflix', domain: 'netflix.com', ticker: 'NFLX', valuationKind: 'public', industry: 'Streaming Media', hqLocation: 'Los Gatos, CA', foundedYear: 1997,
    // Eightfold served from Netflix's own hostname, not the vendor domain.
    boards: [{ provider: 'eightfold', token: 'netflix', host: 'explore.jobs.netflix.net' }] },
  { slug: 'bayer', name: 'Bayer', domain: 'bayer.com', valuationKind: 'unknown', industry: 'Pharmaceuticals / Agriculture', hqLocation: 'Leverkusen, Germany', foundedYear: 1863,
    boards: [{ provider: 'eightfold', token: 'bayer', host: 'bayer.eightfold.ai' }] },
  { slug: 'paypal', name: 'PayPal', domain: 'paypal.com', ticker: 'PYPL', valuationKind: 'public', industry: 'Fintech / Payments', hqLocation: 'San Jose, CA', foundedYear: 1998,
    boards: [{ provider: 'workday', token: 'paypal', site: 'jobs', host: 'paypal.wd1.myworkdayjobs.com' }] },
  { slug: 'mastercard', name: 'Mastercard', domain: 'mastercard.com', ticker: 'MA', valuationKind: 'public', industry: 'Fintech / Payments', hqLocation: 'Purchase, NY', foundedYear: 1966,
    boards: [{ provider: 'workday', token: 'mastercard', site: 'CorporateCareers', host: 'mastercard.wd1.myworkdayjobs.com' }] },
  // Visa was missed by an earlier shard sweep that guessed `visa.wd1` with site
  // names like `External` and `Jobs`. It is actually wd5 with the site literally
  // named `Visa`. Found by following corporate.visa.com/en/jobs/, which 302s
  // straight to the board -- the general lesson being that the employer's own
  // careers link resolves a tenant faster than guessing shard/site pairs.
  { slug: 'visa', name: 'Visa', domain: 'visa.com', ticker: 'V', valuationKind: 'public', industry: 'Fintech / Payments', hqLocation: 'San Francisco, CA', foundedYear: 1958,
    boards: [{ provider: 'workday', token: 'visa', site: 'Visa', host: 'visa.wd5.myworkdayjobs.com' }] },
  { slug: 'intel', name: 'Intel', domain: 'intel.com', ticker: 'INTC', valuationKind: 'public', industry: 'Semiconductors', hqLocation: 'Santa Clara, CA', foundedYear: 1968,
    boards: [{ provider: 'workday', token: 'intel', site: 'External', host: 'intel.wd1.myworkdayjobs.com' }] },
  { slug: 'workday-inc', name: 'Workday', domain: 'workday.com', ticker: 'WDAY', valuationKind: 'public', industry: 'Enterprise Software / HR', hqLocation: 'Pleasanton, CA', foundedYear: 2005,
    boards: [{ provider: 'workday', token: 'workday', site: 'Workday', host: 'workday.wd5.myworkdayjobs.com' }] },

  // ---- Cloud, data infrastructure and security ---------------------------
  // Verified live 11 Sep 2026. Tickers below were each checked against SEC's
  // company_tickers.json before being marked `public`, because a ticker that
  // does not resolve yields no market cap and a silently blank valuation.
  // Confluent is publicly traded but its ticker is absent from that file, so it
  // is `unknown` here rather than carrying a symbol that will not resolve.
  { slug: 'snowflake', name: 'Snowflake', domain: 'snowflake.com', ticker: 'SNOW', valuationKind: 'public', industry: 'Data Cloud', hqLocation: 'Bozeman, MT', foundedYear: 2012,
    boards: [{ provider: 'ashby', token: 'snowflake' }] },
  { slug: 'mongodb', name: 'MongoDB', domain: 'mongodb.com', ticker: 'MDB', valuationKind: 'public', industry: 'Databases', hqLocation: 'New York, NY', foundedYear: 2007,
    boards: [{ provider: 'greenhouse', token: 'mongodb' }] },
  { slug: 'elastic', name: 'Elastic', domain: 'elastic.co', ticker: 'ESTC', valuationKind: 'public', industry: 'Search / Observability', hqLocation: 'Mountain View, CA', foundedYear: 2012,
    boards: [{ provider: 'greenhouse', token: 'elastic' }] },
  { slug: 'zscaler', name: 'Zscaler', domain: 'zscaler.com', ticker: 'ZS', valuationKind: 'public', industry: 'Cloud Security', hqLocation: 'San Jose, CA', foundedYear: 2007,
    boards: [{ provider: 'greenhouse', token: 'zscaler' }] },
  // Workday site is lowercase `crowdstrikecareers`; the conventional `External`
  // / `Careers` names both 404 on this tenant. Verified 11 Sep 2026.
  { slug: 'crowdstrike', name: 'CrowdStrike', domain: 'crowdstrike.com', ticker: 'CRWD', valuationKind: 'public', industry: 'Endpoint Security', hqLocation: 'Austin, TX', foundedYear: 2011,
    boards: [{ provider: 'workday', token: 'crowdstrike', site: 'crowdstrikecareers', host: 'crowdstrike.wd5.myworkdayjobs.com' }] },
  { slug: 'okta', name: 'Okta', domain: 'okta.com', ticker: 'OKTA', valuationKind: 'public', industry: 'Identity Security', hqLocation: 'San Francisco, CA', foundedYear: 2009,
    boards: [{ provider: 'greenhouse', token: 'okta' }] },
  { slug: 'fastly', name: 'Fastly', domain: 'fastly.com', ticker: 'FSLY', valuationKind: 'public', industry: 'Edge Cloud / CDN', hqLocation: 'San Francisco, CA', foundedYear: 2011,
    boards: [{ provider: 'greenhouse', token: 'fastly' }] },
  { slug: 'pagerduty', name: 'PagerDuty', domain: 'pagerduty.com', ticker: 'PD', valuationKind: 'public', industry: 'Incident Response', hqLocation: 'San Francisco, CA', foundedYear: 2009,
    boards: [{ provider: 'greenhouse', token: 'pagerduty' }] },
  { slug: 'amplitude', name: 'Amplitude', domain: 'amplitude.com', ticker: 'AMPL', valuationKind: 'public', industry: 'Product Analytics', hqLocation: 'San Francisco, CA', foundedYear: 2012,
    boards: [{ provider: 'greenhouse', token: 'amplitude' }] },
  { slug: 'confluent', name: 'Confluent', domain: 'confluent.io', valuationKind: 'unknown', industry: 'Data Streaming', hqLocation: 'Mountain View, CA', foundedYear: 2014,
    boards: [{ provider: 'ashby', token: 'confluent' }] },
  { slug: 'grafana-labs', name: 'Grafana Labs', domain: 'grafana.com', valuationKind: 'unknown', industry: 'Observability', hqLocation: 'New York, NY', foundedYear: 2014,
    boards: [{ provider: 'greenhouse', token: 'grafanalabs' }] },
  { slug: 'temporal', name: 'Temporal Technologies', domain: 'temporal.io', valuationKind: 'unknown', industry: 'Developer Infrastructure', hqLocation: 'Seattle, WA', foundedYear: 2019,
    boards: [{ provider: 'ashby', token: 'temporal' }] },
  { slug: 'vercel', name: 'Vercel', domain: 'vercel.com', valuationKind: 'unknown', industry: 'Frontend Cloud', hqLocation: 'San Francisco, CA', foundedYear: 2015,
    boards: [{ provider: 'greenhouse', token: 'vercel' }] },
  { slug: 'fivetran', name: 'Fivetran', domain: 'fivetran.com', valuationKind: 'unknown', industry: 'Data Integration', hqLocation: 'Oakland, CA', foundedYear: 2012,
    boards: [{ provider: 'greenhouse', token: 'fivetran' }] },
  { slug: 'airbyte', name: 'Airbyte', domain: 'airbyte.com', valuationKind: 'unknown', industry: 'Data Integration', hqLocation: 'San Francisco, CA', foundedYear: 2020,
    boards: [{ provider: 'ashby', token: 'airbyte' }] },
  { slug: 'launchdarkly', name: 'LaunchDarkly', domain: 'launchdarkly.com', valuationKind: 'unknown', industry: 'Feature Management', hqLocation: 'Oakland, CA', foundedYear: 2014,
    boards: [{ provider: 'greenhouse', token: 'launchdarkly' }] },
  { slug: 'mixpanel', name: 'Mixpanel', domain: 'mixpanel.com', valuationKind: 'unknown', industry: 'Product Analytics', hqLocation: 'San Francisco, CA', foundedYear: 2009,
    boards: [{ provider: 'greenhouse', token: 'mixpanel' }] },
  { slug: '1password', name: '1Password', domain: '1password.com', valuationKind: 'unknown', industry: 'Security / Password Management', hqLocation: 'Toronto, Canada', foundedYear: 2005,
    boards: [{ provider: 'ashby', token: '1password' }] },

  // ---- Consumer, fintech and marketplaces --------------------------------
  { slug: 'roblox', name: 'Roblox', domain: 'roblox.com', ticker: 'RBLX', valuationKind: 'public', industry: 'Gaming Platform', hqLocation: 'San Mateo, CA', foundedYear: 2004,
    boards: [{ provider: 'greenhouse', token: 'roblox' }] },
  { slug: 'duolingo', name: 'Duolingo', domain: 'duolingo.com', ticker: 'DUOL', valuationKind: 'public', industry: 'Education Technology', hqLocation: 'Pittsburgh, PA', foundedYear: 2011,
    boards: [{ provider: 'greenhouse', token: 'duolingo' }] },
  { slug: 'chime', name: 'Chime', domain: 'chime.com', ticker: 'CHYM', valuationKind: 'public', industry: 'Fintech / Banking', hqLocation: 'San Francisco, CA', foundedYear: 2012,
    boards: [{ provider: 'greenhouse', token: 'chime' }] },
  { slug: 'circle', name: 'Circle', domain: 'circle.com', ticker: 'CRCL', valuationKind: 'public', industry: 'Stablecoin Infrastructure', hqLocation: 'Boston, MA', foundedYear: 2013,
    boards: [{ provider: 'ashby', token: 'circle' }] },
  { slug: 'wayfair', name: 'Wayfair', domain: 'wayfair.com', ticker: 'W', valuationKind: 'public', industry: 'E-commerce', hqLocation: 'Boston, MA', foundedYear: 2002,
    boards: [{ provider: 'smartrecruiters', token: 'wayfair' }] },
  // Amazon subsidiary: no separate listing, so no ticker of its own.
  { slug: 'twitch', name: 'Twitch', domain: 'twitch.tv', valuationKind: 'unknown', industry: 'Live Streaming', hqLocation: 'San Francisco, CA', foundedYear: 2011,
    boards: [{ provider: 'greenhouse', token: 'twitch' }] },
  { slug: 'gusto', name: 'Gusto', domain: 'gusto.com', valuationKind: 'unknown', industry: 'Payroll / HR', hqLocation: 'San Francisco, CA', foundedYear: 2011,
    boards: [{ provider: 'greenhouse', token: 'gusto' }] },
  { slug: 'carta', name: 'Carta', domain: 'carta.com', valuationKind: 'unknown', industry: 'Equity Management', hqLocation: 'San Francisco, CA', foundedYear: 2012,
    boards: [{ provider: 'greenhouse', token: 'carta' }] },
  { slug: 'betterment', name: 'Betterment', domain: 'betterment.com', valuationKind: 'unknown', industry: 'Wealth Management', hqLocation: 'New York, NY', foundedYear: 2008,
    boards: [{ provider: 'greenhouse', token: 'betterment' }] },
  { slug: 'remote', name: 'Remote', domain: 'remote.com', valuationKind: 'unknown', industry: 'Global Employment', hqLocation: 'All-remote', foundedYear: 2019,
    boards: [{ provider: 'greenhouse', token: 'remotecom' }] },
  { slug: 'ripple', name: 'Ripple', domain: 'ripple.com', valuationKind: 'unknown', industry: 'Blockchain Payments', hqLocation: 'San Francisco, CA', foundedYear: 2012,
    boards: [{ provider: 'greenhouse', token: 'ripple' }] },
  { slug: 'consensys', name: 'Consensys', domain: 'consensys.io', valuationKind: 'unknown', industry: 'Blockchain Infrastructure', hqLocation: 'All-remote', foundedYear: 2014,
    boards: [{ provider: 'greenhouse', token: 'consensys' }] },

  // ---- Recently funded US employers (2025-2026 rounds) -------------------
  //
  // Sourced by probing board tokens across Greenhouse, Lever and Ashby, then
  // CONFIRMING WHO ANSWERED. That second step is not optional: guessed tokens
  // collide on generic English words, and `greenhouse/apex` -- the obvious
  // guess for the space-logistics company Apex -- is Apex Eye, an unrelated
  // ophthalmology group. It is excluded here. A token that resolves proves a
  // board exists, never that it belongs to the employer we meant.
  //
  // Every entry below was matched against the board's own declared name
  // (Greenhouse board API) or its board page title (Ashby, which exposes no
  // name in its JSON API).
  //
  // VALUATION IS `unknown` THROUGHOUT, DELIBERATELY
  // These are private companies whose rounds are reported in press coverage
  // rather than in any queryable source. The registry contract is that a
  // `private` figure carries a source and an as-of date; without those, the
  // honest value is `unknown`, which renders as "Not disclosed". A recalled
  // headline number would be exactly the confident-but-unverifiable figure the
  // provenance rule exists to prevent.
  //
  // `hqLocation` and `foundedYear` are omitted for the same reason -- both are
  // optional, and neither is worth guessing.
  { slug: 'divergent', name: "Divergent", domain: 'divergent3d.com', valuationKind: 'unknown', industry: "Advanced Manufacturing",
    boards: [{ provider: 'greenhouse', token: 'divergent' }] },
  { slug: 'beam-ai', name: "Beam", domain: 'beam.ai', valuationKind: 'unknown', industry: "AI Agents / Automation",
    boards: [{ provider: 'greenhouse', token: 'beam' }] },
  { slug: 'tenstorrent', name: "Tenstorrent", domain: 'tenstorrent.com', valuationKind: 'unknown', industry: "AI Chips",
    boards: [{ provider: 'greenhouse', token: 'tenstorrent' }] },
  { slug: 'cerebras', name: "Cerebras", domain: 'cerebras.ai', valuationKind: 'unknown', industry: "AI Chips",
    boards: [{ provider: 'ashby', token: 'cerebras' }] },
  { slug: 'etched', name: "Etched", domain: 'etched.com', valuationKind: 'unknown', industry: "AI Chips",
    boards: [{ provider: 'ashby', token: 'etched' }] },
  { slug: 'sambanova-systems', name: "SambaNova Systems", domain: 'sambanova.ai', valuationKind: 'unknown', industry: "AI Chips",
    boards: [{ provider: 'greenhouse', token: 'sambanovasystems' }] },
  { slug: 'd-matrix', name: "d-Matrix", domain: 'd-matrix.ai', valuationKind: 'unknown', industry: "AI Chips",
    boards: [{ provider: 'ashby', token: 'd-matrix' }] },
  { slug: 'crusoe', name: "Crusoe", domain: 'crusoe.ai', valuationKind: 'unknown', industry: "AI Cloud / Data Centers",
    boards: [{ provider: 'ashby', token: 'crusoe' }] },
  { slug: 'nebius', name: "Nebius", domain: 'nebius.com', valuationKind: 'unknown', industry: "AI Cloud / GPU Compute",
    boards: [{ provider: 'greenhouse', token: 'nebius' }] },
  { slug: 'coreweave', name: "CoreWeave", domain: 'coreweave.com', valuationKind: 'unknown', industry: "AI Cloud / GPU Compute",
    boards: [{ provider: 'greenhouse', token: 'coreweave' }] },
  { slug: 'fluidstack', name: "Fluidstack", domain: 'fluidstack.io', valuationKind: 'unknown', industry: "AI Cloud / GPU Compute",
    boards: [{ provider: 'ashby', token: 'fluidstack' }] },
  { slug: 'lambda-labs', name: "Lambda", domain: 'lambda.ai', valuationKind: 'unknown', industry: "AI Cloud / GPU Compute",
    boards: [{ provider: 'ashby', token: 'lambda' }] },
  { slug: 'runpod', name: "RunPod", domain: 'runpod.io', valuationKind: 'unknown', industry: "AI Cloud / GPU Compute",
    boards: [{ provider: 'ashby', token: 'runpod' }] },
  { slug: 'ml-foundry', name: "Foundry", domain: 'mlfoundry.com', valuationKind: 'unknown', industry: "AI Cloud / GPU Compute",
    boards: [{ provider: 'greenhouse', token: 'foundry' }] },
  { slug: 'modal-labs', name: "Modal Labs", domain: 'modal.com', valuationKind: 'unknown', industry: "AI Cloud / Serverless Compute",
    boards: [{ provider: 'ashby', token: 'modal' }] },
  { slug: 'poolside', name: "Poolside", domain: 'poolside.ai', valuationKind: 'unknown', industry: "AI Code Generation",
    boards: [{ provider: 'ashby', token: 'poolside' }] },
  { slug: 'mercor', name: "Mercor", domain: 'mercor.com', valuationKind: 'unknown', industry: "AI Data / Talent Marketplace",
    boards: [{ provider: 'ashby', token: 'mercor' }] },
  { slug: 'langchain', name: "LangChain", domain: 'langchain.com', valuationKind: 'unknown', industry: "AI Developer Tools",
    boards: [{ provider: 'ashby', token: 'langchain' }] },
  { slug: 'llamaindex', name: "LlamaIndex", domain: 'llamaindex.ai', valuationKind: 'unknown', industry: "AI Developer Tools",
    boards: [{ provider: 'ashby', token: 'llamaindex' }] },
  { slug: 'braintrust', name: "Braintrust", domain: 'braintrust.dev', valuationKind: 'unknown', industry: "AI Evaluation / Observability",
    boards: [{ provider: 'ashby', token: 'braintrust' }] },
  { slug: 'periodic-labs', name: "Periodic Labs", domain: 'periodiclabs.ai', valuationKind: 'unknown', industry: "AI for Science",
    boards: [{ provider: 'ashby', token: 'periodic-labs' }] },
  { slug: 'baseten', name: "Baseten", domain: 'baseten.co', valuationKind: 'unknown', industry: "AI Inference Infrastructure",
    boards: [{ provider: 'ashby', token: 'baseten' }] },
  { slug: 'fireworks-ai', name: "Fireworks AI", domain: 'fireworks.ai', valuationKind: 'unknown', industry: "AI Inference Infrastructure",
    boards: [{ provider: 'ashby', token: 'fireworks' }] },
  { slug: 'anyscale', name: "Anyscale", domain: 'anyscale.com', valuationKind: 'unknown', industry: "AI Infrastructure / Ray",
    boards: [{ provider: 'ashby', token: 'anyscale' }] },
  { slug: 'granola', name: "Granola", domain: 'granola.ai', valuationKind: 'unknown', industry: "AI Meeting Notes",
    boards: [{ provider: 'ashby', token: 'granola' }] },
  { slug: 'gamma-app', name: "Gamma", domain: 'gamma.app', valuationKind: 'unknown', industry: "AI Presentations",
    boards: [{ provider: 'ashby', token: 'gamma' }] },
  { slug: 'reflection-ai', name: "Reflection AI", domain: 'reflection.ai', valuationKind: 'unknown', industry: "AI Research / Autonomous Coding",
    boards: [{ provider: 'ashby', token: 'reflectionai' }] },
  { slug: 'listen-labs', name: "Listen Labs", domain: 'listenlabs.ai', valuationKind: 'unknown', industry: "AI Research / Consumer Insights",
    boards: [{ provider: 'ashby', token: 'listenlabs' }] },
  { slug: 'rilla', name: "Rilla", domain: 'rilla.com', valuationKind: 'unknown', industry: "AI Sales Analytics",
    boards: [{ provider: 'ashby', token: 'rilla' }] },
  { slug: 'attention-com', name: "Attention", domain: 'attention.com', valuationKind: 'unknown', industry: "AI Sales Automation",
    boards: [{ provider: 'ashby', token: 'attention' }] },
  { slug: 'motherduck', name: "Motherduck", domain: 'motherduck.com', valuationKind: 'unknown', industry: "Analytics / DuckDB",
    boards: [{ provider: 'ashby', token: 'motherduck' }] },
  { slug: 'hex-tech', name: "Hex", domain: 'hex.tech', valuationKind: 'unknown', industry: "Analytics / Notebooks",
    boards: [{ provider: 'ashby', token: 'hex' }] },
  { slug: 'sila-nanotechnologies', name: "Sila Nanotechnologies", domain: 'silanano.com', valuationKind: 'unknown', industry: "Battery Materials",
    boards: [{ provider: 'greenhouse', token: 'silananotechnologies' }] },
  { slug: 'redwood-materials', name: "Redwood Materials", domain: 'redwoodmaterials.com', valuationKind: 'unknown', industry: "Battery Recycling",
    boards: [{ provider: 'greenhouse', token: 'redwoodmaterials' }] },
  { slug: 'chai-discovery', name: "Chai Discovery", domain: 'chaidiscovery.com', valuationKind: 'unknown', industry: "Biotech AI",
    boards: [{ provider: 'ashby', token: 'chaidiscovery' }] },
  { slug: 'genesis-molecular-ai', name: "Genesis Molecular AI", domain: 'genesistherapeutics.ai', valuationKind: 'unknown', industry: "Biotech AI",
    boards: [{ provider: 'ashby', token: 'genesis-molecular-ai' }] },
  { slug: 'latent-labs', name: "Latent Labs", domain: 'latentlabs.com', valuationKind: 'unknown', industry: "Biotech AI",
    boards: [{ provider: 'ashby', token: 'latentlabs' }] },
  { slug: 'cradle-bio', name: "Cradle Bio", domain: 'cradle.bio', valuationKind: 'unknown', industry: "Biotech AI",
    boards: [{ provider: 'ashby', token: 'cradlebio' }] },
  { slug: 'sigma-computing', name: "Sigma Computing", domain: 'sigmacomputing.com', valuationKind: 'unknown', industry: "Business Intelligence",
    boards: [{ provider: 'greenhouse', token: 'sigmacomputing' }] },
  { slug: 'omni-analytics', name: "Omni Analytics", domain: 'omni.co', valuationKind: 'unknown', industry: "Business Intelligence",
    boards: [{ provider: 'ashby', token: 'omni' }] },
  { slug: 'render-com', name: "Render", domain: 'render.com', valuationKind: 'unknown', industry: "Cloud Platform",
    boards: [{ provider: 'ashby', token: 'render' }] },
  { slug: 'railway', name: "Railway", domain: 'railway.com', valuationKind: 'unknown', industry: "Cloud Platform",
    boards: [{ provider: 'ashby', token: 'railway' }] },
  { slug: 'turnkey', name: "Turnkey", domain: 'turnkey.com', valuationKind: 'unknown', industry: "Crypto / Key Management",
    boards: [{ provider: 'ashby', token: 'turnkey' }] },
  { slug: 'squads', name: "Squads", domain: 'squads.xyz', valuationKind: 'unknown', industry: "Crypto / Smart Accounts",
    boards: [{ provider: 'ashby', token: 'squads' }] },
  { slug: 'bastion', name: "Bastion", domain: 'bastion.com', valuationKind: 'unknown', industry: "Crypto / Stablecoin Infrastructure",
    boards: [{ provider: 'ashby', token: 'bastion' }] },
  { slug: 'bvnk', name: "BVNK", domain: 'bvnk.com', valuationKind: 'unknown', industry: "Crypto / Stablecoin Payments",
    boards: [{ provider: 'greenhouse', token: 'bvnk' }] },
  { slug: 'halliday', name: "Halliday", domain: 'halliday.xyz', valuationKind: 'unknown', industry: "Crypto / Workflow Infrastructure",
    boards: [{ provider: 'ashby', token: 'halliday' }] },
  { slug: 'semgrep', name: "Semgrep", domain: 'semgrep.dev', valuationKind: 'unknown', industry: "Cybersecurity / Code Analysis",
    boards: [{ provider: 'ashby', token: 'semgrep' }] },
  { slug: 'vanta', name: "Vanta", domain: 'vanta.com', valuationKind: 'unknown', industry: "Cybersecurity / Compliance",
    boards: [{ provider: 'ashby', token: 'vanta' }] },
  { slug: 'drata', name: "Drata", domain: 'drata.com', valuationKind: 'unknown', industry: "Cybersecurity / Compliance",
    boards: [{ provider: 'ashby', token: 'drata' }] },
  { slug: 'abnormal-security', name: "Abnormal Security", domain: 'abnormal.ai', valuationKind: 'unknown', industry: "Cybersecurity / Email",
    boards: [{ provider: 'greenhouse', token: 'abnormalsecurity' }] },
  { slug: 'descope', name: "Descope", domain: 'descope.com', valuationKind: 'unknown', industry: "Cybersecurity / Identity",
    boards: [{ provider: 'greenhouse', token: 'descope' }] },
  { slug: 'chainguard', name: "Chainguard", domain: 'chainguard.dev', valuationKind: 'unknown', industry: "Cybersecurity / Supply Chain",
    boards: [{ provider: 'greenhouse', token: 'chainguard' }] },
  { slug: 'endor-labs', name: "Endor Labs", domain: 'endorlabs.com', valuationKind: 'unknown', industry: "Cybersecurity / Supply Chain",
    boards: [{ provider: 'greenhouse', token: 'endorlabs' }] },
  { slug: 'socket', name: "Socket", domain: 'socket.dev', valuationKind: 'unknown', industry: "Cybersecurity / Supply Chain",
    boards: [{ provider: 'greenhouse', token: 'socket' }] },
  { slug: 'deepnote', name: "Deepnote", domain: 'deepnote.com', valuationKind: 'unknown', industry: "Data Science Notebooks",
    boards: [{ provider: 'ashby', token: 'deepnote' }] },
  { slug: 'planetscale', name: "PlanetScale", domain: 'planetscale.com', valuationKind: 'unknown', industry: "Database / MySQL",
    boards: [{ provider: 'greenhouse', token: 'planetscale' }] },
  { slug: 'neon-db', name: "Neon", domain: 'neon.com', valuationKind: 'unknown', industry: "Database / Postgres",
    boards: [{ provider: 'ashby', token: 'neon' }] },
  { slug: 'saronic', name: "Saronic", domain: 'saronic.com', valuationKind: 'unknown', industry: "Defense / Autonomous Vessels",
    boards: [{ provider: 'ashby', token: 'saronic' }] },
  { slug: 'shield-ai', name: "Shield AI", domain: 'shield.ai', valuationKind: 'unknown', industry: "Defense / Autonomy",
    boards: [{ provider: 'greenhouse', token: 'shield' }] },
  { slug: 'neros-technologies', name: "Neros Technologies", domain: 'neros.com', valuationKind: 'unknown', industry: "Defense / Drones",
    boards: [{ provider: 'greenhouse', token: 'nerostechnologies' }] },
  { slug: 'chaos-industries', name: "Chaos Industries", domain: 'chaosindustries.com', valuationKind: 'unknown', industry: "Defense / Sensing",
    boards: [{ provider: 'greenhouse', token: 'chaosindustries' }] },
  { slug: 'vannevar-labs', name: "Vannevar Labs", domain: 'vannevarlabs.com', valuationKind: 'unknown', industry: "Defense Software",
    boards: [{ provider: 'greenhouse', token: 'vannevarlabs' }] },
  { slug: 'anduril-industries', name: "Anduril Industries", domain: 'anduril.com', valuationKind: 'unknown', industry: "Defense Technology",
    boards: [{ provider: 'greenhouse', token: 'andurilindustries' }] },
  { slug: 'zed-industries', name: "Zed Industries", domain: 'zed.dev', valuationKind: 'unknown', industry: "Developer Tools / Editor",
    boards: [{ provider: 'ashby', token: 'zed' }] },
  { slug: 'resend', name: "Resend", domain: 'resend.com', valuationKind: 'unknown', industry: "Developer Tools / Email",
    boards: [{ provider: 'ashby', token: 'resend' }] },
  { slug: 'knock', name: "Knock", domain: 'knock.app', valuationKind: 'unknown', industry: "Developer Tools / Notifications",
    boards: [{ provider: 'greenhouse', token: 'knock' }] },
  { slug: 'sentry', name: "Sentry", domain: 'sentry.io', valuationKind: 'unknown', industry: "Developer Tools / Observability",
    boards: [{ provider: 'ashby', token: 'sentry' }] },
  { slug: 'warp-dev', name: "Warp", domain: 'warp.dev', valuationKind: 'unknown', industry: "Developer Tools / Terminal",
    boards: [{ provider: 'ashby', token: 'warp' }] },
  { slug: 'inngest', name: "Inngest", domain: 'inngest.com', valuationKind: 'unknown', industry: "Developer Tools / Workflows",
    boards: [{ provider: 'ashby', token: 'inngest' }] },
  { slug: 'form-energy', name: "Form Energy", domain: 'formenergy.com', valuationKind: 'unknown', industry: "Energy Storage",
    boards: [{ provider: 'ashby', token: 'formenergy' }] },
  { slug: 'base-power', name: "Base Power", domain: 'basepowercompany.com', valuationKind: 'unknown', industry: "Energy Storage",
    boards: [{ provider: 'ashby', token: 'base-power' }] },
  { slug: 'typeface', name: "Typeface", domain: 'typeface.ai', valuationKind: 'unknown', industry: "Enterprise AI Content",
    boards: [{ provider: 'greenhouse', token: 'typeface' }] },
  { slug: 'writer-com', name: "Writer", domain: 'writer.com', valuationKind: 'unknown', industry: "Enterprise AI Writing",
    boards: [{ provider: 'ashby', token: 'writer' }] },
  { slug: 'slope-so', name: "Slope", domain: 'slope.so', valuationKind: 'unknown', industry: "Fintech / B2B Payments",
    boards: [{ provider: 'ashby', token: 'slope' }] },
  { slug: 'column-bank', name: "Column", domain: 'column.com', valuationKind: 'unknown', industry: "Fintech / Banking Infrastructure",
    boards: [{ provider: 'ashby', token: 'column' }] },
  { slug: 'unit-finance', name: "Unit", domain: 'unit.co', valuationKind: 'unknown', industry: "Fintech / Banking-as-a-Service",
    boards: [{ provider: 'ashby', token: 'unit' }] },
  { slug: 'mercury', name: "Mercury", domain: 'mercury.com', valuationKind: 'unknown', industry: "Fintech / Business Banking",
    boards: [{ provider: 'greenhouse', token: 'mercury' }] },
  { slug: 'lithic', name: "Lithic", domain: 'lithic.com', valuationKind: 'unknown', industry: "Fintech / Card Issuing",
    boards: [{ provider: 'greenhouse', token: 'lithic' }] },
  { slug: 'highnote', name: "Highnote", domain: 'highnote.com', valuationKind: 'unknown', industry: "Fintech / Card Issuing",
    boards: [{ provider: 'greenhouse', token: 'highnote' }] },
  { slug: 'ramp', name: "Ramp", domain: 'ramp.com', valuationKind: 'unknown', industry: "Fintech / Corporate Cards",
    boards: [{ provider: 'ashby', token: 'ramp' }] },
  { slug: 'method-financial', name: "Method Financial", domain: 'methodfi.com', valuationKind: 'unknown', industry: "Fintech / Debt Data",
    boards: [{ provider: 'greenhouse', token: 'method' }] },
  { slug: 'taktile', name: "Taktile", domain: 'taktile.com', valuationKind: 'unknown', industry: "Fintech / Decision Automation",
    boards: [{ provider: 'ashby', token: 'taktile' }] },
  { slug: 'parafin', name: "Parafin", domain: 'parafin.com', valuationKind: 'unknown', industry: "Fintech / Embedded Lending",
    boards: [{ provider: 'ashby', token: 'parafin' }] },
  { slug: 'sardine', name: "Sardine", domain: 'sardine.ai', valuationKind: 'unknown', industry: "Fintech / Fraud & Compliance",
    boards: [{ provider: 'ashby', token: 'sardine' }] },
  { slug: 'airwallex', name: "Airwallex", domain: 'airwallex.com', valuationKind: 'unknown', industry: "Fintech / Global Payments",
    boards: [{ provider: 'ashby', token: 'airwallex' }] },
  { slug: 'alloy', name: "Alloy", domain: 'alloy.com', valuationKind: 'unknown', industry: "Fintech / Identity & Risk",
    boards: [{ provider: 'greenhouse', token: 'alloy' }] },
  { slug: 'vesta-io', name: "Vesta", domain: 'vesta.io', valuationKind: 'unknown', industry: "Fintech / Mortgage Software",
    boards: [{ provider: 'ashby', token: 'vesta' }] },
  { slug: 'plaid', name: "Plaid", domain: 'plaid.com', valuationKind: 'unknown', industry: "Fintech / Open Banking",
    boards: [{ provider: 'ashby', token: 'plaid' }] },
  { slug: 'modern-treasury', name: "Modern Treasury", domain: 'moderntreasury.com', valuationKind: 'unknown', industry: "Fintech / Payment Operations",
    boards: [{ provider: 'ashby', token: 'moderntreasury' }] },
  { slug: 'melio', name: "Melio", domain: 'meliopayments.com', valuationKind: 'unknown', industry: "Fintech / SMB Payments",
    boards: [{ provider: 'greenhouse', token: 'melio' }] },
  { slug: 'conduit', name: "Conduit", domain: 'conduit.financial', valuationKind: 'unknown', industry: "Fintech / Stablecoin Payments",
    boards: [{ provider: 'ashby', token: 'conduit' }] },
  { slug: 'helion-energy', name: "Helion Energy", domain: 'helionenergy.com', valuationKind: 'unknown', industry: "Fusion Energy",
    boards: [{ provider: 'ashby', token: 'helion' }] },
  { slug: 'pacific-fusion', name: "Pacific Fusion", domain: 'pacificfusion.com', valuationKind: 'unknown', industry: "Fusion Energy",
    boards: [{ provider: 'greenhouse', token: 'pacificfusion' }] },
  { slug: 'synthesia', name: "Synthesia", domain: 'synthesia.io', valuationKind: 'unknown', industry: "Generative Video",
    boards: [{ provider: 'ashby', token: 'synthesia' }] },
  { slug: 'luma-ai', name: "Luma AI", domain: 'lumalabs.ai', valuationKind: 'unknown', industry: "Generative Video",
    boards: [{ provider: 'ashby', token: 'lumaai' }] },
  { slug: 'pika', name: "Pika", domain: 'pika.art', valuationKind: 'unknown', industry: "Generative Video",
    boards: [{ provider: 'ashby', token: 'pika' }] },
  { slug: 'hedra', name: "Hedra", domain: 'hedra.com', valuationKind: 'unknown', industry: "Generative Video",
    boards: [{ provider: 'ashby', token: 'hedra' }] },
  { slug: 'commure', name: "Commure", domain: 'commure.com', valuationKind: 'unknown', industry: "Healthcare AI",
    boards: [{ provider: 'ashby', token: 'commure' }] },
  { slug: 'abridge', name: "Abridge", domain: 'abridge.com', valuationKind: 'unknown', industry: "Healthcare AI",
    boards: [{ provider: 'ashby', token: 'abridge' }] },
  { slug: 'ambience-healthcare', name: "Ambience Healthcare", domain: 'ambiencehealthcare.com', valuationKind: 'unknown', industry: "Healthcare AI",
    boards: [{ provider: 'ashby', token: 'ambiencehealthcare' }] },
  { slug: 'openevidence', name: "OpenEvidence", domain: 'openevidence.com', valuationKind: 'unknown', industry: "Healthcare AI",
    boards: [{ provider: 'ashby', token: 'openevidence' }] },
  { slug: 'radiant-nuclear', name: "Radiant Nuclear", domain: 'radiantnuclear.com', valuationKind: 'unknown', industry: "Nuclear Energy",
    boards: [{ provider: 'ashby', token: 'radiant' }] },
  { slug: 'lightmatter', name: "Lightmatter", domain: 'lightmatter.co', valuationKind: 'unknown', industry: "Photonic Computing",
    boards: [{ provider: 'greenhouse', token: 'lightmatter' }] },
  { slug: 'physical-intelligence', name: "Physical Intelligence", domain: 'physicalintelligence.company', valuationKind: 'unknown', industry: "Robotics Foundation Models",
    boards: [{ provider: 'ashby', token: 'physicalintelligence' }] },
  { slug: 'impulse-space', name: "Impulse Space", domain: 'impulsespace.com', valuationKind: 'unknown', industry: "Space / In-Space Mobility",
    boards: [{ provider: 'ashby', token: 'impulse' }] },
  { slug: 'ursa-major', name: "Ursa Major", domain: 'ursamajor.com', valuationKind: 'unknown', industry: "Space / Propulsion",
    boards: [{ provider: 'greenhouse', token: 'ursamajor' }] },
  { slug: 'astranis', name: "Astranis", domain: 'astranis.com', valuationKind: 'unknown', industry: "Space / Satellites",
    boards: [{ provider: 'greenhouse', token: 'astranis' }] },
  { slug: 'varda-space-industries', name: "Varda Space Industries", domain: 'varda.com', valuationKind: 'unknown', industry: "Space Manufacturing",
    boards: [{ provider: 'greenhouse', token: 'vardaspace' }] },
  { slug: 'world-labs', name: "World Labs", domain: 'worldlabs.ai', valuationKind: 'unknown', industry: "Spatial Intelligence / 3D AI",
    boards: [{ provider: 'ashby', token: 'worldlabs' }] },
  { slug: 'turbopuffer', name: "Turbopuffer", domain: 'turbopuffer.com', valuationKind: 'unknown', industry: "Vector Database",
    boards: [{ provider: 'ashby', token: 'turbopuffer' }] },
  { slug: 'pinecone', name: "Pinecone", domain: 'pinecone.io', valuationKind: 'unknown', industry: "Vector Database",
    boards: [{ provider: 'ashby', token: 'pinecone' }] },
  { slug: 'weaviate', name: "Weaviate", domain: 'weaviate.io', valuationKind: 'unknown', industry: "Vector Database",
    boards: [{ provider: 'ashby', token: 'weaviate' }] },
  // Founding date is the company's own careers-page timeline ("Clear Street is
  // founded", 2018-09-03). Valuation is 'unknown' rather than a remembered
  // funding-round figure: no free source reports it, and this registry's rule
  // is that a private figure needs a source and an as-of date or it is not
  // entered at all.
  { slug: 'clear-street', name: 'Clear Street', domain: 'clearstreet.io', valuationKind: 'unknown',
    industry: 'Fintech / Prime Brokerage', hqLocation: 'New York, NY', foundedYear: 2018,
    boards: [{ provider: 'greenhouse', token: 'clearstreet' }] },
  // Industry is their own description ("innovative global consulting firm
  // delivering industry-leading digital solutions"). foundedYear and
  // hqLocation are omitted rather than guessed: neither appears anywhere on
  // synechron.com, and an unsourced number here would be indistinguishable
  // from a checked one.
  { slug: 'synechron', name: 'Synechron', domain: 'synechron.com', valuationKind: 'unknown',
    industry: 'IT Consulting / Financial Services',
    boards: [{ provider: 'workday', token: 'synechron', site: 'synechroncareers', host: 'synechron.wd1.myworkdayjobs.com' }] },
  // Single board: quantiphi.com/careers links only to this Workday site, and
  // Common Crawl knows no other site under the tenant.
  { slug: 'quantiphi', name: 'Quantiphi', domain: 'quantiphi.com', valuationKind: 'unknown',
    industry: 'AI / Data Science Consulting',
    boards: [{ provider: 'workday', token: 'quantiphi', site: 'Careers_at_Quantiphi', host: 'quantiphi.wd1.myworkdayjobs.com' }] },
  // `custom`, not an ATS: Google's careers site has no public JSON API left
  // (careers.google.com/api/v3 404s), no JSON-LD on the listing and no job
  // sitemap. The paginated server-rendered listing is the supported route --
  // see CustomSiteAdapter strategy 4. One board covers Google, YouTube,
  // DeepMind, Verily, Waymo, Wing and GFiber, which all post here.
  { slug: 'google', name: 'Google', domain: 'google.com', ticker: 'GOOGL', valuationKind: 'public',
    industry: 'Search / Cloud / Advertising', hqLocation: 'Mountain View, CA', foundedYear: 1998,
    boards: [{ provider: 'custom', token: 'google', site: 'https://www.google.com/about/careers/applications/jobs/results' }] },
  // Carried with no board on purpose. The Greenhouse boards named for Citadel
  // in circulation (boards/citadel, boards/citadelsecurities) both 404, and
  // citadel.com answers automated requests with 403, so there is nothing
  // readable to point at. The entry exists so the employer is known and the
  // gap is visible rather than looking like an employer we never heard of.
  { slug: 'citadel', name: 'Citadel', domain: 'citadel.com', valuationKind: 'unknown',
    industry: 'Hedge Fund / Market Making', hqLocation: 'Miami, FL', foundedYear: 1990,
    boards: [] },
  // ---- Institutions with no adapter yet (added Sep 2026, verified 2026-09-12) ----
  //
  // The other 17 entries proposed alongside these were removed: 13 duplicated
  // companies this registry already carried WITH the same boards, and the
  // duplicates won in COMPANY_BY_SLUG, discarding the curated originals --
  // including natwest's lbg/Graduate_careers board, which the replacement
  // dropped. Two more (citadel, citadel-securities) named Greenhouse boards
  // that return 404. See scripts/verify-banking-intel.mjs for the check.
  //
  // These four are genuinely new. Their providers have no adapter in
  // lib/sources/adapters, so nothing ingests them yet; they are recorded so
  // the employer is known and the gap is visible.
  { slug: 'hdfc-bank', name: 'HDFC Bank', domain: 'hdfcbank.com', ticker: 'HDFCBANK.NS', valuationKind: 'public', industry: 'Retail & Commercial Banking', hqLocation: 'Mumbai, India', foundedYear: 1994,
    boards: [{ provider: 'successfactors', token: 'hdfcbank' }] },
  { slug: 'state-bank-of-india', name: 'State Bank of India', domain: 'sbi.co.in', ticker: 'SBIN.NS', valuationKind: 'public', industry: 'Public Sector Banking', hqLocation: 'Mumbai, India', foundedYear: 1806,
    boards: [{ provider: 'custom', token: 'state-bank-of-india' }] },
  { slug: 'npci', name: 'NPCI', domain: 'npci.org.in', valuationKind: 'unknown', industry: 'Payment Infrastructure', hqLocation: 'Mumbai, India', foundedYear: 2008,
    boards: [] },
  { slug: 'commerzbank', name: 'Commerzbank', domain: 'commerzbank.com', ticker: 'CBK.DE', valuationKind: 'public', industry: 'Commercial & Retail Banking', hqLocation: 'Frankfurt, Germany', foundedYear: 1870,
    boards: [{ provider: 'successfactors', token: 'commerzbank' }] },
]

export const COMPANY_BY_SLUG = new Map(COMPANIES.map((c) => [c.slug, c]))

/**
 * Logo URL for a company.
 *
 * Logo.dev and Clearbit both serve logos keyed by domain, which is why the
 * registry stores a domain rather than an image. Google's favicon service is
 * the keyless fallback and is what we use by default, so the app has no
 * third-party logo dependency and no API key to leak.
 *
 * This replaces the emoji "logos" ("üöÄ", "‚ö°", "üé®") that the jobs page
 * previously hard-coded alongside invented companies.
 */
export function companyLogoUrl(domain: string, size = 128): string {
  const token = process.env.NEXT_PUBLIC_LOGODEV_TOKEN
  if (token) {
    return `https://img.logo.dev/${encodeURIComponent(domain)}?token=${encodeURIComponent(token)}&size=${size}&format=png`
  }
  return `https://www.google.com/s2/favicons?domain=${encodeURIComponent(domain)}&sz=${size}`
}

/** Compact human formatting for large USD figures. */
export function formatValuation(usd: number | null | undefined): string {
  if (!usd || !Number.isFinite(usd)) return 'Not disclosed'
  if (usd >= 1e12) return `$${(usd / 1e12).toFixed(usd >= 1e13 ? 0 : 1)}T`
  if (usd >= 1e9) return `$${(usd / 1e9).toFixed(usd >= 1e10 ? 0 : 1)}B`
  if (usd >= 1e6) return `$${(usd / 1e6).toFixed(0)}M`
  return `$${usd.toLocaleString()}`
}

/** Buckets used by the valuation facet in the UI. */
export const VALUATION_TIERS = [
  { id: 'mega', label: '$100B+', min: 100e9, max: Infinity },
  { id: 'decacorn', label: '$10B - $100B', min: 10e9, max: 100e9 },
  { id: 'unicorn', label: '$1B - $10B', min: 1e9, max: 10e9 },
  { id: 'growth', label: 'Under $1B', min: 0, max: 1e9 },
] as const

export function valuationTier(usd: number | null | undefined): string | null {
  if (!usd || !Number.isFinite(usd)) return null
  return VALUATION_TIERS.find((t) => usd >= t.min && usd < t.max)?.id ?? null
}
