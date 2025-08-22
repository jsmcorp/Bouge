import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { Database } from './supabase';
import { sqliteService } from './sqliteService';
import { Capacitor } from '@capacitor/core';

// Types for the pipeline
export interface Message {
  id: string;
  group_id: string;
  user_id: string;
  content: string;
  is_ghost: boolean;
  message_type: string;
  category: string | null;
  parent_id: string | null;
  image_url: string | null;
  dedupe_key?: string | null;
}

export interface OutboxMessage {
  id: string;
  group_id: string;
  user_id: string;
  content: string;
  retry_count: number;
  next_retry_at: number;
}

interface PipelineConfig {
  masterTimeoutMs: number;
  healthCheckTimeoutMs: number;
  sessionRefreshTimeoutMs: number;
  maxRetries: number;
  retryBackoffMs: number;
}

// Singleton pipeline orchestrator
class SupabasePipeline {
  private client: SupabaseClient<Database> | null = null;
  private isInitialized = false;
  private config: PipelineConfig = {
    masterTimeoutMs: 8000,
    healthCheckTimeoutMs: 3000,
    sessionRefreshTimeoutMs: 5000,
    maxRetries: 3,
    retryBackoffMs: 2000,
  };

  // Track recent unlock state to force outbox usage
  private lastUnlockTime = 0;
  private readonly unlockGracePeriodMs = 10000; // 10 seconds

  constructor() {
    this.log('Pipeline initialized');
  }

