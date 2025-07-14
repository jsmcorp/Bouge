import { useState } from 'react';
import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { formatDistanceToNow } from 'date-fns';
import { Ghost, Smile, MessageCircle, MoreHorizontal, Reply, Check, Clock, AlertCircle, Image as ImageIcon, Download } from 'lucide-react';
import { motion, useMotionValue, useTransform, useSpring, PanInfo } from 'framer-motion';
import { Haptics, ImpactStyle } from '@capacitor/haptics';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import { Message, useChatStore } from '@/store/chatStore';
import { useAuthStore } from '@/store/authStore';
import { useIsMobile } from '@/hooks/useMediaQuery';
import { PollComponent } from '@/components/chat/PollComponent';
import { ReactionMenu } from '@/components/chat/ReactionMenu';
import { MessageReactions } from '@/components/chat/MessageReactions';
import { pseudonymService } from '@/lib/pseudonymService';
import { cn } from '@/lib/utils';
import { Reaction } from '@/store/chat/reactions';

// Swipe gesture constants
const TRIGGER_THRESHOLD = 0.3; // 30% of max distance to trigger
const VERTICAL_CANCEL_THRESHOLD = 20; // 20dp vertical movement cancels gesture
const MAX_TRANSLATION = 60; // 60dp maximum shift

interface MessageBubbleProps {
  message: Message;
  isThreadOriginal?: boolean;
  isThreadReply?: boolean;
  showInlineReplies?: boolean;
}

const CATEGORY_COLORS = {
  funny: 'badge-funny-ultra',
  serious: 'bg-red-500/20 text-red-500 border-red-500/30',
  advice: 'bg-blue-500/20 text-blue-500 border-blue-500/30',
  support: 'bg-purple-500/20 text-purple-500 border-purple-500/30',
};

const DeliveryStatusIcon = ({ status }: { status?: string }) => {
  switch (status) {
    case 'sending':
      return <Clock className="w-3 h-3 text-muted-foreground animate-pulse" />;
    case 'sent':
      return <Check className="w-3 h-3 text-muted-foreground" />;
    case 'delivered':
      return <Check className="w-3 h-3 text-green-500" />;
    case 'failed':
      return <AlertCircle className="w-3 h-3 text-red-500" />;
    default:
      return null;
  }
};

