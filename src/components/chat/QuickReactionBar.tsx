import { motion, AnimatePresence } from 'framer-motion';

interface QuickReactionBarProps {
  isVisible: boolean;
  onReactionSelect: (emoji: string) => void;
}

const QUICK_REACTIONS = ['👍', '❤️', '😂', '😮', '😢', '🙏'];

export function QuickReactionBar({ 
  isVisible, 
  onReactionSelect
}: QuickReactionBarProps) {
  return (
    <AnimatePresence>
      {isVisible && (
        <motion.div
          initial={{ opacity: 0, scale: 0.9, y: 10 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.9, y: 10 }}
          transition={{ duration: 0.15 }}
          className="flex items-center gap-1 px-3 py-2 rounded-full bg-background/95 border border-border/50 shadow-xl backdrop-blur-sm"
        >
          {QUICK_REACTIONS.map((emoji) => (
            <motion.button
              key={emoji}
              type="button"
              onClick={(e: React.MouseEvent) => {
                e.stopPropagation();
                onReactionSelect(emoji);
              }}
              className="h-10 w-10 rounded-full flex items-center justify-center hover:bg-muted transition-colors"
              whileHover={{ scale: 1.2, y: -4 }}
              whileTap={{ scale: 0.95 }}
            >
              <span className="text-2xl">{emoji}</span>
            </motion.button>
          ))}
        </motion.div>
      )}
    </AnimatePresence>
  );
}
