/**
 * Topic Error Handler
 * 
 * Provides comprehensive error handling for topic operations including:
 * - Network error detection and offline state management
 * - Retry logic with exponential backoff
 * - Timeout handling with fallback to cache
 * - Operation queueing for offline scenarios
 * 
 * Requirements: 2.8, 3.6, 5.4
 */

import { Network } from '@capacitor/network';
import { Capacitor } from '@capacitor/core';

export interface RetryConfig {
  maxRetries: number;
  initialDelay: number; // milliseconds
  maxDelay: number; // milliseconds
  backoffMultiplier: number;
}

export interface TimeoutConfig {
  fetchTimeout: number; // milliseconds
  operationTimeout: number; // milliseconds
}

export const DEFAULT_RETRY_CONFIG: RetryConfig = {
  maxRetries: 5,
  initialDelay: 1000, // 1 second
  maxDelay: 30000, // 30 seconds
  backoffMultiplier: 2
};

export const DEFAULT_TIMEOUT_CONFIG: TimeoutConfig = {
  fetchTimeout: 10000, // 10 seconds for fetch operations
  operationTimeout: 5000 // 5 seconds for like/view operations
};

export class TopicErrorHandler {
  private static instance: TopicErrorHandler;
  private retryConfig: RetryConfig;
  private timeoutConfig: TimeoutConfig;
  private offlineIndicatorCallback?: (isOffline: boolean) => void;

  private constructor() {
    this.retryConfig = DEFAULT_RETRY_CONFIG;
    this.timeoutConfig = DEFAULT_TIMEOUT_CONFIG;
    this.setupNetworkListener();
  }

  public static getInstance(): TopicErrorHandler {
    if (!TopicErrorHandler.instance) {
      TopicErrorHandler.instance = new TopicErrorHandler();
    }
    return TopicErrorHandler.instance;
  }

  /**
   * Set up network listener to detect offline state
   * Displays offline indicator when network is unavailable
   */
  private setupNetworkListener(): void {
    if (Capacitor.isNativePlatform()) {
      Network.addListener('networkStatusChange', (status) => {
        console.log(`📡 Network status changed: ${status.connected ? 'Online' : 'Offline'}`);
        
        // Trigger offline indicator callback
        if (this.offlineIndicatorCallback) {
          this.offlineIndicatorCallback(!status.connected);
        }
      });
    }
  }

  /**
   * Register callback for offline indicator display
   */
  public setOfflineIndicatorCallback(callback: (isOffline: boolean) => void): void {
    this.offlineIndicatorCallback = callback;
  }

  /**
   * Check if device is currently online
   */
  public async isOnline(): Promise<boolean> {
    try {
      const status = await Network.getStatus();
      return status.connected;
    } catch (error) {
      console.error('Error checking network status:', error);
      // Assume online if we can't check
      return true;
    }
  }

  /**
   * Execute an operation with timeout
   * Falls back to cache if timeout is exceeded
   */
  public async withTimeout<T>(
    operation: () => Promise<T>,
    timeoutMs: number,
    fallbackToCache?: () => Promise<T>
  ): Promise<T> {
    return new Promise<T>(async (resolve, reject) => {
      const timeoutId = setTimeout(async () => {
        console.warn(`⏱️ Operation timed out after ${timeoutMs}ms`);
        
        if (fallbackToCache) {
          try {
            console.log('📦 Falling back to cache...');
            const cachedResult = await fallbackToCache();
            resolve(cachedResult);
          } catch (cacheError) {
            reject(new Error(`Operation timed out and cache fallback failed: ${cacheError}`));
          }
        } else {
          reject(new Error(`Operation timed out after ${timeoutMs}ms`));
        }
      }, timeoutMs);

      try {
        const result = await operation();
        clearTimeout(timeoutId);
        resolve(result);
      } catch (error) {
        clearTimeout(timeoutId);
        reject(error);
      }
    });
  }

