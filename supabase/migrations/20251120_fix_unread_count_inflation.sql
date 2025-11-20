-- Fix unread count inflation on app restart/resume
-- 
-- Root Cause: 
-- 1. mark_group_as_read allowed read pointer to move backward when requests arrived out of order
-- 2. get_all_unread_counts wasn't strictly aligned with timestamp-based read tracking
--
-- This migration adds:
-- 1. Protection against backward-moving read pointer (prevents "un-reading" messages)
-- 2. Strict timestamp-based counting using auth.uid() for security
-- 3. Proper handling of NULL last_read_at cases

-- 1. UPGRADE mark_group_as_read
-- Improvement: Adds a check to ensure we never overwrite a newer read status with an older one.
-- Also prevents accidental "mark all as read" when lastMessageId is NULL.
CREATE OR REPLACE FUNCTION mark_group_as_read(
  p_group_id uuid,
  p_user_id uuid,
  p_last_message_id uuid DEFAULT NULL
) RETURNS void AS $$
DECLARE
  v_message_timestamp timestamptz;
BEGIN
  -- SAFETY CHECK: If no specific message ID is provided, DO NOT mark as read.
  -- This prevents accidental "mark all as read" during app loading/initialization.
  IF p_last_message_id IS NULL THEN
    RETURN;
  END IF;
  
  -- 1. Get the exact timestamp of the message
  SELECT created_at INTO v_message_timestamp
  FROM messages
  WHERE id = p_last_message_id;
  
  -- If message doesn't exist (invalid ID), also abort.
  IF v_message_timestamp IS NULL THEN
    RETURN;
  END IF;
  
  -- 2. Update ONLY if the new message is newer than the current last_read_at
  -- This prevents "un-reading" messages if requests arrive out of order
  UPDATE group_members
  SET 
    last_read_at = v_message_timestamp,
    last_read_message_id = p_last_message_id
  WHERE group_id = p_group_id 
    AND user_id = p_user_id
    AND (last_read_at IS NULL OR v_message_timestamp > last_read_at);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 2. UPGRADE get_all_unread_counts
-- Improvement: Ensures strict counting based on the timestamp logic above.
-- Uses auth.uid() for better security and strict timestamp comparison.
CREATE OR REPLACE FUNCTION get_all_unread_counts()
RETURNS TABLE (group_id uuid, unread_count bigint) AS $$
BEGIN
  RETURN QUERY
  SELECT 
    m.group_id,
    COUNT(*)::bigint
  FROM messages m
  JOIN group_members gm ON m.group_id = gm.group_id
  WHERE gm.user_id = auth.uid()
    -- Count messages created strictly AFTER the last read timestamp
    AND (gm.last_read_at IS NULL OR m.created_at > gm.last_read_at)
    -- Exclude user's own messages from unread count
    AND m.user_id != auth.uid()
  GROUP BY m.group_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Add comment for documentation
COMMENT ON FUNCTION mark_group_as_read IS 'Marks messages as read with protection against backward-moving read pointer';
COMMENT ON FUNCTION get_all_unread_counts IS 'Returns unread counts using strict timestamp-based logic to prevent inflation, excluding user own messages';
