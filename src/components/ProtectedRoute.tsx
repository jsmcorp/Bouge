import { Navigate, useLocation } from 'react-router-dom';
import { useAuthStore } from '@/store/authStore';
import { LoadingScreen } from '@/components/LoadingScreen';

interface ProtectedRouteProps {
  children: React.ReactNode;
  requireOnboarding?: boolean;
}

export function ProtectedRoute({ children, requireOnboarding = true }: ProtectedRouteProps) {
  const { user, isLoading, isInitialized } = useAuthStore();
  const location = useLocation();

  // Show loading while auth is initializing or still loading
  if (!isInitialized || isLoading) {
    console.log('⏳ ProtectedRoute: Auth still loading/initializing');
    return <LoadingScreen />;
  }

  // No user - redirect to login with return path
  if (!user) {
    console.log('🔐 ProtectedRoute: No user, redirecting to login from:', location.pathname);
    return <Navigate to="/auth/login" state={{ from: location }} replace />;
  }

  // User exists - check onboarding requirements
  const isOnboardingPage = location.pathname.startsWith('/onboarding');
  const isUserOnboarded = user.is_onboarded;

  // If user is onboarded but on onboarding pages, redirect to dashboard
  if (isUserOnboarded && isOnboardingPage) {
    console.log('✅ ProtectedRoute: User already onboarded, redirecting to dashboard');
    return <Navigate to="/dashboard" replace />;
  }

  // If user is not onboarded and trying to access protected content (not onboarding pages)
  if (!isUserOnboarded && !isOnboardingPage && requireOnboarding) {
    console.log('👋 ProtectedRoute: User not onboarded, redirecting to onboarding');
    return <Navigate to="/onboarding/name" replace />;
  }

  // If this is an onboarding page but onboarding is not required, allow access
  if (isOnboardingPage && !requireOnboarding) {
    console.log('📝 ProtectedRoute: Onboarding page access granted');
    return <>{children}</>;
  }

  // All checks passed - render the protected content
  console.log('✅ ProtectedRoute: Access granted to:', location.pathname);
  return <>{children}</>;
}