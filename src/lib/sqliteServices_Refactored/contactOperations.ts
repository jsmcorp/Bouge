import { DatabaseManager } from './database';
import { LocalContact, ContactUserMapping, RegisteredContact } from './types';

/**
 * ContactOperations - SQLite CRUD operations for contacts feature
 * 
 * Handles:
 * - Saving and retrieving device contacts
 * - Mapping contacts to registered Confessr users
 * - Searching and filtering contacts
 * - User discovery (which contacts are on Confessr)
 */
export class ContactOperations {
  constructor(private dbManager: DatabaseManager) {}

  /**
   * Save multiple contacts to SQLite (batch insert/update)
   * Uses INSERT OR REPLACE to handle duplicates based on phone_number UNIQUE constraint
   * 
   * @param contacts - Array of contacts to save
   */
  public async saveContacts(contacts: Omit<LocalContact, 'id'>[]): Promise<void> {
    await this.dbManager.checkDatabaseReady();
    const db = this.dbManager.getConnection();

    if (contacts.length === 0) {
      console.log('📇 No contacts to save');
      return;
    }

    console.log(`📇 Saving ${contacts.length} contacts to SQLite...`);

    // Batch insert for performance
    const sql = `
      INSERT OR REPLACE INTO contacts (phone_number, display_name, email, photo_uri, synced_at)
      VALUES (?, ?, ?, ?, ?)
    `;

    for (const contact of contacts) {
      await db.run(sql, [
        contact.phone_number,
        contact.display_name,
        contact.email,
        contact.photo_uri,
        contact.synced_at
      ]);
    }

    console.log(`✅ Saved ${contacts.length} contacts to SQLite`);
  }

  /**
   * Get all contacts from SQLite
   * Ordered by display_name for consistent UI display
   * 
   * @returns Array of all contacts
   */
  public async getAllContacts(): Promise<LocalContact[]> {
    await this.dbManager.checkDatabaseReady();
    const db = this.dbManager.getConnection();

    const sql = `
      SELECT * FROM contacts
      ORDER BY display_name ASC
    `;

    const result = await db.query(sql);
    return result.values || [];
  }

  /**
   * Search contacts by name or phone number
   * Case-insensitive search using LIKE
   * 
   * @param query - Search query (name or phone)
   * @returns Array of matching contacts
   */
  public async searchContacts(query: string): Promise<LocalContact[]> {
    await this.dbManager.checkDatabaseReady();
    const db = this.dbManager.getConnection();

    if (!query || query.trim().length === 0) {
      return this.getAllContacts();
    }

    const searchPattern = `%${query.toLowerCase()}%`;

    const sql = `
      SELECT * FROM contacts
      WHERE LOWER(display_name) LIKE ? OR LOWER(phone_number) LIKE ?
      ORDER BY display_name ASC
    `;

    const result = await db.query(sql, [searchPattern, searchPattern]);
    return result.values || [];
  }

  /**
   * Get contact by phone number
   * 
   * @param phoneNumber - Phone number to lookup
   * @returns Contact or null if not found
   */
  public async getContactByPhone(phoneNumber: string): Promise<LocalContact | null> {
    await this.dbManager.checkDatabaseReady();
    const db = this.dbManager.getConnection();

    const sql = `SELECT * FROM contacts WHERE phone_number = ?`;
    const result = await db.query(sql, [phoneNumber]);
    return result.values?.[0] || null;
  }

  /**
   * Save contact-to-user mappings (batch insert/update)
   * Maps device contacts to registered Confessr users
   * 
   * @param mappings - Array of contact-user mappings
   */
  public async saveContactUserMapping(mappings: ContactUserMapping[]): Promise<void> {
    await this.dbManager.checkDatabaseReady();
    const db = this.dbManager.getConnection();

    if (mappings.length === 0) {
      console.log('📇 No contact mappings to save');
      return;
    }

    console.log(`📇 Saving ${mappings.length} contact-user mappings...`);

    const sql = `
      INSERT OR REPLACE INTO contact_user_mapping 
      (contact_phone, user_id, user_display_name, user_avatar_url, mapped_at)
      VALUES (?, ?, ?, ?, ?)
    `;

    for (const mapping of mappings) {
      await db.run(sql, [
        mapping.contact_phone,
        mapping.user_id,
        mapping.user_display_name,
        mapping.user_avatar_url,
        mapping.mapped_at
      ]);
    }

    console.log(`✅ Saved ${mappings.length} contact-user mappings`);
  }

