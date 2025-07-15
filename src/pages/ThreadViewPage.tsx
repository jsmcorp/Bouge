import { useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useChatStore } from '@/store/chatStore';
import { ThreadPanel } from '@/components/chat/ThreadPanel';

export default function ThreadViewPage() {
  const { groupId, messageId } = useParams();
  const navigate = useNavigate();
  const { 
    groups, 
    messages, 
    activeGroup, 
    setActiveGroup, 
    fetchMessages,
    openThread,
    closeThread
  } = useChatStore();

  useEffect(() => {
    if (groupId) {
      // Set active group if not already set
      const group = groups.find(g => g.id === groupId);
      if (group && (!activeGroup || activeGroup.id !== group.id)) {
        setActiveGroup(group);
      }
      
      // Fetch messages if needed
      fetchMessages(groupId);
    }
  }, [groupId, groups, activeGroup, setActiveGroup, fetchMessages]);

  useEffect(() => {
    if (messageId && messages.length > 0) {
      // Find and open the thread for the specific message
      const message = messages.find(m => m.id === messageId);
      if (message) {
        openThread(message);
      }
    }
  }, [messageId, messages, openThread]);

  const handleBack = () => {
    closeThread();
    if (groupId) {
      navigate(`/groups/${groupId}`);
    } else {
      navigate('/dashboard');
    }
  };

  return (
    <div className="h-screen w-screen bg-background flex flex-col">
      {/* Mobile Header */}
      <div className="flex-shrink-0 flex items-center p-2 sm:p-4 border-b border-border/50 bg-card/30 backdrop-blur-sm">
        <Button
          variant="ghost"
          size="sm"
          onClick={handleBack}
          className="mr-2 sm:mr-3 h-8 w-8 p-0 hover:bg-muted/50"
        >
          <ArrowLeft className="w-4 h-4" />
        </Button>
        <div>
          <h1 className="font-semibold text-base sm:text-lg">Thread</h1>
          <p className="text-xs sm:text-sm text-muted-foreground truncate max-w-[200px] sm:max-w-none">
            {activeGroup?.name}
          </p>
        </div>
      </div>

      {/* Thread Content */}
      <div className="flex-1 overflow-hidden">
        <ThreadPanel />
      </div>
    </div>
  );
}