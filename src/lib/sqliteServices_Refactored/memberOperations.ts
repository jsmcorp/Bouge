import { DatabaseManager } from './database';
import { LocalGroupMember, LocalUserPseudonym } from './types';

export class MemberOperations {
  constructor(private dbManager: DatabaseManager) {}

  public async saveGroupMember(member: LocalGroupMember): Promise<void> {
    await this.dbManager.checkDatabaseReady();
    const db = this.dbManager.getConnection();

    await db.run(
      `INSERT OR REPLACE INTO group_members (group_id, user_id, role, joined_at)
       VALUES (?, ?, ?, ?);`,
      [
        member.group_id,
        member.user_id,
        member.role,
        member.joined_at
      ]
    );
  }

  public async getGroupMembers(groupId: string): Promise<LocalGroupMember[]> {
    await this.dbManager.checkDatabaseReady();
    const db = this.dbManager.getConnection();

    const sql = `
      SELECT * FROM group_members 
      WHERE group_id = ?
      ORDER BY joined_at ASC
    `;

    const result = await db.query(sql, [groupId]);
    return result.values || [];
  }

  public async saveUserPseudonym(pseudonym: LocalUserPseudonym): Promise<void> {
    await this.dbManager.checkDatabaseReady();
    const db = this.dbManager.getConnection();

    await db.run(
      `INSERT OR REPLACE INTO user_pseudonyms (group_id, user_id, pseudonym, created_at)
       VALUES (?, ?, ?, ?);`,
      [
        pseudonym.group_id,
        pseudonym.user_id,
        pseudonym.pseudonym,
        pseudonym.created_at
      ]
    );
  }

  public async getUserPseudonyms(groupId: string): Promise<LocalUserPseudonym[]> {
    await this.dbManager.checkDatabaseReady();
    const db = this.dbManager.getConnection();

    const sql = `
      SELECT * FROM user_pseudonyms
      WHERE group_id = ?
    `;

    const result = await db.query(sql, [groupId]);
    return result.values || [];
  }

  public async deleteGroupMember(groupId: string, userId: string): Promise<void> {
    await this.dbManager.checkDatabaseReady();
    const db = this.dbManager.getConnection();

    await db.run(
      `DELETE FROM group_members WHERE group_id = ? AND user_id = ?;`,
      [groupId, userId]
    );
  }

  public async updateGroupMemberRole(groupId: string, userId: string, role: string): Promise<void> {
    await this.dbManager.checkDatabaseReady();
    const db = this.dbManager.getConnection();

    await db.run(
      `UPDATE group_members SET role = ? WHERE group_id = ? AND user_id = ?;`,
      [role, groupId, userId]
    );
  }

  /**
   * Get the local last_read_at timestamp for a user in a group
   * Returns null if no record exists
   */
  public async getLocalLastReadAt(groupId: string, userId: string): Promise<number | null> {
    await this.dbManager.checkDatabaseReady();
    const db = this.dbManager.getConnection();

    const sql = `
      SELECT last_read_at FROM group_members
      WHERE group_id = ? AND user_id = ?
    `;

    const result = await db.query(sql, [groupId, userId]);
    
    if (result.values && result.values.length > 0) {
      const lastReadAt = result.values[0].last_read_at;
      return lastReadAt || 0; // Return 0 if null/undefined, meaning never read
    }
    
    return null; // No record exists
  }

