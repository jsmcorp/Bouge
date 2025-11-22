import { useAuthStore } from '@/store/authStore';
import { sqliteService } from '@/lib/sqliteService';

// ✅ FIX #6: Guard flag to prevent duplicate checks
let isChecking = false;
let lastCheckResult: boolean | null = null;
let lastCheckTime = 0;

/**
 * Detection logic for first-time initialization
 * Checks if comprehensive first-time sync is needed
 * 
 * Scenarios that trigger first-time init:
 * 1. Fresh install (no setup_complete flag)
 * 2. After "Clear Data" (flag exists but SQLite is empty)
 * 3. After app reinstall (flag exists but data is missing)
 */
export const needsFirstTimeInit = async (): Promise<boolean> => {
  // ✅ Return cached result if checked within last 5 seconds
  const now = Date.now();
  if (lastCheckResult !== null && now - lastCheckTime < 5000) {
    console.log(`🔍 [INIT-DETECTOR] Using cached result: ${lastCheckResult} (${Math.round((now - lastCheckTime) / 1000)}s ago)`);
    return lastCheckResult;
  }
  
  // ✅ Prevent concurrent checks
  if (isChecking) {
    console.log('🔍 [INIT-DETECTOR] Check already in progress, waiting...');
    // Wait for ongoing check to complete
    while (isChecking) {
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    // ✅ CRITICAL: Handle case where in-flight check threw and never set result
    // Safe default: prefer running init (true) if check failed
    if (lastCheckResult === null) {
      console.warn('⚠️ [INIT-DETECTOR] In-flight check failed to set result, defaulting to true (safe: run init)');
      return true;
    }
    return lastCheckResult;
  }
  
  isChecking = true;
  console.log('🔍 [INIT-DETECTOR] Checking if first-time initialization is needed...');
  
  try {
    // Check 1: Setup flag
    const isComplete = localStorage.getItem('setup_complete');
    if (!isComplete) {
      console.log('✅ [INIT-DETECTOR] First-time init needed: setup_complete flag missing');
      lastCheckResult = true;
      lastCheckTime = Date.now();
      return true;
    }
    
    // Check 2: Verify SQLite has data (reality check)
    // This handles Android "Clear Data" scenarios where localStorage persists but SQLite doesn't
    try {
      const user = useAuthStore.getState().user;
      if (!user) {
        console.log('✅ [INIT-DETECTOR] First-time init needed: no authenticated user');
        lastCheckResult = true;
        lastCheckTime = Date.now();
        return true;
      }
      
      // CRITICAL: Verify groups exist in SQLite
      const localGroups = await sqliteService.getGroups();
      if (!localGroups || localGroups.length === 0) {
        console.warn('⚠️ [INIT-DETECTOR] Setup flag was true, but no groups in SQLite');
        console.log('✅ [INIT-DETECTOR] First-time init needed: no groups found (data reality check failed)');
        lastCheckResult = true;
        lastCheckTime = Date.now();
        return true;
      }
      
      console.log(`✅ [INIT-DETECTOR] First-time init NOT needed: all checks passed (${localGroups.length} groups found)`);
      lastCheckResult = false;
      lastCheckTime = Date.now();
      return false;
    } catch (error) {
      console.error('❌ [INIT-DETECTOR] Error checking init status:', error);
      // Safe default: re-initialize on error
      lastCheckResult = true;
      lastCheckTime = Date.now();
      return true;
    }
  } finally {
    isChecking = false;
  }
};
