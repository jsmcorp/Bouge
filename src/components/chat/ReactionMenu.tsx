import { motion } from 'framer-motion';
import { Button } from '@/components/ui/button';

interface ReactionMenuProps {
  onSelectEmoji: (emoji: string) => void;
  className?: string;
}

const COMMON_EMOJIS = [
  '👍', '❤️', '😂', '😢', '😮', '😡', '🔥', '👏', '🎉', '💯'
];

export function ReactionMenu({ onSelectEmoji, className }: ReactionMenuProps) {
  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.95 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0, scale: 0.95 }}
      transition={{ duration: 0.15 }}
      className={`reaction-button flex items-center space-x-1 p-2 shadow-lg ${className}`}
    >
      {COMMON_EMOJIS.map((emoji) => (
        <Button
          key={emoji}
          variant="ghost"
          size="sm"
          className="h-8 w-8 p-0 hover:bg-muted transition-colors rounded-md"
          onClick={() => onSelectEmoji(emoji)}
        >
          <span className="text-lg">{emoji}</span>
        </Button>
      ))}
    </motion.div>
  );
}