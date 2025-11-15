import { DatabaseManager } from './database';

export class RepairOperations {
  constructor(private dbManager: DatabaseManager) {}

  /**
   * Check for data integrity issues after CASCADE migration
   */
  public async checkDataIntegrity(): Promise<{
    valid: boolean;
    issues: string[];
  }> {
    await this.dbManager.checkDatabaseReady();
    const db = this.dbManager.getConnection();

    const issues: string[] = [];

    try {
      // Check reactions with invalid message_ids
      const reactionsCheck = await db.query(`
        SELECT COUNT(*) as invalid_count 
        FROM reactions r 
        LEFT JOIN messages m ON r.message_id = m.id 
        WHERE m.id IS NULL
      `);
      const invalidReactions = reactionsCheck.values?.[0]?.invalid_count || 0;
      if (invalidReactions > 0) {
        issues.push(`${invalidReactions} reactions have invalid message_ids`);
      }

      // Check polls with invalid message_ids
      const pollsCheck = await db.query(`
        SELECT COUNT(*) as invalid_count 
        FROM polls p 
        LEFT JOIN messages m ON p.message_id = m.id 
        WHERE m.id IS NULL
      `);
      const invalidPolls = pollsCheck.values?.[0]?.invalid_count || 0;
      if (invalidPolls > 0) {
        issues.push(`${invalidPolls} polls have invalid message_ids`);
      }

      // Check confessions with invalid message_ids
      const confessionsCheck = await db.query(`
        SELECT COUNT(*) as invalid_count 
        FROM confessions c 
        LEFT JOIN messages m ON c.message_id = m.id 
        WHERE m.id IS NULL
      `);
      const invalidConfessions = confessionsCheck.values?.[0]?.invalid_count || 0;
      if (invalidConfessions > 0) {
        issues.push(`${invalidConfessions} confessions have invalid message_ids`);
      }

      return {
        valid: issues.length === 0,
        issues
      };
    } catch (error) {
      console.error('❌ Error checking data integrity:', error);
      return {
        valid: false,
        issues: ['Failed to check data integrity']
      };
    }
  }

  /**
   * Clean up orphaned reactions (reactions with no matching message)
   */
  public async cleanupOrphanedReactions(): Promise<number> {
    await this.dbManager.checkDatabaseReady();
    const db = this.dbManager.getConnection();

    try {
      const result = await db.run(`
        DELETE FROM reactions 
        WHERE message_id NOT IN (SELECT id FROM messages)
      `);
      const deletedCount = result.changes?.changes || 0;
      console.log(`🧹 Cleaned up ${deletedCount} orphaned reactions`);
      return deletedCount;
    } catch (error) {
      console.error('❌ Error cleaning up orphaned reactions:', error);
      return 0;
    }
  }

  /**
   * Clean up orphaned polls (polls with no matching message)
   */
  public async cleanupOrphanedPolls(): Promise<number> {
    await this.dbManager.checkDatabaseReady();
    const db = this.dbManager.getConnection();

    try {
      const result = await db.run(`
        DELETE FROM polls 
        WHERE message_id NOT IN (SELECT id FROM messages)
      `);
      const deletedCount = result.changes?.changes || 0;
      console.log(`🧹 Cleaned up ${deletedCount} orphaned polls`);
      return deletedCount;
    } catch (error) {
      console.error('❌ Error cleaning up orphaned polls:', error);
      return 0;
    }
  }

  /**
   * Clean up orphaned confessions (confessions with no matching message)
   */
  public async cleanupOrphanedConfessions(): Promise<number> {
    await this.dbManager.checkDatabaseReady();
    const db = this.dbManager.getConnection();

    try {
      const result = await db.run(`
        DELETE FROM confessions 
        WHERE message_id NOT IN (SELECT id FROM messages)
      `);
      const deletedCount = result.changes?.changes || 0;
      console.log(`🧹 Cleaned up ${deletedCount} orphaned confessions`);
      return deletedCount;
    } catch (error) {
      console.error('❌ Error cleaning up orphaned confessions:', error);
      return 0;
    }
  }

  /**
   * Clean up all orphaned data
   */
  public async cleanupAllOrphanedData(): Promise<{
    reactions: number;
    polls: number;
    confessions: number;
  }> {
    const reactions = await this.cleanupOrphanedReactions();
    const polls = await this.cleanupOrphanedPolls();
    const confessions = await this.cleanupOrphanedConfessions();

    return { reactions, polls, confessions };
  }
}
