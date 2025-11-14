import * as React from 'react';
import { useState } from 'react';
import { useEffect } from 'react';
import { useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { format } from 'date-fns';
import { Reply, Check, Clock, AlertCircle, Image as ImageIcon, Download } from 'lucide-react';
import { motion, useMotionValue, useTransform, AnimatePresence } from 'framer-motion';
import { Haptics, ImpactStyle } from '@capacitor/haptics';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Message, useChatStore } from '@/store/chatStore';
import { useAuthStore } from '@/store/authStore';
import { useIsMobile } from '@/hooks/useMediaQuery';
import { PollComponent } from '@/components/chat/PollComponent';
import { MessageReactions } from '@/components/chat/MessageReactions';
import { QuickReactionBar } from '@/components/chat/QuickReactionBar';
import { pseudonymService } from '@/lib/pseudonymService';
import { cn } from '@/lib/utils';
import { Reaction } from '@/store/chat/reactions';

// WhatsApp-exact swipe constants - pixel perfect
const SWIPE_TRIGGER_DISTANCE = 40; // 40px to trigger reply (WhatsApp exact)
const SWIPE_MAX_DISTANCE = 60; // Maximum swipe distance before resistance
const SWIPE_VERTICAL_THRESHOLD = 20; // Cancel if vertical movement exceeds this

interface MessageBubbleProps {
  message: Message;
  isThreadOriginal?: boolean;
  isThreadReply?: boolean;
  showInlineReplies?: boolean;
  showSenderName?: boolean;
  isNewSender?: boolean;
}

const CATEGORY_COLORS = {
  funny: 'badge-funny-ultra',
  serious: 'bg-red-500/20 text-red-500 border-red-500/30',
  advice: 'bg-blue-500/20 text-blue-500 border-blue-500/30',
  support: 'bg-purple-500/20 text-purple-500 border-purple-500/30',
};

// Premium WhatsApp colors - simple and clean
const BUBBLE_COLORS = {
  sent: { bg: '#D9FDD3', text: '#303030' },      // Light green for sent messages
  received: { bg: '#FFFFFF', text: '#303030' },  // White for received messages
  ghost: { bg: '#FFFFFF', text: '#303030' },     // White for ghost messages
  confession: { bg: '#FFFFFF', text: '#303030' }, // White for confessions
};

const DeliveryStatusIcon = ({ status }: { status?: string }) => {
  switch (status) {
    case 'sending':
      return <Clock className="w-2.5 h-2.5 text-muted-foreground/60 animate-pulse" />;
    case 'sent':
      return <Check className="w-2.5 h-2.5 text-muted-foreground/60" />;
    case 'delivered':
      return <Check className="w-2.5 h-2.5 text-green-500/70" />;
    case 'failed':
      return <AlertCircle className="w-2.5 h-2.5 text-red-500/70" />;
    default:
      return null;
  }
};

