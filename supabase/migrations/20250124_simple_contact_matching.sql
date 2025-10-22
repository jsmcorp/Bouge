-- ============================================
-- SIMPLE CONTACT MATCHING SYSTEM
-- Direct phone number matching (no hashing)
-- ============================================

-- Drop old triggers FIRST (before functions)
DROP TRIGGER IF EXISTS on_user_created_match_contacts ON users;

-- Drop old hash-based tables if they exist
DROP TABLE IF EXISTS contact_matches CASCADE;
DROP TABLE IF EXISTS user_contacts CASCADE;

-- Drop old hash-based functions
DROP FUNCTION IF EXISTS match_user_contacts(UUID);
DROP FUNCTION IF EXISTS get_user_registered_contacts(UUID);
DROP FUNCTION IF EXISTS trigger_match_new_user();
DROP FUNCTION IF EXISTS hash_phone_number(TEXT);
DROP FUNCTION IF EXISTS normalize_phone_number(TEXT);

-- Remove phone_hash column from users table if it exists
ALTER TABLE users DROP COLUMN IF EXISTS phone_hash;

-- ============================================
-- NEW SIMPLE TABLES
-- ============================================

-- Table: user_contacts
-- Stores real phone numbers from each user's contact list
CREATE TABLE IF NOT EXISTS user_contacts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  contact_name TEXT,
  contact_phone TEXT NOT NULL,
  synced_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(user_id, contact_phone)
);

-- Indexes for fast lookup
CREATE INDEX IF NOT EXISTS idx_user_contacts_phone ON user_contacts(contact_phone);
CREATE INDEX IF NOT EXISTS idx_user_contacts_user_id ON user_contacts(user_id);

-- ============================================
-- ROW LEVEL SECURITY (RLS)
-- ============================================

-- Enable RLS
ALTER TABLE user_contacts ENABLE ROW LEVEL SECURITY;

-- Users can only insert their own contacts
CREATE POLICY "Users can insert own contacts"
  ON user_contacts FOR INSERT
  WITH CHECK (auth.uid() = user_id);

-- Users can only read their own contacts
CREATE POLICY "Users can read own contacts"
  ON user_contacts FOR SELECT
  USING (auth.uid() = user_id);

-- Users can delete their own contacts
CREATE POLICY "Users can delete own contacts"
  ON user_contacts FOR DELETE
  USING (auth.uid() = user_id);

-- ============================================
-- FUNCTIONS
-- ============================================

-- Function: normalize_phone_number
-- Normalizes phone number to E.164 format for consistent matching
CREATE OR REPLACE FUNCTION normalize_phone_number(phone TEXT)
RETURNS TEXT
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
  normalized TEXT;
BEGIN
  IF phone IS NULL THEN
    RETURN NULL;
  END IF;
  
  -- Remove all non-digit characters except +
  normalized := regexp_replace(phone, '[^0-9+]', '', 'g');
  
  -- Remove leading zeros (00 prefix for international)
  normalized := regexp_replace(normalized, '^00', '', 'g');
  
  -- If doesn't start with +, add it
  IF NOT normalized LIKE '+%' THEN
    normalized := '+' || normalized;
  END IF;
  
  RETURN normalized;
END;
$$;

-- Function: get_registered_contacts
-- Returns all registered users that match the user's contact list
-- Direct phone number matching (no hashing)
CREATE OR REPLACE FUNCTION get_registered_contacts(p_user_id UUID)
RETURNS TABLE (
  user_id UUID,
  phone_number TEXT,
  display_name TEXT,
  avatar_url TEXT,
  contact_name TEXT
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  RETURN QUERY
  SELECT DISTINCT
    u.id,
    u.phone_number,
    u.display_name,
    u.avatar_url,
    uc.contact_name
  FROM user_contacts uc
  INNER JOIN users u ON normalize_phone_number(u.phone_number) = normalize_phone_number(uc.contact_phone)
  WHERE uc.user_id = p_user_id
    AND u.id != p_user_id  -- Don't match with self
  ORDER BY u.display_name;
END;
$$;

-- Function: sync_contacts
-- Uploads user's contacts and returns registered users
-- This is the main function clients will call
CREATE OR REPLACE FUNCTION sync_contacts(
  p_user_id UUID,
  p_contacts JSONB  -- Array of {name: string, phone: string}
)
RETURNS TABLE (
  user_id UUID,
  phone_number TEXT,
  display_name TEXT,
  avatar_url TEXT,
  contact_name TEXT
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_contact JSONB;
BEGIN
  -- Delete existing contacts for this user
  DELETE FROM user_contacts WHERE user_id = p_user_id;
  
  -- Insert new contacts
  FOR v_contact IN SELECT * FROM jsonb_array_elements(p_contacts)
  LOOP
    INSERT INTO user_contacts (user_id, contact_name, contact_phone)
    VALUES (
      p_user_id,
      v_contact->>'name',
      v_contact->>'phone'
    )
    ON CONFLICT (user_id, contact_phone) DO NOTHING;
  END LOOP;
  
  -- Return registered contacts
  RETURN QUERY
  SELECT * FROM get_registered_contacts(p_user_id);
END;
$$;

-- ============================================
-- COMMENTS
-- ============================================

COMMENT ON TABLE user_contacts IS 'Stores real phone numbers from each user''s contact list for direct matching';
COMMENT ON FUNCTION normalize_phone_number IS 'Normalizes phone number to E.164 format (+91...)';
COMMENT ON FUNCTION get_registered_contacts IS 'Returns all registered users that are in the user''s contact list';
COMMENT ON FUNCTION sync_contacts IS 'Uploads user contacts and returns registered users in one call';

