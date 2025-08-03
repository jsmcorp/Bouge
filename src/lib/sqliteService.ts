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
  category: string | null;
  parent_id: string | null;
  image_url: string | null;
  created_at: number; // Unix timestamp
  updated_at?: number;
  deleted_at?: number;
  local_id?: number; // Auto-increment unique ID
}

export interface LocalPoll {
  id: string;
  message_id: string;
  question: string;
  options: string; // JSON string
  created_at: number;
  closes_at: number;
}

export interface LocalPollVote {
  poll_id: string;
  user_id: string;
  option_index: number;
  created_at: number;
}

export interface LocalGroup {
  id: string;
  name: string;
  description: string | null;
  invite_code: string;
  created_by: string;
  created_at: number;
  last_sync_timestamp: number;
  avatar_url: string | null;
  is_archived: number; // SQLite uses INTEGER for boolean
}

export interface LocalUser {
  id: string;
  display_name: string;
  phone_number: string | null;
  avatar_url: string | null;
  is_onboarded: number; // SQLite uses INTEGER for boolean
  created_at: number;
}

export interface OutboxMessage {
  id?: number;
  group_id: string;
  user_id: string;
  content: string;
  retry_count: number;
  next_retry_at: number;
  message_type?: string;
  category?: string | null;
  parent_id?: string | null;
  image_url?: string | null;
  is_ghost?: number;
}

export interface SyncState {
  key: string;
  value: string;
}

export interface LocalReaction {
  id: string;
  message_id: string;
  user_id: string;
  emoji: string;
  created_at: number;
}

export interface LocalGroupMember {
  group_id: string;
  user_id: string;
  role: 'admin' | 'participant';
  joined_at: number;
}

export interface LocalUserPseudonym {
  group_id: string;
  user_id: string;
  pseudonym: string;
  created_at: number;
}

