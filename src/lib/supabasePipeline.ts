import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { Database } from './supabase';
import { sqliteService } from './sqliteService';
import { Capacitor } from '@capacitor/core';

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

export interface GroupInsertData {
  name: string;
  description?: string;
  invite_code: string;
  created_by: string;
  avatar_url?: string | null;
}

export interface MessageInsertData {
  group_id: string;
  user_id: string;
  content: string;
  is_ghost?: boolean;
  message_type?: string;
  category?: string | null;
  parent_id?: string | null;
  image_url?: string | null;
  dedupe_key?: string | null;
}

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
  private client: SupabaseClient<Database> | null = null;
  private isInitialized = false;
  private initializePromise: Promise<void> | null = null;
  private config: PipelineConfig = {
    sendTimeoutMs: 6000,
    healthCheckTimeoutMs: 3000,
    maxRetries: 2,
    retryBackoffMs: 1500,
  };

  // Unlock gating disabled; keep constant for logging only
  private readonly unlockGracePeriodMs = 0; // disabled: do not gate sends after unlock
  private lastResumeAt = 0;
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

  constructor() {
    this.log('🚀 Pipeline initialized');
    this.log('🧪 Debug tag: v2025-08-22.1');
  }

  /**
   * Initialize Supabase client (idempotent). Pass force=true to recreate.
   */
  public async initialize(force: boolean = false): Promise<void> {
    this.log(`🔄 initialize() called - force=${force} isInitialized=${this.isInitialized} hasClient=${!!this.client} initPromiseActive=${!!this.initializePromise}`);
    if (!force && this.isInitialized && this.client) { this.log('🔄 initialize() early return (already initialized)'); return; }
    if (this.initializePromise) { this.log('🔄 initialize() waiting for existing initializePromise'); await this.initializePromise; return; }

    this.log('🔄 Initializing Supabase client...');
    const supabaseUrl = import.meta.env.VITE_SUPABASE_URL || '';
    const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY || '';
    if (!supabaseUrl || !supabaseAnonKey) {
      throw new Error('Missing Supabase configuration');
    }
    this.log(`🔄 Supabase env present? url=${!!supabaseUrl} anonKey=${!!supabaseAnonKey}`);

    this.initializePromise = (async () => {
      // Only tear down existing channels if we truly force a reinit
      if (force && this.client) {
        this.log('🗑️ Destroying old client instance (forced)');
        try { this.internalAuthUnsub?.(); this.internalAuthUnsub = null; } catch (_) {}
        try { await this.client.removeAllChannels(); } catch (e) {
          this.log('⚠️ Error removing channels during client destruction:', e);
        }
        try { (this.client as any)?.realtime?.removeAllChannels?.(); } catch (_) {}
        try { (this.client as any)?.realtime?.disconnect?.(); } catch (_) {}
      }

      if (!this.client || force) {
        this.client = createClient<Database>(supabaseUrl, supabaseAnonKey, {
          auth: {
            persistSession: true,
            autoRefreshToken: true,
            detectSessionInUrl: false,
          },
        });
        this.log('🔄 Supabase client created (persistSession=true, autoRefreshToken=true)');
        // Re-bind any pipeline-managed auth listeners onto the new client
        try { await this.bindAuthListenersToClient(); } catch (e) { this.log('⚠️ Failed to bind auth listeners on init:', e as any); }
        // Attach internal auth listener to cache tokens
        try {
          const sub = this.client.auth.onAuthStateChange((_event, session: any) => {
            try {
              const s = session || {};
              this.lastKnownUserId = s?.user?.id || this.lastKnownUserId || null;
              this.lastKnownAccessToken = s?.access_token || this.lastKnownAccessToken || null;
              this.lastKnownRefreshToken = s?.refresh_token || this.lastKnownRefreshToken || null;
            } catch {}
          });
          this.internalAuthUnsub = () => { try { sub.data.subscription.unsubscribe(); } catch (_) {} };
        } catch (e) { this.log('⚠️ Failed to attach internal auth listener:', e as any); }
        // Best-effort apply last-known token to realtime
        try { (this.client as any)?.realtime?.setAuth?.(this.lastKnownAccessToken || undefined); } catch (_) {}
      }

      this.isInitialized = true;
      this.log('✅ Supabase client initialized successfully');
    })().finally(() => { this.initializePromise = null; });

    await this.initializePromise;
  }

  /**
   * Get the current client instance, initializing if needed
   */
  private async getClient(): Promise<SupabaseClient<Database>> {
    this.log(`🔑 getClient() called - hasClient=${!!this.client} isInitialized=${this.isInitialized} initPromiseActive=${!!this.initializePromise}`);
    if (!this.client || !this.isInitialized) { this.log('🔑 getClient() -> calling initialize()'); await this.initialize(); }
    // Opportunistic, throttled corruption check and auto-heal
    try {
      const now = Date.now();
      if (now - this.lastCorruptionCheckAt > 3000) {
        this.lastCorruptionCheckAt = now;
        const corrupted = await this.detectCorruption();
        if (corrupted) {
          this.log('🧪 getClient(): corruption detected → hard recreate');
          await this.ensureRecreated('getClient-autoheal');
        }
      }
    } catch {}
    return this.client!;
  }

  // Unlock gating disabled; keep method for future toggling but unused currently

  /**
   * Mark that device was recently unlocked
   */
  public markDeviceUnlocked(): void {
    this.log(`📱 Device unlock marked, will prefer outbox for next ${this.unlockGracePeriodMs}ms`);
  }

  /**
   * Simple health check with timeout
   */
  public async checkHealth(): Promise<boolean> {
    // Lightweight health: rely on local session presence and freshness to avoid timeouts.
    try {
      const client = await this.getClient();
      const online = (typeof navigator !== 'undefined' && 'onLine' in navigator) ? (navigator as any).onLine : 'unknown';
      this.log(`🏥 Health check: starting (navigator.onLine=${online})`);
      // Wrap getSession() with a 3s timeout to avoid hangs after resume
      const sessionPromise = client.auth.getSession();
      const timeoutPromise = new Promise<never>((_, reject) => {
        setTimeout(() => reject(new Error('getSession timeout')), 3000);
      });
      let data: any;
      try {
        const result: any = await Promise.race([sessionPromise, timeoutPromise]);
        data = result?.data;
      } catch (err: any) {
        if (err && err.message === 'getSession timeout') {
          this.log('🏥 Health check: getSession timeout → scheduling hard recreate and marking unhealthy');
          // Trigger a hard recreate in the background to heal corruption
          this.ensureRecreated('health-check-getsession-timeout').catch(() => {});
          return false; // mark unhealthy to avoid direct sends during rebuild
        }
        throw err;
      }
      const session = data?.session;
      if (!session?.access_token) {
        this.log('🏥 Health check: no active session');
        return false;
      }
      const nowSec = Math.floor(Date.now() / 1000);
      const expiresAt = session.expires_at || 0;
      if (expiresAt > 0 && expiresAt - nowSec <= 0) {
        this.refreshSession().catch(() => {});
        this.log('🏥 Health check: session expired');
        return false;
      }
      const secsLeft = expiresAt > 0 ? (expiresAt - nowSec) : 'unknown';
      const userId = (session as any)?.user?.id ? String((session as any).user.id).slice(0, 8) : 'unknown';
      this.log(`🏥 Health check: healthy (user=${userId}, expiresIn=${secsLeft}s)`);
      return true;
    } catch (error) {
      // Fail open to reduce unnecessary outbox fallbacks during transient issues
      this.log('🏥 Health check encountered error; assuming healthy:', stringifyError(error));
      return true;
    }
  }

  /**
   * Refresh session with timeout
   */
  public async refreshSession(): Promise<boolean> {
    this.log('🔄 Refreshing session...');
    try {
      const client = await this.getClient();
      // Wrap pre-check getSession() with 5s timeout
      const preSessionPromise = client.auth.getSession();
      const preTimeoutPromise = new Promise<never>((_, reject) => {
        setTimeout(() => reject(new Error('getSession timeout')), 5000);
      });
      let current: any = null;
      try {
        const preResult: any = await Promise.race([preSessionPromise, preTimeoutPromise]);
        current = preResult?.data?.session;
      } catch (err: any) {
        if (err && err.message === 'getSession timeout') {
          this.log('🔄 getSession timeout before refresh → scheduling hard recreate');
          this.ensureRecreated('refresh-precheck-timeout').catch(() => {});
          return false;
        }
        throw err;
      }
      if (!current?.access_token) {
        this.log('🔄 No active session to refresh');
        return false;
      }
      const nowSec = Math.floor(Date.now() / 1000);
      const expiresAt = current.expires_at || 0;
      if (expiresAt > 0 && expiresAt - nowSec > 60) {
        this.log('🔄 Session is fresh; skipping refresh');
        return true;
      }
      // Wrap refreshSession() with 5s timeout
      const refreshPromise = client.auth.refreshSession();
      const refreshTimeout = new Promise<never>((_, reject) => {
        setTimeout(() => reject(new Error('refreshSession timeout')), 5000);
      });
      let result: any;
      try {
        result = await Promise.race([refreshPromise, refreshTimeout]);
      } catch (err: any) {
        if (err && err.message === 'refreshSession timeout') {
          this.log('🔄 Session refresh: timeout');
          return false;
        }
        throw err;
      }
      const success = !!result?.data?.session?.access_token && !result?.error;
      this.log(`🔄 Session refresh: ${success ? 'success' : 'failed'}`);
      return success;
    } catch (error) {
      this.log('🔄 Session refresh failed:', stringifyError(error));
      return false;
    }
  }

  /**
   * Detect client corruption by bounding getSession. True means likely corrupted (hang/timeout).
   */
  public async isClientCorrupted(timeoutMs: number = 2500): Promise<boolean> {
    try {
      const client = await this.getClient();
      const sessionPromise = client.auth.getSession();
      const timeoutPromise = new Promise<never>((_, reject) => setTimeout(() => reject(new Error('getSession timeout')), timeoutMs));
      await Promise.race([sessionPromise, timeoutPromise]);
      return false;
    } catch (err: any) {
      if (err && err.message === 'getSession timeout') {
        this.log(`🧪 Corruption probe: getSession timed out after ${timeoutMs}ms`);
        return true;
      }
      return false;
    }
  }

  /**
   * Multi-check corruption detector (fast, bounded). Returns true if any check indicates corruption.
   */
  public async detectCorruption(): Promise<boolean> {
    try {
      const client = await this.getDirectClient();

      // 1) authSessionNull: known user but no session (or timeout)
      const authCheck = (async () => {
        try {
          const res = await Promise.race([
            client.auth.getSession(),
            new Promise<never>((_, reject) => setTimeout(() => reject(new Error('authCheck timeout')), 1000))
          ]) as any;
          const hasSession = !!res?.data?.session?.access_token;
          const known = !!this.lastKnownUserId;
          return known && !hasSession;
        } catch (e: any) {
          return e?.message === 'authCheck timeout';
        }
      })();

      // 2) databaseHang: trivial select bound to 1s
      const dbCheck = (async () => {
        try {
          const res = await Promise.race([
            client.from('users').select('id').limit(1),
            new Promise<never>((_, reject) => setTimeout(() => reject(new Error('dbCheck timeout')), 1000))
          ]) as any;
          return !!res?.error;
        } catch (e: any) {
          return e?.message === 'dbCheck timeout';
        }
      })();

      // 3) realtimeDesync: token exists but setAuth throws
      const realtimeCheck = (async () => {
        try {
          const { data } = await client.auth.getSession();
          const access = data?.session?.access_token;
          if (!access) return false;
          try { (client as any)?.realtime?.setAuth?.(access); return false; } catch { return true; }
        } catch { return true; }
      })();

      // 4) promiseQueue: bounded getUser
      const promiseCheck = (async () => {
        try {
          await Promise.race([
            client.auth.getUser(),
            new Promise<never>((_, reject) => setTimeout(() => reject(new Error('promiseCheck timeout')), 1000))
          ]);
          return false;
        } catch (e: any) {
          return e?.message === 'promiseCheck timeout';
        }
      })();

      // 5) rpc ping (bounded); tolerate error → not corruption unless timeout
      const rpcCheck = (async () => {
        try {
          await Promise.race([
            client.rpc('pg_sleep', { seconds: 0 }),
            new Promise<never>((_, reject) => setTimeout(() => reject(new Error('rpcCheck timeout')), 1000))
          ]);
          return false;
        } catch (e: any) {
          return e?.message === 'rpcCheck timeout';
        }
      })();

      const results = await Promise.all([authCheck, dbCheck, realtimeCheck, promiseCheck, rpcCheck]);
      const corrupted = results.some(Boolean);
      if (corrupted) this.log('🧪 Corruption detector tripped:', results);
      return corrupted;
    } catch (e) {
      this.log('🧪 Corruption detection error:', stringifyError(e));
      return false;
    }
  }

  private async ensureSessionFreshness(): Promise<void> {
    try {
      const client = await this.getClient();
      const { data } = await client.auth.getSession();
      const session = data?.session;
      try { this.lastKnownUserId = session?.user?.id || this.lastKnownUserId || null; } catch (_) {}
      if (!session?.access_token) return;
      const nowSec = Math.floor(Date.now() / 1000);
      const expiresAt = session.expires_at || 0;
      if (expiresAt > 0 && expiresAt - nowSec < 60) {
        this.log('🔐 Session near expiry; refreshing in background');
        await this.refreshSession();
      }
    } catch (error) {
      this.log('🔐 ensureSessionFreshness error:', stringifyError(error));
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
   * Get current session
   */
  public async getSession(): Promise<AuthOperationResult> {
    try {
      const client = await this.getClient();
      const result = await client.auth.getSession();
      try {
        const s = result?.data?.session || null;
        this.lastKnownUserId = s?.user?.id || this.lastKnownUserId || null;
        this.lastKnownAccessToken = s?.access_token || this.lastKnownAccessToken || null;
        this.lastKnownRefreshToken = s?.refresh_token || this.lastKnownRefreshToken || null;
      } catch (_) {}
      return result;
    } catch (error) {
      this.log('🔐 Get session failed:', error);
      return { error };
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
          users!messages_user_id_fkey(display_name, avatar_url)
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
          users!messages_user_id_fkey(display_name, avatar_url)
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
          users!messages_user_id_fkey(display_name, avatar_url)
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
  public async updateUser(userId: string, updates: any): Promise<{ data: any | null; error: any }> {
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
   * Delta sync - fetch messages since a timestamp
   */
  public async deltaSyncMessages(groupId: string, sinceIso: string): Promise<{ data: any[] | null; error: any }> {
    return this.executeQuery(async () => {
      const client = await this.getClient();
      return client
        .from('messages')
        .select(`
          *,
          reactions(*),
          users!messages_user_id_fkey(display_name, avatar_url)
        `)
        .eq('group_id', groupId)
        .gt('created_at', sinceIso)
        .order('created_at', { ascending: true });
    }, 'delta sync messages');
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
   * Remove all realtime channels
   */
  public async removeAllChannels(): Promise<void> {
    try {
      const client = await this.getClient();
      client.removeAllChannels();
    } catch (error) {
      this.log('📡 Remove all channels failed:', error);
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
        // If direct send timed out, schedule a background hard recreate to heal potential corruption
        try {
          const msg = (error as any)?.message || '';
          if (typeof msg === 'string' && msg.includes('Direct send timeout')) {
            this.ensureRecreated('direct-send-timeout').catch(() => {});
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

      // Check health before processing
      const isHealthy = await this.checkHealth();
      if (!isHealthy) {
        this.log('📦 Client unhealthy, skipping outbox processing');
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
    }
  }

  /**
   * Trigger outbox processing externally
   */
  private triggerOutboxProcessing(context: string): void {
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
      await this.refreshSession();
      this.log('✅ Connection reset complete');
    } catch (error) {
      this.log('❌ Connection reset failed:', stringifyError(error));
      throw error;
    }
  }

  /**
   * Hard client recreation: tear down realtime, drop old client, recreate, rebind listeners, preserve session.
   */
  public async hardRecreateClient(reason: string = 'unknown'): Promise<void> {
    this.log(`🧹 Hard recreating Supabase client (reason=${reason})`);
    try {
      if (this.client) {
        try { await this.client.removeAllChannels(); } catch (_) {}
        try { (this.client as any)?.realtime?.removeAllChannels?.(); } catch (_) {}
        try { (this.client as any)?.realtime?.disconnect?.(); } catch (_) {}
      }
      // Drop reference and flags before recreate
      this.client = null;
      this.isInitialized = false;
      await this.initialize(true);
      // After recreate, ensure realtime has token
      try {
        const client = await this.getClient();
        const { data } = await client.auth.getSession();
        const access = data?.session?.access_token;
        try { (client as any)?.realtime?.setAuth?.(access); } catch (_) {}
      } catch (_) {}
      // Nudge realtime store to reconnect active group if any
      try {
        const mod = await import('@/store/chatstore_refactored');
        const state = (mod as any).useChatStore?.getState?.();
        const gid = state?.activeGroup?.id;
        if (gid && typeof state?.forceReconnect === 'function') {
          setTimeout(() => { try { state.forceReconnect(gid); } catch {} }, 200);
        }
      } catch {}
      this.log('✅ Hard recreation complete');
    } catch (error) {
      this.log('❌ Hard recreation failed:', stringifyError(error));
      throw error;
    }
  }

  /**
   * Handle app resume/unlock events
   */
  public async onAppResume(): Promise<void> {
    this.log('📱 App resume detected');
    
    // Mark device as recently unlocked (no gating in send path)
    this.markDeviceUnlocked();

    // Debounce duplicate resume spikes
    const now = Date.now();
    const sinceLast = this.lastResumeAt ? (now - this.lastResumeAt) : null;
    if (sinceLast !== null) { this.log(`📱 App resume delta=${sinceLast}ms`); }
    if (sinceLast !== null && sinceLast < 1500) {
      this.log('📱 App resume debounced');
      return;
    }
    this.lastResumeAt = now;

    try {
      // Probe for corruption; if detected, perform hard recreate which also rebinds listeners
      const corrupted = await this.isClientCorrupted(2500);
      if (corrupted) {
        this.log('🧪 Resume: client appears corrupted; performing hard recreate');
        await this.hardRecreateClient('app-resume-corruption');
      } else {
        await this.initialize(false);
        // refresh in background if near expiry
        this.ensureSessionFreshness().catch(() => {});
      }
    } catch (error) {
      this.log('⚠️ Resume handling failed:', stringifyError(error));
    }

    // Trigger outbox processing instead of blocking
    this.triggerOutboxProcessing('app-resume');
  }

  /**
   * Handle network reconnection events
   */
  public async onNetworkReconnect(): Promise<void> {
    this.log('🌐 Network reconnection detected');
    
    try {
      // Probe and heal if corrupted
      const corrupted = await this.isClientCorrupted(2500);
      if (corrupted) {
        this.log('🧪 Network reconnect: client appears corrupted; performing hard recreate');
        await this.ensureRecreated('network-reconnect-corruption');
      } else {
        await this.initialize(false);
        this.ensureSessionFreshness().catch(() => {});
      }
    } catch (error) {
      this.log('⚠️ Network reconnect handling failed:', stringifyError(error));
    }
    
    // Trigger outbox processing with high priority
    this.triggerOutboxProcessing('network-reconnect');
  }

  /**
   * Get direct access to client for non-messaging operations
   * Use sparingly - prefer pipeline methods when possible
   */
  public async getDirectClient(): Promise<SupabaseClient<Database>> {
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
    const logArgs = args.map(arg => {
      if (arg instanceof Error || (arg && typeof arg === 'object' && arg.name && arg.message)) {
        return stringifyError(arg);
      }
      return arg;
    });
    console.log(`[supabase-pipeline] ${message}`, ...logArgs);
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

// Export singleton instance
export const supabasePipeline = new SupabasePipeline();

// Initialize on import
supabasePipeline.initialize().catch(error => {
  console.error('[supabase-pipeline] Failed to initialize:', error);
});

export default supabasePipeline;
