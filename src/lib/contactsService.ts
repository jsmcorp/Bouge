import { Capacitor } from '@capacitor/core';
import { Contacts, GetContactsResult, PermissionStatus } from '@capacitor-community/contacts';
import { sqliteService } from './sqliteServices_Refactored/sqliteService';
import { supabasePipeline } from './supabasePipeline';
import { contactMatchingService } from './contactMatchingService';
import { LocalContact, ContactUserMapping, RegisteredContact } from './sqliteServices_Refactored/types';
import { normalizePhoneNumber } from './phoneNormalization';

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
      const result: GetContactsResult = await Contacts.getContacts({
        projection: {
          name: true,
          phones: true,
          // Do NOT request emails, addresses, birthday, etc. for privacy
        }
      });

      console.log(`📇 Fetched ${result.contacts.length} contacts from device`);

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
      throw error;
    }
  }

  /**
   * Discover which contacts are registered Confessr users
   * 
   * Steps:
   * 1. Extract unique phone numbers from contacts
   * 2. Query Supabase users table for matching phone numbers
   * 3. Create contact-user mappings
   * 4. Save mappings to SQLite
   * 5. Return registered contacts
   * 
   * @param contacts - Array of contacts to check (optional, uses all if not provided)
   * @returns Array of contacts that are registered users
   */
  public async discoverRegisteredUsers(
    contacts?: LocalContact[],
    onProgress?: (current: number, total: number) => void
  ): Promise<RegisteredContact[]> {
    console.log('📇 Starting user discovery...');

    // Get contacts from parameter or SQLite
    const contactsToCheck = contacts || await sqliteService.getAllContacts();

    if (contactsToCheck.length === 0) {
      console.log('📇 No contacts to check');
      return [];
    }

    console.log(`📇 Checking ${contactsToCheck.length} contacts for registered users...`);

    try {
      // Extract and normalize phone numbers
      const rawPhoneNumbers = [...new Set(contactsToCheck.map(c => c.phone_number))];
      console.log(`📇 [CLIENT-SIDE] Normalizing ${rawPhoneNumbers.length} unique phone numbers...`);

      const phoneNumbers = rawPhoneNumbers
        .map(phone => normalizePhoneNumber(phone))
        .filter((phone): phone is string => phone !== null);

      console.log(`📇 [CLIENT-SIDE] ${phoneNumbers.length} valid normalized numbers (${rawPhoneNumbers.length - phoneNumbers.length} invalid)`);
      console.log(`📇 [CLIENT-SIDE] Querying Supabase for ${phoneNumbers.length} phone numbers...`);
      console.log(`📇 [CLIENT-SIDE] Sample normalized numbers:`, phoneNumbers.slice(0, 5));

      // BATCH QUERIES: Split into chunks to avoid URL length limits
      // Supabase .in() creates a URL query param, which has limits (~2000 chars)
      // With E.164 format (+91XXXXXXXXXX = 13 chars), we can safely do 100 per batch
      const BATCH_SIZE = 100;
      const batches: string[][] = [];

      for (let i = 0; i < phoneNumbers.length; i += BATCH_SIZE) {
        batches.push(phoneNumbers.slice(i, i + BATCH_SIZE));
      }

      console.log(`📇 Split into ${batches.length} batches of max ${BATCH_SIZE} phone numbers`);

      const client = await supabasePipeline.getDirectClient();
      const allUsers: any[] = [];

      // Process batches sequentially with progress updates
      for (let i = 0; i < batches.length; i++) {
        const batch = batches[i];
        const batchNum = i + 1;

        console.log(`📇 [CLIENT-SIDE] [Batch ${batchNum}/${batches.length}] Querying ${batch.length} phone numbers...`);

        // Report progress
        if (onProgress) {
          onProgress(i, batches.length);
        }

        const { data: users, error } = await client
          .from('users')
          .select('id, phone_number, display_name, avatar_url')
          .in('phone_number', batch);

        if (error) {
          console.error(`📇 ❌ Batch ${batchNum} query error:`, {
            message: error.message,
            details: error.details,
            hint: error.hint,
            code: error.code
          });
          // Continue with other batches even if one fails
          continue;
        }

        if (users && users.length > 0) {
          console.log(`📇 ✅ Batch ${batchNum} found ${users.length} registered users`);
          allUsers.push(...users);
        } else {
          console.log(`📇 Batch ${batchNum} found 0 registered users`);
        }
      }

      // Final progress update
      if (onProgress) {
        onProgress(batches.length, batches.length);
      }

      console.log(`📇 Supabase query complete. Total users found: ${allUsers.length}`);

      if (allUsers.length === 0) {
        console.log('📇 ⚠️ No registered users found in contacts');
        console.log('📇 This could mean:');
        console.log('  1. None of your contacts have accounts on Bouge');
        console.log('  2. Phone numbers in contacts don\'t match the format in database');
        console.log('  3. Database users table is empty or has different phone format');
        return [];
      }

      console.log(`📇 ✅ Found ${allUsers.length} registered users in contacts`);
      const users = allUsers;
      console.log(`📇 Sample registered users:`, users.slice(0, 3));

      // Step 1: Save users to SQLite first (required for foreign key constraint)
      console.log(`📇 [CLIENT-SIDE] Saving ${users.length} users to SQLite...`);
      const now = Date.now();
      const usersToSave = users.map((user: any) => ({
        id: user.id,
        display_name: user.display_name || 'Unknown',
        phone_number: user.phone_number,
        avatar_url: user.avatar_url || null,
        is_onboarded: 1,
        created_at: now
      }));

      // Save users one by one to avoid batch issues
      for (const user of usersToSave) {
        try {
          await sqliteService.saveUser(user);
        } catch (error) {
          console.error(`⚠️ [CLIENT-SIDE] Failed to save user ${user.id}:`, error);
          // Continue with other users even if one fails
        }
      }
      console.log(`✅ [CLIENT-SIDE] Saved ${usersToSave.length} users to SQLite`);

      // Step 2: Create contact-user mappings
      const mappings: ContactUserMapping[] = users.map((user: any) => ({
        contact_phone: user.phone_number,
        user_id: user.id,
        user_display_name: user.display_name || 'Unknown',
        user_avatar_url: user.avatar_url || null,
        mapped_at: now
      }));

      console.log(`📇 Created ${mappings.length} contact-user mappings`);

      // Step 3: Save mappings to SQLite
      console.log(`📇 [CLIENT-SIDE] Saving ${mappings.length} contact-user mappings...`);
      await sqliteService.saveContactUserMapping(mappings);
      console.log(`✅ [CLIENT-SIDE] Saved ${mappings.length} contact-user mappings to SQLite`);

      // Get and return registered contacts (with full contact + user info)
      const registeredContacts = await sqliteService.getRegisteredContacts();
      console.log(`📇 Returning ${registeredContacts.length} registered contacts from SQLite`);

      return registeredContacts;
    } catch (error) {
      console.error('📇 ❌ Error discovering registered users:', error);
      console.error('📇 Error details:', {
        name: (error as Error).name,
        message: (error as Error).message,
        stack: (error as Error).stack
      });
      throw error;
    }
  }

  /**
   * Discover registered users using server-side matching (WhatsApp-style)
   * Much faster than client-side batch queries
   *
   * Steps:
   * 1. Upload contact hashes to server
   * 2. Server matches against registered users
   * 3. Retrieve matches
   *
   * @param contacts - Array of contacts to check
   * @param onProgress - Progress callback (optional)
   * @returns Array of registered contacts
   */
  public async discoverRegisteredUsersServerSide(
    contacts?: LocalContact[],
    onProgress?: (current: number, total: number) => void
  ): Promise<RegisteredContact[]> {
    console.log('📇 [SERVER-SIDE] Starting user discovery...');

    // Get contacts from parameter or SQLite
    const contactsToCheck = contacts || await sqliteService.getAllContacts();

    if (contactsToCheck.length === 0) {
      console.log('📇 [SERVER-SIDE] No contacts to check');
      return [];
    }

    console.log(`📇 [SERVER-SIDE] Checking ${contactsToCheck.length} contacts for registered users...`);

    try {
      // Contacts are already normalized when saved to SQLite (in syncContacts method)
      // No need to normalize again - just prepare for upload
      const contactsData = contactsToCheck.map(c => ({
        name: c.display_name,
        phone: c.phone_number  // Already in E.164 format from SQLite
      }));

      console.log(`📇 [SERVER-SIDE] Uploading ${contactsData.length} contacts to Supabase...`);

      if (contactsData.length === 0) {
        console.warn('⚠️ [SERVER-SIDE] No contacts to sync');
        return [];
      }

      // Report initial progress
      if (onProgress) {
        onProgress(0, 1); // 1 step: sync and match
      }

      // Sync contacts and get registered users
      console.log('📇 [SERVER-SIDE] Calling sync_contacts RPC...');
      const registeredUsers = await contactMatchingService.syncContacts(contactsData);
      console.log('✅ [SERVER-SIDE] Sync complete');

      // Report final progress
      if (onProgress) {
        onProgress(1, 1);
      }

      console.log(`✅ [SERVER-SIDE] Found ${registeredUsers.length} registered users`);

      // Log matched users for debugging
      if (registeredUsers.length > 0) {
        console.log('📋 [SERVER-SIDE] Matched users:');
        registeredUsers.forEach((user: any, index: number) => {
          console.log(`  ${index + 1}. ${user.display_name} (${user.phone_number}) - Contact: ${user.contact_name}`);
        });
      } else {
        console.warn('⚠️ [SERVER-SIDE] No registered users found in contacts');
        console.log('💡 [SERVER-SIDE] This could mean:');
        console.log('   1. None of your contacts are registered on Confessr');
        console.log('   2. Phone numbers in users table are not normalized to E.164 format');
        console.log('   3. Phone number formats don\'t match between contacts and users table');
      }

      if (registeredUsers.length > 0) {
        // Step 1: Save users to SQLite first (required for foreign key constraint)
        console.log(`📇 [SERVER-SIDE] Saving ${registeredUsers.length} users to SQLite...`);
        const now = Date.now();
        const usersToSave = registeredUsers.map((user: any) => ({
          id: user.user_id,
          display_name: user.display_name || 'Unknown',
          phone_number: user.phone_number,
          avatar_url: user.avatar_url || null,
          is_onboarded: 1,
          created_at: now
        }));

        // Save users one by one to avoid batch issues
        for (const user of usersToSave) {
          try {
            await sqliteService.saveUser(user);
          } catch (error) {
            console.error(`⚠️ [SERVER-SIDE] Failed to save user ${user.id}:`, error);
            // Continue with other users even if one fails
          }
        }
        console.log(`✅ [SERVER-SIDE] Saved ${usersToSave.length} users to SQLite`);

        // Step 2: Create contact-user mappings for local storage
        const mappings: ContactUserMapping[] = registeredUsers.map((user: any) => ({
          contact_phone: user.phone_number,
          user_id: user.user_id,
          user_display_name: user.display_name || 'Unknown',
          user_avatar_url: user.avatar_url || null,
          mapped_at: now
        }));

        // Step 3: Save mappings to SQLite
        console.log(`📇 [SERVER-SIDE] Saving ${mappings.length} contact-user mappings...`);
        await sqliteService.saveContactUserMapping(mappings);
        console.log(`✅ [SERVER-SIDE] Saved ${mappings.length} contact-user mappings to SQLite`);
      }

      // Get and return registered contacts (with full contact + user info)
      const registeredContacts = await sqliteService.getRegisteredContacts();
      console.log(`✅ [SERVER-SIDE] Returning ${registeredContacts.length} registered contacts`);

      return registeredContacts;
    } catch (error) {
      console.error('📇 [SERVER-SIDE] Error discovering users:', error);
      console.error('📇 [SERVER-SIDE] Error type:', error instanceof Error ? error.message : String(error));

      // Fallback to client-side matching if server-side fails
      console.log('⚠️ [SERVER-SIDE] Server-side matching failed, falling back to client-side matching...');
      console.log('📇 [CLIENT-SIDE] This may take longer but will work without server functions');

      return this.discoverRegisteredUsers(contactsToCheck, onProgress);
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
   * Full sync: Sync contacts + discover registered users
   * Use this for first-time sync or when user explicitly requests a full refresh
   *
   * @returns Array of registered contacts
   */
  public async fullSync(): Promise<RegisteredContact[]> {
    console.log('📇 Starting full contact sync...');

    // Step 1: Sync contacts from device
    const contacts = await this.syncContacts();

    // Step 2: Discover registered users
    const registeredContacts = await this.discoverRegisteredUsers(contacts);

    console.log(`✅ Full sync complete: ${contacts.length} contacts, ${registeredContacts.length} registered users`);

    return registeredContacts;
  }

  /**
   * Smart sync: Automatically choose between full and incremental sync
   * - First sync: Full sync
   * - Contact count unchanged: Skip sync (use cache)
   * - Contact count changed: Incremental sync + user discovery
   *
   * @returns Array of registered contacts
   */
  public async smartSync(onProgress?: (current: number, total: number) => void): Promise<RegisteredContact[]> {
    console.log('📇 Starting smart sync...');

    if (!this.isAvailable()) {
      throw new Error('Contacts feature is only available on mobile devices');
    }

    // Check permission first
    const hasPermission = await this.checkPermission();
    if (!hasPermission) {
      throw new Error('Contacts permission not granted');
    }

    try {
      // Get device contact count (fast operation - only fetches names)
      const result: GetContactsResult = await Contacts.getContacts({
        projection: { name: true }
      });
      const deviceContactCount = result.contacts.length;

      // Get last synced device contact count
      const lastDeviceCount = await sqliteService.getLastDeviceContactCount();
      const isFirstSync = await sqliteService.isFirstSync();

      console.log(`📇 Device contacts: ${deviceContactCount}, Last synced: ${lastDeviceCount}, First sync: ${isFirstSync}`);

      let contacts: LocalContact[];

      // CASE 1: Contact count unchanged and not first sync - use cache
      if (!isFirstSync && deviceContactCount === lastDeviceCount && lastDeviceCount > 0) {
        console.log('📇 ⚡ Contact count unchanged - using cached contacts (instant)');
        contacts = await sqliteService.getAllContacts();
        console.log(`📇 Returning ${contacts.length} cached contacts`);
      }
      // CASE 2: First sync - do full sync
      else if (isFirstSync) {
        console.log('📇 First sync detected - performing full sync');
        contacts = await this.syncContacts();

        // Update metadata
        await sqliteService.setLastDeviceContactCount(deviceContactCount);
        await sqliteService.setLastFullSyncTime(Date.now());
        await sqliteService.setTotalContactsSynced(contacts.length);
      }
      // CASE 3: Contact count changed - do incremental sync
      else {
        console.log('📇 Contact count changed - performing incremental sync');
        const lastSyncTime = await sqliteService.getContactsLastSyncTime();
        contacts = await this.incrementalSync(lastSyncTime);

        // Update metadata
        await sqliteService.setLastDeviceContactCount(deviceContactCount);
        await sqliteService.setLastIncrementalSyncTime(Date.now());
        await sqliteService.setTotalContactsSynced(contacts.length);
      }

      // Always discover registered users using server-side matching (WhatsApp-style)
      // This is much faster than client-side batch queries
      const registeredContacts = await this.discoverRegisteredUsersServerSide(contacts, onProgress);

      console.log(`✅ Smart sync complete: ${contacts.length} contacts, ${registeredContacts.length} registered users`);

      return registeredContacts;
    } catch (error) {
      console.error('📇 Error in smart sync:', error);
      throw error;
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

