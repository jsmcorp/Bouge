-- ============================================================================
-- ENABLE REALTIME FOR MESSAGES TABLE
-- ============================================================================
-- Migration: 20251114_enable_realtime_messages
-- Purpose: Enable realtime replication for messages table to allow instant
--          message delivery without relying on FCM push notifications
-- ============================================================================

-- Step 1: Enable realtime replication for messages table
-- ============================================================================
-- This allows Supabase to broadcast INSERT/UPDATE/DELETE events to subscribed clients

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

-- CRITICAL: Set REPLICA IDENTITY to FULL for realtime to work
-- This tells PostgreSQL to include all column values in replication events
ALTER TABLE messages REPLICA IDENTITY FULL;
RAISE NOTICE '✅ Set REPLICA IDENTITY FULL for messages table';

-- Step 2: Verify realtime is enabled
-- ============================================================================
DO $$
DECLARE
  realtime_enabled BOOLEAN;
BEGIN
  SELECT EXISTS (
    SELECT 1 FROM pg_publication_tables 
    WHERE pubname = 'supabase_realtime' 
    AND tablename = 'messages'
  ) INTO realtime_enabled;
  
  IF realtime_enabled THEN
    RAISE NOTICE '✅ Realtime enabled for messages table';
  ELSE
    RAISE WARNING '❌ Failed to enable realtime for messages table';
  END IF;
END $$;

-- Step 3: Ensure RLS policies allow SELECT (required for realtime)
-- ============================================================================
-- Realtime uses SELECT permissions to determine who can receive events
-- Without SELECT permission, clients won't receive realtime events

-- Check if SELECT policy exists
DO $$
BEGIN
  -- Only create if it doesn't exist
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies 
    WHERE tablename = 'messages' 
    AND policyname = 'Users can view messages in their groups'
  ) THEN
    CREATE POLICY "Users can view messages in their groups"
    ON messages FOR SELECT
    USING (
      EXISTS (
        SELECT 1 FROM group_members
        WHERE group_members.group_id = messages.group_id
        AND group_members.user_id = auth.uid()
      )
    );
    RAISE NOTICE '✅ Created SELECT policy for messages';
  ELSE
    RAISE NOTICE 'ℹ️  SELECT policy already exists for messages';
  END IF;
END $$;

-- ============================================================================
-- VERIFICATION QUERIES (for manual testing)
-- ============================================================================

-- Verify realtime is enabled
SELECT 
  schemaname,
  tablename,
  'Realtime enabled ✅' as status
FROM pg_publication_tables 
WHERE pubname = 'supabase_realtime' 
AND tablename = 'messages';

-- Verify SELECT policy exists
SELECT 
  policyname,
  cmd,
  'Policy active ✅' as status
FROM pg_policies 
WHERE tablename = 'messages' 
AND cmd = 'SELECT';

-- ============================================================================
-- EXPECTED BEHAVIOR AFTER MIGRATION
-- ============================================================================
-- 1. Messages appear instantly (< 100ms) in chat when sent
-- 2. Logs show "📨 Realtime INSERT received" messages
-- 3. No FCM push notification required for instant delivery
-- 4. Works like WhatsApp instant messaging
-- ============================================================================
