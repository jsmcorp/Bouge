/**
 * Topic Metrics and Logging
 * 
 * Tracks performance metrics and logs for topic operations:
 * - Operation timing
 * - Error rates
 * - Cache hit rates
 * - Sync performance
 * 
 * Task 14.3: Add logging and metrics
 */

export interface TopicMetric {
  operation: string;
  duration: number;
  success: boolean;
  error?: string;
  metadata?: Record<string, any>;
  timestamp: number;
}

export interface TopicMetricsSummary {
  totalOperations: number;
  successRate: number;
  averageDuration: number;
  errorCount: number;
  cacheHitRate: number;
  operationCounts: Record<string, number>;
  recentErrors: Array<{ operation: string; error: string; timestamp: number }>;
}

class TopicMetricsCollector {
  private metrics: TopicMetric[] = [];
  private readonly MAX_METRICS = 1000; // Keep last 1000 metrics
  private readonly MAX_ERRORS = 50; // Keep last 50 errors

  /**
   * Log a topic operation
   */
  logOperation(
    operation: string,
    duration: number,
    success: boolean,
    error?: string,
    metadata?: Record<string, any>
  ): void {
    const metric: TopicMetric = {
      operation,
      duration,
      success,
      error,
      metadata,
      timestamp: Date.now()
    };

    this.metrics.push(metric);

    // Trim old metrics
    if (this.metrics.length > this.MAX_METRICS) {
      this.metrics = this.metrics.slice(-this.MAX_METRICS);
    }
  }

  /**
   * Get metrics summary
   */
  getSummary(): TopicMetricsSummary {
    if (this.metrics.length === 0) {
      return {
        totalOperations: 0,
        successRate: 0,
        averageDuration: 0,
        errorCount: 0,
        cacheHitRate: 0,
        operationCounts: {},
        recentErrors: []
      };
    }

    const successCount = this.metrics.filter(m => m.success).length;
    const totalDuration = this.metrics.reduce((sum, m) => sum + m.duration, 0);
    const errors = this.metrics.filter(m => !m.success);
    
    // Count cache hits
    const cacheOperations = this.metrics.filter(m => 
      m.operation === 'fetchTopics' && m.metadata?.source === 'cache'
    );
    const totalFetches = this.metrics.filter(m => m.operation === 'fetchTopics').length;
    const cacheHitRate = totalFetches > 0 ? cacheOperations.length / totalFetches : 0;

    // Count operations by type
    const operationCounts: Record<string, number> = {};
    this.metrics.forEach(m => {
      operationCounts[m.operation] = (operationCounts[m.operation] || 0) + 1;
    });

    // Get recent errors
    const recentErrors = errors
      .slice(-this.MAX_ERRORS)
      .map(m => ({
        operation: m.operation,
        error: m.error || 'Unknown error',
        timestamp: m.timestamp
      }));

    return {
      totalOperations: this.metrics.length,
      successRate: successCount / this.metrics.length,
      averageDuration: totalDuration / this.metrics.length,
      errorCount: errors.length,
      cacheHitRate,
      operationCounts,
      recentErrors
    };
  }

  /**
   * Get metrics for a specific operation
   */
  getOperationMetrics(operation: string): TopicMetric[] {
    return this.metrics.filter(m => m.operation === operation);
  }

  /**
   * Clear all metrics
   */
  clearMetrics(): void {
    this.metrics = [];
  }

  /**
   * Export metrics as JSON
   */
  exportMetrics(): string {
    return JSON.stringify({
      summary: this.getSummary(),
      metrics: this.metrics
    }, null, 2);
  }

  /**
   * Log metrics summary to console
   */
  logSummary(): void {
    const summary = this.getSummary();
    console.log('📊 Topic Metrics Summary:');
    console.log(`  Total Operations: ${summary.totalOperations}`);
    console.log(`  Success Rate: ${(summary.successRate * 100).toFixed(2)}%`);
    console.log(`  Average Duration: ${summary.averageDuration.toFixed(2)}ms`);
    console.log(`  Error Count: ${summary.errorCount}`);
    console.log(`  Cache Hit Rate: ${(summary.cacheHitRate * 100).toFixed(2)}%`);
    console.log('  Operation Counts:', summary.operationCounts);
    
    if (summary.recentErrors.length > 0) {
      console.log('  Recent Errors:');
      summary.recentErrors.slice(0, 5).forEach(e => {
        console.log(`    - ${e.operation}: ${e.error}`);
      });
    }
  }
}

// Singleton instance
export const topicMetrics = new TopicMetricsCollector();

/**
 * Helper function to measure operation duration
 */
export async function measureOperation<T>(
  operation: string,
  fn: () => Promise<T>,
  metadata?: Record<string, any>
): Promise<T> {
  const startTime = performance.now();
  
  try {
    const result = await fn();
    const duration = performance.now() - startTime;
    
    topicMetrics.logOperation(operation, duration, true, undefined, metadata);
    
    return result;
  } catch (error) {
    const duration = performance.now() - startTime;
    const errorMessage = error instanceof Error ? error.message : String(error);
    
    topicMetrics.logOperation(operation, duration, false, errorMessage, metadata);
    
    throw error;
  }
}
