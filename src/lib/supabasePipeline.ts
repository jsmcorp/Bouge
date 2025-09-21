import { createClient, SupabaseClient } from '@supabase/supabase-js';
import type { AuthChangeEvent } from '@supabase/supabase-js';
import type { Database } from './database.types';
import { sqliteService } from './sqliteService';
import { Capacitor } from '@capacitor/core';

// Database types for proper typing
type GroupInsert = Database['public']['Tables']['groups']['Insert'];
type MessageInsert = Database['public']['Tables']['messages']['Insert'];



// Types for the pipeline
export interface Message {
  id: string;
  group_id: string;
  user_id: string;
  content: string;
  is_ghost: boolean;
  message_type: string;
  category: string | null;
  parent_id: string | null;
  image_url: string | null;
  dedupe_key?: string | null;
}

export interface OutboxMessage {
  id: string;
  group_id: string;
  user_id: string;
  content: string;
  retry_count: number;
  next_retry_at: number;
}

// Auth operation interfaces
export interface AuthOperationResult {
  data?: any;
  error?: any;
  user?: any;
  session?: any;
}

// Use database types instead of custom interfaces
export type GroupInsertData = GroupInsert;

export type MessageInsertData = MessageInsert;

interface PipelineConfig {
  sendTimeoutMs: number;
  healthCheckTimeoutMs: number;
  maxRetries: number;
  retryBackoffMs: number;
}

// Utility function to safely stringify errors
function stringifyError(error: any): string {
  if (error === null || error === undefined) return 'null/undefined error';
  if (typeof error === 'string') return error;
  if (error instanceof Error) {
    return `${error.name}: ${error.message}${error.stack ? '\n' + error.stack : ''}`;
  }
  try {
    return JSON.stringify(error, null, 2);
  } catch {
    return String(error);
  }
}

// Singleton pipeline orchestrator
class SupabasePipeline {
  private client: any = null;
  private isInitialized = false;
  private initializePromise: Promise<void> | null = null;
  private config: PipelineConfig = {
    sendTimeoutMs: 15000, // Increased from 6s to 15s for mobile networks
    healthCheckTimeoutMs: 5000, // Increased from 3s to 5s
    maxRetries: 3, // Increased from 2 to 3 retries
    retryBackoffMs: 2000, // Increased from 1.5s to 2s
  };



  // Last outbox processing statistics for callers to inspect without changing method signatures
  private lastOutboxStats: { sent: number; failed: number; retried: number; groupsWithSent: string[] } | null = null;
  // Pipeline-managed auth listeners so they survive client recreation
  private authListeners: Array<{ id: string; callback: (event: string, session: any) => void; unsubscribe?: () => void }> = [];
  // Coalesce concurrent hard-recreate requests
  private recreatePromise: Promise<void> | null = null;
  // Track last known session user id for corruption checks
  private lastKnownUserId: string | null = null;
  // Throttle full corruption checks
  private lastCorruptionCheckAt: number = 0;
  // Track last known tokens for session rehydration
  private lastKnownAccessToken: string | null = null;
  private lastKnownRefreshToken: string | null = null;
  // Internal auth listener to cache tokens (rebounds on recreate)
  private internalAuthUnsub: (() => void) | null = null;
  // Session deduplication - cache and in-flight promise management
  private cachedSession: { session: any; timestamp: number } | null = null;
  private sessionCacheValidityMs = 15000; // Cache session for 15 seconds (increased for stability)
  private inFlightSessionPromise: Promise<AuthOperationResult> | null = null;
  // Global operation lock to prevent concurrent operations

  // Single-flight outbox processing guards
  private isOutboxProcessing = false;
  private lastOutboxStartAt = 0;
  private lastOutboxTriggerAt = 0;

  // Circuit breaker for repeated failures
  private failureCount = 0;
  private lastFailureAt = 0;
  private circuitBreakerOpen = false;
  private readonly maxFailures = 5;
  private readonly circuitBreakerResetMs = 60000; // 1 minute

  constructor() {
    this.log('🚀 Pipeline initialized');
    this.log('🧪 Debug tag: v2025-08-22.1');
  }

  /**
   * Circuit breaker methods for handling repeated failures
   */
  private recordFailure(): void {
    this.failureCount++;
    this.lastFailureAt = Date.now();

    if (this.failureCount >= this.maxFailures) {
      this.circuitBreakerOpen = true;
      this.log(`🔴 Circuit breaker opened after ${this.failureCount} failures`);
    }
  }

  private recordSuccess(): void {
    if (this.failureCount > 0 || this.circuitBreakerOpen) {
      this.log(`🟢 Circuit breaker reset after success`);
    }
    this.failureCount = 0;
    this.circuitBreakerOpen = false;
  }

  private isCircuitBreakerOpen(): boolean {
    if (!this.circuitBreakerOpen) return false;

    // Auto-reset circuit breaker after timeout
    if (Date.now() - this.lastFailureAt > this.circuitBreakerResetMs) {
      this.log(`🟡 Circuit breaker auto-reset after ${this.circuitBreakerResetMs}ms`);
      this.circuitBreakerOpen = false;
      this.failureCount = 0;
      return false;
    }

    return true;
  }

  /**
   * Initialize Supabase client ONCE - never recreate, only initialize if missing
   */
  public async initialize(force: boolean = false): Promise<void> {
    this.log(`🔄 initialize() called - force=${force} isInitialized=${this.isInitialized} hasClient=${!!this.client} initPromiseActive=${!!this.initializePromise}`);

    // NEVER recreate an existing client - this is the root cause of corruption
    if (this.client && this.isInitialized && !force) {
      this.log('🔄 initialize() early return (client exists and initialized)');
      return;
    }

    if (this.initializePromise) {
      this.log('🔄 initialize() waiting for existing initializePromise');
      await this.initializePromise;
      return;
    }

    this.log('🔄 Initializing Supabase client...');
    const supabaseUrl = import.meta.env.VITE_SUPABASE_URL || '';
    const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY || '';
    if (!supabaseUrl || !supabaseAnonKey) {
      throw new Error('Missing Supabase configuration');
    }
    this.log(`🔄 Supabase env present? url=${!!supabaseUrl} anonKey=${!!supabaseAnonKey}`);

    this.initializePromise = (async () => {
      // NEVER destroy existing client - this causes corruption
      // Only create client if it doesn't exist
      if (!this.client) {
        // Use any type to bypass strict typing issues in newer Supabase versions
        this.client = createClient(supabaseUrl, supabaseAnonKey, {
          auth: {
            persistSession: true,
            autoRefreshToken: true,
            detectSessionInUrl: false,
          },
          realtime: {
            worker: true, // Enable Web Worker heartbeats to prevent background timer throttling
          },
        }) as any;
        this.log('🔄 Supabase client created ONCE (persistSession=true, autoRefreshToken=true)');

        // Bind auth listeners to the permanent client
        try {
          await this.bindAuthListenersToClient();
        } catch (e) {
          this.log('⚠️ Failed to bind auth listeners on init:', e as any);
        }

        // Attach internal auth listener to cache tokens
        try {
          const sub = this.client.auth.onAuthStateChange((_event: AuthChangeEvent, session: any) => {
            try {
              const s = session || {};
              this.lastKnownUserId = s?.user?.id || this.lastKnownUserId || null;
              this.lastKnownAccessToken = s?.access_token || this.lastKnownAccessToken || null;
              this.lastKnownRefreshToken = s?.refresh_token || this.lastKnownRefreshToken || null;
              this.log(`🔑 Token cached: user=${this.lastKnownUserId?.slice(0, 8)} hasAccess=${!!this.lastKnownAccessToken} hasRefresh=${!!this.lastKnownRefreshToken}`);
            } catch {}
          });
          this.internalAuthUnsub = () => { try { sub.data.subscription.unsubscribe(); } catch (_) {} };
        } catch (e) {
          this.log('⚠️ Failed to attach internal auth listener:', e as any);
        }
      } else {
        this.log('🔄 Client already exists, skipping creation');
      }

      this.isInitialized = true;
      this.log('✅ Supabase client initialized successfully (PERMANENT INSTANCE)');
    })().finally(() => { this.initializePromise = null; });

    await this.initializePromise;
  }

