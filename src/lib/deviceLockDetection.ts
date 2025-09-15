import { Capacitor } from '@capacitor/core';
import { App as CapacitorApp } from '@capacitor/app';

/**
 * Device Lock Detection and Timing Manager
 * Provides WhatsApp-style lock/unlock detection with timing-aware reconnection strategies
 */

interface LockState {
  isLocked: boolean;
  lastLockTime: number | null;
  lastUnlockTime: number | null;
  lockDuration: number | null;
  unlockCount: number;
  extendedLockThreshold: number; // 30 minutes in ms
  shortLockThreshold: number; // 1 minute in ms
}

interface UnlockEvent {
  timestamp: number;
  lockDuration: number | null;
  lockType: 'short' | 'extended' | 'unknown';
  isFirstUnlock: boolean;
}

type UnlockCallback = (event: UnlockEvent) => void;

class DeviceLockDetectionManager {
  private state: LockState = {
    isLocked: false,
    lastLockTime: null,
    lastUnlockTime: null,
    lockDuration: null,
    unlockCount: 0,
    extendedLockThreshold: 30 * 60 * 1000, // 30 minutes
    shortLockThreshold: 60 * 1000, // 1 minute
  };

  private unlockCallbacks: UnlockCallback[] = [];
  private appStateListener: any = null;
  private resumeListener: any = null;
  private visibilityListener: any = null;
  private lastActivityTime: number = Date.now();
  private activityCheckInterval: NodeJS.Timeout | null = null;

  constructor() {
    this.log('🔒 Device Lock Detection Manager initialized');
    this.setupListeners();
    this.startActivityMonitoring();
  }

  private log(message: string): void {
    const timestamp = new Date().toISOString().split('T')[1].split('.')[0];
    console.log(`[device-lock] ${timestamp} ${message}`);
  }

  /**
   * Setup various listeners to detect lock/unlock events
   */
  private setupListeners(): void {
    if (!Capacitor.isNativePlatform()) {
      this.log('Not on native platform, using web-based detection');
      this.setupWebListeners();
      return;
    }

    this.setupNativeListeners();
  }

  /**
   * Setup native platform listeners (Capacitor)
   */
  private setupNativeListeners(): void {
    // Primary app state change listener
    CapacitorApp.addListener('appStateChange', ({ isActive }) => {
      const now = Date.now();
      
      if (!isActive) {
        this.handleAppBackground(now);
      } else {
        this.handleAppForeground(now);
      }
    }).then(handle => {
      this.appStateListener = handle;
    });

    // Secondary resume listener (some Android builds)
    CapacitorApp.addListener('resume', () => {
      this.handleAppForeground(Date.now());
    }).then(handle => {
      this.resumeListener = handle;
    });
  }

  /**
   * Setup web-based listeners for development/testing
   */
  private setupWebListeners(): void {
    // Page visibility API
    if (typeof document !== 'undefined') {
      const handleVisibilityChange = () => {
        const now = Date.now();
        
        if (document.hidden) {
          this.handleAppBackground(now);
        } else {
          this.handleAppForeground(now);
        }
      };

      document.addEventListener('visibilitychange', handleVisibilityChange);
      this.visibilityListener = () => {
        document.removeEventListener('visibilitychange', handleVisibilityChange);
      };
    }

    // Window focus/blur events
    if (typeof window !== 'undefined') {
      window.addEventListener('blur', () => {
        this.handleAppBackground(Date.now());
      });

      window.addEventListener('focus', () => {
        this.handleAppForeground(Date.now());
      });
    }
  }

  /**
   * Handle app going to background (potential lock)
   */
  private handleAppBackground(timestamp: number): void {
    if (this.state.isLocked) {
      this.log('App background event while already locked, ignoring');
      return;
    }

    this.state.isLocked = true;
    this.state.lastLockTime = timestamp;
    this.state.lockDuration = null;

    this.log('📱 Device locked/app backgrounded');
  }

  /**
   * Handle app coming to foreground (unlock)
   */
  private handleAppForeground(timestamp: number): void {
    if (!this.state.isLocked) {
      this.log('App foreground event while not locked, treating as activity');
      this.lastActivityTime = timestamp;
      return;
    }

    // Calculate lock duration
    const lockDuration = this.state.lastLockTime 
      ? timestamp - this.state.lastLockTime 
      : null;

    // Determine lock type
    let lockType: 'short' | 'extended' | 'unknown' = 'unknown';
    if (lockDuration !== null) {
      if (lockDuration < this.state.shortLockThreshold) {
        lockType = 'short';
      } else if (lockDuration > this.state.extendedLockThreshold) {
        lockType = 'extended';
      } else {
        lockType = 'short'; // Default to short for medium durations
      }
    }

    // Update state
    this.state.isLocked = false;
    this.state.lastUnlockTime = timestamp;
    this.state.lockDuration = lockDuration;
    this.state.unlockCount++;
    this.lastActivityTime = timestamp;

    const unlockEvent: UnlockEvent = {
      timestamp,
      lockDuration,
      lockType,
      isFirstUnlock: this.state.unlockCount === 1,
    };

    this.log(`🔓 Device unlocked after ${lockDuration ? Math.round(lockDuration / 1000) : '?'}s (${lockType} lock)`);

    // Notify callbacks
    this.notifyUnlockCallbacks(unlockEvent);
  }

