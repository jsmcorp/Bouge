import { DatabaseManager } from './database';
import { LocalGroupMember, LocalUserPseudonym } from './types';
import { sqliteMonitoring } from '../sqliteMonitoring';

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

    // 🔍 DIAGNOSTIC: Log the FULL query parameters
    console.log(`[sqlite-query] 🔍 getLocalLastReadAt called with:`, {
      groupId_full: groupId,
      groupId_short: groupId.slice(0, 8),
      groupId_length: groupId.length,
      userId_full: userId,
      userId_short: userId.slice(0, 8),
      userId_length: userId.length
    });

    const sql = `
      SELECT last_read_at FROM group_members
      WHERE group_id = ? AND user_id = ?
    `;

    const result = await db.query(sql, [groupId, userId]);
    
    console.log(`[sqlite-query] 🔍 Query result:`, {
      found: result.values && result.values.length > 0,
      rowCount: result.values?.length || 0,
      lastReadAt: result.values?.[0]?.last_read_at || null
    });
    
    // 🚨 DIAGNOSTIC: If NOT FOUND, show ALL rows to debug parameter mismatch
    if (!result.values || result.values.length === 0) {
      console.warn(`[sqlite-query] ⚠️ NOT FOUND! Showing all rows for comparison:`);
      const allRows = await db.query(`SELECT group_id, user_id, last_read_at FROM group_members`);
      if (allRows.values && allRows.values.length > 0) {
        allRows.values.forEach((row: any, idx: number) => {
          const groupMatch = row.group_id === groupId;
          const userMatch = row.user_id === userId;
          console.log(`[sqlite-query] 📋 Row ${idx + 1}:`, {
            group_id: row.group_id,
            group_match: groupMatch ? '✅' : '❌',
            user_id: row.user_id,
            user_match: userMatch ? '✅' : '❌',
            last_read_at: row.last_read_at
          });
        });
      } else {
        console.warn(`[sqlite-query] ⚠️ Table is EMPTY!`);
      }
    }
    
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
    
    // Optimized: Single query to check both parent rows
    const parentCheck = await db.query(`
      SELECT 
        (SELECT COUNT(*) FROM groups WHERE id = ?) as group_exists,
        (SELECT COUNT(*) FROM users WHERE id = ?) as user_exists
    `, [groupId, userId]);
    
    const groupExists = parentCheck.values?.[0]?.group_exists > 0;
    const userExists = parentCheck.values?.[0]?.user_exists > 0;
    
    if (!groupExists) {
      console.warn(`[sqlite] ⚠️ Group ${groupId.slice(0, 8)} not in SQLite yet, skipping sync from Supabase (will retry later)`);
      // Track as potential FK error (prevented)
      sqliteMonitoring.trackFKError({
        operation: 'syncReadStatusFromSupabase',
        groupId,
        userId,
        errorCode: 787 // FK constraint error code (prevented)
      });
      return; // Skip - group not saved yet
    }
    
    if (!userExists) {
      console.warn(`[sqlite] ⚠️ User ${userId.slice(0, 8)} not in SQLite yet, skipping sync from Supabase (will retry later)`);
      console.warn(`[sqlite] 💡 TIP: Current user should be saved during first-time init Step 0`);
      // Track as potential FK error (prevented)
      sqliteMonitoring.trackFKError({
        operation: 'syncReadStatusFromSupabase',
        groupId,
        userId,
        errorCode: 787 // FK constraint error code (prevented)
      });
      return; // Skip - user not saved yet, prevents FK constraint error
    }

    // ✅ FIX: Check if row exists AND get current timestamp to prevent stale data overwrites
    const checkSql = `SELECT role, joined_at, last_read_at, last_read_message_id FROM group_members WHERE group_id = ? AND user_id = ?`;
    const existing = await db.query(checkSql, [groupId, userId]);
    
    if (existing.values && existing.values.length > 0) {
      // Row exists - check if Supabase data is newer than local
      const localLastReadAt = existing.values[0].last_read_at || 0;
      const supabaseLastReadAt = lastReadAt || 0;
      
      console.log(`[sqlite] 🔍 Timestamp comparison: local=${localLastReadAt}, supabase=${supabaseLastReadAt}`);
      
      // ✅ Only update if Supabase data is NEWER than local
      if (supabaseLastReadAt > localLastReadAt) {
        await db.run(
          `UPDATE group_members 
           SET last_read_at = ?, last_read_message_id = ?
           WHERE group_id = ? AND user_id = ?;`,
          [lastReadAt, lastReadMessageId, groupId, userId]
        );
        console.log('[sqlite] ✅ Updated existing group_members row from Supabase (newer data)');
      } else {
        console.log('[sqlite] ⏭️ Skipping Supabase sync - local data is newer or equal');
        console.log(`[sqlite] 💡 Local: ${new Date(localLastReadAt).toISOString()}, Supabase: ${new Date(supabaseLastReadAt).toISOString()}`);
      }
    } else {
      // Row doesn't exist, create it with default values
      await db.run(
        `INSERT INTO group_members (group_id, user_id, role, joined_at, last_read_at, last_read_message_id)
         VALUES (?, ?, 'participant', ?, ?, ?);`,
        [groupId, userId, Date.now(), lastReadAt, lastReadMessageId]
      );
      console.log('[sqlite] ✅ Created new group_members row during sync from Supabase');
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
    
    // Optimized: Single query to check both parent rows
    const parentCheck = await db.query(`
      SELECT 
        (SELECT COUNT(*) FROM groups WHERE id = ?) as group_exists,
        (SELECT COUNT(*) FROM users WHERE id = ?) as user_exists
    `, [groupId, userId]);
    
    const groupExists = parentCheck.values?.[0]?.group_exists > 0;
    const userExists = parentCheck.values?.[0]?.user_exists > 0;
    
    if (!groupExists) {
      console.warn(`[sqlite] ⚠️ Group ${groupId.slice(0, 8)} not in SQLite yet, skipping group_members creation (will retry later)`);
      // Track as potential FK error (prevented)
      sqliteMonitoring.trackFKError({
        operation: 'updateLocalLastReadAt',
        groupId,
        userId,
        errorCode: 787 // FK constraint error code (prevented)
      });
      return; // Skip - group not saved yet
    }
    
    if (!userExists) {
      console.warn(`[sqlite] ⚠️ User ${userId.slice(0, 8)} not in SQLite yet, skipping group_members creation (will retry later)`);
      console.warn(`[sqlite] 💡 TIP: Current user should be saved during first-time init Step 0`);
      // Track as potential FK error (prevented)
      sqliteMonitoring.trackFKError({
        operation: 'updateLocalLastReadAt',
        groupId,
        userId,
        errorCode: 787 // FK constraint error code (prevented)
      });
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
      console.log('[sqlite] ✅ Updated existing group_members row');
      
      // VERIFY: Check if update was successful
      const verify = await db.query(
        `SELECT last_read_at, last_read_message_id FROM group_members WHERE group_id = ? AND user_id = ?`,
        [groupId, userId]
      );
      
      if (verify.values && verify.values.length > 0) {
        const savedReadAt = verify.values[0].last_read_at;
        const savedMessageId = verify.values[0].last_read_message_id;
        console.log('[sqlite] ✅ VERIFIED: Update successful:', {
          last_read_at: savedReadAt,
          last_read_message_id: savedMessageId,
          matches: savedReadAt === lastReadAt && savedMessageId === lastReadMessageId
        });
        
        // ✅ CHECKPOINT REMOVED: Immediate checkpoints cause lock contention (SQLITE_LOCKED)
        // Data is safely stored in WAL buffer and will be checkpointed:
        // 1. When app backgrounds (AppLifecycleManager)
        // 2. After bulk operations complete
        // 3. When WAL size exceeds threshold
        // Verification queries read from WAL, so data is immediately visible
      } else {
        console.error('[sqlite] ❌ VERIFICATION FAILED: Row disappeared after UPDATE!');
      }
    } else {
      // Row doesn't exist, create it with default values
      await db.run(
        `INSERT INTO group_members (group_id, user_id, role, joined_at, last_read_at, last_read_message_id)
         VALUES (?, ?, 'participant', ?, ?, ?);`,
        [groupId, userId, Date.now(), lastReadAt, lastReadMessageId]
      );
      console.log('[sqlite] ✅ Created new group_members row for read status');
      
      // VERIFY: Immediately check if row was actually saved
      const verify = await db.query(
        `SELECT * FROM group_members WHERE group_id = ? AND user_id = ?`,
        [groupId, userId]
      );
      
      if (verify.values && verify.values.length > 0) {
        console.log('[sqlite] ✅ VERIFIED: Row exists in database after INSERT:', {
          last_read_at: verify.values[0].last_read_at,
          last_read_message_id: verify.values[0].last_read_message_id
        });
        
        // ✅ CHECKPOINT REMOVED: Immediate checkpoints cause lock contention (SQLITE_LOCKED)
        // Data is safely stored in WAL buffer and will be checkpointed:
        // 1. When app backgrounds (AppLifecycleManager)
        // 2. After bulk operations complete
        // 3. When WAL size exceeds threshold
        // Verification queries read from WAL, so data is immediately visible
      } else {
        console.error('[sqlite] ❌ VERIFICATION FAILED: Row NOT found after INSERT!');
        console.error('[sqlite] ❌ This indicates a persistence or transaction issue');
      }
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