  /**
   * Sync read status from Supabase to local SQLite
   * Uses INSERT OR REPLACE to handle cases where the row doesn't exist yet
   */
  public async syncReadStatusFromSupabase(
    groupId: string,
    userId: string,
    lastReadAt: number,
    lastReadMessageId: string | null
  ): Promise<void> {
    await this.dbManager.checkDatabaseReady();
    const db = this.dbManager.getConnection();

    // ✅ FIX: Check if BOTH parent rows exist to prevent FK constraint errors
    // group_members has TWO foreign keys: group_id → groups(id) AND user_id → users(id)
    
    // Check #1: Group exists
    const groupCheck = await db.query(
      `SELECT id FROM groups WHERE id = ?`,
      [groupId]
    );
    
    if (!groupCheck.values || groupCheck.values.length === 0) {
      console.warn(`[sqlite] ⚠️ Group ${groupId.slice(0, 8)} not in SQLite yet, skipping sync from Supabase (will retry later)`);
      return; // Skip - group not saved yet
    }

    // Check #2: User exists (CRITICAL - this is usually the missing one!)
    const userCheck = await db.query(
      `SELECT id FROM users WHERE id = ?`,
      [userId]
    );
    
    if (!userCheck.values || userCheck.values.length === 0) {
      console.warn(`[sqlite] ⚠️ User ${userId.slice(0, 8)} not in SQLite yet, skipping sync from Supabase (will retry later)`);
      console.warn(`[sqlite] 💡 TIP: Current user should be saved during first-time init Step 0`);
      return; // Skip - user not saved yet, prevents FK constraint error
    }

    // First check if row exists
    const checkSql = `SELECT role, joined_at FROM group_members WHERE group_id = ? AND user_id = ?`;
    const existing = await db.query(checkSql, [groupId, userId]);
    
    if (existing.values && existing.values.length > 0) {
      // Row exists, just update the read status
      await db.run(
        `UPDATE group_members 
         SET last_read_at = ?, last_read_message_id = ?
         WHERE group_id = ? AND user_id = ?;`,
        [lastReadAt, lastReadMessageId, groupId, userId]
      );
    } else {
      // Row doesn't exist, create it with default values
      await db.run(
        `INSERT INTO group_members (group_id, user_id, role, joined_at, last_read_at, last_read_message_id)
         VALUES (?, ?, 'participant', ?, ?, ?);`,
        [groupId, userId, Date.now(), lastReadAt, lastReadMessageId]
      );
      console.log('[sqlite] ℹ️ Created new group_members row during sync from Supabase');
    }
    
    console.log('[sqlite] ✅ Synced read status from Supabase:', {
      groupId: groupId.slice(0, 8),
      userId: userId.slice(0, 8),
      lastReadAt: new Date(lastReadAt).toISOString()
    });
  }

  /**
   * Update local last_read_at when marking as read
   * Uses INSERT OR REPLACE to handle cases where the row doesn't exist yet
   */
  public async updateLocalLastReadAt(
    groupId: string,
    userId: string,
    lastReadAt: number,
    lastReadMessageId: string
  ): Promise<void> {
    await this.dbManager.checkDatabaseReady();
    const db = this.dbManager.getConnection();

    // ✅ FIX: Check if BOTH parent rows exist to prevent FK constraint errors
    // group_members has TWO foreign keys: group_id → groups(id) AND user_id → users(id)
    
    // Check #1: Group exists
    const groupCheck = await db.query(
      `SELECT id FROM groups WHERE id = ?`,
      [groupId]
    );
    
    if (!groupCheck.values || groupCheck.values.length === 0) {
      console.warn(`[sqlite] ⚠️ Group ${groupId.slice(0, 8)} not in SQLite yet, skipping group_members creation (will retry later)`);
      return; // Skip - group not saved yet
    }

    // Check #2: User exists (CRITICAL - this is usually the missing one!)
    const userCheck = await db.query(
      `SELECT id FROM users WHERE id = ?`,
      [userId]
    );
    
    if (!userCheck.values || userCheck.values.length === 0) {
      console.warn(`[sqlite] ⚠️ User ${userId.slice(0, 8)} not in SQLite yet, skipping group_members creation (will retry later)`);
      console.warn(`[sqlite] 💡 TIP: Current user should be saved during first-time init Step 0`);
      return; // Skip - user not saved yet, prevents FK constraint error
    }

    // First check if row exists
    const checkSql = `SELECT role, joined_at FROM group_members WHERE group_id = ? AND user_id = ?`;
    const existing = await db.query(checkSql, [groupId, userId]);
    
    if (existing.values && existing.values.length > 0) {
      // Row exists, just update the read status
      await db.run(
        `UPDATE group_members 
         SET last_read_at = ?, last_read_message_id = ?
         WHERE group_id = ? AND user_id = ?;`,
        [lastReadAt, lastReadMessageId, groupId, userId]
      );
    } else {
      // Row doesn't exist, create it with default values
      await db.run(
        `INSERT INTO group_members (group_id, user_id, role, joined_at, last_read_at, last_read_message_id)
         VALUES (?, ?, 'participant', ?, ?, ?);`,
        [groupId, userId, Date.now(), lastReadAt, lastReadMessageId]
      );
      console.log('[sqlite] ℹ️ Created new group_members row for read status');
    }
    
    console.log('[sqlite] ✅ Updated local read status:', {
      groupId: groupId.slice(0, 8),
      userId: userId.slice(0, 8),
      lastReadAt: new Date(lastReadAt).toISOString(),
      messageId: lastReadMessageId.slice(0, 8)
    });
  }

