
import { Capacitor } from '@capacitor/core';
import { Contacts, GetContactsResult, PermissionStatus } from '@capacitor-community/contacts';
import { sqliteService } from './sqliteServices_Refactored/sqliteService';
import { contactMatchingService } from './contactMatchingService';
import { LocalContact, ContactUserMapping, RegisteredContact } from './sqliteServices_Refactored/types';
import { normalizePhoneNumber } from './phoneNormalization';
import { computeContactsChecksum } from './checksumUtils';

/**
 * ContactsService - Handles device contacts sync and user discovery
 * 
 * Features:
 * - Request and check READ_CONTACTS permission
 * - Sync device contacts to SQLite
 * - Discover which contacts are registered Confessr users
 * - Normalize phone numbers to E.164 format
 * 
 * Privacy:
 * - Only reads name and phone number (minimal data)
 * - Stores contacts locally in encrypted SQLite
 * - Does NOT sync contacts to Supabase backend
 */
class ContactsService {
  private static instance: ContactsService;

  private constructor() {}

  public static getInstance(): ContactsService {
    if (!ContactsService.instance) {
      ContactsService.instance = new ContactsService();
    }
    return ContactsService.instance;
  }

  /**
   * Check if contacts feature is available (native platform only)
   */
  public isAvailable(): boolean {
    return Capacitor.isNativePlatform();
  }

  /**
   * Check current READ_CONTACTS permission status
   * 
   * @returns true if permission granted, false otherwise
   */
  public async checkPermission(): Promise<boolean> {
    if (!this.isAvailable()) {
      console.log('📇 Contacts not available on web platform');
      return false;
    }

    try {
      const result: PermissionStatus = await Contacts.checkPermissions();
      const granted = result.contacts === 'granted';
      console.log('📇 Contacts permission status:', result.contacts);
      return granted;
    } catch (error) {
      console.error('📇 Error checking contacts permission:', error);
      return false;
    }
  }

  /**
   * Request READ_CONTACTS permission from user
   *
   * Note: The @capacitor-community/contacts plugin requires both READ_CONTACTS
   * and WRITE_CONTACTS permissions to be declared in AndroidManifest.xml,
   * even though we only use READ functionality.
   *
   * @returns true if permission granted, false if denied
   */
  public async requestPermission(): Promise<boolean> {
    if (!this.isAvailable()) {
      console.log('📇 Contacts not available on web platform');
      return false;
    }

    try {
      console.log('📇 Requesting contacts permission...');
      const result: PermissionStatus = await Contacts.requestPermissions();
      const granted = result.contacts === 'granted';
      console.log('📇 Contacts permission result:', result.contacts);
      return granted;
    } catch (error) {
      console.error('📇 Error requesting contacts permission:', error);
      return false;
    }
  }

  /**
   * Normalize phone number to E.164 format using libphonenumber-js
   *
   * E.164 format: +[country code][number] (e.g., +917744939966)
   *
   * Uses libphonenumber-js for robust parsing and validation
   *
   * @param phone - Raw phone number from device contacts
   * @returns Normalized phone number in E.164 format or empty string if invalid
   */
  public normalizePhoneNumberLegacy(phone: string): string {
    const normalized = normalizePhoneNumber(phone);
    return normalized || '';
  }

