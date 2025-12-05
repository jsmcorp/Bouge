import { DatabaseManager } from './database';
import { TopicOutboxOperation } from './types';

/**
 * TopicOutboxOperations - Manages offline queue for topic operations
 * Handles: topic creation, likes, views, read status updates
 */
export class TopicOutboxOperations {
  constructor(private dbManager: DatabaseManager) {}

  /**
   * Add a topic operation to the outbox queue
   * Used when offline or to batch operations
   */
  public async addToOutbox(operation: Omit<TopicOutboxOperation, 'id'>): Promise<void> {
    await this.dbManager.checkDatabaseReady();
    const db = this.dbManager.getConnection();

    const sql = `
      INSERT INTO topic_outbox (
        operation_type, topic_id, user_id, group_id, payload,
        retry_count, next_retry_at, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `;

    await db.run(sql, [
      operation.operation_type,
      operation.topic_id,
      operation.user_id,
      operation.group_id,
      operation.payload,
      operation.retry_count,
      operation.next_retry_at,
      operation.created_at
    ]);
  }

  /**
   * Get pending operations from outbox
   * Returns operations that are ready to retry (next_retry_at <= now)
   * Excludes operations that have exceeded max retry count
   */
  public async getPendingOperations(): Promise<TopicOutboxOperation[]> {
    await this.dbManager.checkDatabaseReady();
    const db = this.dbManager.getConnection();

    const sql = `
      SELECT * FROM topic_outbox
      WHERE next_retry_at <= ? AND retry_count < 5
      ORDER BY created_at ASC
      LIMIT 50
    `;

    const now = Date.now();
    const result = await db.query(sql, [now]);
    return result.values || [];
  }

  /**
   * Remove an operation from the outbox after successful sync
   */
  public async removeFromOutbox(id: number): Promise<void> {
    await this.dbManager.checkDatabaseReady();
    const db = this.dbManager.getConnection();

    await db.run('DELETE FROM topic_outbox WHERE id = ?', [id]);
  }

  /**
   * Update retry count and next retry time for failed operation
   * Uses exponential backoff: 1s, 2s, 4s, 8s, 16s
   */
  public async updateRetry(id: number, retryCount: number): Promise<void> {
    await this.dbManager.checkDatabaseReady();
    const db = this.dbManager.getConnection();

    // Exponential backoff: 2^retryCount seconds
    const backoffSeconds = Math.pow(2, retryCount);
    const nextRetryAt = Date.now() + (backoffSeconds * 1000);

    const sql = `
      UPDATE topic_outbox
      SET retry_count = ?, next_retry_at = ?
      WHERE id = ?
    `;

    await db.run(sql, [retryCount, nextRetryAt, id]);
  }

  /**
   * Get count of pending operations
   * Used for UI indicators
   */
  public async getPendingCount(): Promise<number> {
    await this.dbManager.checkDatabaseReady();
    const db = this.dbManager.getConnection();

    const sql = `
      SELECT COUNT(*) as count FROM topic_outbox
      WHERE retry_count < 5
    `;

    const result = await db.query(sql);
    return result.values?.[0]?.count || 0;
  }

  /**
   * Clear all operations for a specific topic
   * Used when topic is deleted or operation is no longer valid
   */
  public async clearTopicOperations(topicId: string): Promise<void> {
    await this.dbManager.checkDatabaseReady();
    const db = this.dbManager.getConnection();

    await db.run('DELETE FROM topic_outbox WHERE topic_id = ?', [topicId]);
  }

  /**
   * Get operations by type
   * Used for debugging and monitoring
   */
  public async getOperationsByType(
    operationType: 'create_topic' | 'toggle_like' | 'increment_view' | 'update_read_status'
  ): Promise<TopicOutboxOperation[]> {
    await this.dbManager.checkDatabaseReady();
    const db = this.dbManager.getConnection();

    const sql = `
      SELECT * FROM topic_outbox
      WHERE operation_type = ?
      ORDER BY created_at DESC
    `;

    const result = await db.query(sql, [operationType]);
    return result.values || [];
  }
}
