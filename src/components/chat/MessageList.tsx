import { useEffect, useRef, useState } from 'react';
import { ScrollArea } from '@/components/ui/scroll-area';
import { useChatStore } from '@/store/chatStore';
import { MessageBubble } from '@/components/chat/MessageBubble';
import { TypingIndicator } from '@/components/chat/TypingIndicator';
import { UnreadMessageSeparator } from '@/components/chat/UnreadMessageSeparator';
import { Loader2 } from 'lucide-react';
import { useAuthStore } from '@/store/authStore';

export function MessageList() {
  const { messages, typingUsers, activeGroup, loadOlderMessages, isLoadingOlder, hasMoreOlder, firstUnreadMessageId, unreadCount } = useChatStore();
  const { user } = useAuthStore();
  const scrollAreaRef = useRef<HTMLDivElement>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const unreadSeparatorRef = useRef<HTMLDivElement>(null);
  const [hasScrolledToUnread, setHasScrolledToUnread] = useState(false);

  // Debug logging for unread tracking
  useEffect(() => {
    console.log(`🔍 MessageList: firstUnreadMessageId=${firstUnreadMessageId}, unreadCount=${unreadCount}, messages=${messages.length}`);
  }, [firstUnreadMessageId, unreadCount, messages.length]);

  const loadingOlderRef = useRef(false);

  // Attach scroll listener to the ScrollArea viewport for automatic lazy loading of older messages
  // WhatsApp-style: automatically load when scrolling near the top
  useEffect(() => {
    const viewport = scrollAreaRef.current?.querySelector('[data-radix-scroll-area-viewport]') as HTMLElement | null;
    if (!viewport) return;

    const onScroll = async () => {
      if (!activeGroup || loadingOlderRef.current) return;
      // Trigger loading when within 150px of the top (WhatsApp-style threshold)
      if (viewport.scrollTop <= 150 && hasMoreOlder && !isLoadingOlder) {
        loadingOlderRef.current = true;
        const prevHeight = viewport.scrollHeight;
        const prevTop = viewport.scrollTop;
        try {
          const loaded = await loadOlderMessages(activeGroup.id, 30);
          if (loaded > 0) {
            // Preserve scroll position to avoid jump after prepending
            requestAnimationFrame(() => {
              const newHeight = viewport.scrollHeight;
              viewport.scrollTop = newHeight - prevHeight + prevTop;
            });
          }
        } catch (e) {
          console.warn('Lazy-load older messages failed', e);
        } finally {
          loadingOlderRef.current = false;
        }
      }
    };

    viewport.addEventListener('scroll', onScroll, { passive: true });
    return () => viewport.removeEventListener('scroll', onScroll);
  }, [activeGroup?.id, hasMoreOlder, isLoadingOlder, loadOlderMessages]);

  // Auto-scroll to first unread message on initial load
  useEffect(() => {
    if (firstUnreadMessageId && !hasScrolledToUnread && messages.length > 0 && unreadSeparatorRef.current) {
      console.log(`📍 Auto-scrolling to first unread message: ${firstUnreadMessageId}`);
      setTimeout(() => {
        unreadSeparatorRef.current?.scrollIntoView({
          behavior: 'smooth',
          block: 'center'
        });
        setHasScrolledToUnread(true);
      }, 300); // Small delay to ensure DOM is fully rendered
    }
  }, [firstUnreadMessageId, messages.length, hasScrolledToUnread]);

  // Reset scroll flag when changing groups
  useEffect(() => {
    setHasScrolledToUnread(false);
  }, [activeGroup?.id]);

  // Auto-scroll to bottom when new messages arrive (only if no unread or already scrolled to unread)
  useEffect(() => {
    if (messagesEndRef.current && messages.length > 0 && (!firstUnreadMessageId || hasScrolledToUnread)) {
      // Use setTimeout to ensure DOM is updated
      setTimeout(() => {
        messagesEndRef.current?.scrollIntoView({
          behavior: 'instant',
          block: 'end'
        });
      }, 0);
    }
  }, [messages, typingUsers, firstUnreadMessageId, hasScrolledToUnread]);

  if (messages.length === 0 && typingUsers.length === 0) {
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
      className="h-full overflow-x-hidden smooth-scroll-messages"
      ref={scrollAreaRef}
    >
      <div className="p-2 sm:p-3 md:p-4 space-y-1 overflow-x-hidden messages-container">
        {/* Loading indicator for older messages - WhatsApp style */}
        {isLoadingOlder && hasMoreOlder && (
          <div className="flex items-center justify-center py-2">
            <Loader2 className="w-4 h-4 text-muted-foreground animate-spin" />
            <span className="ml-2 text-xs text-muted-foreground">Loading older messages...</span>
          </div>
        )}

        {messages.map((message, index) => {
          // Check if this is the first unread message
          const isFirstUnread = message.id === firstUnreadMessageId;

          // Determine if we should show sender name (WhatsApp-style grouping)
          // Show name if: first message OR different sender OR ghost mode changed
          const prevMessage = index > 0 ? messages[index - 1] : null;
          const showSenderName = !prevMessage ||
            prevMessage.user_id !== message.user_id ||
            prevMessage.is_ghost !== message.is_ghost;

          return (
            <div key={message.id}>
              {/* Show unread separator before first unread message */}
              {isFirstUnread && (
                <div ref={unreadSeparatorRef}>
                  <UnreadMessageSeparator />
                </div>
              )}
              <MessageBubble
                message={message}
                showSenderName={showSenderName}
                isNewSender={showSenderName}
              />
            </div>
          );
        })}

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