  /**
   * Execute an operation with retry logic and exponential backoff
   * Automatically queues operation in outbox if offline
   */
  public async withRetry<T>(
    operation: () => Promise<T>,
    operationName: string,
    queueIfOffline?: () => Promise<void>
  ): Promise<T> {
    let lastError: any;
    let delay = this.retryConfig.initialDelay;

    for (let attempt = 0; attempt <= this.retryConfig.maxRetries; attempt++) {
      try {
        // Check if online before attempting
        const online = await this.isOnline();
        
        if (!online) {
          console.log(`📵 Device is offline, cannot execute ${operationName}`);
          
          // Queue operation if callback provided
          if (queueIfOffline) {
            await queueIfOffline();
            console.log(`✅ ${operationName} queued for later sync`);
          }
          
          throw new Error('Device is offline');
        }

        // Attempt the operation
        console.log(`🔄 Attempting ${operationName} (attempt ${attempt + 1}/${this.retryConfig.maxRetries + 1})`);
        const result = await operation();
        
        if (attempt > 0) {
          console.log(`✅ ${operationName} succeeded after ${attempt} retries`);
        }
        
        return result;

      } catch (error: any) {
        lastError = error;
        
        // Don't retry if it's an authentication error
        if (this.isAuthError(error)) {
          console.error(`🔐 Authentication error in ${operationName}, not retrying`);
          throw error;
        }

        // Don't retry if it's a validation error
        if (this.isValidationError(error)) {
          console.error(`❌ Validation error in ${operationName}, not retrying`);
          throw error;
        }

        // Check if we should retry
        if (attempt < this.retryConfig.maxRetries) {
          console.warn(`⚠️ ${operationName} failed (attempt ${attempt + 1}), retrying in ${delay}ms...`);
          console.error('Error:', error);
          
          // Wait before retrying
          await this.sleep(delay);
          
          // Exponential backoff
          delay = Math.min(delay * this.retryConfig.backoffMultiplier, this.retryConfig.maxDelay);
        } else {
          console.error(`❌ ${operationName} failed after ${this.retryConfig.maxRetries + 1} attempts`);
        }
      }
    }

    throw lastError;
  }

  /**
   * Check if error is an authentication error
   */
  private isAuthError(error: any): boolean {
    if (!error) return false;
    
    const errorMessage = error.message?.toLowerCase() || '';
    const errorCode = error.code?.toLowerCase() || '';
    
    return (
      errorMessage.includes('not authenticated') ||
      errorMessage.includes('unauthorized') ||
      errorMessage.includes('invalid token') ||
      errorMessage.includes('session expired') ||
      errorCode === 'pgrst301' || // PostgREST auth error
      errorCode === '401'
    );
  }

  /**
   * Check if error is a validation error
   */
  private isValidationError(error: any): boolean {
    if (!error) return false;
    
    const errorMessage = error.message?.toLowerCase() || '';
    const errorCode = error.code?.toLowerCase() || '';
    
    return (
      errorMessage.includes('validation') ||
      errorMessage.includes('invalid') ||
      errorMessage.includes('required') ||
      errorMessage.includes('constraint') ||
      errorCode === 'pgrst400' || // PostgREST validation error
      errorCode === '400'
    );
  }

  /**
   * Check if error is a network error
   */
  public isNetworkError(error: any): boolean {
    if (!error) return false;
    
    const errorMessage = error.message?.toLowerCase() || '';
    
    return (
      errorMessage.includes('network') ||
      errorMessage.includes('offline') ||
      errorMessage.includes('connection') ||
      errorMessage.includes('timeout') ||
      errorMessage.includes('fetch failed') ||
      error.name === 'NetworkError' ||
      error.name === 'TypeError' // Often thrown for network issues
    );
  }

  /**
   * Get user-friendly error message
   */
  public getUserFriendlyMessage(error: any): string {
    if (!error) return 'An unknown error occurred';

    // Network errors
    if (this.isNetworkError(error)) {
      return 'Network connection issue. Your changes will be synced when you\'re back online.';
    }

    // Authentication errors
    if (this.isAuthError(error)) {
      return 'Authentication required. Please sign in again.';
    }

    // Validation errors
    if (this.isValidationError(error)) {
      return error.message || 'Invalid input. Please check your data and try again.';
    }

    // Timeout errors
    if (error.message?.includes('timeout')) {
      return 'Request timed out. Please try again.';
    }

    // Generic error
    return error.message || 'An error occurred. Please try again.';
  }

  /**
   * Sleep utility for retry delays
   */
  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Configure retry settings
   */
  public setRetryConfig(config: Partial<RetryConfig>): void {
    this.retryConfig = { ...this.retryConfig, ...config };
  }

  /**
   * Configure timeout settings
   */
  public setTimeoutConfig(config: Partial<TimeoutConfig>): void {
    this.timeoutConfig = { ...this.timeoutConfig, ...config };
  }

  /**
   * Get current timeout config
   */
  public getTimeoutConfig(): TimeoutConfig {
    return { ...this.timeoutConfig };
  }
}

// Export singleton instance
export const topicErrorHandler = TopicErrorHandler.getInstance();
