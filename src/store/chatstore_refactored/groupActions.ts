import { supabasePipeline, SupabasePipeline } from '@/lib/supabasePipeline';
import { sqliteService } from '@/lib/sqliteService';
import { joinRequestService } from '@/lib/joinRequestService';
import { Capacitor } from '@capacitor/core';
import { Group, GroupMember, GroupMedia } from './types';

export interface SelectedContact {
  contactId: number;
  phoneNumber: string;
  displayName: string;
  userId?: string; // If registered user
  isRegistered: boolean;
}

// Deduplication: Track in-flight fetchGroupMembers requests
const inFlightMemberFetches = new Map<string, Promise<void>>();

export interface GroupActions {
  createGroup: (name: string, description?: string, selectedContacts?: SelectedContact[]) => Promise<Group>;
  joinGroup: (inviteCode: string) => Promise<{ success: boolean; message: string; group: any }>;
  fetchGroupMembers: (groupId: string) => Promise<void>;
  fetchGroupMedia: (groupId: string) => Promise<void>;
  openGroupDetailsMobile: (groupId: string) => void;
  updateGroup: (groupId: string, updates: { name?: string; description?: string; avatar_url?: string }) => Promise<void>;
  addGroupMember: (groupId: string, userId: string) => Promise<void>;
  addGroupMembers: (groupId: string, userIds: string[]) => Promise<void>;
  removeGroupMember: (groupId: string, userId: string) => Promise<void>;
  leaveGroup: (groupId: string, userId: string) => Promise<void>;
}

