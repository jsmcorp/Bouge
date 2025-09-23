import { CapacitorSQLite } from '@capacitor-community/sqlite';
import { Preferences } from '@capacitor/preferences';
import { Capacitor } from '@capacitor/core';

/** Key under which we store the passphrase */
const KEY = 'sqlite_encryption_key';
const BACKUP_KEY = 'sqlite_encryption_key_backup';
const KEY_VALIDATION_TEST = 'sqlite_key_validation_test';

let isPassphraseSet = false;
let lastValidationTime = 0;
let currentPassphrase: string | null = null;
// Coalesce concurrent initialization attempts to avoid duplicate native calls
let initSecretPromise: Promise<void> | null = null;

// Caching for validation results
const VALIDATION_CACHE_DURATION = 30000; // 30 seconds
let lastValidationResult: KeyValidationResult | null = null;

interface KeyValidationResult {
  isValid: boolean;
  keySource: 'primary' | 'backup' | 'regenerated' | 'failed';
  error?: string;
  timeTaken: number;
}

/**
 * Ensures a 32‑char passphrase exists and sets it for the plugin.
 * Always call this BEFORE opening the encrypted database.
 */
export async function initEncryptionSecret(): Promise<void> {
  // Skip if we've already set the passphrase in this session
  if (isPassphraseSet) {
    console.log('🔑 SQLite encryption key already set in this session');
    return;
  }
  // Coalesce concurrent calls
  if (initSecretPromise) {
    await initSecretPromise;
    return;
  }

  initSecretPromise = (async () => {
    try {
      const stored = await Preferences.get({ key: KEY });
      const secret = stored.value ?? crypto.randomUUID().replace(/-/g, '').slice(0, 32);

      // Set/refresh the passphrase for this app session
      try {
        await CapacitorSQLite.setEncryptionSecret({ passphrase: secret });
        isPassphraseSet = true;

        if (!stored.value) {
          await Preferences.set({ key: KEY, value: secret });
          console.log('🔑 SQLite encryption key generated and stored');
        } else {
          console.log('🔑 SQLite encryption key already present');
        }
      } catch (error: any) {
        // If error is about passphrase already set, that's fine - mark as set and continue
        if (error.message && error.message.includes('a passphrase has already been set')) {
          console.log('🔑 SQLite encryption key was already set');
          isPassphraseSet = true;
          return; // Continue initialization
        } else {
          // Only throw for other types of errors
          throw error;
        }
      }
    } catch (error) {
      console.error('❌ Error setting encryption secret:', error);
      throw error;
    }
  })().finally(() => { initSecretPromise = null; });

  await initSecretPromise;
}

/**
 * Enhanced logging for SQLite encryption operations
 */
function log(message: string): void {
  const timestamp = new Date().toISOString().split('T')[1].split('.')[0];
  console.log(`[sqlite-encryption] ${timestamp} ${message}`);
}

/**
 * Validate that the current encryption key is accessible and working
 */
export async function validateEncryptionKey(): Promise<KeyValidationResult> {
  const startTime = Date.now();

  if (!Capacitor.isNativePlatform()) {
    return {
      isValid: true,
      keySource: 'primary',
      timeTaken: Date.now() - startTime
    };
  }

  // Check cache first
  const now = Date.now();
  if (lastValidationResult && (now - lastValidationTime) < VALIDATION_CACHE_DURATION) {
    log(`🔍 Using cached validation result (${now - lastValidationTime}ms ago)`);
    return {
      ...lastValidationResult,
      timeTaken: Date.now() - startTime
    };
  }

  log('🔍 Validating SQLite encryption key accessibility');

  try {
    // Test 1: Check if we can access Preferences
    const testValue = `validation_${Date.now()}`;
    await Preferences.set({ key: KEY_VALIDATION_TEST, value: testValue });
    const retrieved = await Preferences.get({ key: KEY_VALIDATION_TEST });

    if (retrieved.value !== testValue) {
      throw new Error('Preferences storage validation failed');
    }

    // Clean up test value
    await Preferences.remove({ key: KEY_VALIDATION_TEST });

    // Test 2: Try to access the main encryption key
    const stored = await Preferences.get({ key: KEY });
    if (!stored.value) {
      log('⚠️ Primary encryption key not found in Preferences');
      return {
        isValid: false,
        keySource: 'failed',
        error: 'Primary key not found',
        timeTaken: Date.now() - startTime
      };
    }

    // Test 3: Verify key format
    if (stored.value.length !== 32) {
      log('⚠️ Primary encryption key has invalid format');
      return {
        isValid: false,
        keySource: 'failed',
        error: 'Invalid key format',
        timeTaken: Date.now() - startTime
      };
    }

    log('✅ Primary encryption key validation successful');
    currentPassphrase = stored.value;
    lastValidationTime = Date.now();

    const result = {
      isValid: true,
      keySource: 'primary' as const,
      timeTaken: Date.now() - startTime
    };

    // Cache the successful result
    lastValidationResult = result;

    return result;

  } catch (error) {
    log(`❌ Primary key validation failed: ${error}`);

    // Try backup key recovery
    return await attemptKeyRecovery(startTime);
  }
}

