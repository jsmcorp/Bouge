-- Migration: E.164 Phone Number Normalization
-- Purpose: Add phone_e164 columns for consistent matching and fast indexed joins
-- Date: 2025-01-25

-- ============================================
-- STEP 1: Add phone_e164 column to users table
-- ============================================

ALTER TABLE users ADD COLUMN IF NOT EXISTS phone_e164 TEXT;

COMMENT ON COLUMN users.phone_e164 IS 'E.164 normalized phone number for fast matching (+[country][number])';

-- ============================================
-- STEP 2: Migrate existing phone numbers to E.164
-- ============================================

-- Update users table with normalized phone numbers
UPDATE users 
SET phone_e164 = normalize_phone_number(phone_number)
WHERE phone_e164 IS NULL;

-- ============================================
-- STEP 3: Add indexes for fast matching
-- ============================================

-- Index on phone_e164 for O(log n) lookups
CREATE INDEX IF NOT EXISTS idx_users_phone_e164 
ON users(phone_e164);

-- Unique index to prevent duplicate phone numbers
CREATE UNIQUE INDEX IF NOT EXISTS idx_users_phone_e164_unique 
ON users(phone_e164) 
WHERE phone_e164 IS NOT NULL;

-- ============================================
-- STEP 4: Add phone_e164 to user_contacts table
-- ============================================

ALTER TABLE user_contacts ADD COLUMN IF NOT EXISTS phone_e164 TEXT;

COMMENT ON COLUMN user_contacts.phone_e164 IS 'E.164 normalized contact phone for matching';

-- Migrate existing contacts to E.164
UPDATE user_contacts 
SET phone_e164 = normalize_phone_number(contact_phone)
WHERE phone_e164 IS NULL;

-- ============================================
-- STEP 5: Add composite indexes for fast joins
-- ============================================

-- Composite index for fast matching queries
CREATE INDEX IF NOT EXISTS idx_user_contacts_phone_e164_user 
ON user_contacts(phone_e164, user_id);

-- Unique constraint on (user_id, phone_e164)
CREATE UNIQUE INDEX IF NOT EXISTS idx_user_contacts_unique_e164 
ON user_contacts(user_id, phone_e164) 
WHERE phone_e164 IS NOT NULL;

-- ============================================
-- STEP 6: Add validation trigger (optional)
-- ============================================

-- Function to validate E.164 format on insert/update
CREATE OR REPLACE FUNCTION validate_e164_format()
RETURNS TRIGGER AS $$
BEGIN
  -- Check if phone_e164 starts with + and contains only digits after
  IF NEW.phone_e164 IS NOT NULL AND NEW.phone_e164 !~ '^\+[0-9]{10,15}$' THEN
    RAISE EXCEPTION 'Invalid E.164 format: %. Must be +[country][number] with 10-15 digits', NEW.phone_e164;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Trigger for users table
DROP TRIGGER IF EXISTS validate_users_phone_e164 ON users;
CREATE TRIGGER validate_users_phone_e164
  BEFORE INSERT OR UPDATE OF phone_e164 ON users
  FOR EACH ROW
  EXECUTE FUNCTION validate_e164_format();

-- Trigger for user_contacts table
DROP TRIGGER IF EXISTS validate_user_contacts_phone_e164 ON user_contacts;
CREATE TRIGGER validate_user_contacts_phone_e164
  BEFORE INSERT OR UPDATE OF phone_e164 ON user_contacts
  FOR EACH ROW
  EXECUTE FUNCTION validate_e164_format();

-- ============================================
-- STEP 7: Update normalize_phone_number function
-- ============================================

-- Enhanced normalization function with better E.164 support
CREATE OR REPLACE FUNCTION normalize_phone_number(phone TEXT)
RETURNS TEXT AS $$
DECLARE
  cleaned TEXT;
  result TEXT;
BEGIN
  IF phone IS NULL OR phone = '' THEN
    RETURN NULL;
  END IF;

  -- Remove all non-digit characters except +
  cleaned := regexp_replace(phone, '[^0-9+]', '', 'g');

  -- Handle 00 prefix (international format)
  IF cleaned LIKE '00%' THEN
    cleaned := '+' || substring(cleaned from 3);
  END IF;

  -- Add + if missing and starts with country code
  IF cleaned !~ '^\+' THEN
    -- Check if it starts with common country codes
    IF cleaned ~ '^(1|7|20|27|30|31|32|33|34|36|39|40|41|43|44|45|46|47|48|49|51|52|53|54|55|56|57|58|60|61|62|63|64|65|66|81|82|84|86|90|91|92|93|94|95|98|212|213|216|218|220|221|222|223|224|225|226|227|228|229|230|231|232|233|234|235|236|237|238|239|240|241|242|243|244|245|246|248|249|250|251|252|253|254|255|256|257|258|260|261|262|263|264|265|266|267|268|269|290|291|297|298|299|350|351|352|353|354|355|356|357|358|359|370|371|372|373|374|375|376|377|378|380|381|382|383|385|386|387|389|420|421|423|500|501|502|503|504|505|506|507|508|509|590|591|592|593|594|595|596|597|598|599|670|672|673|674|675|676|677|678|679|680|681|682|683|685|686|687|688|689|690|691|692|850|852|853|855|856|880|886|960|961|962|963|964|965|966|967|968|970|971|972|973|974|975|976|977|992|993|994|995|996|998)' THEN
      cleaned := '+' || cleaned;
    -- Default to India (+91) for 10-digit numbers
    ELSIF length(cleaned) = 10 THEN
      cleaned := '+91' || cleaned;
    ELSE
      -- Unknown format, add + anyway
      cleaned := '+' || cleaned;
    END IF;
  END IF;

  -- Validate final format (+ followed by 10-15 digits)
  IF cleaned ~ '^\+[0-9]{10,15}$' THEN
    RETURN cleaned;
  ELSE
    -- Invalid format, return NULL
    RETURN NULL;
  END IF;
END;
$$ LANGUAGE plpgsql IMMUTABLE;

COMMENT ON FUNCTION normalize_phone_number IS 'Normalize phone number to E.164 format (+[country][number])';

-- ============================================
-- STEP 8: Grant permissions
-- ============================================

-- Ensure authenticated users can read phone_e164
GRANT SELECT ON users TO authenticated;
GRANT SELECT ON user_contacts TO authenticated;

-- ============================================
-- VERIFICATION QUERIES (for testing)
-- ============================================

-- Check migration success
-- SELECT COUNT(*) as total, COUNT(phone_e164) as normalized FROM users;
-- SELECT COUNT(*) as total, COUNT(phone_e164) as normalized FROM user_contacts;

-- Check E.164 format validity
-- SELECT phone_number, phone_e164 FROM users WHERE phone_e164 IS NOT NULL LIMIT 10;
-- SELECT contact_phone, phone_e164 FROM user_contacts WHERE phone_e164 IS NOT NULL LIMIT 10;

-- Check index usage
-- EXPLAIN ANALYZE SELECT * FROM users WHERE phone_e164 = '+919876543210';

