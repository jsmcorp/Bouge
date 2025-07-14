import { motion } from 'framer-motion';
import { Ghost } from 'lucide-react';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { TypingUser } from '@/store/chatStore';

interface TypingIndicatorProps {
  typingUsers: TypingUser[];
}

export function TypingIndicator({ typingUsers }: TypingIndicatorProps) {
  if (typingUsers.length === 0) return null;

  const getTypingText = () => {
    if (typingUsers.length === 1) {
      const user = typingUsers[0];
      return `${user.is_ghost ? 'Ghost' : user.display_name} is typing...`;
    } else if (typingUsers.length === 2) {
      return `${typingUsers[0].is_ghost ? 'Ghost' : typingUsers[0].display_name} and ${
        typingUsers[1].is_ghost ? 'Ghost' : typingUsers[1].display_name
      } are typing...`;
    } else {
      return `${typingUsers.length} people are typing...`;
    }
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -10 }}
      className="flex items-start space-x-3 px-2"
    >
      {/* Show avatars for up to 3 typing users */}
      <div className="flex -space-x-2">
        {typingUsers.slice(0, 3).map((user, index) => (
          <motion.div
            key={user.user_id}
            initial={{ scale: 0 }}
            animate={{ scale: 1 }}
            transition={{ delay: index * 0.1 }}
            className="relative"
          >
            {user.is_ghost ? (
              <div className="flex items-center justify-center w-6 h-6 bg-muted/50 rounded-full border-2 border-background">
                <Ghost className="w-3 h-3 text-muted-foreground" />
              </div>
            ) : (
              <Avatar className="w-6 h-6 border-2 border-background">
                <AvatarImage src={user.avatar_url || ''} />
                <AvatarFallback className="text-xs">
                  {user.display_name?.charAt(0) || 'U'}
                </AvatarFallback>
              </Avatar>
            )}
          </motion.div>
        ))}
      </div>

      {/* Typing text and dots */}
      <div className="flex items-center space-x-2">
        <span className="text-sm text-muted-foreground font-medium">
          {getTypingText()}
        </span>
        
        {/* Animated dots */}
        <div className="flex space-x-1">
          {[0, 1, 2].map((i) => (
            <motion.div
              key={i}
              animate={{
                scale: [1, 1.2, 1],
                opacity: [0.5, 1, 0.5],
              }}
              transition={{
                duration: 1.5,
                repeat: Infinity,
                delay: i * 0.2,
                ease: "easeInOut",
              }}
              className="w-1.5 h-1.5 bg-muted-foreground rounded-full"
            />
          ))}
        </div>
      </div>
    </motion.div>
  );
}