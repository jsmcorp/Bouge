import { Capacitor } from '@capacitor/core';
import { Contacts, GetContactsResult, PermissionStatus } from '@capacitor-community/contacts';
import { sqliteService } from './sqliteServices_Refactored/sqliteService';
import { supabasePipeline } from './supabasePipeline';
import { LocalContact, ContactUserMapping, RegisteredContact } from './sqliteServices_Refactored/types';

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
   * Normalize phone number to E.164 format
   * 
   * E.164 format: +[country code][number] (e.g., +917744939966)
   * 
   * Simple normalization:
   * - Remove all non-digit characters except leading +
   * - Ensure starts with +
   * - If no country code, assume +91 (India) as default
   * 
   * Note: For production, consider using libphonenumber-js for robust normalization
   * 
   * @param phone - Raw phone number from device contacts
   * @returns Normalized phone number in E.164 format
   */
  public normalizePhoneNumber(phone: string): string {
    if (!phone) return '';

    // Remove all whitespace, dashes, parentheses, etc.
    let normalized = phone.replace(/[\s\-\(\)\.]/g, '');

    // If starts with +, keep it
    if (normalized.startsWith('+')) {
      return normalized;
    }

    // If starts with 00, replace with +
    if (normalized.startsWith('00')) {
      return '+' + normalized.substring(2);
    }

    // If starts with 0 (local number), remove leading 0 and add +91 (India)
    if (normalized.startsWith('0')) {
      return '+91' + normalized.substring(1);
    }

    // If 10 digits (Indian mobile), add +91
    if (normalized.length === 10 && /^\d{10}$/.test(normalized)) {
      return '+91' + normalized;
    }

    // If already has country code without +, add +
    if (/^\d{11,15}$/.test(normalized)) {
      return '+' + normalized;
    }

    // Return as-is if can't normalize
    return normalized;
  }

  /**
   * Sync device contacts to SQLite
   * 
   * Steps:
   * 1. Check permission
   * 2. Fetch contacts from device (name + phones only)
   * 3. Normalize phone numbers
   * 4. Save to SQLite
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

      // Transform to LocalContact format
      const now = Date.now();
      const localContacts: Omit<LocalContact, 'id'>[] = [];

      for (const contact of result.contacts) {
        // Get display name
        const displayName = contact.name?.display || 'Unknown';

        // Get phone numbers (contacts can have multiple)
        const phones = contact.phones || [];
        
        for (const phoneEntry of phones) {
          const rawPhone = phoneEntry.number;
          if (!rawPhone) continue;

          // Normalize phone number to E.164 format
          const normalizedPhone = this.normalizePhoneNumber(rawPhone);
          if (!normalizedPhone) continue;

          localContacts.push({
            phone_number: normalizedPhone,
            display_name: displayName,
            email: null, // Not requesting emails for privacy
            photo_uri: null, // Not requesting photos for performance
            synced_at: now
          });
        }
      }

      console.log(`📇 Normalized ${localContacts.length} phone numbers from ${result.contacts.length} contacts`);

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
  public async discoverRegisteredUsers(contacts?: LocalContact[]): Promise<RegisteredContact[]> {
    console.log('📇 Starting user discovery...');

    // Get contacts from parameter or SQLite
    const contactsToCheck = contacts || await sqliteService.getAllContacts();
    
    if (contactsToCheck.length === 0) {
      console.log('📇 No contacts to check');
      return [];
    }

    console.log(`📇 Checking ${contactsToCheck.length} contacts for registered users...`);

    try {
      // Extract unique phone numbers
      const phoneNumbers = [...new Set(contactsToCheck.map(c => c.phone_number))];
      console.log(`📇 Querying Supabase for ${phoneNumbers.length} unique phone numbers...`);

      // Query Supabase users table for matching phone numbers
      // Use .in() to batch query all phone numbers at once
      const client = await supabasePipeline.getDirectClient();
      const { data: users, error } = await client
        .from('users')
        .select('id, phone_number, display_name, avatar_url')
        .in('phone_number', phoneNumbers);

      if (error) {
        console.error('📇 Error querying Supabase users:', error);
        throw error;
      }

      if (!users || users.length === 0) {
        console.log('📇 No registered users found in contacts');
        return [];
      }

      console.log(`📇 Found ${users.length} registered users in contacts`);

      // Create contact-user mappings
      const now = Date.now();
      const mappings: ContactUserMapping[] = users.map((user: any) => ({
        contact_phone: user.phone_number,
        user_id: user.id,
        user_display_name: user.display_name || 'Unknown',
        user_avatar_url: user.avatar_url || null,
        mapped_at: now
      }));

      // Save mappings to SQLite
      await sqliteService.saveContactUserMapping(mappings);
      console.log(`✅ Saved ${mappings.length} contact-user mappings to SQLite`);

      // Get and return registered contacts (with full contact + user info)
      const registeredContacts = await sqliteService.getRegisteredContacts();
      console.log(`📇 Returning ${registeredContacts.length} registered contacts`);

      return registeredContacts;
    } catch (error) {
      console.error('📇 Error discovering registered users:', error);
      throw error;
    }
  }

  /**
   * Full sync: Sync contacts + discover registered users
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

