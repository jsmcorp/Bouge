import { supabasePipeline, SupabasePipeline } from '@/lib/supabasePipeline';
import { sqliteService } from '@/lib/sqliteService';
import { Capacitor } from '@capacitor/core';
import { Group, GroupMember, GroupMedia } from './types';

export interface SelectedContact {
  contactId: number;
  phoneNumber: string;
  displayName: string;
  userId?: string; // If registered user
  isRegistered: boolean;
}

export interface GroupActions {
  createGroup: (name: string, description?: string, selectedContacts?: SelectedContact[]) => Promise<Group>;
  joinGroup: (inviteCode: string) => Promise<void>;
  fetchGroupMembers: (groupId: string) => Promise<void>;
  fetchGroupMedia: (groupId: string) => Promise<void>;
  openGroupDetailsMobile: (groupId: string) => void;
  updateGroup: (groupId: string, updates: { name?: string; description?: string; avatar_url?: string }) => Promise<void>;
  addGroupMember: (groupId: string, userId: string) => Promise<void>;
  removeGroupMember: (groupId: string, userId: string) => Promise<void>;
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

      // Use pipeline to join group (handles finding group and adding member)
      const { data: group, error } = await supabasePipeline.joinGroup(inviteCode.toUpperCase(), user.id);

      if (error) {
        if (error.message?.includes('duplicate key value')) {
          throw new Error('Already a member of this group');
        }
        throw new Error('Invalid invite code');
      }

      const newGroups = [...get().groups, group];
      set({ groups: newGroups });

      // Save to SQLite for offline persistence
      const isNative = Capacitor.isNativePlatform();
      const isSqliteReady = isNative && await sqliteService.isReady();
      if (isSqliteReady) {
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

        // Save group membership
        await sqliteService.saveGroupMember({
          group_id: group.id,
          user_id: user.id,
          role: 'participant',
          joined_at: Date.now()
        });

        console.log(`✅ Joined group ${group.name} saved to local storage`);
      }
    } catch (error) {
      console.error('Error joining group:', error);
      throw error;
    }
  },

  fetchGroupMembers: async (groupId: string) => {
    try {
      set({ isLoadingGroupDetails: true });

      const { data, error } = await supabasePipeline.fetchGroupMembers(groupId);

      console.log('[GroupActions] fetchGroupMembers - groupId:', groupId);
      console.log('[GroupActions] fetchGroupMembers - data:', data);
      console.log('[GroupActions] fetchGroupMembers - error:', error);

      if (error) throw error;

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

      set({ groupMembers: members });
    } catch (error) {
      console.error('[GroupActions] Error fetching group members:', error);
      set({ groupMembers: [] });
    } finally {
      set({ isLoadingGroupDetails: false });
    }
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

  addGroupMember: async (groupId: string, userId: string) => {
    try {
      const { error } = await supabasePipeline.addGroupMember(groupId, userId);

      if (error) throw error;

      // Refresh the members list
      await get().fetchGroupMembers(groupId);

      console.log('✅ Member added successfully');
    } catch (error) {
      console.error('Error adding group member:', error);
      throw error;
    }
  },

  removeGroupMember: async (groupId: string, userId: string) => {
    try {
      const { error } = await supabasePipeline.removeGroupMember(groupId, userId);

      if (error) throw error;

      // Refresh the members list
      await get().fetchGroupMembers(groupId);

      console.log('✅ Member removed successfully');
    } catch (error) {
      console.error('Error removing group member:', error);
      throw error;
    }
  },
});