  /**
   * Cleanup method for proper resource disposal
   */
  public cleanup(): void {
    this.log('🧹 Cleaning up Supabase pipeline resources');

    // Cleanup internal auth listener
    if (this.internalAuthUnsub) {
      this.internalAuthUnsub();
      this.internalAuthUnsub = null;
      this.log('🧹 Internal auth listener unsubscribed');
    }

    // Clear cached data
    this.cachedSession = null;
    this.inFlightSessionPromise = null;

    // Reset circuit breaker
    this.circuitBreakerOpen = false;
    this.failureCount = 0;

    this.log('✅ Pipeline cleanup completed');
  }

  /**
   * Get the current client instance, initializing if needed
   */
  private async getClient(): Promise<any> {
    this.log(`🔑 getClient() called - hasClient=${!!this.client} isInitialized=${this.isInitialized} initPromiseActive=${!!this.initializePromise}`);
    if (!this.client || !this.isInitialized) { this.log('🔑 getClient() -> calling initialize()'); await this.initialize(); }
    // Less aggressive corruption check - only check every 30 seconds and require multiple failures
    try {
      const now = Date.now();
      if (now - this.lastCorruptionCheckAt > 30000) { // Increased from 10s to 30s
        this.lastCorruptionCheckAt = now;
        const corrupted = await this.isClientCorrupted();
        if (corrupted) {
          // Only recreate if we've had multiple consecutive failures
          if (this.failureCount >= 3) {
            this.log('🧪 getClient(): corruption detected with multiple failures → hard recreate');
            await this.ensureRecreated('getClient-autoheal');
          } else {
            this.log('🧪 getClient(): corruption detected but failure count low, continuing');
          }
        }
      }
    } catch {}
    return this.client!;
  }



  /**
   * Enhanced network state detection with WebView readiness check
   */
  private async checkNetworkAndWebViewState(): Promise<{ isOnline: boolean; isWebViewReady: boolean; networkType?: string }> {
    try {
      // Check navigator.onLine first
      const navigatorOnline = (typeof navigator !== 'undefined' && 'onLine' in navigator) ? (navigator as any).onLine : true;

      // For Capacitor apps, also check Network plugin
      let capacitorNetworkStatus = null;
      if (typeof window !== 'undefined' && (window as any).Capacitor?.isNativePlatform?.()) {
        try {
          const { Network } = await import('@capacitor/network');
          capacitorNetworkStatus = await Network.getStatus();
        } catch (error) {
          this.log('🌐 Failed to get Capacitor network status:', error);
        }
      }

      const isOnline = navigatorOnline && (capacitorNetworkStatus?.connected !== false);
      const networkType = capacitorNetworkStatus?.connectionType || 'unknown';

      // Check WebView readiness by testing if we can access basic DOM/window features
      let isWebViewReady = true;
      try {
        if (typeof window !== 'undefined') {
          // Test basic WebView functionality
          const testDiv = document.createElement('div');
          testDiv.style.display = 'none';
          document.body.appendChild(testDiv);
          document.body.removeChild(testDiv);
        }
      } catch (error) {
        this.log('🌐 WebView readiness check failed:', error);
        isWebViewReady = false;
      }

      this.log(`🌐 Network state: online=${isOnline} webViewReady=${isWebViewReady} type=${networkType}`);
      return { isOnline, isWebViewReady, networkType };
    } catch (error) {
      this.log('🌐 Network state check failed:', error);
      return { isOnline: false, isWebViewReady: false };
    }
  }

  /**
   * Enhanced health check with network state detection
   */
  public async checkHealth(): Promise<boolean> {
    // Enhanced health check with retry logic and better timeout handling
    try {
      // Check circuit breaker first
      if (this.isCircuitBreakerOpen()) {
        this.log('🏥 Health check: circuit breaker open, marking unhealthy');
        return false;
      }

      // Enhanced network and WebView state check
      const networkState = await this.checkNetworkAndWebViewState();
      this.log(`🏥 Health check: starting (online=${networkState.isOnline} webViewReady=${networkState.isWebViewReady})`);

      // Quick network check
      if (!networkState.isOnline) {
        this.log('🏥 Health check: offline');
        return false;
      }

      // WebView readiness check
      if (!networkState.isWebViewReady) {
        this.log('🏥 Health check: WebView not ready');
        return false;
      }

      // Use cached tokens for health check to avoid hanging getSession() calls
      if (this.lastKnownAccessToken) {
        // Check if we have a cached session with expiration info
        if (this.cachedSession?.session?.expires_at) {
          const nowSec = Math.floor(Date.now() / 1000);
          const expiresAt = this.cachedSession.session.expires_at;
          if (expiresAt > 0 && expiresAt - nowSec <= 60) {
            this.log('🏥 Health check: cached session expires soon, needs refresh');
            this.recordFailure();
            return false; // Trigger refresh
          }
        }

        this.log('🏥 Health check: using cached access token (healthy)');
        this.recordSuccess();
        return true;
      }

      // If no cached tokens, check if client exists
      if (this.client && this.isInitialized) {
        this.log('🏥 Health check: client exists but no cached tokens');
        this.recordFailure();
        return false; // Needs authentication
      }

      this.log('🏥 Health check: no client or tokens available');
      this.recordFailure();
      return false;
    } catch (error) {
      // Fail open to reduce unnecessary outbox fallbacks during transient issues
      this.log('🏥 Health check encountered error; assuming healthy:', stringifyError(error));
      this.recordFailure();
      return true;
    }
  }

  /**
   * Use cached tokens to recover session instead of calling getSession()
   */
  public async recoverSession(): Promise<boolean> {
    this.log('🔄 Recovering session using cached tokens...');
    try {
      const client = await this.getClient();

      // Use cached tokens if available
      if (this.lastKnownAccessToken && this.lastKnownRefreshToken) {
        this.log('🔄 Using cached tokens to recover session');

        try {
          // Use setSession with cached tokens instead of getSession(), but bound it with a timeout
          const setSessionPromise = client.auth.setSession({
            access_token: this.lastKnownAccessToken,
            refresh_token: this.lastKnownRefreshToken,
          });
          const timeoutPromise = new Promise<never>((_, reject) =>
            setTimeout(() => reject(new Error('setSession timeout')), 5000)
          );
          let data: any;
          try {
            const result: any = await Promise.race([setSessionPromise, timeoutPromise]);
            data = result?.data;
            if (result?.error) {
              this.log('🔄 Cached token recovery failed:', result.error.message || String(result.error));
              return false;
            }
          } catch (e: any) {
            if (e && e.message === 'setSession timeout') {
              this.log('🔄 Token recovery timed out');
              return false;
            }
            throw e;
          }

          if (data?.session) {
            this.log('✅ Session recovered using cached tokens');
            this.updateSessionCache(data.session);
            return true;
          }
        } catch (error) {
          this.log('🔄 Token recovery error:', stringifyError(error));
        }
      }

      // Fallback: try refresh if we have refresh token
      if (this.lastKnownRefreshToken) {
        this.log('🔄 Attempting token refresh as fallback');
        return await this.refreshSessionDirect();
      }

      this.log('🔄 No cached tokens available for recovery');
      return false;
    } catch (error) {
      this.log('🔄 Session recovery failed:', stringifyError(error));
      return false;
    }
  }

