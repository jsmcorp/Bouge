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
}