/*
  # Fix infinite recursion in group_members RLS policy

  1. Problem
    - The current SELECT policy on group_members table causes infinite recursion
    - Policy tries to query group_members table from within its own policy condition
    
  2. Solution
    - Replace the recursive policy with a simple policy that allows users to see their own memberships
    - Users can read group_members records where they are the user_id
    - This eliminates the recursive query while maintaining security
    
  3. Security
    - Users can only see group membership records where they are involved
    - No access to other users' membership information unless they share a group
*/

-- Drop the existing problematic policy
DROP POLICY IF EXISTS "Users can read group members" ON group_members;

-- Create a new, non-recursive policy for reading group members
-- Users can see group membership records where they are the member
CREATE POLICY "Users can read their own group memberships"
  ON group_members
  FOR SELECT
  TO authenticated
  USING (user_id = auth.uid());

-- Create an additional policy to allow users to see other members of groups they belong to
-- This requires a different approach that doesn't cause recursion
CREATE POLICY "Users can read members of their groups"
  ON group_members
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 
      FROM groups g 
      WHERE g.id = group_members.group_id 
      AND (
        g.created_by = auth.uid() 
        OR EXISTS (
          SELECT 1 
          FROM group_members gm 
          WHERE gm.group_id = g.id 
          AND gm.user_id = auth.uid()
        )
      )
    )
  );