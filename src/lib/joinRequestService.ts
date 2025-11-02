import { supabasePipeline } from './supabasePipeline';

export interface JoinRequest {
  id: string;
  group_id: string;
  user_id: string;
  invited_by: string | null;
  status: 'pending' | 'approved' | 'rejected';
  created_at: string;
  updated_at: string | null;
  user?: {
    display_name: string;
    phone_number: string;
    avatar_url: string | null;
  };
  inviter?: {
    display_name: string;
    phone_number: string;
    avatar_url: string | null;
  };
}

/**
 * Join Request Service
 * Handles all operations related to group join requests
 */
class JoinRequestService {
  /**
   * Create a new join request
   * @param groupId - The group to request to join
   * @param userId - The user requesting to join
   * @param invitedBy - Optional: The user who invited them (null for invite code joins)
   */
  async createJoinRequest(
    groupId: string,
    userId: string,
    invitedBy: string | null = null
  ): Promise<{ data: JoinRequest | null; error: any }> {
    try {
      const client = await supabasePipeline.getSupabaseClient();
      
      const { data, error } = await client
        .from('group_join_requests')
        .insert({
          group_id: groupId,
          user_id: userId,
          invited_by: invitedBy,
          status: 'pending',
        })
        .select(`
          *,
          user:users!group_join_requests_user_id_fkey(display_name, phone_number, avatar_url),
          inviter:users!group_join_requests_invited_by_fkey(display_name, phone_number, avatar_url)
        `)
        .single();

      if (error) {
        console.error('[JoinRequestService] Error creating join request:', error);
        return { data: null, error };
      }

      return { data: data as JoinRequest, error: null };
    } catch (error) {
      console.error('[JoinRequestService] Exception creating join request:', error);
      return { data: null, error };
    }
  }

  /**
   * Fetch all pending join requests for a group
   * @param groupId - The group ID
   */
  async fetchPendingRequests(groupId: string): Promise<{ data: JoinRequest[] | null; error: any }> {
    try {
      const client = await supabasePipeline.getSupabaseClient();
      
      const { data, error } = await client
        .from('group_join_requests')
        .select(`
          *,
          user:users!group_join_requests_user_id_fkey(display_name, phone_number, avatar_url),
          inviter:users!group_join_requests_invited_by_fkey(display_name, phone_number, avatar_url)
        `)
        .eq('group_id', groupId)
        .eq('status', 'pending')
        .order('created_at', { ascending: true });

      if (error) {
        console.error('[JoinRequestService] Error fetching pending requests:', error);
        return { data: null, error };
      }

      return { data: data as JoinRequest[], error: null };
    } catch (error) {
      console.error('[JoinRequestService] Exception fetching pending requests:', error);
      return { data: null, error };
    }
  }

  /**
   * Fetch all join requests for a group (all statuses)
   * @param groupId - The group ID
   */
  async fetchAllRequests(groupId: string): Promise<{ data: JoinRequest[] | null; error: any }> {
    try {
      const client = await supabasePipeline.getSupabaseClient();
      
      const { data, error } = await client
        .from('group_join_requests')
        .select(`
          *,
          user:users!group_join_requests_user_id_fkey(display_name, phone_number, avatar_url),
          invited_by_user:users!group_join_requests_invited_by_fkey(display_name, phone_number, avatar_url)
        `)
        .eq('group_id', groupId)
        .order('created_at', { ascending: false });

      if (error) {
        console.error('[JoinRequestService] Error fetching all requests:', error);
        return { data: null, error };
      }

      return { data: data as JoinRequest[], error: null };
    } catch (error) {
      console.error('[JoinRequestService] Exception fetching all requests:', error);
      return { data: null, error };
    }
  }

