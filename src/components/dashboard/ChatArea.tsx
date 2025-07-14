import { useEffect } from 'react';
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Hash, Users, MoreHorizontal, Wifi, WifiOff } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Separator } from '@/components/ui/separator';
import { Badge } from '@/components/ui/badge';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { useChatStore } from '@/store/chatStore';
import { useIsMobile } from '@/hooks/useMediaQuery';
import { MessageList } from '@/components/chat/MessageList';
import { ChatInput } from '@/components/chat/ChatInput';
import { ThreadPanel } from '@/components/chat/ThreadPanel';
import { GroupDetailsPanel } from '@/components/dashboard/GroupDetailsPanel';
import { WhatsAppEmojiPanel } from '@/components/chat/WhatsAppEmojiPanel';

export function ChatArea() {
  const navigate = useNavigate();
  const isMobile = useIsMobile();
  const [showEmojiPanel, setShowEmojiPanel] = useState(false);
  const { 
    activeGroup, 
    fetchMessages, 
    activeThread, 
    connectionStatus,
    cleanupRealtimeSubscription,
    showGroupDetailsPanel,
    setShowGroupDetailsPanel
  } = useChatStore();

  // The emoji selection is handled by the WhatsAppEmojiPanel component
  const handleEmojiSelect = () => {};

  useEffect(() => {
    if (activeGroup?.id) {
      fetchMessages(activeGroup.id);
    }
  }, [activeGroup?.id, fetchMessages]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      cleanupRealtimeSubscription();
    };
  }, [cleanupRealtimeSubscription]);

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

  return (
    <div className="h-full flex">
      {/* Main Chat Area */}
      <div className={`flex flex-col transition-all duration-300 ${
        !isMobile && (activeThread || showGroupDetailsPanel) ? 'flex-1' : 'w-full'
      }`}>
        {/* Header - Fixed at top */}
        <div className="flex-shrink-0 flex items-center justify-between p-5 border-b border-border/50 bg-card/30 backdrop-blur-sm z-10 shadow-lg">
          <div 
            className="flex items-center space-x-4 cursor-pointer hover:bg-muted/50 rounded-lg p-2 transition-colors"
            onClick={handleGroupHeaderClick}
          >
            <div className="flex items-center justify-center w-8 h-8 bg-gradient-to-br from-green-500 to-green-600/80 rounded-lg shadow-md">
              <Hash className="w-4 h-4 text-white" />
            </div>
            <div>
              <h1 className="text-xl font-bold hover:text-primary transition-colors">
                {activeGroup.name}
              </h1>
              {activeGroup.description && (
                <p className="text-sm text-muted-foreground">
                  {activeGroup.description}
                </p>
              )}
            </div>
          </div>
          <div className="flex items-center space-x-3">
            {/* Connection Status Indicator */}
            <div className="flex items-center space-x-1">
              {connectionStatus === 'connected' ? (
                <Wifi className={`w-4 h-4 ${getConnectionStatusColor()}`} />
              ) : (
                <WifiOff className={`w-4 h-4 ${getConnectionStatusColor()}`} />
              )}
              <Badge 
                variant="secondary" 
                className={`text-xs ${getConnectionStatusColor()} border-border/50`}
              >
                {getConnectionStatusText()}
              </Badge>
            </div>
            
            <Button variant="ghost" size="sm" className="rounded-full hover:bg-muted/50">
              <Users className="w-4 h-4" />
            </Button>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="sm" className="rounded-full hover:bg-muted/50">
                  <MoreHorizontal className="w-4 h-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onClick={handleGroupHeaderClick}>
                  Group Info
                </DropdownMenuItem>
                <DropdownMenuItem>
                  Copy Invite Code
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
        <div className={`flex-1 overflow-hidden transition-all duration-300 ${
          isMobile && showEmojiPanel ? 'pb-[400px]' : ''
        }`}>
          <MessageList />
        </div>

        {/* Input - Fixed at bottom */}
        <div className="flex-shrink-0 border-t border-border/50 bg-card/30 backdrop-blur-sm z-10">
          <ChatInput 
            showEmojiPanel={showEmojiPanel}
            setShowEmojiPanel={setShowEmojiPanel}
          />
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