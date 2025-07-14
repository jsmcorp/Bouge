import { supabase } from '@/lib/supabase';

export interface Reaction {
  id: string;
  message_id: string;
  user_id: string;
  emoji: string;
  created_at: string;
  user?: {
    id: string;
    display_name: string;
    avatar_url: string | null;
  };
}

/**
 * Add a reaction to a message
 */
export async function addReaction(messageId: string, emoji: string, userId: string): Promise<Reaction> {
  const { data, error } = await supabase
    .from('reactions')
    .insert({
      message_id: messageId,
      user_id: userId,
      emoji: emoji,
    })
    .select()
    .single();

  if (error) {
    console.error('Error adding reaction:', error);
    throw error;
  }

  return data;
}

/**
 * Remove a reaction from a message
 */
export async function removeReaction(messageId: string, emoji: string, userId: string): Promise<void> {
  const { error } = await supabase
    .from('reactions')
    .delete()
    .eq('message_id', messageId)
    .eq('user_id', userId)
    .eq('emoji', emoji);

  if (error) {
    console.error('Error removing reaction:', error);
    throw error;
  }
}

/**
 * Get all reactions for a specific message
 */
export async function getMessageReactions(messageId: string): Promise<Reaction[]> {
  const { data, error } = await supabase
    .from('reactions')
    .select(`
      *,
      user:users(id, display_name, avatar_url)
    `)
    .eq('message_id', messageId)
    .order('created_at', { ascending: true });

  if (error) {
    console.error('Error fetching reactions:', error);
    throw error;
  }

  return data || [];
}

/**
 * Get all reactions for messages in a group
 */
export async function getGroupReactions(groupId: string): Promise<Reaction[]> {
  const { data, error } = await supabase
    .from('reactions')
    .select(`
      *,
      user:users(id, display_name, avatar_url),
      message:messages!inner(group_id)
    `)
    .eq('message.group_id', groupId)
    .order('created_at', { ascending: true });

  if (error) {
    console.error('Error fetching group reactions:', error);
    throw error;
  }

  return data || [];
}

/**
 * Subscribe to real-time reaction changes for a group
 */
export function subscribeToReactions(
  groupId: string, 
  callback: (payload: any) => void
): { unsubscribe: () => void } {
  const channel = supabase
    .channel(`reactions-${groupId}`)
    .on(
      'postgres_changes',
      {
        event: '*',
        schema: 'public',
        table: 'reactions',
        filter: `message_id=in.(select id from messages where group_id=eq.${groupId})`,
      },
      callback
    )
    .subscribe();

  return {
    unsubscribe: () => {
      supabase.removeChannel(channel);
    },
  };
}

/**
 * Check if user has reacted to a message with a specific emoji
 */
export function hasUserReacted(reactions: Reaction[], userId: string, emoji: string): boolean {
  return reactions.some(reaction => 
    reaction.user_id === userId && reaction.emoji === emoji
  );
}

/**
 * Get reaction counts grouped by emoji
 */
export function getReactionCounts(reactions: Reaction[]): Record<string, number> {
  return reactions.reduce((counts, reaction) => {
    counts[reaction.emoji] = (counts[reaction.emoji] || 0) + 1;
    return counts;
  }, {} as Record<string, number>);
}

/**
 * Get user's reactions for a message
 */
export function getUserReactions(reactions: Reaction[], userId: string): string[] {
  return reactions
    .filter(reaction => reaction.user_id === userId)
    .map(reaction => reaction.emoji);
}