/**
 * SQLite Monitoring and Analytics
 * 
 * Tracks SQLite operations, errors, and health metrics for production monitoring
 */

interface SQLiteMetrics {
  fkErrors: number;
  migrationStatus: 'success' | 'failed' | 'skipped' | 'pending';
  migrationDuration: number;
  groupSaveTime: number;
  firstTimeLogCount: Map<string, number>; // key: groupId:userId, value: count
}

interface FKErrorContext {
  operation: string;
  groupId: string;
  userId: string;
  errorCode: number;
  timestamp: number;
}

interface HealthCheckResult {
  tableExists: boolean;
  hasCascade: boolean;
  hasRows: boolean;
  isEncrypted: boolean;
  timestamp: number;
}

class SQLiteMonitoring {
  private metrics: SQLiteMetrics = {
    fkErrors: 0,
    migrationStatus: 'pending',
    migrationDuration: 0,
    groupSaveTime: 0,
    firstTimeLogCount: new Map()
  };
  
  private fkErrorHistory: FKErrorContext[] = [];
  private lastHealthCheck: HealthCheckResult | null = null;
  
  /**
   * Track FK constraint error
   * Logs to console and sends to analytics
   */
  trackFKError(context: {
    operation: string;
    groupId: string;
    userId: string;
    errorCode: number;
  }) {
    this.metrics.fkErrors++;
    
    const errorContext: FKErrorContext = {
      ...context,
      timestamp: Date.now()
    };
    
    this.fkErrorHistory.push(errorContext);
    
    // Keep only last 50 errors
    if (this.fkErrorHistory.length > 50) {
      this.fkErrorHistory.shift();
    }
    
    // Log to console
    console.error('[sqlite-monitoring] 🚨 FK constraint error:', {
      operation: context.operation,
      groupId: context.groupId.slice(0, 8),
      userId: context.userId.slice(0, 8),
      errorCode: context.errorCode,
      totalErrors: this.metrics.fkErrors
    });
    
    // Send to analytics
    this.sendToAnalytics('sqlite_fk_error', errorContext);
    
    // Alert if threshold exceeded
    if (this.metrics.fkErrors > 5) {
      this.sendAlert('CRITICAL: Multiple FK errors detected', {
        count: this.metrics.fkErrors,
        recentErrors: this.fkErrorHistory.slice(-5)
      });
    }
  }
  
  /**
   * Track migration status
   */
  trackMigration(status: 'success' | 'failed' | 'skipped', duration: number) {
    this.metrics.migrationStatus = status;
    this.metrics.migrationDuration = duration;
    
    console.log(`[sqlite-monitoring] 📊 Migration ${status} in ${duration}ms`);
    
    this.sendToAnalytics('sqlite_migration', {
      status,
      duration
    });
    
    // Alert on failure
    if (status === 'failed') {
      this.sendAlert('CRITICAL: SQLite migration failed', {
        duration
      });
    }
  }
  
  /**
   * Track "FIRST TIME" log frequency
   * Alerts if same group shows "FIRST TIME" multiple times (indicates persistence issue)
   */
  trackFirstTimeLog(groupId: string, userId: string) {
    const key = `${groupId}:${userId}`;
    const currentCount = this.metrics.firstTimeLogCount.get(key) || 0;
    const newCount = currentCount + 1;
    
    this.metrics.firstTimeLogCount.set(key, newCount);
    
    console.log(`[sqlite-monitoring] 📝 FIRST TIME log for group ${groupId.slice(0, 8)} (count: ${newCount})`);
    
    // Alert if same group shows "FIRST TIME" more than 2 times
    if (newCount > 2) {
      console.warn(`[sqlite-monitoring] ⚠️ Group ${groupId.slice(0, 8)} showing FIRST TIME ${newCount} times - possible persistence issue`);
      
      this.sendAlert('WARNING: Possible persistence issue', {
        groupId: groupId.slice(0, 8),
        userId: userId.slice(0, 8),
        count: newCount
      });
      
      this.sendToAnalytics('sqlite_first_time_repeated', {
        groupId,
        userId,
        count: newCount
      });
    }
  }
  
  /**
   * Track group save performance
   */
  trackGroupSave(count: number, duration: number) {
    this.metrics.groupSaveTime = duration;
    
    const avgTime = duration / count;
    
    console.log(`[sqlite-monitoring] ⏱️ Saved ${count} groups in ${duration}ms (avg: ${avgTime.toFixed(1)}ms per group)`);
    
    this.sendToAnalytics('sqlite_group_save', {
      count,
      duration,
      avgTime
    });
    
    // Alert if too slow
    if (avgTime > 100) {
      console.warn(`[sqlite-monitoring] ⚠️ Slow group save: ${avgTime.toFixed(1)}ms per group`);
    }
  }
  
