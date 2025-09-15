import { Capacitor } from '@capacitor/core';

/**
 * WebView Lifecycle Manager for Capacitor Apps
 * Handles WebView context restoration detection and readiness checks
 * Critical for proper reconnection after device lock/unlock cycles
 */

interface WebViewState {
  isReady: boolean;
  lastReadyCheck: number;
  contextRestoredAt: number | null;
  networkStackReady: boolean;
  jsContextReady: boolean;
}

class WebViewLifecycleManager {
  private state: WebViewState = {
    isReady: false,
    lastReadyCheck: 0,
    contextRestoredAt: null,
    networkStackReady: false,
    jsContextReady: false,
  };

  private readyCallbacks: Array<() => void> = [];
  private checkInterval: NodeJS.Timeout | null = null;
  private readonly CHECK_INTERVAL_MS = 500;
  private readonly READY_TIMEOUT_MS = 10000;

  constructor() {
    this.log('🌐 WebView Lifecycle Manager initialized');
    this.startMonitoring();
  }

  private log(message: string): void {
    const timestamp = new Date().toISOString().split('T')[1].split('.')[0];
    console.log(`[webview-lifecycle] ${timestamp} ${message}`);
  }

  /**
   * Start monitoring WebView readiness
   */
  private startMonitoring(): void {
    if (!Capacitor.isNativePlatform()) {
      this.log('Not on native platform, marking as ready');
      this.markReady();
      return;
    }

    this.checkInterval = setInterval(() => {
      this.performReadinessCheck();
    }, this.CHECK_INTERVAL_MS);

    // Initial check
    this.performReadinessCheck();
  }

  /**
   * Perform comprehensive WebView readiness check
   */
  private async performReadinessCheck(): Promise<void> {
    const now = Date.now();
    
    // Don't check too frequently
    if (now - this.state.lastReadyCheck < this.CHECK_INTERVAL_MS) {
      return;
    }
    
    this.state.lastReadyCheck = now;

    try {
      // Check 1: JavaScript context is responsive
      const jsReady = await this.checkJavaScriptContext();
      
      // Check 2: Network stack is available
      const networkReady = await this.checkNetworkStack();
      
      // Check 3: DOM is ready (for WebView-specific APIs)
      const domReady = this.checkDOMReadiness();

      this.state.jsContextReady = jsReady;
      this.state.networkStackReady = networkReady;

      const wasReady = this.state.isReady;
      this.state.isReady = jsReady && networkReady && domReady;

      if (!wasReady && this.state.isReady) {
        this.state.contextRestoredAt = now;
        this.log('✅ WebView context fully restored and ready');
        this.notifyReadyCallbacks();
      } else if (wasReady && !this.state.isReady) {
        this.log('⚠️ WebView context lost readiness');
        this.state.contextRestoredAt = null;
      }

    } catch (error) {
      this.log(`❌ Readiness check failed: ${error}`);
      this.state.isReady = false;
      this.state.jsContextReady = false;
      this.state.networkStackReady = false;
    }
  }

  /**
   * Check if JavaScript context is responsive
   */
  private async checkJavaScriptContext(): Promise<boolean> {
    try {
      // Test basic JavaScript execution
      const testPromise = new Promise<boolean>((resolve) => {
        setTimeout(() => resolve(true), 10);
      });
      
      const timeoutPromise = new Promise<boolean>((resolve) => {
        setTimeout(() => resolve(false), 1000);
      });

      const result = await Promise.race([testPromise, timeoutPromise]);
      return result;
    } catch (error) {
      this.log(`JS context check failed: ${error}`);
      return false;
    }
  }