export function MessageBubble({ 
  message, 
  isThreadOriginal = false,
  isThreadReply = false,
  showInlineReplies = true 
}: MessageBubbleProps) {
  const [showReactionMenu, setShowReactionMenu] = useState(false);
  const [isSwipeActive, setIsSwipeActive] = useState(false);
  const [isSwipeCancelled, setIsSwipeCancelled] = useState(false);
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
    setActiveSwipeMessage
  } = useChatStore();
  const isGhost = message.is_ghost;
  const isConfession = message.message_type === 'confession';
  const isPoll = message.message_type === 'poll';
  const isImage = message.message_type === 'image';
  const hasReplies = message.reply_count && message.reply_count > 0;
  const hasMoreReplies = message.reply_count && message.reply_count > 3;
  const isOwnMessage = user?.id === message.user_id;
  
  // Get reactions for this message
  const reactions = messageReactions[message.id] || [];
  
  // Convert chatStore reactions to the format expected by MessageReactions component
  const formattedReactions: Reaction[] = reactions.map(r => ({
    ...r,
    created_at: new Date().toISOString() // Add required created_at field
  }));

  // Fetch pseudonym for ghost messages
  useEffect(() => {
    if (isGhost && activeGroup?.id && message.user_id) {
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
  }, [isGhost, activeGroup?.id, message.user_id]);

  // Motion values for swipe gesture
  const x = useMotionValue(0);
  const iconOpacity = useTransform(x, [0, MAX_TRANSLATION], [0, 1]);
  const iconX = useTransform(x, [0, MAX_TRANSLATION], [MAX_TRANSLATION, 0]);
  const springX = useSpring(x, { stiffness: 500, damping: 50 }); // Increased stiffness and damping

  // Handle instant switching between messages
  useEffect(() => {
    // If another message is being swiped or swipe interaction ended
    if (activeSwipeMessageId !== message.id && x.get() !== 0) {
      // Smoothly reset this message's position
      x.set(0);
    }
  }, [activeSwipeMessageId, message.id, x]);

  // Handle pan gesture
  const handlePan = (_: any, info: PanInfo) => {
    if (!isMobile || isSwipeCancelled || isThreadOriginal || isThreadReply) return;

    const { offset } = info;
    
    // Check for vertical movement cancellation
    if (Math.abs(offset.y) > VERTICAL_CANCEL_THRESHOLD) {
      setIsSwipeCancelled(true);
      x.set(0);
      return;
    }

    // Only allow left-to-right swipe (positive x values)
    if (offset.x < 0) {
      x.set(0);
      return;
    }

    // Limit the swipe distance
    const clampedX = Math.min(offset.x, MAX_TRANSLATION);
    x.set(clampedX);
  };

  // Handle pan end
  const handlePanEnd = async (event: any, info: PanInfo) => {
    if (!isMobile || isSwipeCancelled || isThreadOriginal || isThreadReply) {
      setIsSwipeActive(false);
      setIsSwipeCancelled(false);
      // Clear active swipe state when interaction ends
      setActiveSwipeMessage(null);
      return;
    }

    const { offset } = info;
    const swipeDistance = Math.abs(offset.x);
    const triggerDistance = MAX_TRANSLATION * TRIGGER_THRESHOLD;

    // Check if swipe should trigger reply action
    if (swipeDistance >= triggerDistance && offset.x > 0) {
      try {
        // Trigger haptic feedback
        await Haptics.impact({ style: ImpactStyle.Light });
      } catch (error) {
        // Haptics might not be available in web environment
        console.log('Haptics not available:', error);
      }
      
      // Trigger reply action
      handleReply(event);
    }

    // Ensure complete reset to original position
    x.stop(); // Stop any ongoing animations
    x.set(0); // Hard reset to zero
    
    setIsSwipeActive(false);
    setIsSwipeCancelled(false);
    
    // Clear active swipe state after animation completes
    setTimeout(() => {
      setActiveSwipeMessage(null);
    }, 100);
  };

  // Handle touch events to prevent default system gestures
  const handleTouchStart = (e: React.TouchEvent) => {
    if (!isMobile) return;
    
    // Register this message as the active swipe message
    setActiveSwipeMessage(message.id);
    setIsSwipeActive(true);
    setIsSwipeCancelled(false);
    
    // Prevent default to disable system swipe gestures
    e.stopPropagation();
  };

  const handleTouchMove = (e: React.TouchEvent) => {
    if (!isMobile || !isSwipeActive) return;
    
    // Prevent default scrolling during swipe
    e.stopPropagation();
  };

  const handleTouchEnd = (e: React.TouchEvent) => {
    if (!isMobile) return;
    
    e.stopPropagation();
  };
  const handleReply = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
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
  const handleReaction = (emoji: string) => {
    addOrRemoveReaction(message.id, emoji);
    setShowReactionMenu(false);
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

          {/* Message Actions for Polls */}
          {!isThreadOriginal && !isThreadReply && (
            <div className="flex items-center space-x-1 opacity-0 group-hover:opacity-100 transition-opacity">
              <Popover open={showReactionMenu} onOpenChange={setShowReactionMenu}>
                <PopoverTrigger asChild>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-6 px-2 text-xs"
                  >
                    <Smile className="w-3 h-3 mr-1" />
                    React
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-auto p-0 border-0 shadow-lg" align="start">
                  <ReactionMenu onSelectEmoji={handleReaction} />
                </PopoverContent>
              </Popover>
              <Button 
                variant="ghost" 
                size="sm" 
                className="h-6 px-2 text-xs"
                onClick={handleReply}
              >
                <Reply className="w-3 h-3 mr-1" />
                Reply
              </Button>
              {hasReplies && (
                <Button 
                  variant="ghost" 
                  size="sm" 
                  className="h-6 px-2 text-xs text-green-500 hover:text-green-400"
                  onClick={handleViewThread}
                >
                  <MessageCircle className="w-3 h-3 mr-1" />
                  View Thread
                </Button>
              )}
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="ghost" size="sm" className="h-6 w-6 p-0">
                    <MoreHorizontal className="w-3 h-3" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem>Copy Message</DropdownMenuItem>
                  <DropdownMenuItem className="text-destructive">
                    Report
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          )}

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

  // Regular message rendering with ultra-faded design
  return (
    <div className={cn(
      "group relative mb-4",
      {
        "bg-card/50 border-l-4 border-l-green-500 pl-4 rounded-lg p-3": isThreadOriginal,
        "ml-8 pl-4 thread-reply-line": isThreadReply,
        "bg-green-500/5 rounded-lg p-2": activeThread?.id === message.id && !isThreadOriginal,
        "opacity-75": message.delivery_status === 'sending',
        "border border-red-500/20 bg-red-500/5": message.delivery_status === 'failed'
      }
    )}>
      {/* Reply Icon - Only show on mobile and when not in thread */}
      {isMobile && !isThreadOriginal && !isThreadReply && (
        <motion.div
          className="absolute right-0 top-1/2 -translate-y-1/2 translate-x-12 z-10"
          style={{ opacity: iconOpacity, x: iconX }}
        >
          <div className="flex items-center justify-center w-11 h-11 bg-primary/20 rounded-full backdrop-blur-sm">
            <Reply className="w-5 h-5 text-primary" />
          </div>
        </motion.div>
      )}

      {/* Main message content with swipe gesture */}
      <motion.div
        style={{ x: springX }}
        drag={isMobile && !isThreadOriginal && !isThreadReply ? "x" : false}
        dragConstraints={{ left: 0, right: MAX_TRANSLATION }}
        dragElastic={0.2}
        onPan={handlePan}
        onPanEnd={handlePanEnd}
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
        className="relative w-full"
      >
        {/* Message Container */}
        <div className="flex items-start space-x-3 max-w-full">
          {/* Avatar */}
          <div className="flex-shrink-0 pt-1">
            {isGhost ? (
              <div className={cn(
                "flex items-center justify-center rounded-full avatar-ghost",
                isThreadReply ? "w-6 h-6" : "w-8 h-8"
              )}>
                <Ghost className={cn("text-white", isThreadReply ? "w-3 h-3" : "w-4 h-4")} />
              </div>
            ) : isConfession ? (
              <div className={cn(
                "flex items-center justify-center rounded-full avatar-confession",
                isThreadReply ? "w-6 h-6" : "w-8 h-8"
              )}>
                <span className={cn(
                  "text-white font-bold",
                  isThreadReply ? "text-xs" : "text-sm"
                )}>
                  {message.author?.display_name?.charAt(0) || 'A'}
                </span>
              </div>
            ) : (
              <Avatar className={cn(
                "avatar-emma",
                isThreadReply ? "w-6 h-6" : "w-8 h-8"
              )}>
                <AvatarImage src={message.author?.avatar_url || undefined} />
                <AvatarFallback className={cn(
                  "bg-primary/10 text-primary font-semibold",
                  isThreadReply ? "text-xs" : "text-sm"
                )}>
                  {message.author?.display_name?.charAt(0) || 'U'}
                </AvatarFallback>
              </Avatar>
            )}
          </div>

          {/* Message Content */}
          <div className="flex-1 min-w-0">
            {/* Header with name and badges outside bubble */}
            <div className="flex items-center space-x-2 mb-2">
              <span className={cn(
                "font-bold text-foreground",
                isThreadReply ? "text-xs" : "text-sm"
              )}>
                {isGhost ? ghostPseudonym : isConfession ? 'Anonymous' : message.author?.display_name || 'Anonymous'}
              </span>
              
              {/* Badges */}
              {isConfession && !isThreadReply && (
                <span className="badge-anony-ultra">
                  Anony
                </span>
              )}
              {message.category && !isThreadReply && (
                <span className={cn(
                  "text-xs",
                  message.category === 'funny' ? 'badge-funny-ultra' : CATEGORY_COLORS[message.category as keyof typeof CATEGORY_COLORS] || 'bg-muted'
                )}>
                  {message.category}
                </span>
              )}
              {isImage && !isThreadReply && (
                <Badge variant="secondary" className="text-xs bg-blue-500/20 text-blue-500 border-blue-500/30">
                  <ImageIcon className="w-3 h-3 mr-1" />
                  Image
                </Badge>
              )}
            </div>

            {/* Message Bubble with ultra-faded styling */}
            <div className={cn(
              "rounded-2xl px-4 py-3 transition-all duration-200 max-w-[85%] w-fit relative",
              "chat-bubble-base",
              {
                // Apply ultra-faded classes based on message type
                "chat-bubble-ghost-ultra": isGhost,
                "chat-bubble-emma-ultra": !isGhost && !isConfession && !isImage && isOwnMessage,
                "chat-bubble-anonymous-ultra": !isGhost && !isConfession && !isImage && !isOwnMessage,
                "chat-bubble-confession-ultra": isConfession,
                "chat-bubble-ultra-fade": isImage,
                "chat-bubble-thread-reply": isThreadReply,
              }
            )}>
              <div className="chat-bubble-content">
                {/* Message Content */}
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
                      <div className={cn(
                        "whitespace-pre-wrap break-words text-foreground/90",
                        isThreadReply ? "text-sm" : "text-sm"
                      )}>
                        {message.content}
                      </div>
                    )}
                  </div>
                ) : (
                  <div className={cn(
                    "whitespace-pre-wrap break-words text-foreground/90",
                    isThreadReply ? "text-sm" : "text-sm"
                  )}>
                    {message.content}
                  </div>
                )}
              </div>
            </div>

            {/* Timestamp and delivery status */}
            <div className="flex items-center space-x-2 mt-1">
              <span className="timestamp">
                {formatDistanceToNow(new Date(message.created_at), { addSuffix: true })}
              </span>
              
              {/* Delivery Status */}
              {message.delivery_status && (
                <div className="flex items-center space-x-1">
                  <DeliveryStatusIcon status={message.delivery_status} />
                  {message.delivery_status === 'failed' && (
                    <span className="text-xs text-red-500">Failed</span>
                  )}
                </div>
              )}
            </div>

            {/* Reactions */}
            {reactions.length > 0 && !isThreadReply && (
              <div className="mt-2">
                <MessageReactions 
                  reactions={formattedReactions} 
                  onToggleReaction={handleToggleReaction}
                />
              </div>
            )}

            {/* Message Actions */}
            {!isThreadOriginal && !isThreadReply && (
              <div className="flex items-center space-x-1 mt-2 opacity-0 group-hover:opacity-100 transition-opacity">
                <Popover open={showReactionMenu} onOpenChange={setShowReactionMenu}>
                  <PopoverTrigger asChild>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-6 px-2 text-xs hover:bg-background/80"
                    >
                      <Smile className="w-3 h-3 mr-1" />
                      React
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent className="w-auto p-0 border-0 shadow-lg" align="start">
                    <ReactionMenu onSelectEmoji={handleReaction} />
                  </PopoverContent>
                </Popover>
                <Button 
                  variant="ghost" 
                  size="sm" 
                  className="h-6 px-2 text-xs hover:bg-background/80"
                  onClick={handleReply}
                >
                  <Reply className="w-3 h-3 mr-1" />
                  Reply
                </Button>
                {hasReplies && (
                  <Button 
                    variant="ghost" 
                    size="sm" 
                    className="h-6 px-2 text-xs text-green-500 hover:text-green-400 hover:bg-green-500/10"
                    onClick={handleViewThread}
                  >
                    <MessageCircle className="w-3 h-3 mr-1" />
                    View Thread
                  </Button>
                )}
                {message.delivery_status === 'failed' && (
                  <Button 
                    variant="ghost" 
                    size="sm" 
                    className="h-6 px-2 text-xs text-red-500 hover:text-red-400 hover:bg-red-500/10"
                    onClick={() => {
                      // TODO: Implement retry functionality
                      console.log('Retry sending message:', message.id);
                    }}
                  >
                    <AlertCircle className="w-3 h-3 mr-1" />
                    Retry
                  </Button>
                )}
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button variant="ghost" size="sm" className="h-6 w-6 p-0 hover:bg-background/80">
                      <MoreHorizontal className="w-3 h-3" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    <DropdownMenuItem>Copy Message</DropdownMenuItem>
                    <DropdownMenuItem className="text-destructive">
                      Report
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
            )}

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
        </div>
      </motion.div>
    </div>
  );
}