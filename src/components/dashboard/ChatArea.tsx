import { useEffect, useMemo, useRef } from 'react';
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Hash, Users, MoreHorizontal, Wifi, WifiOff, RefreshCw, ArrowLeft } from 'lucide-react';
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

export function ChatArea() {
  const navigate = useNavigate();
  const isMobile = useIsMobile();
  const [showEmojiPanel, setShowEmojiPanel] = useState(false);
  const [isSyncing, setIsSyncing] = useState(false);
  const { user } = useAuthStore();
  const {
    activeGroup,
    fetchMessages,
    messages,
    activeThread,
    connectionStatus,
    cleanupRealtimeSubscription,
    showGroupDetailsPanel,
    setShowGroupDetailsPanel,
    groupMembers
  } = useChatStore();

  // Check if current user is a member of the active group
  const isMember = useMemo(() => {
    if (!activeGroup?.id || !user?.id || !groupMembers || groupMembers.length === 0) {
      return true; // Default to true if we don't have member data yet
    }
    return groupMembers.some(member => member.user_id === user.id);
  }, [activeGroup?.id, user?.id, groupMembers]);

  // The emoji selection is handled by the WhatsAppEmojiPanel component
  const handleEmojiSelect = () => {};

  useEffect(() => {
    if (activeGroup?.id) {
      console.log(`💬 ChatArea: Opening chat for group ${activeGroup.id} (${activeGroup.name})`);
      const startTime = performance.now();
      
      fetchMessages(activeGroup.id).then(() => {
        const endTime = performance.now();
        console.log(`💬 ChatArea: Messages loaded in ${(endTime - startTime).toFixed(2)}ms`);
      });
    }
  }, [activeGroup?.id, fetchMessages]);

  // Track which (groupId, lastMessageId) we've already marked to avoid duplicates
  const markedAsReadRef = useRef<Set<string>>(new Set());

  // CLEAN IMPLEMENTATION: Mark as read when messages load
  // Only mark when:
  // 1. We have messages
  // 2. Last message has a real ID (not temp)
  // 3. We haven't already marked this (groupId, lastMessageId) pair
  // 4. Wait 2 seconds to allow user to see unread separator first
  useEffect(() => {
    console.log('[ChatArea] Mark as read effect triggered:', {
      hasActiveGroup: !!activeGroup?.id,
      groupId: activeGroup?.id,
      messagesCount: messages.length,
    });

    if (!activeGroup?.id || messages.length === 0) {
      const reason = !activeGroup?.id ? 'no active group' : 'no messages';
      console.log(`[ChatArea] Skipping mark as read: ${reason}`);
      return;
    }

    const lastMessage = messages[messages.length - 1];
    
    // Check if last message has a real ID (not a temp ID like "temp-...")
    if (!lastMessage.id || lastMessage.id.startsWith('temp-') || lastMessage.id.startsWith('1762')) {
      console.log('[ChatArea] Skipping mark as read: last message has temp ID:', lastMessage.id);
      return;
    }

    // Check if we've already marked this combination
    const markKey = `${activeGroup.id}:${lastMessage.id}`;
    if (markedAsReadRef.current.has(markKey)) {
      console.log('[ChatArea] Skipping mark as read: already marked', markKey);
      return;
    }

    // Wait 2 seconds before marking as read to allow user to see unread separator
    const timer = setTimeout(() => {
      console.log('[unread] 📝 Marking group as read:', activeGroup.id, 'lastMessageId:', lastMessage.id);
      
      // Add to marked set immediately to prevent duplicate calls
      markedAsReadRef.current.add(markKey);
      
      unreadTracker.markGroupAsRead(activeGroup.id, lastMessage.id).then(success => {
        if (success) {
          console.log('[unread] ✅ Marked as read successfully, updating UI');
          console.log('[unread] 💾 Persisted read status to Supabase for group', activeGroup.id);
          
          // Update Sidebar count to 0
          if (typeof (window as any).__updateUnreadCount === 'function') {
            (window as any).__updateUnreadCount(activeGroup.id, 0);
            console.log('[unread] ✅ UI updated, badge set to 0');
          } else {
            console.warn('[unread] ⚠️ __updateUnreadCount not available');
          }
        } else {
          console.error('[unread] ❌ Failed to mark as read');
          // Remove from marked set so we can retry
          markedAsReadRef.current.delete(markKey);
        }
      }).catch(error => {
        console.error('[unread] ❌ Exception marking as read:', error);
        // Remove from marked set so we can retry
        markedAsReadRef.current.delete(markKey);
      });
    }, 2000); // 2 second delay

    return () => clearTimeout(timer);
  }, [activeGroup?.id, messages, messages.length]);

  // Clear marked set when changing groups
  useEffect(() => {
    markedAsReadRef.current.clear();
  }, [activeGroup?.id]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      cleanupRealtimeSubscription();
    };
  }, [cleanupRealtimeSubscription]);

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
    if (isMobile && activeGroup) {
      navigate(`/groups/${activeGroup.id}/details`);
    } else {
      setShowGroupDetailsPanel(true);
    }
  };

  const handleBackClick = () => {
    if (isMobile) {
      // Clear active group first
      useChatStore.getState().setActiveGroup(null);
      // Use window.history to ensure immediate navigation
      window.history.replaceState(null, '', '/dashboard');
      navigate('/dashboard', { replace: true });
    }
  };

  return (
    <div className="h-full flex">
      {/* Main Chat Area */}
      <div className={`flex flex-col transition-all duration-300 ${
        !isMobile && (activeThread || showGroupDetailsPanel) ? 'flex-1' : 'w-full'
      }`}>
        {/* Header - Fixed at top */}
        <div className="flex-shrink-0 flex items-center justify-between p-2 sm:p-3 md:p-5 border-b border-border/50 bg-card/30 backdrop-blur-sm z-10 shadow-lg">
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
              className="flex items-center space-x-2 sm:space-x-4 cursor-pointer hover:bg-muted/50 rounded-lg p-1 sm:p-2 transition-colors"
              onClick={handleGroupHeaderClick}
            >
              <div className="flex items-center justify-center w-6 h-6 sm:w-8 sm:h-8 bg-gradient-to-br from-green-500 to-green-600/80 rounded-lg shadow-md">
                <Hash className="w-3 h-3 sm:w-4 sm:h-4 text-white" />
              </div>
              <div>
                <h1 className="text-base sm:text-lg md:text-xl font-bold hover:text-primary transition-colors truncate">
                  {activeGroup.name}
                </h1>
                {activeGroup.description && (
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