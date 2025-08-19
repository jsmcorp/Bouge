import { supabase } from '@/lib/supabase';
import { ensureAuthForWrites } from './utils';
import { FEATURES_PUSH } from '@/lib/featureFlags';
import { Reaction } from './types';

export interface ReactionActions {
  addOrRemoveReaction: (messageId: string, emoji: string) => Promise<void>;
  addReaction: (messageId: string, emoji: string) => Promise<void>;
  removeReaction: (messageId: string, emoji: string) => Promise<void>;
}

export const createReactionActions = (set: any, get: any): ReactionActions => ({
  addOrRemoveReaction: async (messageId: string, emoji: string) => {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Not authenticated');

      const state = get();
      const currentReactions = state.messageReactions[messageId] || [];
      const existingReaction = currentReactions.find((r: Reaction) => r.user_id === user.id && r.emoji === emoji);

      if (existingReaction) {
        // Remove reaction
        await get().removeReaction(messageId, emoji);
      } else {
        // Add reaction
        await get().addReaction(messageId, emoji);
      }
    } catch (error) {
      console.error('Error toggling reaction:', error);
      throw error;
    }
  },

  addReaction: async (messageId: string, emoji: string) => {
    try {
      if (FEATURES_PUSH.enabled && !FEATURES_PUSH.killSwitch) {
        const ok = await ensureAuthForWrites();
        if (!ok.canWrite) {
          console.log('[outbox] deferred reason=auth_refresh');
          throw new Error('Auth not ready for writes');
        }
      }
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Not authenticated');

      const { error } = await supabase
        .from('reactions')
        .insert({
          message_id: messageId,
          user_id: user.id,
          emoji,
        });

      if (error) throw error;

      const state = get();
      const newReaction = {
        id: Date.now().toString(),
        message_id: messageId,
        user_id: user.id,
        emoji,
      };

      // Update messageReactions
      const currentReactions = state.messageReactions[messageId] || [];
      set({
        messageReactions: {
          ...state.messageReactions,
          [messageId]: [...currentReactions, newReaction]
        }
      });

      const updatedMessages = state.messages.map((msg: any) => {
        if (msg.id === messageId) {
          return {
            ...msg,
            reactions: [...(msg.reactions || []), newReaction],
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
              reactions: [...(reply.reactions || []), newReaction],
            };
          }
          return reply;
        });
        set({ threadReplies: updatedReplies });
      }
    } catch (error) {
      console.error('Error adding reaction:', error);
      throw error;
    }
  },

  removeReaction: async (messageId: string, emoji: string) => {
    try {
      if (FEATURES_PUSH.enabled && !FEATURES_PUSH.killSwitch) {
        const ok = await ensureAuthForWrites();
        if (!ok.canWrite) {
          console.log('[outbox] deferred reason=auth_refresh');
          throw new Error('Auth not ready for writes');
        }
      }
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Not authenticated');

      const { error } = await supabase
        .from('reactions')
        .delete()
        .eq('message_id', messageId)
        .eq('user_id', user.id)
        .eq('emoji', emoji);

      if (error) throw error;

      const state = get();

      // Update messageReactions
      const currentReactions = state.messageReactions[messageId] || [];
      const updatedReactions = currentReactions.filter(
        (r: Reaction) => !(r.user_id === user.id && r.emoji === emoji)
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
              (r: Reaction) => !(r.user_id === user.id && r.emoji === emoji)
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
                (r: Reaction) => !(r.user_id === user.id && r.emoji === emoji)
              ),
            };
          }
          return reply;
        });
        set({ threadReplies: updatedReplies });
      }
    } catch (error) {
      console.error('Error removing reaction:', error);
      throw error;
    }
  },
});