import { useEffect } from 'react';
import { useAuthStore } from '@/store/authStore';
import { useChatStore } from '@/store/chatStore';
import { useIsMobile } from '@/hooks/useMediaQuery';
import { Sidebar } from '@/components/dashboard/Sidebar';
import { ChatArea } from '@/components/dashboard/ChatArea';
import { WelcomeScreen } from '@/components/dashboard/WelcomeScreen';

export default function DashboardPage() {
  const { user } = useAuthStore();
  const { activeGroup, fetchGroups } = useChatStore();
  const isMobile = useIsMobile();

  useEffect(() => {
    if (user?.id) {
      fetchGroups();
    }
  }, [user?.id, fetchGroups]);

  return (
    <div className="h-screen bg-background flex overflow-hidden">
      {/* Show sidebar on desktop, or when no active group on mobile */}
      {(!isMobile || !activeGroup) && <Sidebar />}
      
      {/* Main content area */}
      <div className={`flex-1 flex flex-col ${isMobile && activeGroup ? 'w-full' : ''}`}>
        {activeGroup ? (
          <ChatArea />
        ) : (
          !isMobile ? <WelcomeScreen /> : (
            <div className="flex-1 flex items-center justify-center p-2 sm:p-3 md:p-4">
              <div className="text-center">
                <h2 className="text-lg sm:text-xl font-semibold mb-2">Select a group</h2>
                <p className="text-sm text-muted-foreground">Choose a group from the list to start chatting</p>
              </div>
            </div>
          )
        )}
      </div>
    </div>
  );
}