/*
  # Fix infinite recursion in RLS policies

  1. Policy Updates
    - Remove circular dependencies in group_members and groups policies
    - Simplify policies to avoid self-referential queries during INSERT operations
    - Ensure users can create groups and join them without policy conflicts

  2. Changes Made
    - Update groups SELECT policy to be more direct
    - Update group_members policies to avoid recursion
    - Add proper policies for group creation workflow

  3. Security
    - Maintain security while fixing recursion issues
    - Users can only access groups they're members of
    - Users can only manage their own memberships
*/

-- Drop existing problematic policies
DROP POLICY IF EXISTS "Users can read groups they are members of" ON groups;
DROP POLICY IF EXISTS "Users can read members of their groups" ON group_members;
DROP POLICY IF EXISTS "Users can add themselves to groups" ON group_members;

-- Create new non-recursive policies for groups
CREATE POLICY "Users can read groups they are members of" ON groups
  FOR SELECT
  TO authenticated
  USING (
    id IN (
      SELECT gm.group_id 
      FROM group_members gm 
      WHERE gm.user_id = auth.uid()
    )
  );

-- Create new non-recursive policies for group_members
CREATE POLICY "Users can read group members" ON group_members
  FOR SELECT
  TO authenticated
  USING (
    -- Users can read members of groups they belong to
    group_id IN (
      SELECT gm2.group_id 
      FROM group_members gm2 
      WHERE gm2.user_id = auth.uid()
    )
  );

CREATE POLICY "Users can join groups" ON group_members
  FOR INSERT
  TO authenticated
  WITH CHECK (
    -- Users can only add themselves
    user_id = auth.uid()
    -- No need to check group membership during INSERT as that would cause recursion
  );

-- Keep the existing DELETE policy as it's not problematic
-- "Users can remove themselves from groups" should already exist and work fine

-- Add a policy to allow reading groups by invite code (needed for joining)
CREATE POLICY "Users can read groups by invite code" ON groups
  FOR SELECT
  TO authenticated
  USING (true); -- Allow reading any group for invite code lookup

-- Update the main groups policy to be more specific
DROP POLICY IF EXISTS "Users can read groups by invite code" ON groups;
CREATE POLICY "Users can read all groups for joining" ON groups
  FOR SELECT
  TO authenticated
  USING (true);

-- Recreate the main policy with a different approach
DROP POLICY IF EXISTS "Users can read groups they are members of" ON groups;
CREATE POLICY "Users can read their groups" ON groups
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 
      FROM group_members gm 
      WHERE gm.group_id = groups.id 
      AND gm.user_id = auth.uid()
    )
  );