export interface LocalConfession {
  id: string;
  message_id: string;
  confession_type: string;
  is_anonymous: number;
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
        display_name: 'Test User',
        phone_number: '+1234567890',
        avatar_url: null,
        is_onboarded: 1,
        created_at: Date.now()
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
        category: null,
        parent_id: null,
        image_url: null,
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
        category TEXT,
        parent_id TEXT,
        image_url TEXT,
        created_at INTEGER NOT NULL,
        local_id INTEGER UNIQUE,
        updated_at INTEGER,
        deleted_at INTEGER
      );

      CREATE TABLE IF NOT EXISTS groups (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        description TEXT,
        invite_code TEXT,
        created_by TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        last_sync_timestamp INTEGER DEFAULT 0,
        avatar_url TEXT,
        is_archived INTEGER DEFAULT 0
      );

      CREATE TABLE IF NOT EXISTS users (
        id TEXT PRIMARY KEY,
        display_name TEXT NOT NULL,
        phone_number TEXT,
        avatar_url TEXT,
        is_onboarded INTEGER DEFAULT 0,
        created_at INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS outbox (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        group_id TEXT NOT NULL,
        user_id TEXT NOT NULL,
        content TEXT NOT NULL,
        retry_count INTEGER DEFAULT 0,
        next_retry_at INTEGER NOT NULL,
        message_type TEXT DEFAULT 'text',
        category TEXT,
        parent_id TEXT,
        image_url TEXT,
        is_ghost INTEGER DEFAULT 0
      );

      CREATE TABLE IF NOT EXISTS sync_state (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );

      /* Polls table */
      CREATE TABLE IF NOT EXISTS polls (
        id TEXT PRIMARY KEY,
        message_id TEXT NOT NULL,
        question TEXT NOT NULL,
        options TEXT NOT NULL, -- JSON string
        created_at INTEGER NOT NULL,
        closes_at INTEGER NOT NULL,
        created_by TEXT NOT NULL,
        FOREIGN KEY (message_id) REFERENCES messages(id)
      );

      /* Poll votes table */
      CREATE TABLE IF NOT EXISTS poll_votes (
        poll_id TEXT NOT NULL,
        user_id TEXT NOT NULL,
        option_index INTEGER NOT NULL,
        created_at INTEGER NOT NULL,
        PRIMARY KEY (poll_id, user_id),
        FOREIGN KEY (poll_id) REFERENCES polls(id)
      );

      /* Reactions table */
      CREATE TABLE IF NOT EXISTS reactions (
        id TEXT PRIMARY KEY,
        message_id TEXT NOT NULL,
        user_id TEXT NOT NULL,
        emoji TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        FOREIGN KEY (message_id) REFERENCES messages(id)
      );

      /* Group members table */
      CREATE TABLE IF NOT EXISTS group_members (
        group_id TEXT NOT NULL,
        user_id TEXT NOT NULL,
        role TEXT DEFAULT 'participant',
        joined_at INTEGER NOT NULL,
        PRIMARY KEY (group_id, user_id),
        FOREIGN KEY (group_id) REFERENCES groups(id),
        FOREIGN KEY (user_id) REFERENCES users(id)
      );

      /* User pseudonyms for ghost messages */
      CREATE TABLE IF NOT EXISTS user_pseudonyms (
        group_id TEXT NOT NULL,
        user_id TEXT NOT NULL,
        pseudonym TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        PRIMARY KEY (group_id, user_id)
      );

      /* Confessions table for confession messages */
      CREATE TABLE IF NOT EXISTS confessions (
        id TEXT PRIMARY KEY,
        message_id TEXT NOT NULL,
        confession_type TEXT NOT NULL,
        is_anonymous INTEGER DEFAULT 1,
        FOREIGN KEY (message_id) REFERENCES messages(id)
      );

      /* indexes */
      CREATE INDEX IF NOT EXISTS idx_msg_group_date_asc
        ON messages(group_id, created_at ASC);
      CREATE INDEX IF NOT EXISTS idx_msg_group_date_desc
        ON messages(group_id, created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_msg_parent_id
        ON messages(parent_id);
      CREATE INDEX IF NOT EXISTS idx_msg_type
        ON messages(message_type);
      CREATE INDEX IF NOT EXISTS idx_msg_category
        ON messages(category);
      CREATE INDEX IF NOT EXISTS idx_outbox_retry
        ON outbox(next_retry_at);
      CREATE INDEX IF NOT EXISTS idx_poll_message
        ON polls(message_id);
      CREATE INDEX IF NOT EXISTS idx_poll_vote_poll
        ON poll_votes(poll_id);
      CREATE INDEX IF NOT EXISTS idx_reactions_message
        ON reactions(message_id);
      CREATE INDEX IF NOT EXISTS idx_group_members_group
        ON group_members(group_id);
      CREATE INDEX IF NOT EXISTS idx_group_members_user
        ON group_members(user_id);
      CREATE INDEX IF NOT EXISTS idx_user_pseudonyms_group
        ON user_pseudonyms(group_id);
      CREATE INDEX IF NOT EXISTS idx_confessions_message
        ON confessions(message_id);
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

  // Poll operations
  public async savePoll(poll: Omit<LocalPoll, 'local_id'>): Promise<void> {
    await this.checkDatabaseReady();

    await this.db!.run(
      `INSERT OR REPLACE INTO polls
       (id, message_id, question, options, created_at, closes_at)
       VALUES (?, ?, ?, ?, ?, ?);`,
      [
        poll.id,
        poll.message_id,
        poll.question,
        poll.options,
        poll.created_at,
        poll.closes_at
      ]
    );
  }

  public async getPolls(messageIds: string[]): Promise<LocalPoll[]> {
    await this.checkDatabaseReady();

    if (messageIds.length === 0) return [];

    const placeholders = messageIds.map(() => '?').join(',');
    const sql = `
      SELECT * FROM polls 
      WHERE message_id IN (${placeholders})
    `;

    const result = await this.db!.query(sql, messageIds);
    return result.values || [];
  }

  public async savePollVote(vote: Omit<LocalPollVote, 'local_id'>): Promise<void> {
    await this.checkDatabaseReady();

    await this.db!.run(
      `INSERT OR REPLACE INTO poll_votes
       (poll_id, user_id, option_index, created_at)
       VALUES (?, ?, ?, ?);`,
      [
        vote.poll_id,
        vote.user_id,
        vote.option_index,
        vote.created_at
      ]
    );
  }

  public async getPollVotes(pollIds: string[]): Promise<LocalPollVote[]> {
    await this.checkDatabaseReady();

    if (pollIds.length === 0) return [];

    const placeholders = pollIds.map(() => '?').join(',');
    const sql = `
      SELECT * FROM poll_votes 
      WHERE poll_id IN (${placeholders})
    `;

    const result = await this.db!.query(sql, pollIds);
    return result.values || [];
  }

  // Message operations
  public async saveMessage(message: Omit<LocalMessage, 'local_id'>): Promise<void> {
    await this.checkDatabaseReady();

    await this.db!.run(
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
      INSERT OR REPLACE INTO groups (id, name, description, invite_code, created_by, created_at, last_sync_timestamp, avatar_url, is_archived)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `;

    await this.db!.run(sql, [
      group.id,
      group.name,
      group.description,
      group.invite_code,
      group.created_by,
      group.created_at,
      group.last_sync_timestamp,
      group.avatar_url,
      group.is_archived
    ]);
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
      INSERT OR REPLACE INTO users (id, display_name, phone_number, avatar_url, is_onboarded, created_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `;

    await this.db!.run(sql, [
      user.id,
      user.display_name,
      user.phone_number,
      user.avatar_url,
      user.is_onboarded,
      user.created_at
    ]);
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
    category: string | null;
    parent_id: string | null;
    image_url: string | null;
    created_at: string | number;
    updated_at?: string | number | null;
    deleted_at?: string | number | null;
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
        // Ensure message_type is properly set based on the context
        let messageType = message.message_type || 'text';
        
        // Handle special message types
        if (message.parent_id) {
          // This is a reply
          messageType = 'reply';
        } else if (message.category === 'confession') {
          // This is a confession
          messageType = 'confession';
        }
        
        // Convert to local message format
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
        
        // Save to local storage
        await this.saveMessage(localMessage);
        syncCount++;
      } catch (error) {
        console.error(`❌ Error syncing message ${message.id}:`, error);
      }
    }
    
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

  // Reactions operations
  public async saveReaction(reaction: Omit<LocalReaction, 'local_id'>): Promise<void> {
    await this.checkDatabaseReady();

    await this.db!.run(
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
    await this.checkDatabaseReady();

    if (messageIds.length === 0) return [];

    const placeholders = messageIds.map(() => '?').join(',');
    const sql = `
      SELECT * FROM reactions 
      WHERE message_id IN (${placeholders})
    `;

    const result = await this.db!.query(sql, messageIds);
    return result.values || [];
  }

  // Group members operations
  public async saveGroupMember(member: LocalGroupMember): Promise<void> {
    await this.checkDatabaseReady();

    await this.db!.run(
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
    await this.checkDatabaseReady();

    const sql = `
      SELECT * FROM group_members 
      WHERE group_id = ?
      ORDER BY joined_at ASC
    `;

    const result = await this.db!.query(sql, [groupId]);
    return result.values || [];
  }

  // User pseudonyms operations
  public async saveUserPseudonym(pseudonym: LocalUserPseudonym): Promise<void> {
    await this.checkDatabaseReady();

    await this.db!.run(
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
    await this.checkDatabaseReady();

    const sql = `
      SELECT * FROM user_pseudonyms 
      WHERE group_id = ?
    `;

    const result = await this.db!.query(sql, [groupId]);
    return result.values || [];
  }

  // Confessions operations
  public async saveConfession(confession: LocalConfession): Promise<void> {
    await this.checkDatabaseReady();

    await this.db!.run(
      `INSERT OR REPLACE INTO confessions (id, message_id, confession_type, is_anonymous)
       VALUES (?, ?, ?, ?);`,
      [
        confession.id,
        confession.message_id,
        confession.confession_type,
        confession.is_anonymous
      ]
    );
  }

  public async getConfessions(messageIds: string[]): Promise<LocalConfession[]> {
    await this.checkDatabaseReady();

    if (messageIds.length === 0) return [];

    const placeholders = messageIds.map(() => '?').join(',');
    const sql = `
      SELECT * FROM confessions 
      WHERE message_id IN (${placeholders})
    `;

    const result = await this.db!.query(sql, messageIds);
    return result.values || [];
  }

  public async getStorageStats(): Promise<{
    messageCount: number;
    groupCount: number;
    userCount: number;
    outboxCount: number;
    pollCount: number;
    reactionCount: number;
    groupMemberCount: number;
    confessionCount: number;
  }> {
    await this.checkDatabaseReady();

    const [messages, groups, users, outbox, polls, reactions, groupMembers, confessions] = await Promise.all([
      this.db!.query('SELECT COUNT(*) as count FROM messages'),
      this.db!.query('SELECT COUNT(*) as count FROM groups'),
      this.db!.query('SELECT COUNT(*) as count FROM users'),
      this.db!.query('SELECT COUNT(*) as count FROM outbox'),
      this.db!.query('SELECT COUNT(*) as count FROM polls'),
      this.db!.query('SELECT COUNT(*) as count FROM reactions'),
      this.db!.query('SELECT COUNT(*) as count FROM group_members'),
      this.db!.query('SELECT COUNT(*) as count FROM confessions')
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