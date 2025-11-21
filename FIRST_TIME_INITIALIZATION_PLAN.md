# First-Time Initialization Plan - WhatsApp-Style Robust System

## 🎯 Goal
Create a robust, WhatsApp-style first-time initialization system that:
1. Triggers on first login/signup OR when local storage is cleared OR after app reinstall
2. Syncs ALL data from Supabase to local SQLite in one comprehensive flow
3. Handles errors gracefully without dropping data
4. Shows progress to the user via the existing loading/setup page
5. Does NOT modify existing app functions

## 📊 Current State Analysis

### Existing Flow
1. **Login/Signup** → User authenticates via Truecaller or OTP
2. **Onboarding** → User sets name and avatar (`/onboarding/name`)
3. **Setup Page** → Contacts permission + sync (`/setup`)
4. **Dashboard** → Groups loaded on-demand via `fetchGroups()`

### Current Data Sync Points
- **Contacts**: Synced in SetupPage (device → SQLite → Supabase discovery)
- **Groups**: Fetched lazily in DashboardPage via `fetchGroups()`
- **Group Members**: Fetched per-group via `fetchGroupMembers(groupId)`
- **Messages**: Fetched per-group when opening chat
- **Users**: Synced incrementally as needed

### Issues with Current Approach
1. ❌ No comprehensive first-time data sync
2. ❌ Groups/members loaded lazily (slow first experience)
3. ❌ No guarantee all data is in SQLite before user starts
4. ❌ Cascade deletes could fail if data isn't properly synced
5. ❌ No recovery mechanism if sync fails partway through

## 🏗️ Proposed Architecture

### Phase 1: Detection System
Create a robust system to detect first-time initialization scenarios:

```typescript
// src/lib/initializationDetector.ts
export const needsFirstTimeInit = async (): Promise<boolean> => {
  console.log('🔍 Checking if first-time initialization is needed...');
  
  // Check 1: Is setup marked as complete?
  const isComplete = localStorage.getItem('setup_complete');
  if (!isComplete) {
    console.log('✅ First-time init needed: setup_complete flag missing');
    return true;
  }
  
  // Check 2: Verify data reality (flag might be true but data gone)
  // This handles Android "Clear Data" scenarios where localStorage persists but SQLite doesn't
  try {
    const user = useAuthStore.getState().user;
    if (!user) {
      console.log('✅ First-time init needed: no authenticated user');
      return true;
    }
    
    // CRITICAL: Verify the user's profile exists in SQLite
    const hasProfile = await sqliteService.getUser(user.id);
    if (!hasProfile) {
      console.warn('⚠️ Setup flag was true, but user profile missing from SQLite');
      console.log('✅ First-time init needed: data reality check failed');
      return true;
    }
    
    // Check 3: Verify user has groups data
    const hasGroups = await sqliteService.hasAnyGroups();
    if (!hasGroups) {
      console.warn('⚠️ Setup flag was true, but no groups in SQLite');
      console.log('✅ First-time init needed: no groups found');
      return true;
    }
    
    // Check 4: Verify database integrity
    const dbIntegrity = await sqliteService.checkDataIntegrity();
    if (!dbIntegrity.valid) {
      console.warn('⚠️ Database integrity check failed:', dbIntegrity.issues);
      console.log('✅ First-time init needed: database corrupted');
      return true;
    }
    
    console.log('✅ First-time init NOT needed: all checks passed');
    return false;
  } catch (error) {
    console.error('❌ Error checking init status:', error);
    // Safe default: re-initialize on error
    return true;
  }
};
```

### Phase 2: Comprehensive Sync Service
Create a new service to handle full data synchronization:

