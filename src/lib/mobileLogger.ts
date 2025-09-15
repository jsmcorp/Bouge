import { Capacitor } from '@capacitor/core';

/**
 * Mobile-Specific Logger and Monitoring System
 * Provides detailed logging for device lifecycle, WebView readiness, and connection metrics
 */

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';
export type LogCategory = 
  | 'device-lifecycle' 
  | 'webview' 
  | 'encryption' 
  | 'connection' 
  | 'timing' 
  | 'network'
  | 'general';

export interface LogEntry {
  timestamp: number;
  level: LogLevel;
  category: LogCategory;
  message: string;
  data?: any;
  sessionId: string;
  platform: string;
}

export interface TimingMetric {
  name: string;
  startTime: number;
  endTime?: number;
  duration?: number;
  category: LogCategory;
  metadata?: any;
}

export interface ConnectionMetrics {
  unlockToWebViewReady: number | null;
  unlockToEncryptionValid: number | null;
  unlockToConnectionStart: number | null;
  unlockToConnectionComplete: number | null;
  totalReconnectionTime: number | null;
  lockDuration: number | null;
  lockType: 'short' | 'extended' | 'unknown';
  failureCount: number;
  retryCount: number;
}

class MobileLogger {
  private logs: LogEntry[] = [];
  private timingMetrics: Map<string, TimingMetric> = new Map();
  private sessionId: string;
  private platform: string;
  private maxLogEntries = 1000;
  private connectionMetrics: ConnectionMetrics = {
    unlockToWebViewReady: null,
    unlockToEncryptionValid: null,
    unlockToConnectionStart: null,
    unlockToConnectionComplete: null,
    totalReconnectionTime: null,
    lockDuration: null,
    lockType: 'unknown',
    failureCount: 0,
    retryCount: 0,
  };

  constructor() {
    this.sessionId = this.generateSessionId();
    this.platform = this.detectPlatform();
    this.log('info', 'general', `Mobile Logger initialized - Session: ${this.sessionId}, Platform: ${this.platform}`);
  }

