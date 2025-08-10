import { DatabaseManager } from './database';

export class SyncOperations {
  constructor(private dbManager: DatabaseManager) {}

  public async setSyncState(key: string, value: string): Promise<void> {
    await this.dbManager.checkDatabaseReady();
    const db = this.dbManager.getConnection();

    const sql = `
      INSERT OR REPLACE INTO sync_state (key, value)
      VALUES (?, ?)
    `;

    await db.run(sql, [key, value]);
  }

  public async getSyncState(key: string): Promise<string | null> {
    await this.dbManager.checkDatabaseReady();
    const db = this.dbManager.getConnection();

    const result = await db.query('SELECT value FROM sync_state WHERE key = ?', [key]);
    return result.values?.[0]?.value || null;
  }
}