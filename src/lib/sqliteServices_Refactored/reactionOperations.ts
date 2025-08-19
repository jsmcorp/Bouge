import { DatabaseManager } from './database';
import { LocalReaction } from './types';

export class ReactionOperations {
  constructor(private dbManager: DatabaseManager) {}

  public async saveReaction(reaction: Omit<LocalReaction, 'local_id'>): Promise<void> {
    await this.dbManager.checkDatabaseReady();
    const db = this.dbManager.getConnection();

    await db.run(
      `INSERT OR REPLACE INTO reactions (id, message_id, user_id, emoji, created_at)
       VALUES (?, ?, ?, ?, ?);`,
      [
        reaction.id,
        reaction.message_id,
        reaction.user_id,
        reaction.emoji,
        reaction.created_at
      ]
    );
  }

  public async getReactions(messageIds: string[]): Promise<LocalReaction[]> {
    await this.dbManager.checkDatabaseReady();
    const db = this.dbManager.getConnection();

    if (messageIds.length === 0) return [];

    const placeholders = messageIds.map(() => '?').join(',');
    const sql = `
      SELECT * FROM reactions 
      WHERE message_id IN (${placeholders})
    `;

    const result = await db.query(sql, messageIds);
    return result.values || [];
  }
}