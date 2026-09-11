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
  { slug: 'dell', name: 'Dell Technologies', domain: 'dell.com', ticker: 'DELL', valuationKind: 'public',
    industry: 'Computing Hardware', hqLocation: 'Round Rock, TX', foundedYear: 1984,
    boards: [{ provider: 'custom', token: 'CX_1', host: 'enterpriseplatform.dell.com' }] },
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
    boards: [{ provider: 'workday', token: 'citi', site: '2', host: 'citi.wd5.myworkdayjobs.com' }] },
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

  { slug: 'stripe', name: 'Stripe', domain: 'stripe.com', valuationKind: 'private',
    reportedValuationUsd: 106_500_000_000, valuationAsOf: '2025-02-27',
    valuationSource: 'Tender offer, Feb 2025',
    industry: 'Payments Infrastructure', hqLocation: 'South San Francisco, CA', foundedYear: 2010,
    boards: [{ provider: 'greenhouse', token: 'stripe' }] },
  { slug: 'figma', name: 'Figma', domain: 'figma.com', valuationKind: 'unknown',
    industry: 'Design Software', hqLocation: 'San Francisco, CA', foundedYear: 2012,
    boards: [{ provider: 'greenhouse', token: 'figma' }] },
  { slug: 'cloudflare', name: 'Cloudflare', domain: 'cloudflare.com', ticker: 'NET', valuationKind: 'public',
    industry: 'Internet Infrastructure', hqLocation: 'San Francisco, CA', foundedYear: 2009,
    boards: [{ provider: 'greenhouse', token: 'cloudflare' }] },
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
    boards: [{ provider: 'workday', token: 'cba', site: 'CommBank_Careers', host: 'cba.wd3.myworkdayjobs.com' }] },
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