  /**
   * Direct session refresh without pre-checks
   */
  public async refreshSessionDirect(): Promise<boolean> {
    this.log('🔄 Direct session refresh...');
    try {
      const client = await this.getClient();
      // Direct refresh without pre-checks
      const refreshPromise = client.auth.refreshSession();
      const refreshTimeout = new Promise<never>((_, reject) => {
        setTimeout(() => reject(new Error('refreshSession timeout')), 5000);
      });

      let result: any;
      try {
        result = await Promise.race([refreshPromise, refreshTimeout]);
      } catch (err: any) {
        if (err && err.message === 'refreshSession timeout') {
          this.log('🔄 Direct session refresh: timeout');
          return false;
        }
        throw err;
      }

      const success = !!result?.data?.session?.access_token && !result?.error;
      this.log(`🔄 Direct session refresh: ${success ? 'success' : 'failed'}`);

      // Update session cache if successful
      if (success && result?.data?.session) {
        this.updateSessionCache(result.data.session);
      }

      return success;

      return success;
    } catch (error) {
      this.log('🔄 Session refresh failed:', stringifyError(error));
      return false;
    }
  }

  /**
   * Compatibility method - use recoverSession() for new code
   */
  public async refreshSession(): Promise<boolean> {
    this.log('🔄 refreshSession() called - delegating to recoverSession()');
    return await this.recoverSession();
  }

  /**
   * Enhanced corruption check - avoid hanging getSession() and use cached tokens
   */
  public async isClientCorrupted(): Promise<boolean> {
    try {
      if (!this.client) {
        this.log('🧪 Corruption check: no client exists');
        return true;
      }

      if (!this.client.auth) {
        this.log('🧪 Corruption check: client.auth is null');
        return true;
      }

      // If we have cached tokens, try to use them instead of getSession()
      if (this.lastKnownAccessToken && this.lastKnownRefreshToken) {
        try {
          // Test if we can use setSession with cached tokens
          const { data, error } = await this.client.auth.setSession({
            access_token: this.lastKnownAccessToken,
            refresh_token: this.lastKnownRefreshToken
          });

          if (!error && data?.session) {
            this.log('🧪 Corruption check: client is healthy (token recovery successful)');
            return false;
          }
        } catch (tokenError) {
          this.log('🧪 Corruption check: token recovery failed, trying getSession');
        }
      }

      // Fallback to getSession() with timeout, but with longer timeout
      const sessionPromise = this.client.auth.getSession();
      const timeoutPromise = new Promise<never>((_, reject) => {
        setTimeout(() => reject(new Error('getSession timeout')), 5000); // Increased from 1.5s to 5s
      });

      try {
        await Promise.race([sessionPromise, timeoutPromise]);
        this.log('🧪 Corruption check: client is healthy (getSession successful)');
        return false;
      } catch (err: any) {
        if (err.message === 'getSession timeout') {
          this.log('🧪 Corruption check: getSession() is hanging - potential corruption');
          // Don't immediately mark as corrupted, let failure count build up
          return true;
        }
        this.log('🧪 Corruption check: getSession() failed:', err.message);
        // Network errors or auth errors don't necessarily mean corruption
        return false;
      }
    } catch (err: any) {
      this.log('🧪 Corruption check failed:', err.message);
      return false; // Fail safe - don't assume corruption on check failure
    }
  }





  // ============================================================================
  // AUTH OPERATIONS - All authentication should go through these methods
  // ============================================================================

  /**
   * Sign in with OTP (phone)
   */
  public async signInWithOtp(phone: string): Promise<AuthOperationResult> {
    this.log('🔐 Signing in with OTP for phone:', phone.substring(0, 6) + '...');
    
    try {
      const client = await this.getClient();
      const result = await client.auth.signInWithOtp({ phone });
      this.log('🔐 OTP sign in result:', result.error ? 'error' : 'success');
      return result;
    } catch (error) {
      this.log('🔐 OTP sign in failed:', error);
      return { error };
    }
  }

  /**
   * Verify OTP
   */
  public async verifyOtp(phone: string, token: string): Promise<AuthOperationResult> {
    this.log('🔐 Verifying OTP for phone:', phone.substring(0, 6) + '...');
    
    try {
      const client = await this.getClient();
      const result = await client.auth.verifyOtp({ phone, token, type: 'sms' });
      this.log('🔐 OTP verification result:', result.error ? 'error' : 'success');
      return result;
    } catch (error) {
      this.log('🔐 OTP verification failed:', error);
      return { error };
    }
  }

  /**
   * Sign out user
   */
  public async signOut(): Promise<AuthOperationResult> {
    this.log('🔐 Signing out user');
    
    try {
      const client = await this.getClient();
      const result = await client.auth.signOut();
      this.log('🔐 Sign out result:', result.error ? 'error' : 'success');
      return result;
    } catch (error) {
      this.log('🔐 Sign out failed:', error);
      return { error };
    }
  }

  /**
   * Get current user
   */
  public async getUser(): Promise<AuthOperationResult> {
    try {
      const client = await this.getClient();
      const result = await client.auth.getUser();
      return result;
    } catch (error) {
      this.log('🔐 Get user failed:', error);
      return { error };
    }
  }

  /**
   * Get current session with deduplication and caching
   */
  public async getSession(): Promise<AuthOperationResult> {
    // Check if we have a valid cached session
    const now = Date.now();
    if (this.cachedSession && (now - this.cachedSession.timestamp) < this.sessionCacheValidityMs) {
      this.log('🔐 Returning cached session');
      return { data: { session: this.cachedSession.session } };
    }

    // If there's already an in-flight session request, wait for it
    if (this.inFlightSessionPromise) {
      this.log('🔐 Waiting for in-flight session request');
      return await this.inFlightSessionPromise;
    }

    // Create new session request
    this.inFlightSessionPromise = this.fetchSessionInternal();

    try {
      const result = await this.inFlightSessionPromise;
      return result;
    } finally {
      this.inFlightSessionPromise = null;
    }
  }

  /**
   * Enhanced session fetching with recovery fallback to avoid hanging getSession()
   */
  private async fetchSessionInternal(): Promise<AuthOperationResult> {
    try {
      // First, try to recover using cached tokens if available
      if (this.lastKnownAccessToken && this.lastKnownRefreshToken) {
        this.log('🔐 Attempting session recovery using cached tokens');
        const recoveryResult = await this.attemptTokenRecovery();
        if (recoveryResult.success) {
          return { data: { session: recoveryResult.session } };
        }
      }

      // If token recovery failed or no cached tokens, try getSession with timeout
      this.log('🔐 Fetching fresh session from Supabase');
      const client = await this.getClient();

      // Add timeout protection to prevent hanging
      const sessionPromise = client.auth.getSession();
      const timeoutPromise = new Promise<never>((_, reject) => {
        setTimeout(() => reject(new Error('Session fetch timeout')), 3000);
      });

      const result = await Promise.race([sessionPromise, timeoutPromise]);

      try {
        const s = result?.data?.session || null;
        this.lastKnownUserId = s?.user?.id || this.lastKnownUserId || null;
        this.lastKnownAccessToken = s?.access_token || this.lastKnownAccessToken || null;
        this.lastKnownRefreshToken = s?.refresh_token || this.lastKnownRefreshToken || null;

        // Update cache only if we got a valid session
        if (s) {
          this.cachedSession = {
            session: s,
            timestamp: Date.now()
          };
        }
      } catch (cacheError) {
        this.log('⚠️ Failed to cache session:', cacheError);
      }

      return result;
    } catch (error: any) {
      this.log('🔐 Get session failed:', error?.message || error);

      // If we have a cached session and this is just a timeout, return cached
      if (error?.message === 'Session fetch timeout' && this.cachedSession) {
        this.log('🔐 Session fetch timed out, using cached session as fallback');
        return { data: { session: this.cachedSession.session } };
      }

      // Last resort: try to construct session from cached tokens
      if (this.lastKnownAccessToken && this.lastKnownUserId) {
        this.log('🔐 Using last known tokens as final fallback');
        const fallbackSession = {
          access_token: this.lastKnownAccessToken,
          refresh_token: this.lastKnownRefreshToken,
          user: { id: this.lastKnownUserId },
          expires_at: Math.floor(Date.now() / 1000) + 3600 // 1 hour from now
        };
        return { data: { session: fallbackSession } };
      }

      return { error };
    }
  }

