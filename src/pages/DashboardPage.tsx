import { useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useAuthStore } from '@/store/authStore';
import { useChatStore } from '@/store/chatStore';
import { useIsMobile } from '@/hooks/useMediaQuery';
import { Sidebar } from '@/components/dashboard/Sidebar';
import { ChatArea } from '@/components/dashboard/ChatArea';
import { WelcomeScreen } from '@/components/dashboard/WelcomeScreen';

export default function DashboardPage() {
  const { user } = useAuthStore();
  const { activeGroup, fetchGroups, groups, setActiveGroup } = useChatStore();
  const isMobile = useIsMobile();
  const [searchParams, setSearchParams] = useSearchParams();

  useEffect(() => {
    if (user?.id) {
      fetchGroups();
    }
  }, [user?.id, fetchGroups]);

  // CRITICAL FIX: Handle FCM notification navigation via URL parameter
  useEffect(() => {
    const groupIdFromUrl = searchParams.get('group');
    if (groupIdFromUrl && groups.length > 0) {
      console.log('[dashboard] 📍 Opening group from URL parameter:', groupIdFromUrl);

      // Find the group
      const targetGroup = groups.find(g => g.id === groupIdFromUrl);
      if (targetGroup) {
        console.log('[dashboard] ✅ Found group, setting as active:', targetGroup.name);
        setActiveGroup(targetGroup);

        // Clear the URL parameter
        setSearchParams({});
      } else {
        console.warn('[dashboard] ⚠️ Group not found:', groupIdFromUrl);
      }
    }
  }, [searchParams, groups, setActiveGroup, setSearchParams]);

  // On mobile, show full-screen sidebar when no group is selected
  if (isMobile && !activeGroup) {
    return (
      <div className="h-screen w-screen bg-background overflow-hidden">
        <Sidebar />
      </div>
    );
  }

  return (
    <div className="h-screen w-screen bg-background flex overflow-hidden">
      {/* Show sidebar on desktop, or when no active group on mobile */}
      {(!isMobile || !activeGroup) && <Sidebar />}
      
      {/* Main content area */}
      <div className={`flex-1 flex flex-col ${isMobile && activeGroup ? 'w-full' : ''}`}>
        {activeGroup ? (
          <ChatArea />
        ) : (
          <WelcomeScreen />
        )}
      </div>
    </div>
  );
}