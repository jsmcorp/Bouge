import { DatabaseManager } from './database';
import { LocalGroup } from './types';

export class GroupOperations {
  constructor(private dbManager: DatabaseManager) {}

  public async saveGroup(group: LocalGroup): Promise<void> {
    await this.dbManager.checkDatabaseReady();
    const db = this.dbManager.getConnection();

    const sql = `
      INSERT OR REPLACE INTO groups (id, name, description, invite_code, created_by, created_at, last_sync_timestamp, avatar_url, is_archived)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `;

    await db.run(sql, [
      group.id,
      group.name,
      group.description,
      group.invite_code,
      group.created_by,
      group.created_at,
      group.last_sync_timestamp,
      group.avatar_url,
      group.is_archived
    ]);
  }

  public async getGroups(): Promise<LocalGroup[]> {
    await this.dbManager.checkDatabaseReady();
    const db = this.dbManager.getConnection();

    const result = await db.query('SELECT * FROM groups ORDER BY name');
    return result.values || [];
  }

  public async getLastSyncTimestamp(groupId: string): Promise<number> {
    await this.dbManager.checkDatabaseReady();
    const db = this.dbManager.getConnection();
    
    try {
      const result = await db.query(
        'SELECT last_sync_timestamp FROM groups WHERE id = ?',
        [groupId]
      );
      
      return result.values?.[0]?.last_sync_timestamp || 0;
    } catch (error) {
      console.error(`❌ Error getting last sync timestamp for group ${groupId}:`, error);
      return 0;
    }
  }

  public async updateLastSyncTimestamp(groupId: string, timestamp: number): Promise<void> {
    await this.dbManager.checkDatabaseReady();
    const db = this.dbManager.getConnection();

    try {
      await db.run(
        'UPDATE groups SET last_sync_timestamp = ? WHERE id = ?',
        [timestamp, groupId]
      );
    } catch (error) {
      console.error(`❌ Error updating last sync timestamp for group ${groupId}:`, error);
    }
  }

  public async deleteGroup(groupId: string): Promise<void> {
    await this.dbManager.checkDatabaseReady();
    const db = this.dbManager.getConnection();

    await db.run(
      `DELETE FROM groups WHERE id = ?;`,
      [groupId]
    );
  }

  public async updateGroupCreator(groupId: string, createdBy: string): Promise<void> {
    await this.dbManager.checkDatabaseReady();
    const db = this.dbManager.getConnection();

    await db.run(
      `UPDATE groups SET created_by = ? WHERE id = ?;`,
      [createdBy, groupId]
    );
  }
}