/*
  # Fix infinite recursion in group_members RLS policy

  1. Policy Changes
    - Drop the existing INSERT policy for group_members that causes infinite recursion
    - Create a new, simpler INSERT policy that allows users to add themselves as members
    - Ensure the policy doesn't create recursive checks during group creation

  2. Security
    - Maintain security by ensuring users can only add themselves as members
    - Keep existing SELECT and DELETE policies intact
*/

-- Drop the existing INSERT policy that causes infinite recursion
DROP POLICY IF EXISTS "Users can join groups" ON group_members;

-- Create a new, simpler INSERT policy that avoids recursion
CREATE POLICY "Users can add themselves as group members"
  ON group_members
  FOR INSERT
  TO authenticated
  WITH CHECK (user_id = auth.uid());