  /**
   * Sync device contacts to SQLite (full sync)
   *
   * Steps:
   * 1. Check permission
   * 2. Fetch contacts from device (name + phones only)
   * 3. Normalize phone numbers
   * 4. Deduplicate phone numbers
   * 5. Save to SQLite
   *
   * @returns Array of synced contacts
   */
  public async syncContacts(): Promise<LocalContact[]> {
    if (!this.isAvailable()) {
      throw new Error('Contacts feature is only available on mobile devices');
    }

    console.log('📇 Starting contact sync...');

    // Check permission first
    const hasPermission = await this.checkPermission();
    if (!hasPermission) {
      throw new Error('Contacts permission not granted');
    }

    try {
      // Fetch contacts from device (only name and phones for privacy)
      console.log('📇 Fetching contacts from device...');
      const fetchStartTime = performance.now();

      const result: GetContactsResult = await Contacts.getContacts({
        projection: {
          name: true,
          phones: true,
          // Do NOT request emails, addresses, birthday, etc. for privacy
        }
      });

      const fetchDuration = Math.round(performance.now() - fetchStartTime);
      console.log(`📇 Fetched ${result.contacts.length} contacts from device in ${fetchDuration}ms`);

      if (result.contacts.length === 0) {
        console.warn('⚠️ No contacts found on device');
        console.warn('⚠️ This could mean:');
        console.warn('   1. User has no contacts saved');
        console.warn('   2. Permission was revoked');
        console.warn('   3. Device contacts are empty');
      }

      // Transform to LocalContact format with deduplication
      const now = Date.now();
      const uniqueContacts = new Map<string, Omit<LocalContact, 'id'>>();

      for (const contact of result.contacts) {
        // Get display name
        const displayName = contact.name?.display || 'Unknown';

        // Get phone numbers (contacts can have multiple)
        const phones = contact.phones || [];

        for (const phoneEntry of phones) {
          const rawPhone = phoneEntry.number;
          if (!rawPhone) continue;

          // Normalize phone number to E.164 format using libphonenumber-js
          const normalizedPhone = normalizePhoneNumber(rawPhone);
          if (!normalizedPhone) continue;

          // Only add if not already in map (first occurrence wins)
          // This prevents duplicate phone numbers from being saved
          if (!uniqueContacts.has(normalizedPhone)) {
            uniqueContacts.set(normalizedPhone, {
              phone_number: normalizedPhone,
              display_name: displayName,
              email: null, // Not requesting emails for privacy
              photo_uri: null, // Not requesting photos for performance
              synced_at: now
            });
          }
        }
      }

      const localContacts = Array.from(uniqueContacts.values());
      console.log(`📇 Normalized ${result.contacts.length} contacts → ${localContacts.length} unique phone numbers (deduplicated)`);
      console.log(`📇 Deduplication saved ${uniqueContacts.size - localContacts.length} duplicate operations`);

      // Save to SQLite (batch insert/update)
      if (localContacts.length > 0) {
        await sqliteService.saveContacts(localContacts);
        console.log(`✅ Saved ${localContacts.length} contacts to SQLite`);
      }

      // Return all contacts from SQLite (includes previously synced)
      const allContacts = await sqliteService.getAllContacts();
      console.log(`📇 Total contacts in SQLite: ${allContacts.length}`);

      return allContacts;
    } catch (error) {
      console.error('📇 Error syncing contacts:', error);

      // Check if it's a permission error
      if (error instanceof Error && error.message?.toLowerCase().includes('permission')) {
        throw new Error('Contacts permission was revoked. Please grant permission in Settings.');
      }

      throw error;
    }
  }