  /**
   * Generate unique session ID
   */
  private generateSessionId(): string {
    return `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  }

  /**
   * Detect current platform
   */
  private detectPlatform(): string {
    if (Capacitor.isNativePlatform()) {
      return Capacitor.getPlatform();
    }
    return 'web';
  }

  /**
   * Core logging method
   */
  public log(level: LogLevel, category: LogCategory, message: string, data?: any): void {
    const entry: LogEntry = {
      timestamp: Date.now(),
      level,
      category,
      message,
      data,
      sessionId: this.sessionId,
      platform: this.platform,
    };

    // Add to internal log
    this.logs.push(entry);

    // Trim logs if too many
    if (this.logs.length > this.maxLogEntries) {
      this.logs = this.logs.slice(-this.maxLogEntries);
    }

    // Console output with formatting
    this.outputToConsole(entry);
  }

  /**
   * Format and output log entry to console
   */
  private outputToConsole(entry: LogEntry): void {
    const timestamp = new Date(entry.timestamp).toISOString().split('T')[1].split('.')[0];
    const prefix = `[${entry.category}] ${timestamp}`;
    
    const message = entry.data 
      ? `${entry.message} ${JSON.stringify(entry.data)}`
      : entry.message;

    switch (entry.level) {
      case 'debug':
        console.debug(`${prefix} 🔍 ${message}`);
        break;
      case 'info':
        console.log(`${prefix} ℹ️ ${message}`);
        break;
      case 'warn':
        console.warn(`${prefix} ⚠️ ${message}`);
        break;
      case 'error':
        console.error(`${prefix} ❌ ${message}`);
        break;
    }
  }

  /**
   * Device lifecycle logging methods
   */
  public logDeviceLock(timestamp: number): void {
    this.log('info', 'device-lifecycle', 'Device locked/app backgrounded', { timestamp });
  }

  public logDeviceUnlock(timestamp: number, lockDuration: number | null, lockType: string): void {
    this.connectionMetrics.lockDuration = lockDuration;
    this.connectionMetrics.lockType = lockType as any;
    
    this.log('info', 'device-lifecycle', `Device unlocked after ${lockDuration ? Math.round(lockDuration / 1000) : '?'}s`, {
      timestamp,
      lockDuration,
      lockType,
    });
  }

  /**
   * WebView lifecycle logging methods
   */
  public logWebViewStateChange(isReady: boolean, details?: any): void {
    this.log('info', 'webview', `WebView state changed: ${isReady ? 'ready' : 'not ready'}`, details);
  }

  public logWebViewReadinessCheck(jsReady: boolean, networkReady: boolean, domReady: boolean): void {
    this.log('debug', 'webview', 'WebView readiness check', {
      jsReady,
      networkReady,
      domReady,
      overall: jsReady && networkReady && domReady,
    });
  }

  public logWebViewReady(timeSinceUnlock: number | null): void {
    if (timeSinceUnlock !== null) {
      this.connectionMetrics.unlockToWebViewReady = timeSinceUnlock;
    }
    
    this.log('info', 'webview', `WebView ready ${timeSinceUnlock ? `(${timeSinceUnlock}ms after unlock)` : ''}`, {
      timeSinceUnlock,
    });
  }

  /**
   * Encryption logging methods
   */
  public logEncryptionValidation(isValid: boolean, keySource: string, timeTaken: number, error?: string): void {
    const timeSinceUnlock = this.getTimeSinceLastUnlock();
    if (timeSinceUnlock !== null && isValid) {
      this.connectionMetrics.unlockToEncryptionValid = timeSinceUnlock;
    }

    this.log(isValid ? 'info' : 'error', 'encryption', 
      `Encryption validation ${isValid ? 'successful' : 'failed'}`, {
        isValid,
        keySource,
        timeTaken,
        timeSinceUnlock,
        error,
      });
  }

  public logEncryptionKeyRecovery(recoveryType: string, success: boolean): void {
    this.log(success ? 'info' : 'error', 'encryption', 
      `Encryption key recovery ${success ? 'successful' : 'failed'}`, {
        recoveryType,
        success,
      });
  }

  /**
   * Connection logging methods
   */
  public logConnectionStart(timeSinceUnlock: number | null): void {
    if (timeSinceUnlock !== null) {
      this.connectionMetrics.unlockToConnectionStart = timeSinceUnlock;
    }

    this.log('info', 'connection', `Connection attempt started ${timeSinceUnlock ? `(${timeSinceUnlock}ms after unlock)` : ''}`, {
      timeSinceUnlock,
    });
  }

  public logConnectionComplete(success: boolean, timeSinceUnlock: number | null, error?: string): void {
    if (timeSinceUnlock !== null) {
      this.connectionMetrics.unlockToConnectionComplete = timeSinceUnlock;
      this.connectionMetrics.totalReconnectionTime = timeSinceUnlock;
    }

    if (success) {
      this.log('info', 'connection', `Connection completed successfully ${timeSinceUnlock ? `(${timeSinceUnlock}ms total)` : ''}`, {
        timeSinceUnlock,
        metrics: this.connectionMetrics,
      });
    } else {
      this.connectionMetrics.failureCount++;
      this.log('error', 'connection', `Connection failed ${error ? `(${error})` : ''}`, {
        error,
        failureCount: this.connectionMetrics.failureCount,
      });
    }
  }

  public logConnectionRetry(retryCount: number, delay: number): void {
    this.connectionMetrics.retryCount = retryCount;
    this.log('warn', 'connection', `Connection retry #${retryCount} in ${delay}ms`, {
      retryCount,
      delay,
    });
  }

  /**
   * Network logging methods
   */
  public logNetworkStatusChange(isOnline: boolean, connectionType?: string): void {
    this.log('info', 'network', `Network status: ${isOnline ? 'online' : 'offline'}`, {
      isOnline,
      connectionType,
    });
  }

  public logNetworkValidation(isValid: boolean, method: string, timeTaken: number): void {
    this.log('debug', 'network', `Network validation ${isValid ? 'passed' : 'failed'} via ${method}`, {
      isValid,
      method,
      timeTaken,
    });
  }

  /**
   * Timing methods
   */
  public startTiming(name: string, category: LogCategory, metadata?: any): void {
    const metric: TimingMetric = {
      name,
      startTime: Date.now(),
      category,
      metadata,
    };
    
    this.timingMetrics.set(name, metric);
    this.log('debug', 'timing', `Started timing: ${name}`, metadata);
  }

  public endTiming(name: string, metadata?: any): number | null {
    const metric = this.timingMetrics.get(name);
    if (!metric) {
      this.log('warn', 'timing', `Attempted to end unknown timing: ${name}`);
      return null;
    }

    const endTime = Date.now();
    const duration = endTime - metric.startTime;
    
    metric.endTime = endTime;
    metric.duration = duration;

    this.log('info', 'timing', `Completed timing: ${name} (${duration}ms)`, {
      duration,
      ...metric.metadata,
      ...metadata,
    });

    return duration;
  }

  /**
   * Get timing metric
   */
  public getTiming(name: string): TimingMetric | null {
    return this.timingMetrics.get(name) || null;
  }

  /**
   * Utility methods
   */
  private getTimeSinceLastUnlock(): number | null {
    // This would need to be integrated with the device lock detection
    // For now, return null - this will be set by the connection manager
    return null;
  }

  /**
   * Get connection metrics summary
   */
  public getConnectionMetrics(): ConnectionMetrics {
    return { ...this.connectionMetrics };
  }

  /**
   * Reset connection metrics (useful for new unlock cycles)
   */
  public resetConnectionMetrics(): void {
    this.connectionMetrics = {
      unlockToWebViewReady: null,
      unlockToEncryptionValid: null,
      unlockToConnectionStart: null,
      unlockToConnectionComplete: null,
      totalReconnectionTime: null,
      lockDuration: null,
      lockType: 'unknown',
      failureCount: 0,
      retryCount: 0,
    };
    
    this.log('debug', 'timing', 'Connection metrics reset');
  }

  /**
   * Get recent logs
   */
  public getRecentLogs(count: number = 50, category?: LogCategory): LogEntry[] {
    let logs = this.logs;
    
    if (category) {
      logs = logs.filter(log => log.category === category);
    }
    
    return logs.slice(-count);
  }

  /**
   * Export logs for debugging
   */
  public exportLogs(): string {
    const summary = {
      sessionId: this.sessionId,
      platform: this.platform,
      timestamp: new Date().toISOString(),
      connectionMetrics: this.connectionMetrics,
      recentLogs: this.getRecentLogs(100),
    };
    
    return JSON.stringify(summary, null, 2);
  }

  /**
   * Clear logs
   */
  public clearLogs(): void {
    this.logs = [];
    this.timingMetrics.clear();
    this.log('info', 'general', 'Logs cleared');
  }
}

// Export singleton instance
export const mobileLogger = new MobileLogger();
