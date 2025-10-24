/**
 * Checksum Utilities for Contact Sync Optimization
 * 
 * Purpose: Compute deterministic checksums from phone number arrays
 * to detect changes and avoid unnecessary re-uploads.
 * 
 * WhatsApp-like optimization: Only sync when contacts actually change.
 */

/**
 * Simple hash function (FNV-1a)
 * Fast, deterministic, good distribution
 */
function hashString(str: string): string {
  let hash = 2166136261; // FNV offset basis
  
  for (let i = 0; i < str.length; i++) {
    hash ^= str.charCodeAt(i);
    hash = Math.imul(hash, 16777619); // FNV prime
  }
  
  // Convert to unsigned 32-bit hex
  return (hash >>> 0).toString(16).padStart(8, '0');
}

/**
 * Compute checksum from array of E.164 phone numbers
 * 
 * @param phoneNumbers - Array of E.164 phone numbers
 * @returns Deterministic checksum string
 * 
 * @example
 * computeContactsChecksum(['+919876543210', '+14155552671'])
 * // => 'a3f2c1d4'
 */
export function computeContactsChecksum(phoneNumbers: string[]): string {
  if (!phoneNumbers || phoneNumbers.length === 0) {
    return '00000000'; // Empty checksum
  }
  
  // Sort for deterministic order
  const sorted = [...phoneNumbers].sort();
  
  // Concatenate with separator
  const concatenated = sorted.join(',');
  
  // Hash the concatenated string
  return hashString(concatenated);
}

/**
 * Compute checksum using Web Crypto API (SHA-256)
 * More robust but async and slower
 * 
 * @param phoneNumbers - Array of E.164 phone numbers
 * @returns Promise<checksum string>
 */
export async function computeContactsChecksumCrypto(
  phoneNumbers: string[]
): Promise<string> {
  if (!phoneNumbers || phoneNumbers.length === 0) {
    return '0000000000000000'; // Empty checksum
  }
  
  // Sort for deterministic order
  const sorted = [...phoneNumbers].sort();
  
  // Concatenate with separator
  const concatenated = sorted.join(',');
  
  // Encode to bytes
  const encoder = new TextEncoder();
  const data = encoder.encode(concatenated);
  
  // Hash with SHA-256
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  
  // Convert to hex string (first 16 chars for brevity)
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  const hashHex = hashArray
    .map(b => b.toString(16).padStart(2, '0'))
    .join('')
    .substring(0, 16);
  
  return hashHex;
}

/**
 * Compare two checksums for equality
 * 
 * @param checksum1 - First checksum
 * @param checksum2 - Second checksum
 * @returns true if checksums match
 */
export function compareChecksums(
  checksum1: string | null,
  checksum2: string | null
): boolean {
  if (!checksum1 || !checksum2) {
    return false;
  }
  
  return checksum1 === checksum2;
}

/**
 * Compute delta between two phone number arrays
 * Returns added and removed numbers
 * 
 * @param oldNumbers - Previous phone numbers
 * @param newNumbers - Current phone numbers
 * @returns Object with added and removed arrays
 */
export function computeContactsDelta(
  oldNumbers: string[],
  newNumbers: string[]
): {
  added: string[];
  removed: string[];
  unchanged: string[];
} {
  const oldSet = new Set(oldNumbers);
  const newSet = new Set(newNumbers);
  
  const added = newNumbers.filter(n => !oldSet.has(n));
  const removed = oldNumbers.filter(n => !newSet.has(n));
  const unchanged = newNumbers.filter(n => oldSet.has(n));
  
  return { added, removed, unchanged };
}

/**
 * Check if contacts have changed based on checksum
 * 
 * @param currentNumbers - Current phone numbers
 * @param lastChecksum - Last stored checksum
 * @returns true if contacts changed
 */
export function haveContactsChanged(
  currentNumbers: string[],
  lastChecksum: string | null
): boolean {
  if (!lastChecksum) {
    return true; // First sync
  }
  
  const currentChecksum = computeContactsChecksum(currentNumbers);
  return currentChecksum !== lastChecksum;
}

/**
 * Get contact sync statistics
 * 
 * @param oldNumbers - Previous phone numbers
 * @param newNumbers - Current phone numbers
 * @returns Statistics object
 */
export function getContactsSyncStats(
  oldNumbers: string[],
  newNumbers: string[]
): {
  total: number;
  added: number;
  removed: number;
  unchanged: number;
  changePercentage: number;
} {
  const delta = computeContactsDelta(oldNumbers, newNumbers);
  
  const total = newNumbers.length;
  const added = delta.added.length;
  const removed = delta.removed.length;
  const unchanged = delta.unchanged.length;
  
  const changePercentage = total > 0 
    ? Math.round(((added + removed) / total) * 100)
    : 0;
  
  return {
    total,
    added,
    removed,
    unchanged,
    changePercentage
  };
}