```typescript
// src/lib/firstTimeInitService.ts
export class FirstTimeInitService {
  
  async performFullSync(
    userId: string,
    onProgress?: (step: string, current: number, total: number) => void
  ): Promise<void> {
    
    const steps = [
      'Syncing contacts',
      'Discovering registered users',
      'Fetching groups',
      'Fetching group members',
      'Syncing user profiles',
      'Loading recent messages',
      'Preparing local database'
    ];
    
    try {
      // Step 1: Sync contacts (already implemented)
      onProgress?.('Syncing contacts', 1, steps.length);
      await contactsService.syncContacts();
      await contactsService.discoverInBackgroundV3();
      
      // Step 2: Fetch ALL groups user is member of
      onProgress?.('Fetching groups', 2, steps.length);
      const groups = await this.fetchAllUserGroups(userId);
      await this.saveGroupsToSQLite(groups);
      
      // Step 3: Fetch ALL group members for ALL groups
      onProgress?.('Fetching group members', 3, steps.length);
      await this.fetchAndSaveAllGroupMembers(groups);
      
      // Step 4: Fetch user profiles for all group members
      onProgress?.('Syncing user profiles', 4, steps.length);
      await this.fetchAndSaveAllUserProfiles(groups);
      
      // Step 5: CRITICAL - Fetch recent messages for instant chat readiness
      // WhatsApp-style: Load last 50 messages per group so chats aren't empty
      onProgress?.('Loading recent messages', 5, steps.length);
      await this.fetchRecentMessagesForAllGroups(groups, userId);
      
      // Step 6: Initialize read status tracking
      onProgress?.('Preparing local database', 6, steps.length);
      await this.initializeReadStatusForAllGroups(groups, userId);
      
      // Step 7: Mark initialization as complete
      onProgress?.('Complete', 7, steps.length);
      localStorage.setItem('last_full_init', Date.now().toString());
      localStorage.setItem('setup_complete', 'true');
      
    } catch (error) {
      console.error('❌ First-time init failed:', error);
      // DO NOT clear data on error - keep partial sync
      throw error;
    }
  }
  
  private async fetchAllUserGroups(userId: string): Promise<Group[]> {
    // Fetch from Supabase with retry logic
    const client = await supabasePipeline.getDirectClient();
    const { data, error } = await client
      .from('group_members')
      .select(`
        group_id,
        groups (
          id,
          name,
          description,
          invite_code,
          created_by,
          created_at,
          avatar_url
        )
      `)
      .eq('user_id', userId);
    
    if (error) throw error;
    return data.map(item => item.groups).filter(Boolean);
  }
  
  private async fetchAndSaveAllGroupMembers(groups: Group[]): Promise<void> {
    // Fetch members for ALL groups in parallel (with concurrency limit)
    const BATCH_SIZE = 5;
    for (let i = 0; i < groups.length; i += BATCH_SIZE) {
      const batch = groups.slice(i, i + BATCH_SIZE);
      await Promise.all(
        batch.map(group => this.fetchAndSaveGroupMembers(group.id))
      );
    }
  }
  
  private async fetchAndSaveGroupMembers(groupId: string): Promise<void> {
    const { data, error } = await supabasePipeline.fetchGroupMembers(groupId);
    if (error) {
      console.warn(`⚠️ Failed to fetch members for group ${groupId}:`, error);
      return; // Continue with other groups
    }
    
    // CRITICAL: Save to SQLite with UPSERT that preserves local read status
    // This prevents overwriting last_read_message_id if it already exists locally
    for (const member of data) {
      // Check if member already exists locally
      const existingMember = await sqliteService.getGroupMember(
        member.group_id,
        member.user_id
      );
      
      // AUDIT LOG: Track creates vs updates for debugging
      if (existingMember) {
        console.log(`[AUDIT] 🔄 Updating group_member: ${member.group_id}/${member.user_id}`);
      } else {
        console.log(`[AUDIT] ✨ Creating group_member: ${member.group_id}/${member.user_id}`);
      }
      
      // UPSERT with preservation logic:
      // - If row exists: preserve last_read_at and last_read_message_id
      // - If new row: initialize with 0/null
      await sqliteService.saveGroupMember({
        group_id: member.group_id,
        user_id: member.user_id,
        role: member.role || 'participant',
        joined_at: new Date(member.joined_at).getTime(),
        // Preserve existing read status, or initialize to 0/null
        last_read_at: existingMember?.last_read_at || 0,
        last_read_message_id: existingMember?.last_read_message_id || null
      });
    }
  }
  
  private async fetchAndSaveAllUserProfiles(groups: Group[]): Promise<void> {
    // Get unique user IDs from all groups
    const userIds = new Set<string>();
    for (const group of groups) {
      const members = await sqliteService.getGroupMembers(group.id);
      members.forEach(m => userIds.add(m.user_id));
    }
    
    // Fetch and save user profiles
    for (const userId of userIds) {
      try {
        const { data } = await supabasePipeline.fetchUserProfile(userId);
        if (data) {
          await sqliteService.saveUser({
            id: data.id,
            display_name: data.display_name,
            phone_number: data.phone_number || null,
            avatar_url: data.avatar_url || null,
            is_onboarded: data.is_onboarded ? 1 : 0,
            created_at: new Date(data.created_at).getTime()
          });
        }
      } catch (error) {
        console.warn(`⚠️ Failed to fetch user ${userId}:`, error);
        // Continue with other users
      }
    }
  }
  
  private async fetchRecentMessagesForAllGroups(
    groups: Group[],
    userId: string
  ): Promise<void> {
    // WhatsApp-style: Fetch last 50 messages for each group
    // This ensures chats are instantly readable when user opens them
    
    // Prioritize: Fetch for top 10 most recently active groups first
    // Then fetch for remaining groups in background
    const PRIORITY_GROUP_COUNT = 10;
    const MESSAGES_PER_GROUP = 50;
    
    console.log(`📥 Fetching recent messages for ${groups.length} groups...`);
    
    // Sort groups by last activity (if available) or creation date
    const sortedGroups = [...groups].sort((a, b) => {
      const aTime = new Date(a.created_at).getTime();
      const bTime = new Date(b.created_at).getTime();
      return bTime - aTime; // Most recent first
    });
    
    // Fetch priority groups first (sequential for reliability)
    const priorityGroups = sortedGroups.slice(0, PRIORITY_GROUP_COUNT);
    for (const group of priorityGroups) {
      try {
        await this.fetchAndSaveRecentMessages(group.id, MESSAGES_PER_GROUP);
      } catch (error) {
        console.warn(`⚠️ Failed to fetch messages for group ${group.id}:`, error);
        // Continue with other groups
      }
    }
    
    // Fetch remaining groups in parallel batches
    const remainingGroups = sortedGroups.slice(PRIORITY_GROUP_COUNT);
    const BATCH_SIZE = 5;
    for (let i = 0; i < remainingGroups.length; i += BATCH_SIZE) {
      const batch = remainingGroups.slice(i, i + BATCH_SIZE);
      await Promise.allSettled(
        batch.map(group => this.fetchAndSaveRecentMessages(group.id, MESSAGES_PER_GROUP))
      );
    }
    
    console.log(`✅ Recent messages fetched for all groups`);
  }
  
  private async fetchAndSaveRecentMessages(
    groupId: string,
    limit: number
  ): Promise<void> {
    const { data, error } = await supabasePipeline.fetchMessages(groupId, limit);
    if (error) {
      console.warn(`⚠️ Failed to fetch messages for group ${groupId}:`, error);
      return;
    }
    
    // Save messages to SQLite
    for (const message of data) {
      await sqliteService.saveMessage({
        id: message.id,
        group_id: message.group_id,
        user_id: message.user_id,
        content: message.content,
        is_ghost: message.is_ghost ? 1 : 0,
        message_type: message.message_type || 'text',
        category: message.category || null,
        parent_id: message.parent_id || null,
        image_url: message.image_url || null,
        created_at: new Date(message.created_at).getTime(),
        updated_at: message.updated_at ? new Date(message.updated_at).getTime() : null,
        deleted_at: message.deleted_at ? new Date(message.deleted_at).getTime() : null,
        is_viewed: 0 // Will be updated by unread tracker
      });
    }
    
    console.log(`✅ Saved ${data.length} messages for group ${groupId}`);
  }
  
  private async initializeReadStatusForAllGroups(
    groups: Group[],
    userId: string
  ): Promise<void> {
    // Ensure group_members rows exist for read status tracking
    for (const group of groups) {
      const existing = await sqliteService.getGroupMember(group.id, userId);
      if (!existing) {
        console.log(`[AUDIT] ✨ Creating group_member for read tracking: ${group.id}/${userId}`);
        await sqliteService.saveGroupMember({
          group_id: group.id,
          user_id: userId,
          role: 'participant',
          joined_at: Date.now(),
          last_read_at: 0,
          last_read_message_id: null
        });
      } else {
        console.log(`[AUDIT] ✅ Group_member already exists: ${group.id}/${userId}`);
      }
    }
  }
}
```

