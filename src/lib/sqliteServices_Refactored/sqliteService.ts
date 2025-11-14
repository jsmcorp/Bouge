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
import { ContactOperations } from './contactOperations';
import { SyncMetadataOperations } from './syncMetadataOperations';
import { JoinRequestOperations, LocalJoinRequest } from './joinRequestOperations';
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
  StorageStats,
  LocalContact,
  ContactUserMapping,
  RegisteredContact
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
  private contactOps: ContactOperations;
  private syncMetadataOps: SyncMetadataOperations;
  private joinRequestOps: JoinRequestOperations;

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
    this.contactOps = new ContactOperations(this.dbManager);
    this.syncMetadataOps = new SyncMetadataOperations(this.dbManager);
    this.joinRequestOps = new JoinRequestOperations(this.dbManager);
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

  public async getRecentMessages(groupId: string, limit = 10): Promise<LocalMessage[]> {
    return this.messageOps.getRecentMessages(groupId, limit);
  }

  public async getMessagesBefore(groupId: string, beforeTimestamp: number, limit = 30): Promise<LocalMessage[]> {
    return this.messageOps.getMessagesBefore(groupId, beforeTimestamp, limit);
  }

  public async getLatestMessageTimestamp(groupId: string): Promise<number> {
    return this.messageOps.getLatestMessageTimestamp(groupId);
  }

  public async deleteMessage(messageId: string): Promise<void> {
    return this.messageOps.deleteMessage(messageId);
  }

  public async deleteMessages(messageIds: string[]): Promise<void> {
    return this.messageOps.deleteMessages(messageIds);
  }

  public async messageExists(messageId: string): Promise<boolean> {
    return this.messageOps.messageExists(messageId);
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

  public async deleteGroup(groupId: string): Promise<void> {
    return this.groupOps.deleteGroup(groupId);
  }

  public async updateGroupCreator(groupId: string, createdBy: string): Promise<void> {
    return this.groupOps.updateGroupCreator(groupId, createdBy);
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

  public async syncMissed(groupId: string): Promise<{ merged: number; since: string | null }> {
    return this.syncOps.syncMissed(groupId);
  }

  // Reaction operations
  public async saveReaction(reaction: Omit<LocalReaction, 'local_id'>): Promise<void> {
    return this.reactionOps.saveReaction(reaction);
  }

  public async getReactions(messageIds: string[]): Promise<LocalReaction[]> {
    return this.reactionOps.getReactions(messageIds);
  }

  public async deleteReaction(messageId: string, userId: string, emoji: string): Promise<void> {
    return this.reactionOps.deleteReaction(messageId, userId, emoji);
  }

  public async getReactionsForMessage(messageId: string): Promise<LocalReaction[]> {
    return this.reactionOps.getReactionsForMessage(messageId);
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

  public async deleteGroupMember(groupId: string, userId: string): Promise<void> {
    return this.memberOps.deleteGroupMember(groupId, userId);
  }

  public async updateGroupMemberRole(groupId: string, userId: string, role: string): Promise<void> {
    return this.memberOps.updateGroupMemberRole(groupId, userId, role);
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

  // ============================================
  // CONTACTS OPERATIONS
  // ============================================

  /**
   * Save multiple contacts to SQLite (batch insert/update)
   */
  public async saveContacts(contacts: Omit<LocalContact, 'id'>[]): Promise<void> {
    return this.contactOps.saveContacts(contacts);
  }

  /**
   * Get all contacts from SQLite
   */
  public async getAllContacts(): Promise<LocalContact[]> {
    return this.contactOps.getAllContacts();
  }

  /**
   * Search contacts by name or phone number
   */
  public async searchContacts(query: string): Promise<LocalContact[]> {
    return this.contactOps.searchContacts(query);
  }

  /**
   * Get contact by phone number
   */
  public async getContactByPhone(phoneNumber: string): Promise<LocalContact | null> {
    return this.contactOps.getContactByPhone(phoneNumber);
  }

  /**
   * Save contact-to-user mappings (batch insert/update)
   */
  public async saveContactUserMapping(mappings: ContactUserMapping[]): Promise<void> {
    return this.contactOps.saveContactUserMapping(mappings);
  }

  /**
   * Get all registered contacts (contacts that are Confessr users)
   */
  public async getRegisteredContacts(): Promise<RegisteredContact[]> {
    return this.contactOps.getRegisteredContacts();
  }

  /**
   * Get contact count
   */
  public async getContactCount(): Promise<number> {
    return this.contactOps.getContactCount();
  }

  /**
   * Get registered contact count
   */
  public async getRegisteredContactCount(): Promise<number> {
    return this.contactOps.getRegisteredContactCount();
  }

  /**
   * Check if a phone number is a registered user
   */
  public async isRegisteredUser(phoneNumber: string): Promise<boolean> {
    return this.contactOps.isRegisteredUser(phoneNumber);
  }

  /**
   * Get user info for a contact by phone number
   */
  public async getUserMappingByPhone(phoneNumber: string): Promise<ContactUserMapping | null> {
    return this.contactOps.getUserMappingByPhone(phoneNumber);
  }

  /**
   * Clear all contacts and mappings
   */
  public async clearContacts(): Promise<void> {
    return this.contactOps.clearContacts();
  }

  /**
   * Clear only contact-user mappings (keep contacts)
   */
  public async clearContactMappings(): Promise<void> {
    return this.contactOps.clearMappings();
  }

  /**
   * Get last sync timestamp for contacts
   */
  public async getContactsLastSyncTime(): Promise<number | null> {
    return this.contactOps.getLastSyncTime();
  }

  // ============================================
  // SYNC METADATA OPERATIONS
  // ============================================

  /**
   * Get last full sync timestamp
   */
  public async getLastFullSyncTime(): Promise<number | null> {
    return this.syncMetadataOps.getLastFullSyncTime();
  }

  /**
   * Set last full sync timestamp
   */
  public async setLastFullSyncTime(timestamp: number): Promise<void> {
    return this.syncMetadataOps.setLastFullSyncTime(timestamp);
  }

  /**
   * Get last incremental sync timestamp
   */
  public async getLastIncrementalSyncTime(): Promise<number | null> {
    return this.syncMetadataOps.getLastIncrementalSyncTime();
  }

  /**
   * Set last incremental sync timestamp
   */
  public async setLastIncrementalSyncTime(timestamp: number): Promise<void> {
    return this.syncMetadataOps.setLastIncrementalSyncTime(timestamp);
  }

  /**
   * Get total contacts synced count
   */
  public async getTotalContactsSynced(): Promise<number> {
    return this.syncMetadataOps.getTotalContactsSynced();
  }

  /**
   * Set total contacts synced count
   */
  public async setTotalContactsSynced(count: number): Promise<void> {
    return this.syncMetadataOps.setTotalContactsSynced(count);
  }

  /**
   * Get device contact count from last sync
   */
  public async getLastDeviceContactCount(): Promise<number> {
    return this.syncMetadataOps.getLastDeviceContactCount();
  }

  /**
   * Set device contact count
   */
  public async setLastDeviceContactCount(count: number): Promise<void> {
    return this.syncMetadataOps.setLastDeviceContactCount(count);
  }

  /**
   * Check if this is the first sync
   */
  public async isFirstSync(): Promise<boolean> {
    return this.syncMetadataOps.isFirstSync();
  }

  /**
   * Get contacts checksum (for delta sync)
   */
  public async getContactsChecksum(): Promise<string | null> {
    return this.syncMetadataOps.getContactsChecksum();
  }

  /**
   * Set contacts checksum
   */
  public async setContactsChecksum(checksum: string): Promise<void> {
    return this.syncMetadataOps.setContactsChecksum(checksum);
  }

  /**
   * Get last delta sync timestamp
   */
  public async getLastDeltaSyncTime(): Promise<number | null> {
    return this.syncMetadataOps.getLastDeltaSyncTime();
  }

  /**
   * Set last delta sync timestamp
   */
  public async setLastDeltaSyncTime(timestamp: number): Promise<void> {
    return this.syncMetadataOps.setLastDeltaSyncTime(timestamp);
  }

  /**
   * Get all sync metadata (for debugging)
   */
  public async getAllSyncMetadata(): Promise<Record<string, string>> {
    return this.syncMetadataOps.getAllSyncMetadata();
  }

  /**
   * Clear all sync metadata (for testing/reset)
   */
  public async clearAllSyncMetadata(): Promise<void> {
    return this.syncMetadataOps.clearAllSyncMetadata();
  }

  // Join Request operations
  public async saveJoinRequest(request: LocalJoinRequest): Promise<void> {
    return this.joinRequestOps.saveJoinRequest(request);
  }

  public async getPendingJoinRequests(groupId: string): Promise<LocalJoinRequest[]> {
    return this.joinRequestOps.getPendingRequests(groupId);
  }

  public async getAllJoinRequests(groupId: string): Promise<LocalJoinRequest[]> {
    return this.joinRequestOps.getAllRequests(groupId);
  }

  public async updateJoinRequestStatus(
    requestId: string,
    status: 'pending' | 'approved' | 'rejected'
  ): Promise<void> {
    return this.joinRequestOps.updateRequestStatus(requestId, status);
  }

  public async deleteJoinRequest(requestId: string): Promise<void> {
    return this.joinRequestOps.deleteJoinRequest(requestId);
  }

  public async hasPendingJoinRequest(groupId: string, userId: string): Promise<boolean> {
    return this.joinRequestOps.hasPendingRequest(groupId, userId);
  }

  public async getPendingJoinRequestCount(groupId: string): Promise<number> {
    return this.joinRequestOps.getPendingRequestCount(groupId);
  }

  public async clearGroupJoinRequests(groupId: string): Promise<void> {
    return this.joinRequestOps.clearGroupRequests(groupId);
  }
}

export const sqliteService = SQLiteService.getInstance();