export const createGroupActions = (set: any, get: any): GroupActions => ({
  createGroup: async (name: string, description?: string, selectedContacts?: SelectedContact[]) => {
    try {
      const { data: { user } } = await supabasePipeline.getUser();
      if (!user) throw new Error('Not authenticated');

      const inviteCode = Math.random().toString(36).substring(2, 8).toUpperCase();

      const { data, error } = await supabasePipeline.createGroup({
        name,
        description,
        invite_code: inviteCode,
        created_by: user.id,
      });

      if (error) throw error;

      // Add user as group member via pipeline (bounded timeout)
      const { error: memberAddError } = await supabasePipeline.addGroupMember(data.id, user.id);
      if (memberAddError) throw memberAddError;

      // Add selected contacts as group members (only registered users)
      if (selectedContacts && selectedContacts.length > 0) {
        const registeredContacts = selectedContacts.filter(c => c.isRegistered && c.userId && c.userId !== user.id);

        if (registeredContacts.length > 0) {
          const { error: bulkMemberError } = await supabasePipeline.addGroupMembers(
            data.id,
            registeredContacts.map(c => c.userId!)
          );

          if (bulkMemberError) {
            console.error('Error adding selected members:', bulkMemberError);
            // Don't throw - group is created, just log the error
          } else {
            console.log(`✅ Added ${registeredContacts.length} members to group`);
          }
        }
      }

      const newGroups = [...get().groups, data];
      set({ groups: newGroups });

      // Save to SQLite for offline persistence
      const isNative = Capacitor.isNativePlatform();
      const isSqliteReady = isNative && await sqliteService.isReady();
      if (isSqliteReady) {
        await sqliteService.saveGroup({
          id: data.id,
          name: data.name,
          description: data.description || null,
          invite_code: data.invite_code || 'offline',
          created_by: data.created_by || '',
          created_at: new Date(data.created_at).getTime(),
          last_sync_timestamp: Date.now(),
          avatar_url: data.avatar_url || null,
          is_archived: 0
        });

        // Also save the current user to local storage
        const { data: { user } } = await supabasePipeline.getUser();
        if (user) {
          // Get user profile data
          const { data: userProfile } = await supabasePipeline.fetchUserProfile(user.id);

          if (userProfile) {
            await sqliteService.saveUser({
              id: userProfile.id,
              display_name: userProfile.display_name,
              phone_number: userProfile.phone_number || null,
              avatar_url: userProfile.avatar_url || null,
              is_onboarded: userProfile.is_onboarded ? 1 : 0,
              created_at: SupabasePipeline.safeTimestamp(userProfile.created_at)
            });
          }

          // Save group membership
          await sqliteService.saveGroupMember({
            group_id: data.id,
            user_id: user.id,
            role: 'admin',
            joined_at: Date.now()
          });
        }

        console.log(`✅ New group ${data.name} saved to local storage`);
      }

      return data;
    } catch (error) {
      console.error('Error creating group:', error);
      throw error;
    }
  },

  joinGroup: async (inviteCode: string) => {
    try {
      const { data: { user } } = await supabasePipeline.getUser();
      if (!user) throw new Error('Not authenticated');

      // First, find the group by invite code
      const client = await supabasePipeline.getSupabaseClient();
      const { data: groups, error: findError } = await client
        .from('groups')
        .select('*')
        .eq('invite_code', inviteCode.toUpperCase())
        .limit(1);

      if (findError || !groups || groups.length === 0) {
        throw new Error('Invalid invite code');
      }

      const group = groups[0];

      // Check if user is already a member
      const { data: existingMember } = await client
        .from('group_members')
        .select('*')
        .eq('group_id', group.id)
        .eq('user_id', user.id)
        .single();

      if (existingMember) {
        throw new Error('Already a member of this group');
      }

      // Check if there's already a pending request
      const { data: hasPending } = await joinRequestService.hasPendingRequest(group.id, user.id);

      if (hasPending) {
        throw new Error('Join request already pending approval');
      }

      // Create join request instead of directly joining
      const { error: requestError } = await joinRequestService.createJoinRequest(
        group.id,
        user.id,
        null // No inviter for invite code joins
      );

      if (requestError) {
        throw requestError;
      }

      console.log(`✅ Join request created for group ${group.name}, pending admin approval`);

      // Return a message to the user
      return {
        success: true,
        message: 'Join request sent! Waiting for admin approval.',
        group: group
      };
    } catch (error) {
      console.error('Error joining group:', error);
      throw error;
    }
  },

  fetchGroupMembers: async (groupId: string) => {
    // CRITICAL FIX: Deduplicate concurrent requests for the same group
    // If there's already a fetch in progress for this group, return that promise
    const existingFetch = inFlightMemberFetches.get(groupId);
    if (existingFetch) {
      console.log(`[GroupActions] fetchGroupMembers - deduplicating request for group ${groupId}`);
      return existingFetch;
    }

    // Create new fetch promise
    const fetchPromise = (async () => {
      try {
        set({ isLoadingGroupDetails: true });

        // OFFLINE-FIRST: Load from SQLite cache immediately
        console.log(`[GroupActions] 📱 Loading group members from SQLite cache for group ${groupId}`);
        const cachedMembers = await sqliteService.getGroupMembers(groupId);

        if (cachedMembers && cachedMembers.length > 0) {
          console.log(`[GroupActions] ✅ Found ${cachedMembers.length} cached members in SQLite`);

          // Load user details from SQLite for each member
          const membersWithUserData: GroupMember[] = await Promise.all(
            cachedMembers.map(async (member) => {
              const userData = await sqliteService.getUser(member.user_id);

              if (!userData) {
                console.warn(`[GroupActions] ⚠️ No user data found in SQLite for user ${member.user_id}`);
              }

              return {
                id: `${member.group_id}-${member.user_id}`,
                user_id: member.user_id,
                group_id: member.group_id,
                role: member.role,
                joined_at: new Date(member.joined_at).toISOString(),
                user: {
                  display_name: userData?.display_name || 'Unknown User',
                  phone_number: userData?.phone_number || '',
                  avatar_url: userData?.avatar_url || null,
                },
              };
            })
          );

          // Update UI immediately with cached data
          set({ groupMembers: membersWithUserData });
          console.log(`[GroupActions] 📱 UI updated with ${membersWithUserData.length} cached members`);

          // Log sample member data for debugging
          if (membersWithUserData.length > 0) {
            console.log(`[GroupActions] 📱 Sample cached member:`, {
              user_id: membersWithUserData[0].user_id,
              display_name: membersWithUserData[0].user.display_name,
              has_avatar: !!membersWithUserData[0].user.avatar_url
            });
          }
        } else {
          console.log(`[GroupActions] 📭 No cached members found in SQLite`);
        }

        // BACKGROUND SYNC: Fetch fresh data from Supabase
        console.log(`[GroupActions] 🌐 Fetching fresh members from Supabase...`);
        const { data, error } = await supabasePipeline.fetchGroupMembers(groupId);

        console.log('[GroupActions] fetchGroupMembers - groupId:', groupId);
        console.log('[GroupActions] fetchGroupMembers - data:', data);
        console.log('[GroupActions] fetchGroupMembers - error:', error);

        if (error) {
          // If we have cached data, don't throw - just log the error
          if (cachedMembers && cachedMembers.length > 0) {
            console.warn('[GroupActions] Supabase fetch failed, but using cached data:', error);
            return;
          }
          throw error;
        }

        // Get the current group to determine who is the creator (admin)
        const currentGroup = get().groups.find((g: Group) => g.id === groupId);
        const creatorId = currentGroup?.created_by;

        console.log('[GroupActions] fetchGroupMembers - creatorId:', creatorId);

        const members: GroupMember[] = (data || []).map((member) => {
          // Determine role: creator is admin, others are participants
          const role = member.user_id === creatorId ? 'admin' : 'participant';

          return {
            id: `${member.group_id}-${member.user_id}`,
            user_id: member.user_id,
            group_id: member.group_id,
            role,
            joined_at: member.joined_at || new Date().toISOString(),
            user: {
              display_name: member.users?.display_name || 'Unknown User',
              phone_number: member.users?.phone_number || '',
              avatar_url: member.users?.avatar_url || null,
            },
          };
        });

        console.log('[GroupActions] fetchGroupMembers - mapped members:', members);

        // SAVE TO SQLITE: Cache the fresh data
        console.log(`[GroupActions] 💾 Saving ${members.length} members to SQLite cache...`);
        for (const member of members) {
          // Save member to group_members table
          await sqliteService.saveGroupMember({
            group_id: member.group_id,
            user_id: member.user_id,
            role: member.role,
            joined_at: new Date(member.joined_at).getTime(),
          });

          // Save user details to users table
          await sqliteService.saveUser({
            id: member.user_id,
            display_name: member.user.display_name,
            phone_number: member.user.phone_number || '',
            avatar_url: member.user.avatar_url,
            is_onboarded: 1,
            created_at: Date.now(),
          });
        }
        console.log(`[GroupActions] ✅ Saved ${members.length} members to SQLite cache`);

        // Update UI with fresh data
        set({ groupMembers: members });
      } catch (error) {
        console.error('[GroupActions] Error fetching group members:', error);
        // Only clear members if we don't have cached data
        const currentMembers = get().groupMembers;
        if (!currentMembers || currentMembers.length === 0) {
          set({ groupMembers: [] });
        }
      } finally {
        set({ isLoadingGroupDetails: false });
        // Clean up in-flight tracking
        inFlightMemberFetches.delete(groupId);
      }
    })();

    // Track this fetch
    inFlightMemberFetches.set(groupId, fetchPromise);
    return fetchPromise;
  },

  fetchGroupMedia: async (groupId: string) => {
    try {
      // Placeholder implementation - will be enhanced when media upload is implemented
      const mockMedia: GroupMedia[] = [
        {
          id: '1',
          group_id: groupId,
          user_id: 'user1',
          type: 'photo',
          url: 'https://images.pexels.com/photos/1040880/pexels-photo-1040880.jpeg?auto=compress&cs=tinysrgb&w=400',
          name: 'group-photo-1.jpg',
          uploaded_at: new Date().toISOString(),
          user: {
            display_name: 'John Doe',
            avatar_url: null,
          },
        },
        {
          id: '2',
          group_id: groupId,
          user_id: 'user2',
          type: 'document',
          url: '#',
          name: 'meeting-notes.pdf',
          uploaded_at: new Date(Date.now() - 86400000).toISOString(),
          user: {
            display_name: 'Jane Smith',
            avatar_url: null,
          },
        },
      ];

      set({ groupMedia: mockMedia });
    } catch (error) {
      console.error('Error fetching group media:', error);
      set({ groupMedia: [] });
    }
  },

  openGroupDetailsMobile: (groupId: string) => {
    // Find the group and set it as active group if needed
    const { groups, activeGroup } = get();
    if (!activeGroup || activeGroup.id !== groupId) {
      const group = groups.find((g: Group) => g.id === groupId);
      if (group) {
        set({ activeGroup: group });
      }
    }

    // Show group details panel
    set({ showGroupDetailsPanel: true });

    // Load group members and media
    get().fetchGroupMembers(groupId);
    get().fetchGroupMedia(groupId);
  },

  updateGroup: async (groupId: string, updates: { name?: string; description?: string; avatar_url?: string }) => {
    try {
      const { error } = await supabasePipeline.updateGroup(groupId, updates);

      if (error) throw error;

      // Update the group in the store
      const updatedGroups = get().groups.map((g: Group) =>
        g.id === groupId ? { ...g, ...updates } : g
      );
      set({ groups: updatedGroups });

      // Update active group if it's the one being updated
      const { activeGroup } = get();
      if (activeGroup && activeGroup.id === groupId) {
        set({ activeGroup: { ...activeGroup, ...updates } });
      }

      // Update SQLite if available
      const isNative = Capacitor.isNativePlatform();
      const isSqliteReady = isNative && await sqliteService.isReady();
      if (isSqliteReady) {
        const group = updatedGroups.find((g: Group) => g.id === groupId);
        if (group) {
          await sqliteService.saveGroup({
            id: group.id,
            name: group.name,
            description: group.description || null,
            invite_code: group.invite_code || 'offline',
            created_by: group.created_by || '',
            created_at: new Date(group.created_at).getTime(),
            last_sync_timestamp: Date.now(),
            avatar_url: group.avatar_url || null,
            is_archived: 0
          });
        }
      }

      console.log('✅ Group updated successfully');
    } catch (error) {
      console.error('Error updating group:', error);
      throw error;
    }
  },

  addGroupMember: async (groupId: string, userId: string, skipApproval = false) => {
    try {
      const { data: { user } } = await supabasePipeline.getUser();
      if (!user) throw new Error('Not authenticated');

      // Check if current user is admin (group creator)
      const { activeGroup } = get();
      const isAdmin = activeGroup && activeGroup.created_by === user.id;

      // If admin or skipApproval flag is set, add directly
      if (isAdmin || skipApproval) {
        const { error } = await supabasePipeline.addGroupMember(groupId, userId);
        if (error) throw error;

        // Refresh the members list
        await get().fetchGroupMembers(groupId);
        console.log('✅ Member added successfully');
      } else {
        // Non-admin: create join request instead
        const { error } = await joinRequestService.createJoinRequest(
          groupId,
          userId,
          user.id // invited_by
        );

        if (error) throw error;

        console.log('✅ Join request created, pending admin approval');

        // Optionally refresh pending requests if we're tracking them
        if (get().fetchPendingJoinRequests) {
          await get().fetchPendingJoinRequests(groupId);
        }
      }
    } catch (error) {
      console.error('Error adding group member:', error);
      throw error;
    }
  },

  removeGroupMember: async (groupId: string, userId: string) => {
    try {
      console.log(`[GroupActions] Removing member ${userId} from group ${groupId}`);

      // Remove from Supabase
      const { error } = await supabasePipeline.removeGroupMember(groupId, userId);

      if (error) {
        console.error('[GroupActions] Supabase error removing member:', error);
        throw error;
      }

      // Remove from SQLite
      const isNative = Capacitor.isNativePlatform();
      const isSqliteReady = isNative && await sqliteService.isReady();

      if (isSqliteReady) {
        try {
          await sqliteService.deleteGroupMember(groupId, userId);
          console.log('[GroupActions] ✅ Member removed from SQLite');
        } catch (sqliteError) {
          console.error('[GroupActions] SQLite error removing member:', sqliteError);
          // Continue even if SQLite fails - will sync on next fetch
        }
      }

      // Refresh the members list to update UI
      await get().fetchGroupMembers(groupId);

      console.log('[GroupActions] ✅ Member removed successfully');
    } catch (error) {
      console.error('[GroupActions] Error removing group member:', error);
      throw error;
    }
  },

  addGroupMembers: async (groupId: string, userIds: string[], skipApproval = false) => {
    try {
      const { data: { user } } = await supabasePipeline.getUser();
      if (!user) throw new Error('Not authenticated');

      // Check if current user is admin (group creator)
      const { activeGroup } = get();
      const isAdmin = activeGroup && activeGroup.created_by === user.id;

      // If admin or skipApproval flag is set, add directly
      if (isAdmin || skipApproval) {
        const { error } = await supabasePipeline.addGroupMembers(groupId, userIds);
        if (error) throw error;

        // Refresh the members list
        await get().fetchGroupMembers(groupId);
        console.log(`✅ ${userIds.length} member(s) added successfully`);
      } else {
        // Non-admin: create join requests for each user
        let successCount = 0;
        for (const userId of userIds) {
          const { error } = await joinRequestService.createJoinRequest(
            groupId,
            userId,
            user.id // invited_by
          );

          if (!error) {
            successCount++;
          } else {
            console.error(`Failed to create join request for user ${userId}:`, error);
          }
        }

        console.log(`✅ ${successCount} join request(s) created, pending admin approval`);

        // Optionally refresh pending requests if we're tracking them
        if (get().fetchPendingJoinRequests) {
          await get().fetchPendingJoinRequests(groupId);
        }
      }
    } catch (error) {
      console.error('Error adding group members:', error);
      throw error;
    }
  },

  leaveGroup: async (groupId: string, userId: string) => {
    try {
      console.log(`[GroupActions] User ${userId} leaving group ${groupId}`);

      // Check if the leaving user is an admin
      const { activeGroup } = get();
      const isAdmin = activeGroup && activeGroup.created_by === userId;

      if (isAdmin) {
        console.log('[GroupActions] Leaving user is admin, transferring admin role...');

        // Fetch all members to find the next admin
        const client = await supabasePipeline.getSupabaseClient();
        const { data: members, error: membersError } = await client
          .from('group_members')
          .select('user_id, joined_at')
          .eq('group_id', groupId)
          .neq('user_id', userId)
          .order('joined_at', { ascending: true })
          .limit(1);

        if (membersError) {
          console.error('[GroupActions] Error fetching members for admin transfer:', membersError);
        } else if (members && members.length > 0) {
          const newAdminId = members[0].user_id;
          console.log(`[GroupActions] Transferring admin to user ${newAdminId}`);

          // Update the new admin's role in group_members
          const { error: updateRoleError } = await client
            .from('group_members')
            .update({ role: 'admin' })
            .eq('group_id', groupId)
            .eq('user_id', newAdminId);

          if (updateRoleError) {
            console.error('[GroupActions] Error updating new admin role:', updateRoleError);
          }

          // Update the group's created_by to the new admin
          const { error: updateGroupError } = await client
            .from('groups')
            .update({ created_by: newAdminId })
            .eq('id', groupId);

          if (updateGroupError) {
            console.error('[GroupActions] Error updating group creator:', updateGroupError);
          } else {
            console.log('[GroupActions] ✅ Admin role transferred successfully');
          }

          // Update SQLite if available
          const isNative = Capacitor.isNativePlatform();
          const isSqliteReady = isNative && await sqliteService.isReady();

          if (isSqliteReady) {
            try {
              // Update new admin role in SQLite
              await sqliteService.updateGroupMemberRole(groupId, newAdminId, 'admin');
              // Update group creator in SQLite
              await sqliteService.updateGroupCreator(groupId, newAdminId);
            } catch (sqliteError) {
              console.error('[GroupActions] SQLite error during admin transfer:', sqliteError);
            }
          }
        } else {
          console.log('[GroupActions] No other members to transfer admin to');
        }
      }

      // Now remove the user from the group
      const { error } = await supabasePipeline.leaveGroup(groupId, userId);

      if (error) throw error;

      // Remove from SQLite
      const isNative = Capacitor.isNativePlatform();
      const isSqliteReady = isNative && await sqliteService.isReady();

      if (isSqliteReady) {
        try {
          await sqliteService.deleteGroupMember(groupId, userId);
          await sqliteService.deleteGroup(groupId);
          console.log('[GroupActions] ✅ Group removed from SQLite');
        } catch (sqliteError) {
          console.error('[GroupActions] SQLite error leaving group:', sqliteError);
        }
      }

      // Remove the group from the local groups array
      const updatedGroups = get().groups.filter((g: Group) => g.id !== groupId);
      set({ groups: updatedGroups });

      // Clear active group if it's the one being left
      if (activeGroup && activeGroup.id === groupId) {
        set({ activeGroup: null });
      }

      console.log('[GroupActions] ✅ Left group successfully');
    } catch (error) {
      console.error('[GroupActions] Error leaving group:', error);
      throw error;
    }
  },
});