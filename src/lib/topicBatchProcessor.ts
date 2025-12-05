/**
 * Topic Batch Processor
 * 
 * Batches topic operations to reduce server requests:
 * - View increments (every 5 seconds)
 * - Read status syncs (on app background)
 * 
 * Task 14.2: Implement lazy loading and prefetching
 */

import { supabasePipeline } from '@/lib/supabasePipeline';
import { sqliteService } from '@/lib/sqliteService';
import { Capacitor } from '@capacitor/core';
import { App } from '@capacitor/app';

interface PendingView {
  topicId: string;
  userId: string;
  timestamp: number;
}

interface PendingReadStatus {
  topicId: string;
  groupId: string;
  userId: string;
  lastReadMessageId: string;
  lastReadAt: number;
}

class TopicBatchProcessor {
  private pendingViews: Map<string, PendingView> = new Map(); // topicId -> PendingView
  private pendingReadStatuses: Map<string, PendingReadStatus> = new Map(); // topicId -> PendingReadStatus
  private viewBatchTimer: NodeJS.Timeout | null = null;
  private readStatusBatchTimer: NodeJS.Timeout | null = null;
  private isProcessingViews = false;
  private isProcessingReadStatuses = false;

  private readonly VIEW_BATCH_INTERVAL = 5000; // 5 seconds
  private readonly READ_STATUS_BATCH_INTERVAL = 10000; // 10 seconds

  constructor() {
    this.setupAppStateListener();
  }

  /**
   * Setup listener for app state changes (background/foreground)
   */
  private setupAppStateListener(): void {
    if (!Capacitor.isNativePlatform()) return;

    App.addListener('appStateChange', async ({ isActive }) => {
      if (!isActive) {
        // App going to background - flush all pending operations
        console.log('📱 App going to background, flushing batches...');
        await this.flushAllBatches();
      }
    });
  }

  /**
   * Queue a view increment for batching
   */
  queueViewIncrement(topicId: string, userId: string): void {
    console.log(`📊 Queuing view increment for topic ${topicId}`);
    
    this.pendingViews.set(topicId, {
      topicId,
      userId,
      timestamp: Date.now()
    });

    // Start batch timer if not already running
    if (!this.viewBatchTimer) {
      this.viewBatchTimer = setTimeout(() => {
        this.processViewBatch();
      }, this.VIEW_BATCH_INTERVAL);
    }
  }

  /**
   * Queue a read status update for batching
   */
  queueReadStatusUpdate(
    topicId: string,
    groupId: string,
    userId: string,
    lastReadMessageId: string,
    lastReadAt: number
  ): void {
    console.log(`📖 Queuing read status update for topic ${topicId}`);
    
    this.pendingReadStatuses.set(topicId, {
      topicId,
      groupId,
      userId,
      lastReadMessageId,
      lastReadAt
    });

    // Start batch timer if not already running
    if (!this.readStatusBatchTimer) {
      this.readStatusBatchTimer = setTimeout(() => {
        this.processReadStatusBatch();
      }, this.READ_STATUS_BATCH_INTERVAL);
    }
  }

  /**
   * Process batched view increments
   */
  private async processViewBatch(): Promise<void> {
    if (this.isProcessingViews) return;
    if (this.pendingViews.size === 0) {
      this.viewBatchTimer = null;
      return;
    }

    this.isProcessingViews = true;
    const viewsToProcess = Array.from(this.pendingViews.values());
    this.pendingViews.clear();
    this.viewBatchTimer = null;

    console.log(`🚀 Processing batch of ${viewsToProcess.length} view increments`);

    try {
      // Process each view increment
      for (const view of viewsToProcess) {
        try {
          await supabasePipeline.rpc('increment_topic_view', {
            p_topic_id: view.topicId
          });
        } catch (error) {
          console.error(`Error incrementing view for topic ${view.topicId}:`, error);
          // Re-queue failed views
          this.pendingViews.set(view.topicId, view);
        }
      }

      console.log(`✅ Processed ${viewsToProcess.length} view increments`);
    } catch (error) {
      console.error('Error processing view batch:', error);
    } finally {
      this.isProcessingViews = false;

      // If there are still pending views, schedule another batch
      if (this.pendingViews.size > 0) {
        this.viewBatchTimer = setTimeout(() => {
          this.processViewBatch();
        }, this.VIEW_BATCH_INTERVAL);
      }
    }
  }

  /**
   * Process batched read status updates
   */
  private async processReadStatusBatch(): Promise<void> {
    if (this.isProcessingReadStatuses) return;
    if (this.pendingReadStatuses.size === 0) {
      this.readStatusBatchTimer = null;
      return;
    }

    this.isProcessingReadStatuses = true;
    const statusesToProcess = Array.from(this.pendingReadStatuses.values());
    this.pendingReadStatuses.clear();
    this.readStatusBatchTimer = null;

    console.log(`🚀 Processing batch of ${statusesToProcess.length} read status updates`);

    try {
      const isNative = Capacitor.isNativePlatform();
      const isSqliteReady = isNative && await sqliteService.isReady();

      // Sync to Supabase (if online)
      // Note: Read status sync to Supabase is handled by syncTopicsToServer
      // This batch processor only ensures local SQLite is updated
      for (const status of statusesToProcess) {
        try {
          // Mark as synced in SQLite
          if (isSqliteReady) {
            await sqliteService.updateTopicReadStatus(
              status.topicId,
              status.groupId,
              status.userId,
              status.lastReadMessageId,
              status.lastReadAt
            );
          }
        } catch (error) {
          console.error(`Error updating read status for topic ${status.topicId}:`, error);
          // Re-queue failed statuses
          this.pendingReadStatuses.set(status.topicId, status);
        }
      }

      console.log(`✅ Processed ${statusesToProcess.length} read status updates`);
    } catch (error) {
      console.error('Error processing read status batch:', error);
    } finally {
      this.isProcessingReadStatuses = false;

      // If there are still pending statuses, schedule another batch
      if (this.pendingReadStatuses.size > 0) {
        this.readStatusBatchTimer = setTimeout(() => {
          this.processReadStatusBatch();
        }, this.READ_STATUS_BATCH_INTERVAL);
      }
    }
  }

  /**
   * Flush all pending batches immediately
   */
  async flushAllBatches(): Promise<void> {
    console.log('🔄 Flushing all pending batches...');

    // Clear timers
    if (this.viewBatchTimer) {
      clearTimeout(this.viewBatchTimer);
      this.viewBatchTimer = null;
    }
    if (this.readStatusBatchTimer) {
      clearTimeout(this.readStatusBatchTimer);
      this.readStatusBatchTimer = null;
    }

    // Process all pending operations
    await Promise.all([
      this.processViewBatch(),
      this.processReadStatusBatch()
    ]);

    console.log('✅ All batches flushed');
  }

  /**
   * Get pending batch counts
   */
  getPendingCounts(): { views: number; readStatuses: number } {
    return {
      views: this.pendingViews.size,
      readStatuses: this.pendingReadStatuses.size
    };
  }

  /**
   * Clear all pending batches (for testing/cleanup)
   */
  clearAllBatches(): void {
    this.pendingViews.clear();
    this.pendingReadStatuses.clear();
    
    if (this.viewBatchTimer) {
      clearTimeout(this.viewBatchTimer);
      this.viewBatchTimer = null;
    }
    if (this.readStatusBatchTimer) {
      clearTimeout(this.readStatusBatchTimer);
      this.readStatusBatchTimer = null;
    }
  }
}

// Singleton instance
export const topicBatchProcessor = new TopicBatchProcessor();
