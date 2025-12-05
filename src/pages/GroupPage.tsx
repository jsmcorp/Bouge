import { useParams, useNavigate } from 'react-router-dom';
import { useEffect } from 'react';
import { useChatStore } from '@/store/chatStore';
import { useIsMobile } from '@/hooks/useMediaQuery';
import { Sidebar } from '@/components/dashboard/Sidebar';
import { ChatArea } from '@/components/dashboard/ChatArea';

export default function GroupPage() {
  const { groupId } = useParams();
  const navigate = useNavigate();
  const { groups, activeGroup, setActiveGroup } = useChatStore();
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



  return (
    <div className="h-screen w-screen bg-background flex overflow-hidden">
      {/* Hide sidebar on mobile for full-screen chat */}
      {!isMobile && <Sidebar />}
      <div className={`flex-1 flex flex-col ${isMobile ? 'w-full' : ''}`}>
        <ChatArea onBack={() => navigate(`/groups/${groupId}`, { replace: true })} />
      </div>
    </div>
  );
}