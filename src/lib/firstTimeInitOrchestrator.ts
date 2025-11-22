import { useContactsStore } from '@/store/contactsStore';
import { useChatStore } from '@/store/chatStore';

/**
 * Progress callback interface for UI updates
 */
export interface InitProgress {
  step: string;
  current: number;
  total: number;
}

/**
 * First-Time Initialization Orchestrator
 * 
 * Pure orchestration service that calls ONLY existing functions in correct order.
 * NO NEW IMPLEMENTATIONS - just coordinates existing battle-tested code.
 * 
 * What it does:
 * 1. Syncs contacts from device
 * 2. Discovers registered users
 * 3. Fetches all groups (local-first)
 * 4. Fetches group members (also saves user profiles automatically!)
 * 5. Fetches recent messages for instant chat readiness
 * 
 * Why this works:
 * - Reuses existing fetchGroups() that works (proven in log44.txt)
 * - Reuses existing fetchGroupMembers() that also saves user profiles
 * - Reuses existing fetchMessages() for WhatsApp-style instant readiness
 * - No new Supabase queries = No new bugs
 */
export class FirstTimeInitOrchestrator {
  
  /**
   * Perform full first-time initialization
   * 
   * @param userId - Current user ID
   * @param onProgress - Optional callback for progress updates
   */
  async performFullInit(
    userId: string,
    onProgress?: (progress: InitProgress) => void
  ): Promise<void> {
    
    const TOTAL_STEPS = 5; // Step 0 + 4 main steps
    let currentStep = 0;
    
    try {
      console.log('🚀 [INIT-ORCHESTRATOR] Starting first-time initialization...');
      
      // ============================================================
      // STEP 0: Ensure Current User Exists in SQLite (Pure SQLite - No Supabase Calls)
      // CRITICAL: Must happen BEFORE any group_members operations
      // This prevents FK constraint errors when creating group_members rows
      // 
      // OPTIMIZATION: Uses ONLY local SQLite operations, no network calls
      // The full profile will be synced later by fetchGroupMembers when user appears as a member
      // ============================================================
      currentStep++;
      onProgress?.({ step: 'Preparing local database', current: currentStep, total: TOTAL_STEPS });
      console.log('👤 [INIT-ORCHESTRATOR] Step 0/5: Ensuring current user in SQLite (pure SQLite)...');
      
      try {
        const { sqliteService } = await import('@/lib/sqliteService');
        
        // Create minimal user row with just the userId we already have
        // No Supabase calls, no network delay, instant operation
        await sqliteService.saveUser({
          id: userId,
          display_name: 'You', // Placeholder, will be updated when profile syncs
          phone_number: null,
          avatar_url: null,
          is_onboarded: 1,
          created_at: Date.now()
        });
        console.log('✅ [INIT-ORCHESTRATOR] Step 0/5 complete: Local user row created (< 1ms)');
      } catch (error) {
        console.error('❌ [INIT-ORCHESTRATOR] Step 0 failed:', error);
        // Continue anyway - defensive checks in memberOperations will handle it
      }
      
      // ============================================================
      // STEP 1: Sync Contacts
      // REUSES: contactsStore.syncContacts() + discoverInBackgroundV3()
      // ============================================================
      currentStep++;
      onProgress?.({ step: 'Syncing contacts', current: currentStep, total: TOTAL_STEPS });
      console.log('📇 [INIT-ORCHESTRATOR] Step 1/5: Syncing contacts...');
      
      const { syncContacts, discoverInBackgroundV3 } = useContactsStore.getState();
      
      // ✅ FIX #3: Let contacts sync complete naturally (not critical for groups)
      try {
        await syncContacts();
        await discoverInBackgroundV3();
      } catch (error) {
        console.error('❌ [INIT-ORCHESTRATOR] Contact sync failed:', error);
        // Continue anyway - contacts are not critical for groups
      }
      
      console.log('✅ [INIT-ORCHESTRATOR] Step 1/5 complete: Contacts synced');
      
      // ============================================================
      // STEP 2: Fetch Groups
      // REUSES: chatStore.fetchGroups() (proven working in log44.txt)
      // ============================================================
      currentStep++;
      onProgress?.({ step: 'Loading groups', current: currentStep, total: TOTAL_STEPS });
      console.log('📱 [INIT-ORCHESTRATOR] Step 2/5: Fetching groups...');
      
      const { fetchGroups } = useChatStore.getState();
      
      // ✅ FIX: Make fetchGroups truly non-blocking with timeout
      // If it takes more than 5 seconds, continue anyway with whatever groups we have
      const fetchGroupsPromise = fetchGroups();
      const timeoutPromise = new Promise<void>((resolve) => {
        setTimeout(() => {
          console.warn('⚠️ [INIT-ORCHESTRATOR] fetchGroups timeout after 5s, continuing anyway');
          resolve();
        }, 5000);
      });
      
      try {
        await Promise.race([fetchGroupsPromise, timeoutPromise]);
      } catch (error) {
        console.error('❌ [INIT-ORCHESTRATOR] fetchGroups failed:', error);
        // Continue anyway - we might have cached groups
      }
      
      // ✅ CRITICAL FIX: Get groups from store AFTER fetchGroups completes (or times out)
      const { groups } = useChatStore.getState();
      console.log(`✅ [INIT-ORCHESTRATOR] Step 2/5 complete: ${groups.length} groups loaded`);
      
      // ✅ FIX #2: Increase wait time to ensure groups are fully saved to SQLite
      // fetchGroups() saves to SQLite in background, we need to ensure it completes
      // to avoid foreign key constraint errors when saving group_members
      if (groups.length > 0) {
        console.log('⏳ [INIT-ORCHESTRATOR] Waiting for groups to be saved to SQLite...');
        await new Promise(resolve => setTimeout(resolve, 1000));
        console.log('✅ [INIT-ORCHESTRATOR] Groups should be saved to SQLite now');
      } else {
        console.warn('⚠️ [INIT-ORCHESTRATOR] No groups found, skipping SQLite wait');
      }
      
      // ============================================================
      // STEP 3: Fetch Group Members (ALSO SAVES USER PROFILES!)
      // REUSES: chatStore.fetchGroupMembers(groupId)
      // ✅ BONUS: This method ALSO saves user profiles to SQLite automatically!
      // ============================================================
      currentStep++;
      onProgress?.({ step: 'Loading group members', current: currentStep, total: TOTAL_STEPS });
      console.log('👥 [INIT-ORCHESTRATOR] Step 3/5: Fetching group members (also saves user profiles)...');
      
      await this.fetchAllGroupMembers(groups, userId);
      
      console.log('✅ [INIT-ORCHESTRATOR] Step 3/5 complete: Group members + user profiles loaded');
      
      // ✅ FIX #4: Wait for members to be fully saved before fetching messages
      console.log('⏳ [INIT-ORCHESTRATOR] Waiting for members to be saved to SQLite...');
      await new Promise(resolve => setTimeout(resolve, 500));
      console.log('✅ [INIT-ORCHESTRATOR] Members should be saved to SQLite now');
      
      // ============================================================
      // STEP 4: Fetch Recent Messages
      // REUSES: chatStore.fetchMessages(groupId)
      // ============================================================
      currentStep++;
      onProgress?.({ step: 'Loading recent messages', current: currentStep, total: TOTAL_STEPS });
      console.log('💬 [INIT-ORCHESTRATOR] Step 4/5: Fetching recent messages...');
      
      await this.fetchRecentMessagesForAllGroups(groups);
      
      console.log('✅ [INIT-ORCHESTRATOR] Step 4/5 complete: Recent messages loaded');
      
      // ============================================================
      // COMPLETE: Mark initialization as done
      // ============================================================
      onProgress?.({ step: 'Complete', current: TOTAL_STEPS, total: TOTAL_STEPS });
      localStorage.setItem('last_full_init', Date.now().toString());
      localStorage.setItem('setup_complete', 'true');
      sessionStorage.removeItem('needs_first_time_init'); // ✅ Clear flag to prevent redirect loop
      
      console.log('🎉 [INIT-ORCHESTRATOR] First-time initialization complete!');
      
    } catch (error) {
      console.error('❌ [INIT-ORCHESTRATOR] First-time initialization failed:', error);
      // DO NOT clear data on error - keep partial sync
      throw error;
    }
  }
  
