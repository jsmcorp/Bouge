import { DatabaseManager } from './database';

export class TombstoneOperations {
  constructor(private dbManager: DatabaseManager) {}

  /**
   * Mark messages as locally deleted (tombstone)
   */
  public async markAsDeleted(messageIds: string[]): Promise<void> {
    await this.dbManager.checkDatabaseReady();
    const db = this.dbManager.getConnection();

    const now = Date.now();
    
    try {
      for (const messageId of messageIds) {
        await db.run(
          `INSERT OR REPLACE INTO locally_deleted_messages (message_id, deleted_at) VALUES (?, ?)`,
          [messageId, now]
        );
      }
      console.log(`🪦 Tombstoned ${messageIds.length} messages`);
    } catch (error) {
      console.error('❌ Error creating tombstones:', error);
      throw error;
    }
  }

  /**
   * Check if a message is locally deleted
   */
  public async isDeleted(messageId: string): Promise<boolean> {
    await this.dbManager.checkDatabaseReady();
    const db = this.dbManager.getConnection();

    try {
      const result = await db.query(
        'SELECT 1 FROM locally_deleted_messages WHERE message_id = ? LIMIT 1',
        [messageId]
      );
      return (result.values?.length || 0) > 0;
    } catch (error) {
      console.error(`❌ Error checking tombstone for ${messageId}:`, error);
      return false;
    }
  }

  /**
   * Get all locally deleted message IDs
   */
  public async getAllDeletedIds(): Promise<Set<string>> {
    await this.dbManager.checkDatabaseReady();
    const db = this.dbManager.getConnection();

    try {
      const result = await db.query('SELECT message_id FROM locally_deleted_messages');
      const ids = (result.values || []).map((row: any) => row.message_id);
      return new Set(ids);
    } catch (error) {
      console.error('❌ Error fetching tombstones:', error);
      return new Set();
    }
  }

  /**
   * Filter out locally deleted messages from a list
   */
  public async filterDeleted<T extends { id: string }>(messages: T[]): Promise<T[]> {
    if (messages.length === 0) return messages;

    const deletedIds = await this.getAllDeletedIds();
    if (deletedIds.size === 0) return messages;

    return messages.filter(msg => !deletedIds.has(msg.id));
  }

  /**
   * Clean up tombstones older than 48 hours
   */
  public async cleanupOldTombstones(): Promise<number> {
    await this.dbManager.checkDatabaseReady();
    const db = this.dbManager.getConnection();

    const fortyEightHoursAgo = Date.now() - (48 * 60 * 60 * 1000);

    try {
      const result = await db.run(
        'DELETE FROM locally_deleted_messages WHERE deleted_at < ?',
        [fortyEightHoursAgo]
      );
      const deletedCount = result.changes?.changes || 0;
      console.log(`🧹 Cleaned up ${deletedCount} old tombstones`);
      return deletedCount;
    } catch (error) {
      console.error('❌ Error cleaning up tombstones:', error);
      return 0;
    }
  }

  /**
   * Remove tombstone (for undo)
   */
  public async removeTombstone(messageId: string): Promise<void> {
    await this.dbManager.checkDatabaseReady();
    const db = this.dbManager.getConnection();

    try {
      await db.run('DELETE FROM locally_deleted_messages WHERE message_id = ?', [messageId]);
      console.log(`🔄 Removed tombstone for ${messageId}`);
    } catch (error) {
      console.error(`❌ Error removing tombstone for ${messageId}:`, error);
      throw error;
    }
  }

  /**
   * Remove multiple tombstones (for undo)
   */
  public async removeTombstones(messageIds: string[]): Promise<void> {
    await this.dbManager.checkDatabaseReady();
    const db = this.dbManager.getConnection();

    if (messageIds.length === 0) return;

    try {
      const placeholders = messageIds.map(() => '?').join(',');
      await db.run(
        `DELETE FROM locally_deleted_messages WHERE message_id IN (${placeholders})`,
        messageIds
      );
      console.log(`🔄 Removed ${messageIds.length} tombstones`);
    } catch (error) {
      console.error('❌ Error removing tombstones:', error);
      throw error;
    }
  }
}
