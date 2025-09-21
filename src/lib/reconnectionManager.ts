/**
 * Simple, Clean Reconnection Manager
 * Prevents race conditions and ensures single-flight reconnections
 */

import { supabasePipeline } from './supabasePipeline';

interface ReconnectionState {
  isReconnecting: boolean;
  lastReconnectAt: number;
  reconnectPromise: Promise<void> | null;
}

class ReconnectionManager {
  private state: ReconnectionState = {
    isReconnecting: false,
    lastReconnectAt: 0,
    reconnectPromise: null,
  };

  private log(message: string): void {
    const timestamp = new Date().toISOString().split('T')[1].split('.')[0];
    console.log(`[reconnection-mgr] ${timestamp} ${message}`);
  }

  /**
   * Single-flight reconnection - prevents concurrent attempts
   */
  public async reconnect(reason: string): Promise<void> {
    const now = Date.now();

    // Debounce rapid reconnection attempts (short TTL lock ~500ms)
    if (now - this.state.lastReconnectAt < 500) {
      this.log(`Reconnect debounced (${now - this.state.lastReconnectAt}ms since last) - reason: ${reason}`);
      return;
    }

    // If already reconnecting, wait for existing attempt
    if (this.state.isReconnecting && this.state.reconnectPromise) {
      this.log(`Reconnect already in progress, waiting - reason: ${reason}`);
      try {
        await this.state.reconnectPromise;
        return;
      } catch (error) {
        this.log(`Existing reconnect failed, proceeding with new attempt: ${error}`);
      }
    }

    // Start new reconnection
    this.state.isReconnecting = true;
    this.state.lastReconnectAt = now;
    this.state.reconnectPromise = this.performReconnection(reason);

    try {
      await this.state.reconnectPromise;
      this.log(`✅ Reconnection completed - reason: ${reason}`);
    } catch (error) {
      this.log(`❌ Reconnection failed - reason: ${reason}, error: ${error}`);
      throw error;
    } finally {
      this.state.isReconnecting = false;
      this.state.reconnectPromise = null;
    }
  }

  /**
   * Perform the actual reconnection logic following WhatsApp-like sequence
   */
  private async performReconnection(reason: string): Promise<void> {
    const correlationId = `${Date.now()}-${Math.random().toString(36).slice(2,8)}`;
    this.log(`🔄 Starting WhatsApp-like reconnection sequence - reason: ${reason} [cid=${correlationId}]`);

    // Step 1: Stabilization delay (avoid spurious events)
    await new Promise(resolve => setTimeout(resolve, 200));

    // Step 2: Wait for WebView readiness
    await this.waitForWebViewReadiness();

    // Step 3: Validate SQLite encryption (cached)
    await this.validateSQLiteEncryption();

    // Step 4: Check network readiness (cached)
    await this.waitForNetworkStability();

    // NEW: Step 4.5 Assess current connection health before any cleanup
    this.log('⚡ Fast path resume: assessing current channel');
    const isHealthy = await this.assessConnectionHealth();
    if (isHealthy) {
      this.log('🟢 Channel already subscribed (fast path) — skipping cleanup');
      // Ensure token is applied but avoid re-entry loops
      try { await this.applyTokenToRealtime(); } catch {}
      this.log('Fast path: leaving existing subscription intact');
      return;
    }

    // Fetch current store state
    const mod = await import('@/store/chatstore_refactored');
    const useChatStore = (mod as any).useChatStore;
    const state = useChatStore?.getState?.();
    const channel: any = state?.realtimeChannel;
    const activeGroupId: string | undefined = state?.activeGroup?.id;

    // Ensure realtime has the latest token applied
    await this.applyTokenToRealtime();

    // If channel exists and isn't terminal, attempt subscribe without cleanup
    if (channel && channel.state !== 'closed') {
      this.log(`🟡 Fast path: channel present (state=${channel.state || 'unknown'}); attempting subscribe without cleanup`);
      if (typeof state?.ensureSubscribedFastPath === 'function' && activeGroupId) {
        await state.ensureSubscribedFastPath(activeGroupId);
      } else if (typeof state?.setupRealtimeSubscription === 'function' && activeGroupId) {
        await state.setupRealtimeSubscription(activeGroupId);
      }
    } else if (activeGroupId) {
      // No channel — create and subscribe
      this.log('🟡 Fast path: no channel; creating channel and subscribing');
      if (typeof state?.setupRealtimeSubscription === 'function') {
        await state.setupRealtimeSubscription(activeGroupId);
      }
    } else {
      this.log('🟡 Fast path: no active group; skipping subscribe');
    }

    // Guard: if no active group, skip waiting for SUBSCRIBED entirely
    if (!(await this.shouldWaitForSubscription())) {
      this.log('🟡 No active group/channel – skipping SUBSCRIBED wait');
      // Do not reset outbox here; pipeline will decide when to process via HTTP fallback if needed
      this.log(`✅ Reconnection sequence completed (no active group) - reason: ${reason}`);
      return;
    }

    // Wait for subscription confirmation (SUBSCRIBED state)
    await this.waitForSubscriptionConfirmation();

    // Start outbox processing only after subscription confirmed
    await this.startOutboxProcessing();

    this.log(`✅ WhatsApp-like reconnection sequence completed - reason: ${reason} [cid=${correlationId}]`);
  }

