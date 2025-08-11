import { BrowserRouter as Router, Routes, Route, Navigate, useNavigate } from 'react-router-dom';
import { useEffect, createContext } from 'react';
import { useAuthStore, initializeAuthListener } from '@/store/authStore';
import { useChatStore } from '@/store/chatStore';
import { useIsMobile } from '@/hooks/useMediaQuery';
import { sqliteService } from '@/lib/sqliteService';
import { Capacitor } from '@capacitor/core';
import { App as CapacitorApp } from '@capacitor/app';
import { Network } from '@capacitor/network';
import { Toaster } from '@/components/ui/sonner';
import { ThemeProvider } from '@/components/theme-provider';

// Create context for mobile detection
export const MobileContext = createContext(false);

// Auth pages
import LoginPage from '@/pages/auth/LoginPage';
import VerifyPage from '@/pages/auth/VerifyPage';
import OnboardingNamePage from '@/pages/onboarding/NamePage';
import OnboardingAvatarPage from '@/pages/onboarding/AvatarPage';

// Main app pages
import DashboardPage from '@/pages/DashboardPage';
import GroupPage from '@/pages/GroupPage';
import ThreadViewPage from './pages/ThreadViewPage';
import GroupDetailsViewPage from './pages/GroupDetailsViewPage';
import SettingsPage from '@/pages/SettingsPage';

// Components
import { LoadingScreen } from '@/components/LoadingScreen';
import { ProtectedRoute } from '@/components/ProtectedRoute';

