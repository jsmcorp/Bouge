import { useEffect, useRef, useState } from 'react';
import { ScrollArea } from '@/components/ui/scroll-area';
import { useChatStore } from '@/store/chatStore';
import { MessageBubble } from '@/components/chat/MessageBubble';
import { MessageSelectionToolbar } from '@/components/chat/MessageSelectionToolbar';
import { TypingIndicator } from '@/components/chat/TypingIndicator';
import { UnreadMessageSeparator } from '@/components/chat/UnreadMessageSeparator';
import { Loader2 } from 'lucide-react';
import { useAuthStore } from '@/store/authStore';
import { Keyboard as CapacitorKeyboard } from '@capacitor/keyboard';
import { Capacitor } from '@capacitor/core';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';

export function MessageList() {
  const {
    messages,
    typingUsers,
    activeGroup,
    activeTopicId, // Used to detect Topic Chat mode
    loadOlderMessages,
    isLoadingOlder,
    hasMoreOlder,
    firstUnreadMessageId,
    unreadCount,
    replyingTo,
    selectionMode,
    selectedMessageIds,
    exitSelectionMode,
    setReplyingTo,
    deleteSelectedMessages,
    starSelectedMessages,
    reportSelectedMessages
  } = useChatStore();
  const { user } = useAuthStore();
  const scrollAreaRef = useRef<HTMLDivElement>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const unreadSeparatorRef = useRef<HTMLDivElement>(null);
  const [hasScrolledToUnread, setHasScrolledToUnread] = useState(false);
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);
  const previousMessagesLength = useRef(messages.length);
  const previousReplyingTo = useRef(replyingTo);
  const isLazyLoadingRef = useRef(false); // Track if we're currently lazy loading to prevent auto-scroll

  // Debug logging for unread tracking and lazy loading state
  useEffect(() => {
    console.log(`🔍 MessageList: firstUnreadMessageId=${firstUnreadMessageId}, unreadCount=${unreadCount}, messages=${messages.length}, hasMoreOlder=${hasMoreOlder}, isLoadingOlder=${isLoadingOlder}`);
  }, [firstUnreadMessageId, unreadCount, messages.length, hasMoreOlder, isLoadingOlder]);

  // Auto-exit selection mode when no messages are selected
  useEffect(() => {
    if (selectionMode && selectedMessageIds.size === 0) {
      exitSelectionMode();
    }
  }, [selectionMode, selectedMessageIds, exitSelectionMode]);

  const loadingOlderRef = useRef(false);
  const firstMessageRef = useRef<HTMLDivElement>(null);

  // Use Intersection Observer to detect when first message is visible (simpler and more reliable)
  // TOPIC CHAT FIX: Skip loading older messages when viewing a Topic Chat (activeTopicId is set)
  // In Topic Chat, we only show replies to that specific topic, not Quick Chat history
  useEffect(() => {
    // Skip loading older messages in Topic Chat mode
    if (activeTopicId) {
      console.log('📋 MessageList: Skipping loadOlderMessages setup - in Topic Chat mode');
      return;
    }

    if (!firstMessageRef.current || !hasMoreOlder || isLoadingOlder || !activeGroup) {
      return;
    }

    const observer = new IntersectionObserver(
      async (entries) => {
        const firstEntry = entries[0];

        // When first message becomes visible and we're not already loading
        if (firstEntry.isIntersecting && !loadingOlderRef.current && hasMoreOlder && !isLoadingOlder) {
          loadingOlderRef.current = true;
          isLazyLoadingRef.current = true;

          const viewport = scrollAreaRef.current?.querySelector('[data-radix-scroll-area-viewport]') as HTMLElement | null;
          const prevHeight = viewport?.scrollHeight || 0;
          const prevTop = viewport?.scrollTop || 0;

          try {
            const loaded = await loadOlderMessages(activeGroup.id, 30);

            if (loaded > 0 && viewport) {
              // Preserve scroll position
              requestAnimationFrame(() => {
                const newHeight = viewport.scrollHeight;
                viewport.scrollTop = newHeight - prevHeight + prevTop;
                setTimeout(() => {
                  isLazyLoadingRef.current = false;
                }, 100);
              });
            } else {
              isLazyLoadingRef.current = false;
            }
          } catch (e) {
            console.warn('Failed to load older messages:', e);
            isLazyLoadingRef.current = false;
          } finally {
            loadingOlderRef.current = false;
          }
        }
      },
      {
        root: scrollAreaRef.current?.querySelector('[data-radix-scroll-area-viewport]'),
        rootMargin: '200px 0px 0px 0px', // Trigger 200px before first message is visible
        threshold: 0
      }
    );

    observer.observe(firstMessageRef.current);

    return () => {
      observer.disconnect();
    };
  }, [activeGroup?.id, activeTopicId, hasMoreOlder, isLoadingOlder, loadOlderMessages, messages.length]);

  // Auto-scroll to first unread message on initial load
  useEffect(() => {
    if (firstUnreadMessageId && !hasScrolledToUnread && messages.length > 0) {
      console.log(`📍 Auto-scrolling to first unread message: ${firstUnreadMessageId}`);

      // Wait for DOM to render, then scroll
      setTimeout(() => {
        if (unreadSeparatorRef.current) {
          // Use scrollIntoView with specific options for better cross-platform support
          unreadSeparatorRef.current.scrollIntoView({
            behavior: 'smooth',
            block: 'start', // Changed from 'center' to 'start' for better visibility
            inline: 'nearest'
          });
          setHasScrolledToUnread(true);
          console.log('📍 Scrolled to unread separator');
        } else {
          console.warn('⚠️ Unread separator ref not found');
        }
      }, 500); // Increased delay for Android to ensure DOM is fully rendered
    }
  }, [firstUnreadMessageId, messages.length, hasScrolledToUnread]);

  // Reset scroll flag when changing groups
  useEffect(() => {
    setHasScrolledToUnread(false);

    // ✅ FIX: If there's no unread message, scroll to bottom immediately
    if (!firstUnreadMessageId && messages.length > 0) {
      const viewport = scrollAreaRef.current?.querySelector('[data-radix-scroll-area-viewport]') as HTMLElement | null;
      if (viewport) {
        setTimeout(() => {
          viewport.scrollTop = viewport.scrollHeight;
          console.log('📍 Auto-scrolled to bottom (no unread on open)');
        }, 100); // Small delay to ensure DOM is ready
      }
    }
  }, [activeGroup?.id, firstUnreadMessageId, messages.length]);

  // Auto-scroll to bottom when new messages arrive (only if no unread or already scrolled to unread)
  // WhatsApp-style: instant scroll to bottom, respecting bottom padding
  // IMPORTANT: Only scroll when messages actually change, NOT when replyingTo changes
  // CRITICAL: Do NOT scroll when lazy loading older messages (preserve scroll position)
  useEffect(() => {
    const viewport = scrollAreaRef.current?.querySelector('[data-radix-scroll-area-viewport]') as HTMLElement | null;

    // Check if messages actually changed (not just replyingTo)
    const messagesChanged = messages.length !== previousMessagesLength.current;
    const replyingToChanged = replyingTo !== previousReplyingTo.current;

    // Update refs
    previousMessagesLength.current = messages.length;
    previousReplyingTo.current = replyingTo;

    // Only scroll if:
    // 1. Messages changed (not just replyingTo)
    // 2. NOT currently lazy loading (preserve scroll position for older messages)
    // 3. No unread messages or already scrolled to unread
    if (viewport && messages.length > 0 && (!firstUnreadMessageId || hasScrolledToUnread) && messagesChanged && !replyingToChanged && !isLazyLoadingRef.current) {
      // Use setTimeout to ensure DOM is updated
      setTimeout(() => {
        // Scroll to the very bottom - the padding-bottom will ensure last message is visible
        viewport.scrollTop = viewport.scrollHeight;
        console.log('📍 Auto-scrolled to bottom (new message)');
      }, 0);
    }
  }, [messages, typingUsers, firstUnreadMessageId, hasScrolledToUnread, replyingTo]);

  // Handle keyboard show/hide events on mobile (WhatsApp-style)
  // When keyboard opens, scroll to show the last message above it
  // CRITICAL FIX: Wait for viewport to resize before scrolling
  useEffect(() => {
    if (!Capacitor.isNativePlatform()) return;

    const viewport = scrollAreaRef.current?.querySelector('[data-radix-scroll-area-viewport]') as HTMLElement | null;

    let keyboardShowHandle: any;
    let keyboardHideHandle: any;

    CapacitorKeyboard.addListener('keyboardWillShow', (info) => {
      console.log('⌨️ Keyboard opening, height:', info.keyboardHeight);
      // CRITICAL: Wait for viewport to resize (Capacitor resize: 'body' mode)
      // Then scroll to bottom to show latest messages above keyboard
      if (viewport) {
        // Wait longer for viewport resize to complete
        setTimeout(() => {
          viewport.scrollTop = viewport.scrollHeight;
          console.log('⌨️ Scrolled to bottom after keyboard opened, scrollTop:', viewport.scrollTop, 'scrollHeight:', viewport.scrollHeight);
        }, 300); // Increased delay to ensure viewport resize completes
      }
    }).then(handle => {
      keyboardShowHandle = handle;
    });

    CapacitorKeyboard.addListener('keyboardWillHide', () => {
      console.log('⌨️ Keyboard closing');
      // Scroll to bottom when keyboard closes to maintain view
      if (viewport) {
        setTimeout(() => {
          viewport.scrollTop = viewport.scrollHeight;
          console.log('⌨️ Scrolled to bottom after keyboard closed');
        }, 300); // Increased delay to ensure viewport resize completes
      }
    }).then(handle => {
      keyboardHideHandle = handle;
    });

    return () => {
      if (keyboardShowHandle) keyboardShowHandle.remove();
      if (keyboardHideHandle) keyboardHideHandle.remove();
    };
  }, []);

  // Handle toolbar actions
  const handleReply = () => {
    const selectedMessage = messages.find(m => selectedMessageIds.has(m.id));
    if (selectedMessage) {
      setReplyingTo(selectedMessage);
      exitSelectionMode();
    }
  };

  const handleStar = async () => {
    await starSelectedMessages();
  };

  const handleDelete = () => {
    setShowDeleteDialog(true);
  };

  const handleConfirmDelete = async () => {
    await deleteSelectedMessages();
    setShowDeleteDialog(false);
  };

  const handleReport = async () => {
    await reportSelectedMessages();
  };

  const handleCancelSelection = () => {
    exitSelectionMode();
  };

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
    <>
      {/* Selection Toolbar */}
      {selectionMode && (
        <MessageSelectionToolbar
          selectedCount={selectedMessageIds.size}
          onReply={handleReply}
          onStar={handleStar}
          onDelete={handleDelete}
          onReport={handleReport}
          onCancel={handleCancelSelection}
        />
      )}

      {/* Delete Confirmation Dialog */}
      <AlertDialog open={showDeleteDialog} onOpenChange={setShowDeleteDialog}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete messages?</AlertDialogTitle>
            <AlertDialogDescription>
              This will delete {selectedMessageIds.size} message{selectedMessageIds.size > 1 ? 's' : ''} from your device.
              You won't be able to see {selectedMessageIds.size > 1 ? 'them' : 'it'} again.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleConfirmDelete} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

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

            // Attach ref to first message for lazy loading detection
            const isFirstMessage = index === 0;

            return (
              <div key={message.id} ref={isFirstMessage ? firstMessageRef : null}>
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
    </>
  );
}