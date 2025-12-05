import { DatabaseManager } from './database';
import {
  LocalTopic,
  LocalTopicReadStatus,
  LocalTopicViewQueue
} from './types';

export class TopicOperations {
  constructor(private dbManager: DatabaseManager) {}

  // ============================================
  // TOPICS CACHE TABLE OPERATIONS (Task 4.1)
  // ============================================

  /**
   * Save a topic to the cache
   * Uses INSERT OR REPLACE to handle updates
   */
  public async saveTopicToCache(topic: LocalTopic): Promise<void> {
    await this.dbManager.checkDatabaseReady();
    const db = this.dbManager.getConnection();

    await db.run(
      `INSERT OR REPLACE INTO topics_cache (
        id, group_id, message_id, type, title, content,
        author_id, author_name, author_avatar, pseudonym,
        expires_at, views_count, likes_count, replies_count,
        is_anonymous, created_at, synced_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?);`,
      [
        topic.id,
        topic.group_id,
        topic.message_id,
        topic.type,
        topic.title,
        topic.content,
        topic.author_id,
        topic.author_name,
        topic.author_avatar,
        topic.pseudonym,
        topic.expires_at,
        topic.views_count,
        topic.likes_count,
        topic.replies_count,
        topic.is_anonymous,
        topic.created_at,
        topic.synced_at
      ]
    );
  }

  /**
   * Get topics from cache with pagination
   * Returns topics in reverse chronological order (newest first)
   * Filters out expired topics
   */
  public async getTopicsFromCache(
    groupId: string,
    limit: number,
    offset: number
  ): Promise<LocalTopic[]> {
    await this.dbManager.checkDatabaseReady();
    const db = this.dbManager.getConnection();

    const now = Date.now();
    const sql = `
      SELECT * FROM topics_cache
      WHERE group_id = ?
        AND (expires_at IS NULL OR expires_at > ?)
      ORDER BY created_at DESC
      LIMIT ? OFFSET ?
    `;

    const result = await db.query(sql, [groupId, now, limit, offset]);
    return result.values || [];
  }

  /**
   * Update topic metrics (views, likes, replies counts)
   * Used when syncing from server or after local operations
   */
  public async updateTopicMetrics(
    topicId: string,
    metrics: {
      views_count?: number;
      likes_count?: number;
      replies_count?: number;
    }
  ): Promise<void> {
    await this.dbManager.checkDatabaseReady();
    const db = this.dbManager.getConnection();

    const updates: string[] = [];
    const values: any[] = [];

    if (metrics.views_count !== undefined) {
      updates.push('views_count = ?');
      values.push(metrics.views_count);
    }
    if (metrics.likes_count !== undefined) {
      updates.push('likes_count = ?');
      values.push(metrics.likes_count);
    }
    if (metrics.replies_count !== undefined) {
      updates.push('replies_count = ?');
      values.push(metrics.replies_count);
    }

    if (updates.length === 0) return;

    values.push(topicId);
    const sql = `UPDATE topics_cache SET ${updates.join(', ')} WHERE id = ?;`;

    await db.run(sql, values);
  }

  /**
   * Delete a topic from cache
   * Used when topic expires or is manually deleted
   */
  public async deleteTopicFromCache(topicId: string): Promise<void> {
    await this.dbManager.checkDatabaseReady();
    const db = this.dbManager.getConnection();

    await db.run('DELETE FROM topics_cache WHERE id = ?;', [topicId]);
  }

  // ============================================
  // TOPIC LIKES CACHE TABLE OPERATIONS (Task 4.2)
  // ============================================

  /**
   * Save a topic like to cache
   * Uses INSERT OR REPLACE to handle duplicate likes
   */
  public async saveTopicLike(topicId: string, userId: string): Promise<void> {
    await this.dbManager.checkDatabaseReady();
    const db = this.dbManager.getConnection();

    const now = Date.now();
    await db.run(
      `INSERT OR REPLACE INTO topic_likes_cache (topic_id, user_id, created_at, synced)
       VALUES (?, ?, ?, 0);`,
      [topicId, userId, now]
    );
  }

  /**
   * Delete a topic like from cache
   * Used when user unlikes a topic
   */
  public async deleteTopicLike(topicId: string, userId: string): Promise<void> {
    await this.dbManager.checkDatabaseReady();
    const db = this.dbManager.getConnection();

    await db.run(
      'DELETE FROM topic_likes_cache WHERE topic_id = ? AND user_id = ?;',
      [topicId, userId]
    );
  }