  /**
   * Check if network stack is available
   */
  private async checkNetworkStack(): Promise<boolean> {
    try {
      // Test if we can access network APIs
      if (typeof window !== 'undefined' && 'navigator' in window) {
        // Basic network API availability check
        const hasNetworkAPI = 'onLine' in navigator;

        // Try to access Capacitor Network plugin if available (without calling getStatus)
        try {
          const { Network } = await import('@capacitor/network');
          // Just check if the plugin is available, don't call getStatus
          return typeof Network.addListener === 'function' && hasNetworkAPI;
        } catch (networkError) {
          // Fallback to basic network check
          return hasNetworkAPI;
        }
      }
      return false;
    } catch (error) {
      this.log(`Network stack check failed: ${error}`);
      return false;
    }
  }

  /**
   * Check if DOM is ready for WebView operations
   */
  private checkDOMReadiness(): boolean {
    try {
      if (typeof document === 'undefined') return false;
      
      // Check if document is ready
      const docReady = document.readyState === 'complete' || document.readyState === 'interactive';
      
      // Check if we can access basic DOM APIs
      const canAccessDOM = typeof document.createElement === 'function';
      
      return docReady && canAccessDOM;
    } catch (error) {
      this.log(`DOM readiness check failed: ${error}`);
      return false;
    }
  }

  /**
   * Mark WebView as ready (for non-native platforms or manual override)
   */
  private markReady(): void {
    this.state.isReady = true;
    this.state.contextRestoredAt = Date.now();
    this.state.jsContextReady = true;
    this.state.networkStackReady = true;
    this.notifyReadyCallbacks();
  }

  /**
   * Notify all waiting callbacks that WebView is ready
   */
  private notifyReadyCallbacks(): void {
    const callbacks = [...this.readyCallbacks];
    this.readyCallbacks = [];
    
    callbacks.forEach(callback => {
      try {
        callback();
      } catch (error) {
        this.log(`Ready callback failed: ${error}`);
      }
    });
  }

  /**
   * Check if WebView is currently ready
   */
  public isReady(): boolean {
    return this.state.isReady;
  }

  /**
   * Get detailed readiness state
   */
  public getState(): WebViewState {
    return { ...this.state };
  }

  /**
   * Wait for WebView to be ready with timeout
   */
  public async waitForReady(timeoutMs: number = this.READY_TIMEOUT_MS): Promise<boolean> {
    if (this.state.isReady) {
      this.log('WebView already ready');
      return true;
    }

    this.log(`Waiting for WebView readiness (timeout: ${timeoutMs}ms)`);

    return new Promise<boolean>((resolve) => {
      const timeoutId = setTimeout(() => {
        this.log(`⏰ WebView readiness timeout after ${timeoutMs}ms`);
        resolve(false);
      }, timeoutMs);

      this.readyCallbacks.push(() => {
        clearTimeout(timeoutId);
        this.log('✅ WebView ready callback triggered');
        resolve(true);
      });
    });
  }

  /**
   * Force a readiness check (useful after app resume)
   */
  public async forceCheck(): Promise<boolean> {
    this.log('🔄 Forcing WebView readiness check');
    await this.performReadinessCheck();
    return this.state.isReady;
  }

  /**
   * Reset state (useful for testing or after major lifecycle changes)
   */
  public reset(): void {
    this.log('🔄 Resetting WebView lifecycle state');
    this.state.isReady = false;
    this.state.contextRestoredAt = null;
    this.state.jsContextReady = false;
    this.state.networkStackReady = false;
    this.readyCallbacks = [];
  }

  /**
   * Get time since context was restored
   */
  public getTimeSinceRestore(): number | null {
    if (!this.state.contextRestoredAt) return null;
    return Date.now() - this.state.contextRestoredAt;
  }

  /**
   * Cleanup resources
   */
  public destroy(): void {
    if (this.checkInterval) {
      clearInterval(this.checkInterval);
      this.checkInterval = null;
    }
    this.readyCallbacks = [];
    this.log('🧹 WebView Lifecycle Manager destroyed');
  }
}

// Export singleton instance
export const webViewLifecycle = new WebViewLifecycleManager();
