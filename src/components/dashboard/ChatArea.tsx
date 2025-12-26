import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Hash, Users, MoreHorizontal, Wifi, WifiOff, RefreshCw, ArrowLeft } from 'lucide-react';
import { Capacitor } from '@capacitor/core';
import { Button } from '@/components/ui/button';
import { Separator } from '@/components/ui/separator';
import { Badge } from '@/components/ui/badge';
import { toast } from 'sonner';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { useChatStore } from '@/store/chatStore';
import { useAuthStore } from '@/store/authStore';
import { useIsMobile } from '@/hooks/useMediaQuery';
import { MessageList } from '@/components/chat/MessageList';
import { ChatInput } from '@/components/chat/ChatInput';
import { ThreadPanel } from '@/components/chat/ThreadPanel';
import { GroupDetailsPanel } from '@/components/dashboard/GroupDetailsPanel';
import { WhatsAppEmojiPanel } from '@/components/chat/WhatsAppEmojiPanel';
import { NonMemberBanner } from '@/components/chat/NonMemberBanner';
import { unreadTracker } from '@/lib/unreadTracker';
import { supabasePipeline } from '@/lib/supabasePipeline';
import { cn } from '@/lib/utils';

interface ChatAreaProps {
  topicId?: string;
}

interface TopicData {
  id: string;
  title: string | null;
  type: string;
  is_anonymous: boolean;
  created_at: string;
  originalMessage?: {
    content: string;
    user_id: string;
    users?: {
      display_name: string;
      avatar_url: string | null;
    };
  };
}