  /**
   * Wait for WebView readiness
   */
  private async waitForWebViewReadiness(): Promise<void> {
    this.log('📱 Waiting for WebView readiness');

    try {
      const { webViewLifecycle } = await import('./webViewLifecycle');
      const isReady = await webViewLifecycle.waitForReady(5000);

      if (!isReady) {
        throw new Error('WebView readiness timeout');
      }

      this.log('✅ WebView is ready');
    } catch (error) {
      this.log(`❌ WebView readiness failed: ${error}`);
      throw error;
    }
  }

  /**
   * Validate SQLite encryption (cached)
   */
  private async validateSQLiteEncryption(): Promise<void> {
    this.log('🔐 Validating SQLite encryption');

    try {
      const { validateEncryptionAfterUnlock } = await import('./sqliteSecret');

      const isValid = await validateEncryptionAfterUnlock();

      if (!isValid) {
        throw new Error('SQLite encryption validation failed');
      }

      this.log('✅ SQLite encryption validated');
    } catch (error) {
      this.log(`❌ SQLite encryption validation failed: ${error}`);
      throw error;
    }
  }


  /**
   * Wait for network stability
   */
  private async waitForNetworkStability(): Promise<void> {
    this.log('🌐 Checking network stability');


    try {
      // Check cached network status from store
      const mod = await import('@/store/chatstore_refactored');
      const state = (mod as any).useChatStore?.getState?.();

      if (state?.online === false) {
        throw new Error('Network is offline');
      }

      this.log('✅ Network is stable');
    } catch (error) {
      this.log(`❌ Network check failed: ${error}`);
      throw error;
    }
  }


  /**
   * Apply token to realtime client
   */
  private async applyTokenToRealtime(): Promise<void> {
    this.log('🔗 Applying token to realtime client');

    try {
      const session = await supabasePipeline.getWorkingSession();
      const token = session?.access_token || null;
      const { changed } = await supabasePipeline.setRealtimeAuth(token);
      this.log(`✅ Token ${changed ? 'changed' : 'unchanged'}; ${changed ? 'will ensure (re)subscribe if needed' : 'no resubscribe required if channel healthy'}`);
    } catch (error) {
      this.log(`❌ Failed to apply token to realtime: ${error}`);
      throw error;
    }
  }


  /**
   * Wait for subscription confirmation (SUBSCRIBED state)
   */
  private async waitForSubscriptionConfirmation(): Promise<void> {
    this.log('⏳ Waiting for subscription confirmation (SUBSCRIBED state)');

    try {
      const mod = await import('@/store/chatstore_refactored');
      const useChatStore = (mod as any).useChatStore;

      await this.waitForSubscriptionReady(useChatStore);
      this.log('✅ Subscription confirmed');
    } catch (error) {
      this.log(`❌ Subscription confirmation failed: ${error}`);
      throw error;
    }
  }