### Phase 3: Integration Points

#### 3.1 Update SetupPage.tsx
Enhance the existing setup page to include comprehensive sync:

```typescript
// src/pages/onboarding/SetupPage.tsx
const steps = [
  {
    id: 'contacts',
    title: 'Access Your Contacts',
    // ... existing
  },
  {
    id: 'sync',
    title: 'Setting Up Your Account',
    description: 'Syncing your groups and messages',
    action: async () => {
      const { user } = useAuthStore.getState();
      if (!user) throw new Error('Not authenticated');
      
      // Perform comprehensive first-time sync
      await firstTimeInitService.performFullSync(
        user.id,
        (step, current, total) => {
          // Update progress UI
          setSyncProgress({
            message: step,
            current,
            total
          });
        }
      );
    }
  },
  // ... rest
];
```

#### 3.2 Update App.tsx
Add first-time init check in the app initialization:

```typescript
// src/App.tsx - in setupAuth()
if (Capacitor.isNativePlatform()) {
  await sqliteService.initialize();
  
  // Check if first-time init is needed
  const needsInit = await needsFirstTimeInit();
  if (needsInit && user?.id) {
    console.log('🔄 First-time initialization needed');
    // Redirect to setup page if not already there
    if (window.location.pathname !== '/setup') {
      navigate('/setup', { replace: true });
    }
  }
}
```