  /**
   * Incremental sync: Only sync new/modified contacts since last sync
   * Much faster than full sync for subsequent syncs
   *
   * Note: The Capacitor Contacts plugin doesn't support filtering by modification date,
   * so we implement a simple optimization:
   * 1. Get all contacts from device
   * 2. Compare with SQLite to find new/modified ones
   * 3. Only save the delta
   *
   * @param lastSyncTime - Unix timestamp of last sync (optional)
   * @returns Array of all contacts (including previously synced)
   */
  public async incrementalSync(lastSyncTime?: number | null): Promise<LocalContact[]> {
    if (!this.isAvailable()) {
      throw new Error('Contacts feature is only available on mobile devices');
    }

    console.log('📇 Starting incremental contact sync...');
    if (lastSyncTime) {
      console.log(`📇 Last sync: ${new Date(lastSyncTime).toISOString()}`);
    }

    // Check permission first
    const hasPermission = await this.checkPermission();
    if (!hasPermission) {
      throw new Error('Contacts permission not granted');
    }

    try {
      // Fetch contacts from device
      console.log('📇 Fetching contacts from device...');
      const result: GetContactsResult = await Contacts.getContacts({
        projection: {
          name: true,
          phones: true,
        }
      });

      console.log(`📇 Fetched ${result.contacts.length} contacts from device`);

      // Get existing contacts from SQLite for comparison
      const existingContacts = await sqliteService.getAllContacts();
      const existingPhones = new Set(existingContacts.map(c => c.phone_number));

      // Transform to LocalContact format and filter for new/modified
      const now = Date.now();
      const newContacts: Omit<LocalContact, 'id'>[] = [];

      for (const contact of result.contacts) {
        const displayName = contact.name?.display || 'Unknown';
        const phones = contact.phones || [];

        for (const phoneEntry of phones) {
          const rawPhone = phoneEntry.number;
          if (!rawPhone) continue;

          const normalizedPhone = normalizePhoneNumber(rawPhone);
          if (!normalizedPhone) continue;

          // Only add if it's a new contact (not in SQLite)
          if (!existingPhones.has(normalizedPhone)) {
            newContacts.push({
              phone_number: normalizedPhone,
              display_name: displayName,
              email: null,
              photo_uri: null,
              synced_at: now
            });
          }
        }
      }

      console.log(`📇 Found ${newContacts.length} new contacts (${existingContacts.length} already synced)`);

      // Save only new contacts to SQLite
      if (newContacts.length > 0) {
        await sqliteService.saveContacts(newContacts);
        console.log(`✅ Saved ${newContacts.length} new contacts to SQLite`);
      } else {
        console.log('📇 No new contacts to sync');
      }

      // Return all contacts from SQLite
      const allContacts = await sqliteService.getAllContacts();
      console.log(`📇 Total contacts in SQLite: ${allContacts.length}`);

      return allContacts;
    } catch (error) {
      console.error('📇 Error in incremental sync:', error);
      throw error;
    }
  }

