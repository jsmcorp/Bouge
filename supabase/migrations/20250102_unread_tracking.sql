/*
  # Add Unread Message Tracking
  
  This migration adds unread message tracking functionality to enable:
  1. Tracking last read message per user per group
  2. Calculating unread message counts
  3. Displaying unread message separator (WhatsApp-style)
  4. Auto-scrolling to first unread message
*/

-- Add last_read_at column to group_members table
ALTER TABLE group_members 
ADD COLUMN IF NOT EXISTS last_read_at timestamptz DEFAULT now();

-- Add last_read_message_id for precise tracking
ALTER TABLE group_members 
ADD COLUMN IF NOT EXISTS last_read_message_id uuid REFERENCES messages(id) ON DELETE SET NULL;

-- Create index for performance on unread queries
CREATE INDEX IF NOT EXISTS idx_group_members_last_read 
ON group_members(group_id, user_id, last_read_at);

-- Create index on messages for unread count queries
CREATE INDEX IF NOT EXISTS idx_messages_group_created 
ON messages(group_id, created_at DESC);

-- Function to get unread count for a user in a group
CREATE OR REPLACE FUNCTION get_unread_count(
  p_group_id uuid,
  p_user_id uuid
) RETURNS integer AS $$
DECLARE
  v_last_read_at timestamptz;
  v_joined_at timestamptz;
  v_baseline_time timestamptz;
  v_unread_count integer;
BEGIN
  -- Get the last read timestamp and joined timestamp for this user in this group
  SELECT last_read_at, joined_at INTO v_last_read_at, v_joined_at
  FROM group_members
  WHERE group_id = p_group_id AND user_id = p_user_id;

  -- If no record found, return 0
  IF v_joined_at IS NULL THEN
    RETURN 0;
  END IF;

  -- If last_read_at is NULL (never read), use joined_at as baseline
  -- This ensures only messages AFTER joining are counted as unread
  v_baseline_time := COALESCE(v_last_read_at, v_joined_at);

  -- Count messages created after baseline, excluding user's own messages
  SELECT COUNT(*)::integer INTO v_unread_count
  FROM messages
  WHERE group_id = p_group_id
    AND user_id != p_user_id
    AND created_at > v_baseline_time;

  RETURN COALESCE(v_unread_count, 0);
END;
$$ LANGUAGE plpgsql STABLE SECURITY DEFINER;

-- Function to get unread counts for all groups for a user
CREATE OR REPLACE FUNCTION get_all_unread_counts(
  p_user_id uuid
) RETURNS TABLE(group_id uuid, unread_count integer) AS $$
BEGIN
  RETURN QUERY
  SELECT 
    gm.group_id,
    (
      SELECT COUNT(*)::integer
      FROM messages m
      WHERE m.group_id = gm.group_id
        AND m.user_id != p_user_id
        AND m.created_at > COALESCE(gm.last_read_at, '1970-01-01'::timestamptz)
    ) as unread_count
  FROM group_members gm
  WHERE gm.user_id = p_user_id;
END;
$$ LANGUAGE plpgsql STABLE SECURITY DEFINER;

-- Function to mark a group as read (update last_read_at)
CREATE OR REPLACE FUNCTION mark_group_as_read(
  p_group_id uuid,
  p_user_id uuid,
  p_last_message_id uuid DEFAULT NULL
) RETURNS void AS $$
BEGIN
  UPDATE group_members
  SET 
    last_read_at = now(),
    last_read_message_id = COALESCE(p_last_message_id, last_read_message_id)
  WHERE group_id = p_group_id 
    AND user_id = p_user_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Function to get first unread message ID for a user in a group
CREATE OR REPLACE FUNCTION get_first_unread_message_id(
  p_group_id uuid,
  p_user_id uuid
) RETURNS uuid AS $$
DECLARE
  v_last_read_at timestamptz;
  v_joined_at timestamptz;
  v_baseline_time timestamptz;
  v_first_unread_id uuid;
BEGIN
  -- Get the last read timestamp and joined timestamp
  SELECT last_read_at, joined_at INTO v_last_read_at, v_joined_at
  FROM group_members
  WHERE group_id = p_group_id AND user_id = p_user_id;

  -- If no record found, return NULL
  IF v_joined_at IS NULL THEN
    RETURN NULL;
  END IF;

  -- If last_read_at is NULL (never read), use joined_at as baseline
  v_baseline_time := COALESCE(v_last_read_at, v_joined_at);

  -- Get the first message created after baseline, excluding user's own messages
  SELECT id INTO v_first_unread_id
  FROM messages
  WHERE group_id = p_group_id
    AND user_id != p_user_id
    AND created_at > v_baseline_time
  ORDER BY created_at ASC
  LIMIT 1;

  RETURN v_first_unread_id;
END;
$$ LANGUAGE plpgsql STABLE SECURITY DEFINER;

-- Grant execute permissions on functions
GRANT EXECUTE ON FUNCTION get_unread_count(uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION get_all_unread_counts(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION mark_group_as_read(uuid, uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION get_first_unread_message_id(uuid, uuid) TO authenticated;

-- Add comment for documentation
COMMENT ON FUNCTION get_unread_count IS 'Returns the number of unread messages for a user in a specific group';
COMMENT ON FUNCTION get_all_unread_counts IS 'Returns unread counts for all groups that a user is a member of';
COMMENT ON FUNCTION mark_group_as_read IS 'Marks all messages in a group as read for a user';
COMMENT ON FUNCTION get_first_unread_message_id IS 'Returns the ID of the first unread message in a group for a user';

