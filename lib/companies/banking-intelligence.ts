/**
 * Banking & Financial Institution Intelligence Layer
 *
 * Provides deep company intelligence beyond what a normal job board shows.
 * Data compiled from public sources: corporate websites, SEC/RBI/FCA filings,
 * developer documentation portals, careers pages, and press releases (Sep 2026).
 */

export interface LeadershipEntry {
  role: string
  name: string
}

export interface OfficeLocation {
  city: string
  country: string
  address?: string
  notes?: string
  estimatedHeadcount?: string
}

export interface EmailPattern {
  pattern: string
  share: number // 0-100 percentage
  notes?: string
}

export interface DeveloperPortal {
  name: string
  url: string
  description?: string
}

export interface ApiSuite {
  name: string
  description: string
}

export interface BankingIntelligence {
  slug: string
  // Company profile
  legalName: string
  ticker?: string
  globalHq: string
  assets?: string
  marketCap?: string
  revenue?: string
  employees: string
  globalReach?: string
  techBudget?: string

  // ATS Intelligence
  atsPlatform: string
  atsEndpoint?: string
  atsType: 'workday_cxs' | 'greenhouse_api' | 'oracle_cloud' | 'eightfold_ai' | 'sap_successfactors' | 'darwinbox' | 'custom'
  workdayConfig?: {
    tenant: string
    shard: string
    site: string
  }
  hiringVolume?: string
  hotRoles?: string[]

  // Leadership
  leadership: LeadershipEntry[]

  // Developer ecosystem
  developerPortals: DeveloperPortal[]
  keyApis?: ApiSuite[]

  // Contact intelligence
  emailDomain: string
  emailPatterns: EmailPattern[]

  // Office locations
  officesIndia: OfficeLocation[]
  officesUk: OfficeLocation[]
  officesGermany: OfficeLocation[]
  officesOther?: OfficeLocation[]

  // Banking partnerships
  cloudPartners?: string[]
  fintechPartners?: string[]
  keyPartnerships?: string[]

  // 2026 tech focus
  techFocus: string[]
}

