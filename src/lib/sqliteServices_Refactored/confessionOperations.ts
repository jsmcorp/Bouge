import { DatabaseManager } from './database';
import { LocalConfession } from './types';

export class ConfessionOperations {
  constructor(private dbManager: DatabaseManager) {}

  public async saveConfession(confession: LocalConfession): Promise<void> {
    await this.dbManager.checkDatabaseReady();
    const db = this.dbManager.getConnection();

    await db.run(
      `INSERT OR REPLACE INTO confessions (id, message_id, confession_type, is_anonymous)
       VALUES (?, ?, ?, ?);`,
      [
        confession.id,
        confession.message_id,
        confession.confession_type,
        confession.is_anonymous
      ]
    );
  }

  public async getConfessions(messageIds: string[]): Promise<LocalConfession[]> {
    await this.dbManager.checkDatabaseReady();
    const db = this.dbManager.getConnection();

    if (messageIds.length === 0) return [];

    const placeholders = messageIds.map(() => '?').join(',');
    const sql = `
      SELECT * FROM confessions 
      WHERE message_id IN (${placeholders})
    `;

    const result = await db.query(sql, messageIds);
    return result.values || [];
  }
}