  /**
   * Approve a join request
   * This will automatically add the user to group_members via database trigger
   * @param requestId - The join request ID
   */
  async approveJoinRequest(requestId: string): Promise<{ data: JoinRequest | null; error: any }> {
    try {
      const client = await supabasePipeline.getSupabaseClient();
      
      const { data, error } = await client
        .from('group_join_requests')
        .update({ status: 'approved' })
        .eq('id', requestId)
        .select(`
          *,
          user:users!group_join_requests_user_id_fkey(display_name, phone_number, avatar_url),
          invited_by_user:users!group_join_requests_invited_by_fkey(display_name, phone_number, avatar_url)
        `)
        .single();

      if (error) {
        console.error('[JoinRequestService] Error approving join request:', error);
        return { data: null, error };
      }

      console.log('[JoinRequestService] ✅ Join request approved:', requestId);
      return { data: data as JoinRequest, error: null };
    } catch (error) {
      console.error('[JoinRequestService] Exception approving join request:', error);
      return { data: null, error };
    }
  }

  /**
   * Reject a join request
   * @param requestId - The join request ID
   */
  async rejectJoinRequest(requestId: string): Promise<{ data: JoinRequest | null; error: any }> {
    try {
      const client = await supabasePipeline.getSupabaseClient();
      
      const { data, error } = await client
        .from('group_join_requests')
        .update({ status: 'rejected' })
        .eq('id', requestId)
        .select(`
          *,
          user:users!group_join_requests_user_id_fkey(display_name, phone_number, avatar_url),
          invited_by_user:users!group_join_requests_invited_by_fkey(display_name, phone_number, avatar_url)
        `)
        .single();

      if (error) {
        console.error('[JoinRequestService] Error rejecting join request:', error);
        return { data: null, error };
      }

      console.log('[JoinRequestService] ✅ Join request rejected:', requestId);
      return { data: data as JoinRequest, error: null };
    } catch (error) {
      console.error('[JoinRequestService] Exception rejecting join request:', error);
      return { data: null, error };
    }
  }

  /**
   * Cancel a join request (user cancels their own pending request)
   * @param requestId - The join request ID
   */
  async cancelJoinRequest(requestId: string): Promise<{ data: any | null; error: any }> {
    try {
      const client = await supabasePipeline.getSupabaseClient();
      
      const { data, error } = await client
        .from('group_join_requests')
        .delete()
        .eq('id', requestId)
        .eq('status', 'pending');

      if (error) {
        console.error('[JoinRequestService] Error canceling join request:', error);
        return { data: null, error };
      }

      console.log('[JoinRequestService] ✅ Join request canceled:', requestId);
      return { data, error: null };
    } catch (error) {
      console.error('[JoinRequestService] Exception canceling join request:', error);
      return { data: null, error };
    }
  }

  /**
   * Check if a user has a pending request for a group
   * @param groupId - The group ID
   * @param userId - The user ID
   */
  async hasPendingRequest(groupId: string, userId: string): Promise<{ data: boolean; error: any }> {
    try {
      const client = await supabasePipeline.getSupabaseClient();
      
      const { data, error } = await client
        .from('group_join_requests')
        .select('id')
        .eq('group_id', groupId)
        .eq('user_id', userId)
        .eq('status', 'pending')
        .maybeSingle();

      if (error) {
        console.error('[JoinRequestService] Error checking pending request:', error);
        return { data: false, error };
      }

      return { data: !!data, error: null };
    } catch (error) {
      console.error('[JoinRequestService] Exception checking pending request:', error);
      return { data: false, error };
    }
  }

  /**
   * Get count of pending requests for a group
   * @param groupId - The group ID
   */
  async getPendingRequestCount(groupId: string): Promise<{ data: number; error: any }> {
    try {
      const client = await supabasePipeline.getSupabaseClient();
      
      const { count, error } = await client
        .from('group_join_requests')
        .select('*', { count: 'exact', head: true })
        .eq('group_id', groupId)
        .eq('status', 'pending');

      if (error) {
        console.error('[JoinRequestService] Error getting pending request count:', error);
        return { data: 0, error };
      }

      return { data: count || 0, error: null };
    } catch (error) {
      console.error('[JoinRequestService] Exception getting pending request count:', error);
      return { data: 0, error };
    }
  }
}

// Export singleton instance
export const joinRequestService = new JoinRequestService();

