import { BrowserRouter as Router, Routes, Route, Navigate, useNavigate } from 'react-router-dom';
import { useEffect, createContext } from 'react';
import { useAuthStore, initializeAuthListener } from '@/store/authStore';
import { useChatStore } from '@/store/chatStore';
import { useContactsStore } from '@/store/contactsStore';
import { useIsMobile } from '@/hooks/useMediaQuery';
import { sqliteService } from '@/lib/sqliteService';
import { needsFirstTimeInit } from '@/lib/initializationDetector';
import { Capacitor } from '@capacitor/core';
import { App as CapacitorApp } from '@capacitor/app';

import { Toaster } from '@/components/ui/sonner';
import { ThemeProvider } from '@/components/theme-provider';
import { CacheStatus } from '@/components/debug/CacheStatus';
import { ConnectionStatus, DebugConnectionStatus } from '@/components/ConnectionStatus';

// Create context for mobile detection
export const MobileContext = createContext(false);

// Auth pages
import WelcomePage from '@/pages/onboarding/WelcomePage';
import LoginPage from '@/pages/auth/LoginPage';
import VerifyPage from '@/pages/auth/VerifyPage';
import OnboardingNamePage from '@/pages/onboarding/NamePage';
import { SetupPage } from '@/pages/onboarding/SetupPage';

// Main app pages
import DashboardPage from '@/pages/DashboardPage';
import GroupPage from '@/pages/GroupPage';
import ThreadViewPage from './pages/ThreadViewPage';
import GroupDetailsViewPage from './pages/GroupDetailsViewPage';
import SettingsPage from '@/pages/SettingsPage';
import CreateGroupPage from '@/pages/CreateGroupPage';
import ContactSelectionPage from '@/pages/ContactSelectionPage';

// Components
import { LoadingScreen } from '@/components/LoadingScreen';
import { ProtectedRoute } from '@/components/ProtectedRoute';

// Track if setup redirect is pending to prevent loops
let setupRedirectPending = false;

