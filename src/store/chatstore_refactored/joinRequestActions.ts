import { joinRequestService, JoinRequest } from '@/lib/joinRequestService';
import { sqliteService } from '@/lib/sqliteService';
import { Capacitor } from '@capacitor/core';

export interface JoinRequestActions {
  fetchPendingJoinRequests: (groupId: string) => Promise<void>;
  approveJoinRequest: (requestId: string, groupId: string) => Promise<void>;
  rejectJoinRequest: (requestId: string, groupId: string) => Promise<void>;
  getPendingRequestCount: (groupId: string) => Promise<number>;
}

export const createJoinRequestActions = (set: any, get: any): JoinRequestActions => ({
  /**
   * Fetch pending join requests for a group
   */
  fetchPendingJoinRequests: async (groupId: string) => {
    try {
      console.log('[JoinRequestActions] Fetching pending requests for group:', groupId);

      // Fetch from Supabase
      const { data, error } = await joinRequestService.fetchPendingRequests(groupId);

      if (error) {
        console.error('[JoinRequestActions] Error fetching pending requests:', error);
        
        // Fallback to SQLite if available
        const isNative = Capacitor.isNativePlatform();
        const isSqliteReady = isNative && await sqliteService.isReady();
        
        if (isSqliteReady) {
          console.log('[JoinRequestActions] Falling back to SQLite for pending requests');
          const localRequests = await sqliteService.getPendingJoinRequests(groupId);
          set({ pendingJoinRequests: localRequests });
          return;
        }
        
        throw error;
      }

      // Update state with fetched requests
      set({ pendingJoinRequests: data || [] });

      // Save to SQLite for offline access
      const isNative = Capacitor.isNativePlatform();
      const isSqliteReady = isNative && await sqliteService.isReady();
      
      if (isSqliteReady && data) {
        console.log(`[JoinRequestActions] 💾 Saving ${data.length} pending requests to SQLite`);
        for (const request of data) {
          await sqliteService.saveJoinRequest({
            id: request.id,
            group_id: request.group_id,
            user_id: request.user_id,
            invited_by: request.invited_by,
            status: request.status,
            created_at: new Date(request.created_at).getTime(),
            updated_at: request.updated_at ? new Date(request.updated_at).getTime() : Date.now(),
          });
        }
      }

      console.log(`[JoinRequestActions] ✅ Fetched ${data?.length || 0} pending requests`);
    } catch (error) {
      console.error('[JoinRequestActions] Exception fetching pending requests:', error);
      throw error;
    }
  },

  /**
   * Approve a join request
   * This will automatically add the user to the group via database trigger
   */
  approveJoinRequest: async (requestId: string, groupId: string) => {
    try {
      console.log('[JoinRequestActions] Approving join request:', requestId);

      const { error } = await joinRequestService.approveJoinRequest(requestId);

      if (error) {
        console.error('[JoinRequestActions] Error approving join request:', error);
        throw error;
      }

      // Update SQLite
      const isNative = Capacitor.isNativePlatform();
      const isSqliteReady = isNative && await sqliteService.isReady();
      
      if (isSqliteReady) {
        await sqliteService.updateJoinRequestStatus(requestId, 'approved');
      }

      // Remove from pending requests in state
      const currentRequests = get().pendingJoinRequests || [];
      set({
        pendingJoinRequests: currentRequests.filter((r: JoinRequest) => r.id !== requestId)
      });

      // Refresh group members to show the newly added member
      await get().fetchGroupMembers(groupId);

      console.log('[JoinRequestActions] ✅ Join request approved');
    } catch (error) {
      console.error('[JoinRequestActions] Exception approving join request:', error);
      throw error;
    }
  },

  /**
   * Reject a join request
   */
  rejectJoinRequest: async (requestId: string, _groupId: string) => {
    try {
      console.log('[JoinRequestActions] Rejecting join request:', requestId);

      const { error } = await joinRequestService.rejectJoinRequest(requestId);

      if (error) {
        console.error('[JoinRequestActions] Error rejecting join request:', error);
        throw error;
      }

      // Update SQLite
      const isNative = Capacitor.isNativePlatform();
      const isSqliteReady = isNative && await sqliteService.isReady();
      
      if (isSqliteReady) {
        await sqliteService.updateJoinRequestStatus(requestId, 'rejected');
      }

      // Remove from pending requests in state
      const currentRequests = get().pendingJoinRequests || [];
      set({
        pendingJoinRequests: currentRequests.filter((r: JoinRequest) => r.id !== requestId)
      });

      console.log('[JoinRequestActions] ✅ Join request rejected');
    } catch (error) {
      console.error('[JoinRequestActions] Exception rejecting join request:', error);
      throw error;
    }
  },

  /**
   * Get count of pending join requests for a group
   */
  getPendingRequestCount: async (groupId: string): Promise<number> => {
    try {
      const { data, error } = await joinRequestService.getPendingRequestCount(groupId);

      if (error) {
        console.error('[JoinRequestActions] Error getting pending request count:', error);
        
        // Fallback to SQLite
        const isNative = Capacitor.isNativePlatform();
        const isSqliteReady = isNative && await sqliteService.isReady();
        
        if (isSqliteReady) {
          return await sqliteService.getPendingJoinRequestCount(groupId);
        }
        
        return 0;
      }

      return data;
    } catch (error) {
      console.error('[JoinRequestActions] Exception getting pending request count:', error);
      return 0;
    }
  },
});

