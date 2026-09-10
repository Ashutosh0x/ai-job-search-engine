-- Create jobs table for dynamic job postings
CREATE TABLE IF NOT EXISTS jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title text NOT NULL,
  company text NOT NULL,
  company_logo_url text,
  location text,
  type text,
  work_type text,
  salary text,
  experience text,
  posted_time timestamp with time zone DEFAULT timezone('utc'::text, now()),
  description text,
  employees text,
  requirements jsonb,
  matching_preferences jsonb,
  referrals integer DEFAULT 0,
  job_link text
);