export function MessageBubble({
  message,
  isThreadOriginal = false,
  isThreadReply = false,
  showInlineReplies = true,
  showSenderName = true,
  isNewSender = true
}: MessageBubbleProps) {
  const [showQuickReactions, setShowQuickReactions] = useState(false);
  const [activeEmoji, setActiveEmoji] = useState<string | null>(null);
  const longPressTimeoutRef = useRef<number | null>(null);
  const bubbleRef = useRef<HTMLDivElement | null>(null);
  const [ghostPseudonym, setGhostPseudonym] = useState<string>('Ghost');
  
  const navigate = useNavigate();
  const isMobile = useIsMobile();
  const { user } = useAuthStore();
  const { 
    setReplyingTo, 
    openThread, 
    activeThread, 
    activeGroup, 
    messageReactions, 
    addOrRemoveReaction,
    activeSwipeMessageId,
    setActiveSwipeMessage,
    selectionMode,
    selectedMessageIds,
    toggleMessageSelection,
    enterSelectionMode,
    exitSelectionMode
  } = useChatStore();
  const isGhost = message.is_ghost;
  const isConfession = message.message_type === 'confession';
  const isPoll = message.message_type === 'poll';
  const isImage = message.message_type === 'image';
  const hasReplies = message.reply_count && message.reply_count > 0;
  const hasMoreReplies = message.reply_count && message.reply_count > 3;
  const isOwnMessage = user?.id === message.user_id;
  const isRightAligned = isOwnMessage && !isGhost; // Normal self messages on right; ghost always left

  // Get bubble color based on message type
  const bubbleColor = isGhost || isConfession
    ? BUBBLE_COLORS.ghost
    : isOwnMessage
      ? BUBBLE_COLORS.sent
      : BUBBLE_COLORS.received;

  // Get reactions for this message
  const reactions = messageReactions[message.id] || [];
  
  // Convert chatStore reactions to the format expected by MessageReactions component
  const formattedReactions: Reaction[] = reactions.map((r: any) => ({
    ...r,
    created_at: r.created_at || new Date().toISOString() // Use existing or add new created_at field
  }));

  // Debug logging
  useEffect(() => {
    if (reactions.length > 0) {
      console.log(`💬 Message ${message.id} has ${reactions.length} reactions:`, reactions);
    }
  }, [reactions.length, message.id]);



  // Fetch pseudonym for ghost messages
  // CRITICAL FIX: Use pseudonym from message object if available (loaded during lazy load)
  // This prevents RPC calls for older messages loaded from SQLite
  useEffect(() => {
    if (isGhost && activeGroup?.id && message.user_id) {
      // If message already has pseudonym (from lazy load), use it immediately
      if (message.pseudonym) {
        console.log('🎭 Using pseudonym from message object:', message.pseudonym);
        setGhostPseudonym(message.pseudonym);
        return;
      }

      // Otherwise, fetch from pseudonym service (will check cache and SQLite first)
      const fetchPseudonym = async () => {
        try {
          const pseudonym = await pseudonymService.getPseudonym(activeGroup.id, message.user_id);
          setGhostPseudonym(pseudonym);
        } catch (error) {
          console.error('Failed to fetch pseudonym:', error);
          setGhostPseudonym('Anonymous Ghost');
        }
      };

      fetchPseudonym();
    }
  }, [isGhost, activeGroup?.id, message.user_id, message.pseudonym]);

  // WhatsApp-exact swipe gesture - completely rewritten
  const swipeX = useMotionValue(0);
  const replyIconOpacity = useTransform(swipeX, [0, SWIPE_TRIGGER_DISTANCE], [0, 1]);
  const replyIconScale = useTransform(swipeX, [0, SWIPE_TRIGGER_DISTANCE], [0.5, 1]);

  // Touch tracking for swipe
  const touchStartX = useRef(0);
  const touchStartY = useRef(0);
  const isSwiping = useRef(false);
  const swipeCancelled = useRef(false);

  // Reset swipe when another message is swiped
  useEffect(() => {
    if (activeSwipeMessageId !== message.id && swipeX.get() !== 0) {
      swipeX.set(0);
      isSwiping.current = false;
    }
  }, [activeSwipeMessageId, message.id, swipeX]);

  // WhatsApp-exact swipe handlers
  const handleSwipeStart = (e: React.TouchEvent) => {
    if (!isMobile || isThreadOriginal || isThreadReply || selectionMode) return;

    const touch = e.touches[0];
    touchStartX.current = touch.clientX;
    touchStartY.current = touch.clientY;
    isSwiping.current = false;
    swipeCancelled.current = false;

    setActiveSwipeMessage(message.id);
  };

  const handleSwipeMove = (e: React.TouchEvent) => {
    if (!isMobile || isThreadOriginal || isThreadReply || swipeCancelled.current || showQuickReactions) return;

    const touch = e.touches[0];
    const deltaX = touch.clientX - touchStartX.current;
    const deltaY = touch.clientY - touchStartY.current;

    // Cancel if vertical movement exceeds threshold
    if (Math.abs(deltaY) > SWIPE_VERTICAL_THRESHOLD) {
      swipeCancelled.current = true;
      swipeX.set(0);
      isSwiping.current = false;
      return;
    }

    // Only allow right swipe (positive deltaX)
    if (deltaX < 0) {
      swipeX.set(0);
      return;
    }

    // Start swiping if horizontal movement detected
    if (!isSwiping.current && Math.abs(deltaX) > 5) {
      isSwiping.current = true;
    }

    if (isSwiping.current) {
      // Apply resistance after max distance
      let newX = deltaX;
      if (deltaX > SWIPE_MAX_DISTANCE) {
        const excess = deltaX - SWIPE_MAX_DISTANCE;
        newX = SWIPE_MAX_DISTANCE + (excess * 0.2); // 80% resistance
      }
      swipeX.set(newX);
    }
  };

  const handleSwipeEnd = async () => {
    if (!isMobile || isThreadOriginal || isThreadReply || swipeCancelled.current) {
      swipeX.set(0);
      isSwiping.current = false;
      swipeCancelled.current = false;
      setActiveSwipeMessage(null);
      return;
    }

    const currentX = swipeX.get();

    // Trigger reply if threshold reached
    if (currentX >= SWIPE_TRIGGER_DISTANCE) {
      try {
        await Haptics.impact({ style: ImpactStyle.Light });
      } catch (_) {}

      handleReply();
    }

    // Smooth spring back to 0
    swipeX.set(0);

    isSwiping.current = false;
    swipeCancelled.current = false;

    setTimeout(() => {
      setActiveSwipeMessage(null);
    }, 150);
  };

  // Simplified long-press handler - WhatsApp style
  const cancelLongPressTimer = () => {
    if (longPressTimeoutRef.current) {
      window.clearTimeout(longPressTimeoutRef.current);
      longPressTimeoutRef.current = null;
    }
  };

  const startLongPress = (e: React.PointerEvent) => {
    if (isThreadOriginal || isThreadReply || selectionMode) return;
    e.stopPropagation();
    cancelLongPressTimer();
    
    longPressTimeoutRef.current = window.setTimeout(async () => {
      // WhatsApp-style: Enter selection mode, select this message, show quick reactions
      enterSelectionMode();
      toggleMessageSelection(message.id);
      setShowQuickReactions(true);
      
      // Cancel any ongoing swipe
      swipeCancelled.current = true;
      isSwiping.current = false;
      swipeX.set(0);
      
      try {
        await Haptics.impact({ style: ImpactStyle.Medium });
      } catch (_) {}
    }, 500); // 500ms for long press
  };

  const handlePointerUp = (e: React.PointerEvent) => {
    e.stopPropagation();
    cancelLongPressTimer();
  };

  const handlePointerCancel = (e?: React.PointerEvent) => {
    e?.stopPropagation();
    cancelLongPressTimer();
  };

  // Handle message click in selection mode
  const handleMessageClick = (e: React.MouseEvent) => {
    if (selectionMode) {
      e.preventDefault();
      e.stopPropagation();
      toggleMessageSelection(message.id);
      
      // Hide quick reactions when multiple messages are selected
      if (selectedMessageIds.size >= 1) {
        setShowQuickReactions(false);
      }
      
      try {
        Haptics.impact({ style: ImpactStyle.Light });
      } catch (_) {}
    }
  };

  // Handle quick reaction selection
  const handleQuickReaction = async (emoji: string) => {
    try {
      await addOrRemoveReaction(message.id, emoji);
      setActiveEmoji(emoji);
      setTimeout(() => setActiveEmoji(null), 800);
      
      // Hide quick reactions and exit selection mode after reacting
      setShowQuickReactions(false);
      exitSelectionMode();
    } catch (error) {
      console.error('Failed to add reaction:', error);
    }
  };

  // Hide quick reactions when exiting selection mode
  useEffect(() => {
    if (!selectionMode) {
      setShowQuickReactions(false);
    }
  }, [selectionMode]);


  const handleReply = (e?: React.MouseEvent) => {
    e?.preventDefault();
    e?.stopPropagation();
    setReplyingTo(message);
  };

  const handleViewThread = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (isMobile && activeGroup) {
      navigate(`/groups/${activeGroup.id}/thread/${message.id}`);
    } else {
      openThread(message);
    }
  };

  const handleImageDownload = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (message.image_url) {
      const link = document.createElement('a');
      link.href = message.image_url;
      link.download = `image_${message.id}.jpg`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
    }
  };
  const handleToggleReaction = (emoji: string) => {
    addOrRemoveReaction(message.id, emoji);
  };

  // If this is a poll message, render the poll component
  if (isPoll && message.poll) {
    return (
      <div className={cn(
        "group mb-4",
        {
          "bg-card/50 border-l-4 border-l-green-500 pl-4 rounded-lg p-3": isThreadOriginal,
          "ml-8 pl-4 thread-reply-line": isThreadReply,
          "bg-green-500/5 rounded-lg p-2": activeThread?.id === message.id && !isThreadOriginal,
          "opacity-75": message.delivery_status === 'sending',
          "border border-red-500/20 bg-red-500/5": message.delivery_status === 'failed'
        }
      )}>
        <div className="space-y-3">
          {/* Poll Component */}
          <PollComponent poll={message.poll} />

          {/* Message Actions removed - cleaner WhatsApp-style UI */}

          {/* Message Reactions for Polls */}
          {reactions.length > 0 && !isThreadReply && (
            <MessageReactions 
              reactions={formattedReactions} 
              onToggleReaction={handleToggleReaction}
            />
          )}

          {/* Inline Replies for Polls */}
          {!isThreadReply && !isThreadOriginal && showInlineReplies && message.replies && message.replies.length > 0 && (
            <div className="mt-3 space-y-2">
              {message.replies.map((reply) => (
                <MessageBubble 
                  key={reply.id} 
                  message={reply} 
                  isThreadReply={true}
                  showInlineReplies={false}
                />
              ))}
              
              {hasMoreReplies && (
                <Button
                  variant="ghost"
                  size="sm"
                  className="text-xs text-green-500 hover:text-green-400 ml-8"
                  onClick={handleViewThread}
                >
                  View {message.reply_count! - 3} more replies
                </Button>
              )}
            </div>
          )}

          {/* Reply Count for polls without inline replies */}
          {!isThreadReply && !isThreadOriginal && !showInlineReplies && hasReplies && (
            <div className="text-xs text-muted-foreground mt-2">
              {message.reply_count} {message.reply_count === 1 ? 'reply' : 'replies'}
            </div>
          )}
        </div>
      </div>
    );
  }

  const isSelected = selectedMessageIds.has(message.id);

  // Regular message rendering - WhatsApp style
  return (
    <div 
      className={cn(
        "group relative mb-0.5",
        isNewSender ? "mt-3" : "mt-0",
        {
          "bg-card/50 border-l-4 border-l-green-500 pl-4 rounded-lg p-3": isThreadOriginal,
          "ml-8 pl-4 thread-reply-line": isThreadReply,
          "bg-green-500/5 rounded-lg p-2": activeThread?.id === message.id && !isThreadOriginal,
          "opacity-75": message.delivery_status === 'sending',
          "border border-red-500/20 bg-red-500/5": message.delivery_status === 'failed',
          "bg-primary/10": isSelected && selectionMode
        }
      )}
      onClick={handleMessageClick}
    >
      {/* Quick Reactions Bar - positioned relative to message container */}
      {showQuickReactions && (
        <div className="flex justify-center w-full absolute bottom-full mb-2 z-30">
          <QuickReactionBar
            isVisible={showQuickReactions}
            onReactionSelect={handleQuickReaction}
          />
        </div>
      )}

      {/* Reply Icon - WhatsApp exact style */}
      {isMobile && !isThreadOriginal && !isThreadReply && !selectionMode && (
        <motion.div
          className="absolute left-3 top-1/2 -translate-y-1/2 z-10 pointer-events-none"
          style={{ opacity: replyIconOpacity, scale: replyIconScale }}
        >
          <Reply className="w-5 h-5 text-muted-foreground" />
        </motion.div>
      )}

      {/* Main message content - wrapper for positioning */}
      <div className="relative w-full">
        {/* Message Container */}
        <motion.div
          className={cn(
            "flex items-start max-w-full gap-3",
            {
              "flex-row-reverse": isRightAligned && !isThreadReply,
            }
          )}
          style={{ x: swipeX }}
        >
          {/* Avatar removed for cleaner look as requested */}

          {/* Message Content */}
          <div className={cn("flex-1 min-w-0", { "items-end": isRightAligned && !isThreadReply })}>
            {/* Message Bubble - WhatsApp exact swipe */}
            <motion.div
              ref={bubbleRef}
              onTouchStart={handleSwipeStart}
              onTouchMove={handleSwipeMove}
              onTouchEnd={handleSwipeEnd}
              onPointerDown={startLongPress}
              onPointerUp={handlePointerUp}
              onPointerCancel={handlePointerCancel}
              onPointerLeave={handlePointerCancel}
              onContextMenu={(e: React.MouseEvent) => e.preventDefault()}
              style={{
                backgroundColor: isImage ? undefined : (isSelected && selectionMode ? 
                  (isOwnMessage ? '#C1F0B5' : '#E8E8E8') : // Darker highlight when selected
                  bubbleColor.bg),
                color: isImage ? undefined : bubbleColor.text,
              }}
              className={cn(
              "rounded-2xl px-4 pt-3 pb-3 transition-all duration-200 max-w-[85%] w-fit relative select-none",
              "chat-bubble-base",
              {
                // Apply special classes only for image
                "chat-bubble-ultra-fade": isImage,
                "chat-bubble-thread-reply": isThreadReply,
                "ring-2 ring-primary/30": isSelected && selectionMode, // WhatsApp-style ring
              },
              isRightAligned ? "bubble-right ml-auto" : "bubble-left"
            )}
            >
              {/* Emoji pop animation */}
              <AnimatePresence>
                {activeEmoji && (
                  <motion.div
                    key={activeEmoji}
                    initial={{ opacity: 0, scale: 0.2, y: 0 }}
                    animate={{ opacity: 1, scale: 1.3, y: -12 }}
                    exit={{ opacity: 0, scale: 0.8, y: -20 }}
                    transition={{ type: "spring", stiffness: 400, damping: 20, duration: 0.6 }}
                    className="absolute -top-8 left-1/2 -translate-x-1/2 z-20"
                  >
                    <div className="h-8 w-8 rounded-full bg-background/80 border border-border/50 shadow flex items-center justify-center">
                      <span className="text-xl">{activeEmoji}</span>
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
              <div className="chat-bubble-content">
                {/* Header inside bubble - only show if showSenderName is true */}
                {showSenderName && (
                  <div className="mb-2">
                    <div className={cn("flex items-center gap-2 mb-1.5", { "justify-end": isRightAligned && !isThreadReply })}>
                      <span className={cn(
                        "message-sender-name",
                        isThreadReply ? "text-xs" : "text-sm"
                      )}>
                        {isGhost ? ghostPseudonym : isConfession ? 'Anonymous' : message.author?.display_name || 'Anonymous'}
                      </span>
                    </div>
                    {/* Premium divider line */}
                    <div
                      className="h-px w-full opacity-15"
                      style={{
                        background: `linear-gradient(90deg, transparent 0%, ${bubbleColor.text} 50%, transparent 100%)`
                      }}
                    />
                  </div>
                )}
                {/* Badges inside bubble */}
                {!isThreadReply && showSenderName && (
                  <div className={cn("flex items-center gap-2 mb-1", { "justify-end": isOwnMessage && !isThreadReply })}>
                    {isConfession && (
                      <span className="badge-confession-ultra">Confession</span>
                    )}
                    {message.category && (
                      <span className={cn(
                        "text-xs",
                        message.category === 'funny' ? 'badge-funny-ultra' : CATEGORY_COLORS[message.category as keyof typeof CATEGORY_COLORS] || 'bg-muted'
                      )}>
                        {message.category === 'funny' ? 'Funny' : message.category}
                      </span>
                    )}
                    {/* Anony tag removed as requested */}
                    {isImage && (
                      <Badge variant="secondary" className="text-xs bg-blue-500/20 text-blue-500 border-blue-500/30">
                        <ImageIcon className="w-3 h-3 mr-1" />
                        Image
                      </Badge>
                    )}
                  </div>
                )}
                {/* Message Content with inline timestamp (WhatsApp style) */}
                <div className="message-content-wrapper">
                  {message.image_url ? (
                    <div className="space-y-2">
                      <div className="relative group">
                        <img
                          src={message.image_url}
                          alt="Shared image"
                          className="max-w-full max-h-64 rounded-lg border border-border/50 cursor-pointer hover:opacity-90 transition-opacity"
                          onClick={() => window.open(message.image_url!, '_blank')}
                        />
                        <div className="absolute top-2 right-2 opacity-0 group-hover:opacity-100 transition-opacity">
                          <Button
                            variant="secondary"
                            size="sm"
                            onClick={handleImageDownload}
                            className="h-8 w-8 p-0 bg-black/50 hover:bg-black/70 border-0"
                          >
                            <Download className="w-3 h-3 text-white" />
                          </Button>
                        </div>
                      </div>
                      {message.content && message.content !== 'Image' && (
                        <div className="message-text-with-time">
                          <span className={cn(
                            "whitespace-pre-wrap break-words break-all text-foreground/90",
                            isThreadReply ? "text-sm" : "text-sm"
                          )}>
                            {message.content}
                          </span>
                          <span className="message-timestamp-inline">
                            <span className="timestamp">
                              {format(new Date(message.created_at), 'h:mm a')}
                            </span>
                            {message.delivery_status && (
                              <DeliveryStatusIcon status={message.delivery_status} />
                            )}
                          </span>
                        </div>
                      )}
                    </div>
                  ) : (
                    <div className="message-text-with-time">
                      <span className={cn(
                        "whitespace-pre-wrap break-words break-all text-foreground/90",
                        isThreadReply ? "text-sm" : "text-sm"
                      )}>
                        {message.content}
                      </span>
                      <span className="message-timestamp-inline">
                        <span className="timestamp">
                          {format(new Date(message.created_at), 'h:mm a')}
                        </span>
                        {message.delivery_status && (
                          <DeliveryStatusIcon status={message.delivery_status} />
                        )}
                      </span>
                    </div>
                  )}
                </div>
              </div>
            </motion.div>

            {/* Timestamp moved inside bubble; removing external gap */}

            {/* Reactions - Telegram style, sticked below message */}
            {reactions.length > 0 && !isThreadReply && (
              <div className="relative mt-1 mb-1">
                <MessageReactions 
                  reactions={formattedReactions} 
                  onToggleReaction={handleToggleReaction}
                />
              </div>
            )}

            {/* Message Actions removed - cleaner WhatsApp-style UI */}

            {/* Inline Replies */}
            {!isThreadReply && !isThreadOriginal && showInlineReplies && message.replies && message.replies.length > 0 && (
              <div className="mt-3 space-y-2">
                {message.replies.map((reply) => (
                  <MessageBubble 
                    key={reply.id} 
                    message={reply} 
                    isThreadReply={true}
                    showInlineReplies={false}
                  />
                ))}
                
                {hasMoreReplies && (
                  <Button
                    variant="ghost"
                    size="sm"
                    className="text-xs text-green-500 hover:text-green-400 ml-8"
                    onClick={handleViewThread}
                  >
                    View {message.reply_count! - 3} more replies
                  </Button>
                )}
              </div>
            )}

            {/* Reply Count for threads without inline replies */}
            {!isThreadReply && !isThreadOriginal && !showInlineReplies && hasReplies && (
              <div className="text-xs text-muted-foreground mt-2">
                {message.reply_count} {message.reply_count === 1 ? 'reply' : 'replies'}
              </div>
            )}
          </div>
        </motion.div>
      </div>
    </div>
  );
}