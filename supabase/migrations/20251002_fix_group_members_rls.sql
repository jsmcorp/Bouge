/*
  # Fix group_members RLS policy for is_group_member function

  ## Problem
  The `private.is_group_member()` function cannot read from `group_members` table
  because the RLS policy only allows reading where `user_id = auth.uid()`.

  ## Solution
  1. Disable RLS on group_members table (since it's accessed via SECURITY DEFINER function)
  2. OR make the is_group_member function bypass RLS by using a direct query

  We'll use approach 1: Disable RLS on group_members since access is controlled
  through the is_group_member function which is SECURITY DEFINER.
*/

-- Drop the restrictive policy
DROP POLICY IF EXISTS "Users can read their own group memberships" ON group_members;
DROP POLICY IF EXISTS "Users can read members of their groups" ON group_members;
DROP POLICY IF EXISTS "Users can insert themselves as group members" ON group_members;
DROP POLICY IF EXISTS "Users can remove themselves from groups" ON group_members;

-- Disable RLS on group_members table
-- Access control is handled by the is_group_member function and policies on other tables
ALTER TABLE group_members DISABLE ROW LEVEL SECURITY;

-- Re-enable basic policies for INSERT and DELETE to maintain security
ALTER TABLE group_members ENABLE ROW LEVEL SECURITY;

-- Allow users to read any group membership (needed for is_group_member function)
CREATE POLICY "Allow authenticated users to read group memberships"
  ON group_members
  FOR SELECT
  TO authenticated
  USING (true);

-- Users can only add themselves to groups
CREATE POLICY "Users can insert themselves as group members"
  ON group_members
  FOR INSERT
  TO authenticated
  WITH CHECK (user_id = auth.uid());

-- Users can only remove themselves from groups
CREATE POLICY "Users can remove themselves from groups"
  ON group_members
  FOR DELETE
  TO authenticated
  USING (user_id = auth.uid());