/**
 * Attempt to recover encryption key from backup or regenerate
 */
async function attemptKeyRecovery(startTime: number): Promise<KeyValidationResult> {
  log('🔄 Attempting encryption key recovery');

  try {
    // Try backup key first
    const backupStored = await Preferences.get({ key: BACKUP_KEY });
    if (backupStored.value && backupStored.value.length === 32) {
      log('🔄 Found backup encryption key, attempting restore');

      // Restore backup to primary
      await Preferences.set({ key: KEY, value: backupStored.value });
      currentPassphrase = backupStored.value;

      log('✅ Backup key restored successfully');
      return {
        isValid: true,
        keySource: 'backup',
        timeTaken: Date.now() - startTime
      };
    }

    // No backup available, need to regenerate
    log('⚠️ No backup key available, regenerating encryption key');

    const newSecret = crypto.randomUUID().replace(/-/g, '').slice(0, 32);

    // Store new key and backup
    await Preferences.set({ key: KEY, value: newSecret });
    await Preferences.set({ key: BACKUP_KEY, value: newSecret });

    currentPassphrase = newSecret;

    log('✅ New encryption key generated and stored');
    return {
      isValid: true,
      keySource: 'regenerated',
      timeTaken: Date.now() - startTime
    };

  } catch (error) {
    log(`❌ Key recovery failed: ${error}`);
    return {
      isValid: false,
      keySource: 'failed',
      error: `Recovery failed: ${error}`,
      timeTaken: Date.now() - startTime
    };
  }
}

/**
 * Enhanced initialization with validation and recovery
 * Call this after device unlock to ensure key accessibility
 */
export async function initEncryptionSecretWithValidation(): Promise<void> {
  log('🔑 Initializing SQLite encryption secret with validation');

  // Skip if we've already set the passphrase in this session and it was recent
  if (isPassphraseSet && (Date.now() - lastValidationTime < 30000)) {
    log('🔑 SQLite encryption key already set and validated recently');
    return;
  }
  // Coalesce with any in-flight basic init
  if (initSecretPromise) {
    await initSecretPromise;
    return;
  }

  if (!Capacitor.isNativePlatform()) {
    log('🔑 Not on native platform, skipping encryption setup');
    isPassphraseSet = true;
    return;
  }

  try {
    // First, validate that we can access the key
    const validation = await validateEncryptionKey();

    if (!validation.isValid) {
      throw new Error(`Key validation failed: ${validation.error}`);
    }

    log(`🔑 Using ${validation.keySource} encryption key (validation took ${validation.timeTaken}ms)`);

    // Set the passphrase for this app session
    try {
      await CapacitorSQLite.setEncryptionSecret({ passphrase: currentPassphrase! });
      isPassphraseSet = true;

      // Create backup if using primary key
      if (validation.keySource === 'primary') {
        await Preferences.set({ key: BACKUP_KEY, value: currentPassphrase! });
        log('🔑 Backup encryption key updated');
      }

      log('✅ SQLite encryption secret initialized successfully');

    } catch (error: any) {
      // If error is about passphrase already set, that's fine - mark as set and continue
      if (error.message && error.message.includes('a passphrase has already been set')) {
        log('🔑 SQLite encryption key was already set in plugin');
        isPassphraseSet = true;
        return;
      } else {
        throw error;
      }
    }

  } catch (error) {
    log(`❌ Failed to initialize SQLite encryption secret: ${error}`);
    throw error;
  }
}

/**
 * Force validation of encryption key (useful after device unlock)
 * Implements smart caching to prevent excessive validation calls
 */
export async function validateEncryptionAfterUnlock(): Promise<boolean> {
  const now = Date.now();

  // If we validated recently (within 10 seconds), skip validation
  if (lastValidationResult && (now - lastValidationTime) < 10000) {
    log(`🔓 Skipping validation - recently validated ${now - lastValidationTime}ms ago`);
    return lastValidationResult.isValid;
  }

  log('🔓 Validating encryption key after device unlock');

  try {
    const validation = await validateEncryptionKey();

    if (validation.isValid) {
      log(`✅ Encryption key accessible after unlock (${validation.keySource}, ${validation.timeTaken}ms)`);
      return true;
    } else {
      log(`❌ Encryption key validation failed after unlock: ${validation.error}`);
      return false;
    }
  } catch (error) {
    log(`❌ Encryption validation error after unlock: ${error}`);
    return false;
  }
}
