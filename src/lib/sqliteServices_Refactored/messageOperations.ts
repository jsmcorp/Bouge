import { DatabaseManager } from './database';
import { LocalMessage } from './types';

export class MessageOperations {
  constructor(private dbManager: DatabaseManager) { }

  public async saveMessage(message: Omit<LocalMessage, 'local_id'>): Promise<void> {
    await this.dbManager.checkDatabaseReady();
    const db = this.dbManager.getConnection();

    await db.run(
      `INSERT OR REPLACE INTO messages
       (id, group_id, user_id, content, is_ghost, message_type, category, parent_id, image_url, created_at, updated_at, deleted_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?);`,
      [
        message.id,
        message.group_id,
        message.user_id,
        message.content,
        message.is_ghost,
        message.message_type,
        message.category,
        message.parent_id,
        message.image_url,
        message.created_at,
        message.updated_at || null,
        message.deleted_at || null
      ]
    );
  }

  public async getMessages(groupId: string, limit = 50, offset = 0): Promise<LocalMessage[]> {
    await this.dbManager.checkDatabaseReady();
    const db = this.dbManager.getConnection();

    const sql = `
      SELECT * FROM messages 
      WHERE group_id = ? 
      ORDER BY created_at ASC 
      LIMIT ? OFFSET ?
    `;

    const result = await db.query(sql, [groupId, limit, offset]);
    return result.values || [];
  }

  public async getAllMessagesForGroup(groupId: string): Promise<LocalMessage[]> {
    await this.dbManager.checkDatabaseReady();
    const db = this.dbManager.getConnection();

    const sql = `
      SELECT * FROM messages 
      WHERE group_id = ? 
      ORDER BY created_at DESC
    `;

    const result = await db.query(sql, [groupId]);
    return result.values || [];
  }

  public async getLatestMessageTimestamp(groupId: string): Promise<number> {
    await this.dbManager.checkDatabaseReady();
    const db = this.dbManager.getConnection();

    const sql = `
      SELECT MAX(created_at) as latest_timestamp 
      FROM messages 
      WHERE group_id = ?
    `;

    const result = await db.query(sql, [groupId]);
    return result.values?.[0]?.latest_timestamp || 0;
  }

  public async deleteMessage(messageId: string): Promise<void> {
    await this.dbManager.checkDatabaseReady();
    const db = this.dbManager.getConnection();

    try {
      await db.run('DELETE FROM messages WHERE id = ?', [messageId]);
      console.log(`🗑️ Deleted message: ${messageId}`);
    } catch (error) {
      console.error(`❌ Error deleting message ${messageId}:`, error);
      throw error;
    }
  }

  public async syncMessagesFromRemote(groupId: string, messages: Array<{
    id: string;
    group_id: string;
    user_id: string;
    content: string;
    is_ghost: boolean;
    message_type: string;
    category: string | null;
    parent_id: string | null;
    image_url: string | null;
    created_at: string | number;
    updated_at?: string | number | null;
    deleted_at?: string | number | null;
  }>): Promise<number> {
    await this.dbManager.checkDatabaseReady();

    console.log(`🔄 Syncing ${messages.length} messages for group ${groupId} to local storage`);

    let syncCount = 0;

    for (const message of messages) {
      try {
        const messageType = message.message_type || 'text';

        const localMessage: Omit<LocalMessage, 'local_id'> = {
          id: message.id,
          group_id: message.group_id,
          user_id: message.user_id,
          content: message.content,
          is_ghost: message.is_ghost ? 1 : 0,
          message_type: messageType,
          category: message.category || null,
          parent_id: message.parent_id || null,
          image_url: message.image_url || null,
          created_at: typeof message.created_at === 'string'
            ? new Date(message.created_at).getTime()
            : message.created_at,
          updated_at: message.updated_at ? (typeof message.updated_at === 'string'
            ? new Date(message.updated_at).getTime()
            : message.updated_at) : undefined,
          deleted_at: message.deleted_at ? (typeof message.deleted_at === 'string'
            ? new Date(message.deleted_at).getTime()
            : message.deleted_at) : undefined
        };

        await this.saveMessage(localMessage);
        syncCount++;
      } catch (error) {
        console.error(`❌ Error syncing message ${message.id}:`, error);
      }
    }

    await this.cleanupTempMessages(groupId, messages.map(m => m.id));

    console.log(`✅ Successfully synced ${syncCount} messages to local storage`);
    return syncCount;
  }

  private async cleanupTempMessages(groupId: string, serverMessageIds: string[]): Promise<void> {
    await this.dbManager.checkDatabaseReady();
    const db = this.dbManager.getConnection();

    try {
      const localMessages = await this.getMessages(groupId, 10000);
      const tempMessages = localMessages.filter(msg =>
        msg.id.startsWith('temp-') ||
        (msg.id.includes('-') && msg.id.match(/^\d{13}-[a-z0-9]+$/))
      );

      console.log(`🧹 Found ${tempMessages.length} temporary messages to potentially clean up`);

      for (const tempMsg of tempMessages) {
        if (!serverMessageIds.includes(tempMsg.id)) {
          try {
            await db.run('DELETE FROM messages WHERE id = ?', [tempMsg.id]);
            console.log(`🧹 Cleaned up temp message: ${tempMsg.id}`);
          } catch (error) {
            console.error(`❌ Error cleaning up temp message ${tempMsg.id}:`, error);
          }
        }
      }
    } catch (error) {
      console.error('❌ Error cleaning up temp messages:', error);
    }
  }
}