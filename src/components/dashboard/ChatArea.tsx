import { useEffect, useMemo } from 'react';
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
    activeThread,
    connectionStatus,
    cleanupRealtimeSubscription,
    showGroupDetailsPanel,
    setShowGroupDetailsPanel,
    groupMembers,
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

  // LOCAL-FIRST: Mark as read INSTANTLY when opening chat
  useEffect(() => {
    if (activeGroup?.id) {
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
      
      // CRITICAL: Mark ALL messages as read INSTANTLY (no waiting)
      // This happens immediately when opening chat
      setTimeout(async () => {
        const currentMessages = useChatStore.getState().messages;
        if (currentMessages.length > 0) {
          const lastMessage = currentMessages[currentMessages.length - 1];
          
          if (lastMessage.id && !lastMessage.id.startsWith('temp-')) {
            console.log('[unread] ⚡ INSTANT: Marking all messages as read (local-first)');
            // Mark as read locally FIRST, sync to Supabase later
            // Pass the message timestamp so we mark at the correct time
            const messageTimestamp = new Date(lastMessage.created_at).getTime();
            await unreadTracker.markGroupAsRead(activeGroup.id, lastMessage.id, messageTimestamp);
            console.log('[unread] ✅ All messages marked as read locally');
          }
        }
      }, 100); // Small delay to ensure messages are loaded
    }
  }, [activeGroup?.id, fetchMessages]);

  // WHATSAPP STYLE: Mark as read periodically while viewing AND when closing
  useEffect(() => {
    if (!activeGroup?.id) return;

    // Mark as read after 1 second of viewing (WhatsApp style)
    const markAsReadTimer = setTimeout(() => {
      const currentMessages = useChatStore.getState().messages;
      if (currentMessages.length > 0) {
        const lastMessage = currentMessages[currentMessages.length - 1];
        
        if (lastMessage.id && !lastMessage.id.startsWith('temp-')) {
          console.log('[unread] 📝 WhatsApp-style: Auto-marking as read after 1s viewing');
          // Pass the message timestamp so we mark at the correct time
          const messageTimestamp = new Date(lastMessage.created_at).getTime();
          unreadTracker.markGroupAsRead(activeGroup.id, lastMessage.id, messageTimestamp)
            .catch(err => console.error('[unread] ❌ Auto mark as read failed:', err));
        }
      }
    }, 1000); // 1 second

    // Cleanup: Mark as read when closing chat
    return () => {
      clearTimeout(markAsReadTimer);
      
      // On unmount (closing chat), mark as read
      const currentMessages = useChatStore.getState().messages;
      if (currentMessages.length > 0) {
        const lastMessage = currentMessages[currentMessages.length - 1];
        
        if (lastMessage.id && !lastMessage.id.startsWith('temp-')) {
          console.log('[unread] 📝 WhatsApp-style: Marking as read on CLOSE');
          // Mark as read when closing - this sets the baseline for next open
          // Pass the message timestamp so we mark at the correct time
          const messageTimestamp = new Date(lastMessage.created_at).getTime();
          unreadTracker.markGroupAsRead(activeGroup.id, lastMessage.id, messageTimestamp)
            .catch(err => console.error('[unread] ❌ Mark as read on close failed:', err));
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