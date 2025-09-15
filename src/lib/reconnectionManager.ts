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
    
    // Debounce rapid reconnection attempts
    if (now - this.state.lastReconnectAt < 2000) {
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
    this.log(`🔄 Starting WhatsApp-like reconnection sequence - reason: ${reason}`);

    // Step 1: Stabilization delay (avoid spurious events)
    await new Promise(resolve => setTimeout(resolve, 200));

    // Step 2: Wait for WebView readiness
    await this.waitForWebViewReadiness();

    // Step 3: Validate SQLite encryption (cached)
    await this.validateSQLiteEncryption();

    // Step 4: Check network readiness (cached)
    await this.waitForNetworkStability();

    // Step 5: Clean up existing connections completely
    await this.cleanupConnections();

    // Step 6: Refresh session with timeout and retry
    await this.refreshSession();

    // Step 7: Apply token to realtime client
    await this.applyTokenToRealtime();

    // Step 8: Begin reconnect only after cleanup is complete
    await this.reconnectRealtime();

    // Step 9: Wait for subscription confirmation (SUBSCRIBED state)
    await this.waitForSubscriptionConfirmation();

    // Step 10: Start outbox processing only after subscription confirmed
    await this.startOutboxProcessing();

    this.log(`✅ WhatsApp-like reconnection sequence completed - reason: ${reason}`);
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
   * Clean up existing connections completely
   */
  private async cleanupConnections(): Promise<void> {
    this.log('🧹 Cleaning up existing connections completely');

    try {
      // Get chat store and cleanup realtime
      const mod = await import('@/store/chatstore_refactored');
      const state = (mod as any).useChatStore?.getState?.();

      if (typeof state?.cleanupRealtimeSubscription === 'function') {
        state.cleanupRealtimeSubscription();
      }

      // Longer delay to ensure complete cleanup
      await new Promise(resolve => setTimeout(resolve, 500));
      this.log('✅ Cleanup completed');
    } catch (error) {
      this.log(`⚠️ Cleanup error (non-fatal): ${error}`);
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
      
      if (state?.isOnline === false) {
        throw new Error('Network is offline');
      }
      
      this.log('✅ Network is stable');
    } catch (error) {
      this.log(`❌ Network check failed: ${error}`);
      throw error;
    }
  }

  /**
   * Refresh Supabase session with retry
   */
  private async refreshSession(): Promise<void> {
    this.log('🔑 Refreshing session with retry');

    const maxRetries = 3;
    const timeoutMs = 8000;

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        this.log(`🔑 Session refresh attempt ${attempt}/${maxRetries}`);

        const refreshPromise = supabasePipeline.refreshSession();
        const timeoutPromise = new Promise((_, reject) =>
          setTimeout(() => reject(new Error('Session refresh timeout')), timeoutMs)
        );

        const success = await Promise.race([refreshPromise, timeoutPromise]);

        if (!success) {
          throw new Error('Session refresh returned false');
        }

        this.log('✅ Session refreshed successfully');
        return;
      } catch (error) {
        this.log(`❌ Session refresh attempt ${attempt} failed: ${error}`);

        if (attempt === maxRetries) {
          throw error;
        }

        // Exponential backoff
        const delay = Math.min(1000 * Math.pow(2, attempt - 1), 5000);
        await new Promise(resolve => setTimeout(resolve, delay));
      }
    }
  }

  /**
   * Apply token to realtime client
   */
  private async applyTokenToRealtime(): Promise<void> {
    this.log('🔗 Applying token to realtime client');

    try {
      // Use public methods only
      const session = await supabasePipeline.getWorkingSession();

      if (!session?.access_token) {
        throw new Error('No access token available');
      }

      // Apply token through pipeline's public method
      await supabasePipeline.onAppResume(); // This handles token application

      // Give realtime time to process the token
      await new Promise(resolve => setTimeout(resolve, 200));
      this.log('✅ Token applied to realtime client');
    } catch (error) {
      this.log(`❌ Failed to apply token to realtime: ${error}`);
      throw error;
    }
  }

  /**
   * Begin reconnect only after cleanup is complete
   */
  private async reconnectRealtime(): Promise<void> {
    this.log('📡 Beginning realtime reconnection');

    try {
      const mod = await import('@/store/chatstore_refactored');
      const useChatStore = (mod as any).useChatStore;
      const state = useChatStore?.getState?.();
      const activeGroup = state?.activeGroup;

      if (!activeGroup?.id) {
        this.log('No active group, skipping realtime reconnection');
        return;
      }

      // Setup realtime subscription
      if (typeof state?.setupRealtimeSubscription === 'function') {
        this.log(`📡 Setting up realtime subscription for group ${activeGroup.id}`);
        await state.setupRealtimeSubscription(activeGroup.id);
      } else {
        throw new Error('setupRealtimeSubscription method not available');
      }

      this.log('✅ Realtime reconnection initiated');
    } catch (error) {
      this.log(`❌ Realtime reconnection failed: ${error}`);
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