  /**
   * Health check on app launch
   * Verifies database integrity and reports issues
   */
  async performHealthCheck(db: any, currentUserId: string): Promise<HealthCheckResult> {
    const checks: HealthCheckResult = {
      tableExists: false,
      hasCascade: false,
      hasRows: false,
      isEncrypted: false,
      timestamp: Date.now()
    };
    
    try {
      console.log('[sqlite-monitoring] 🏥 Performing health check...');
      
      // Check #1: group_members table exists
      try {
        const tableCheck = await db.query(
          `SELECT name FROM sqlite_master WHERE type='table' AND name='group_members'`
        );
        checks.tableExists = tableCheck.values && tableCheck.values.length > 0;
      } catch (error) {
        console.error('[sqlite-monitoring] ❌ Table existence check failed:', error);
      }
      
      // Check #2: CASCADE is configured
      try {
        const fkCheck = await db.query('PRAGMA foreign_key_list(group_members);');
        checks.hasCascade = (fkCheck.values || []).some((fk: any) => 
          fk.on_delete === 'CASCADE'
        );
      } catch (error) {
        console.error('[sqlite-monitoring] ❌ CASCADE check failed:', error);
      }
      
      // Check #3: User has rows (after first group join)
      try {
        const rowCheck = await db.query(
          `SELECT COUNT(*) as count FROM group_members WHERE user_id = ?`,
          [currentUserId]
        );
        checks.hasRows = rowCheck.values?.[0]?.count > 0;
      } catch (error) {
        console.error('[sqlite-monitoring] ❌ Row count check failed:', error);
      }
      
      // Check #4: Encryption enabled
      try {
        const encryptCheck = await db.query('PRAGMA cipher_version;');
        checks.isEncrypted = encryptCheck.values && encryptCheck.values.length > 0;
      } catch (error) {
        // cipher_version not available means not encrypted (or error)
        checks.isEncrypted = false;
      }
      
      // Log results
      console.log('[sqlite-monitoring] 🏥 Health check results:', {
        tableExists: checks.tableExists ? '✅' : '❌',
        hasCascade: checks.hasCascade ? '✅' : '❌',
        hasRows: checks.hasRows ? '✅' : '⚠️ (expected after first group join)',
        isEncrypted: checks.isEncrypted ? '✅' : '⚠️'
      });
      
      // Send to analytics
      this.sendToAnalytics('sqlite_health_check', checks);
      
      // Alert on critical failures
      if (!checks.tableExists) {
        this.sendAlert('CRITICAL: group_members table does not exist', checks);
      } else if (!checks.hasCascade) {
        this.sendAlert('CRITICAL: CASCADE foreign keys not configured', checks);
      }
      
      this.lastHealthCheck = checks;
      return checks;
    } catch (error) {
      console.error('[sqlite-monitoring] ❌ Health check exception:', error);
      this.sendAlert('CRITICAL: Health check exception', {
        error: String(error)
      });
      return checks;
    }
  }
  
  /**
   * Get current metrics
   */
  getMetrics(): SQLiteMetrics {
    return {
      ...this.metrics,
      firstTimeLogCount: new Map(this.metrics.firstTimeLogCount)
    };
  }
  
  /**
   * Get last health check result
   */
  getLastHealthCheck(): HealthCheckResult | null {
    return this.lastHealthCheck;
  }
  
  /**
   * Get recent FK errors
   */
  getRecentFKErrors(limit: number = 10): FKErrorContext[] {
    return this.fkErrorHistory.slice(-limit);
  }
  
  /**
   * Reset metrics (for testing)
   */
  resetMetrics() {
    this.metrics = {
      fkErrors: 0,
      migrationStatus: 'pending',
      migrationDuration: 0,
      groupSaveTime: 0,
      firstTimeLogCount: new Map()
    };
    this.fkErrorHistory = [];
  }
  
  /**
   * Send event to analytics provider
   * Override this method to integrate with your analytics provider
   */
  private sendToAnalytics(event: string, data: any) {
    // TODO: Integrate with your analytics provider
    // Examples:
    // - Firebase Analytics: analytics().logEvent(event, data)
    // - Sentry: Sentry.captureMessage(event, { extra: data })
    // - Mixpanel: mixpanel.track(event, data)
    
    // For now, just log to console in development
    if (process.env.NODE_ENV === 'development') {
      console.log(`[analytics] ${event}:`, data);
    }
  }
  
  /**
   * Send alert to monitoring system
   * Override this method to integrate with your alerting system
   */
  private sendAlert(message: string, context?: any) {
    // TODO: Integrate with your alerting system
    // Examples:
    // - PagerDuty: pagerduty.trigger(message, context)
    // - Slack: slack.sendMessage(message, context)
    // - Email: sendEmail(message, context)
    
    // For now, just log to console
    console.error(`[alert] 🚨 ${message}`, context);
  }
}

// Singleton instance
export const sqliteMonitoring = new SQLiteMonitoring();
