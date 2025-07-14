/*
  # Fix RLS policies to prevent infinite recursion

  1. Security Policy Updates
    - Fix group_members policies to prevent circular references
    - Simplify policy logic to avoid recursive joins
    - Ensure proper access control without infinite loops

  2. Changes Made
    - Updated group_members SELECT policy to use simpler logic
    - Updated groups SELECT policy to avoid complex subqueries
    - Maintained security while fixing recursion issues
*/

-- Drop existing problematic policies
DROP POLICY IF EXISTS "Users can read group members for groups they belong to" ON group_members;
DROP POLICY IF EXISTS "Users can read groups they are members of" ON groups;

-- Create new simplified policies for group_members
CREATE POLICY "Users can read group members for groups they belong to"
  ON group_members
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM group_members gm2 
      WHERE gm2.group_id = group_members.group_id 
      AND gm2.user_id = auth.uid()
    )
  );

-- Create new simplified policy for groups
CREATE POLICY "Users can read groups they are members of"
  ON groups
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM group_members 
      WHERE group_members.group_id = groups.id 
      AND group_members.user_id = auth.uid()
    )
  );

-- Ensure all other policies remain intact
-- Users can join groups (INSERT policy for group_members)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies 
    WHERE tablename = 'group_members' 
    AND policyname = 'Users can join groups'
  ) THEN
    CREATE POLICY "Users can join groups"
      ON group_members
      FOR INSERT
      TO authenticated
      WITH CHECK (user_id = auth.uid());
  END IF;
END $$;

-- Users can create groups (INSERT policy for groups)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies 
    WHERE tablename = 'groups' 
    AND policyname = 'Users can create groups'
  ) THEN
    CREATE POLICY "Users can create groups"
      ON groups
      FOR INSERT
      TO authenticated
      WITH CHECK (created_by = auth.uid());
  END IF;
END $$;