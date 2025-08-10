import { DatabaseManager } from './database';
import { LocalUser } from './types';

export class UserOperations {
  constructor(private dbManager: DatabaseManager) {}

  public async saveUser(user: LocalUser): Promise<void> {
    await this.dbManager.checkDatabaseReady();
    const db = this.dbManager.getConnection();

    const sql = `
      INSERT OR REPLACE INTO users (id, display_name, phone_number, avatar_url, is_onboarded, created_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `;

    await db.run(sql, [
      user.id,
      user.display_name,
      user.phone_number,
      user.avatar_url,
      user.is_onboarded,
      user.created_at
    ]);
  }

  public async getUser(userId: string): Promise<LocalUser | null> {
    await this.dbManager.checkDatabaseReady();
    const db = this.dbManager.getConnection();

    const result = await db.query('SELECT * FROM users WHERE id = ?', [userId]);
    return result.values?.[0] || null;
  }
}