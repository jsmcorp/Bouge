import { motion, AnimatePresence } from 'framer-motion';
import { Button } from '@/components/ui/button';
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

  return (
    <div className={`flex items-center flex-wrap gap-1.5 select-none ${className}`}>
      <AnimatePresence mode="popLayout">
        {Object.entries(reactionCounts).map(([emoji, count]) => {
          const isUserReacted = userReactions.includes(emoji);

          return (
            <motion.div
              key={emoji}
              layout
              initial={{ opacity: 0, scale: 0.3, y: -20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.3, y: -20 }}
              transition={{ 
                type: "spring",
                stiffness: 500,
                damping: 30,
                mass: 0.8
              }}
            >
              <Button
                variant="ghost"
                size="sm"
                onClick={() => onToggleReaction(emoji)}
                className={`h-7 px-2.5 text-xs rounded-full transition-all duration-200 select-none ${
                  isUserReacted
                    ? 'bg-primary/20 text-primary border border-primary/40 hover:bg-primary/30 shadow-sm'
                    : 'bg-background/80 hover:bg-muted border border-border/60 shadow-sm'
                }`}
              >
                <motion.span 
                  className="mr-1.5 text-base select-none"
                  animate={isUserReacted ? { scale: [1, 1.3, 1] } : {}}
                  transition={{ duration: 0.3 }}
                >
                  {emoji}
                </motion.span>
                <span className="text-xs font-semibold select-none">{count}</span>
              </Button>
            </motion.div>
          );
        })}
      </AnimatePresence>
    </div>
  );
}