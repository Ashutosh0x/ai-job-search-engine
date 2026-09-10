-- Allow all users to select jobs
CREATE POLICY "Anyone can view jobs"
  ON jobs
  FOR SELECT
  USING (true);