export const BANKING_INTELLIGENCE: BankingIntelligence[] = [
  {
    slug: 'jpmorgan-chase',
    legalName: 'JPMorgan Chase & Co.',
    ticker: 'NYSE: JPM',
    globalHq: '270 Park Avenue NY',
    assets: '~$4.1T',
    marketCap: '~$620-660B',
    revenue: '~$165-175B',
    employees: '~315,000 (~60k tech)',
    techBudget: '$17B',
    atsPlatform: 'Oracle Cloud HCM',
    atsType: 'oracle_cloud',
    leadership: [
      { role: 'CEO', name: 'Jamie Dimon' },
      { role: 'CIO', name: 'Lori Beer' },
      { role: 'CDAO', name: 'Teresa Heitsenrether' },
      { role: 'Head of AI', name: 'Dr. Manuela Veloso' },
      { role: 'CHRO', name: 'Robin Leopold' },
      { role: 'CISO', name: 'Pat Opet' }
    ],
    developerPortals: [
      { name: 'JPMorgan Developer', url: 'developer.jpmorgan.com' },
      { name: 'Chase Developer', url: 'developer.chase.com' },
      { name: 'J.P. Morgan Payments', url: 'payments.jpmorgan.com' }
    ],
    emailDomain: 'jpmchase.com',
    emailPatterns: [
      { pattern: 'firstname.lastname@jpmchase.com', share: 68 },
      { pattern: 'firstname.lastname@jpmorgan.com', share: 24 }
    ],
    officesIndia: [
      { city: 'Bengaluru', country: 'India', address: 'Embassy TechVillage' },
      { city: 'Hyderabad', country: 'India', address: 'HITEC City', notes: 'Largest global tech' },
      { city: 'Mumbai', country: 'India', address: 'Nesco IT Park' }
    ],
    officesUk: [
      { city: 'London', country: 'UK', address: '25 Bank St, Canary Wharf' },
      { city: 'Glasgow', country: 'UK', address: '177 Bothwell St', estimatedHeadcount: '2700+ tech' },
      { city: 'Bournemouth', country: 'UK', estimatedHeadcount: '~4000 staff' }
    ],
    officesGermany: [
      { city: 'Frankfurt', country: 'Germany', address: 'TaunusTurm' }
    ],
    cloudPartners: ['AWS', 'Google Cloud', 'Azure'],
    fintechPartners: ['Akoya', 'Plaid', 'Partior', 'Thought Machine'],
    techFocus: ['Applied AI/LLM', 'Kinexys Blockchain', 'Cloud', 'Payments']
  },
  {
    // 'citi', not 'citigroup': this key joins to lib/companies/registry.ts,
    // and a slug no company carries makes the whole entry dead weight.
    slug: 'citi',
    legalName: 'Citigroup Inc.',
    ticker: 'NYSE: C',
    globalHq: '388 Greenwich St NY',
    assets: '~$2.4T',
    marketCap: '~$125-145B',
    revenue: '~$80-84B',
    employees: '~230,000',
    atsPlatform: 'Workday',
    // Verified 2026-09-12: the site segment is the literal '2'.
    // 'citi_careers' 404s -- it came from a research document, never a call.
    atsEndpoint: 'citi.wd5.myworkdayjobs.com/2',
    atsType: 'workday_cxs',
    workdayConfig: { tenant: 'citi', shard: 'wd5', site: '2' },
    leadership: [
      { role: 'CEO', name: 'Jane Fraser' },
      { role: 'Head of Tech', name: 'Tim Ryan' },
      { role: 'CIO', name: 'Stuart Riley' },
      { role: 'CHRO', name: 'Sara Wechter' }
    ],
    developerPortals: [
      { name: 'Citi Developer', url: 'developer.citi.com' },
      { name: 'Citi Sandbox', url: 'sandbox.developer.citi.com' }
    ],
    emailDomain: 'citi.com',
    emailPatterns: [
      { pattern: 'firstname.lastname@citi.com', share: 76 }
    ],
    officesIndia: [
      { city: 'Pune', country: 'India', address: 'EON Free Zone' },
      { city: 'Chennai', country: 'India', address: 'Ramanujan IT City' },
      { city: 'Mumbai', country: 'India', address: 'FIFC BKC' },
      { city: 'Gurugram', country: 'India', address: 'DLF Cyber City' }
    ],
    officesUk: [
      { city: 'London', country: 'UK', address: '25 Canada Square' },
      { city: 'Belfast', country: 'UK', address: 'Titanic Quarter', estimatedHeadcount: '4000+' }
    ],
    officesGermany: [
      { city: 'Frankfurt', country: 'Germany', address: 'Reuterweg 16' }
    ],
    cloudPartners: ['Google Cloud', 'AWS'],
    techFocus: ['TTS Modernization', 'Cloud', 'Risk Automation']
  },
  {
    slug: 'citadel',
    legalName: 'Citadel LLC',
    globalHq: '830 Brickell Plaza Miami',
    assets: '~$65B AUM',
    employees: '~3,500',
    // NOT Greenhouse. The boards named for Citadel in the source report --
    // boards/citadel and boards/citadelsecurities -- both return 404, as do
    // the other plausible tokens; checked 2026-09-12 by
    // scripts/verify-banking-intel.mjs. Their careers site answers automated
    // requests with 403, so what they actually run is undetermined. Recorded
    // as unknown rather than carrying a platform we disproved.
    atsPlatform: 'unknown (Greenhouse claim disproven 2026-09-12)',
    atsType: 'custom',
    leadership: [
      { role: 'CEO', name: 'Kenneth Griffin' },
      { role: 'CEO Securities', name: 'Peng Zhao' },
      { role: 'CTO', name: 'Umesh Subramanian' }
    ],
    developerPortals: [],
    emailDomain: 'citadel.com',
    emailPatterns: [
      { pattern: 'firstname.lastname@citadel.com', share: 82 }
    ],
    officesIndia: [
      { city: 'Gurugram', country: 'India' },
      { city: 'Bengaluru', country: 'India' }
    ],
    officesUk: [
      { city: 'London', country: 'UK', address: '120 London Wall' }
    ],
    officesGermany: [
      { city: 'Frankfurt', country: 'Germany', address: 'Taunusanlage 8' }
    ],
    techFocus: ['Ultra-low-latency C++', 'FPGA', 'Quant ML']
  },
  {
    slug: 'hdfc-bank',
    legalName: 'HDFC Bank Ltd',
    ticker: 'NSE: HDFCBANK',
    globalHq: 'Mumbai',
    assets: '>₹36 Lakh Crore ($430B+)',
    employees: '~215,000',
    atsPlatform: 'SAP SuccessFactors',
    atsType: 'sap_successfactors',
    leadership: [
      { role: 'CEO', name: 'Sashidhar Jagdishan' },
      { role: 'CIO', name: 'Ramesh Lakshminarayanan' },
      { role: 'CHRO', name: 'Vinay Razdan' }
    ],
    developerPortals: [
      { name: 'HDFC Developer', url: 'developer.hdfcbank.com' }
    ],
    emailDomain: 'hdfcbank.com',
    emailPatterns: [
      { pattern: 'firstname.lastname@hdfcbank.com', share: 75 }
    ],
    officesIndia: [
      { city: 'Mumbai', country: 'India', address: 'HQ' },
      { city: 'Bengaluru', country: 'India' },
      { city: 'Chennai', country: 'India' },
      { city: 'Hyderabad', country: 'India' },
      { city: 'Pune', country: 'India' }
    ],
    officesUk: [],
    officesGermany: [],
    techFocus: ['Cloud Migration', 'AI Fraud', 'UPI']
  },
  {
    slug: 'state-bank-of-india',
    legalName: 'State Bank of India',
    ticker: 'NSE: SBIN',
    globalHq: 'Mumbai Nariman Point',
    assets: '>₹62 Lakh Crore ($740B+)',
    employees: '~235,000',
    atsPlatform: 'Custom (SBI HRMS/TCS iON)',
    atsType: 'custom',
    leadership: [
      { role: 'Chairman', name: 'C.S. Setty' }
    ],
    developerPortals: [],
    emailDomain: 'sbi.co.in',
    emailPatterns: [
      { pattern: 'firstname.lastname@sbi.co.in', share: 100 }
    ],
    officesIndia: [
      { city: 'Mumbai', country: 'India', address: 'HQ' }
    ],
    officesUk: [],
    officesGermany: [],
    techFocus: ['YONO 2.0', 'Meghdoot Cloud', 'Account Aggregator']
  },
  {
    slug: 'npci',
    legalName: 'National Payments Corporation of India (NPCI)',
    globalHq: 'Mumbai BKC',
    employees: '~1,500',
    atsPlatform: 'Darwinbox',
    atsType: 'darwinbox',
    leadership: [
      { role: 'CEO', name: 'Dilip Asbe' },
      { role: 'COO', name: 'Praveena Rai' },
      { role: 'NIPL CEO', name: 'Ritesh Shukla' }
    ],
    developerPortals: [
      { name: 'NPCI', url: 'npci.org.in' },
      { name: 'UPI', url: 'upi.npci.org.in' }
    ],
    emailDomain: 'npci.org.in',
    emailPatterns: [
      { pattern: 'firstname.lastname@npci.org.in', share: 100 }
    ],
    officesIndia: [
      { city: 'Mumbai', country: 'India', address: 'BKC' },
      { city: 'Chennai', country: 'India' },
      { city: 'Hyderabad', country: 'India' }
    ],
    officesUk: [],
    officesGermany: [],
    techFocus: ['UPI Lite X', 'Hello! UPI', 'CBDC', 'RuPay']
  },
  {
    slug: 'visa',
    legalName: 'Visa Inc.',
    ticker: 'NYSE: V',
    globalHq: 'San Francisco',
    revenue: '~$36-38.5B',
    marketCap: '~$590-620B',
    employees: '~29,500',
    atsPlatform: 'Workday',
    atsEndpoint: 'visa.wd5',
    atsType: 'workday_cxs',
    workdayConfig: { tenant: 'visa', shard: 'wd5', site: 'visa' },
    leadership: [
      { role: 'CEO', name: 'Ryan McInerney' },
      { role: 'CTO', name: 'Rajat Taneja' },
      { role: 'CFO', name: 'Chris Suh' }
    ],
    developerPortals: [
      { name: 'Visa Developer', url: 'developer.visa.com' },
      { name: 'Cybersource Developer', url: 'developer.cybersource.com' }
    ],
    keyApis: [
      { name: 'Visa Direct', description: 'Push payments' },
      { name: 'Cybersource', description: 'Payment management platform' },
      { name: 'VTS', description: 'Visa Token Service' },
      { name: 'B2B Connect', description: 'Cross-border payments' },
      { name: 'Visa Protect', description: 'Risk and fraud solutions' },
      { name: 'Acceptance Cloud', description: 'Cloud-based acceptance' },
      { name: 'Tink', description: 'Open banking' }
    ],
    emailDomain: 'visa.com',
    emailPatterns: [
      { pattern: 'first.last@visa.com', share: 72 }
    ],
    officesIndia: [
      { city: 'Bengaluru', country: 'India', address: 'Bagmane Tech Park' },
      { city: 'Mumbai', country: 'India', address: 'BKC' }
    ],
    officesUk: [
      { city: 'London', country: 'UK', address: '1 Sheldon Square' }
    ],
    officesGermany: [
      { city: 'Frankfurt', country: 'Germany' },
      { city: 'Berlin', country: 'Germany' },
      { city: 'Munich', country: 'Germany' }
    ],
    techFocus: ['Visa Direct', 'Network of Networks', 'AI Fraud']
  },
  {
    slug: 'barclays',
    legalName: 'Barclays PLC',
    ticker: 'FTSE: BARC',
    globalHq: 'London',
    employees: '~85,000',
    atsPlatform: 'Workday',
    atsEndpoint: 'barclays.wd3',
    atsType: 'workday_cxs',
    workdayConfig: { tenant: 'barclays', shard: 'wd3', site: 'barclays' },
    leadership: [
      { role: 'CEO', name: 'C.S. Venkatakrishnan' },
      { role: 'CTO', name: 'Craig Bright' }
    ],
    developerPortals: [
      { name: 'Barclays Developer', url: 'developer.barclays.com' }
    ],
    emailDomain: 'barclays.com',
    emailPatterns: [
      { pattern: 'firstname.lastname@barclays.com', share: 90 }
    ],
    officesIndia: [
      { city: 'Pune', country: 'India' },
      { city: 'Chennai', country: 'India' }
    ],
    officesUk: [
      { city: 'London', country: 'UK', address: '1 Churchill Place' },
      { city: 'Knutsford', country: 'UK', address: 'Radbroke Hall' },
      { city: 'Glasgow', country: 'UK' }
    ],
    officesGermany: [
      { city: 'Frankfurt', country: 'Germany' }
    ],
    techFocus: []
  },
  {
    slug: 'hsbc',
    legalName: 'HSBC Holdings PLC',
    ticker: 'FTSE: HSBA',
    globalHq: 'London',
    employees: '~215,000',
    atsPlatform: 'Eightfold AI',
    atsEndpoint: 'hsbc.eightfold.ai',
    atsType: 'eightfold_ai',
    leadership: [
      { role: 'CEO', name: 'Georges Elhedery' },
      { role: 'CIO', name: 'Stuart Riley' }
    ],
    developerPortals: [
      { name: 'HSBC Developer', url: 'developer.hsbc.com' }
    ],
    emailDomain: 'hsbc.com',
    emailPatterns: [
      { pattern: 'firstname.lastname@hsbc.com', share: 75 }
    ],
    officesIndia: [
      { city: 'Hyderabad', country: 'India', address: 'HTI' },
      { city: 'Pune', country: 'India' },
      { city: 'Bengaluru', country: 'India' },
      { city: 'Chennai', country: 'India' }
    ],
    officesUk: [
      { city: 'London', country: 'UK', address: '8 Canada Square' },
      { city: 'Birmingham', country: 'UK' }
    ],
    officesGermany: [
      { city: 'Düsseldorf', country: 'Germany' }
    ],
    techFocus: []
  },
  {
    slug: 'lloyds-banking-group',
    legalName: 'Lloyds Banking Group PLC',
    ticker: 'FTSE: LLOY',
    globalHq: 'London',
    employees: '~63,000',
    atsPlatform: 'Workday',
    atsEndpoint: 'lbg.wd3',
    atsType: 'workday_cxs',
    workdayConfig: { tenant: 'lbg', shard: 'wd3', site: 'lbg' },
    leadership: [
      { role: 'CEO', name: 'Charlie Nunn' },
      { role: 'CTO', name: 'Rohit Dhawan' }
    ],
    developerPortals: [
      { name: 'Lloyds Developer', url: 'developer.lloydsbankinggroup.com' }
    ],
    emailDomain: 'lloydsbanking.com',
    emailPatterns: [
      { pattern: 'firstname.lastname@lloydsbanking.com', share: 90 }
    ],
    officesIndia: [
      { city: 'Hyderabad', country: 'India', address: 'LTCI' }
    ],
    officesUk: [
      { city: 'London', country: 'UK' },
      { city: 'Edinburgh', country: 'UK' }
    ],
    officesGermany: [
      { city: 'Berlin', country: 'Germany' }
    ],
    techFocus: []
  },
  {
    // 'natwest' is the registry slug; it bundles the rbs and lbg boards.
    slug: 'natwest',
    legalName: 'NatWest Group PLC',
    ticker: 'FTSE: NWG',
    globalHq: 'Edinburgh',
    employees: '~60,000',
    atsPlatform: 'Workday',
    atsEndpoint: 'rbs.wd3',
    atsType: 'workday_cxs',
    workdayConfig: { tenant: 'rbs', shard: 'wd3', site: 'rbs' },
    leadership: [
      { role: 'CEO', name: 'Paul Thwaite' },
      { role: 'CTO', name: 'Scott Marcar' }
    ],
    developerPortals: [
      { name: 'Bank of APIs', url: 'bankofapis.com' }
    ],
    emailDomain: 'natwest.com',
    emailPatterns: [
      { pattern: 'firstname.lastname@natwest.com', share: 85 }
    ],
    officesIndia: [
      { city: 'Gurugram', country: 'India' },
      { city: 'Bengaluru', country: 'India' },
      { city: 'Chennai', country: 'India' }
    ],
    officesUk: [
      { city: 'Edinburgh', country: 'UK', address: 'Gogarburn' },
      { city: 'London', country: 'UK' }
    ],
    officesGermany: [
      { city: 'Frankfurt', country: 'Germany' }
    ],
    techFocus: []
  },
  {
    slug: 'commonwealth-bank',
    legalName: 'Commonwealth Bank of Australia',
    ticker: 'ASX: CBA',
    globalHq: 'Sydney',
    employees: '~53,000',
    atsPlatform: 'Workday',
    atsEndpoint: 'cba.wd3',
    atsType: 'workday_cxs',
    workdayConfig: { tenant: 'cba', shard: 'wd3', site: 'cba' },
    leadership: [
      { role: 'CEO', name: 'Matt Comyn' },
      { role: 'CIO', name: 'Gavin Munroe' }
    ],
    developerPortals: [
      { name: 'CommBank Developer', url: 'developer.commbank.com.au' }
    ],
    emailDomain: 'cba.com.au',
    emailPatterns: [
      { pattern: 'firstname.lastname@cba.com.au', share: 85 }
    ],
    officesIndia: [
      { city: 'Bengaluru', country: 'India', estimatedHeadcount: '4000+ tech' }
    ],
    officesUk: [
      { city: 'London', country: 'UK', address: '1 Poultry' }
    ],
    officesGermany: [],
    techFocus: []
  },
  {
    slug: 'deutsche-bank',
    legalName: 'Deutsche Bank AG',
    ticker: 'DAX: DBK',
    globalHq: 'Frankfurt',
    employees: '~90,000',
    atsPlatform: 'Workday',
    atsEndpoint: 'db.wd3',
    atsType: 'workday_cxs',
    workdayConfig: { tenant: 'db', shard: 'wd3', site: 'db' },
    leadership: [
      { role: 'CEO', name: 'Christian Sewing' },
      { role: 'CTDIO', name: 'Bernd Leukert' }
    ],
    developerPortals: [
      { name: 'Deutsche Bank Developer', url: 'developer.db.com' },
      { name: 'Autobahn', url: 'autobahn.db.com' }
    ],
    emailDomain: 'db.com',
    emailPatterns: [
      { pattern: 'firstname.lastname@db.com', share: 95 }
    ],
    officesIndia: [
      { city: 'Pune', country: 'India' },
      { city: 'Bengaluru', country: 'India', estimatedHeadcount: '>10,000 tech' }
    ],
    officesUk: [
      { city: 'London', country: 'UK', address: '21 Moorfields' }
    ],
    officesGermany: [
      { city: 'Frankfurt', country: 'Germany', address: 'HQ Twin Towers' },
      { city: 'Berlin', country: 'Germany', address: 'Tech Centre' }
    ],
    techFocus: []
  },
  {
    slug: 'commerzbank',
    legalName: 'Commerzbank AG',
    ticker: 'DAX: CBK',
    globalHq: 'Frankfurt',
    employees: '~43,000',
    atsPlatform: 'SAP SuccessFactors',
    atsType: 'sap_successfactors',
    leadership: [
      { role: 'CEO', name: 'Bettina Orlopp' },
      { role: 'CIO', name: 'Carsten Bittner' }
    ],
    developerPortals: [
      { name: 'Commerzbank Developer', url: 'developer.commerzbank.com' }
    ],
    emailDomain: 'commerzbank.com',
    emailPatterns: [
      { pattern: 'firstname.lastname@commerzbank.com', share: 95 }
    ],
    officesIndia: [],
    officesUk: [],
    officesGermany: [
      { city: 'Frankfurt', country: 'Germany', address: 'HQ Tower' },
      { city: 'Berlin', country: 'Germany' },
      { city: 'Munich', country: 'Germany' }
    ],
    officesOther: [
      { city: 'Prague', country: 'Czech Republic' },
      { city: 'Lodz', country: 'Poland' },
      { city: 'Sofia', country: 'Bulgaria' }
    ],
    techFocus: []
  },
  {
    slug: 'mastercard',
    legalName: 'Mastercard Inc.',
    ticker: 'NYSE: MA',
    globalHq: 'Purchase NY',
    employees: '~33,000',
    atsPlatform: 'Workday',
    atsEndpoint: 'mastercard.wd1',
    atsType: 'workday_cxs',
    workdayConfig: { tenant: 'mastercard', shard: 'wd1', site: 'mastercard' },
    leadership: [],
    developerPortals: [
      { name: 'Mastercard Developer', url: 'developer.mastercard.com' }
    ],
    emailDomain: 'mastercard.com',
    emailPatterns: [
      { pattern: 'firstname.lastname@mastercard.com', share: 100 }
    ],
    officesIndia: [],
    officesUk: [],
    officesGermany: [],
    techFocus: ['Track B2B', 'Ethoca', 'Finicity Open Banking']
  }
]

/**
 * Look up intelligence by company slug.
 */
export function getBankingIntelligence(slug: string): BankingIntelligence | undefined {
  return BANKING_INTELLIGENCE.find(bank => bank.slug === slug)
}

/**
 * Get all banking institution slugs.
 */
export function getBankingSlugs(): string[] {
  return BANKING_INTELLIGENCE.map(bank => bank.slug)
}

/**
 * Check if a company slug is a banking institution with intelligence data.
 */
export function hasBankingIntelligence(slug: string): boolean {
  return BANKING_INTELLIGENCE.some(bank => bank.slug === slug)
}
