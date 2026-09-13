-- Company Financial Intelligence table
-- Stores enriched financial data from SEC EDGAR, Companies House, and curated sources.
-- Refreshed quarterly (matching SEC filing cadence).

CREATE TABLE IF NOT EXISTS company_financials (
  id              UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  slug            TEXT NOT NULL UNIQUE,
  company_name    TEXT NOT NULL,
  ticker          TEXT,

  -- Core financial metrics (USD)
  revenue_ttm           BIGINT,       -- trailing twelve months, in cents
  net_income             BIGINT,
  total_assets           BIGINT,
  total_debt             BIGINT,
  cash_and_equivalents   BIGINT,
  market_cap             BIGINT,
  employee_count         INTEGER,
  revenue_per_employee   INTEGER,

  -- Financial health
  debt_to_assets_ratio   NUMERIC(5,4),
  profit_margin          NUMERIC(5,4),
  financial_health_score INTEGER CHECK (financial_health_score BETWEEN 0 AND 100),

  -- Banking relationships (JSONB array)
  -- Each entry: { bankName, role, facilityType, facilitySize, confidence }
  banking_relationships  JSONB DEFAULT '[]'::JSONB,
  uk_banking_partners    TEXT[],

  -- Leadership (JSONB array)
  -- Each entry: { name, role, source }
  leadership             JSONB DEFAULT '[]'::JSONB,

  -- Company registration
  registration_country   TEXT,
  incorporation_date     DATE,
  sic_codes              TEXT[],
  company_status         TEXT,

  -- Data provenance
  data_sources           TEXT[] NOT NULL DEFAULT '{}',
  confidence             TEXT CHECK (confidence IN ('high', 'medium', 'low')) DEFAULT 'low',
  last_filing_date       DATE,
  last_updated           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at             TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Indexes for common queries
CREATE INDEX IF NOT EXISTS idx_company_financials_slug ON company_financials (slug);
CREATE INDEX IF NOT EXISTS idx_company_financials_ticker ON company_financials (ticker) WHERE ticker IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_company_financials_name ON company_financials USING gin (company_name gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_company_financials_health ON company_financials (financial_health_score DESC NULLS LAST);

-- Enable trigram extension for fuzzy name matching (if not already enabled)
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- RLS policies
ALTER TABLE company_financials ENABLE ROW LEVEL SECURITY;

-- Anyone can read financial data (it's all public-source)
CREATE POLICY "company_financials_read_all" ON company_financials
  FOR SELECT USING (true);

-- Only service role can insert/update (pipeline runs server-side)
CREATE POLICY "company_financials_admin_write" ON company_financials
  FOR ALL USING (auth.role() = 'service_role');

COMMENT ON TABLE company_financials IS 'Company financial intelligence from SEC EDGAR, Companies House, and curated sources. Refreshed quarterly.';
COMMENT ON COLUMN company_financials.banking_relationships IS 'JSON array of {bankName, role, facilityType, facilitySize, confidence} from SEC credit agreements and CH charges.';
COMMENT ON COLUMN company_financials.revenue_ttm IS 'Trailing twelve months revenue in USD cents. Source: SEC EDGAR XBRL or curated.';
