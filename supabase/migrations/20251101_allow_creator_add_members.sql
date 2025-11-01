/*
  Allow group creators to add members to their groups

  Problem:
  - Current RLS on group_members only allows a user to insert themselves (user_id = auth.uid()).
  - Our group creation flow needs the creator to add selected members at creation time.

  Solution:
  - Add an INSERT policy on group_members that permits the group creator to insert any user
    into group_members for groups they created.
*/

DROP POLICY IF EXISTS "Group creator can add members to their groups" ON group_members;

CREATE POLICY "Group creator can add members to their groups"
  ON group_members
  FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM groups g
      WHERE g.id = group_members.group_id
        AND g.created_by = auth.uid()
    )
  );

