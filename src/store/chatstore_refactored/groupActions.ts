import { supabase } from '@/lib/supabase';
import { sqliteService } from '@/lib/sqliteService';
import { Capacitor } from '@capacitor/core';
import { Group, GroupMember, GroupMedia } from './types';

export interface GroupActions {
  createGroup: (name: string, description?: string) => Promise<Group>;
  joinGroup: (inviteCode: string) => Promise<void>;
  fetchGroupMembers: (groupId: string) => Promise<void>;
  fetchGroupMedia: (groupId: string) => Promise<void>;
  openGroupDetailsMobile: (groupId: string) => void;
}

export const createGroupActions = (set: any, get: any): GroupActions => ({
  createGroup: async (name: string, description?: string) => {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Not authenticated');

      const inviteCode = Math.random().toString(36).substring(2, 8).toUpperCase();

      const { data, error } = await supabase
        .from('groups')
        .insert({
          name,
          description,
          invite_code: inviteCode,
          created_by: user.id,
        })
        .select()
        .single();

      if (error) throw error;

      const { error: memberError } = await supabase
        .from('group_members')
        .insert({
          group_id: data.id,
          user_id: user.id,
        });

      if (memberError) throw memberError;

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
        const { data: { user } } = await supabase.auth.getUser();
        if (user) {
          // Get user profile data
          const { data: userProfile } = await supabase
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
              created_at: new Date(userProfile.created_at).getTime()
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
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Not authenticated');

      const { data: group, error: groupError } = await supabase
        .from('groups')
        .select('*')
        .eq('invite_code', inviteCode.toUpperCase())
        .single();

      if (groupError) throw new Error('Invalid invite code');

      const { data: existingMember } = await supabase
        .from('group_members')
        .select('*')
        .eq('group_id', group.id)
        .eq('user_id', user.id)
        .maybeSingle();

      if (existingMember) throw new Error('Already a member of this group');

      const { error: memberError } = await supabase
        .from('group_members')
        .insert({
          group_id: group.id,
          user_id: user.id,
        });

      if (memberError) throw memberError;

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

      const { data, error } = await supabase
        .from('group_members')
        .select(`
          *,
          users!group_members_user_id_fkey(display_name, phone_number, avatar_url)
        `)
        .eq('group_id', groupId)
        .order('joined_at', { ascending: true });

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