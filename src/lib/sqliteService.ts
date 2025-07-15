import { CapacitorSQLite, SQLiteConnection, SQLiteDBConnection } from '@capacitor-community/sqlite';
import { Capacitor } from '@capacitor/core';
import { initEncryptionSecret } from './sqliteSecret';
  

export interface LocalMessage {
  id: string;
  group_id: string;
  user_id: string;
  content: string;
  is_ghost: number; // SQLite uses INTEGER for boolean
  message_type: string;
  created_at: number; // Unix timestamp
  local_id?: number; // Auto-increment unique ID
}

export interface LocalGroup {
  id: string;
  name: string;
  last_sync_timestamp: number;
}

export interface LocalUser {
  id: string;
  display_name: string;
}

export interface OutboxMessage {
  id?: number;
  group_id: string;
  user_id: string;
  content: string;
  retry_count: number;
  next_retry_at: number;
}

export interface SyncState {
  key: string;
  value: string;
}

class SQLiteService {
  private static instance: SQLiteService;
  private sqlite: SQLiteConnection;
  private db: SQLiteDBConnection | null = null;
  private isInitialized = false;
  private readonly dbName = 'confessr_db';  // Simple name without encryption suffix
  private readonly dbVersion = 1;

  private constructor() {
    this.sqlite = new SQLiteConnection(CapacitorSQLite);
  }

  public static getInstance(): SQLiteService {
    if (!SQLiteService.instance) SQLiteService.instance = new SQLiteService();
    return SQLiteService.instance;
  }

  public async initialize(): Promise<void> {
    if (this.isInitialized) return;

    if (!Capacitor.isNativePlatform()) {
      console.warn('⚠️ SQLite runs only on native platforms');
      return;
    }

    try {
      console.log('🗄️ Initializing SQLite database...');

      /* 1️⃣ ensure passphrase */
      try {
        await initEncryptionSecret();
      } catch (error: any) {
        // Log the error but continue - the key might already be set
        console.warn('⚠️ Encryption key setup issue:', error.message);
        console.log('🔄 Continuing SQLite initialization...');
      }

      /* 2️⃣ Check if database exists */
      const dbExists = await this.sqlite.isDatabase(this.dbName);
      console.log(`Database exists check: ${dbExists.result}`);

      if (!dbExists.result) {
        /* 3️⃣ Create unencrypted database first */
        console.log('📁 Database does not exist, creating unencrypted database first...');
        try {
          // Create connection without encryption
          const unencryptedConn = await this.sqlite.createConnection(
            this.dbName,
            false,  // not encrypted
            'no-encryption',  // mode for unencrypted database
            this.dbVersion,
            false  // not readonly
          );
          
          // Open the unencrypted database
          await unencryptedConn.open();
          console.log('✅ Unencrypted database created');
          
          // Close the unencrypted connection
          await unencryptedConn.close();
          console.log('✅ Unencrypted connection closed');
          
          /* 4️⃣ Now encrypt the database */
          console.log('🔐 Encrypting database...');
          const encryptConn = await this.sqlite.createConnection(
            this.dbName,
            true,  // encrypted
            'encryption',  // mode to encrypt existing database
            this.dbVersion,
            false  // not readonly
          );
          
          // Open to encrypt the database
          await encryptConn.open();
          console.log('✅ Database encrypted successfully');
          
          // Close the encryption connection
          await encryptConn.close();
          console.log('✅ Encryption connection closed');
        } catch (error: any) {
          console.error('❌ Error creating/encrypting database:', error);
          throw new Error(`Failed to create/encrypt database: ${error.message || error}`);
        }
      }
      
      /* 5️⃣ Open the encrypted database with secret mode */
      try {
        console.log('🔓 Opening encrypted database with secret mode...');
        const conn = await this.sqlite.createConnection(
          this.dbName,
          true,  // encrypted
          'secret',  // mode for accessing encrypted database
          this.dbVersion,
          false  // not readonly
        );
        
        // Open the encrypted database
        await conn.open();
        this.db = conn;
        console.log('✅ Encrypted database opened successfully');
        
        /* 6️⃣ security pragma */
        await this.db.execute('PRAGMA cipher_memory_security = ON;');
        console.log('✅ Security pragma set');
        
        /* 7️⃣ Create tables in the encrypted database */
        console.log('📊 Creating tables in encrypted database...');
        await this.createTablesWithConnection(this.db);
        console.log('✅ Tables created in encrypted database');
        
        this.isInitialized = true;
        console.log('✅ Encrypted SQLite ready');
        
        // Run a test to verify the database is working
        await this.testLocalStorage();
      } catch (error: any) {
        console.error('❌ Error opening encrypted database:', error);
        throw new Error(`Failed to open encrypted database: ${error.message || error}`);
      }
    } catch (err) {
      console.error('💥 SQLite init failed:', err);
      throw err;
    }
  }
  
