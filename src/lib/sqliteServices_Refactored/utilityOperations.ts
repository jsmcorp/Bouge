import { DatabaseManager } from './database';
import { StorageStats } from './types';

export class UtilityOperations {
  constructor(private dbManager: DatabaseManager) {}

  public async clearAllData(): Promise<void> {
    await this.dbManager.checkDatabaseReady();
    const db = this.dbManager.getConnection();

    const tables = ['messages', 'groups', 'users', 'outbox', 'sync_state'];
    
    for (const table of tables) {
      await db.run(`DELETE FROM ${table}`);
    }

    console.log('🗑️ All local data cleared');
  }

  public async getStorageStats(): Promise<StorageStats> {
    await this.dbManager.checkDatabaseReady();
    const db = this.dbManager.getConnection();

    const [messages, groups, users, outbox, polls, reactions, groupMembers, confessions] = await Promise.all([
      db.query('SELECT COUNT(*) as count FROM messages'),
      db.query('SELECT COUNT(*) as count FROM groups'),
      db.query('SELECT COUNT(*) as count FROM users'),
      db.query('SELECT COUNT(*) as count FROM outbox'),
      db.query('SELECT COUNT(*) as count FROM polls'),
      db.query('SELECT COUNT(*) as count FROM reactions'),
      db.query('SELECT COUNT(*) as count FROM group_members'),
      db.query('SELECT COUNT(*) as count FROM confessions')
    ]);

    return {
      messageCount: messages.values?.[0]?.count || 0,
      groupCount: groups.values?.[0]?.count || 0,
      userCount: users.values?.[0]?.count || 0,
      outboxCount: outbox.values?.[0]?.count || 0,
      pollCount: polls.values?.[0]?.count || 0,
      reactionCount: reactions.values?.[0]?.count || 0,
      groupMemberCount: groupMembers.values?.[0]?.count || 0,
      confessionCount: confessions.values?.[0]?.count || 0
    };
  }
}