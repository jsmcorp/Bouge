-- ============================================
-- CONTACT MATCHING SYSTEM
-- WhatsApp-style server-side contact matching
-- ============================================

-- Table: user_contacts
-- Stores hashed phone numbers from each user's contact list
-- This allows server-side matching without exposing raw phone numbers
CREATE TABLE IF NOT EXISTS user_contacts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  phone_hash TEXT NOT NULL,
  synced_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(user_id, phone_hash)
);

-- Index for fast lookup by phone hash
CREATE INDEX IF NOT EXISTS idx_user_contacts_phone_hash ON user_contacts(phone_hash);
CREATE INDEX IF NOT EXISTS idx_user_contacts_user_id ON user_contacts(user_id);

-- Table: contact_matches
-- Stores the results of matching user contacts against registered users
-- Pre-computed for fast retrieval
CREATE TABLE IF NOT EXISTS contact_matches (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  contact_phone_hash TEXT NOT NULL,
  matched_user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  matched_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(user_id, contact_phone_hash, matched_user_id)
);

-- Indexes for fast lookup
CREATE INDEX IF NOT EXISTS idx_contact_matches_user_id ON contact_matches(user_id);
CREATE INDEX IF NOT EXISTS idx_contact_matches_matched_user_id ON contact_matches(matched_user_id);

-- ============================================
-- ROW LEVEL SECURITY (RLS)
-- ============================================

-- Enable RLS
ALTER TABLE user_contacts ENABLE ROW LEVEL SECURITY;
ALTER TABLE contact_matches ENABLE ROW LEVEL SECURITY;

-- user_contacts policies
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

-- contact_matches policies
-- Users can only read their own matches
CREATE POLICY "Users can read own matches"
  ON contact_matches FOR SELECT
  USING (auth.uid() = user_id);

-- ============================================
-- FUNCTIONS
-- ============================================

-- Function: match_user_contacts
-- Matches a user's uploaded contact hashes against registered users
-- Called after user uploads their contacts
CREATE OR REPLACE FUNCTION match_user_contacts(p_user_id UUID)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_matches_count INTEGER := 0;
BEGIN
  -- Delete existing matches for this user
  DELETE FROM contact_matches WHERE user_id = p_user_id;

  -- Insert new matches
  -- Match user's contact hashes against all registered users' phone hashes
  INSERT INTO contact_matches (user_id, contact_phone_hash, matched_user_id)
  SELECT DISTINCT
    uc.user_id,
    uc.phone_hash,
    u.id
  FROM user_contacts uc
  INNER JOIN users u ON u.phone_hash = uc.phone_hash
  WHERE uc.user_id = p_user_id
    AND u.id != p_user_id  -- Don't match with self
  ON CONFLICT (user_id, contact_phone_hash, matched_user_id) DO NOTHING;

  -- Get count of matches
  GET DIAGNOSTICS v_matches_count = ROW_COUNT;

  RETURN v_matches_count;
END;
$$;

-- Function: get_user_registered_contacts
-- Returns all registered users that are in the user's contact list
-- This is the main function clients will call
CREATE OR REPLACE FUNCTION get_user_registered_contacts(p_user_id UUID)
RETURNS TABLE (
  user_id UUID,
  phone_number TEXT,
  display_name TEXT,
  avatar_url TEXT,
  phone_hash TEXT
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
    cm.contact_phone_hash
  FROM contact_matches cm
  INNER JOIN users u ON u.id = cm.matched_user_id
  WHERE cm.user_id = p_user_id
  ORDER BY u.display_name;
END;
$$;

-- ============================================
-- TRIGGERS
-- ============================================

-- Trigger: Auto-match contacts when new user registers
-- When a new user registers, check if they're in anyone's contact list
CREATE OR REPLACE FUNCTION trigger_match_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  -- Find all users who have this new user's phone hash in their contacts
  INSERT INTO contact_matches (user_id, contact_phone_hash, matched_user_id)
  SELECT DISTINCT
    uc.user_id,
    uc.phone_hash,
    NEW.id
  FROM user_contacts uc
  WHERE uc.phone_hash = NEW.phone_hash
    AND uc.user_id != NEW.id  -- Don't match with self
  ON CONFLICT (user_id, contact_phone_hash, matched_user_id) DO NOTHING;

  RETURN NEW;
END;
$$;

-- Create trigger on users table
-- Note: This assumes users table has a phone_hash column
-- If not, you'll need to add it first
DROP TRIGGER IF EXISTS on_user_created_match_contacts ON users;
CREATE TRIGGER on_user_created_match_contacts
  AFTER INSERT ON users
  FOR EACH ROW
  EXECUTE FUNCTION trigger_match_new_user();

-- ============================================
-- HELPER FUNCTIONS
-- ============================================

-- Function: normalize_phone_number
-- Normalizes phone number to E.164 format for consistent matching
-- Handles various formats: +91..., 91..., 0091..., etc.
CREATE OR REPLACE FUNCTION normalize_phone_number(phone TEXT)
RETURNS TEXT
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
  normalized TEXT;
BEGIN
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

-- Function: hash_phone_number
-- Client-side should use this same algorithm
-- SHA256 hash of normalized phone number
CREATE OR REPLACE FUNCTION hash_phone_number(phone TEXT)
RETURNS TEXT
LANGUAGE plpgsql
IMMUTABLE
AS $$
BEGIN
  -- Normalize phone number first
  phone := normalize_phone_number(phone);

  -- Return SHA256 hash
  RETURN encode(digest(phone, 'sha256'), 'hex');
END;
$$;

-- ============================================
-- MIGRATION: Add phone_hash to users table
-- ============================================

-- Add phone_hash column if it doesn't exist
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'users' AND column_name = 'phone_hash'
  ) THEN
    ALTER TABLE users ADD COLUMN phone_hash TEXT;

    -- Create index
    CREATE INDEX idx_users_phone_hash ON users(phone_hash);
  END IF;
END $$;

-- Re-populate phone_hash for ALL users with normalized hashing
-- This ensures existing users with inconsistent phone formats get correct hashes
UPDATE users SET phone_hash = hash_phone_number(phone_number) WHERE phone_number IS NOT NULL;

-- Make it NOT NULL after populating
ALTER TABLE users ALTER COLUMN phone_hash SET NOT NULL;

-- ============================================
-- COMMENTS
-- ============================================

COMMENT ON TABLE user_contacts IS 'Stores hashed phone numbers from each user''s contact list for privacy-preserving matching';
COMMENT ON TABLE contact_matches IS 'Pre-computed matches between users and their contacts who are registered on the platform';
COMMENT ON FUNCTION match_user_contacts IS 'Matches a user''s uploaded contact hashes against all registered users';
COMMENT ON FUNCTION get_user_registered_contacts IS 'Returns all registered users that are in the user''s contact list';
COMMENT ON FUNCTION hash_phone_number IS 'Hashes a phone number using SHA256 for privacy-preserving storage';