  /**
   * Attempt to recover session using cached tokens with setSession
   */
  private async attemptTokenRecovery(): Promise<{ success: boolean; session?: any }> {
    try {
      const client = await this.getClient();

      const { data, error } = await client.auth.setSession({
        access_token: this.lastKnownAccessToken!,
        refresh_token: this.lastKnownRefreshToken!
      });

      if (error) {
        this.log('🔐 Token recovery failed:', error.message);
        return { success: false };
      }

      if (data?.session) {
        this.log('🔐 Session recovered successfully using cached tokens');
        // Update cache and tokens
        const s = data.session;
        this.lastKnownUserId = s?.user?.id || this.lastKnownUserId || null;
        this.lastKnownAccessToken = s?.access_token || this.lastKnownAccessToken || null;
        this.lastKnownRefreshToken = s?.refresh_token || this.lastKnownRefreshToken || null;

        this.cachedSession = {
          session: s,
          timestamp: Date.now()
        };

        return { success: true, session: s };
      }

      return { success: false };
    } catch (error) {
      this.log('🔐 Token recovery error:', stringifyError(error));
      return { success: false };
    }
  }

  /**
   * Update session cache with new session
   */
  private updateSessionCache(session: any): void {
    this.cachedSession = {
      session,
      timestamp: Date.now()
    };
    this.log('🔐 Session cache updated');
  }

  /**
   * Invalidate session cache - call this when we know session has changed
   */
  private invalidateSessionCache(): void {
    this.log('🔐 Invalidating session cache');
    this.cachedSession = null;
    this.inFlightSessionPromise = null;
  }

  /**
   * Safely convert a timestamp to a valid number, with fallback to current time
   */
  public static safeTimestamp(timestamp: any): number {
    if (!timestamp) return Date.now();
    const parsed = new Date(timestamp).getTime();
    return Number.isFinite(parsed) ? parsed : Date.now();
  }

  /**
   * Get a working session, with fallback to cached session if fresh fetch fails
   */
  public async getWorkingSession(): Promise<any> {
    try {
      const result = await this.getSession();
      const session = result?.data?.session;

      if (session?.access_token) {
        return session;
      }

      // If no valid session from fresh fetch, try cached
      if (this.cachedSession?.session?.access_token) {
        this.log('🔐 Using cached session as fallback');
        return this.cachedSession.session;
      }

      // Last resort: use last known tokens
      if (this.lastKnownAccessToken) {
        this.log('🔐 Using last known tokens as fallback');
        return {
          access_token: this.lastKnownAccessToken,
          refresh_token: this.lastKnownRefreshToken,
          user: { id: this.lastKnownUserId }
        };
      }

      return null;
    } catch (error) {
      this.log('🔐 getWorkingSession failed:', error);

      // Return cached session if available
      if (this.cachedSession?.session?.access_token) {
        this.log('🔐 Returning cached session after error');
        return this.cachedSession.session;
      }

      return null;
    }
  }

  /**
   * Listen to auth state changes
   */
  public async onAuthStateChange(callback: (event: string, session: any) => void): Promise<{ data: { subscription: any } }> {
    try {
      const id = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
      // Create registry record first
      const record = { id, callback, unsubscribe: undefined as undefined | (() => void) };
      this.authListeners.push(record);

      // Bind immediately on current client
      let client: SupabaseClient<Database>;
      try { client = await this.getClient(); } catch (e) { this.log('🔐 Fetch client for listener failed (will bind later):', e as any); }
      try {
        const sub = client!.auth.onAuthStateChange(callback);
        record.unsubscribe = () => { try { sub.data.subscription.unsubscribe(); } catch (_) {} };
      } catch (e) {
        this.log('🔐 Immediate bind of auth listener failed (will bind on next init):', e as any);
      }

      // Return a wrapper subscription that removes from registry and unsubscribes current binding
      const subscription = {
        unsubscribe: () => {
          try { record.unsubscribe?.(); } catch (_) {}
          this.authListeners = this.authListeners.filter(l => l.id !== id);
        }
      };
      return Promise.resolve({ data: { subscription } });
    } catch (error) {
      this.log('🔐 Auth state change listener failed:', error);
      throw error;
    }
  }

  // ============================================================================
  // DATABASE OPERATIONS - All database queries should go through these methods
  // ============================================================================

  /**
   * Generic database query with timeout and error handling
   */
  private async executeQuery<T>(
    queryBuilder: () => Promise<{ data: T; error: any }>,
    operation: string,
    timeoutMs: number = this.config.sendTimeoutMs
  ): Promise<{ data: T | null; error: any }> {
    this.log(`🗄️ Executing ${operation}...`);
    
    try {
      const timeoutPromise = new Promise<never>((_, reject) => {
        setTimeout(() => reject(new Error(`${operation} timeout after ${timeoutMs}ms`)), timeoutMs);
      });

      const result = await Promise.race([queryBuilder(), timeoutPromise]);
      
      if (result.error) {
        this.log(`🗄️ ${operation} error:`, stringifyError(result.error));
        return { data: null, error: result.error };
      }
      
      this.log(`🗄️ ${operation} success`);
      return result;
    } catch (error) {
      this.log(`🗄️ ${operation} failed:`, stringifyError(error));
      return { data: null, error };
    }
  }

  /**
   * Fetch user groups
   */
  public async fetchGroups(): Promise<{ data: any[] | null; error: any }> {
    return this.executeQuery(async () => {
      const client = await this.getClient();
      return client
        .from('groups')
        .select(`
          *,
          group_members!inner(user_id)
        `)
        .order('created_at', { ascending: false });
    }, 'fetch groups');
  }

  /**
   * Create new group
   */
  public async createGroup(groupData: GroupInsertData): Promise<{ data: any | null; error: any }> {
    return this.executeQuery(async () => {
      const client = await this.getClient();
      return client
        .from('groups')
        .insert(groupData)
        .select()
        .single();
    }, 'create group');
  }

  /**
   * Join group by invite code
   */
  public async joinGroup(inviteCode: string, userId: string): Promise<{ data: any | null; error: any }> {
    return this.executeQuery(async () => {
      const client = await this.getClient();
      
      // First find the group
      const { data: group, error: groupError } = await client
        .from('groups')
        .select('id')
        .eq('invite_code', inviteCode)
        .single();
        
      if (groupError) return { data: null, error: groupError };
      
      // Then add user as member
      const { error: memberError } = await client
        .from('group_members')
        .insert({
          group_id: group.id,
          user_id: userId,
          role: 'participant'
        });
        
      if (memberError) return { data: null, error: memberError };
      
      // Return the group data
      return client
        .from('groups')
        .select('*')
        .eq('id', group.id)
        .single();
    }, 'join group');
  }