  /**
   * Test function to verify local storage is working by writing and reading data
   */
  private async testLocalStorage(): Promise<void> {
    try {
      console.log('🧪 Testing local storage...');
      
      // Test user data
      const testUser: LocalUser = {
        id: 'test-user-id',
        display_name: 'Test User'
      };
      
      // Save test user
      await this.saveUser(testUser);
      console.log('✅ Test user saved');
      
      // Retrieve test user
      const retrievedUser = await this.getUser(testUser.id);
      console.log('📋 Retrieved user:', retrievedUser);
      
      if (retrievedUser && retrievedUser.id === testUser.id) {
        console.log('✅ Local storage test passed! Data was successfully saved and retrieved.');
      } else {
        console.error('❌ Local storage test failed! Retrieved data does not match saved data.');
      }
      
      // Test message data
      const testMessage: Omit<LocalMessage, 'local_id'> = {
        id: 'test-message-id',
        group_id: 'test-group-id',
        user_id: 'test-user-id',
        content: 'Test message content',
        is_ghost: 0,
        message_type: 'text',
        created_at: Date.now()
      };
      
      // Save test message
      await this.saveMessage(testMessage);
      console.log('✅ Test message saved');
      
      // Retrieve test message
      const messages = await this.getMessages(testMessage.group_id);
      console.log('📋 Retrieved messages:', messages);
      
      if (messages.length > 0 && messages.some(m => m.id === testMessage.id)) {
        console.log('✅ Message storage test passed! Message was successfully saved and retrieved.');
      } else {
        console.error('❌ Message storage test failed! Could not retrieve the saved message.');
      }
      
    } catch (error) {
      console.error('❌ Local storage test failed with error:', error);
    }
  }

  private async createTablesWithConnection(connection: SQLiteDBConnection): Promise<void> {
    const sql = `
      CREATE TABLE IF NOT EXISTS messages (
        id TEXT PRIMARY KEY,
        group_id TEXT NOT NULL,
        user_id TEXT NOT NULL,
        content TEXT NOT NULL,
        is_ghost INTEGER DEFAULT 0,
        message_type TEXT DEFAULT 'text',
        created_at INTEGER NOT NULL,
        local_id INTEGER UNIQUE
      );

      CREATE TABLE IF NOT EXISTS groups (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        last_sync_timestamp INTEGER DEFAULT 0
      );

      CREATE TABLE IF NOT EXISTS users (
        id TEXT PRIMARY KEY,
        display_name TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS outbox (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        group_id TEXT NOT NULL,
        user_id TEXT NOT NULL,
        content TEXT NOT NULL,
        retry_count INTEGER DEFAULT 0,
        next_retry_at INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS sync_state (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );

      /* indexes */
      CREATE INDEX IF NOT EXISTS idx_msg_group_date_asc
        ON messages(group_id, created_at ASC);
      CREATE INDEX IF NOT EXISTS idx_msg_group_date_desc
        ON messages(group_id, created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_outbox_retry
        ON outbox(next_retry_at);
    `;

    await connection.execute(sql);
  }

  public async isReady(): Promise<boolean> {
    return this.isInitialized && this.db !== null;
  }

  /**
   * Checks if the database is properly initialized and ready for use.
   * Throws an error if not ready.
   */
  public async checkDatabaseReady(): Promise<void> {
    if (!this.isInitialized || !this.db) {
      try {
        // Try to initialize if not already done
        await this.initialize();
      } catch (error: any) {
        throw new Error(`Database not ready: ${error.message || error}`);
      }
      
      // Double check initialization succeeded
      if (!this.isInitialized || !this.db) {
        throw new Error('Database failed to initialize');
      }
    }
  }