  /**
   * Check if a topic is liked by a user
   * Returns true if like exists in cache
   */
  public async isTopicLikedByUser(topicId: string, userId: string): Promise<boolean> {
    await this.dbManager.checkDatabaseReady();
    const db = this.dbManager.getConnection();

    const sql = `
      SELECT 1 FROM topic_likes_cache
      WHERE topic_id = ? AND user_id = ?
      LIMIT 1
    `;

    const result = await db.query(sql, [topicId, userId]);
    return result.values !== undefined && result.values.length > 0;
  }

  // ============================================
  // TOPIC READ STATUS TABLE OPERATIONS (Task 4.3)
  // ============================================

  /**
   * Update topic read status (local-first)
   * Stores the last read message ID and timestamp for a topic
   */
  public async updateTopicReadStatus(
    topicId: string,
    groupId: string,
    userId: string,
    lastReadMessageId: string | null,
    lastReadAt: number
  ): Promise<void> {
    await this.dbManager.checkDatabaseReady();
    const db = this.dbManager.getConnection();

    await db.run(
      `INSERT OR REPLACE INTO topic_read_status (
        topic_id, group_id, user_id, last_read_message_id, last_read_at, synced
      ) VALUES (?, ?, ?, ?, ?, 0);`,
      [topicId, groupId, userId, lastReadMessageId, lastReadAt]
    );
  }

  /**
   * Get topic read status for a user
   * Returns null if no read status exists (never viewed)
   */
  public async getTopicReadStatus(
    topicId: string,
    userId: string
  ): Promise<LocalTopicReadStatus | null> {
    await this.dbManager.checkDatabaseReady();
    const db = this.dbManager.getConnection();

    const sql = `
      SELECT * FROM topic_read_status
      WHERE topic_id = ? AND user_id = ?
    `;

    const result = await db.query(sql, [topicId, userId]);
    
    if (result.values && result.values.length > 0) {
      return result.values[0];
    }
    
    return null;
  }

  /**
   * Get all topic read statuses for a user in a group
   * Used for calculating unread counts across all topics
   */
  public async getAllTopicReadStatuses(
    userId: string,
    groupId: string
  ): Promise<LocalTopicReadStatus[]> {
    await this.dbManager.checkDatabaseReady();
    const db = this.dbManager.getConnection();

    const sql = `
      SELECT * FROM topic_read_status
      WHERE user_id = ? AND group_id = ?
    `;

    const result = await db.query(sql, [userId, groupId]);
    return result.values || [];
  }

  // ============================================
  // TOPIC VIEWS QUEUE TABLE OPERATIONS (Task 4.4)
  // ============================================

  /**
   * Queue a topic view for sync
   * Views are batched and synced to server periodically
   */
  public async queueTopicView(topicId: string, userId: string): Promise<void> {
    await this.dbManager.checkDatabaseReady();
    const db = this.dbManager.getConnection();

    const now = Date.now();
    await db.run(
      `INSERT INTO topic_views_queue (topic_id, user_id, viewed_at, synced)
       VALUES (?, ?, ?, 0);`,
      [topicId, userId, now]
    );
  }

  /**
   * Get unsynced views from queue
   * Returns all views that haven't been synced to server yet
   */
  public async getUnsyncedViewsQueue(): Promise<LocalTopicViewQueue[]> {
    await this.dbManager.checkDatabaseReady();
    const db = this.dbManager.getConnection();

    const sql = `
      SELECT * FROM topic_views_queue
      WHERE synced = 0
      ORDER BY viewed_at ASC
    `;

    const result = await db.query(sql);
    return result.values || [];
  }

  /**
   * Mark views as synced
   * Called after successfully syncing views to server
   */
  public async markViewsAsSynced(ids: number[]): Promise<void> {
    await this.dbManager.checkDatabaseReady();
    const db = this.dbManager.getConnection();

    if (ids.length === 0) return;

    const placeholders = ids.map(() => '?').join(',');
    const sql = `UPDATE topic_views_queue SET synced = 1 WHERE id IN (${placeholders});`;

    await db.run(sql, ids);
  }

  // ============================================
  // TOPIC UNREAD COUNT CALCULATION (Task 4.5)
  // ============================================

