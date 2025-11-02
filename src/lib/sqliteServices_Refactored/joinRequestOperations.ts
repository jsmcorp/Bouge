import { DatabaseManager } from './database';

export interface LocalJoinRequest {
  id: string;
  group_id: string;
  user_id: string;
  invited_by: string | null;
  status: 'pending' | 'approved' | 'rejected';
  created_at: number;
  updated_at: number;
}

export class JoinRequestOperations {
  constructor(private dbManager: DatabaseManager) {}

  /**
   * Save a join request to local SQLite
   */
  public async saveJoinRequest(request: LocalJoinRequest): Promise<void> {
    await this.dbManager.checkDatabaseReady();
    const db = this.dbManager.getConnection();

    await db.run(
      `INSERT OR REPLACE INTO group_join_requests 
       (id, group_id, user_id, invited_by, status, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?);`,
      [
        request.id,
        request.group_id,
        request.user_id,
        request.invited_by,
        request.status,
        request.created_at,
        request.updated_at
      ]
    );
  }

  /**
   * Get all pending join requests for a group
   */
  public async getPendingRequests(groupId: string): Promise<LocalJoinRequest[]> {
    await this.dbManager.checkDatabaseReady();
    const db = this.dbManager.getConnection();

    const sql = `
      SELECT * FROM group_join_requests 
      WHERE group_id = ? AND status = 'pending'
      ORDER BY created_at ASC
    `;

    const result = await db.query(sql, [groupId]);
    return result.values || [];
  }

  /**
   * Get all join requests for a group (all statuses)
   */
  public async getAllRequests(groupId: string): Promise<LocalJoinRequest[]> {
    await this.dbManager.checkDatabaseReady();
    const db = this.dbManager.getConnection();

    const sql = `
      SELECT * FROM group_join_requests 
      WHERE group_id = ?
      ORDER BY created_at DESC
    `;

    const result = await db.query(sql, [groupId]);
    return result.values || [];
  }

  /**
   * Update join request status
   */
  public async updateRequestStatus(
    requestId: string,
    status: 'pending' | 'approved' | 'rejected'
  ): Promise<void> {
    await this.dbManager.checkDatabaseReady();
    const db = this.dbManager.getConnection();

    await db.run(
      `UPDATE group_join_requests 
       SET status = ?, updated_at = ?
       WHERE id = ?;`,
      [status, Date.now(), requestId]
    );
  }

  /**
   * Delete a join request
   */
  public async deleteJoinRequest(requestId: string): Promise<void> {
    await this.dbManager.checkDatabaseReady();
    const db = this.dbManager.getConnection();

    await db.run(
      `DELETE FROM group_join_requests WHERE id = ?;`,
      [requestId]
    );
  }

  /**
   * Check if a user has a pending request for a group
   */
  public async hasPendingRequest(groupId: string, userId: string): Promise<boolean> {
    await this.dbManager.checkDatabaseReady();
    const db = this.dbManager.getConnection();

    const sql = `
      SELECT id FROM group_join_requests 
      WHERE group_id = ? AND user_id = ? AND status = 'pending'
      LIMIT 1
    `;

    const result = await db.query(sql, [groupId, userId]);
    return (result.values?.length || 0) > 0;
  }

  /**
   * Get count of pending requests for a group
   */
  public async getPendingRequestCount(groupId: string): Promise<number> {
    await this.dbManager.checkDatabaseReady();
    const db = this.dbManager.getConnection();

    const sql = `
      SELECT COUNT(*) as count FROM group_join_requests 
      WHERE group_id = ? AND status = 'pending'
    `;

    const result = await db.query(sql, [groupId]);
    return result.values?.[0]?.count || 0;
  }

  /**
   * Clear all join requests for a group (used when leaving/deleting group)
   */
  public async clearGroupRequests(groupId: string): Promise<void> {
    await this.dbManager.checkDatabaseReady();
    const db = this.dbManager.getConnection();

    await db.run(
      `DELETE FROM group_join_requests WHERE group_id = ?;`,
      [groupId]
    );
  }
}

