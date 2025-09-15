import { deviceLockDetection, UnlockEvent } from './deviceLockDetection';

/**
 * WhatsApp-Style Connection Manager
 * Provides seamless reconnection experience with user-visible status indicators
 */

export type ConnectionState = 
  | 'connected' 
  | 'connecting' 
  | 'reconnecting' 
  | 'disconnected' 
  | 'validating'
  | 'syncing';

export interface ConnectionStatus {
  state: ConnectionState;
  message: string;
  timestamp: number;
  progress?: number; // 0-100 for progress indicators
  isUserVisible: boolean; // Should show to user
}

export interface ReconnectionMetrics {
  unlockTimestamp: number;
  webViewReadyAt: number | null;
  encryptionValidatedAt: number | null;
  connectionStartedAt: number | null;
  connectionCompletedAt: number | null;
  totalReconnectionTime: number | null;
  lockDuration: number | null;
  lockType: 'short' | 'extended' | 'unknown';
}

type StatusCallback = (status: ConnectionStatus) => void;
type ReconnectionCompleteCallback = (metrics: ReconnectionMetrics) => void;

class WhatsAppStyleConnectionManager {
  private currentStatus: ConnectionStatus = {
    state: 'disconnected',
    message: 'Initializing...',
    timestamp: Date.now(),
    isUserVisible: false,
  };

  private statusCallbacks: StatusCallback[] = [];
  private reconnectionCallbacks: ReconnectionCompleteCallback[] = [];

  private unlockUnsubscribe: (() => void) | null = null;
  private reconnectionTimeout: NodeJS.Timeout | null = null;

  constructor() {
    this.log('📱 WhatsApp-Style Connection Manager initialized');
    this.setupUnlockListener();
  }

  private log(message: string): void {
    const timestamp = new Date().toISOString().split('T')[1].split('.')[0];
    console.log(`[whatsapp-connection] ${timestamp} ${message}`);
  }

  /**
   * Setup device unlock listener with simplified reconnection manager
   */
  private setupUnlockListener(): void {
    this.unlockUnsubscribe = deviceLockDetection.onUnlock(async (event: UnlockEvent) => {
      this.log(`🔓 Device unlocked: ${event.lockType} lock (${event.lockDuration ? Math.round(event.lockDuration / 1000) : '?'}s)`);

      try {
        // Use the single reconnection manager
        const { reconnectionManager } = await import('./reconnectionManager');
        await reconnectionManager.reconnect(`device-unlock-${event.lockType}`);
      } catch (error) {
        this.log(`❌ Device unlock reconnection failed: ${error}`);
      }
    });
  }











  /**
   * Update connection status and notify callbacks
   */
  private updateStatus(status: ConnectionStatus): void {
    this.currentStatus = status;
    this.log(`📊 Status: ${status.state} - ${status.message} ${status.progress ? `(${status.progress}%)` : ''}`);

    this.statusCallbacks.forEach(callback => {
      try {
        callback(status);
      } catch (error) {
        this.log(`❌ Status callback failed: ${error}`);
      }
    });
  }

  /**
   * Register status change callback
   */
  public onStatusChange(callback: StatusCallback): () => void {
    this.statusCallbacks.push(callback);
    
    // Immediately call with current status
    callback(this.currentStatus);
    
    // Return unsubscribe function
    return () => {
      const index = this.statusCallbacks.indexOf(callback);
      if (index > -1) {
        this.statusCallbacks.splice(index, 1);
      }
    };
  }

  /**
   * Register reconnection complete callback
   */
  public onReconnectionComplete(callback: ReconnectionCompleteCallback): () => void {
    this.reconnectionCallbacks.push(callback);
    
    // Return unsubscribe function
    return () => {
      const index = this.reconnectionCallbacks.indexOf(callback);
      if (index > -1) {
        this.reconnectionCallbacks.splice(index, 1);
      }
    };
  }

  /**
   * Get current connection status
   */
  public getStatus(): ConnectionStatus {
    return { ...this.currentStatus };
  }

  /**
   * Manually trigger reconnection (for testing or manual retry)
   */
  public async manualReconnect(): Promise<void> {
    this.log('🔄 Manual reconnection triggered');

    try {
      const { reconnectionManager } = await import('./reconnectionManager');
      await reconnectionManager.reconnect('manual-trigger');
    } catch (error) {
      this.log(`❌ Manual reconnection failed: ${error}`);
    }
  }

  /**
   * Set connection state manually (for integration with existing systems)
   */
  public setConnectionState(state: ConnectionState, message?: string): void {
    this.updateStatus({
      state,
      message: message || this.getDefaultMessage(state),
      timestamp: Date.now(),
      isUserVisible: state !== 'connected',
    });
  }

  /**
   * Get default message for connection state
   */
  private getDefaultMessage(state: ConnectionState): string {
    switch (state) {
      case 'connected': return 'Connected';
      case 'connecting': return 'Connecting...';
      case 'reconnecting': return 'Reconnecting...';
      case 'disconnected': return 'Disconnected';
      case 'validating': return 'Validating...';
      case 'syncing': return 'Syncing...';
      default: return 'Unknown';
    }
  }

  /**
   * Cleanup resources
   */
  public destroy(): void {
    if (this.unlockUnsubscribe) {
      this.unlockUnsubscribe();
      this.unlockUnsubscribe = null;
    }

    if (this.reconnectionTimeout) {
      clearTimeout(this.reconnectionTimeout);
      this.reconnectionTimeout = null;
    }

    this.statusCallbacks = [];
    this.reconnectionCallbacks = [];
    this.log('🧹 WhatsApp-Style Connection Manager destroyed');
  }
}

// Export singleton instance
export const whatsappConnection = new WhatsAppStyleConnectionManager();
