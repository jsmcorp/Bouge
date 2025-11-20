-- Fix mark_group_as_read to use message timestamp instead of now()
-- This prevents clock skew issues where server time might be before message timestamps

CREATE OR REPLACE FUNCTION mark_group_as_read(
  p_group_id uuid,
  p_user_id uuid,
  p_last_message_id uuid DEFAULT NULL
) RETURNS void AS $$
DECLARE
  v_message_timestamp timestamptz;
BEGIN
  -- Get the timestamp of the last message being marked as read
  -- This prevents clock skew issues by using the actual message timestamp
  IF p_last_message_id IS NOT NULL THEN
    SELECT created_at INTO v_message_timestamp
    FROM messages
    WHERE id = p_last_message_id AND group_id = p_group_id;
  END IF;
  
  UPDATE group_members
  SET 
    last_read_at = COALESCE(v_message_timestamp, now()),
    last_read_message_id = COALESCE(p_last_message_id, last_read_message_id)
  WHERE group_id = p_group_id 
    AND user_id = p_user_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