  /**
   * ✅ PRODUCTION: WhatsApp-like background discovery with names
   *
   * Improvements over V2:
   * - Preserves original contact names
   * - Efficient MERGE (no full delete churn)
   * - Exponential backoff on RPC failure (no immediate fallback)
   * - Returns contact names with matches
   *
   * @param onProgress - Optional progress callback
   * @param retryCount - Internal retry counter (default: 0)
   * @returns Array of registered contacts
   */
  public async discoverInBackgroundV3(
    onProgress?: (current: number, total: number) => void,
    retryCount: number = 0
  ): Promise<RegisteredContact[]> {
    console.log('📇 [V3] Starting background discovery...');

    try {
      // Step 1: Get contacts from SQLite (already normalized to E.164)
      const contacts = await sqliteService.getAllContacts();

      if (contacts.length === 0) {
        console.warn('⚠️ [V3] No contacts in SQLite - did you forget to call syncContacts() first?');
        console.warn('⚠️ [V3] Discovery requires contacts to be synced from device before running');
        console.log('📇 [V3] No contacts to discover');
        return [];
      }

      // Prepare contacts with names for V3 RPC
      const contactsWithNames = contacts.map(c => ({
        phone: c.phone_number,
        name: c.display_name
      }));

      console.log(`📇 [V3] Loaded ${contactsWithNames.length} contacts from SQLite`);

      // Step 2: Compute checksum (only phone numbers, not names)
      const phoneNumbers = contacts.map(c => c.phone_number);
      const currentChecksum = computeContactsChecksum(phoneNumbers);
      const lastChecksum = await sqliteService.getContactsChecksum();

      console.log(`📇 [V3] Checksum - Current: ${currentChecksum}, Last: ${lastChecksum}`);

      // Step 3: Check if contacts changed
      if (lastChecksum && currentChecksum === lastChecksum) {
        console.log('📇 [V3] ✅ Contacts unchanged (checksum match), using cache');

        // Return cached registered contacts
        const registeredContacts = await sqliteService.getRegisteredContacts();
        console.log(`📇 [V3] Returning ${registeredContacts.length} cached registered users`);

        return registeredContacts;
      }

      console.log('📇 [V3] Contacts changed, starting discovery...');

      // Step 4: Report progress
      if (onProgress) {
        onProgress(0, 1);
      }

      // Step 5: Call optimized RPC V3 with exponential backoff
      const startTime = performance.now();
      let matches: any[];

      try {
        matches = await contactMatchingService.discoverContactsV3(contactsWithNames);
      } catch (rpcError) {
        console.error(`📇 [V3] ❌ RPC failed (attempt ${retryCount + 1}):`, rpcError);

        // Exponential backoff: 1s, 2s, 4s, 8s, 16s
        const maxRetries = 5;
        if (retryCount < maxRetries) {
          const backoffMs = Math.pow(2, retryCount) * 1000;
          console.log(`📇 [V3] ⏳ Retrying in ${backoffMs}ms...`);

          await new Promise(resolve => setTimeout(resolve, backoffMs));

          // Recursive retry with incremented count
          return this.discoverInBackgroundV3(onProgress, retryCount + 1);
        } else {
          console.error(`📇 [V3] ❌ Max retries (${maxRetries}) exceeded, giving up`);
          console.error(`📇 [V3] ⚠️ NOT falling back to batched GET (would block UI)`);

          // Return cached data instead of failing completely
          const cachedContacts = await sqliteService.getRegisteredContacts();
          console.log(`📇 [V3] Returning ${cachedContacts.length} cached contacts (stale)`);
          return cachedContacts;
        }
      }

      const duration = Math.round(performance.now() - startTime);
      console.log(`📇 [V3] RPC completed in ${duration}ms, found ${matches.length} matches`);

      // Step 6: Save matches to SQLite
      if (matches.length > 0) {
        const now = Date.now();

        // Save users first (for foreign key constraint)
        for (const match of matches) {
          try {
            await sqliteService.saveUser({
              id: match.user_id,
              display_name: match.display_name || 'Unknown',
              phone_number: match.phone_number,
              avatar_url: match.avatar_url || null,
              is_onboarded: 1,
              created_at: now
            });
          } catch (error) {
            console.error(`⚠️ [V3] Failed to save user ${match.user_id}:`, error);
          }
        }

        // Create contact-user mappings with original contact names
        const mappings: ContactUserMapping[] = matches.map(match => ({
          contact_phone: match.phone_e164 || match.phone_number,
          user_id: match.user_id,
          user_display_name: match.display_name || 'Unknown',
          user_avatar_url: match.avatar_url || null,
          mapped_at: now
        }));

        // Save mappings
        await sqliteService.saveContactUserMapping(mappings);
        console.log(`✅ [V3] Saved ${mappings.length} contact-user mappings`);
      }

      // Step 7: Update checksum
      await sqliteService.setContactsChecksum(currentChecksum);
      await sqliteService.setLastDeltaSyncTime(Date.now());

      console.log(`✅ [V3] Checksum updated: ${currentChecksum}`);

      // Step 8: Report final progress
      if (onProgress) {
        onProgress(1, 1);
      }

      // Step 9: Return registered contacts from SQLite
      const registeredContacts = await sqliteService.getRegisteredContacts();
      console.log(`✅ [V3] Discovery complete: ${registeredContacts.length} registered users`);

      return registeredContacts;
    } catch (error) {
      console.error('📇 [V3] ❌ Background discovery failed:', error);

      // Return cached data instead of throwing
      const cachedContacts = await sqliteService.getRegisteredContacts();
      console.log(`📇 [V3] Returning ${cachedContacts.length} cached contacts (error fallback)`);
      return cachedContacts;
    }
  }

  /**
   * Clear all contact data (contacts + mappings)
   * Used when user revokes permission or wants to re-sync
   */
  public async clearAllContacts(): Promise<void> {
    console.log('📇 Clearing all contact data...');
    await sqliteService.clearContacts();
    console.log('✅ All contact data cleared');
  }
}

export const contactsService = ContactsService.getInstance();