  /**
   * Start monitoring user activity to detect extended inactivity
   */
  private startActivityMonitoring(): void {
    // Check for extended inactivity every 30 seconds
    this.activityCheckInterval = setInterval(() => {
      const now = Date.now();
      const timeSinceActivity = now - this.lastActivityTime;

      // If no activity for more than extended threshold and not already marked as locked
      if (timeSinceActivity > this.state.extendedLockThreshold && !this.state.isLocked) {
        this.log('⏰ Extended inactivity detected, treating as potential lock');
        this.handleAppBackground(now - timeSinceActivity);
      }
    }, 30000);
  }

  /**
   * Notify all unlock callbacks
   */
  private notifyUnlockCallbacks(event: UnlockEvent): void {
    this.unlockCallbacks.forEach(callback => {
      try {
        callback(event);
      } catch (error) {
        this.log(`❌ Unlock callback failed: ${error}`);
      }
    });
  }

  /**
   * Register callback for unlock events
   */
  public onUnlock(callback: UnlockCallback): () => void {
    this.unlockCallbacks.push(callback);
    
    // Return unsubscribe function
    return () => {
      const index = this.unlockCallbacks.indexOf(callback);
      if (index > -1) {
        this.unlockCallbacks.splice(index, 1);
      }
    };
  }

  /**
   * Get current lock state
   */
  public getLockState(): LockState {
    return { ...this.state };
  }

  /**
   * Check if device is currently locked
   */
  public isLocked(): boolean {
    return this.state.isLocked;
  }

  /**
   * Get time since last unlock
   */
  public getTimeSinceUnlock(): number | null {
    if (!this.state.lastUnlockTime) return null;
    return Date.now() - this.state.lastUnlockTime;
  }

  /**
   * Get recommended reconnection strategy based on lock duration
   */
  public getReconnectionStrategy(lockDuration: number | null): {
    strategy: 'immediate' | 'delayed' | 'gradual';
    delay: number;
    description: string;
  } {
    if (!lockDuration) {
      return {
        strategy: 'immediate',
        delay: 0,
        description: 'Unknown lock duration, reconnect immediately'
      };
    }

    if (lockDuration < this.state.shortLockThreshold) {
      return {
        strategy: 'immediate',
        delay: 200,
        description: 'Short lock, quick reconnection'
      };
    }

    if (lockDuration > this.state.extendedLockThreshold) {
      return {
        strategy: 'gradual',
        delay: 1000,
        description: 'Extended lock, gradual reconnection with validation'
      };
    }

    return {
      strategy: 'delayed',
      delay: 500,
      description: 'Medium lock, delayed reconnection'
    };
  }

  /**
   * Mark user activity (useful for manual activity tracking)
   */
  public markActivity(): void {
    this.lastActivityTime = Date.now();
  }

  /**
   * Force unlock state (useful for testing)
   */
  public forceUnlock(): void {
    if (this.state.isLocked) {
      this.handleAppForeground(Date.now());
    }
  }

  /**
   * Reset state (useful for testing)
   */
  public reset(): void {
    this.state = {
      isLocked: false,
      lastLockTime: null,
      lastUnlockTime: null,
      lockDuration: null,
      unlockCount: 0,
      extendedLockThreshold: 30 * 60 * 1000,
      shortLockThreshold: 60 * 1000,
    };
    this.lastActivityTime = Date.now();
    this.log('🔄 Device lock state reset');
  }

  /**
   * Cleanup resources
   */
  public destroy(): void {
    if (this.appStateListener) {
      this.appStateListener.remove();
      this.appStateListener = null;
    }

    if (this.resumeListener) {
      this.resumeListener.remove();
      this.resumeListener = null;
    }

    if (this.visibilityListener) {
      this.visibilityListener();
      this.visibilityListener = null;
    }

    if (this.activityCheckInterval) {
      clearInterval(this.activityCheckInterval);
      this.activityCheckInterval = null;
    }

    this.unlockCallbacks = [];
    this.log('🧹 Device Lock Detection Manager destroyed');
  }
}

// Export singleton instance
export const deviceLockDetection = new DeviceLockDetectionManager();
export type { UnlockEvent, LockState };