  /**
   * Get all registered contacts (contacts that are Confessr users)
   * Joins contacts with contact_user_mapping to get full user info
   * 
   * @returns Array of registered contacts with user data
   */
  public async getRegisteredContacts(): Promise<RegisteredContact[]> {
    await this.dbManager.checkDatabaseReady();
    const db = this.dbManager.getConnection();

    const sql = `
      SELECT 
        c.id as contact_id,
        c.phone_number as contact_phone,
        c.display_name as contact_display_name,
        c.photo_uri as contact_photo_uri,
        m.user_id,
        m.user_display_name,
        m.user_avatar_url
      FROM contacts c
      INNER JOIN contact_user_mapping m ON c.phone_number = m.contact_phone
      ORDER BY c.display_name ASC
    `;

    const result = await db.query(sql);
    const rows = result.values || [];

    // Map to RegisteredContact interface
    return rows.map(row => ({
      contact_id: row.contact_id,
      contact_phone: row.contact_phone,
      contact_display_name: row.contact_display_name,
      contact_photo_uri: row.contact_photo_uri,
      user_id: row.user_id,
      user_display_name: row.user_display_name,
      user_avatar_url: row.user_avatar_url,
      is_registered: true as const
    }));
  }

  /**
   * Get contact count
   * 
   * @returns Total number of contacts in SQLite
   */
  public async getContactCount(): Promise<number> {
    await this.dbManager.checkDatabaseReady();
    const db = this.dbManager.getConnection();

    const result = await db.query('SELECT COUNT(*) as count FROM contacts');
    return result.values?.[0]?.count || 0;
  }

  /**
   * Get registered contact count
   * 
   * @returns Number of contacts that are registered users
   */
  public async getRegisteredContactCount(): Promise<number> {
    await this.dbManager.checkDatabaseReady();
    const db = this.dbManager.getConnection();

    const result = await db.query('SELECT COUNT(*) as count FROM contact_user_mapping');
    return result.values?.[0]?.count || 0;
  }

  /**
   * Check if a phone number is a registered user
   * 
   * @param phoneNumber - Phone number to check
   * @returns true if phone number is mapped to a user
   */
  public async isRegisteredUser(phoneNumber: string): Promise<boolean> {
    await this.dbManager.checkDatabaseReady();
    const db = this.dbManager.getConnection();

    const sql = `SELECT COUNT(*) as count FROM contact_user_mapping WHERE contact_phone = ?`;
    const result = await db.query(sql, [phoneNumber]);
    return (result.values?.[0]?.count || 0) > 0;
  }

  /**
   * Get user info for a contact by phone number
   * 
   * @param phoneNumber - Phone number to lookup
   * @returns User mapping or null if not registered
   */
  public async getUserMappingByPhone(phoneNumber: string): Promise<ContactUserMapping | null> {
    await this.dbManager.checkDatabaseReady();
    const db = this.dbManager.getConnection();

    const sql = `SELECT * FROM contact_user_mapping WHERE contact_phone = ?`;
    const result = await db.query(sql, [phoneNumber]);
    return result.values?.[0] || null;
  }

  /**
   * Clear all contacts and mappings
   * Used when user wants to re-sync or revoke permissions
   */
  public async clearContacts(): Promise<void> {
    await this.dbManager.checkDatabaseReady();
    const db = this.dbManager.getConnection();

    console.log('🗑️ Clearing all contacts and mappings...');

    // Clear mappings first (foreign key constraint)
    await db.run('DELETE FROM contact_user_mapping');
    await db.run('DELETE FROM contacts');

    console.log('✅ All contacts and mappings cleared');
  }

  /**
   * Clear only contact-user mappings (keep contacts)
   * Used when re-discovering registered users
   */
  public async clearMappings(): Promise<void> {
    await this.dbManager.checkDatabaseReady();
    const db = this.dbManager.getConnection();

    console.log('🗑️ Clearing contact-user mappings...');
    await db.run('DELETE FROM contact_user_mapping');
    console.log('✅ Contact-user mappings cleared');
  }

  /**
   * Get last sync timestamp
   * Returns the most recent synced_at value from contacts
   * 
   * @returns Unix timestamp of last sync, or null if no contacts
   */
  public async getLastSyncTime(): Promise<number | null> {
    await this.dbManager.checkDatabaseReady();
    const db = this.dbManager.getConnection();

    const sql = `SELECT MAX(synced_at) as last_sync FROM contacts`;
    const result = await db.query(sql);
    return result.values?.[0]?.last_sync || null;
  }
}

