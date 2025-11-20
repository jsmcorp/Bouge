/*
  # Allow users to update their own last_read_at in group_members
  
  ## Problem
  Users cannot mark messages as read because there's no UPDATE policy on group_members table.
  The current RLS policies only allow SELECT, INSERT, and DELETE.
  
  ## Solution
  Add an UPDATE policy that allows users to update their own group_members row
  (specifically last_read_at and last_read_message_id fields).
*/

-- Allow users to update their own group membership (for marking messages as read)
CREATE POLICY "Users can update their own group memberships"
  ON group_members
  FOR UPDATE
  TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

-- Add comment for documentation
COMMENT ON POLICY "Users can update their own group memberships" ON group_members IS 
  'Allows users to update last_read_at and last_read_message_id for unread tracking';