// AppContent component with access to routing hooks
function AppContent() {
  const { 
    user, 
    isLoading, 
    isInitialized,
    initializeAuth 
  } = useAuthStore();
  const { 
    setOnlineStatus, 
    startOutboxProcessor, 
    stopOutboxProcessor,
    setupRealtimeSubscription
  } = useChatStore();
  const isMobile = useIsMobile();
  const navigate = useNavigate();

  // Handle hardware back button and app state changes on mobile
  useEffect(() => {
    if (Capacitor.isNativePlatform()) {
      const handleBackButton = () => {
        const currentPath = window.location.pathname;
        
        // If we're in a group chat, navigate to dashboard
        if (currentPath.includes('/groups/') && !currentPath.includes('/thread/') && !currentPath.includes('/details')) {
          // Clear active group first
          useChatStore.getState().setActiveGroup(null);
          // Use window.history to ensure immediate navigation
          window.history.replaceState(null, '', '/dashboard');
          navigate('/dashboard', { replace: true });
        }
        // For other pages (not dashboard), navigate back in history
        else if (currentPath !== '/dashboard') {
          navigate(-1);
        }
        // If we're at dashboard, let the app exit
        else {
          CapacitorApp.exitApp();
        }
      };

      const handleAppStateChange = ({ isActive }: { isActive: boolean }) => {
        console.log('📱 App state changed:', isActive ? 'active' : 'inactive');
        
        if (isActive) {
          // App came to foreground - reconnect realtime if we have an active group
          const currentActiveGroup = useChatStore.getState().activeGroup;
          if (currentActiveGroup) {
            console.log('🔄 App resumed, reconnecting realtime for group:', currentActiveGroup.id);
            setTimeout(() => {
              setupRealtimeSubscription(currentActiveGroup.id);
            }, 1000); // Small delay to ensure app is fully active
          }
        }
      };

      let backButtonHandle: any;
      let appStateHandle: any;
      
      CapacitorApp.addListener('backButton', handleBackButton).then(handle => {
        backButtonHandle = handle;
      });

      CapacitorApp.addListener('appStateChange', handleAppStateChange).then(handle => {
        appStateHandle = handle;
      });
      
      // Cleanup
      return () => {
        if (backButtonHandle) {
          backButtonHandle.remove();
        }
        if (appStateHandle) {
          appStateHandle.remove();
        }
      };
    }
  }, [setupRealtimeSubscription]);

  useEffect(() => {
    console.log('🚀 App mounted, setting up auth...');

    const setupAuth = async () => {
      try {
        // Initialize SQLite database on native platforms
        if (Capacitor.isNativePlatform()) {
          console.log('📱 Native platform detected, initializing SQLite...');
          try {
            await sqliteService.initialize();
            console.log('✅ SQLite initialized successfully');
          } catch (error) {
            console.error('❌ SQLite initialization failed:', error);
            // Continue without SQLite - app should still work with remote data only
          }
          
          // Initialize network status monitoring
          try {
            const status = await Network.getStatus();
            setOnlineStatus(status.connected);
            console.log('🌐 Initial network status:', status.connected ? 'online' : 'offline');
            
            // Listen for network status changes
            Network.addListener('networkStatusChange', (status) => {
              console.log('🌐 Network status changed:', status.connected ? 'online' : 'offline');
              setOnlineStatus(status.connected);
            });
          } catch (error) {
            console.error('❌ Network status setup failed:', error);
          }
        }

        // Initialize auth listener first
        const cleanup = initializeAuthListener();
        
        // Then initialize auth state
        await initializeAuth();
        
        console.log('✅ Auth setup complete');
        
        // Return cleanup function
        return cleanup;
      } catch (error) {
        console.error('💥 Auth setup failed:', error);
        return () => {}; // Return empty cleanup function
      }
    };

    const cleanupPromise = setupAuth();

    // Cleanup function for this component
    return () => {
      console.log('🧹 App unmounting, cleaning up...');
      cleanupPromise.then(cleanup => cleanup());
      stopOutboxProcessor();
    };
  }, []); // Empty dependency array - only run once
  
  // Start outbox processor when user is authenticated
  useEffect(() => {
    if (user && isInitialized && !isLoading && Capacitor.isNativePlatform()) {
      console.log('🚀 Starting outbox processor...');
      startOutboxProcessor();
      
      return () => {
        console.log('🛑 Stopping outbox processor...');
        if (typeof stopOutboxProcessor === 'function') {
          stopOutboxProcessor();
        }
      };
    }
  }, [user, isInitialized, isLoading, startOutboxProcessor, stopOutboxProcessor]);

  // Debug logging for render state
  useEffect(() => {
    console.log('🎨 App render state:', { 
      isLoading,
      isInitialized,
      hasUser: !!user, 
      isOnboarded: user?.is_onboarded,
      userId: user?.id
    });
  }, [isLoading, isInitialized, user]);

  // Show loading screen while auth is initializing
  if (!isInitialized || isLoading) {
    return <LoadingScreen />;
  }

  return (
    <MobileContext.Provider value={isMobile}>
      <div className="min-h-screen bg-background text-foreground">
        <Routes>
          {/* Public routes */}
          <Route
            path="/auth/login"
            element={
              user ? (
                user.is_onboarded ? (
                  <Navigate to="/dashboard" replace />
                ) : (
                  <Navigate to="/onboarding/name" replace />
                )
              ) : (
                <LoginPage />
              )
            }
          />
          <Route
            path="/auth/verify"
            element={
              user ? (
                user.is_onboarded ? (
                  <Navigate to="/dashboard" replace />
                ) : (
                  <Navigate to="/onboarding/name" replace />
                )
              ) : (
                <VerifyPage />
              )
            }
          />

          {/* Onboarding routes */}
          <Route
            path="/onboarding/name"
            element={
              <ProtectedRoute requireOnboarding={false}>
                <OnboardingNamePage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/onboarding/avatar"
            element={
              <ProtectedRoute requireOnboarding={false}>
                <OnboardingAvatarPage />
              </ProtectedRoute>
            }
          />

          {/* Protected routes */}
          <Route
            path="/dashboard"
            element={
              <ProtectedRoute requireOnboarding={true}>
                <DashboardPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/groups/:groupId"
            element={
              <ProtectedRoute requireOnboarding={true}>
                <GroupPage />
              </ProtectedRoute>
            }
          />
          
          {/* Mobile-specific full-screen routes */}
          <Route
            path="/groups/:groupId/thread/:messageId"
            element={
              <ProtectedRoute requireOnboarding={true}>
                <ThreadViewPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/groups/:groupId/details"
            element={
              <ProtectedRoute requireOnboarding={true}>
                <GroupDetailsViewPage />
              </ProtectedRoute>
            }
          />
          
          <Route
            path="/settings"
            element={
              <ProtectedRoute requireOnboarding={true}>
                <SettingsPage />
              </ProtectedRoute>
            }
          />

          {/* Default redirect */}
          <Route
            path="/"
            element={
              <Navigate
                to={
                  !user 
                    ? "/auth/login" 
                    : user.is_onboarded 
                      ? "/dashboard" 
                      : "/onboarding/name"
                }
                replace
              />
            }
          />

          {/* Catch all */}
          <Route
            path="*"
            element={
              <Navigate
                to={
                  !user 
                    ? "/auth/login" 
                    : user.is_onboarded 
                      ? "/dashboard" 
                      : "/onboarding/name"
                }
                replace
              />
            }
          />
        </Routes>
      </div>
    </MobileContext.Provider>
  );
}

function App() {
  return (
    <ThemeProvider defaultTheme="light" storageKey="confessr-theme">
      <Router 
        future={{ 
          v7_startTransition: true,
          v7_relativeSplatPath: true 
        }}
      >
        <AppContent />
        <Toaster />
      </Router>
    </ThemeProvider>
  );
}

export default App;