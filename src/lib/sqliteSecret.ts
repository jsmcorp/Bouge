import { CapacitorSQLite } from '@capacitor-community/sqlite';
import { Preferences } from '@capacitor/preferences';

/** Key under which we store the passphrase */
const KEY = 'sqlite_encryption_key';
let isPassphraseSet = false;

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

  try {
    const stored = await Preferences.get({ key: KEY });
    const secret =
      stored.value ??
      crypto.randomUUID().replace(/-/g, '').slice(0, 32); // 32‑char random string

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
}