#### 3.3 Update ProtectedRoute.tsx
Add logic to redirect to setup if first-time init is incomplete:

```typescript
// src/components/ProtectedRoute.tsx
const setupComplete = localStorage.getItem('setup_complete');
const needsInit = await needsFirstTimeInit();

if (user && !setupComplete && needsInit) {
  return <Navigate to="/setup" replace />;
}
```

### Phase 4: Error Handling & Recovery

#### 4.1 Graceful Degradation
- If sync fails, keep partial data
- Allow user to continue with limited functionality
- Show retry option in settings

#### 4.2 No Data Loss
- Never drop rows on cascade failure
- Use `INSERT OR REPLACE` for idempotency
- Validate foreign keys before insert

#### 4.3 Progress Persistence
- Save sync progress to SQLite
- Resume from last successful step on retry
- Clear progress only on complete success

### Phase 5: CASCADE Safety

#### 5.1 Ensure Proper Order
```typescript
// Always save in this order to respect foreign keys:
1. groups
2. users
3. group_members (depends on groups + users)
4. messages (depends on groups + users)
5. reactions/polls (depends on messages)
```

#### 5.2 Validate Before Insert
```typescript
// Before saving group_member:
const groupExists = await sqliteService.getGroup(groupId);
const userExists = await sqliteService.getUser(userId);
if (!groupExists || !userExists) {
  console.warn('⚠️ Skipping group_member - missing parent');
  return;
}
```

## 📝 Implementation Checklist

### New Files to Create
- [ ] `src/lib/initializationDetector.ts` - Detection logic
- [ ] `src/lib/firstTimeInitService.ts` - Comprehensive sync service
- [ ] `src/lib/syncProgressTracker.ts` - Progress persistence

### Files to Modify
- [ ] `src/pages/onboarding/SetupPage.tsx` - Add comprehensive sync step
- [ ] `src/App.tsx` - Add first-time init check
- [ ] `src/components/ProtectedRoute.tsx` - Add setup redirect logic
- [ ] `src/lib/sqliteServices_Refactored/sqliteService.ts` - Add helper methods

### Helper Methods Needed in SQLiteService
```typescript
// src/lib/sqliteServices_Refactored/sqliteService.ts

/**
 * Check if any groups exist in SQLite
 */
public async hasAnyGroups(): Promise<boolean>

/**
 * Get a specific group member (for UPSERT preservation logic)
 * CRITICAL: Used to preserve last_read_message_id during sync
 */
public async getGroupMember(groupId: string, userId: string): Promise<GroupMember | null>

/**
 * Get a specific user profile
 * CRITICAL: Used in needsFirstTimeInit to verify data reality
 */
public async getUser(userId: string): Promise<User | null>

/**
 * Validate foreign key integrity
 */
public async validateForeignKeys(): Promise<boolean>

/**
 * Get sync progress (for resume capability)
 */
public async getSyncProgress(): Promise<SyncProgress | null>

/**
 * Save sync progress (for resume capability)
 */
public async saveSyncProgress(progress: SyncProgress): Promise<void>

/**
 * Clear sync progress (on complete success)
 */
public async clearSyncProgress(): Promise<void>

/**
 * UPSERT group member with preservation logic
 * CRITICAL: Must use SQL ON CONFLICT to preserve last_read_message_id
 * 
 * SQL Implementation:
 * INSERT INTO group_members (group_id, user_id, role, joined_at, last_read_at, last_read_message_id)
 * VALUES (?, ?, ?, ?, ?, ?)
 * ON CONFLICT (group_id, user_id) DO UPDATE SET
 *   role = excluded.role,
 *   joined_at = excluded.joined_at,
 *   -- PRESERVE: Only update if new value is not null
 *   last_read_at = COALESCE(excluded.last_read_at, group_members.last_read_at),
 *   last_read_message_id = COALESCE(excluded.last_read_message_id, group_members.last_read_message_id)
 */
public async saveGroupMember(member: GroupMemberRow): Promise<void>
```

