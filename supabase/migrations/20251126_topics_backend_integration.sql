/*
  # Topics Backend Integration
  
  1. New Tables
    - `topics` - Stores topic metadata (views, likes, expiration, etc.)
    - `topic_likes` - Tracks user likes on topics
  
  2. Schema Changes
    - Add `topic_id` column to messages table for topic replies
  
  3. Indexes
    - Performance indexes for topic queries
    - Expiration cleanup index
  
  4. RPC Functions
    - increment_topic_view - Atomic view count increment
    - toggle_topic_like - Like/unlike with count management
    - get_topics_paginated - Fetch topics with user-specific data
    - delete_expired_topics - Cleanup job for expired topics
  
  5. Security
    - RLS policies for topics and topic_likes
*/

-- ============================================
-- 1. CREATE TOPICS TABLE
-- ============================================

CREATE TABLE IF NOT EXISTS topics (
  id UUID PRIMARY KEY REFERENCES messages(id) ON DELETE CASCADE,
  group_id UUID NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  type TEXT NOT NULL CHECK (type IN ('text', 'poll', 'confession', 'news', 'image')),
  title TEXT,
  expires_at TIMESTAMPTZ, -- NULL means never expires
  views_count BIGINT DEFAULT 0,
  likes_count BIGINT DEFAULT 0,
  replies_count BIGINT DEFAULT 0,
  is_anonymous BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  CONSTRAINT valid_expiry CHECK (expires_at IS NULL OR expires_at > created_at)
);

-- ============================================
-- 2. CREATE TOPIC_LIKES TABLE
-- ============================================

CREATE TABLE IF NOT EXISTS topic_likes (
  topic_id UUID NOT NULL REFERENCES topics(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  PRIMARY KEY (topic_id, user_id)
);

-- ============================================
-- 3. ADD TOPIC_ID TO MESSAGES TABLE
-- ============================================

-- Add topic_id column to messages table for topic replies
DO $$ 
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'messages' AND column_name = 'topic_id'
  ) THEN
    ALTER TABLE messages ADD COLUMN topic_id UUID REFERENCES topics(id) ON DELETE CASCADE;
  END IF;
END $$;

-- ============================================
-- 4. CREATE INDEXES
-- ============================================

-- Topics indexes
CREATE INDEX IF NOT EXISTS idx_topics_group_created ON topics(group_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_topics_expires ON topics(expires_at) WHERE expires_at IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_topics_type ON topics(type);

-- Topic likes indexes
CREATE INDEX IF NOT EXISTS idx_topic_likes_user ON topic_likes(user_id);
CREATE INDEX IF NOT EXISTS idx_topic_likes_topic ON topic_likes(topic_id);

-- Messages topic_id index
CREATE INDEX IF NOT EXISTS idx_messages_topic ON messages(topic_id, created_at DESC) WHERE topic_id IS NOT NULL;

-- ============================================
-- 5. ENABLE ROW LEVEL SECURITY
-- ============================================

ALTER TABLE topics ENABLE ROW LEVEL SECURITY;
ALTER TABLE topic_likes ENABLE ROW LEVEL SECURITY;

-- ============================================
-- 6. CREATE RLS POLICIES FOR TOPICS
-- ============================================

-- Policy: Users can read topics in groups they're members of
CREATE POLICY "Users can read group topics" ON topics
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM group_members
      WHERE group_id = topics.group_id
      AND user_id = auth.uid()
    )
  );

-- Policy: Users can create topics in groups they're members of
CREATE POLICY "Users can create group topics" ON topics
  FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM group_members
      WHERE group_id = topics.group_id
      AND user_id = auth.uid()
    )
  );

-- Policy: Users can update topics they created (for metrics)
CREATE POLICY "Users can update topic metrics" ON topics
  FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM messages m
      WHERE m.id = topics.id
      AND m.user_id = auth.uid()
    )
  );

-- ============================================
-- 7. CREATE RLS POLICIES FOR TOPIC_LIKES
-- ============================================

-- Policy: Users can view all likes (to see like counts)
CREATE POLICY "Users can view topic likes" ON topic_likes
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM topics t
      INNER JOIN group_members gm ON gm.group_id = t.group_id
      WHERE t.id = topic_likes.topic_id
      AND gm.user_id = auth.uid()
    )
  );

-- Policy: Users can manage their own likes
CREATE POLICY "Users can manage own likes" ON topic_likes
  FOR ALL
  TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

-- ============================================
-- 8. RPC FUNCTION: INCREMENT_TOPIC_VIEW
-- ============================================

CREATE OR REPLACE FUNCTION increment_topic_view(p_topic_id UUID)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  UPDATE topics
  SET views_count = views_count + 1
  WHERE id = p_topic_id;
END;
$$;

-- ============================================
-- 9. RPC FUNCTION: TOGGLE_TOPIC_LIKE
-- ============================================

CREATE OR REPLACE FUNCTION toggle_topic_like(p_topic_id UUID)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_user_id UUID;
  v_liked BOOLEAN;