  /**
   * Calculate unread count for a topic (local-first)
   * Uses local read status as source of truth
   * Counts messages after last_read_at timestamp
   */
  public async calculateTopicUnreadCount(
    topicId: string,
    userId: string
  ): Promise<number> {
    await this.dbManager.checkDatabaseReady();
    const db = this.dbManager.getConnection();

    // Get read status from local SQLite
    const readStatus = await this.getTopicReadStatus(topicId, userId);

    if (!readStatus || !readStatus.last_read_at) {
      // Never read - count all messages in topic (excluding user's own messages)
      const sql = `
        SELECT COUNT(*) as count FROM messages
        WHERE topic_id = ? AND user_id != ?
      `;
      const result = await db.query(sql, [topicId, userId]);
      return result.values?.[0]?.count || 0;
    }

    // Count messages after last_read_at (excluding user's own messages)
    const sql = `
      SELECT COUNT(*) as count FROM messages
      WHERE topic_id = ? 
        AND user_id != ?
        AND created_at > ?
    `;
    const result = await db.query(sql, [topicId, userId, readStatus.last_read_at]);
    return result.values?.[0]?.count || 0;
  }

  // ============================================
  // CACHE CLEANUP OPERATIONS (Task 9.3)
  // ============================================

  /**
   * Remove expired topics from cache
   * Should be called periodically to clean up expired topics
   * Returns the number of topics removed
   */
  public async cleanupExpiredTopics(): Promise<number> {
    await this.dbManager.checkDatabaseReady();
    const db = this.dbManager.getConnection();

    const now = Date.now();
    
    // Get count of expired topics before deletion
    const countSql = `
      SELECT COUNT(*) as count FROM topics_cache
      WHERE expires_at IS NOT NULL AND expires_at <= ?
    `;
    const countResult = await db.query(countSql, [now]);
    const expiredCount = countResult.values?.[0]?.count || 0;

    if (expiredCount > 0) {
      // Delete expired topics
      const deleteSql = `
        DELETE FROM topics_cache
        WHERE expires_at IS NOT NULL AND expires_at <= ?
      `;
      await db.run(deleteSql, [now]);
      
      console.log(`🗑️ Cleaned up ${expiredCount} expired topics from cache`);
    }

    return expiredCount;
  }

  /**
   * Get all expired topic IDs
   * Used to identify which topics need to be removed
   */
  public async getExpiredTopicIds(): Promise<string[]> {
    await this.dbManager.checkDatabaseReady();
    const db = this.dbManager.getConnection();

    const now = Date.now();
    const sql = `
      SELECT id FROM topics_cache
      WHERE expires_at IS NOT NULL AND expires_at <= ?
    `;

    const result = await db.query(sql, [now]);
    return (result.values || []).map((row: any) => row.id);
  }

  // ============================================
  // CASCADE DELETION OPERATIONS (Task 10.2)
  // ============================================

  /**
   * Delete a topic and all associated data (cascade deletion)
   * This handles the cascade deletion in SQLite that mirrors Supabase's CASCADE behavior
   * 
   * Deletes:
   * - Topic from topics_cache
   * - Associated likes from topic_likes_cache
   * - Associated messages with topic_id
   * - Read status from topic_read_status
   * - Queued views from topic_views_queue
   * 
   * Requirements: 6.4, 6.6
   */
  public async cascadeDeleteTopic(topicId: string): Promise<void> {
    await this.dbManager.checkDatabaseReady();
    const db = this.dbManager.getConnection();

    console.log(`🗑️ Starting cascade deletion for topic ${topicId}`);

    try {
      // Use a transaction to ensure all deletions succeed or none do
      await db.run('BEGIN TRANSACTION;');

      // 1. Delete associated likes from topic_likes_cache
      const likesResult = await db.run(
        'DELETE FROM topic_likes_cache WHERE topic_id = ?;',
        [topicId]
      );
      console.log(`  ✓ Deleted ${likesResult.changes || 0} likes`);

      // 2. Delete associated messages with topic_id (replies to the topic)
      const messagesResult = await db.run(
        'DELETE FROM messages WHERE topic_id = ?;',
        [topicId]
      );
      console.log(`  ✓ Deleted ${messagesResult.changes || 0} messages`);

      // 3. Delete read status from topic_read_status
      const readStatusResult = await db.run(
        'DELETE FROM topic_read_status WHERE topic_id = ?;',
        [topicId]
      );
      console.log(`  ✓ Deleted ${readStatusResult.changes || 0} read status entries`);

      // 4. Delete queued views from topic_views_queue
      const viewsResult = await db.run(
        'DELETE FROM topic_views_queue WHERE topic_id = ?;',
        [topicId]
      );
      console.log(`  ✓ Deleted ${viewsResult.changes || 0} queued views`);

      // 5. Delete the topic itself from topics_cache
      const topicResult = await db.run(
        'DELETE FROM topics_cache WHERE id = ?;',
        [topicId]
      );
      console.log(`  ✓ Deleted topic (${topicResult.changes || 0} rows)`);

      // Commit the transaction
      await db.run('COMMIT;');

      console.log(`✅ Cascade deletion complete for topic ${topicId}`);
    } catch (error) {
      // Rollback on error
      await db.run('ROLLBACK;');
      console.error(`❌ Cascade deletion failed for topic ${topicId}:`, error);
      throw error;
    }
  }

