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

      // Add user as group member via direct client
      const client = await supabasePipeline.getDirectClient();
      const { error: memberError } = await client
        .from('group_members')
        .insert({
          group_id: data.id,
          user_id: user.id,
        });

      if (memberError) throw memberError;

      // Add selected contacts as group members (only registered users)
      if (selectedContacts && selectedContacts.length > 0) {
        const registeredContacts = selectedContacts.filter(c => c.isRegistered && c.userId);

        if (registeredContacts.length > 0) {
          const memberInserts = registeredContacts.map(contact => ({
            group_id: data.id,
            user_id: contact.userId!,
          }));

          const { error: bulkMemberError } = await client
            .from('group_members')
            .insert(memberInserts);

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
          const client = await supabasePipeline.getDirectClient();
          const { data: userProfile } = await client
            .from('users')
            .select('*')
            .eq('id', user.id)
            .single();

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

      if (error) throw error;

      const members: GroupMember[] = (data || []).map((member) => ({
        id: `${member.group_id}-${member.user_id}`,
        user_id: member.user_id,
        group_id: member.group_id,
        role: 'participant', // Default role, will be enhanced later
        joined_at: member.joined_at,
        user: {
          display_name: member.users.display_name,
          phone_number: member.users.phone_number,
          avatar_url: member.users.avatar_url,
        },
      }));

      set({ groupMembers: members });
    } catch (error) {
      console.error('Error fetching group members:', error);
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
});