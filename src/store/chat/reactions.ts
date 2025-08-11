export interface Reaction {
  id: string;
  message_id: string;
  user_id: string;
  emoji: string;
  created_at: string;
  user?: {
    display_name: string;
    avatar_url: string | null;
  };
}

export function getReactionCounts(reactions: Reaction[]): Record<string, number> {
  return reactions.reduce((acc, reaction) => {
    acc[reaction.emoji] = (acc[reaction.emoji] || 0) + 1;
    return acc;
  }, {} as Record<string, number>);
}

export function getUserReactions(reactions: Reaction[], userId: string): string[] {
  return reactions
    .filter(reaction => reaction.user_id === userId)
    .map(reaction => reaction.emoji);
}