  /**
   * Fetch messages for a group
   */
  public async fetchMessages(groupId: string, limit: number = 50): Promise<{ data: any[] | null; error: any }> {
    return this.executeQuery(async () => {
      const client = await this.getClient();
      return client
        .from('messages')
        .select(`
          *,
          reactions(*),
          users!messages_user_id_fkey(display_name, avatar_url, created_at)
        `)
        .eq('group_id', groupId)
        .order('created_at', { ascending: false })
        .limit(limit);
    }, 'fetch messages');
  }

  /**
   * Fetch message by ID
   */
  public async fetchMessageById(messageId: string): Promise<{ data: any | null; error: any }> {
    return this.executeQuery(async () => {
      const client = await this.getClient();
      return client
        .from('messages')
        .select(`
          *,
          reactions(*),
          users!messages_user_id_fkey(display_name, avatar_url, created_at)
        `)
        .eq('id', messageId)
        .single();
    }, 'fetch message by ID');
  }

  /**
   * Fetch replies for a message
   */
  public async fetchReplies(parentMessageId: string): Promise<{ data: any[] | null; error: any }> {
    return this.executeQuery(async () => {
      const client = await this.getClient();
      return client
        .from('messages')
        .select(`
          *,
          reactions(*),
          users!messages_user_id_fkey(display_name, avatar_url, created_at)
        `)
        .eq('parent_id', parentMessageId)
        .order('created_at', { ascending: true });
    }, 'fetch replies');
  }

  /**
   * Fetch group members
   */
  public async fetchGroupMembers(groupId: string): Promise<{ data: any[] | null; error: any }> {
    return this.executeQuery(async () => {
      const client = await this.getClient();
      return client
        .from('group_members')
        .select(`
          *,
          users!group_members_user_id_fkey(*)
        `)
        .eq('group_id', groupId);
    }, 'fetch group members');
  }

  /**
   * Fetch group media
   */
  public async fetchGroupMedia(groupId: string): Promise<{ data: any[] | null; error: any }> {
    return this.executeQuery(async () => {
      const client = await this.getClient();
      return client
        .from('group_media')
        .select(`
          *,
          users!group_media_user_id_fkey(display_name, avatar_url)
        `)
        .eq('group_id', groupId)
        .order('uploaded_at', { ascending: false });
    }, 'fetch group media');
  }

  /**
   * Fetch polls for a group
   */
  public async fetchPolls(groupId: string): Promise<{ data: any[] | null; error: any }> {
    return this.executeQuery(async () => {
      const client = await this.getClient();
      return client
        .from('polls')
        .select(`
          *,
          messages!polls_message_id_fkey(group_id)
        `)
        .eq('messages.group_id', groupId);
    }, 'fetch polls');
  }

  /**
   * Create poll
   */
  public async createPoll(pollData: {
    message_id: string;
    question: string;
    options: string[];
    closes_at: string;
  }): Promise<{ data: any | null; error: any }> {
    return this.executeQuery(async () => {
      const client = await this.getClient();
      return client
        .from('polls')
        .insert(pollData)
        .select()
        .single();
    }, 'create poll');
  }

  /**
   * Vote on poll
   */
  public async votePoll(pollId: string, userId: string, optionIndex: number): Promise<{ data: any | null; error: any }> {
    return this.executeQuery(async () => {
      const client = await this.getClient();
      return client
        .from('poll_votes')
        .upsert({
          poll_id: pollId,
          user_id: userId,
          option_index: optionIndex
        }, { onConflict: 'poll_id,user_id' })
        .select()
        .single();
    }, 'vote poll');
  }

  /**
   * Add reaction to message
   */
  public async addReaction(messageId: string, userId: string, emoji: string): Promise<{ data: any | null; error: any }> {
    return this.executeQuery(async () => {
      const client = await this.getClient();
      return client
        .from('reactions')
        .upsert({
          message_id: messageId,
          user_id: userId,
          emoji: emoji
        }, { onConflict: 'message_id,user_id,emoji' })
        .select()
        .single();
    }, 'add reaction');
  }

  /**
   * Remove reaction from message
   */
  public async removeReaction(messageId: string, userId: string, emoji: string): Promise<{ data: any | null; error: any }> {
    return this.executeQuery(async () => {
      const client = await this.getClient();
      return client
        .from('reactions')
        .delete()
        .eq('message_id', messageId)
        .eq('user_id', userId)
        .eq('emoji', emoji);
    }, 'remove reaction');
  }

  /**
   * Update user profile
   */
  public async updateUser(userId: string, updates: Database['public']['Tables']['users']['Update']): Promise<{ data: any | null; error: any }> {
    return this.executeQuery(async () => {
      const client = await this.getClient();
      return client
        .from('users')
        .update(updates)
        .eq('id', userId)
        .select()
        .single();
    }, 'update user');
  }

  /**
   * Upsert user device token
   */
  public async upsertDeviceToken(tokenData: {
    user_id: string;
    platform: string;
    token: string;
    app_version: string;
    active: boolean;
    last_seen_at: string;
  }): Promise<{ data: any | null; error: any }> {
    return this.executeQuery(async () => {
      const client = await this.getClient();
      return client
        .from('user_devices')
        .upsert(tokenData, { onConflict: 'token' });
    }, 'upsert device token');
  }

  /**
   * Deactivate device token
   */
  public async deactivateDeviceToken(token: string): Promise<{ data: any | null; error: any }> {
    return this.executeQuery(async () => {
      const client = await this.getClient();
      return client
        .from('user_devices')
        .update({ active: false })
        .eq('token', token);
    }, 'deactivate device token');
  }

  /**
   * Upload file to storage
   */
  public async uploadFile(
    bucket: string, 
    path: string, 
    file: File | Blob, 
    options?: any
  ): Promise<{ data: any | null; error: any }> {
    this.log(`📁 Uploading file to ${bucket}/${path}...`);
    
    try {
      const client = await this.getClient();
      const result = await client.storage
        .from(bucket)
        .upload(path, file, options);
      
      if (result.error) {
        this.log('📁 File upload error:', result.error);
        return { data: null, error: result.error };
      }
      
      this.log('📁 File upload success');
      return result;
    } catch (error) {
      this.log('📁 File upload failed:', error);
      return { data: null, error };
    }
  }

  /**
   * Get public URL for file
   */
  public async getPublicUrl(bucket: string, path: string): Promise<{ data: { publicUrl: string } }> {
    try {
      const client = await this.getClient();
      return client.storage.from(bucket).getPublicUrl(path);
    } catch (error) {
      this.log('📁 Get public URL failed:', error);
      throw error;
    }
  }



  /**
   * Call RPC function
   */
  public async rpc<T>(functionName: string, params?: any): Promise<{ data: T | null; error: any }> {
    return this.executeQuery(async () => {
      const client = await this.getClient();
      return client.rpc(functionName, params);
    }, `RPC ${functionName}`);
  }

  /**
   * Create realtime channel
   */
  public async createChannel(channelName: string, config?: any): Promise<any> {
    try {
      const client = await this.getClient();
      return client.channel(channelName, config);
    } catch (error) {
      this.log('📡 Create channel failed:', error);
      throw error;
    }
  }

  /**
   * Remove realtime channel
   */
  public async removeChannel(channel: any): Promise<void> {
    try {
      const client = await this.getClient();
      client.removeChannel(channel);
    } catch (error) {
      this.log('📡 Remove channel failed:', error);
      throw error;
    }
  }



