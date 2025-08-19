import { DatabaseManager } from './database';
import { OutboxMessage } from './types';

export class OutboxOperations {
  constructor(private dbManager: DatabaseManager) {}

  public async addToOutbox(message: Omit<OutboxMessage, 'id'>): Promise<void> {
    await this.dbManager.checkDatabaseReady();
    const db = this.dbManager.getConnection();

    const sql = `
      INSERT INTO outbox (group_id, user_id, content, retry_count, next_retry_at)
      VALUES (?, ?, ?, ?, ?)
    `;

    await db.run(sql, [
      message.group_id,
      message.user_id,
      message.content,
      message.retry_count,
      message.next_retry_at
    ]);
  }

  public async getOutboxMessages(): Promise<OutboxMessage[]> {
    await this.dbManager.checkDatabaseReady();
    const db = this.dbManager.getConnection();

    const sql = `
      SELECT * FROM outbox 
      WHERE next_retry_at <= ? 
      ORDER BY next_retry_at ASC
    `;

    const now = Date.now();
    const result = await db.query(sql, [now]);
    return result.values || [];
  }

  public async removeFromOutbox(id: number): Promise<void> {
    await this.dbManager.checkDatabaseReady();
    const db = this.dbManager.getConnection();

    await db.run('DELETE FROM outbox WHERE id = ?', [id]);
  }

  public async updateOutboxRetry(id: number, retryCount: number, nextRetryAt: number): Promise<void> {
    await this.dbManager.checkDatabaseReady();
    const db = this.dbManager.getConnection();

    const sql = `
      UPDATE outbox 
      SET retry_count = ?, next_retry_at = ? 
      WHERE id = ?
    `;

    await db.run(sql, [retryCount, nextRetryAt, id]);
  }
}