  // Message operations
  public async saveMessage(message: Omit<LocalMessage, 'local_id'>): Promise<void> {
    await this.checkDatabaseReady();

    await this.db!.run(
      `INSERT OR REPLACE INTO messages
       (id, group_id, user_id, content, is_ghost, message_type, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?);`,
      [
        message.id,
        message.group_id,
        message.user_id,
        message.content,
        message.is_ghost ? 1 : 0,
        message.message_type,
        message.created_at,
      ]
    );
  }

  public async getMessages(groupId: string, limit = 50, offset = 0): Promise<LocalMessage[]> {
    await this.checkDatabaseReady();

    const sql = `
      SELECT * FROM messages 
      WHERE group_id = ? 
      ORDER BY created_at DESC 
      LIMIT ? OFFSET ?
    `;

    const result = await this.db!.query(sql, [groupId, limit, offset]);
    // Reverse the result to maintain chronological order (oldest to newest) for UI display
    return result.values ? [...result.values].reverse() : [];
  }

  public async getLatestMessageTimestamp(groupId: string): Promise<number> {
    await this.checkDatabaseReady();

    const sql = `
      SELECT MAX(created_at) as latest_timestamp 
      FROM messages 
      WHERE group_id = ?
    `;

    const result = await this.db!.query(sql, [groupId]);
    return result.values?.[0]?.latest_timestamp || 0;
  }

  // Group operations
  public async saveGroup(group: LocalGroup): Promise<void> {
    await this.checkDatabaseReady();

    const sql = `
      INSERT OR REPLACE INTO groups (id, name, last_sync_timestamp)
      VALUES (?, ?, ?)
    `;

    await this.db!.run(sql, [group.id, group.name, group.last_sync_timestamp]);
  }

  public async getGroups(): Promise<LocalGroup[]> {
    await this.checkDatabaseReady();

    const result = await this.db!.query('SELECT * FROM groups ORDER BY name');
    return result.values || [];
  }

  // User operations
  public async saveUser(user: LocalUser): Promise<void> {
    await this.checkDatabaseReady();

    const sql = `
      INSERT OR REPLACE INTO users (id, display_name)
      VALUES (?, ?)
    `;

    await this.db!.run(sql, [user.id, user.display_name]);
  }

  public async getUser(userId: string): Promise<LocalUser | null> {
    await this.checkDatabaseReady();

    const result = await this.db!.query('SELECT * FROM users WHERE id = ?', [userId]);
    return result.values?.[0] || null;
  }

  // Outbox operations for offline support
  public async addToOutbox(message: Omit<OutboxMessage, 'id'>): Promise<void> {
    await this.checkDatabaseReady();

    const sql = `
      INSERT INTO outbox (group_id, user_id, content, retry_count, next_retry_at)
      VALUES (?, ?, ?, ?, ?)
    `;

    await this.db!.run(sql, [
      message.group_id,
      message.user_id,
      message.content,
      message.retry_count,
      message.next_retry_at
    ]);
  }

  public async getOutboxMessages(): Promise<OutboxMessage[]> {
    await this.checkDatabaseReady();

    const sql = `
      SELECT * FROM outbox 
      WHERE next_retry_at <= ? 
      ORDER BY next_retry_at ASC
    `;

    const now = Date.now();
    const result = await this.db!.query(sql, [now]);
    return result.values || [];
  }

  public async removeFromOutbox(id: number): Promise<void> {
    await this.checkDatabaseReady();

    await this.db!.run('DELETE FROM outbox WHERE id = ?', [id]);
  }

  public async updateOutboxRetry(id: number, retryCount: number, nextRetryAt: number): Promise<void> {
    await this.checkDatabaseReady();

    const sql = `
      UPDATE outbox 
      SET retry_count = ?, next_retry_at = ? 
      WHERE id = ?
    `;

    await this.db!.run(sql, [retryCount, nextRetryAt, id]);
  }

  // Sync state operations
  public async setSyncState(key: string, value: string): Promise<void> {
    await this.checkDatabaseReady();

    const sql = `
      INSERT OR REPLACE INTO sync_state (key, value)
      VALUES (?, ?)
    `;

    await this.db!.run(sql, [key, value]);
  }

  public async getSyncState(key: string): Promise<string | null> {
    await this.checkDatabaseReady();

    const result = await this.db!.query('SELECT value FROM sync_state WHERE key = ?', [key]);
    return result.values?.[0]?.value || null;
  }