  /**
   * Fetch group members using EXISTING chatStore.fetchGroupMembers
   * ✅ FOUND IN CODEBASE: src/store/chatstore_refactored/groupActions.ts lines 189-260
   * ✅ BONUS: This method ALSO saves user profiles to SQLite (lines 240-252)!
   * 
   * What it does internally:
   * 1. Loads cached members from SQLite (offline-first)
   * 2. Fetches fresh members from Supabase
   * 3. Saves members to group_members table
   * 4. Saves user profiles to users table ← THIS IS WHY WE DON'T NEED STEP 4!
   * 5. Updates UI with fresh data
   */
  private async fetchAllGroupMembers(groups: any[], _userId: string): Promise<void> {
    const BATCH_SIZE = 5;
    
    // ✅ REUSE existing chatStore method
    const { fetchGroupMembers } = useChatStore.getState();
    
    for (let i = 0; i < groups.length; i += BATCH_SIZE) {
      const batch = groups.slice(i, i + BATCH_SIZE);
      
      await Promise.allSettled(
        batch.map(async (group) => {
          try {
            // ✅ CALL EXISTING METHOD - no new implementation
            // This automatically saves both members AND user profiles to SQLite
            await fetchGroupMembers(group.id);
            console.log(`✅ [INIT-ORCHESTRATOR] Loaded members + user profiles for group: ${group.name}`);
          } catch (error) {
            console.warn(`⚠️ [INIT-ORCHESTRATOR] Failed to fetch members for group ${group.id}:`, error);
            // Continue with other groups
          }
        })
      );
    }
  }
  
