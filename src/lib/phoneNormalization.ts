import { parsePhoneNumber, CountryCode } from 'libphonenumber-js';

/**
 * Phone Number Normalization Utility
 * 
 * Normalizes phone numbers to E.164 format for consistent matching
 * Uses libphonenumber-js for robust parsing and validation
 * 
 * E.164 Format: +[country code][subscriber number]
 * Example: +919876543210 (India), +14155552671 (US)
 */

/**
 * Default country code for phone number parsing
 * Change this based on your primary market
 */
const DEFAULT_COUNTRY: CountryCode = 'IN'; // India

/**
 * Normalize a phone number to E.164 format
 * 
 * @param phoneNumber - Raw phone number string (can be in any format)
 * @param defaultCountry - Default country code if not specified in number (default: IN)
 * @returns Normalized phone number in E.164 format (+91XXXXXXXXXX) or null if invalid
 * 
 * @example
 * normalizePhoneNumber('9876543210') // '+919876543210'
 * normalizePhoneNumber('91 9876543210') // '+919876543210'
 * normalizePhoneNumber('+91-987-654-3210') // '+919876543210'
 * normalizePhoneNumber('(415) 555-2671', 'US') // '+14155552671'
 */
export function normalizePhoneNumber(
  phoneNumber: string | null | undefined,
  defaultCountry: CountryCode = DEFAULT_COUNTRY
): string | null {
  if (!phoneNumber) {
    return null;
  }

  try {
    // Remove all whitespace and special characters except + and digits
    let cleaned = phoneNumber.trim().replace(/[\s\-\(\)\.]/g, '');

    // Handle leading zeros (00 prefix for international)
    if (cleaned.startsWith('00')) {
      cleaned = '+' + cleaned.substring(2);
    }

    // If number doesn't start with +, try parsing with default country
    if (!cleaned.startsWith('+')) {
      // For Indian numbers, handle common formats:
      // 9876543210 -> +919876543210
      // 919876543210 -> +919876543210
      // 09876543210 -> +919876543210
      
      // Remove leading 0
      if (cleaned.startsWith('0')) {
        cleaned = cleaned.substring(1);
      }

      // If it's a 10-digit number and default country is India, add +91
      if (defaultCountry === 'IN' && cleaned.length === 10) {
        cleaned = '+91' + cleaned;
      }
      // If it starts with country code without +, add +
      else if (cleaned.length > 10) {
        cleaned = '+' + cleaned;
      }
    }

    // Parse the phone number
    const parsed = parsePhoneNumber(cleaned, defaultCountry);

    // Validate and return E.164 format
    if (parsed && parsed.isValid()) {
      const e164 = parsed.format('E.164');
      console.log(`📞 [NORMALIZE] ${phoneNumber} → ${e164}`);
      return e164;
    } else {
      console.warn(`⚠️ [NORMALIZE] Invalid phone number: ${phoneNumber}`);
      return null;
    }
  } catch (error) {
    console.error(`❌ [NORMALIZE] Error parsing phone number "${phoneNumber}":`, error);
    return null;
  }
}

/**
 * Normalize an array of phone numbers
 * Filters out invalid numbers
 * 
 * @param phoneNumbers - Array of raw phone numbers
 * @param defaultCountry - Default country code
 * @returns Array of normalized phone numbers (E.164 format)
 */
export function normalizePhoneNumbers(
  phoneNumbers: string[],
  defaultCountry: CountryCode = DEFAULT_COUNTRY
): string[] {
  const normalized: string[] = [];
  const seen = new Set<string>();

  for (const phone of phoneNumbers) {
    const normalized_phone = normalizePhoneNumber(phone, defaultCountry);
    if (normalized_phone && !seen.has(normalized_phone)) {
      normalized.push(normalized_phone);
      seen.add(normalized_phone);
    }
  }

  console.log(`📞 [NORMALIZE] ${phoneNumbers.length} numbers → ${normalized.length} valid unique numbers`);
  return normalized;
}

/**
 * Format a phone number for display
 * 
 * @param phoneNumber - Phone number in E.164 format
 * @param format - Display format ('NATIONAL' or 'INTERNATIONAL')
 * @returns Formatted phone number for display
 * 
 * @example
 * formatPhoneNumber('+919876543210', 'NATIONAL') // '98765 43210'
 * formatPhoneNumber('+919876543210', 'INTERNATIONAL') // '+91 98765 43210'
 */
export function formatPhoneNumber(
  phoneNumber: string,
  format: 'NATIONAL' | 'INTERNATIONAL' = 'NATIONAL'
): string {
  try {
    const parsed = parsePhoneNumber(phoneNumber);
    if (parsed && parsed.isValid()) {
      return parsed.format(format);
    }
    return phoneNumber;
  } catch (error) {
    return phoneNumber;
  }
}

/**
 * Validate if a phone number is valid
 * 
 * @param phoneNumber - Phone number to validate
 * @param defaultCountry - Default country code
 * @returns true if valid, false otherwise
 */
export function isValidPhoneNumber(
  phoneNumber: string,
  defaultCountry: CountryCode = DEFAULT_COUNTRY
): boolean {
  try {
    const parsed = parsePhoneNumber(phoneNumber, defaultCountry);
    return parsed ? parsed.isValid() : false;
  } catch (error) {
    return false;
  }
}

/**
 * Get country code from a phone number
 * 
 * @param phoneNumber - Phone number in E.164 format
 * @returns Country code (e.g., 'IN', 'US') or null
 */
export function getCountryCode(phoneNumber: string): CountryCode | null {
  try {
    const parsed = parsePhoneNumber(phoneNumber);
    return parsed?.country || null;
  } catch (error) {
    return null;
  }
}

/**
 * Batch normalize contacts with detailed logging
 * 
 * @param contacts - Array of contacts with phone numbers
 * @returns Object with normalized contacts and statistics
 */
export function normalizeContacts(contacts: Array<{ name: string; phone: string }>): {
  normalized: Array<{ name: string; phone: string }>;
  stats: {
    total: number;
    valid: number;
    invalid: number;
    duplicates: number;
  };
} {
  console.log(`📞 [NORMALIZE] Starting normalization of ${contacts.length} contacts...`);

  const normalized: Array<{ name: string; phone: string }> = [];
  const seen = new Set<string>();
  let invalidCount = 0;
  let duplicateCount = 0;

  for (const contact of contacts) {
    const normalizedPhone = normalizePhoneNumber(contact.phone);

    if (!normalizedPhone) {
      invalidCount++;
      console.warn(`⚠️ [NORMALIZE] Invalid: ${contact.name} - ${contact.phone}`);
      continue;
    }

    if (seen.has(normalizedPhone)) {
      duplicateCount++;
      console.log(`🔄 [NORMALIZE] Duplicate: ${contact.name} - ${normalizedPhone}`);
      continue;
    }

    normalized.push({
      name: contact.name,
      phone: normalizedPhone
    });
    seen.add(normalizedPhone);
  }

  const stats = {
    total: contacts.length,
    valid: normalized.length,
    invalid: invalidCount,
    duplicates: duplicateCount
  };

  console.log(`✅ [NORMALIZE] Complete:`, stats);

  return { normalized, stats };
}

