/*
  Secure RLS setup — ready to copy‑paste
  --------------------------------------
  • Creates helper schema/function
  • Drops any existing conflicting policies
  • Re‑creates safe, non‑recursive policies
*/

/* ---------- 1. Helper schema + function ---------- */
CREATE SCHEMA IF NOT EXISTS private;

CREATE OR REPLACE FUNCTION private.is_group_member(q_group_id uuid)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM group_members
    WHERE group_id = q_group_id
      AND user_id = auth.uid()
  );
$$;

/* ---------- 2. group_members policies ---------- */
DROP POLICY IF EXISTS "user can read members of their group"        ON group_members;
DROP POLICY IF EXISTS "Users can insert themselves as group members" ON group_members;
DROP POLICY IF EXISTS "Users can read their own group memberships"   ON group_members;
DROP POLICY IF EXISTS "Users can remove themselves from groups"      ON group_members;

CREATE POLICY "Users can read their own group memberships"
  ON group_members
  FOR SELECT
  TO authenticated
  USING (user_id = auth.uid());

CREATE POLICY "Users can insert themselves as group members"
  ON group_members
  FOR INSERT
  TO authenticated
  WITH CHECK (user_id = auth.uid());

CREATE POLICY "Users can remove themselves from groups"
  ON group_members
  FOR DELETE
  TO authenticated
  USING (user_id = auth.uid());

/* ---------- 3. groups policies ---------- */
DROP POLICY IF EXISTS "Users can read their groups" ON groups;

CREATE POLICY "Users can read their groups"
  ON groups
  FOR SELECT
  TO authenticated
  USING (private.is_group_member(id));

/* ---------- 4. messages policies ---------- */
DROP POLICY IF EXISTS "Users can read messages from groups they belong to" ON messages;
DROP POLICY IF EXISTS "Users can create messages in groups they belong to" ON messages;

CREATE POLICY "Users can read messages from groups they belong to"
  ON messages
  FOR SELECT
  TO authenticated
  USING (private.is_group_member(group_id));

CREATE POLICY "Users can create messages in groups they belong to"
  ON messages
  FOR INSERT
  TO authenticated
  WITH CHECK (
    user_id = auth.uid()
    AND private.is_group_member(group_id)
  );

/* ---------- 5. reactions policies ---------- */
DROP POLICY IF EXISTS "Users can read reactions for messages they can see"  ON reactions;
DROP POLICY IF EXISTS "Users can create reactions for messages they can see" ON reactions;

CREATE POLICY "Users can read reactions for messages they can see"
  ON reactions
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM messages m
      WHERE m.id = message_id
        AND private.is_group_member(m.group_id)
    )
  );

CREATE POLICY "Users can create reactions for messages they can see"
  ON reactions
  FOR INSERT
  TO authenticated
  WITH CHECK (
    user_id = auth.uid()
    AND EXISTS (
      SELECT 1
      FROM messages m
      WHERE m.id = message_id
        AND private.is_group_member(m.group_id)
    )
  );

/* ---------- 6. polls policies ---------- */
DROP POLICY IF EXISTS "Users can read polls for messages they can see"  ON polls;
DROP POLICY IF EXISTS "Users can create polls for messages they can see" ON polls;

CREATE POLICY "Users can read polls for messages they can see"
  ON polls
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM messages m
      WHERE m.id = message_id
        AND private.is_group_member(m.group_id)
    )
  );

CREATE POLICY "Users can create polls for messages they can see"
  ON polls
  FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM messages m
      WHERE m.id = message_id
        AND private.is_group_member(m.group_id)
    )
  );

/* ---------- 7. poll_votes policies ---------- */
DROP POLICY IF EXISTS "Users can read poll votes for polls they can see" ON poll_votes;
DROP POLICY IF EXISTS "Users can vote on polls they can see"             ON poll_votes;

CREATE POLICY "Users can read poll votes for polls they can see"
  ON poll_votes
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM polls p
      JOIN messages m ON m.id = p.message_id
      WHERE p.id = poll_id
        AND private.is_group_member(m.group_id)
    )
  );

CREATE POLICY "Users can vote on polls they can see"
  ON poll_votes
  FOR INSERT
  TO authenticated
  WITH CHECK (
    user_id = auth.uid()
    AND EXISTS (
      SELECT 1
      FROM polls p
      JOIN messages m ON m.id = p.message_id
      WHERE p.id = poll_id
        AND private.is_group_member(m.group_id)
    )
  );
