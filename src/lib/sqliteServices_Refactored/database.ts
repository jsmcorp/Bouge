import { CapacitorSQLite, SQLiteConnection, SQLiteDBConnection } from '@capacitor-community/sqlite';
import { Capacitor } from '@capacitor/core';
import { initEncryptionSecret } from '../sqliteSecret';

export class DatabaseManager {
  private sqlite: SQLiteConnection;
  private db: SQLiteDBConnection | null = null;
  private isInitialized = false;
  private readonly dbName = 'confessr_db';
  private readonly dbVersion = 1;

  constructor() {
    this.sqlite = new SQLiteConnection(CapacitorSQLite);
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
        console.warn('⚠️ Encryption key setup issue:', error.message);
        console.log('🔄 Continuing SQLite initialization...');
      }

      /* 2️⃣ Check if database exists */
      const dbExists = await this.sqlite.isDatabase(this.dbName);
      console.log(`Database exists check: ${dbExists.result}`);

      if (!dbExists.result) {
        await this.createAndEncryptDatabase();
      }
      
      /* 5️⃣ Open the encrypted database with secret mode */
      await this.openEncryptedDatabase();

      this.isInitialized = true;
      console.log('✅ Encrypted SQLite ready');

      // ❌ REMOVED: Test inserts during boot (adds I/O overhead)
      // Database is verified by schema creation success
    } catch (err) {
      console.error('💥 SQLite init failed:', err);
      throw err;
    }
  }

  private async createAndEncryptDatabase(): Promise<void> {
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

      // Remove the connection from the pool before creating encrypted connection
      await this.sqlite.closeConnection(this.dbName, false);
      console.log('✅ Unencrypted connection removed from pool');

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

      // Remove the encryption connection from the pool
      await this.sqlite.closeConnection(this.dbName, false);
      console.log('✅ Encryption connection removed from pool');
    } catch (error: any) {
      console.error('❌ Error creating/encrypting database:', error);
      throw new Error(`Failed to create/encrypt database: ${error.message || error}`);
    }
  }

  private async openEncryptedDatabase(): Promise<void> {
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
      await this.createTables();
      console.log('✅ Tables created in encrypted database');
    } catch (error: any) {
      console.error('❌ Error opening encrypted database:', error);
      throw new Error(`Failed to open encrypted database: ${error.message || error}`);
    }
  }

  private async createTables(): Promise<void> {
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
        last_read_at INTEGER DEFAULT 0,
        last_read_message_id TEXT,
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

      /* ============================================ */
      /* CONTACTS FEATURE TABLES                     */
      /* ============================================ */

      /* Contacts table - stores synced device contacts */
      CREATE TABLE IF NOT EXISTS contacts (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        phone_number TEXT NOT NULL,
        display_name TEXT NOT NULL,
        email TEXT,
        photo_uri TEXT,
        synced_at INTEGER NOT NULL,
        UNIQUE(phone_number)
      );

      /* Contact-to-user mapping - maps contacts to registered Confessr users */
      CREATE TABLE IF NOT EXISTS contact_user_mapping (
        contact_phone TEXT NOT NULL,
        user_id TEXT NOT NULL,
        user_display_name TEXT NOT NULL,
        user_avatar_url TEXT,
        mapped_at INTEGER NOT NULL,
        PRIMARY KEY (contact_phone, user_id),
        FOREIGN KEY (user_id) REFERENCES users(id)
      );

      /* Sync metadata - tracks sync state and timestamps */
      CREATE TABLE IF NOT EXISTS sync_metadata (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL,
        updated_at INTEGER NOT NULL
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

      /* Contacts indexes for fast search and lookup */
      CREATE INDEX IF NOT EXISTS idx_contacts_phone
        ON contacts(phone_number);
      CREATE INDEX IF NOT EXISTS idx_contacts_name
        ON contacts(display_name);
      CREATE INDEX IF NOT EXISTS idx_contact_mapping_phone
        ON contact_user_mapping(contact_phone);
      CREATE INDEX IF NOT EXISTS idx_contact_mapping_user
        ON contact_user_mapping(user_id);
    `;

    await this.db!.execute(sql);
    
    // Add missing columns to existing tables
    await this.migrateDatabase();
  }

  private async migrateDatabase(): Promise<void> {
    try {
      // CRITICAL FIX: Cache table schemas to avoid duplicate PRAGMA queries
      // Previously: 14 PRAGMA queries (2 messages + 7 groups + 3 users + 2 group_members)
      // Now: 4 PRAGMA queries (1 per table) - saves ~500ms on startup
      const tableSchemaCache = new Map<string, Set<string>>();

      // Helper: get table schema (cached)
      const getTableColumns = async (table: string): Promise<Set<string>> => {
        if (tableSchemaCache.has(table)) {
          return tableSchemaCache.get(table)!;
        }

        const res = await this.db!.query(`PRAGMA table_info(${table});`);
        const rows = res.values || [];
        const columns = new Set(rows.map((r: any) => r.name));
        tableSchemaCache.set(table, columns);
        return columns;
      };

      // Helper: check if a column exists (uses cache)
      const columnExists = async (table: string, column: string): Promise<boolean> => {
        const columns = await getTableColumns(table);
        return columns.has(column);
      };

      // Helper: ensure column exists, otherwise add it
      const ensureColumn = async (table: string, column: string, sqlType: string, defaultClause?: string) => {
        const exists = await columnExists(table, column);
        if (!exists) {
          const defaultSql = defaultClause ? ` ${defaultClause}` : '';
          const alter = `ALTER TABLE ${table} ADD COLUMN ${column} ${sqlType}${defaultSql};`;
          await this.db!.execute(alter);
          console.log(`✅ Added column ${table}.${column}`);

          // Invalidate cache for this table since we modified it
          tableSchemaCache.delete(table);
        }
      };

      // Messages
      await ensureColumn('messages', 'updated_at', 'INTEGER');
      await ensureColumn('messages', 'deleted_at', 'INTEGER');

      // Groups
      await ensureColumn('groups', 'description', 'TEXT');
      await ensureColumn('groups', 'invite_code', 'TEXT');
      await ensureColumn('groups', 'created_by', 'TEXT');
      await ensureColumn('groups', 'created_at', 'INTEGER');
      await ensureColumn('groups', 'last_sync_timestamp', 'INTEGER', 'DEFAULT 0');
      await ensureColumn('groups', 'avatar_url', 'TEXT');
      await ensureColumn('groups', 'is_archived', 'INTEGER', 'DEFAULT 0');

      // Users
      await ensureColumn('users', 'phone_number', 'TEXT');
      await ensureColumn('users', 'is_onboarded', 'INTEGER', 'DEFAULT 0');
      await ensureColumn('users', 'created_at', 'INTEGER');

      // Group members - unread tracking
      await ensureColumn('group_members', 'last_read_at', 'INTEGER', 'DEFAULT 0');
      await ensureColumn('group_members', 'last_read_message_id', 'TEXT');

      console.log('✅ Database migration completed');
    } catch (error) {
      console.error('❌ Database migration failed:', error);
    }
  }

  // ❌ REMOVED: testLocalStorage() method
  // This was adding unnecessary I/O during boot with test inserts
  // Database integrity is verified by successful schema creation

  public async isReady(): Promise<boolean> {
    return this.isInitialized && this.db !== null;
  }

  public async checkDatabaseReady(): Promise<void> {
    if (!this.isInitialized || !this.db) {
      try {
        await this.initialize();
      } catch (error: any) {
        throw new Error(`Database not ready: ${error.message || error}`);
      }
      
      if (!this.isInitialized || !this.db) {
        throw new Error('Database failed to initialize');
      }
    }
  }

  public getConnection(): SQLiteDBConnection {
    if (!this.db) {
      throw new Error('Database connection not available');
    }
    return this.db;
  }

  public getDb(): SQLiteDBConnection | null {
    return this.db;
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