BEGIN
  v_user_id := auth.uid();
  
  -- Check if already liked
  SELECT EXISTS(
    SELECT 1 FROM topic_likes
    WHERE topic_id = p_topic_id AND user_id = v_user_id
  ) INTO v_liked;
  
  IF v_liked THEN
    -- Unlike
    DELETE FROM topic_likes
    WHERE topic_id = p_topic_id AND user_id = v_user_id;
    
    UPDATE topics
    SET likes_count = GREATEST(0, likes_count - 1)
    WHERE id = p_topic_id;
    
    RETURN FALSE;
  ELSE
    -- Like
    INSERT INTO topic_likes (topic_id, user_id)
    VALUES (p_topic_id, v_user_id)
    ON CONFLICT DO NOTHING;
    
    UPDATE topics
    SET likes_count = likes_count + 1
    WHERE id = p_topic_id;
    
    RETURN TRUE;
  END IF;
END;
$$;

-- ============================================
-- 10. RPC FUNCTION: GET_TOPICS_PAGINATED
-- ============================================

CREATE OR REPLACE FUNCTION get_topics_paginated(
  p_group_id UUID,
  p_limit INT DEFAULT 20,
  p_offset INT DEFAULT 0
)
RETURNS TABLE (
  id UUID,
  group_id UUID,
  type TEXT,
  title TEXT,
  content TEXT,
  author_id UUID,
  author_name TEXT,
  author_avatar TEXT,
  pseudonym TEXT,
  expires_at TIMESTAMPTZ,
  views_count BIGINT,
  likes_count BIGINT,
  replies_count BIGINT,
  is_anonymous BOOLEAN,
  is_liked_by_user BOOLEAN,
  created_at TIMESTAMPTZ,
  message_type TEXT,
  image_url TEXT
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_user_id UUID;
BEGIN
  v_user_id := auth.uid();
  
  RETURN QUERY
  SELECT 
    t.id,
    t.group_id,
    t.type,
    t.title,
    m.content,
    CASE WHEN t.is_anonymous THEN NULL ELSE m.user_id END as author_id,
    CASE WHEN t.is_anonymous THEN NULL ELSE u.display_name END as author_name,
    CASE WHEN t.is_anonymous THEN NULL ELSE u.avatar_url END as author_avatar,
    CASE WHEN t.is_anonymous THEN up.pseudonym ELSE NULL END as pseudonym,
    t.expires_at,
    t.views_count,
    t.likes_count,
    t.replies_count,
    t.is_anonymous,
    EXISTS(
      SELECT 1 FROM topic_likes tl
      WHERE tl.topic_id = t.id AND tl.user_id = v_user_id
    ) as is_liked_by_user,
    t.created_at,
    m.message_type,
    m.image_url
  FROM topics t
  INNER JOIN messages m ON t.id = m.id
  LEFT JOIN users u ON m.user_id = u.id
  LEFT JOIN user_pseudonyms up ON up.group_id = t.group_id AND up.user_id = m.user_id
  WHERE t.group_id = p_group_id
    AND (t.expires_at IS NULL OR t.expires_at > NOW())
  ORDER BY t.created_at DESC
  LIMIT p_limit
  OFFSET p_offset;
END;
$$;

-- ============================================
-- 11. RPC FUNCTION: DELETE_EXPIRED_TOPICS
-- ============================================

CREATE OR REPLACE FUNCTION delete_expired_topics()
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_deleted_count INTEGER;
BEGIN
  -- Delete messages (cascade will handle topics and related data)
  WITH deleted AS (
    DELETE FROM messages
    WHERE id IN (
      SELECT id FROM topics
      WHERE expires_at IS NOT NULL AND expires_at <= NOW()
    )
    RETURNING id
  )
  SELECT COUNT(*) INTO v_deleted_count FROM deleted;
  
  RETURN v_deleted_count;
END;
$$;

-- ============================================
-- 12. ENABLE REALTIME FOR TOPICS
-- ============================================

-- Enable realtime for topics table
ALTER PUBLICATION supabase_realtime ADD TABLE topics;
ALTER PUBLICATION supabase_realtime ADD TABLE topic_likes;

-- ============================================
-- 13. COMMENTS FOR DOCUMENTATION
-- ============================================

COMMENT ON TABLE topics IS 'Stores topic metadata for the topics feed feature';
COMMENT ON TABLE topic_likes IS 'Tracks user likes on topics';
COMMENT ON COLUMN messages.topic_id IS 'References the topic this message belongs to (for topic replies)';
COMMENT ON FUNCTION increment_topic_view IS 'Atomically increments the view count for a topic';
COMMENT ON FUNCTION toggle_topic_like IS 'Toggles like status for a topic and returns new state';
COMMENT ON FUNCTION get_topics_paginated IS 'Fetches paginated topics with user-specific data';
COMMENT ON FUNCTION delete_expired_topics IS 'Deletes expired topics (called by cron job)';