  /**
   * Get the local last_read_message_id for a user in a group
   * Returns the message ID that was last marked as read
   */
  public async getLocalLastReadMessageId(groupId: string, userId: string): Promise<string | null> {
    await this.dbManager.checkDatabaseReady();
    const db = this.dbManager.getConnection();

    const sql = `
      SELECT last_read_message_id FROM group_members
      WHERE group_id = ? AND user_id = ?
    `;

    const result = await db.query(sql, [groupId, userId]);
    
    if (result.values && result.values.length > 0) {
      return result.values[0].last_read_message_id || null;
    }
    
    return null;
  }

  /**
   * Calculate first unread message using MESSAGE ID (not timestamp)
   * 
   * CORRECT Logic:
   * 1. Get last_read_message_id from local SQLite
   * 2. Find that message in the loaded messages
   * 3. Show separator BELOW that message (first unread = next message after it)
   * 4. If no last_read_message_id → First time → NO separator
   */
  public async calculateFirstUnreadLocal(
    groupId: string,
    userId: string,
    messages: Array<{ id: string; created_at: number; user_id: string }>
  ): Promise<{ firstUnreadId: string | null; unreadCount: number }> {
    // Get the last read message ID from local SQLite
    const lastReadMessageId = await this.getLocalLastReadMessageId(groupId, userId);
    
    console.log(`[unread] 📊 LOCAL: last_read_message_id=${lastReadMessageId || 'null (FIRST TIME)'}, total messages=${messages.length}`);
    
    // If no last_read_message_id, this is FIRST TIME opening chat
    // Don't show separator
    if (!lastReadMessageId) {
      console.log(`[unread] 📊 FIRST TIME - NO separator`);
      return {
        firstUnreadId: null,
        unreadCount: 0
      };
    }
    
    // Find the last read message in the loaded messages
    const lastReadIndex = messages.findIndex(msg => msg.id === lastReadMessageId);
    
    console.log(`[unread] 📊 Last read message "${lastReadMessageId.slice(0, 8)}" found at index: ${lastReadIndex}`);
    
    if (lastReadIndex === -1) {
      console.log(`[unread] ⚠️ Last read message NOT in loaded messages (older than shown), showing all as unread`);
      // Last read message is older than the loaded messages
      // This means all loaded messages are unread
      const unreadMessages = messages.filter(msg => msg.user_id !== userId);
      return {
        firstUnreadId: unreadMessages.length > 0 ? unreadMessages[0].id : null,
        unreadCount: unreadMessages.length
      };
    }
    
    // Separator shows BELOW the last read message
    // First unread = the message AFTER the last read message
    const messagesAfterLastRead = messages.slice(lastReadIndex + 1);
    const unreadMessages = messagesAfterLastRead.filter(msg => msg.user_id !== userId);
    
    console.log(`[unread] 📊 Messages after last read: ${messagesAfterLastRead.length}, unread: ${unreadMessages.length}`);
    
    if (unreadMessages.length > 0) {
      console.log(`[unread] 📊 Separator will show BELOW message: ${lastReadMessageId.slice(0, 8)}`);
      console.log(`[unread] 📊 First unread message: ${unreadMessages[0].id.slice(0, 8)}`);
    } else {
      console.log(`[unread] 📊 No unread messages after last read`);
    }
    
    return {
      firstUnreadId: unreadMessages.length > 0 ? unreadMessages[0].id : null,
      unreadCount: unreadMessages.length
    };
  }

  /**
   * Get all local read statuses for a user (for syncing to Supabase)
   */
  public async getAllLocalReadStatus(userId: string): Promise<Array<{
    group_id: string;
    last_read_at: number;
    last_read_message_id: string | null;
  }>> {
    await this.dbManager.checkDatabaseReady();
    const db = this.dbManager.getConnection();

    const sql = `
      SELECT group_id, last_read_at, last_read_message_id
      FROM group_members
      WHERE user_id = ? AND last_read_at IS NOT NULL AND last_read_at > 0
    `;

    const result = await db.query(sql, [userId]);
    return result.values || [];
  }
}