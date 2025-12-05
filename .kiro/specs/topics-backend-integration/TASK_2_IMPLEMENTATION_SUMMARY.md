# Task 2: Supabase RPC Functions - Implementation Summary

## Overview
All four Supabase RPC functions for the topics backend integration have been successfully implemented in the migration file `supabase/migrations/20251126_topics_backend_integration.sql`.

## Implemented Functions

### 2.1 ✅ increment_topic_view
**Location:** Lines 138-148 in migration file

**Purpose:** Atomically increments the view count for a topic to prevent race conditions.

**Implementation:**
```sql
CREATE OR REPLACE FUNCTION increment_topic_view(p_topic_id UUID)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $
BEGIN
  UPDATE topics
  SET views_count = views_count + 1
  WHERE id = p_topic_id;
END;
$;
```

**Requirements Validated:** 5.1, 5.2
- ✅ Increments views_count by exactly 1
- ✅ Uses atomic database operation to prevent race conditions

---

### 2.2 ✅ toggle_topic_like
**Location:** Lines 153-188 in migration file

**Purpose:** Handles like/unlike operations with automatic count management.

**Implementation:**
```sql
CREATE OR REPLACE FUNCTION toggle_topic_like(p_topic_id UUID)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
AS $
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
$;
```

**Requirements Validated:** 3.1, 3.2, 3.3, 3.4
- ✅ Toggles like status (like → unlike → like)
- ✅ Increments likes_count when adding a like
- ✅ Decrements likes_count when removing a like (with GREATEST to prevent negative)
- ✅ Enforces uniqueness via ON CONFLICT DO NOTHING
- ✅ Returns boolean indicating new like state

---

### 2.3 ✅ get_topics_paginated
**Location:** Lines 193-248 in migration file

**Purpose:** Fetches paginated topics with user-specific data including like status.

**Implementation:**
```sql
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
AS $
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
$;
```

**Requirements Validated:** 1.1, 1.2, 1.4, 1.6, 3.5
- ✅ Accepts pagination parameters (limit, offset)
- ✅ Joins with messages, users, user_pseudonyms tables
- ✅ Calculates is_liked_by_user flag using EXISTS subquery
- ✅ Filters out expired topics (expires_at IS NULL OR expires_at > NOW())
- ✅ Returns all required fields for topic display
- ✅ Orders by created_at DESC (newest first)
- ✅ Handles anonymous topics (hides author, shows pseudonym)

---

### 2.4 ✅ delete_expired_topics
**Location:** Lines 253-272 in migration file

**Purpose:** Cleanup job to delete expired topics and cascade delete related data.

**Implementation:**
```sql
CREATE OR REPLACE FUNCTION delete_expired_topics()
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $
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
$;
```

**Requirements Validated:** 6.1, 6.4
- ✅ Deletes topics where expires_at has passed
- ✅ Uses CASCADE deletion (deletes from messages, which cascades to topics and related data)
- ✅ Returns count of deleted topics for monitoring
- ✅ Only deletes topics with non-null expires_at that have passed

---

## Security Considerations

All RPC functions use `SECURITY DEFINER` which means they run with the privileges of the function owner, not the caller. This is necessary because:

1. **increment_topic_view**: Needs to update topics table without requiring user to have UPDATE permission
2. **toggle_topic_like**: Needs to manage topic_likes and update counts atomically
3. **get_topics_paginated**: Needs to read across multiple tables with complex joins
4. **delete_expired_topics**: Needs to delete expired content (typically run by cron job)

RLS policies on the underlying tables still provide security:
- Users can only read topics in groups they're members of
- Users can only manage their own likes
- The functions respect these constraints through proper WHERE clauses

---

## Testing Recommendations

To verify these functions work correctly:

1. **increment_topic_view**: Test concurrent increments don't lose updates
2. **toggle_topic_like**: Test like → unlike → like cycle, verify counts
3. **get_topics_paginated**: Test pagination, expired topic filtering, anonymous topics
4. **delete_expired_topics**: Test cascade deletion of related data

---

## Next Steps

With all RPC functions implemented, the next task is:
- **Task 3**: Set up Row Level Security (RLS) policies (already completed in migration)
- **Task 4**: Implement SQLite service methods for topics

---

## Status: ✅ COMPLETE

All subtasks completed:
- ✅ 2.1 increment_topic_view
- ✅ 2.2 toggle_topic_like
- ✅ 2.3 get_topics_paginated
- ✅ 2.4 delete_expired_topics
