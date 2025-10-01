/*
  # Add UPDATE policy for messages table
  
  ## Problem
  When using REST upsert with `on_conflict=dedupe_key`, Supabase tries to UPDATE
  existing messages if the dedupe_key already exists. However, there is no UPDATE
  policy on the messages table, causing a 403 RLS violation.
  
  ## Solution
  Add an UPDATE policy that allows users to update their own messages in groups
  they belong to. This is needed for the upsert operation to work correctly.
*/

-- Add UPDATE policy for messages table
CREATE POLICY "Users can update their own messages in their groups"
  ON messages
  FOR UPDATE
  TO authenticated
  USING (
    user_id = auth.uid()
    AND private.is_group_member(group_id)
  )
  WITH CHECK (
    user_id = auth.uid()
    AND private.is_group_member(group_id)
  );

