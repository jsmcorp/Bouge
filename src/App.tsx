import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import { useEffect, createContext } from 'react';
import { useAuthStore, initializeAuthListener } from '@/store/authStore';
import { useIsMobile } from '@/hooks/useMediaQuery';
import { sqliteService } from '@/lib/sqliteService';
import { useChatStore } from '@/store/chatStore';
import { Capacitor } from '@capacitor/core';
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

function App() {
  const { 
    user, 
    isLoading, 
    isInitialized,
    initializeAuth 
  } = useAuthStore();
  const { setupNetworkListener, cleanupNetworkListener } = useChatStore();
  const isMobile = useIsMobile();

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
            
            // Set up network listener for processing outbox messages
            setupNetworkListener();
          } catch (error) {
            console.error('❌ SQLite initialization failed:', error);
            // Continue without SQLite - app should still work with remote data only
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
      cleanupNetworkListener();
      cleanupPromise.then(cleanup => cleanup());
    };
  }, []); // Empty dependency array - only run once

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
    return (
      <ThemeProvider defaultTheme="light" storageKey="confessr-theme">
        <LoadingScreen />
        <Toaster />
      </ThemeProvider>
    );
  }

  return (
    <ThemeProvider defaultTheme="light" storageKey="confessr-theme">
      <MobileContext.Provider value={isMobile}>
        <Router 
          future={{ 
            v7_startTransition: true,
            v7_relativeSplatPath: true 
          }}
        >
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
          <Toaster />
        </Router>
      </MobileContext.Provider>
    </ThemeProvider>
  );
}

export default App;