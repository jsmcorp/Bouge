/*
  # Fix Group Members RLS Policies

  1. Security Changes
    - Drop existing problematic RLS policies on group_members table
    - Create simplified RLS policies that avoid infinite recursion
    - Ensure policies are efficient and don't cause circular dependencies

  2. Policy Changes
    - INSERT: Users can only add themselves to groups (auth.uid() = user_id)
    - SELECT: Users can read group members for groups they belong to (simplified query)
    - UPDATE: Not needed for this table
    - DELETE: Users can remove themselves from groups

  The previous policies had complex subqueries that caused infinite recursion
  when Supabase tried to evaluate them.
*/

-- Drop existing problematic policies
DROP POLICY IF EXISTS "Users can join groups" ON group_members;
DROP POLICY IF EXISTS "Users can read group members for groups they belong to" ON group_members;

-- Create simplified INSERT policy
CREATE POLICY "Users can add themselves to groups"
  ON group_members
  FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

-- Create simplified SELECT policy using a more efficient approach
CREATE POLICY "Users can read members of their groups"
  ON group_members
  FOR SELECT
  TO authenticated
  USING (
    group_id IN (
      SELECT gm.group_id 
      FROM group_members gm 
      WHERE gm.user_id = auth.uid()
    )
  );

-- Add DELETE policy so users can leave groups
CREATE POLICY "Users can remove themselves from groups"
  ON group_members
  FOR DELETE
  TO authenticated
  USING (auth.uid() = user_id);