  /**
   * Syncs messages from remote (Supabase) to local storage
   * @param groupId The group ID to sync messages for
   * @param messages The messages from remote storage
   * @returns The number of messages synced
   */
  public async syncMessagesFromRemote(groupId: string, messages: Array<{
    id: string;
    group_id: string;
    user_id: string;
    content: string;
    is_ghost: boolean;
    message_type: string;
    created_at: string | number;
  }>): Promise<number> {
    await this.checkDatabaseReady();
    
    console.log(`🔄 Syncing ${messages.length} messages for group ${groupId} to local storage`);
    
    // Get the latest message timestamp we have locally
    const latestLocalTimestamp = await this.getLatestMessageTimestamp(groupId);
    console.log(`📊 Latest local message timestamp: ${new Date(latestLocalTimestamp).toISOString()}`);
    
    // Filter for new messages only to avoid duplicates
    const newMessages = messages.filter(msg => {
      const msgTimestamp = typeof msg.created_at === 'string' 
        ? new Date(msg.created_at).getTime() 
        : msg.created_at;
      
      // Keep messages that are newer than our latest local timestamp
      return msgTimestamp > latestLocalTimestamp;
    });
    
    console.log(`📥 Found ${newMessages.length} new messages to sync to local storage`);
    
    let syncCount = 0;
    
    for (const message of newMessages) {
      try {
        // Convert to local message format
        const localMessage: Omit<LocalMessage, 'local_id'> = {
          id: message.id,
          group_id: message.group_id,
          user_id: message.user_id,
          content: message.content,
          is_ghost: message.is_ghost ? 1 : 0,
          message_type: message.message_type,
          created_at: typeof message.created_at === 'string' 
            ? new Date(message.created_at).getTime() 
            : message.created_at
        };
        
        // Save to local storage
        await this.saveMessage(localMessage);
        syncCount++;
      } catch (error) {
        console.error(`❌ Error syncing message ${message.id}:`, error);
      }
    }
    
    // Update the last sync timestamp for this group
    const now = Date.now();
    await this.saveGroup({
      id: groupId,
      name: 'Group ' + groupId, // Default name if not provided
      last_sync_timestamp: now
    });
    
    console.log(`✅ Successfully synced ${syncCount} new messages to local storage`);
    return syncCount;
  }
  
  /**
   * Gets the timestamp of the last sync for a group
   * @param groupId The group ID to get the last sync timestamp for
   * @returns The timestamp of the last sync, or 0 if never synced
   */
  public async getLastSyncTimestamp(groupId: string): Promise<number> {
    await this.checkDatabaseReady();
    
    try {
      const result = await this.db!.query(
        'SELECT last_sync_timestamp FROM groups WHERE id = ?',
        [groupId]
      );
      
      return result.values?.[0]?.last_sync_timestamp || 0;
    } catch (error) {
      console.error(`❌ Error getting last sync timestamp for group ${groupId}:`, error);
      return 0;
    }
  }

  // Utility methods
  public async clearAllData(): Promise<void> {
    await this.checkDatabaseReady();

    const tables = ['messages', 'groups', 'users', 'outbox', 'sync_state'];
    
    for (const table of tables) {
      await this.db!.run(`DELETE FROM ${table}`);
    }

    console.log('🗑️ All local data cleared');
  }

  public async getStorageStats(): Promise<{
    messageCount: number;
    groupCount: number;
    userCount: number;
    outboxCount: number;
  }> {
    await this.checkDatabaseReady();

    const [messages, groups, users, outbox] = await Promise.all([
      this.db!.query('SELECT COUNT(*) as count FROM messages'),
      this.db!.query('SELECT COUNT(*) as count FROM groups'),
      this.db!.query('SELECT COUNT(*) as count FROM users'),
      this.db!.query('SELECT COUNT(*) as count FROM outbox')
    ]);

    return {
      messageCount: messages.values?.[0]?.count || 0,
      groupCount: groups.values?.[0]?.count || 0,
      userCount: users.values?.[0]?.count || 0,
      outboxCount: outbox.values?.[0]?.count || 0
    };
  }

  public async close(): Promise<void> {
    if (this.db) {
      await this.db.close();
      this.db = null;
      this.isInitialized = false;
      console.log('🔒 SQLite connection closed');
    }
  }
}

export const sqliteService = SQLiteService.getInstance();