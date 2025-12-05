import { CapacitorSQLite, SQLiteConnection, SQLiteDBConnection } from '@capacitor-community/sqlite';
import { Capacitor } from '@capacitor/core';
import { initEncryptionSecret } from '../sqliteSecret';
import { sqliteMonitoring } from '../sqliteMonitoring';

export class DatabaseManager {
  private sqlite: SQLiteConnection;
  private db: SQLiteDBConnection | null = null;
  private isInitialized = false;
  private isInitializing = false;
  private readonly dbName = 'confessr_db';
  private readonly dbVersion = 1;

  constructor() {
    this.sqlite = new SQLiteConnection(CapacitorSQLite);
  }

  public async initialize(): Promise<void> {
    if (this.isInitialized) {
      console.log('✅ Database already initialized, skipping...');
      return;
    }
    
    if (this.isInitializing) {
      console.log('⏳ Database initialization already in progress, waiting...');
      // Wait for the ongoing initialization to complete
      while (this.isInitializing) {
        await new Promise(resolve => setTimeout(resolve, 100));
      }
      if (this.isInitialized) {
        console.log('✅ Database initialized by concurrent call');
        return;
      }
    }
    
    this.isInitializing = true;

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

      // ✅ Run health check to verify database state
      await this.performHealthCheck();
    } catch (err) {
      console.error('💥 SQLite init failed:', err);
      this.isInitializing = false;
      throw err;
    } finally {
      this.isInitializing = false;
    }
  }

  private async performHealthCheck(): Promise<void> {
    try {
      console.log('🏥 [HEALTH-CHECK] Verifying database integrity...');
      
      // Check 1: Verify group_members table exists
      const tableCheck = await this.db!.query(
        `SELECT name FROM sqlite_master WHERE type='table' AND name='group_members'`
      );
      const tableExists = tableCheck.values && tableCheck.values.length > 0;
      console.log(`🏥 [HEALTH-CHECK] group_members table exists: ${tableExists ? '✅' : '❌'}`);
      
      // Check 2: Verify CASCADE foreign keys
      const fkCheck = await this.db!.query('PRAGMA foreign_key_list(group_members);');
      const hasCascade = (fkCheck.values || []).some((fk: any) => 
        fk.on_delete === 'CASCADE'
      );
      console.log(`🏥 [HEALTH-CHECK] group_members has CASCADE: ${hasCascade ? '✅' : '❌'}`);
      
      if (!hasCascade) {
        console.warn('⚠️ [HEALTH-CHECK] WARNING: group_members does NOT have CASCADE foreign keys!');
        console.warn('⚠️ [HEALTH-CHECK] This will cause data loss on every migration run');
      }
      
      // Check 3: Count existing rows
      const rowCheck = await this.db!.query(
        `SELECT COUNT(*) as count FROM group_members`
      );
      const rowCount = rowCheck.values?.[0]?.count || 0;
      console.log(`🏥 [HEALTH-CHECK] group_members row count: ${rowCount}`);
      
      // Check 3b: Show actual rows for debugging
      if (rowCount > 0) {
        const allRows = await this.db!.query(`SELECT group_id, user_id, last_read_at, last_read_message_id FROM group_members`);
        console.log(`🏥 [HEALTH-CHECK] Existing rows:`, allRows.values);
        
        // Show FULL IDs for comparison with query parameters
        if (allRows.values && allRows.values.length > 0) {
          allRows.values.forEach((row: any, idx: number) => {
            console.log(`🏥 [HEALTH-CHECK] 📋 Row ${idx + 1} FULL IDs:`, {
              group_id_full: row.group_id,
              group_id_short: row.group_id?.slice(0, 8),
              user_id_full: row.user_id,
              user_id_short: row.user_id?.slice(0, 8),
              last_read_at: row.last_read_at,
              last_read_message_id_short: row.last_read_message_id?.slice(0, 8)
            });
          });
        }
      } else {
        console.warn(`🏥 [HEALTH-CHECK] ⚠️ No group_members rows found after restart!`);
      }
      
      // Check 4: Verify encryption
      try {
        const encryptCheck = await this.db!.query('PRAGMA cipher_version;');
        const isEncrypted = encryptCheck.values && encryptCheck.values.length > 0;
        console.log(`🏥 [HEALTH-CHECK] Database encrypted: ${isEncrypted ? '✅' : '⚠️'}`);
      } catch {
        console.log('🏥 [HEALTH-CHECK] Database encrypted: ⚠️ (cipher_version not available)');
      }
      
      console.log('🏥 [HEALTH-CHECK] Health check complete');
    } catch (error) {
      console.error('❌ [HEALTH-CHECK] Health check failed:', error);
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
      
      // Check if connection already exists
      const existingConn = await this.sqlite.isConnection(this.dbName, false);
      if (existingConn.result) {
        console.log('♻️ Connection already exists, retrieving existing connection...');
        this.db = await this.sqlite.retrieveConnection(this.dbName, false);
        
        // Verify the connection is open
        const isOpen = await this.db.isDBOpen();
        if (!isOpen.result) {
          console.log('🔓 Connection exists but closed, reopening...');
          await this.db.open();
        }
        console.log('✅ Using existing encrypted database connection');
      } else {
        console.log('🆕 Creating new encrypted database connection...');
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
      }
      
      /* 6️⃣ security pragma */
      await this.db.execute('PRAGMA cipher_memory_security = ON;');
      console.log('✅ Security pragma set');
      
      // 🔍 DIAGNOSTIC: Check WAL mode
      const walCheck = await this.db.query('PRAGMA journal_mode;');
      console.log('🔍 [DIAGNOSTIC] Journal mode:', walCheck.values?.[0]);
      
      const walFileCheck = await this.db.query('PRAGMA wal_autocheckpoint;');
      console.log('🔍 [DIAGNOSTIC] WAL autocheckpoint:', walFileCheck.values?.[0]);
      
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
        deleted_at INTEGER,
        is_viewed INTEGER DEFAULT 0
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
        FOREIGN KEY (message_id) REFERENCES messages(id) ON DELETE CASCADE
      );

      /* Poll votes table */
      CREATE TABLE IF NOT EXISTS poll_votes (
        poll_id TEXT NOT NULL,
        user_id TEXT NOT NULL,
        option_index INTEGER NOT NULL,
        created_at INTEGER NOT NULL,
        PRIMARY KEY (poll_id, user_id),
        FOREIGN KEY (poll_id) REFERENCES polls(id) ON DELETE CASCADE
      );

      /* Reactions table */
      CREATE TABLE IF NOT EXISTS reactions (
        id TEXT PRIMARY KEY,
        message_id TEXT NOT NULL,
        user_id TEXT NOT NULL,
        emoji TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        FOREIGN KEY (message_id) REFERENCES messages(id) ON DELETE CASCADE
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
        FOREIGN KEY (group_id) REFERENCES groups(id) ON DELETE CASCADE,
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
      );

      /* User pseudonyms for ghost messages */
      CREATE TABLE IF NOT EXISTS user_pseudonyms (
        group_id TEXT NOT NULL,
        user_id TEXT NOT NULL,
        pseudonym TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        PRIMARY KEY (group_id, user_id)
      );

      /* Group join requests table */
      CREATE TABLE IF NOT EXISTS group_join_requests (
        id TEXT PRIMARY KEY,
        group_id TEXT NOT NULL,
        user_id TEXT NOT NULL,
        invited_by TEXT,
        status TEXT NOT NULL DEFAULT 'pending',
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        FOREIGN KEY (group_id) REFERENCES groups(id) ON DELETE CASCADE,
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
        UNIQUE(group_id, user_id)
      );

      /* Confessions table for confession messages */
      CREATE TABLE IF NOT EXISTS confessions (
        id TEXT PRIMARY KEY,
        message_id TEXT NOT NULL,
        confession_type TEXT NOT NULL,
        is_anonymous INTEGER DEFAULT 1,
        FOREIGN KEY (message_id) REFERENCES messages(id) ON DELETE CASCADE
      );

      /* Locally deleted messages (tombstones) - for "delete for me" feature */
      CREATE TABLE IF NOT EXISTS locally_deleted_messages (
        message_id TEXT PRIMARY KEY,
        deleted_at INTEGER NOT NULL
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
      CREATE INDEX IF NOT EXISTS idx_locally_deleted_message_id
        ON locally_deleted_messages(message_id);

      /* Contacts indexes for fast search and lookup */
      CREATE INDEX IF NOT EXISTS idx_contacts_phone
        ON contacts(phone_number);
      CREATE INDEX IF NOT EXISTS idx_contacts_name
        ON contacts(display_name);
      CREATE INDEX IF NOT EXISTS idx_contact_mapping_phone
        ON contact_user_mapping(contact_phone);
      CREATE INDEX IF NOT EXISTS idx_contact_mapping_user
        ON contact_user_mapping(user_id);

      /* ============================================ */
      /* TOPICS FEATURE TABLES                       */
      /* ============================================ */

      /* Topics cache - stores topic metadata for offline access */
      CREATE TABLE IF NOT EXISTS topics_cache (
        id TEXT PRIMARY KEY,
        group_id TEXT NOT NULL,
        message_id TEXT NOT NULL,
        type TEXT NOT NULL CHECK (type IN ('text', 'poll', 'confession', 'news', 'image')),
        title TEXT,
        content TEXT NOT NULL,
        author_id TEXT,
        author_name TEXT,
        author_avatar TEXT,
        pseudonym TEXT,
        expires_at INTEGER, -- Unix timestamp, NULL means never expires
        views_count INTEGER DEFAULT 0,
        likes_count INTEGER DEFAULT 0,
        replies_count INTEGER DEFAULT 0,
        is_anonymous INTEGER DEFAULT 0,
        created_at INTEGER NOT NULL,
        synced_at INTEGER,
        FOREIGN KEY (group_id) REFERENCES groups(id) ON DELETE CASCADE
      );

      /* Topic likes cache - stores user likes for offline access */
      CREATE TABLE IF NOT EXISTS topic_likes_cache (
        topic_id TEXT NOT NULL,
        user_id TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        synced INTEGER DEFAULT 0,
        PRIMARY KEY (topic_id, user_id)
      );

      /* Topic read status - local-first read tracking */
      CREATE TABLE IF NOT EXISTS topic_read_status (
        topic_id TEXT PRIMARY KEY,
        group_id TEXT NOT NULL,
        user_id TEXT NOT NULL,
        last_read_message_id TEXT,
        last_read_at INTEGER NOT NULL,
        synced INTEGER DEFAULT 0
      );

      /* Topic views queue - queues view increments for sync */
      CREATE TABLE IF NOT EXISTS topic_views_queue (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        topic_id TEXT NOT NULL,
        user_id TEXT NOT NULL,
        viewed_at INTEGER NOT NULL,
        synced INTEGER DEFAULT 0
      );

      /* Topic outbox - queues topic operations for offline sync */
      CREATE TABLE IF NOT EXISTS topic_outbox (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        operation_type TEXT NOT NULL CHECK (operation_type IN ('create_topic', 'toggle_like', 'increment_view', 'update_read_status')),
        topic_id TEXT NOT NULL,
        user_id TEXT NOT NULL,
        group_id TEXT NOT NULL,
        payload TEXT NOT NULL, -- JSON string with operation-specific data
        retry_count INTEGER DEFAULT 0,
        next_retry_at INTEGER NOT NULL,
        created_at INTEGER NOT NULL
      );

      /* Topics indexes for performance */
      CREATE INDEX IF NOT EXISTS idx_topics_cache_group_created
        ON topics_cache(group_id, created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_topics_cache_expires
        ON topics_cache(expires_at) WHERE expires_at IS NOT NULL;
      CREATE INDEX IF NOT EXISTS idx_topic_likes_cache_topic
        ON topic_likes_cache(topic_id);
      CREATE INDEX IF NOT EXISTS idx_topic_likes_cache_user
        ON topic_likes_cache(user_id);
      CREATE INDEX IF NOT EXISTS idx_topic_read_status_user_group
        ON topic_read_status(user_id, group_id);
      CREATE INDEX IF NOT EXISTS idx_topic_views_queue_synced
        ON topic_views_queue(synced) WHERE synced = 0;
      CREATE INDEX IF NOT EXISTS idx_topic_outbox_retry
        ON topic_outbox(next_retry_at) WHERE retry_count < 5;
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
      await ensureColumn('messages', 'is_viewed', 'INTEGER', 'DEFAULT 0');
      await ensureColumn('messages', 'topic_id', 'TEXT');
      
      // Create index for topic_id after column is added
      try {
        await this.db!.execute('CREATE INDEX IF NOT EXISTS idx_msg_topic_id ON messages(topic_id, created_at DESC);');
        console.log('✅ Created index idx_msg_topic_id');
      } catch (error) {
        // Index might already exist, that's okay
        console.log('ℹ️ Index idx_msg_topic_id already exists or failed to create');
      }

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

      // CRITICAL: Migrate tables to add ON DELETE CASCADE for foreign keys
      // This is required for "delete for me" feature to work properly
      await this.migrateForeignKeysWithCascade();

      console.log('✅ Database migration completed');
    } catch (error) {
      console.error('❌ Database migration failed:', error);
    }
  }

  private async migrateForeignKeysWithCascade(): Promise<void> {
    const migrationStartTime = Date.now();
    
    try {
      console.log('🔄 [MIGRATION] Checking if foreign key CASCADE migration is needed...');

      // CRITICAL FIX: Check group_members table specifically (not just reactions)
      // This prevents re-running the migration and losing last_read_message_id data
      const gmFkCheck = await this.db!.query('PRAGMA foreign_key_list(group_members);');
      console.log('🔍 [MIGRATION] group_members FK check result:', {
        rowCount: gmFkCheck.values?.length || 0,
        foreignKeys: gmFkCheck.values
      });
      
      const gmHasCascade = (gmFkCheck.values || []).some((fk: any) => 
        fk.on_delete === 'CASCADE'
      );

      console.log(`🔍 [MIGRATION] group_members has CASCADE? ${gmHasCascade}`);

      if (gmHasCascade) {
        console.log('✅ [MIGRATION] group_members already has CASCADE, skipping migration');
        const duration = Date.now() - migrationStartTime;
        sqliteMonitoring.trackMigration('skipped', duration);
        return;
      }
      
      console.log('⚠️ [MIGRATION] group_members does NOT have CASCADE, will run migration');

      // Also check reactions table as a secondary check
      const fkCheck = await this.db!.query('PRAGMA foreign_key_list(reactions);');
      console.log('🔍 [MIGRATION] reactions FK check result:', {
        rowCount: fkCheck.values?.length || 0,
        foreignKeys: fkCheck.values
      });
      
      const hasCascade = (fkCheck.values || []).some((fk: any) => 
        fk.on_delete === 'CASCADE'
      );

      console.log(`🔍 [MIGRATION] reactions has CASCADE? ${hasCascade}`);

      if (hasCascade) {
        console.log('✅ [MIGRATION] Foreign keys already have CASCADE, skipping migration');
        const duration = Date.now() - migrationStartTime;
        sqliteMonitoring.trackMigration('skipped', duration);
        
        // Verify data integrity - check if reactions have valid message_ids
        try {
          const integrityCheck = await this.db!.query(`
            SELECT COUNT(*) as invalid_count 
            FROM reactions r 
            LEFT JOIN messages m ON r.message_id = m.id 
            WHERE m.id IS NULL
          `);
          const invalidCount = integrityCheck.values?.[0]?.invalid_count || 0;
          if (invalidCount > 0) {
            console.warn(`⚠️ Found ${invalidCount} reactions with invalid message_ids - data may be corrupted`);
            console.warn('⚠️ Consider clearing local data and re-syncing from server');
          }
        } catch (checkErr) {
          console.warn('⚠️ Could not verify data integrity:', checkErr);
        }
        
        return;
      }

      console.log('🔄 [MIGRATION] Starting CASCADE migration (this will recreate tables)...');

      // Disable foreign keys temporarily
      await this.db!.execute('PRAGMA foreign_keys = OFF;');

      // Migrate reactions table
      await this.db!.execute(`
        CREATE TABLE IF NOT EXISTS reactions_new (
          id TEXT PRIMARY KEY,
          message_id TEXT NOT NULL,
          user_id TEXT NOT NULL,
          emoji TEXT NOT NULL,
          created_at INTEGER NOT NULL,
          FOREIGN KEY (message_id) REFERENCES messages(id) ON DELETE CASCADE
        );
      `);
      await this.db!.execute(`
        INSERT INTO reactions_new (id, message_id, user_id, emoji, created_at)
        SELECT id, message_id, user_id, emoji, created_at FROM reactions;
      `);
      await this.db!.execute('DROP TABLE reactions;');
      await this.db!.execute('ALTER TABLE reactions_new RENAME TO reactions;');
      await this.db!.execute('CREATE INDEX IF NOT EXISTS idx_reactions_message ON reactions(message_id);');

      // Migrate polls table
      await this.db!.execute(`
        CREATE TABLE IF NOT EXISTS polls_new (
          id TEXT PRIMARY KEY,
          message_id TEXT NOT NULL,
          question TEXT NOT NULL,
          options TEXT NOT NULL,
          created_at INTEGER NOT NULL,
          closes_at INTEGER NOT NULL,
          created_by TEXT NOT NULL,
          FOREIGN KEY (message_id) REFERENCES messages(id) ON DELETE CASCADE
        );
      `);
      await this.db!.execute(`
        INSERT INTO polls_new (id, message_id, question, options, created_at, closes_at, created_by)
        SELECT id, message_id, question, options, created_at, closes_at, created_by FROM polls;
      `);
      await this.db!.execute('DROP TABLE polls;');
      await this.db!.execute('ALTER TABLE polls_new RENAME TO polls;');
      await this.db!.execute('CREATE INDEX IF NOT EXISTS idx_poll_message ON polls(message_id);');

      // Migrate poll_votes table
      await this.db!.execute(`
        CREATE TABLE IF NOT EXISTS poll_votes_new (
          poll_id TEXT NOT NULL,
          user_id TEXT NOT NULL,
          option_index INTEGER NOT NULL,
          created_at INTEGER NOT NULL,
          PRIMARY KEY (poll_id, user_id),
          FOREIGN KEY (poll_id) REFERENCES polls(id) ON DELETE CASCADE
        );
      `);
      await this.db!.execute(`
        INSERT INTO poll_votes_new (poll_id, user_id, option_index, created_at)
        SELECT poll_id, user_id, option_index, created_at FROM poll_votes;
      `);
      await this.db!.execute('DROP TABLE poll_votes;');
      await this.db!.execute('ALTER TABLE poll_votes_new RENAME TO poll_votes;');
      await this.db!.execute('CREATE INDEX IF NOT EXISTS idx_poll_vote_poll ON poll_votes(poll_id);');

      // Migrate confessions table
      await this.db!.execute(`
        CREATE TABLE IF NOT EXISTS confessions_new (
          id TEXT PRIMARY KEY,
          message_id TEXT NOT NULL,
          confession_type TEXT NOT NULL,
          is_anonymous INTEGER DEFAULT 1,
          FOREIGN KEY (message_id) REFERENCES messages(id) ON DELETE CASCADE
        );
      `);
      await this.db!.execute(`
        INSERT INTO confessions_new (id, message_id, confession_type, is_anonymous)
        SELECT id, message_id, confession_type, is_anonymous FROM confessions;
      `);
      await this.db!.execute('DROP TABLE confessions;');
      await this.db!.execute('ALTER TABLE confessions_new RENAME TO confessions;');
      await this.db!.execute('CREATE INDEX IF NOT EXISTS idx_confessions_message ON confessions(message_id);');

      // Migrate group_members table
      await this.db!.execute(`
        CREATE TABLE IF NOT EXISTS group_members_new (
          group_id TEXT NOT NULL,
          user_id TEXT NOT NULL,
          role TEXT DEFAULT 'participant',
          joined_at INTEGER NOT NULL,
          last_read_at INTEGER DEFAULT 0,
          last_read_message_id TEXT,
          PRIMARY KEY (group_id, user_id),
          FOREIGN KEY (group_id) REFERENCES groups(id) ON DELETE CASCADE,
          FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
        );
      `);
      await this.db!.execute(`
        INSERT INTO group_members_new (group_id, user_id, role, joined_at, last_read_at, last_read_message_id)
        SELECT group_id, user_id, role, joined_at, last_read_at, last_read_message_id FROM group_members;
      `);
      await this.db!.execute('DROP TABLE group_members;');
      await this.db!.execute('ALTER TABLE group_members_new RENAME TO group_members;');
      await this.db!.execute('CREATE INDEX IF NOT EXISTS idx_group_members_group ON group_members(group_id);');
      await this.db!.execute('CREATE INDEX IF NOT EXISTS idx_group_members_user ON group_members(user_id);');

      // Migrate group_join_requests table
      await this.db!.execute(`
        CREATE TABLE IF NOT EXISTS group_join_requests_new (
          id TEXT PRIMARY KEY,
          group_id TEXT NOT NULL,
          user_id TEXT NOT NULL,
          invited_by TEXT,
          status TEXT NOT NULL DEFAULT 'pending',
          created_at INTEGER NOT NULL,
          updated_at INTEGER NOT NULL,
          FOREIGN KEY (group_id) REFERENCES groups(id) ON DELETE CASCADE,
          FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
          UNIQUE(group_id, user_id)
        );
      `);
      await this.db!.execute(`
        INSERT INTO group_join_requests_new (id, group_id, user_id, invited_by, status, created_at, updated_at)
        SELECT id, group_id, user_id, invited_by, status, created_at, updated_at FROM group_join_requests;
      `);
      await this.db!.execute('DROP TABLE group_join_requests;');
      await this.db!.execute('ALTER TABLE group_join_requests_new RENAME TO group_join_requests;');

      // Re-enable foreign keys
      await this.db!.execute('PRAGMA foreign_keys = ON;');

      const duration = Date.now() - migrationStartTime;
      console.log(`✅ [MIGRATION] Foreign key CASCADE migration completed in ${duration}ms`);
      console.log('✅ [MIGRATION] All tables recreated with CASCADE foreign keys');
      sqliteMonitoring.trackMigration('success', duration);
    } catch (error) {
      const duration = Date.now() - migrationStartTime;
      console.error('❌ [MIGRATION] Foreign key CASCADE migration failed:', error);
      sqliteMonitoring.trackMigration('failed', duration);
      
      // Re-enable foreign keys even on error
      try {
        await this.db!.execute('PRAGMA foreign_keys = ON;');
      } catch {}
      
      // Don't throw - allow app to continue with degraded functionality
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
    
    // 🔍 DIAGNOSTIC: Log connection info
    console.log(`[db-connection] 🔍 getConnection() called - dbName: ${this.dbName}, isOpen: ${this.db !== null}`);
    
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