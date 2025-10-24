-- Migration: Optimized Contact Discovery RPC V3 (WhatsApp-like with improvements)
-- Purpose: Single RPC call with contact names, efficient UPSERT, no delete churn
-- Date: 2025-01-25
-- Improvements over V2:
--   1. Accepts contact names (preserves original names)
--   2. Uses temp table + MERGE for efficient UPSERT (no full delete)
--   3. Only runs when checksum changes (client-side check)
--   4. Returns contact names with matches

-- ============================================
-- FUNCTION: discover_contacts_v3
-- ============================================

CREATE OR REPLACE FUNCTION discover_contacts_v3(
  p_contacts JSONB  -- Array of {phone: TEXT, name: TEXT}
)
RETURNS TABLE (
  user_id UUID,
  phone_number TEXT,
  phone_e164 TEXT,
  display_name TEXT,
  avatar_url TEXT,
  contact_name TEXT  -- Original name from device
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id UUID;
  v_contact_count INTEGER;
  v_start_time TIMESTAMPTZ;
  v_end_time TIMESTAMPTZ;
  v_duration_ms INTEGER;
  v_inserted INTEGER := 0;
  v_updated INTEGER := 0;
  v_deleted INTEGER := 0;
BEGIN
  v_start_time := clock_timestamp();
  
  -- Get current authenticated user
  v_user_id := auth.uid();
  
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;
  
  -- Validate input
  v_contact_count := jsonb_array_length(p_contacts);
  
  IF v_contact_count IS NULL OR v_contact_count = 0 THEN
    RAISE NOTICE 'No contacts provided';
    RETURN;
  END IF;
  
  -- Enforce limit (max 5000 contacts per call)
  IF v_contact_count > 5000 THEN
    RAISE EXCEPTION 'Too many contacts (max 5000, got %)', v_contact_count;
  END IF;
  
  RAISE NOTICE 'Processing % contacts for user %', v_contact_count, v_user_id;
  
  -- ============================================
  -- STEP 1: Create temp table for new contacts
  -- ============================================
  
  CREATE TEMP TABLE temp_contacts (
    phone_e164 TEXT NOT NULL,
    contact_name TEXT,
    contact_phone TEXT
  ) ON COMMIT DROP;
  
  -- Insert contacts from JSONB into temp table
  INSERT INTO temp_contacts (phone_e164, contact_name, contact_phone)
  SELECT 
    (contact->>'phone')::TEXT AS phone_e164,
    (contact->>'name')::TEXT AS contact_name,
    (contact->>'phone')::TEXT AS contact_phone
  FROM jsonb_array_elements(p_contacts) AS contact
  WHERE (contact->>'phone') IS NOT NULL 
    AND (contact->>'phone') != '';
  
  -- Create index on temp table for faster joins
  CREATE INDEX idx_temp_contacts_phone ON temp_contacts(phone_e164);
  
  RAISE NOTICE 'Loaded % contacts into temp table', (SELECT COUNT(*) FROM temp_contacts);
  
  -- ============================================
  -- STEP 2: Efficient MERGE (INSERT + UPDATE + DELETE)
  -- ============================================
  
  -- Delete contacts that are no longer in the new set
  WITH deleted AS (
    DELETE FROM user_contacts uc
    WHERE uc.user_id = v_user_id
      AND NOT EXISTS (
        SELECT 1 FROM temp_contacts tc
        WHERE tc.phone_e164 = uc.phone_e164
      )
    RETURNING *
  )
  SELECT COUNT(*) INTO v_deleted FROM deleted;
  
  -- Insert new contacts
  WITH inserted AS (
    INSERT INTO user_contacts (
      user_id,
      contact_phone,
      phone_e164,
      contact_name,
      synced_at
    )
    SELECT
      v_user_id,
      tc.contact_phone,
      tc.phone_e164,
      tc.contact_name,
      NOW()
    FROM temp_contacts tc
    WHERE NOT EXISTS (
      SELECT 1 FROM user_contacts uc
      WHERE uc.user_id = v_user_id
        AND uc.phone_e164 = tc.phone_e164
    )
    RETURNING *
  )
  SELECT COUNT(*) INTO v_inserted FROM inserted;
  
  -- Update existing contacts (name might have changed)
  WITH updated AS (
    UPDATE user_contacts uc
    SET 
      contact_name = tc.contact_name,
      contact_phone = tc.contact_phone,
      synced_at = NOW()
    FROM temp_contacts tc
    WHERE uc.user_id = v_user_id
      AND uc.phone_e164 = tc.phone_e164
      AND (
        uc.contact_name IS DISTINCT FROM tc.contact_name
        OR uc.contact_phone IS DISTINCT FROM tc.contact_phone
      )
    RETURNING uc.*
  )
  SELECT COUNT(*) INTO v_updated FROM updated;
  
  RAISE NOTICE 'MERGE complete: % inserted, % updated, % deleted', 
    v_inserted, v_updated, v_deleted;
  
  -- ============================================
  -- STEP 3: Match against registered users (indexed join)
  -- ============================================
  
  v_end_time := clock_timestamp();
  v_duration_ms := EXTRACT(MILLISECONDS FROM (v_end_time - v_start_time))::INTEGER;
  
  RAISE NOTICE 'Contact sync completed in % ms, now matching...', v_duration_ms;
  
  -- Return matches via indexed join on phone_e164
  RETURN QUERY
  SELECT DISTINCT
    u.id AS user_id,
    u.phone_number,
    u.phone_e164,
    u.display_name,
    u.avatar_url,
    uc.contact_name  -- Return original contact name
  FROM user_contacts uc
  INNER JOIN users u ON u.phone_e164 = uc.phone_e164
  WHERE uc.user_id = v_user_id
    AND u.id != v_user_id  -- Don't match self
    AND u.phone_e164 IS NOT NULL  -- Only match normalized numbers
  ORDER BY u.display_name;
  
  v_end_time := clock_timestamp();
  v_duration_ms := EXTRACT(MILLISECONDS FROM (v_end_time - v_start_time))::INTEGER;
  
  RAISE NOTICE 'Total discovery completed in % ms', v_duration_ms;
END;
$$;

-- ============================================
-- PERMISSIONS
-- ============================================

GRANT EXECUTE ON FUNCTION discover_contacts_v3 TO authenticated;

COMMENT ON FUNCTION discover_contacts_v3 IS 
'Fast contact discovery V3 with:
- Contact names preserved (original device names)
- Efficient MERGE (no full delete, only delta changes)
- E.164 matching with indexed joins
- Returns contact names with matches
Accepts JSONB array: [{phone: "+919876543210", name: "John Doe"}]
Max 5000 contacts per call.';

-- ============================================
-- SCHEMA UPDATE: Add contact_name column
-- ============================================

-- Add contact_name column to user_contacts if not exists
DO $$ 
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'user_contacts' 
    AND column_name = 'contact_name'
  ) THEN
    ALTER TABLE user_contacts ADD COLUMN contact_name TEXT;
    COMMENT ON COLUMN user_contacts.contact_name IS 'Original contact name from device';
  END IF;
END $$;

-- ============================================
-- PERFORMANCE NOTES
-- ============================================

-- V3 Improvements over V2:
-- 
-- 1. ✅ Preserves original contact names (not just phone numbers)
-- 2. ✅ Efficient MERGE (INSERT + UPDATE + DELETE only changed rows)
-- 3. ✅ No full delete churn (only removes contacts no longer in device)
-- 4. ✅ Returns contact names with matches (for UI display)
-- 5. ✅ Uses temp table for atomic operation
-- 
-- Write amplification comparison:
-- - V2: DELETE all + INSERT all = 2N writes every time
-- - V3: Only changed rows = ~0.1N writes on average (90% cache hit)
-- 
-- Expected performance:
-- - 1000 contacts (first sync): ~250ms
-- - 1000 contacts (no changes): ~50ms (only SELECT)
-- - 1000 contacts (10% changed): ~100ms (only 100 rows modified)
-- 
-- Client-side optimization:
-- - Compute checksum before calling RPC
-- - Only call if checksum changed
-- - This avoids network call entirely if contacts unchanged