// AppContent component with access to routing hooks
function AppContent() {
  const { 
    user, 
    isLoading, 
    isInitialized,
    initializeAuth 
  } = useAuthStore();
  const {
    startOutboxProcessor,
    stopOutboxProcessor,
    setupRealtimeSubscription,
    setConnectionStatus
  } = useChatStore();
  const { initialize: initializeContacts } = useContactsStore();
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
        // If we're in create group flow, navigate back appropriately
        else if (currentPath.includes('/create-group')) {
          if (currentPath === '/create-group/select-contacts') {
            // From contact selection, go back to create group
            navigate('/create-group', { replace: true });
          } else {
            // From create group page, go back to dashboard
            navigate('/dashboard', { replace: true });
          }
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
          // App resume is handled centrally in main.tsx
          // Preloader removed - messages load instantly from SQLite when opening groups
        } else {
          // Handle app going to background/pause
          try {
            console.log('📱 App going to background/pause');
            useChatStore.getState().onAppPause?.();
          } catch (error) {
            console.error('❌ Failed to handle app pause:', error);
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
            
            // ✅ INTEGRATION POINT 1: Check if first-time init is needed
            // This runs after SQLite is ready and before the app renders
            try {
              const needsInit = await needsFirstTimeInit();
              if (needsInit) {
                console.log('🔄 [APP] First-time initialization needed, will redirect to /setup');
                // Store flag to trigger redirect after auth completes
                sessionStorage.setItem('needs_first_time_init', 'true');
              } else {
                console.log('✅ [APP] First-time initialization not needed');
                sessionStorage.removeItem('needs_first_time_init');
              }
            } catch (error) {
              console.error('❌ [APP] Error checking first-time init status:', error);
              // Safe default: assume init is needed
              sessionStorage.setItem('needs_first_time_init', 'true');
            }
            
            // Clean up old tombstones (48+ hours old)
            try {
              const cleanedCount = await sqliteService.cleanupOldTombstones();
              if (cleanedCount > 0) {
                console.log(`🧹 Cleaned up ${cleanedCount} old tombstones on app start`);
              }
            } catch (error) {
              console.warn('⚠️ Tombstone cleanup failed (non-critical):', error);
            }

            // Check data integrity and clean up orphaned data
            try {
              const integrity = await sqliteService.checkDataIntegrity();
              if (!integrity.valid) {
                console.warn('⚠️ Data integrity issues detected:', integrity.issues);
                console.log('🔧 Attempting to repair by cleaning up orphaned data...');
                
                const cleaned = await sqliteService.cleanupAllOrphanedData();
                const totalCleaned = cleaned.reactions + cleaned.polls + cleaned.confessions;
                
                if (totalCleaned > 0) {
                  console.log(`✅ Cleaned up ${totalCleaned} orphaned records (reactions: ${cleaned.reactions}, polls: ${cleaned.polls}, confessions: ${cleaned.confessions})`);
                }
              }
            } catch (error) {
              console.warn('⚠️ Data integrity check/repair failed (non-critical):', error);
            }

            // Sync local read status to Supabase (background, non-blocking)
            try {
              const { unreadTracker } = await import('@/lib/unreadTracker');
              unreadTracker.syncLocalToSupabase().catch(err => {
                console.warn('⚠️ Read status sync failed (non-critical):', err);
              });
              console.log('🔄 Started background sync of read status to Supabase');
            } catch (error) {
              console.warn('⚠️ Failed to start read status sync (non-critical):', error);
            }
          } catch (error) {
            console.error('❌ SQLite initialization failed:', error);
            // Continue without SQLite - app should still work with remote data only
          }

          // Network status is now handled centrally in main.tsx
          // Set initial connection status to connecting
          setConnectionStatus('connecting');
          console.log('🌐 Network status monitoring handled centrally in main.tsx');

          // Initialize contacts store (load from SQLite + check permission)
          console.log('📇 About to initialize contacts store...');
          try {
            console.log('📇 Calling initializeContacts()...');
            await initializeContacts();
            console.log('✅ Contacts store initialized successfully');
            
            // If permission is granted but no contacts in SQLite, trigger initial sync
            const contactsState = useContactsStore.getState();
            if (contactsState.permissionGranted && contactsState.contacts.length === 0) {
              console.log('📇 Permission granted but no contacts found, triggering initial sync...');
              // Run in background without blocking app startup
              contactsState.syncContacts()
                .then(() => contactsState.discoverInBackgroundV3())
                .then(() => console.log('✅ Background contact sync complete'))
                .catch(err => console.warn('⚠️ Background contact sync failed:', err));
            }
          } catch (error) {
            console.error('❌ Contacts store initialization failed:', error);
            console.error('❌ Error details:', {
              message: error instanceof Error ? error.message : String(error),
              stack: error instanceof Error ? error.stack : undefined,
              error
            });
            // Continue without contacts - not critical for app functionality
          }
          console.log('📇 Contacts initialization block completed');
        }

        // Initialize auth listener first and WAIT for it to be fully set up
        // This ensures the listener is ready to receive SIGNED_IN events during OTP verification
        console.log('🎧 Initializing auth listener...');
        const cleanup = await initializeAuthListener();
        console.log('✅ Auth listener initialized');

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

  // Push notification integration points (FCM/APNs)
  // NOTE: Implement platform-specific registration in a separate service and call back into the store for catch-up sync
  useEffect(() => {
    // TODO: register FCM/APNs listeners and, on wake/tap, call:
    // const g = useChatStore.getState(); if (g.activeGroup?.id) g.forceMessageSync(g.activeGroup.id);
    return () => {};
  }, []);

  // Show loading screen while auth is initializing
  if (!isInitialized || isLoading) {
    return <LoadingScreen />;
  }

  return (
    <MobileContext.Provider value={isMobile}>
      <div className="min-h-screen bg-background text-foreground">
        <Routes>
          {/* Welcome page - First screen for new users */}
          <Route
            path="/welcome"
            element={
              user ? (
                user.is_onboarded ? (
                  <Navigate to="/dashboard" replace />
                ) : (
                  <Navigate to="/onboarding/name" replace />
                )
              ) : (
                <WelcomePage />
              )
            }
          />

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

          {/* Setup page - shown after onboarding, before dashboard */}
          <Route
            path="/setup"
            element={
              <ProtectedRoute requireOnboarding={true}>
                <SetupPage />
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

          {/* Create Group Flow */}
          <Route
            path="/create-group"
            element={
              <ProtectedRoute requireOnboarding={true}>
                <CreateGroupPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/create-group/select-contacts"
            element={
              <ProtectedRoute requireOnboarding={true}>
                <ContactSelectionPage />
              </ProtectedRoute>
            }
          />

          {/* Add Members to Group Flow */}
          <Route
            path="/groups/:groupId/add-members"
            element={
              <ProtectedRoute requireOnboarding={true}>
                <ContactSelectionPage />
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
                    ? "/welcome"
                    : (() => {
                        // ✅ INTEGRATION POINT 1B: Check if first-time init is needed
                        const needsInit = sessionStorage.getItem('needs_first_time_init') === 'true';
                        if (needsInit && user.is_onboarded && !setupRedirectPending) {
                          console.log('🔄 [APP] Redirecting to /setup for first-time initialization');
                          setupRedirectPending = true; // ✅ Prevent redirect loop
                          return "/setup";
                        }
                        return user.is_onboarded ? "/dashboard" : "/onboarding/name";
                      })()
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
                    ? "/welcome"
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
        {/* WhatsApp-style connection status */}
        <ConnectionStatus />

        <AppContent />
        <Toaster />
        <CacheStatus />

        {/* Debug connection status for development */}
        <DebugConnectionStatus />
      </Router>
    </ThemeProvider>
  );
}

export default App;