  /**
   * Delete multiple topics and all associated data (batch cascade deletion)
   * More efficient than calling cascadeDeleteTopic multiple times
   * 
   * Requirements: 6.4, 6.6
   */
  public async cascadeDeleteTopics(topicIds: string[]): Promise<number> {
    if (topicIds.length === 0) {
      return 0;
    }

    await this.dbManager.checkDatabaseReady();
    const db = this.dbManager.getConnection();

    console.log(`🗑️ Starting batch cascade deletion for ${topicIds.length} topics`);

    try {
      // Use a transaction to ensure all deletions succeed or none do
      await db.run('BEGIN TRANSACTION;');

      const placeholders = topicIds.map(() => '?').join(',');

      // 1. Delete associated likes
      const likesResult = await db.run(
        `DELETE FROM topic_likes_cache WHERE topic_id IN (${placeholders});`,
        topicIds
      );
      console.log(`  ✓ Deleted ${likesResult.changes || 0} likes`);

      // 2. Delete associated messages
      const messagesResult = await db.run(
        `DELETE FROM messages WHERE topic_id IN (${placeholders});`,
        topicIds
      );
      console.log(`  ✓ Deleted ${messagesResult.changes || 0} messages`);

      // 3. Delete read status
      const readStatusResult = await db.run(
        `DELETE FROM topic_read_status WHERE topic_id IN (${placeholders});`,
        topicIds
      );
      console.log(`  ✓ Deleted ${readStatusResult.changes || 0} read status entries`);

      // 4. Delete queued views
      const viewsResult = await db.run(
        `DELETE FROM topic_views_queue WHERE topic_id IN (${placeholders});`,
        topicIds
      );
      console.log(`  ✓ Deleted ${viewsResult.changes || 0} queued views`);

      // 5. Delete the topics themselves
      const topicsResult = await db.run(
        `DELETE FROM topics_cache WHERE id IN (${placeholders});`,
        topicIds
      );
      const deletedCount = typeof topicsResult.changes === 'number' ? topicsResult.changes : 0;
      console.log(`  ✓ Deleted ${deletedCount} topics`);

      // Commit the transaction
      await db.run('COMMIT;');

      console.log(`✅ Batch cascade deletion complete: ${deletedCount} topics deleted`);
      return deletedCount;
    } catch (error) {
      // Rollback on error
      await db.run('ROLLBACK;');
      console.error(`❌ Batch cascade deletion failed:`, error);
      throw error;
    }
  }

  /**
   * Clean up expired topics with cascade deletion
   * This is the main method that should be called periodically to remove expired topics
   * It combines expiration checking with cascade deletion
   * 
   * Requirements: 6.1, 6.4, 6.6
   */
  public async cleanupExpiredTopicsWithCascade(): Promise<number> {
    await this.dbManager.checkDatabaseReady();

    // Get all expired topic IDs
    const expiredTopicIds = await this.getExpiredTopicIds();

    if (expiredTopicIds.length === 0) {
      console.log('✓ No expired topics to clean up');
      return 0;
    }

    console.log(`🗑️ Found ${expiredTopicIds.length} expired topics to clean up`);

    // Perform batch cascade deletion
    const deletedCount = await this.cascadeDeleteTopics(expiredTopicIds);

    return deletedCount;
  }
}