  /**
   * Determine if we should wait for SUBSCRIBED (i.e., a channel was requested)
   */
  private async shouldWaitForSubscription(): Promise<boolean> {
    try {
      const mod = await import('@/store/chatstore_refactored');
      const state = (mod as any).useChatStore?.getState?.();
      const hasActiveGroup = !!state?.activeGroup?.id;
      // Only wait when there is an active group; otherwise there's no channel to subscribe to
      return hasActiveGroup;
    } catch {
      return false;
    }
  }

  /**
   * Start outbox processing only after subscription confirmed
   */
  private async startOutboxProcessing(): Promise<void> {
    this.log('📤 Starting outbox processing');

    try {
      // Use public method to trigger outbox processing
      await supabasePipeline.onNetworkReconnect(); // This triggers outbox processing
      this.log('✅ Outbox processing started');
    } catch (error) {
      this.log(`⚠️ Outbox processing start failed (non-fatal): ${error}`);
    }
  }

  /**
   * Wait for realtime subscription to be ready (SUBSCRIBED state)
   */
  private async waitForSubscriptionReady(useChatStore: any): Promise<void> {
    this.log('⏳ Waiting for SUBSCRIBED state confirmation');

    const maxWait = 3000; // 3 seconds as per WhatsApp flow
    const checkInterval = 100; // 100ms for responsive checking
    const startTime = Date.now();

    while (Date.now() - startTime < maxWait) {
      // Get fresh state each time
      const currentState = useChatStore?.getState?.();

      if (!currentState) {
        await new Promise(resolve => setTimeout(resolve, checkInterval));
        continue;
      }

      // Check for SUBSCRIBED status specifically
      if (currentState.connectionStatus === 'connected' &&
          currentState.realtimeChannel &&
          currentState.subscribedAt) {
        this.log(`✅ SUBSCRIBED state confirmed (took ${Date.now() - startTime}ms)`);
        return;
      }

      // Check if connection failed
      if (currentState.connectionStatus === 'disconnected') {
        throw new Error('Subscription failed - connection disconnected');
      }

      // Log current status for debugging
      if ((Date.now() - startTime) % 1000 < checkInterval) {
        this.log(`⏳ Current status: ${currentState.connectionStatus}, channel: ${!!currentState.realtimeChannel}, subscribedAt: ${!!currentState.subscribedAt}`);
      }

      await new Promise(resolve => setTimeout(resolve, checkInterval));
    }

    // Get final state for error message
    const finalState = useChatStore?.getState?.();
    throw new Error(`Subscription SUBSCRIBED state timeout after ${maxWait}ms. Final state: ${finalState?.connectionStatus}, channel: ${!!finalState?.realtimeChannel}`);
  }

  /**
   * Assess connection health - avoid unnecessary cleanup if connection is healthy
   */
  private async assessConnectionHealth(): Promise<boolean> {
    try {
      const mod = await import('@/store/chatstore_refactored');
      const state = (mod as any).useChatStore?.getState?.();
      const channel: any = state?.realtimeChannel;
      const status = state?.connectionStatus;
      const subscribedAt: number | undefined = state?.subscribedAt;

      const recentlySubscribed = typeof subscribedAt === 'number' && (Date.now() - subscribedAt) < 60_000;
      if (status === 'connected' && channel && recentlySubscribed) {
        try {
          if (typeof channel?.send === 'function') {
            channel.send({ type: 'broadcast', event: 'heartbeat', payload: { t: Date.now() } });
          }
        } catch {}
        return true;
      }

      if (channel?.state === 'joined') return true;
      if (channel?.state === 'closed') return false;

      return false;
    } catch (e) {
      this.log(`\u26a0\ufe0f assessConnectionHealth error: ${e}`);
      return false;
    }
  }

  /**
   * Check if currently reconnecting
   */
  public isReconnecting(): boolean {
    return this.state.isReconnecting;
  }

  /**
   * Get last reconnection time
   */
  public getLastReconnectTime(): number {
    return this.state.lastReconnectAt;
  }
}

// Export singleton instance
export const reconnectionManager = new ReconnectionManager();
