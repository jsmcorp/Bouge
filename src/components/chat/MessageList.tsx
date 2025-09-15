import { useEffect, useRef, useState } from 'react';
import { ScrollArea } from '@/components/ui/scroll-area';
import { useChatStore } from '@/store/chatStore';
import { MessageBubble } from '@/components/chat/MessageBubble';
import { TypingIndicator } from '@/components/chat/TypingIndicator';
import { RefreshCw } from 'lucide-react';
import { toast } from 'sonner';
import { useAuthStore } from '@/store/authStore';

export function MessageList() {
  const { messages, typingUsers, activeGroup, fetchMessages } = useChatStore();
  const { user } = useAuthStore();
  const scrollAreaRef = useRef<HTMLDivElement>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const [isPulling, setIsPulling] = useState(false);
  const [pullDistance, setPullDistance] = useState(0);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const touchStartY = useRef(0);
  const scrollTop = useRef(0);

  // Auto-scroll to bottom when new messages arrive - instant scroll
  useEffect(() => {
    if (messagesEndRef.current && messages.length > 0) {
      // Use setTimeout to ensure DOM is updated
      setTimeout(() => {
        messagesEndRef.current?.scrollIntoView({ 
          behavior: 'instant',
          block: 'end'
        });
      }, 0);
    }
  }, [messages, typingUsers]);

  // Handle pull-to-refresh
  const handleTouchStart = (e: React.TouchEvent) => {
    touchStartY.current = e.touches[0].clientY;
    if (scrollAreaRef.current) {
      const scrollContainer = scrollAreaRef.current.querySelector('[data-radix-scroll-area-viewport]');
      if (scrollContainer) {
        scrollTop.current = scrollContainer.scrollTop;
      }
    }
  };

  const handleTouchMove = (e: React.TouchEvent) => {
    if (scrollTop.current === 0) {
      const touchY = e.touches[0].clientY;
      const distance = touchY - touchStartY.current;
      
      if (distance > 5) {
        setIsPulling(true);
        setPullDistance(Math.min(distance * 0.5, 80)); // Limit max pull distance
        e.preventDefault();
      }
    }
  };

  const handleTouchEnd = async () => {
    if (isPulling && pullDistance > 60 && activeGroup) {
      // Trigger refresh
      setIsRefreshing(true);
      setPullDistance(60); // Keep showing the refresh indicator
      
      try {
        await fetchMessages(activeGroup.id);
        toast.success('Messages refreshed');
      } catch (error) {
        console.error('Error refreshing messages:', error);
        toast.error('Failed to refresh messages');
      } finally {
        // Reset pull state with a small delay to show completion
        setTimeout(() => {
          setIsRefreshing(false);
          setIsPulling(false);
          setPullDistance(0);
        }, 500);
      }
    } else {
      // Reset pull state immediately if not triggering refresh
      setIsPulling(false);
      setPullDistance(0);
    }
  };

  // Remove loading screen - messages should load instantly from local storage

  if (messages.length === 0 && typingUsers.length === 0 && !isPulling && !isRefreshing) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="text-center">
          <p className="text-muted-foreground mb-2">No messages yet</p>
          <p className="text-sm text-muted-foreground">
            Be the first to start the conversation!
          </p>
        </div>
      </div>
    );
  }

  return (
    <ScrollArea 
      className="h-full overflow-x-hidden" 
      ref={scrollAreaRef}
      onTouchStart={handleTouchStart}
      onTouchMove={handleTouchMove}
      onTouchEnd={handleTouchEnd}
    >
      {/* Pull-to-refresh indicator */}
      {(isPulling || isRefreshing) && (
        <div 
          className="flex items-center justify-center py-2 sm:py-4 transition-transform"
          style={{ 
            transform: `translateY(${pullDistance}px)`,
            height: pullDistance > 0 ? `${pullDistance}px` : '0px'
          }}
        >
          <RefreshCw 
            className={`w-5 h-5 sm:w-6 sm:h-6 text-primary ${isRefreshing ? 'animate-spin' : ''}`} 
            style={{ 
              transform: `rotate(${pullDistance * 3}deg)` 
            }}
          />
          <span className="ml-2 text-xs sm:text-sm font-medium">
            {isRefreshing ? 'Refreshing...' : 'Pull to refresh'}
          </span>
        </div>
      )}

      <div className="p-2 sm:p-3 md:p-4 space-y-2 sm:space-y-2 overflow-x-hidden">
        {messages.map((message) => (
          <div key={message.id}>
            <MessageBubble message={message} />
          </div>
        ))}

        {/* Typing Indicator (hide self) */}
        {typingUsers.filter(u => u.user_id !== user?.id).length > 0 && (
          <div>
            <TypingIndicator typingUsers={typingUsers.filter(u => u.user_id !== user?.id)} />
          </div>
        )}

        {/* Invisible element to scroll to */}
        <div ref={messagesEndRef} className="h-1" />
      </div>
    </ScrollArea>
  );
}