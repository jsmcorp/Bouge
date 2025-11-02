/*
  # Add role column and fix member removal policies
  
  1. Changes
    - Add `role` column to group_members table (admin/member)
    - Update RLS policies to allow admins to remove members
    - Set group creator as admin automatically
  
  2. Security
    - Only group admins (created_by) can remove other members
    - Users can still remove themselves (leave group)
    - Admin role is assigned to group creator on member insert
*/

-- Add role column to group_members table
ALTER TABLE group_members 
ADD COLUMN IF NOT EXISTS role text DEFAULT 'member' CHECK (role IN ('admin', 'member'));

-- Update existing group creators to have admin role
UPDATE group_members gm
SET role = 'admin'
FROM groups g
WHERE gm.group_id = g.id 
  AND gm.user_id = g.created_by
  AND gm.role = 'member';

-- Drop existing DELETE policy
DROP POLICY IF EXISTS "Users can remove themselves from groups" ON group_members;

-- Create new DELETE policy that allows:
-- 1. Users to remove themselves (leave group)
-- 2. Group admins to remove any member
CREATE POLICY "Users can leave groups or admins can remove members" ON group_members
  FOR DELETE
  TO authenticated
  USING (
    -- User can remove themselves
    user_id = auth.uid()
    OR
    -- OR user is admin of the group
    EXISTS (
      SELECT 1 FROM groups g
      WHERE g.id = group_members.group_id
      AND g.created_by = auth.uid()
    )
  );

-- Function to automatically assign admin role to group creator
CREATE OR REPLACE FUNCTION assign_admin_role_to_creator()
RETURNS TRIGGER AS $$
BEGIN
  -- Check if the user being added is the group creator
  IF EXISTS (
    SELECT 1 FROM groups g
    WHERE g.id = NEW.group_id
    AND g.created_by = NEW.user_id
  ) THEN
    NEW.role = 'admin';
  ELSE
    -- Ensure role is set to member if not specified
    IF NEW.role IS NULL THEN
      NEW.role = 'member';
    END IF;
  END IF;
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Trigger to assign admin role on insert
DROP TRIGGER IF EXISTS assign_admin_role_trigger ON group_members;
CREATE TRIGGER assign_admin_role_trigger
  BEFORE INSERT ON group_members
  FOR EACH ROW
  EXECUTE FUNCTION assign_admin_role_to_creator();

-- Update the join request approval trigger to set role correctly
CREATE OR REPLACE FUNCTION handle_join_request_approval()
RETURNS TRIGGER AS $$
BEGIN
  -- Only proceed if status changed to 'approved'
  IF NEW.status = 'approved' AND (OLD.status IS NULL OR OLD.status != 'approved') THEN
    -- Insert into group_members if not already a member
    -- Role will be set by the assign_admin_role_to_creator trigger
    INSERT INTO group_members (group_id, user_id, joined_at)
    VALUES (NEW.group_id, NEW.user_id, now())
    ON CONFLICT (group_id, user_id) DO NOTHING;
  END IF;
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