export function ChatArea({ topicId }: ChatAreaProps) {
  const navigate = useNavigate();
  const isMobile = useIsMobile();
  const [showEmojiPanel, setShowEmojiPanel] = useState(false);
  const [topicData, setTopicData] = useState<TopicData | null>(null);
  const [isSyncing, setIsSyncing] = useState(false);
  const { user } = useAuthStore();
  const {
    activeGroup,
    fetchMessages,
    activeThread,
    connectionStatus,
    cleanupRealtimeSubscription,
    showGroupDetailsPanel,
    setShowGroupDetailsPanel,
    groupMembers,
  } = useChatStore();

  // ✅ FIX: Use refs to track state and avoid stale closures
  const messagesRef = useRef<any[]>([]);
  const lastProcessedMessageIdRef = useRef<string | null>(null);

  // Check if current user is a member of the active group
  const isMember = useMemo(() => {
    if (!activeGroup?.id || !user?.id || !groupMembers || groupMembers.length === 0) {
      return true; // Default to true if we don't have member data yet
    }
    return groupMembers.some(member => member.user_id === user.id);
  }, [activeGroup?.id, user?.id, groupMembers]);

  // Fetch topic data when topicId is provided
  // Uses direct REST to bypass Supabase client internal state issues after iOS idle
  useEffect(() => {
    if (!topicId) {
      setTopicData(null);
      return;
    }

    const fetchTopic = async () => {
      try {
        const { data, error } = await supabasePipeline.queryDirect<any[]>('topics', {
          select: '*,messages!messages_topic_id_fkey(content,user_id,users!messages_user_id_fkey(display_name,avatar_url))',
          filters: { id: topicId }
        });

        if (error) {
          console.error('[ChatArea] Error fetching topic:', error);
          return;
        }

        // queryDirect returns array, get first item
        const topicRow = Array.isArray(data) ? data[0] : data;
        if (!topicRow) {
          console.error('[ChatArea] Topic not found:', topicId);
          return;
        }

        const firstMessage = topicRow.messages?.[0];
        setTopicData({
          id: topicRow.id,
          title: topicRow.title,
          type: topicRow.type,
          is_anonymous: topicRow.is_anonymous,
          created_at: topicRow.created_at,
          originalMessage: firstMessage ? {
            content: firstMessage.content,
            user_id: firstMessage.user_id,
            users: firstMessage.users
          } : undefined
        });
      } catch (error) {
        console.error('[ChatArea] Error fetching topic:', error);
      }
    };

    fetchTopic();
  }, [topicId]);

  // ✅ FIX: Keep messagesRef updated with latest messages to avoid stale closure
  useEffect(() => {
    // Subscribe to messages changes and keep ref updated
    const unsubscribe = useChatStore.subscribe((state) => {
      messagesRef.current = state.messages;
    });
    
    // Initialize with current messages
    messagesRef.current = useChatStore.getState().messages;
    
    return unsubscribe;
  }, []);

  // The emoji selection is handled by the WhatsAppEmojiPanel component
  const handleEmojiSelect = () => {};

  // Fetch topic messages when topicId is provided
  useEffect(() => {
    if (!topicId || !activeGroup?.id) {
      return;
    }

    const fetchTopicMessages = async () => {
      try {
        const { data, error } = await supabasePipeline.fetchTopicMessages(topicId, 100);
        if (error) {
          console.error('[ChatArea] Error fetching topic messages:', error);
          return;
        }
        // Filter out the original topic message (where message.id === topicId)
        // since it's already displayed in the pinned header
        const replies = (data || []).filter((msg: any) => msg.id !== topicId);
        // Sort by created_at ascending (oldest first) and set in store
        const sorted = replies.sort((a: any, b: any) => 
          new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
        );
        // Set messages in store so MessageList can display them
        useChatStore.setState({ messages: sorted });
      } catch (error) {
        console.error('[ChatArea] Error fetching topic messages:', error);
      }
    };

    fetchTopicMessages();
  }, [topicId, activeGroup?.id]);

  // LOCAL-FIRST: Load messages when opening chat (only for non-topic view)
  useEffect(() => {
    if (activeGroup?.id && !topicId) {
      console.log(`💬 ChatArea: Opening chat for group ${activeGroup.id} (${activeGroup.name})`);
      const startTime = performance.now();
      
      // INSTANT: Update sidebar unread count to 0 immediately (WhatsApp style)
      // This clears the badge in the sidebar instantly
      if (typeof (window as any).__updateUnreadCount === 'function') {
        (window as any).__updateUnreadCount(activeGroup.id, 0);
        console.log('[unread] 📊 Cleared unread count in sidebar instantly');
      }
      
      // Load messages - separator will be calculated from LOCAL last_read_at
      fetchMessages(activeGroup.id).then(() => {
        const endTime = performance.now();
        console.log(`💬 ChatArea: Messages loaded in ${(endTime - startTime).toFixed(2)}ms`);
      });
      
      // ✅ FIX: Removed the setTimeout that was marking cache messages as read
      // The realtime effect below will handle marking NEW messages as read
      // We don't need to mark cache messages on open - they're already in the correct state
    }
  }, [activeGroup?.id, topicId, fetchMessages]);

  // REALTIME: Mark new messages as read instantly when they arrive while viewing
  useEffect(() => {
    if (!activeGroup?.id) return;

    // Reset the ref when switching groups
    lastProcessedMessageIdRef.current = null;

    // Helper to get the last real (non-temp) message ID
    const getLastRealMessageId = (messages: any[]) => {
      const lastReal = [...messages].reverse().find(msg => 
        msg.id && !msg.id.startsWith('temp-')
      );
      return lastReal?.id || null;
    };

    // Get initial state
    const initialMessages = useChatStore.getState().messages;
    let lastMessageCount = initialMessages.length;
    const initialLastMessageId = getLastRealMessageId(initialMessages);

    console.log('[unread] 🎬 REALTIME: Starting subscription, initial last message:', initialLastMessageId?.slice(0, 8) || 'none');

    // Subscribe to store changes to detect new messages
    const unsubscribe = useChatStore.subscribe((state) => {
      // Only process if we're still on the same group
      if (state.activeGroup?.id !== activeGroup.id) return;

      const currentMessages = state.messages;
      const currentCount = currentMessages.length;
      const currentLastMessageId = getLastRealMessageId(currentMessages);

      if (!currentLastMessageId) return;

      const previousLastMessageId = lastProcessedMessageIdRef.current;

      // ✅ FIX: Only mark as read if we had a previous message ID
      // This prevents marking cache's old message on initial load
      if (currentLastMessageId !== previousLastMessageId) {
        if (previousLastMessageId) {
          // We had a previous message, so this is a NEW message arriving
          console.log('[unread] 📨 REALTIME: New message detected!');
          console.log(`[unread] 📨 Previous: ${previousLastMessageId.slice(0, 8)}, Current: ${currentLastMessageId.slice(0, 8)}`);
          
          // Find the actual new message
          const latestRealMessage = currentMessages.find(msg => msg.id === currentLastMessageId);
          
          if (latestRealMessage) {
            console.log('[unread] ⚡ REALTIME: Marking as read instantly');
            // Mark as read immediately
            const messageTimestamp = new Date(latestRealMessage.created_at).getTime();
            unreadTracker.markGroupAsRead(activeGroup.id, latestRealMessage.id, messageTimestamp)
              .then(() => {
                console.log('[unread] ✅ REALTIME: Marked as read successfully');
              })
              .catch(err => console.error('[unread] ❌ Realtime mark as read failed:', err));
          }
        } else {
          // First load from cache - don't mark as read, just set the reference
          console.log('[unread] 🎬 REALTIME: Initial load from cache, NOT marking as read');
          console.log(`[unread] 🎬 Cache last message: ${currentLastMessageId.slice(0, 8)}`);
        }
        
        // Update ref to current message ID
        lastProcessedMessageIdRef.current = currentLastMessageId;
      }

      // CRITICAL FIX: Mark ALL visible messages as viewed (including temp messages)
      // This ensures we track which temp messages the user saw before they got real IDs
      if (currentCount > lastMessageCount) {
        const newMessages = currentMessages.slice(lastMessageCount);
        const messageIdsToMarkViewed = newMessages.map(msg => msg.id);
        
        if (messageIdsToMarkViewed.length > 0) {
          console.log(`[viewed] 👁️ Marking ${messageIdsToMarkViewed.length} new messages as viewed (including temp IDs)`);
          
          // Mark as viewed in SQLite (non-blocking)
          (async () => {
            try {
              const { Capacitor } = await import('@capacitor/core');
              if (Capacitor.isNativePlatform()) {
                const { sqliteService } = await import('@/lib/sqliteService');
                const isReady = await sqliteService.isReady();
                if (isReady) {
                  await sqliteService.markMessagesAsViewed(messageIdsToMarkViewed);
                  console.log(`[viewed] ✅ Marked ${messageIdsToMarkViewed.length} messages as viewed in SQLite`);
                  
                  // ✅ FIX: Also update read status to Supabase
                  // Find the last message that was marked as viewed
                  const lastViewedMessage = currentMessages.find((m: any) => m.id === messageIdsToMarkViewed[messageIdsToMarkViewed.length - 1]);
                  if (lastViewedMessage && activeGroup?.id) {
                    const messageTimestamp = new Date(lastViewedMessage.created_at).getTime();
                    console.log(`[viewed] 🔄 Updating read status to: ${lastViewedMessage.id.slice(0, 8)}`);
                    
                    // Import and call unreadTracker to sync to Supabase
                    const { unreadTracker } = await import('@/lib/unreadTracker');
                    await unreadTracker.markGroupAsRead(activeGroup.id, lastViewedMessage.id, messageTimestamp);
                  }
                }
              }
            } catch (error) {
              console.error('[viewed] ❌ Failed to mark messages as viewed:', error);
            }
          })();
        }
      }

      lastMessageCount = currentCount;
    });

    return () => {
      console.log('[unread] 🛑 REALTIME: Unsubscribing');
      unsubscribe();
    };
  }, [activeGroup?.id]);

  // WHATSAPP STYLE: Mark as read when closing chat
  useEffect(() => {
    if (!activeGroup?.id) return;

    // Cleanup: Mark as read when closing chat
    return () => {
      // ✅ FIX: Access the REF to get the LATEST messages at the moment of closing
      // This prevents stale closure from reverting the read status
      const currentMessages = messagesRef.current;
      if (currentMessages.length > 0) {
        // Find the last non-temp message (in case we just sent a message that's still optimistic)
        const lastRealMessage = [...currentMessages].reverse().find(msg => 
          msg.id && !msg.id.startsWith('temp-')
        );
        
        if (lastRealMessage) {
          console.log('[unread] 📝 WhatsApp-style: Marking as read on CLOSE (last real message from ref)');
          console.log(`[unread] 📝 Last message ID: ${lastRealMessage.id.slice(0, 8)}`);
          // Mark as read when closing - this sets the baseline for next open
          // Pass the message timestamp so we mark at the correct time
          const messageTimestamp = new Date(lastRealMessage.created_at).getTime();
          unreadTracker.markGroupAsRead(activeGroup.id, lastRealMessage.id, messageTimestamp)
            .catch(err => console.error('[unread] ❌ Mark as read on close failed:', err));
        } else {
          console.log('[unread] ⚠️ No real messages to mark as read on close (all optimistic)');
        }
      }
      
      cleanupRealtimeSubscription();
    };
  }, [activeGroup?.id, cleanupRealtimeSubscription]);

  const handleSyncMessages = async () => {
    if (!activeGroup?.id) return;
    
    setIsSyncing(true);
    try {
      // Use the new forceMessageSync function for a more comprehensive sync
      await useChatStore.getState().forceMessageSync(activeGroup.id);
      toast.success('Messages synced successfully');
    } catch (error) {
      console.error('Error syncing messages:', error);
      toast.error('Failed to sync messages');
    } finally {
      setIsSyncing(false);
    }
  };

  if (!activeGroup) return null;

  const getConnectionStatusColor = () => {
    switch (connectionStatus) {
      case 'connected':
        return 'text-green-500';
      case 'connecting':
      case 'reconnecting':
        return 'text-yellow-500';
      case 'disconnected':
        return 'text-red-500';
      default:
        return 'text-muted-foreground';
    }
  };

  const getConnectionStatusText = () => {
    switch (connectionStatus) {
      case 'connected':
        return 'Connected';
      case 'connecting':
        return 'Connecting...';
      case 'reconnecting':
        return 'Reconnecting...';
      case 'disconnected':
        return 'Disconnected';
      default:
        return 'Unknown';
    }
  };

  const handleGroupHeaderClick = () => {
    if (topicId) return; // Don't navigate to details from topic view
    if (isMobile && activeGroup) {
      navigate(`/groups/${activeGroup.id}/details`);
    } else {
      setShowGroupDetailsPanel(true);
    }
  };

  const handleBackClick = () => {
    if (isMobile) {
      if (topicId && activeGroup) {
        // Go back to topics page
        navigate(`/groups/${activeGroup.id}/topics`);
      } else {
        // Clear active group first
        useChatStore.getState().setActiveGroup(null);
        // Use window.history to ensure immediate navigation
        window.history.replaceState(null, '', '/dashboard');
        navigate('/dashboard', { replace: true });
      }
    }
  };

  return (
    <div className="h-full flex">
      {/* Main Chat Area */}
      <div className={`flex flex-col transition-all duration-300 ${
        !isMobile && (activeThread || showGroupDetailsPanel) ? 'flex-1' : 'w-full'
      }`}>
        {/* Header - Fixed at top */}
        <div 
          className="flex-shrink-0 flex items-center justify-between px-2 sm:px-3 md:px-5 py-2 sm:py-3 md:py-5 border-b border-border/50 bg-card/30 backdrop-blur-sm z-10 shadow-lg"
          style={{
            paddingTop: Capacitor.getPlatform() === 'ios' ? 'calc(env(safe-area-inset-top, 0px) + 8px)' : undefined
          }}
        >
          <div className="flex items-center">
            {/* Back button - only show on mobile */}
            {isMobile && (
              <Button
                variant="ghost"
                size="sm"
                onClick={handleBackClick}
                className="mr-2 h-8 w-8 p-0 flex-shrink-0"
              >
                <ArrowLeft className="w-4 h-4" />
              </Button>
            )}
            
            <div 
              className={cn(
                "flex items-center space-x-2 sm:space-x-4 rounded-lg p-1 sm:p-2 transition-colors",
                !topicId && "cursor-pointer hover:bg-muted/50"
              )}
              onClick={handleGroupHeaderClick}
            >
              <div className="flex items-center justify-center w-6 h-6 sm:w-8 sm:h-8 bg-gradient-to-br from-green-500 to-green-600/80 rounded-lg shadow-md">
                <Hash className="w-3 h-3 sm:w-4 sm:h-4 text-white" />
              </div>
              <div className="min-w-0 flex-1">
                <h1 className="text-base sm:text-lg md:text-xl font-bold hover:text-primary transition-colors truncate">
                  {topicId && topicData ? (topicData.title || 'Topic') : activeGroup.name}
                </h1>
                {topicId && topicData ? (
                  <span className={cn(
                    "inline-block px-2 py-0.5 rounded-full text-[10px] font-bold uppercase",
                    topicData.type === 'poll' ? 'bg-orange-200 text-orange-900' :
                    topicData.type === 'news' ? 'bg-purple-200 text-purple-900' :
                    'bg-lime-200 text-lime-900'
                  )}>
                    {topicData.type === 'text' ? 'discussion' : topicData.type}
                  </span>
                ) : activeGroup.description && (
                  <p className="text-xs sm:text-sm text-muted-foreground truncate">
                    {activeGroup.description}
                  </p>
                )}
              </div>
            </div>
          </div>
          
          <div className="flex items-center space-x-1 sm:space-x-3">
            {/* Sync Button */}
            <Button 
              variant="ghost" 
              size="sm" 
              className="rounded-full hover:bg-muted/50 w-7 h-7 sm:w-8 sm:h-8 p-0 sm:p-1"
              onClick={handleSyncMessages}
              disabled={isSyncing}
            >
              <RefreshCw className={`w-3 h-3 sm:w-4 sm:h-4 ${isSyncing ? 'animate-spin' : ''}`} />
            </Button>
            
            {/* Connection Status Indicator */}
            <div className="hidden sm:flex items-center space-x-1">
              {connectionStatus === 'connected' ? (
                <Wifi className={`w-3 h-3 sm:w-4 sm:h-4 ${getConnectionStatusColor()}`} />
              ) : (
                <WifiOff className={`w-3 h-3 sm:w-4 sm:h-4 ${getConnectionStatusColor()}`} />
              )}
              <Badge 
                variant="secondary" 
                className={`text-xs ${getConnectionStatusColor()} border-border/50`}
              >
                {getConnectionStatusText()}
              </Badge>
            </div>
            
            <Button 
              variant="ghost" 
              size="sm" 
              className="rounded-full hover:bg-muted/50 w-7 h-7 sm:w-8 sm:h-8 p-0 sm:p-1"
            >
              <Users className="w-3 h-3 sm:w-4 sm:h-4" />
            </Button>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button 
                  variant="ghost" 
                  size="sm" 
                  className="rounded-full hover:bg-muted/50 w-7 h-7 sm:w-8 sm:h-8 p-0 sm:p-1"
                >
                  <MoreHorizontal className="w-3 h-3 sm:w-4 sm:h-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onClick={handleGroupHeaderClick}>
                  Group Info
                </DropdownMenuItem>
                <DropdownMenuItem>
                  Copy Invite Code
                </DropdownMenuItem>
                <DropdownMenuItem onClick={handleSyncMessages}>
                  Sync Messages
                </DropdownMenuItem>
                <Separator />
                <DropdownMenuItem className="text-destructive">
                  Leave Group
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>

        {/* Topic Original Post - Pinned header when viewing a topic */}
        {topicId && topicData?.originalMessage && (
          <div className="flex-shrink-0 bg-gradient-to-b from-slate-50 to-white border-b border-slate-200 p-4">
            <div className="flex items-start gap-3">
              <div className="w-10 h-10 rounded-full bg-gradient-to-br from-purple-500 to-purple-600 flex-shrink-0" />
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-1">
                  <span className="font-semibold text-slate-900">
                    {topicData.is_anonymous ? 'Anonymous' : (topicData.originalMessage.users?.display_name || 'Unknown')}
                  </span>
                  <span className="text-xs text-slate-400">
                    {new Date(topicData.created_at).toLocaleDateString()}
                  </span>
                </div>
                {topicData.title && (
                  <h3 className="font-bold text-slate-900 mb-1">{topicData.title}</h3>
                )}
                <p className="text-slate-700 text-sm whitespace-pre-wrap">{topicData.originalMessage.content}</p>
              </div>
            </div>
          </div>
        )}

        {/* Messages - Scrollable area that fills remaining space */}
        <div className={`flex-1 overflow-hidden transition-all duration-300 chat-background-gradient ${
          isMobile && showEmojiPanel ? 'pb-[400px]' : ''
        }`}>
          <MessageList />
        </div>

        {/* Non-member banner or Input - Fixed at bottom */}
        <div className="flex-shrink-0">
          {!isMember ? (
            <div className="p-4 border-t bg-background">
              <NonMemberBanner reason="removed" />
            </div>
          ) : (
            <ChatInput
              showEmojiPanel={showEmojiPanel}
              setShowEmojiPanel={setShowEmojiPanel}
              topicId={topicId}
            />
          )}
        </div>
      </div>

      {/* Right Panel - Thread or Group Details */}
      {!isMobile && activeThread && <ThreadPanel />}
      {!isMobile && showGroupDetailsPanel && <GroupDetailsPanel />}
      
      {/* WhatsApp-style Emoji Panel for Mobile */}
      {isMobile && (
        <WhatsAppEmojiPanel
          isOpen={showEmojiPanel}
          onClose={() => setShowEmojiPanel(false)}
          onEmojiSelect={handleEmojiSelect}
        />
      )}
    </div>
  );
}