  /**
   * Send message with simplified direct send → fallback to outbox pipeline
   */
  public async sendMessage(message: Message): Promise<void> {
    this.log(`📤 Sending message ${message.id}...`);
    const dbgLabel = `send-${message.id}`;
    try { console.time?.(`[${dbgLabel}] total`); } catch {}
    this.log(`[${dbgLabel}] input: group=${message.group_id?.slice(0,8)} user=${message.user_id?.slice(0,8)} ghost=${!!message.is_ghost} type=${message.message_type} dedupe=${!!message.dedupe_key}`);
    
    try {
      await this.sendMessageInternal(message);
      this.log(`✅ Message ${message.id} sent successfully`);
      // Fire-and-forget: fan out push notification (best-effort)
      try {
        const client = await this.getClient();
        const createdAt = new Date().toISOString();
        await fetch(`${(client as any).supabaseUrl || ''}/functions/v1/push-fanout`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${(await client.auth.getSession()).data.session?.access_token || ''}`,
          },
          body: JSON.stringify({
            message_id: message.id,
            group_id: message.group_id,
            sender_id: message.user_id,
            created_at: createdAt,
          }),
        }).catch(() => {});
      } catch {}
    } catch (error) {
      if ((error as any)?.code === 'QUEUED_OUTBOX' || (error as any)?.name === 'MessageQueuedError') {
        this.log(`📦 Message ${message.id} queued to outbox`);
      } else {
        this.log(`❌ Message ${message.id} send failed:`, stringifyError(error));
      }
      throw error;
    } finally {
      try { console.timeEnd?.(`[${dbgLabel}] total`); } catch {}
      this.log(`[${dbgLabel}] finished`);
    }
  }

  /**
   * Internal message sending logic - simplified approach
   */
  private async sendMessageInternal(message: Message): Promise<void> {
    // Do not gate sends after unlock; proceed directly

    // Check health before attempting direct send
    const dbgLabel = `send-${message.id}`;
    this.log(`[${dbgLabel}] checkHealth() -> start`);
    const isHealthy = await this.checkHealth();
    this.log(`[${dbgLabel}] checkHealth() -> ${isHealthy ? 'healthy' : 'unhealthy'}`);
    if (!isHealthy) {
      this.log(`📤 Client unhealthy, falling back to outbox - message ${message.id}`);
      await this.fallbackToOutbox(message);
      const queuedError: any = new Error(`Message ${message.id} queued to outbox (unhealthy client)`);
      queuedError.code = 'QUEUED_OUTBOX';
      queuedError.name = 'MessageQueuedError';
      throw queuedError;
    }

    // Attempt direct send with retries
    let lastError: any = null;
    for (let attempt = 1; attempt <= this.config.maxRetries; attempt++) {
      try {
        this.log(`📤 Direct send attempt ${attempt}/${this.config.maxRetries} - message ${message.id}`);
        try { console.time?.(`[${dbgLabel}] attempt-${attempt}`); } catch {}
        
        const client = await this.getClient();
        
        const timeoutPromise = new Promise<never>((_, reject) => {
          setTimeout(() => reject(new Error(`Direct send timeout after ${this.config.sendTimeoutMs}ms`)), this.config.sendTimeoutMs);
        });

        const sendPromise = client
          .from('messages')
          .upsert({
            group_id: message.group_id,
            user_id: message.user_id,
            content: message.content,
            is_ghost: message.is_ghost,
            message_type: message.message_type,
            category: message.category,
            parent_id: message.parent_id,
            image_url: message.image_url,
            dedupe_key: message.dedupe_key,
          }, { onConflict: 'dedupe_key' })
          .select(`
            *,
            reactions(*),
            users!messages_user_id_fkey(display_name, avatar_url)
          `)
          .single();

        this.log(`[${dbgLabel}] attempt ${attempt} -> awaiting Supabase upsert...`);
        const { error } = await Promise.race([sendPromise, timeoutPromise]);

        if (error) {
          throw error;
        }

        this.log(`✅ Direct send successful - message ${message.id}`);
        try { console.timeEnd?.(`[${dbgLabel}] attempt-${attempt}`); } catch {}
        return; // Success!
      } catch (error) {
        lastError = error;
        this.log(`❌ Direct send attempt ${attempt} failed - message ${message.id}:`, stringifyError(error));
        try { console.timeEnd?.(`[${dbgLabel}] attempt-${attempt}`); } catch {}
        // If direct send timed out, only recreate after multiple consecutive timeouts
        try {
          const msg = (error as any)?.message || '';
          if (typeof msg === 'string' && msg.includes('Direct send timeout')) {
            // Only recreate client after 3 consecutive timeout failures to avoid excessive recreation
            if (this.failureCount >= 3) {
              this.log('🧹 Multiple timeout failures detected, scheduling client recreation');
              this.ensureRecreated('multiple-direct-send-timeouts').catch(() => {});
            } else {
              this.log('🕐 Timeout occurred but not recreating client yet (failure count: ' + this.failureCount + ')');
            }
          }
        } catch {}
        
        if (attempt < this.config.maxRetries) {
          this.log(`⏳ Waiting ${this.config.retryBackoffMs}ms before retry...`);
          await new Promise(resolve => setTimeout(resolve, this.config.retryBackoffMs));
        }
      }
    }

    // All direct send attempts failed, fallback to outbox
    this.log(`📤 All direct send attempts failed for ${message.id}, falling back to outbox. Last error:`, stringifyError(lastError));
    await this.fallbackToOutbox(message);
    const queuedError: any = new Error(`Message ${message.id} queued to outbox after direct send failures`);
    queuedError.code = 'QUEUED_OUTBOX';
    queuedError.name = 'MessageQueuedError';
    throw queuedError;
  }

  /**
   * Fallback to outbox for later processing
   */
  private async fallbackToOutbox(message: Message): Promise<void> {
    try {
      const isNative = Capacitor.isNativePlatform();
      const ready = isNative && await sqliteService.isReady();
      const dbgLabel = `send-${message.id}`;
      this.log(`[${dbgLabel}] fallbackToOutbox(): isNative=${isNative} sqliteReady=${ready}`);
      
      if (!ready) {
        throw new Error('SQLite not ready for outbox storage');
      }

      // Store message in outbox with all original data
      await sqliteService.addToOutbox({
        group_id: message.group_id,
        user_id: message.user_id,
        content: JSON.stringify({
          id: message.id, // Store original message ID in content
          content: message.content,
          is_ghost: message.is_ghost,
          message_type: message.message_type,
          category: message.category,
          parent_id: message.parent_id,
          image_url: message.image_url,
          dedupe_key: message.dedupe_key,
        }),
        retry_count: 0,
        next_retry_at: Date.now(), // Immediate retry
      });

      this.log(`📦 Message ${message.id} stored in outbox`);
      
      // Trigger outbox processing immediately
      this.triggerOutboxProcessing('pipeline-fallback');
    } catch (error) {
      this.log(`❌ Outbox fallback failed for message ${message.id}:`, stringifyError(error));
      throw error;
    }
  }

  /**
   * Process outbox messages with retries - simplified and more reliable
   */
  public async processOutbox(): Promise<void> {
    // Single-flight guard and debounce
    if (this.isOutboxProcessing) {
      this.log('📦 Outbox processing already in progress; skipping');
      return;
    }
    const now = Date.now();
    if (now - this.lastOutboxStartAt < 1500) {
      this.log('📦 Outbox processing debounced; too soon since last start');
      return;
    }
    this.isOutboxProcessing = true;
    this.lastOutboxStartAt = now;
    const sessionId = `outbox-${Date.now()}`;
    this.log(`📦 Starting outbox processing - session ${sessionId}`);

    try {
      const isNative = Capacitor.isNativePlatform();
      const ready = isNative && await sqliteService.isReady();
      this.log(`📦 Outbox pre-check: isNative=${isNative} sqliteReady=${ready}`);
      
      if (!ready) {
        this.log('📦 SQLite not ready, skipping outbox processing');
        return;
      }

      const outboxMessages = await sqliteService.getOutboxMessages();
      if (outboxMessages.length === 0) {
        this.log('📦 No outbox messages to process');
        return;
      }

      this.log(`📦 Processing ${outboxMessages.length} outbox messages`);

      // Check health before processing, but implement graceful degradation
      const isHealthy = await this.checkHealth();
      if (!isHealthy) {
        // If circuit breaker is open, skip processing to avoid further failures
        if (this.isCircuitBreakerOpen()) {
          this.log('📦 Circuit breaker open, skipping outbox processing');
          return;
        }

        // If client is unhealthy but circuit breaker is not open, try limited processing
        this.log('⚠️ 📦 Client unhealthy, attempting limited outbox processing');

        // Try to process only a few messages to avoid overwhelming the system
        const limitedMessages = outboxMessages.slice(0, 3);
        this.log(`📦 Processing ${limitedMessages.length} messages in degraded mode`);

        for (const outboxItem of limitedMessages) {
          try {
            const messageData = JSON.parse(outboxItem.content);
            // Try a simple send with reasonable timeout for mobile networks
            const timeoutPromise = new Promise<never>((_, reject) => {
              setTimeout(() => reject(new Error('Degraded mode timeout')), 8000);
            });

            const client = await this.getClient();
            const sendPromise = client.from('messages').insert(messageData);
            await Promise.race([sendPromise, timeoutPromise]);

            // Success - remove from outbox (guard undefined id)
            if (outboxItem.id !== undefined) {
              await sqliteService.removeFromOutbox(outboxItem.id);
              this.log(`📦 Degraded mode: successfully sent message ${outboxItem.id}`);
            } else {
              this.log('📦 Degraded mode: sent message but outbox id was undefined; skip removal');
            }
          } catch (error) {
            this.log(`📦 Degraded mode: failed to send message ${outboxItem.id}:`, error);
            // Don't retry in degraded mode, just continue
          }
        }
        return;
      }

      const client = await this.getClient();

      // Track per-run statistics for callers
      let sentCount = 0;
      let failedCount = 0; // permanently failed and removed
      let retriedCount = 0; // scheduled for retry
      const groupsWithSent = new Set<string>();

      for (let i = 0; i < outboxMessages.length; i++) {
        const outboxItem = outboxMessages[i];
        this.log(`📦 Processing outbox message ${i + 1}/${outboxMessages.length} (ID: ${outboxItem.id})`);

        try {
          const messageData = JSON.parse(outboxItem.content);

          // Send to Supabase with simpler timeout
          const timeoutPromise = new Promise<never>((_, reject) => {
            setTimeout(() => reject(new Error(`Outbox send timeout after ${this.config.sendTimeoutMs}ms`)), this.config.sendTimeoutMs);
          });

          const insertPromise = client
            .from('messages')
            .upsert({
              group_id: outboxItem.group_id,
              user_id: outboxItem.user_id,
              content: messageData.content,
              is_ghost: messageData.is_ghost,
              message_type: messageData.message_type,
              category: messageData.category,
              parent_id: messageData.parent_id,
              image_url: messageData.image_url,
              dedupe_key: messageData.dedupe_key,
            }, { onConflict: 'dedupe_key' })
            .select(`
              *,
              reactions(*),
              users!messages_user_id_fkey(display_name, avatar_url)
            `)
            .single();

          const { error } = await Promise.race([insertPromise, timeoutPromise]);

          if (error) {
            throw error;
          }

          // Success - remove from outbox
          if (outboxItem.id !== undefined) {
            await sqliteService.removeFromOutbox(outboxItem.id);
            this.log(`✅ Outbox message ${outboxItem.id} sent and removed`);
          }
          sentCount++;
          if (outboxItem.group_id) {
            groupsWithSent.add(outboxItem.group_id);
          }

          // Fire-and-forget: fan out push notification for outbox item
          try {
            const client = await this.getClient();
            await fetch(`${(client as any).supabaseUrl || ''}/functions/v1/push-fanout`, {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${(await client.auth.getSession()).data.session?.access_token || ''}`,
              },
              body: JSON.stringify({
                message_id: (JSON.parse(outboxItem.content) || {}).id || outboxItem.id,
                group_id: outboxItem.group_id,
                sender_id: outboxItem.user_id,
                created_at: new Date().toISOString(),
              }),
            }).catch(() => {});
          } catch {}

        } catch (error) {
          this.log(`❌ Outbox message ${outboxItem.id} failed:`, stringifyError(error));
          
          if (outboxItem.id !== undefined) {
            // Update retry count and schedule next retry
            const newRetryCount = (outboxItem.retry_count || 0) + 1;
            const maxRetries = 5;
            
            if (newRetryCount >= maxRetries) {
              this.log(`🗑️ Outbox message ${outboxItem.id} exceeded max retries, removing`);
              await sqliteService.removeFromOutbox(outboxItem.id);
              failedCount++;
            } else {
              const backoffMs = Math.min(newRetryCount * 30000, 300000); // 30s to 5min max
              const nextRetryAt = Date.now() + backoffMs;
              
              await sqliteService.updateOutboxRetry(outboxItem.id, newRetryCount, nextRetryAt);
              this.log(`⏰ Outbox message ${outboxItem.id} scheduled for retry ${newRetryCount}/${maxRetries} in ${backoffMs}ms`);
              retriedCount++;
            }
          }
        }
      }

      this.log(`📦 Outbox processing complete - session ${sessionId}`);
      // Expose statistics for callers
      this.lastOutboxStats = {
        sent: sentCount,
        failed: failedCount,
        retried: retriedCount,
        groupsWithSent: Array.from(groupsWithSent)
      };
    } catch (error) {
      this.log(`❌ Outbox processing failed - session ${sessionId}:`, stringifyError(error));
      throw error;
    } finally {
      this.isOutboxProcessing = false;
    }
  }

  /**
   * Trigger outbox processing externally
   */
  private triggerOutboxProcessing(context: string): void {
    const now = Date.now();
    if (now - this.lastOutboxTriggerAt < 1000) {
      this.log(`📦 Trigger suppressed (debounced) from: ${context}`);
      return;
    }
    this.lastOutboxTriggerAt = now;
    this.log(`📦 Triggering outbox processing from: ${context}`);

    // Use dynamic import to avoid circular dependencies
    import('../store/chatstore_refactored/offlineActions').then(({ triggerOutboxProcessing }) => {
      this.log('📦 triggerOutboxProcessing(): dynamic import succeeded');
      triggerOutboxProcessing(context, 'high');
    }).catch(error => {
      this.log(`❌ Failed to trigger outbox processing:`, stringifyError(error));
    });
  }

  /**
   * Reset connection - recreate client and refresh session
   */
  public async resetConnection(): Promise<void> {
    // Non-destructive reset: keep existing client and simply ensure session
    this.log('🔄 Resetting connection (non-destructive)...');
    try {
      await this.initialize(false);
      await this.recoverSession();
      this.log('✅ Connection reset complete');
    } catch (error) {
      this.log('❌ Connection reset failed:', stringifyError(error));
      throw error;
    }
  }

  /**
   * Hard client recreation: tear down realtime, drop old client, recreate, rebind listeners, preserve session.
   * Only use this as a last resort when the client is truly corrupted.
   */
  public async hardRecreateClient(reason: string = 'unknown'): Promise<void> {
    this.log(`🧹 Hard recreating Supabase client (reason=${reason})`);

    // Prevent multiple concurrent recreations
    if (this.recreatePromise) {
      this.log('🧹 Hard recreate: waiting for existing recreation');
      return await this.recreatePromise;
    }

    this.recreatePromise = (async () => {
      try {
        if (this.client) {
          try { await this.client.removeAllChannels(); } catch (_) {}
          try { (this.client as any)?.realtime?.removeAllChannels?.(); } catch (_) {}
          try { (this.client as any)?.realtime?.disconnect?.(); } catch (_) {}
        }

        // Drop reference and flags before recreate
        this.client = null;
        this.isInitialized = false;

        // Invalidate session cache since we're recreating the client
        this.invalidateSessionCache();

        // Wait a moment to let things settle
        await new Promise(resolve => setTimeout(resolve, 100));

        await this.initialize(true);

        // Validate that the new client is properly initialized
        const client = await this.getClient();
        if (!client) {
          throw new Error('Client recreation failed - no client after initialize');
        }

        // Validate that we can get a session
        let session: any = null;
        try {
          session = await this.getWorkingSession();
          if (!session?.access_token) {
            this.log('⚠️ Hard recreate: no valid session after recreation, attempting refresh');
            const refreshed = await this.recoverSession();
            if (refreshed) {
              session = await this.getWorkingSession();
            }
          }
        } catch (error) {
          this.log('⚠️ Hard recreate: session validation failed:', error);
        }

        // Apply token to realtime if available
        if (session?.access_token && client.realtime) {
          try {
            client.realtime.setAuth(session.access_token);
            this.log('✅ Hard recreate: token applied to realtime');
          } catch (error) {
            this.log('⚠️ Hard recreate: failed to apply token to realtime:', error);
          }
        } else {
          this.log('⚠️ Hard recreate: no valid session or realtime client for token application');
        }

        // Validate client health before proceeding
        try {
          const isHealthy = await this.checkHealth();
          if (!isHealthy) {
            this.log('⚠️ Hard recreate: client still unhealthy after recreation');
          } else {
            this.log('✅ Hard recreate: client health validated');
          }
        } catch (error) {
          this.log('⚠️ Hard recreate: health check failed:', error);
        }

        // Nudge realtime store to reconnect active group if any
        try {
          const mod = await import('@/store/chatstore_refactored');
          const state = (mod as any).useChatStore?.getState?.();
          const gid = state?.activeGroup?.id;
          if (gid && typeof state?.forceReconnect === 'function') {
            setTimeout(() => {
              try {
                state.forceReconnect(gid);
              } catch (error) {
                this.log('⚠️ Hard recreate: realtime reconnect failed:', error);
              }
            }, 300);
          }
        } catch (error) {
          this.log('⚠️ Hard recreate: failed to trigger realtime reconnect:', error);
        }

        this.log('✅ Hard recreation complete');
      } catch (error) {
        this.log('❌ Hard recreation failed:', stringifyError(error));

        // Recovery mechanism: try a simpler initialization
        try {
          this.log('🔄 Attempting recovery with simple initialization');
          this.client = null;
          this.isInitialized = false;
          await this.initialize(false);
          this.log('✅ Recovery initialization succeeded');
        } catch (recoveryError) {
          this.log('❌ Recovery initialization also failed:', stringifyError(recoveryError));
        }

        throw error;
      } finally {
        this.recreatePromise = null;
      }
    })();

    return await this.recreatePromise;
  }

  // Removed validateWebViewState - not needed with simplified resume flow

  /**
   * Simplified app resume handler - focus on session recovery without client recreation
   */
  public async onAppResume(): Promise<void> {
    this.log('📱 App resume detected - checking session state');

    try {
      // Quick session recovery using cached tokens
      const recovered = await this.recoverSession();

      if (recovered) {
        this.log('✅ App resume: session recovered using cached tokens');
      } else {
        this.log('⚠️ App resume: token recovery failed, session may need refresh');
        // Don't force refresh here - let the realtime connection handle it
      }

      // Apply current token to realtime if available
      try {
        const client = await this.getClient();
        const token = this.lastKnownAccessToken;
        if (token && (client as any)?.realtime?.setAuth) {
          (client as any).realtime.setAuth(token);
          this.log('✅ App resume: token applied to realtime');
        }
      } catch (e) {
        this.log('⚠️ App resume: failed to apply token to realtime:', stringifyError(e));
      }

      this.log('✅ App resume completed using token recovery strategy');
    } catch (error) {
      this.log('❌ App resume failed:', stringifyError(error));
    }
  }







  /**
   * Handle network reconnection events - simplified approach
   */
  public async onNetworkReconnect(): Promise<void> {
    this.log('🌐 Network reconnection detected - refreshing session');

    try {
      // Simple session refresh
      await this.recoverSession();
      this.log('✅ Network reconnect session refresh completed');
    } catch (error) {
      this.log('❌ Network reconnect session refresh failed:', stringifyError(error));
    }
  }

  /**
   * Get direct access to client for non-messaging operations
   * Use sparingly - prefer pipeline methods when possible
   */
  public async getDirectClient(): Promise<any> {
    return await this.getClient();
  }

  /**
   * Get last outbox processing statistics
   */
  public getLastOutboxStats(): { sent: number; failed: number; retried: number; groupsWithSent: string[] } | null {
    return this.lastOutboxStats;
  }

  /**
   * Centralized logging with better error handling
   */
  private log(message: string, ...args: any[]): void {
    const timestamp = new Date().toISOString().slice(11, 23); // HH:mm:ss.SSS
    const logArgs = args.map(arg => {
      if (arg instanceof Error || (arg && typeof arg === 'object' && arg.name && arg.message)) {
        return stringifyError(arg);
      }
      return arg;
    });
    console.log(`[supabase-pipeline] ${timestamp} ${message}`, ...logArgs);
  }





  /**
   * (Re)bind all registered auth listeners to current client. Idempotent across recreations.
   */
  private async bindAuthListenersToClient(): Promise<void> {
    if (!this.authListeners.length) return;
    try {
      const client = await this.getClient();
      // Unsubscribe any previous bindings (best-effort)
      for (const l of this.authListeners) { try { l.unsubscribe?.(); } catch (_) {} }
      // Rebind and store new unsub functions
      for (const l of this.authListeners) {
        try {
          const sub = client.auth.onAuthStateChange(l.callback);
          l.unsubscribe = () => { try { sub.data.subscription.unsubscribe(); } catch (_) {} };
        } catch (e) {
          this.log('⚠️ Failed to bind an auth listener:', e as any);
        }
      }
      this.log(`🔁 Rebound ${this.authListeners.length} auth listener(s) to new client`);
    } catch (e) {
      this.log('⚠️ bindAuthListenersToClient failed:', e as any);
    }
  }

  /**
   * Ensure client is hard-recreated once, coalescing concurrent requests.
   */
  private async ensureRecreated(reason: string): Promise<void> {
    if (this.recreatePromise) {
      return this.recreatePromise;
    }
    this.recreatePromise = (async () => {
      try {
        await this.hardRecreateClient(reason);
      } finally {
        this.recreatePromise = null;
      }
    })();
    return this.recreatePromise;
  }
}

// Export class and singleton instance
export { SupabasePipeline };
export const supabasePipeline = new SupabasePipeline();

// Initialize on import
supabasePipeline.initialize().catch(error => {
  console.error('[supabase-pipeline] Failed to initialize:', error);
});

export default supabasePipeline;
