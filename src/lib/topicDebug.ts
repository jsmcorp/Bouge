/**
 * Topic Debug Utilities
 * 
 * Provides debugging and monitoring tools for topic operations
 * 
 * Task 14.3: Add logging and metrics
 */

import { topicMetrics } from './topicMetrics';
import { topicCacheManager } from './topicCacheManager';
import { topicBatchProcessor } from './topicBatchProcessor';

/**
 * Global debug interface for topics
 * Available in browser console as window.topicDebug
 */
export const topicDebug = {
  /**
   * Get metrics summary
   */
  getMetrics() {
    return topicMetrics.getSummary();
  },

  /**
   * Log metrics summary to console
   */
  logMetrics() {
    topicMetrics.logSummary();
  },

  /**
   * Export metrics as JSON
   */
  exportMetrics() {
    return topicMetrics.exportMetrics();
  },

  /**
   * Get cache statistics
   */
  getCacheStats() {
    return topicCacheManager.getCacheStats();
  },

  /**
   * Get pending batch counts
   */
  getPendingBatches() {
    return topicBatchProcessor.getPendingCounts();
  },

  /**
   * Flush all pending batches
   */
  async flushBatches() {
    await topicBatchProcessor.flushAllBatches();
    console.log('✅ All batches flushed');
  },

  /**
   * Clear all metrics
   */
  clearMetrics() {
    topicMetrics.clearMetrics();
    console.log('✅ Metrics cleared');
  },

  /**
   * Get comprehensive debug info
   */
  getDebugInfo() {
    return {
      metrics: topicMetrics.getSummary(),
      cache: topicCacheManager.getCacheStats(),
      pendingBatches: topicBatchProcessor.getPendingCounts(),
      timestamp: new Date().toISOString()
    };
  },

  /**
   * Log comprehensive debug info
   */
  logDebugInfo() {
    const info = this.getDebugInfo();
    console.log('🔍 Topic Debug Info:');
    console.log('  Metrics:', info.metrics);
    console.log('  Cache:', info.cache);
    console.log('  Pending Batches:', info.pendingBatches);
    console.log('  Timestamp:', info.timestamp);
  }
};

// Expose to window for browser console access
if (typeof window !== 'undefined') {
  (window as any).topicDebug = topicDebug;
  console.log('💡 Topic debug tools available: window.topicDebug');
}
