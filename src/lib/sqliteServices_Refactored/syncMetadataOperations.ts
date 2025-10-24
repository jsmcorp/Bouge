import { DatabaseManager } from './database';

/**
 * Sync Metadata Operations
 * Manages sync state and timestamps for contact synchronization
 */
export class SyncMetadataOperations {
  private dbManager: DatabaseManager;

  constructor(dbManager: DatabaseManager) {
    this.dbManager = dbManager;
  }

  /**
   * Set a sync metadata value
   */
  public async setSyncMetadata(key: string, value: string): Promise<void> {
    await this.dbManager.checkDatabaseReady();
    const db = this.dbManager.getConnection();

    const now = Date.now();
    const sql = `
      INSERT OR REPLACE INTO sync_metadata (key, value, updated_at)
      VALUES (?, ?, ?)
    `;

    await db.run(sql, [key, value, now]);
  }

  /**
   * Get a sync metadata value
   */
  public async getSyncMetadata(key: string): Promise<string | null> {
    await this.dbManager.checkDatabaseReady();
    const db = this.dbManager.getConnection();

    const sql = `
      SELECT value FROM sync_metadata WHERE key = ?
    `;

    const result = await db.query(sql, [key]);

    if (result.values && result.values.length > 0) {
      return result.values[0].value;
    }

    return null;
  }

  /**
   * Get last full sync timestamp
   */
  public async getLastFullSyncTime(): Promise<number | null> {
    const value = await this.getSyncMetadata('last_full_sync');
    return value ? parseInt(value, 10) : null;
  }

  /**
   * Set last full sync timestamp
   */
  public async setLastFullSyncTime(timestamp: number): Promise<void> {
    await this.setSyncMetadata('last_full_sync', timestamp.toString());
  }

  /**
   * Get last incremental sync timestamp
   */
  public async getLastIncrementalSyncTime(): Promise<number | null> {
    const value = await this.getSyncMetadata('last_incremental_sync');
    return value ? parseInt(value, 10) : null;
  }

  /**
   * Set last incremental sync timestamp
   */
  public async setLastIncrementalSyncTime(timestamp: number): Promise<void> {
    await this.setSyncMetadata('last_incremental_sync', timestamp.toString());
  }

  /**
   * Get total contacts synced count
   */
  public async getTotalContactsSynced(): Promise<number> {
    const value = await this.getSyncMetadata('total_contacts_synced');
    return value ? parseInt(value, 10) : 0;
  }

  /**
   * Set total contacts synced count
   */
  public async setTotalContactsSynced(count: number): Promise<void> {
    await this.setSyncMetadata('total_contacts_synced', count.toString());
  }

  /**
   * Get device contact count from last sync
   */
  public async getLastDeviceContactCount(): Promise<number> {
    const value = await this.getSyncMetadata('last_device_contact_count');
    return value ? parseInt(value, 10) : 0;
  }

  /**
   * Set device contact count
   */
  public async setLastDeviceContactCount(count: number): Promise<void> {
    await this.setSyncMetadata('last_device_contact_count', count.toString());
  }

  /**
   * Check if this is the first sync
   */
  public async isFirstSync(): Promise<boolean> {
    const lastSync = await this.getLastFullSyncTime();
    return lastSync === null;
  }

  /**
   * Get contacts checksum (for delta sync optimization)
   */
  public async getContactsChecksum(): Promise<string | null> {
    return await this.getSyncMetadata('contacts_checksum');
  }

  /**
   * Set contacts checksum
   */
  public async setContactsChecksum(checksum: string): Promise<void> {
    await this.setSyncMetadata('contacts_checksum', checksum);
  }

  /**
   * Get last delta sync timestamp
   */
  public async getLastDeltaSyncTime(): Promise<number | null> {
    const value = await this.getSyncMetadata('last_delta_sync');
    return value ? parseInt(value, 10) : null;
  }

  /**
   * Set last delta sync timestamp
   */
  public async setLastDeltaSyncTime(timestamp: number): Promise<void> {
    await this.setSyncMetadata('last_delta_sync', timestamp.toString());
  }

  /**
   * Clear all sync metadata (for testing/reset)
   */
  public async clearAllSyncMetadata(): Promise<void> {
    await this.dbManager.checkDatabaseReady();
    const db = this.dbManager.getConnection();

    const sql = `DELETE FROM sync_metadata`;
    await db.run(sql, []);
  }

  /**
   * Get all sync metadata (for debugging)
   */
  public async getAllSyncMetadata(): Promise<Record<string, string>> {
    await this.dbManager.checkDatabaseReady();
    const db = this.dbManager.getConnection();

    const sql = `SELECT key, value FROM sync_metadata`;
    const result = await db.query(sql, []);

    const metadata: Record<string, string> = {};
    if (result.values) {
      for (const row of result.values) {
        metadata[row.key] = row.value;
      }
    }

    return metadata;
  }
}

