-- ============================================================================
-- FIX REALTIME MESSAGE DELIVERY
-- ============================================================================
-- This script enables realtime replication for the messages table and
-- verifies RLS policies allow realtime events to be received by clients.
-- ============================================================================

-- Step 1: Enable realtime replication for messages table
-- ============================================================================

-- Check if messages table is already in the publication, if not add it
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables 
    WHERE pubname = 'supabase_realtime' 
    AND tablename = 'messages'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE messages;
    RAISE NOTICE '✅ Added messages table to realtime publication';
  ELSE
    RAISE NOTICE 'ℹ️  Messages table already in realtime publication';
  END IF;
END $$;

-- Step 2: Verify realtime is enabled
-- ============================================================================
SELECT 
  schemaname,
  tablename,
  'Realtime enabled' as status
FROM pg_publication_tables 
WHERE pubname = 'supabase_realtime' 
AND tablename = 'messages';

-- Step 3: Check existing RLS policies on messages table
-- ============================================================================
SELECT 
  schemaname,
  tablename,
  policyname,
  permissive,
  roles,
  cmd,
  qual,
  with_check
FROM pg_policies 
WHERE tablename = 'messages'
ORDER BY policyname;

-- Step 4: Ensure SELECT policy exists for group members
-- ============================================================================
-- This policy is REQUIRED for realtime to work
-- Realtime uses SELECT permissions to determine who can receive events

DO $$
BEGIN
  -- Drop existing policy if it exists
  DROP POLICY IF EXISTS "Users can view messages in their groups" ON messages;
  
  -- Create policy that allows SELECT for group members
  CREATE POLICY "Users can view messages in their groups"
  ON messages FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM group_members
      WHERE group_members.group_id = messages.group_id
      AND group_members.user_id = auth.uid()
    )
  );
  
  RAISE NOTICE 'SELECT policy created successfully';
EXCEPTION
  WHEN OTHERS THEN
    RAISE NOTICE 'Policy creation failed: %', SQLERRM;
END $$;

-- Step 5: Verify the policy was created
-- ============================================================================
SELECT 
  policyname,
  cmd,
  'Policy active' as status
FROM pg_policies 
WHERE tablename = 'messages' 
AND cmd = 'SELECT';

-- Step 6: Test realtime subscription (informational)
-- ============================================================================
-- After running this script, test by:
-- 1. Open chat screen in app
-- 2. Send message from another device
-- 3. Check logs for: "📨 Realtime INSERT received"

-- Step 7: Verify group_members table has correct data
-- ============================================================================
-- Ensure users are actually members of groups they're trying to view
SELECT 
  gm.group_id,
  g.name as group_name,
  gm.user_id,
  u.display_name,
  gm.joined_at
FROM group_members gm
JOIN groups g ON g.id = gm.group_id
JOIN users u ON u.id = gm.user_id
ORDER BY g.name, u.display_name
LIMIT 20;

-- ============================================================================
-- TROUBLESHOOTING
-- ============================================================================

-- If realtime still doesn't work after running this script:

-- 1. Check if realtime is enabled globally in Supabase project settings
-- 2. Verify the user is authenticated (auth.uid() returns a value)
-- 3. Verify the user is a member of the group (check group_members table)
-- 4. Check Supabase logs for any realtime errors
-- 5. Ensure the client is using the correct access token

-- ============================================================================
-- EXPECTED RESULT
-- ============================================================================
-- After running this script and restarting the app:
-- - Messages should appear instantly (< 100ms) in chat
-- - Logs should show "📨 Realtime INSERT received" messages
-- - No FCM push notification required for instant delivery
-- ============================================================================
