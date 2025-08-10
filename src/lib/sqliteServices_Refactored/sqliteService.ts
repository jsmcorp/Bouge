import { DatabaseManager } from './database';
import { MessageOperations } from './messageOperations';
import { GroupOperations } from './groupOperations';
import { UserOperations } from './userOperations';
import { PollOperations } from './pollOperations';
import { OutboxOperations } from './outboxOperations';
import { SyncOperations } from './syncOperations';
import { ReactionOperations } from './reactionOperations';
import { MemberOperations } from './memberOperations';
import { ConfessionOperations } from './confessionOperations';
import { UtilityOperations } from './utilityOperations';
import {
  LocalMessage,
  LocalPoll,
  LocalPollVote,
  LocalGroup,
  LocalUser,
  OutboxMessage,
  LocalReaction,
  LocalGroupMember,
  LocalUserPseudonym,
  LocalConfession,
  StorageStats
} from './types';

class SQLiteService {
  private static instance: SQLiteService;
  private dbManager: DatabaseManager;
  private messageOps: MessageOperations;
  private groupOps: GroupOperations;
  private userOps: UserOperations;
  private pollOps: PollOperations;
  private outboxOps: OutboxOperations;
  private syncOps: SyncOperations;
  private reactionOps: ReactionOperations;
  private memberOps: MemberOperations;
  private confessionOps: ConfessionOperations;
  private utilityOps: UtilityOperations;

  private constructor() {
    this.dbManager = new DatabaseManager();
    this.messageOps = new MessageOperations(this.dbManager);
    this.groupOps = new GroupOperations(this.dbManager);
    this.userOps = new UserOperations(this.dbManager);
    this.pollOps = new PollOperations(this.dbManager);
    this.outboxOps = new OutboxOperations(this.dbManager);
    this.syncOps = new SyncOperations(this.dbManager);
    this.reactionOps = new ReactionOperations(this.dbManager);
    this.memberOps = new MemberOperations(this.dbManager);
    this.confessionOps = new ConfessionOperations(this.dbManager);
    this.utilityOps = new UtilityOperations(this.dbManager);
  }

  public static getInstance(): SQLiteService {
    if (!SQLiteService.instance) SQLiteService.instance = new SQLiteService();
    return SQLiteService.instance;
  }

  // Database management
  public async initialize(): Promise<void> {
    return this.dbManager.initialize();
  }

  public async isReady(): Promise<boolean> {
    return this.dbManager.isReady();
  }

  public async checkDatabaseReady(): Promise<void> {
    return this.dbManager.checkDatabaseReady();
  }

  public async close(): Promise<void> {
    return this.dbManager.close();
  }

  // Message operations
  public async saveMessage(message: Omit<LocalMessage, 'local_id'>): Promise<void> {
    return this.messageOps.saveMessage(message);
  }

  public async getMessages(groupId: string, limit = 50, offset = 0): Promise<LocalMessage[]> {
    return this.messageOps.getMessages(groupId, limit, offset);
  }

  public async getAllMessagesForGroup(groupId: string): Promise<LocalMessage[]> {
    return this.messageOps.getAllMessagesForGroup(groupId);
  }

  public async getLatestMessageTimestamp(groupId: string): Promise<number> {
    return this.messageOps.getLatestMessageTimestamp(groupId);
  }

  public async deleteMessage(messageId: string): Promise<void> {
    return this.messageOps.deleteMessage(messageId);
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
    return this.messageOps.syncMessagesFromRemote(groupId, messages);
  }

  // Group operations
  public async saveGroup(group: LocalGroup): Promise<void> {
    return this.groupOps.saveGroup(group);
  }

  public async getGroups(): Promise<LocalGroup[]> {
    return this.groupOps.getGroups();
  }

  public async getLastSyncTimestamp(groupId: string): Promise<number> {
    return this.groupOps.getLastSyncTimestamp(groupId);
  }

  public async updateLastSyncTimestamp(groupId: string, timestamp: number): Promise<void> {
    return this.groupOps.updateLastSyncTimestamp(groupId, timestamp);
  }

  // User operations
  public async saveUser(user: LocalUser): Promise<void> {
    return this.userOps.saveUser(user);
  }

  public async getUser(userId: string): Promise<LocalUser | null> {
    return this.userOps.getUser(userId);
  }

  // Poll operations
  public async savePoll(poll: Omit<LocalPoll, 'local_id'>): Promise<void> {
    return this.pollOps.savePoll(poll);
  }

  public async getPolls(messageIds: string[]): Promise<LocalPoll[]> {
    return this.pollOps.getPolls(messageIds);
  }

  public async savePollVote(vote: Omit<LocalPollVote, 'local_id'>): Promise<void> {
    return this.pollOps.savePollVote(vote);
  }

  public async getPollVotes(pollIds: string[]): Promise<LocalPollVote[]> {
    return this.pollOps.getPollVotes(pollIds);
  }

  // Outbox operations
  public async addToOutbox(message: Omit<OutboxMessage, 'id'>): Promise<void> {
    return this.outboxOps.addToOutbox(message);
  }

  public async getOutboxMessages(): Promise<OutboxMessage[]> {
    return this.outboxOps.getOutboxMessages();
  }

  public async removeFromOutbox(id: number): Promise<void> {
    return this.outboxOps.removeFromOutbox(id);
  }

  public async updateOutboxRetry(id: number, retryCount: number, nextRetryAt: number): Promise<void> {
    return this.outboxOps.updateOutboxRetry(id, retryCount, nextRetryAt);
  }

  // Sync operations
  public async setSyncState(key: string, value: string): Promise<void> {
    return this.syncOps.setSyncState(key, value);
  }

  public async getSyncState(key: string): Promise<string | null> {
    return this.syncOps.getSyncState(key);
  }

  // Reaction operations
  public async saveReaction(reaction: Omit<LocalReaction, 'local_id'>): Promise<void> {
    return this.reactionOps.saveReaction(reaction);
  }

  public async getReactions(messageIds: string[]): Promise<LocalReaction[]> {
    return this.reactionOps.getReactions(messageIds);
  }

  // Member operations
  public async saveGroupMember(member: LocalGroupMember): Promise<void> {
    return this.memberOps.saveGroupMember(member);
  }

  public async getGroupMembers(groupId: string): Promise<LocalGroupMember[]> {
    return this.memberOps.getGroupMembers(groupId);
  }

  public async saveUserPseudonym(pseudonym: LocalUserPseudonym): Promise<void> {
    return this.memberOps.saveUserPseudonym(pseudonym);
  }

  public async getUserPseudonyms(groupId: string): Promise<LocalUserPseudonym[]> {
    return this.memberOps.getUserPseudonyms(groupId);
  }

  // Confession operations
  public async saveConfession(confession: LocalConfession): Promise<void> {
    return this.confessionOps.saveConfession(confession);
  }

  public async getConfessions(messageIds: string[]): Promise<LocalConfession[]> {
    return this.confessionOps.getConfessions(messageIds);
  }

  // Utility operations
  public async clearAllData(): Promise<void> {
    return this.utilityOps.clearAllData();
  }

  public async getStorageStats(): Promise<StorageStats> {
    return this.utilityOps.getStorageStats();
  }
}

export const sqliteService = SQLiteService.getInstance();