## 🎯 Success Criteria

1. ✅ First-time users see comprehensive sync on first login
2. ✅ All groups, members, and users synced to SQLite before dashboard
3. ✅ No cascade failures due to missing parent records
4. ✅ Graceful error handling with retry capability
5. ✅ Progress shown to user during sync
6. ✅ Works after app reinstall or local storage clear
7. ✅ No modifications to existing app functions
8. ✅ WhatsApp-style smooth experience

## 🚀 Rollout Strategy

### Phase 1: Core Infrastructure (Day 1)
- Create detection and sync services
- Add helper methods to SQLiteService
- Test in isolation

### Phase 2: Integration (Day 2)
- Update SetupPage with new sync flow
- Add first-time init checks
- Test end-to-end flow

### Phase 3: Error Handling (Day 3)
- Add retry logic
- Implement progress persistence
- Test failure scenarios

### Phase 4: Polish & Testing (Day 4)
- UI/UX improvements
- Performance optimization
- Comprehensive testing

## 📊 Performance Targets

- **First-time sync**: < 30 seconds for 50 groups
- **Retry on failure**: < 5 seconds
- **Progress updates**: Every 500ms
- **Memory usage**: < 100MB during sync
- **Battery impact**: Minimal (background sync)

## 🔒 Data Integrity Guarantees

1. **Atomicity**: Each entity type synced in transactions
2. **Consistency**: Foreign keys validated before insert
3. **Isolation**: No concurrent writes during init
4. **Durability**: Progress persisted to SQLite
5. **Idempotency**: Safe to retry any step
6. **Preservation**: NEVER overwrite non-null local values with nulls from server
7. **Audit Trail**: Log every create/update for debugging zombie row issues

## 🚨 Critical Refinements (Based on Production Debugging)

### 1. Robust Detection Against Partial States
**Problem**: Android "Clear Data" can clear localStorage but not SQLite (or vice versa)
**Solution**: Always verify data reality, not just flags
- Check `setup_complete` flag
- Verify user profile exists in SQLite
- Verify groups exist in SQLite
- Check database integrity

### 2. UPSERT Preservation Logic
**Problem**: Syncing from Supabase could overwrite local `last_read_message_id` with null
**Solution**: Use SQL `COALESCE` in ON CONFLICT clause to preserve non-null local values
```sql
ON CONFLICT (group_id, user_id) DO UPDATE SET
  last_read_message_id = COALESCE(excluded.last_read_message_id, group_members.last_read_message_id)
```

### 3. Recent Messages for Instant Readiness
**Problem**: User finishes setup, opens chat, sees empty screen
**Solution**: Fetch last 50 messages per group during init (WhatsApp-style)
- Prioritize top 10 most active groups
- Fetch remaining groups in background batches
- Dashboard is instantly usable

### 4. Audit Logging for Zombie Row Prevention
**Problem**: We spent hours debugging disappearing `group_members` rows
**Solution**: Log every create/update operation with `[AUDIT]` prefix
```typescript
console.log(`[AUDIT] ✨ Creating group_member: ${groupId}/${userId}`);
console.log(`[AUDIT] 🔄 Updating group_member: ${groupId}/${userId}`);
```

### 5. Never Drop Rows on Cascade Failure
**Implementation**:
1. Always save in correct order: groups → users → group_members → messages
2. Validate parent exists before inserting child
3. Use `INSERT OR REPLACE` for idempotency
4. On error, keep partial data and allow retry

---

**Status**: ✅ Plan approved with critical refinements
**Next Steps**: Proceed with implementation starting with Phase 1
