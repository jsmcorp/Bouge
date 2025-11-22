import { Navigate, useLocation } from 'react-router-dom';
import { useAuthStore } from '@/store/authStore';
import { LoadingScreen } from '@/components/LoadingScreen';
import { useEffect, useState } from 'react';
import { needsFirstTimeInit } from '@/lib/initializationDetector';
import { Capacitor } from '@capacitor/core';

interface ProtectedRouteProps {
  children: React.ReactNode;
  requireOnboarding?: boolean;
}

export function ProtectedRoute({ children, requireOnboarding = true }: ProtectedRouteProps) {
  const { user, isLoading, isInitialized } = useAuthStore();
  const location = useLocation();
  const [checkingInit, setCheckingInit] = useState(false);
  const [needsInit, setNeedsInit] = useState(false);

  // ✅ INTEGRATION POINT 2: Check if first-time init is needed
  // This acts as a secondary safety net for protected routes
  useEffect(() => {
    const checkInit = async () => {
      // Only check on native platforms and when user is authenticated
      if (!Capacitor.isNativePlatform() || !user || !isInitialized) {
        return;
      }

      // Skip check if we're already on the setup page
      if (location.pathname === '/setup') {
        return;
      }

      // Check if first-time init is needed
      setCheckingInit(true);
      try {
        const initNeeded = await needsFirstTimeInit();
        setNeedsInit(initNeeded);
        
        if (initNeeded) {
          console.log('🔄 [PROTECTED-ROUTE] First-time initialization needed, will redirect to /setup');
          sessionStorage.setItem('needs_first_time_init', 'true');
        } else {
          sessionStorage.removeItem('needs_first_time_init');
        }
      } catch (error) {
        console.error('❌ [PROTECTED-ROUTE] Error checking first-time init:', error);
        // Safe default: assume init is needed
        setNeedsInit(true);
        sessionStorage.setItem('needs_first_time_init', 'true');
      } finally {
        setCheckingInit(false);
      }
    };

    checkInit();
  }, [user, isInitialized, location.pathname]);

  // Show loading while auth is initializing or still loading
  if (!isInitialized || isLoading || checkingInit) {
    if (import.meta.env.DEV) console.log('⏳ ProtectedRoute: Auth still loading/initializing');
    return <LoadingScreen />;
  }

  // No user - redirect to login with return path
  if (!user) {
    if (import.meta.env.DEV) console.log('🔐 ProtectedRoute: No user, redirecting to login from:', location.pathname);
    return <Navigate to="/auth/login" state={{ from: location }} replace />;
  }

  // ✅ INTEGRATION POINT 2B: Redirect to setup if first-time init is needed
  // This prevents users from accessing protected routes before setup is complete
  if (needsInit && location.pathname !== '/setup' && user.is_onboarded) {
    if (import.meta.env.DEV) console.log('🔄 [PROTECTED-ROUTE] Redirecting to /setup for first-time initialization');
    return <Navigate to="/setup" replace />;
  }

  // User exists - check onboarding requirements
  const isOnboardingPage = location.pathname.startsWith('/onboarding');
  const isUserOnboarded = user.is_onboarded;

  // If user is onboarded but on onboarding pages, redirect to dashboard
  if (isUserOnboarded && isOnboardingPage) {
    if (import.meta.env.DEV) console.log('✅ ProtectedRoute: User already onboarded, redirecting to dashboard');
    return <Navigate to="/dashboard" replace />;
  }

  // If user is not onboarded and trying to access protected content (not onboarding pages)
  if (!isUserOnboarded && !isOnboardingPage && requireOnboarding) {
    if (import.meta.env.DEV) console.log('👋 ProtectedRoute: User not onboarded, redirecting to onboarding');
    return <Navigate to="/onboarding/name" replace />;
  }

  // If this is an onboarding page but onboarding is not required, allow access
  if (isOnboardingPage && !requireOnboarding) {
    if (import.meta.env.DEV) console.log('📝 ProtectedRoute: Onboarding page access granted');
    return <>{children}</>;
  }

  // All checks passed - render the protected content
  if (import.meta.env.DEV) console.log('✅ ProtectedRoute: Access granted to:', location.pathname);
  return <>{children}</>;
}