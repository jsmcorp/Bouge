import { DatabaseManager } from './database';
import { LocalPoll, LocalPollVote } from './types';

export class PollOperations {
  constructor(private dbManager: DatabaseManager) {}

  public async savePoll(poll: Omit<LocalPoll, 'local_id'>): Promise<void> {
    await this.dbManager.checkDatabaseReady();
    const db = this.dbManager.getConnection();

    await db.run(
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
    await this.dbManager.checkDatabaseReady();
    const db = this.dbManager.getConnection();

    if (messageIds.length === 0) return [];

    const placeholders = messageIds.map(() => '?').join(',');
    const sql = `
      SELECT * FROM polls 
      WHERE message_id IN (${placeholders})
    `;

    const result = await db.query(sql, messageIds);
    return result.values || [];
  }

  public async savePollVote(vote: Omit<LocalPollVote, 'local_id'>): Promise<void> {
    await this.dbManager.checkDatabaseReady();
    const db = this.dbManager.getConnection();

    await db.run(
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
    await this.dbManager.checkDatabaseReady();
    const db = this.dbManager.getConnection();

    if (pollIds.length === 0) return [];

    const placeholders = pollIds.map(() => '?').join(',');
    const sql = `
      SELECT * FROM poll_votes 
      WHERE poll_id IN (${placeholders})
    `;

    const result = await db.query(sql, pollIds);
    return result.values || [];
  }
}