-- Enable RLS on jobs table
ALTER TABLE jobs ENABLE ROW LEVEL SECURITY;

-- Only admins can insert, update, or delete jobs
CREATE POLICY "Admins can modify jobs"
  ON jobs
  FOR ALL
  USING (EXISTS (
    SELECT 1 FROM auth.users u WHERE u.id = auth.uid() AND u.role = 'admin'
  ));
