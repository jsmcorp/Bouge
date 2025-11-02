/*
  # Add Group Join Requests System
  
  1. New Table
    - `group_join_requests`
      - `id` (uuid, primary key)
      - `group_id` (uuid, foreign key to groups)
      - `user_id` (uuid, foreign key to users)
      - `invited_by` (uuid, foreign key to users, nullable - null for invite code joins)
      - `status` (text, enum: 'pending', 'approved', 'rejected')
      - `created_at` (timestamptz)
      - `updated_at` (timestamptz)
  
  2. Security
    - Enable RLS
    - Policies for:
      - Group admins can view all requests for their groups
      - Group admins can approve/reject requests
      - Users can view their own requests
      - Anyone can create join requests (will be validated by app logic)
  
  3. Indexes
    - Index on group_id for fast lookups
    - Index on status for filtering pending requests
    - Composite index on (group_id, status) for admin queries
*/

-- Create group_join_requests table
CREATE TABLE IF NOT EXISTS group_join_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  group_id uuid NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  invited_by uuid REFERENCES users(id) ON DELETE SET NULL,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  UNIQUE(group_id, user_id) -- Prevent duplicate requests for same user in same group
);

-- Create indexes for performance
CREATE INDEX IF NOT EXISTS idx_join_requests_group_id ON group_join_requests(group_id);
CREATE INDEX IF NOT EXISTS idx_join_requests_status ON group_join_requests(status);
CREATE INDEX IF NOT EXISTS idx_join_requests_group_status ON group_join_requests(group_id, status);
CREATE INDEX IF NOT EXISTS idx_join_requests_user_id ON group_join_requests(user_id);

-- Enable Row Level Security
ALTER TABLE group_join_requests ENABLE ROW LEVEL SECURITY;

-- Policy: Users can view their own join requests
CREATE POLICY "Users can view their own join requests" ON group_join_requests
  FOR SELECT
  TO authenticated
  USING (user_id = auth.uid());

-- Policy: Group admins can view all requests for their groups
CREATE POLICY "Group admins can view requests for their groups" ON group_join_requests
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM groups g
      WHERE g.id = group_join_requests.group_id
      AND g.created_by = auth.uid()
    )
  );

-- Policy: Authenticated users can create join requests
CREATE POLICY "Authenticated users can create join requests" ON group_join_requests
  FOR INSERT
  TO authenticated
  WITH CHECK (user_id = auth.uid());

-- Policy: Group admins can update (approve/reject) requests for their groups
CREATE POLICY "Group admins can update requests for their groups" ON group_join_requests
  FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM groups g
      WHERE g.id = group_join_requests.group_id
      AND g.created_by = auth.uid()
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM groups g
      WHERE g.id = group_join_requests.group_id
      AND g.created_by = auth.uid()
    )
  );

-- Policy: Users can delete their own pending requests (cancel request)
CREATE POLICY "Users can delete their own pending requests" ON group_join_requests
  FOR DELETE
  TO authenticated
  USING (user_id = auth.uid() AND status = 'pending');

-- Function to automatically update updated_at timestamp
CREATE OR REPLACE FUNCTION update_group_join_requests_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Trigger to update updated_at on row update
CREATE TRIGGER update_group_join_requests_updated_at_trigger
  BEFORE UPDATE ON group_join_requests
  FOR EACH ROW
  EXECUTE FUNCTION update_group_join_requests_updated_at();

-- Function to automatically add user to group_members when request is approved
CREATE OR REPLACE FUNCTION handle_join_request_approval()
RETURNS TRIGGER AS $$
BEGIN
  -- Only proceed if status changed to 'approved'
  IF NEW.status = 'approved' AND (OLD.status IS NULL OR OLD.status != 'approved') THEN
    -- Insert into group_members if not already a member
    INSERT INTO group_members (group_id, user_id, joined_at)
    VALUES (NEW.group_id, NEW.user_id, now())
    ON CONFLICT (group_id, user_id) DO NOTHING;
  END IF;
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Trigger to auto-add member on approval
CREATE TRIGGER handle_join_request_approval_trigger
  AFTER UPDATE ON group_join_requests
  FOR EACH ROW
  EXECUTE FUNCTION handle_join_request_approval();

