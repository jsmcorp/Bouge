import { useParams } from 'react-router-dom';
import { useEffect } from 'react';
import { useChatStore } from '@/store/chatStore';
import { useIsMobile } from '@/hooks/useMediaQuery';
import { Sidebar } from '@/components/dashboard/Sidebar';
import { ChatArea } from '@/components/dashboard/ChatArea';

export default function GroupPage() {
  const { groupId, topicId } = useParams();
  const { groups, activeGroup, setActiveGroup, setActiveTopicId } = useChatStore();
  const isMobile = useIsMobile();

  // Set active group based on URL parameter
  useEffect(() => {
    // Only set active group if we're actually on a group route
    if (groupId && window.location.pathname.includes(`/groups/${groupId}`)) {
      const group = groups.find(g => g.id === groupId);
      if (group && (!activeGroup || activeGroup.id !== group.id)) {
        setActiveGroup(group);
      }
    }
  }, [groupId, groups, activeGroup, setActiveGroup]);

  // Set active topic ID
  useEffect(() => {
    setActiveTopicId(topicId || null);
    return () => setActiveTopicId(null);
  }, [topicId, setActiveTopicId]);



  return (
    <div className="h-screen w-screen bg-background flex overflow-hidden">
      {/* Hide sidebar on mobile for full-screen chat */}
      {!isMobile && <Sidebar />}
      <div className={`flex-1 flex flex-col ${isMobile ? 'w-full' : ''}`}>
        <ChatArea topicId={topicId} />
      </div>
    </div>
  );
}