  /**
   * Initialize or recreate the Supabase client
   */
  public async initialize(): Promise<void> {
    this.log('🔄 Initializing Supabase client...');
    
    const supabaseUrl = import.meta.env.VITE_SUPABASE_URL || '';
    const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY || '';
    
    if (!supabaseUrl || !supabaseAnonKey) {
      throw new Error('Missing Supabase configuration');
    }

    // Destroy old client if it exists
    if (this.client) {
      this.log('🗑️ Destroying old client instance');
      try {
        await this.client.removeAllChannels();
      } catch (e) {
        this.log('⚠️ Error removing channels during client destruction:', e);
      }
    }

    // Create fresh client
    this.client = createClient<Database>(supabaseUrl, supabaseAnonKey, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: false,
      },
    });

    this.isInitialized = true;
    this.log('✅ Supabase client initialized successfully');
  }

  /**
   * Get the current client instance, initializing if needed
   */
  private async getClient(): Promise<SupabaseClient<Database>> {
    if (!this.client || !this.isInitialized) {
      await this.initialize();
    }
    return this.client!;
  }

  /**
   * Check if we're in the unlock grace period
   */
  private isRecentlyUnlocked(): boolean {
    return Date.now() - this.lastUnlockTime < this.unlockGracePeriodMs;
  }

  /**
   * Mark that device was recently unlocked
   */
  public markDeviceUnlocked(): void {
    this.lastUnlockTime = Date.now();
    this.log('📱 Device unlock marked, will prefer outbox for next', this.unlockGracePeriodMs + 'ms');
  }

  /**
   * Health check with AbortController and timeout
   */
  public async checkHealth(): Promise<boolean> {
    this.log('🏥 Starting health check...');
    
    try {
      const client = await this.getClient();
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), this.config.healthCheckTimeoutMs);

      const healthPromise = Promise.race([
        // Simple session check
        client.auth.getSession().then((result) => {
          const hasSession = !!result?.data?.session?.access_token;
          this.log(`🏥 Session check: ${hasSession ? 'valid' : 'invalid'}`);
          return hasSession;
        }),
        // Abort signal
        new Promise<never>((_, reject) => {
          controller.signal.addEventListener('abort', () => {
            reject(new Error('Health check timeout'));
          });
        })
      ]);

      const isHealthy = await healthPromise;
      clearTimeout(timeoutId);
      
      this.log(`🏥 Health check completed: ${isHealthy ? 'healthy' : 'unhealthy'}`);
      return isHealthy;
    } catch (error) {
      this.log('🏥 Health check failed:', error);
      return false;
    }
  }

  /**
   * Refresh session with timeout
   */
  public async refreshSession(): Promise<boolean> {
    this.log('🔄 Refreshing session...');
    
    try {
      const client = await this.getClient();
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), this.config.sessionRefreshTimeoutMs);

      const refreshPromise = Promise.race([
        client.auth.refreshSession().then((result) => {
          const success = !!result?.data?.session?.access_token;
          this.log(`🔄 Session refresh: ${success ? 'success' : 'failed'}`);
          return success;
        }),
        new Promise<never>((_, reject) => {
          controller.signal.addEventListener('abort', () => {
            reject(new Error('Session refresh timeout'));
          });
        })
      ]);

      const success = await refreshPromise;
      clearTimeout(timeoutId);
      return success;
    } catch (error) {
      this.log('🔄 Session refresh failed:', error);
      return false;
    }
  }

  /**
   * Send message with direct send → fallback to outbox pipeline
   */
  public async sendMessage(message: Message): Promise<void> {
    this.log(`📤 Sending message ${message.id}...`);
    
    // Wrap entire operation in master timeout
    const masterTimeout = new Promise<never>((_, reject) => {
      setTimeout(() => reject(new Error('Master timeout reached')), this.config.masterTimeoutMs);
    });

    try {
      await Promise.race([this.sendMessageInternal(message), masterTimeout]);
      this.log(`✅ Message ${message.id} sent successfully`);
    } catch (error) {
      this.log(`❌ Message ${message.id} send failed:`, error);
      throw error;
    }
  }

  /**
   * Internal message sending logic
   */
  private async sendMessageInternal(message: Message): Promise<void> {
    // Check if we should skip direct send due to recent unlock
    if (this.isRecentlyUnlocked()) {
      this.log(`📤 Skipping direct send due to recent unlock - message ${message.id}`);
      await this.fallbackToOutbox(message);
      return;
    }

    // Check health before attempting direct send
    const isHealthy = await this.checkHealth();
    if (!isHealthy) {
      this.log(`📤 Client unhealthy, falling back to outbox - message ${message.id}`);
      await this.fallbackToOutbox(message);
      return;
    }

    // Attempt direct send with retries
    for (let attempt = 1; attempt <= this.config.maxRetries; attempt++) {
      try {
        this.log(`📤 Direct send attempt ${attempt}/${this.config.maxRetries} - message ${message.id}`);
        
        const client = await this.getClient();
        const sendPromise = client
          .from('messages')
          .insert({
            id: message.id,
            group_id: message.group_id,
            user_id: message.user_id,
            content: message.content,
            is_ghost: message.is_ghost,
            message_type: message.message_type,
            category: message.category,
            parent_id: message.parent_id,
            image_url: message.image_url,
            dedupe_key: message.dedupe_key,
          })
          .select(`
            *,
            reactions(*),
            users!messages_user_id_fkey(display_name, avatar_url)
          `)
          .single();

        const timeoutPromise = new Promise<never>((_, reject) => {
          setTimeout(() => reject(new Error('Direct send timeout')), this.config.masterTimeoutMs);
        });

        const { error } = await Promise.race([sendPromise, timeoutPromise]);

        if (error) {
          throw error;
        }

        this.log(`✅ Direct send successful - message ${message.id}`);
        return; // Success!
      } catch (error) {
        this.log(`❌ Direct send attempt ${attempt} failed - message ${message.id}:`, error);
        
        if (attempt < this.config.maxRetries) {
          await new Promise(resolve => setTimeout(resolve, this.config.retryBackoffMs));
        }
        
        // If this was the last attempt, continue to fallback
        if (attempt === this.config.maxRetries) {
          this.log(`📤 All direct send attempts failed for ${message.id}, falling back to outbox`);
          break;
        }
      }
    }

    // All direct send attempts failed, fallback to outbox
    this.log(`📤 All direct send attempts failed, falling back to outbox - message ${message.id}`);
    await this.fallbackToOutbox(message);
  }

  /**
   * Fallback to outbox for later processing
   */
  private async fallbackToOutbox(message: Message): Promise<void> {
    try {
      const isNative = Capacitor.isNativePlatform();
      const ready = isNative && await sqliteService.isReady();
      
      if (!ready) {
        throw new Error('SQLite not ready for outbox storage');
      }

      // Store message in outbox (without id field as it's auto-generated)
      await sqliteService.addToOutbox({
        group_id: message.group_id,
        user_id: message.user_id,
        content: JSON.stringify({
          id: message.id, // Store original message ID in content
          content: message.content,
          is_ghost: message.is_ghost,
          message_type: message.message_type,
          category: message.category,
          parent_id: message.parent_id,
          image_url: message.image_url,
        }),
        retry_count: 0,
        next_retry_at: Date.now(), // Immediate retry
      });

      this.log(`📦 Message ${message.id} stored in outbox`);
    } catch (error) {
      this.log(`❌ Outbox fallback failed for message ${message.id}:`, error);
      throw error;
    }
  }

  /**
   * Process outbox messages with retries
   */
  public async processOutbox(): Promise<void> {
    const sessionId = `outbox-${Date.now()}`;
    this.log(`📦 Starting outbox processing - session ${sessionId}`);

    try {
      const isNative = Capacitor.isNativePlatform();
      const ready = isNative && await sqliteService.isReady();
      
      if (!ready) {
        this.log('📦 SQLite not ready, skipping outbox processing');
        return;
      }

      const outboxMessages = await sqliteService.getOutboxMessages();
      if (outboxMessages.length === 0) {
        this.log('📦 No outbox messages to process');
        return;
      }

      this.log(`📦 Processing ${outboxMessages.length} outbox messages`);
      const client = await this.getClient();

      for (let i = 0; i < outboxMessages.length; i++) {
        const outboxItem = outboxMessages[i];
        this.log(`📦 Processing outbox message ${i + 1}/${outboxMessages.length} (ID: ${outboxItem.id})`);

        try {
          const messageData = JSON.parse(outboxItem.content);

          // Send to Supabase with timeout race
          const insertPromise = client
            .from('messages')
            .insert({
              group_id: outboxItem.group_id,
              user_id: outboxItem.user_id,
              content: messageData.content,
              is_ghost: messageData.is_ghost,
              message_type: messageData.message_type,
              category: messageData.category,
              parent_id: messageData.parent_id,
              image_url: messageData.image_url,
            })
            .select(`
              *,
              reactions(*),
              users!messages_user_id_fkey(display_name, avatar_url)
            `)
            .single();

          const timeoutPromise = new Promise<never>((_, reject) => {
            setTimeout(() => reject(new Error('Outbox send timeout')), this.config.masterTimeoutMs);
          });

          const { error } = await Promise.race([insertPromise, timeoutPromise]);

          if (error) {
            throw error;
          }

          // Success - remove from outbox
          if (outboxItem.id !== undefined) {
            await sqliteService.removeFromOutbox(outboxItem.id);
            this.log(`✅ Outbox message ${outboxItem.id} sent and removed`);
          }

        } catch (error) {
          this.log(`❌ Outbox message ${outboxItem.id} failed:`, error);
          
          if (outboxItem.id !== undefined) {
            // Update retry count and schedule next retry
            const newRetryCount = (outboxItem.retry_count || 0) + 1;
            const maxRetries = 5;
            
            if (newRetryCount >= maxRetries) {
              this.log(`🗑️ Outbox message ${outboxItem.id} exceeded max retries, removing`);
              await sqliteService.removeFromOutbox(outboxItem.id);
            } else {
              const backoffMs = Math.min(newRetryCount * 30000, 300000); // 30s to 5min max
              const nextRetryAt = Date.now() + backoffMs;
              
              await sqliteService.updateOutboxRetry(outboxItem.id, newRetryCount, nextRetryAt);
              this.log(`⏰ Outbox message ${outboxItem.id} scheduled for retry ${newRetryCount}/${maxRetries} in ${backoffMs}ms`);
            }
          }
        }
      }

      this.log(`📦 Outbox processing complete - session ${sessionId}`);
    } catch (error) {
      this.log(`❌ Outbox processing failed - session ${sessionId}:`, error);
      throw error;
    }
  }

  /**
   * Reset connection - recreate client and refresh session
   */
  public async resetConnection(): Promise<void> {
    this.log('🔄 Resetting connection...');
    
    try {
      // Force client recreation
      await this.initialize();
      
      // Attempt session refresh
      await this.refreshSession();
      
      this.log('✅ Connection reset complete');
    } catch (error) {
      this.log('❌ Connection reset failed:', error);
      throw error;
    }
  }

  /**
   * Handle app resume/unlock events
   */
  public async onAppResume(): Promise<void> {
    this.log('📱 App resume detected');
    
    // Mark device as recently unlocked
    this.markDeviceUnlocked();
    
    // Reset connection to handle stale client issues
    await this.resetConnection();
    
    // Process any pending outbox items
    try {
      await this.processOutbox();
    } catch (error) {
      this.log('⚠️ Outbox processing during app resume failed:', error);
    }
  }

  /**
   * Get direct access to client for non-messaging operations
   * Use sparingly - prefer pipeline methods when possible
   */
  public async getDirectClient(): Promise<SupabaseClient<Database>> {
    return await this.getClient();
  }

  /**
   * Centralized logging
   */
  private log(message: string, ...args: any[]): void {
    console.log(`[supabase-pipeline] ${message}`, ...args);
  }
}

// Export singleton instance
export const supabasePipeline = new SupabasePipeline();

// Initialize on import
supabasePipeline.initialize().catch(error => {
  console.error('[supabase-pipeline] Failed to initialize:', error);
});

export default supabasePipeline;
