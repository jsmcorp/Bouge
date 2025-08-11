import { useEffect } from 'react';
import { useAuthStore } from '@/store/authStore';
import { useChatStore } from '@/store/chatStore';
import { useIsMobile } from '@/hooks/useMediaQuery';
import { Sidebar } from '@/components/dashboard/Sidebar';
import { ChatArea } from '@/components/dashboard/ChatArea';
import { WelcomeScreen } from '@/components/dashboard/WelcomeScreen';
import { preloadingService } from '@/lib/preloadingService';

export default function DashboardPage() {
  const { user } = useAuthStore();
  const { activeGroup, fetchGroups, preloadTopGroupMessages } = useChatStore();
  const isMobile = useIsMobile();

  useEffect(() => {
    if (user?.id) {
      fetchGroups();
    }
  }, [user?.id, fetchGroups]);

  // Trigger preloading when dashboard loads and groups are available
  useEffect(() => {
    if (user?.id) {
      // Small delay to let groups load first
      const preloadTimer = setTimeout(() => {
        console.log('🚀 Dashboard: Triggering preload after groups loaded');
        preloadTopGroupMessages();
      }, 1000);

      return () => clearTimeout(preloadTimer);
    }
  }, [user?.id, preloadTopGroupMessages]);

  // Ensure we stop background preloading when leaving the dashboard
  useEffect(() => {
    return () => {
      preloadingService.clearPreloadQueue();
    };
  }, []);

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