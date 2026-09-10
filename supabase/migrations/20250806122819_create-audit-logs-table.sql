-- Create audit_logs table
CREATE TABLE IF NOT EXISTS audit_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE,
  action text NOT NULL,
  details jsonb,
  created_at timestamp with time zone DEFAULT timezone('utc'::text, now())
);

-- Enable Row Level Security
ALTER TABLE audit_logs ENABLE ROW LEVEL SECURITY;

-- Policy: Users can view their own audit logs
CREATE POLICY "Users can view their own audit logs"
  ON audit_logs
  FOR SELECT
  USING (user_id = auth.uid());

-- Policy: Users can insert their own audit logs
CREATE POLICY "Users can insert their own audit logs"
  ON audit_logs
  FOR INSERT
  WITH CHECK (user_id = auth.uid());
