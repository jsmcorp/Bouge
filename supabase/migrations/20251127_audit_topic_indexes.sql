-- Audit Topic Indexes
-- This migration adds EXPLAIN ANALYZE queries to verify index usage

-- Function to check if indexes are being used for common queries
CREATE OR REPLACE FUNCTION audit_topic_index_usage()
RETURNS TABLE (
  query_name TEXT,
  uses_index BOOLEAN,
  index_name TEXT,
  execution_plan TEXT
) 
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  -- This function can be called manually to audit index usage
  -- Run: SELECT * FROM audit_topic_index_usage();
  
  RAISE NOTICE 'Run these queries manually in Supabase SQL Editor to audit indexes:';
  RAISE NOTICE '';
  RAISE NOTICE '1. Check idx_topics_group_created usage:';
  RAISE NOTICE 'EXPLAIN ANALYZE SELECT * FROM topics WHERE group_id = ''<uuid>'' ORDER BY created_at DESC LIMIT 20;';
  RAISE NOTICE '';
  RAISE NOTICE '2. Check idx_topics_expires usage:';
  RAISE NOTICE 'EXPLAIN ANALYZE SELECT * FROM topics WHERE expires_at IS NOT NULL AND expires_at <= NOW();';
  RAISE NOTICE '';
  RAISE NOTICE '3. Check idx_messages_topic usage:';
  RAISE NOTICE 'EXPLAIN ANALYZE SELECT * FROM messages WHERE topic_id = ''<uuid>'' ORDER BY created_at DESC;';
  RAISE NOTICE '';
  RAISE NOTICE '4. Check idx_topic_likes_user usage:';
  RAISE NOTICE 'EXPLAIN ANALYZE SELECT * FROM topic_likes WHERE user_id = ''<uuid>'';';
  RAISE NOTICE '';
  RAISE NOTICE 'Look for "Index Scan" or "Index Only Scan" in the output to confirm index usage.';
  RAISE NOTICE 'If you see "Seq Scan", the index is not being used.';
  
  RETURN;
END;
$$;

-- Add comments to document expected index usage
COMMENT ON INDEX idx_topics_group_created IS 'Used by get_topics_paginated RPC for efficient topic feed queries';
COMMENT ON INDEX idx_topics_expires IS 'Used by delete_expired_topics RPC for cleanup job';
COMMENT ON INDEX idx_messages_topic IS 'Used when fetching messages for a specific topic chat';
COMMENT ON INDEX idx_topic_likes_user IS 'Used when checking user like status across topics';

-- Create a view to monitor topic query performance
CREATE OR REPLACE VIEW topic_performance_stats AS
SELECT 
  'topics' as table_name,
  schemaname,
  tablename,
  indexname,
  idx_scan as index_scans,
  idx_tup_read as tuples_read,
  idx_tup_fetch as tuples_fetched
FROM pg_stat_user_indexes
WHERE tablename IN ('topics', 'topic_likes', 'messages')
  AND indexname LIKE '%topic%'
ORDER BY idx_scan DESC;

COMMENT ON VIEW topic_performance_stats IS 'Monitor index usage statistics for topic-related queries';
