import { supabasePipeline } from '@/lib/supabasePipeline';
import { Reaction } from './types';

export interface ReactionActions {
  addOrRemoveReaction: (messageId: string, emoji: string) => Promise<void>;
  addReaction: (messageId: string, emoji: string) => Promise<void>;
  removeReaction: (messageId: string, emoji: string) => Promise<void>;
}

export const createReactionActions = (set: any, get: any): ReactionActions => ({
  addOrRemoveReaction: async (messageId: string, emoji: string) => {
    console.log(`🎭 addOrRemoveReaction called: messageId=${messageId}, emoji=${emoji}`);
    try {
      const { data: { user } } = await supabasePipeline.getUser();
      if (!user) {
        console.error('❌ User not authenticated');
        throw new Error('Not authenticated');
      }
      console.log(`✅ User authenticated: ${user.id}`);

      const state = get();
      const currentReactions = state.messageReactions[messageId] || [];
      console.log(`📊 Current reactions for message:`, currentReactions);
      
      // Find any existing reaction from this user on this message
      const existingUserReaction = currentReactions.find((r: Reaction) => r.user_id === user.id);
      const existingReactionWithSameEmoji = currentReactions.find((r: Reaction) => r.user_id === user.id && r.emoji === emoji);

      if (existingReactionWithSameEmoji) {
        console.log(`🔄 Removing existing reaction: ${emoji}`);
        await get().removeReaction(messageId, emoji);
      } else if (existingUserReaction) {
        console.log(`🔄 Changing reaction from ${existingUserReaction.emoji} to ${emoji}`);
        await get().removeReaction(messageId, existingUserReaction.emoji);
        await get().addReaction(messageId, emoji);
      } else {
        console.log(`➕ Adding new reaction: ${emoji}`);
        await get().addReaction(messageId, emoji);
      }
      console.log(`✅ Reaction operation completed successfully`);
    } catch (error) {
      console.error('❌ Error toggling reaction:', error);
      throw error;
    }
  },

  addReaction: async (messageId: string, emoji: string) => {
    console.log(`➕ addReaction: messageId=${messageId}, emoji=${emoji}`);
    
    // Get user ID from auth store (synchronous, instant)
    const authModule = await import('@/store/authStore');
    const { user } = authModule.useAuthStore.getState();
    if (!user?.id) {
      console.error('❌ No user in auth store');
      return;
    }
    const userId = user.id;
    console.log(`✅ Got user ID from store: ${userId}`);

    const state = get();
    
    // Create optimistic reaction immediately
    const optimisticReaction = {
      id: `temp-${Date.now()}`,
      message_id: messageId,
      user_id: userId,
      emoji,
      created_at: new Date().toISOString(),
    };

    console.log(`⚡ Adding optimistic reaction immediately`);

    // 1. Update UI immediately (optimistic)
    const currentReactions = state.messageReactions[messageId] || [];
    const updatedReactions = [...currentReactions, optimisticReaction];
    
    set({
      messageReactions: {
        ...state.messageReactions,
        [messageId]: updatedReactions
      }
    });

    const updatedMessages = state.messages.map((msg: any) => {
      if (msg.id === messageId) {
        return {
          ...msg,
          reactions: [...(msg.reactions || []), optimisticReaction],
        };
      }
      return msg;
    });
    set({ messages: updatedMessages });
    console.log(`✅ UI updated immediately with optimistic reaction`);

    // 2. Save to SQLite immediately (background)
    (async () => {
      try {
        const { sqliteService } = await import('@/lib/sqliteService');
        await sqliteService.saveReaction({
          id: optimisticReaction.id,
          message_id: messageId,
          user_id: userId,
          emoji,
          created_at: new Date(optimisticReaction.created_at).getTime()
        });
        console.log('✅ Reaction saved to SQLite');
      } catch (sqliteError) {
        console.error('❌ Failed to save reaction to SQLite:', sqliteError);
      }
    })();

    // 3. Sync to Supabase in background (don't wait, no auth checks)
    (async () => {
      try {
        console.log(`📤 Syncing reaction to Supabase (no auth check)...`);
        const client = await supabasePipeline.getDirectClient();
        const { data, error } = await client
          .from('reactions')
          .insert({
            message_id: messageId,
            user_id: userId,
            emoji,
          })
          .select()
          .single();

        if (error) {
          console.error('❌ Supabase insert error:', error);
          return;
        }

        console.log(`✅ Reaction synced to Supabase:`, data);

        // Update with real ID from server
        if (data?.id && data.id !== optimisticReaction.id) {
          const state = get();
          const realReaction = {
            ...optimisticReaction,
            id: data.id,
            created_at: data.created_at || optimisticReaction.created_at,
          };

          // Update SQLite with real ID
          try {
            const { sqliteService } = await import('@/lib/sqliteService');
            await sqliteService.saveReaction({
              id: realReaction.id,
              message_id: messageId,
              user_id: userId,
              emoji,
              created_at: new Date(realReaction.created_at).getTime()
            });
          } catch (e) {
            console.error('Failed to update SQLite with real ID:', e);
          }

          // Update state with real ID
          const updatedReactions = (state.messageReactions[messageId] || []).map((r: any) =>
            r.id === optimisticReaction.id ? realReaction : r
          );
          
          set({
            messageReactions: {
              ...state.messageReactions,
              [messageId]: updatedReactions
            }
          });

          const updatedMessages = state.messages.map((msg: any) => {
            if (msg.id === messageId) {
              return {
                ...msg,
                reactions: (msg.reactions || []).map((r: any) =>
                  r.id === optimisticReaction.id ? realReaction : r
                ),
              };
            }
            return msg;
          });
          set({ messages: updatedMessages });
          console.log(`✅ Updated with real server ID`);
        }
      } catch (error) {
        console.error('❌ Background sync failed:', error);
      }
    })();
  },

  removeReaction: async (messageId: string, emoji: string) => {
    console.log(`➖ removeReaction: messageId=${messageId}, emoji=${emoji}`);
    
    // Get user ID from auth store (synchronous, instant)
    const authModule = await import('@/store/authStore');
    const { user } = authModule.useAuthStore.getState();
    if (!user?.id) {
      console.error('❌ No user in auth store');
      return;
    }
    const userId = user.id;
    console.log(`✅ Got user ID from store: ${userId}`);

    const state = get();

    console.log(`⚡ Removing reaction immediately from UI`);

    // 1. Update UI immediately (optimistic)
    const currentReactions = state.messageReactions[messageId] || [];
    const updatedReactions = currentReactions.filter(
      (r: Reaction) => !(r.user_id === userId && r.emoji === emoji)
    );
    
    set({
      messageReactions: {
        ...state.messageReactions,
        [messageId]: updatedReactions
      }
    });

    const updatedMessages = state.messages.map((msg: any) => {
      if (msg.id === messageId) {
        return {
          ...msg,
          reactions: (msg.reactions || []).filter(
            (r: Reaction) => !(r.user_id === userId && r.emoji === emoji)
          ),
        };
      }
      return msg;
    });
    set({ messages: updatedMessages });

    if (state.activeThread) {
      const updatedReplies = state.threadReplies.map((reply: any) => {
        if (reply.id === messageId) {
          return {
            ...reply,
            reactions: (reply.reactions || []).filter(
              (r: Reaction) => !(r.user_id === userId && r.emoji === emoji)
            ),
          };
        }
        return reply;
      });
      set({ threadReplies: updatedReplies });
    }
    console.log(`✅ UI updated immediately - reaction removed`);

    // 2. Remove from SQLite immediately (background)
    (async () => {
      try {
        const { sqliteService } = await import('@/lib/sqliteService');
        await sqliteService.deleteReaction(messageId, userId, emoji);
        console.log('✅ Reaction removed from SQLite');
      } catch (sqliteError) {
        console.error('❌ Failed to remove reaction from SQLite:', sqliteError);
      }
    })();

    // 3. Sync to Supabase in background (don't wait, no auth checks)
    (async () => {
      try {
        console.log(`📤 Syncing reaction removal to Supabase (no auth check)...`);
        const client = await supabasePipeline.getDirectClient();
        const { error } = await client
          .from('reactions')
          .delete()
          .eq('message_id', messageId)
          .eq('user_id', userId)
          .eq('emoji', emoji);

        if (error) {
          console.error('❌ Supabase delete error:', error);
          return;
        }

        console.log(`✅ Reaction removal synced to Supabase`);
      } catch (error) {
        console.error('❌ Background sync failed:', error);
      }
    })();
  },
});