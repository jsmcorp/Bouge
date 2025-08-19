import { DatabaseManager } from './database';
import { supabase } from '@/lib/supabase';
import { FEATURES_PUSH } from '@/lib/featureFlags';

export class SyncOperations {
  constructor(private dbManager: DatabaseManager) {}

  public async setSyncState(key: string, value: string): Promise<void> {
    await this.dbManager.checkDatabaseReady();
    const db = this.dbManager.getConnection();

    const sql = `
      INSERT OR REPLACE INTO sync_state (key, value)
      VALUES (?, ?)
    `;

    await db.run(sql, [key, value]);
  }

  public async getSyncState(key: string): Promise<string | null> {
    await this.dbManager.checkDatabaseReady();
    const db = this.dbManager.getConnection();

    const result = await db.query('SELECT value FROM sync_state WHERE key = ?', [key]);
    return result.values?.[0]?.value || null;
  }

  // Missed messages resync bounded by config
  public async syncMissed(groupId: string): Promise<{ merged: number; since: string | null }> {
    await this.dbManager.checkDatabaseReady();
    const db = this.dbManager.getConnection();

    // Determine cursor
    const lastSync = await this.getSyncState(`group:${groupId}:last_cursor`);
    let sinceIso: string | null = lastSync;

    if (!sinceIso) {
      // Fallback to latest local message timestamp
      const res = await db.query('SELECT MAX(created_at) as ts FROM messages WHERE group_id = ?', [groupId]);
      const ts = res.values?.[0]?.ts;
      if (typeof ts === 'number') sinceIso = new Date(ts).toISOString();
    }

    console.log(`[sync] start group=${groupId} since=${sinceIso || 'none'}`);

    // Fetch from Supabase
    const limit = FEATURES_PUSH.sync.maxBatch;
    const query = supabase
      .from('messages')
      .select('*')
      .eq('group_id', groupId)
      .order('created_at', { ascending: true })
      .limit(limit);

    const { data, error } = sinceIso ? query.gt('created_at', sinceIso) : query;
    if (error) throw error;

    const rows = data || [];
    if (rows.length === 0) return { merged: 0, since: sinceIso };

    // Idempotent merge into local db
    let merged = 0;
    await db.run('BEGIN');
    try {
      for (const row of rows) {
        await db.run(
          `INSERT OR REPLACE INTO messages (id, group_id, user_id, content, is_ghost, message_type, category, parent_id, image_url, created_at)
           VALUES (?,?,?,?,?,?,?,?,?,?)`,
          [
            row.id,
            row.group_id,
            row.user_id,
            row.content,
            row.is_ghost ? 1 : 0,
            row.message_type,
            row.category,
            row.parent_id,
            row.image_url,
            new Date(row.created_at).getTime(),
          ]
        );
        merged++;
      }
      await db.run('COMMIT');
    } catch (e) {
      await db.run('ROLLBACK');
      throw e;
    }

    // Update cursor to last item created_at
    const lastCreated = rows[rows.length - 1]?.created_at as string;
    if (lastCreated) await this.setSyncState(`group:${groupId}:last_cursor`, lastCreated);

    console.log(`[sync] merged count=${merged}`);
    return { merged, since: sinceIso };
  }
}