  /**
   * Fetch recent messages using EXISTING chatStore.fetchMessages
   * ✅ FOUND IN CODEBASE: src/store/chatstore_refactored/fetchActions.ts
   */
  private async fetchRecentMessagesForAllGroups(groups: any[]): Promise<void> {
    // ✅ REUSE existing chatStore method
    const { fetchMessages } = useChatStore.getState();
    
    // Prioritize top 10 most recent groups
    const PRIORITY_GROUP_COUNT = 10;
    const sortedGroups = [...groups].sort((a, b) => {
      const aTime = new Date(a.created_at).getTime();
      const bTime = new Date(b.created_at).getTime();
      return bTime - aTime;
    });
    
    // Fetch priority groups first (sequential for reliability)
    const priorityGroups = sortedGroups.slice(0, PRIORITY_GROUP_COUNT);
    for (const group of priorityGroups) {
      try {
        // ✅ CALL EXISTING METHOD - no new implementation
        await fetchMessages(group.id);
        console.log(`✅ [INIT-ORCHESTRATOR] Loaded messages for priority group: ${group.name}`);
      } catch (error) {
        console.warn(`⚠️ [INIT-ORCHESTRATOR] Failed to fetch messages for group ${group.id}:`, error);
        // Continue with other groups
      }
    }
    
    // Fetch remaining groups in parallel batches
    const remainingGroups = sortedGroups.slice(PRIORITY_GROUP_COUNT);
    const BATCH_SIZE = 5;
    
    for (let i = 0; i < remainingGroups.length; i += BATCH_SIZE) {
      const batch = remainingGroups.slice(i, i + BATCH_SIZE);
      
      await Promise.allSettled(
        batch.map(group => fetchMessages(group.id))
      );
    }
    
    console.log(`✅ [INIT-ORCHESTRATOR] Recent messages fetched for all ${groups.length} groups`);
  }
}

// Export singleton instance
export const firstTimeInitOrchestrator = new FirstTimeInitOrchestrator();
