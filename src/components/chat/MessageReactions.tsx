import { motion, AnimatePresence } from 'framer-motion';
import { Button } from '@/components/ui/button';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { Reaction } from '@/store/chat/reactions';
import { getReactionCounts, getUserReactions } from '@/store/chat/reactions';
import { useAuthStore } from '@/store/authStore';

interface MessageReactionsProps {
  reactions: Reaction[];
  onToggleReaction: (emoji: string) => void;
  className?: string;
}

export function MessageReactions({ reactions, onToggleReaction, className }: MessageReactionsProps) {
  const { user } = useAuthStore();
  
  if (!reactions || reactions.length === 0) {
    return null;
  }

  const reactionCounts = getReactionCounts(reactions);
  const userReactions = user ? getUserReactions(reactions, user.id) : [];

  // Group reactions by emoji to show who reacted
  const reactionsByEmoji = reactions.reduce((acc, reaction) => {
    if (!acc[reaction.emoji]) {
      acc[reaction.emoji] = [];
    }
    acc[reaction.emoji].push(reaction);
    return acc;
  }, {} as Record<string, Reaction[]>);

  return (
    <div className={`flex items-center flex-wrap gap-1 mt-2 ${className}`}>
      <AnimatePresence>
        {Object.entries(reactionCounts).map(([emoji, count]) => {
          const isUserReacted = userReactions.includes(emoji);
          const reactionsForEmoji = reactionsByEmoji[emoji] || [];
          
          // Create tooltip content showing who reacted
          const tooltipContent = reactionsForEmoji.length > 0 ? (
            <div className="space-y-1">
              <p className="text-xs font-medium">
                {reactionsForEmoji.length} {reactionsForEmoji.length === 1 ? 'reaction' : 'reactions'}
              </p>
              <div className="flex items-center space-x-1">
                {reactionsForEmoji.slice(0, 3).map((reaction) => (
                  <Avatar key={reaction.id} className="w-4 h-4">
                    <AvatarImage src={reaction.user?.avatar_url || ''} />
                    <AvatarFallback className="text-xs">
                      {reaction.user?.display_name?.charAt(0) || 'U'}
                    </AvatarFallback>
                  </Avatar>
                ))}
                {reactionsForEmoji.length > 3 && (
                  <span className="text-xs text-muted-foreground">
                    +{reactionsForEmoji.length - 3}
                  </span>
                )}
              </div>
            </div>
          ) : null;

          return (
            <motion.div
              key={emoji}
              initial={{ opacity: 0, scale: 0.8 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.8 }}
              transition={{ duration: 0.2 }}
            >
              <TooltipProvider>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => onToggleReaction(emoji)}
                      className={`h-6 px-2 text-xs rounded-full transition-all duration-200 ${
                        isUserReacted
                          ? 'bg-primary/20 text-primary border border-primary/30 hover:bg-primary/30'
                          : 'bg-muted/50 hover:bg-muted border border-border/50'
                      }`}
                    >
                      <span className="mr-1">{emoji}</span>
                      <span className="text-xs font-medium">{count}</span>
                    </Button>
                  </TooltipTrigger>
                  {tooltipContent && (
                    <TooltipContent side="top" className="max-w-xs">
                      {tooltipContent}
                    </TooltipContent>
                  )}
                </Tooltip>
              </TooltipProvider>
            </motion.div>
          );
        })}
      </AnimatePresence>
    </div>
  );
}