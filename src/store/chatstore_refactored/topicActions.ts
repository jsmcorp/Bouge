import { supabasePipeline } from '@/lib/supabasePipeline';
import { sqliteService } from '@/lib/sqliteService';
import { Capacitor } from '@capacitor/core';
import { Network } from '@capacitor/network';
import { Topic, CreateTopicInput } from './types';
import { topicErrorHandler } from '@/lib/topicErrorHandler';
import { validateAndSanitize, getErrorMessage } from '@/lib/topicValidation';
import { topicCacheManager } from '@/lib/topicCacheManager';
import { topicBatchProcessor } from '@/lib/topicBatchProcessor';
import { measureOperation } from '@/lib/topicMetrics';

// Simple UUID v4 generator (no external dependency)
function uuidv4(): string {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
    const r = Math.random() * 16 | 0;
    const v = c === 'x' ? r : (r & 0x3 | 0x8);
    return v.toString(16);
  });
}

export interface TopicActions {
  fetchTopics: (groupId: string, page: number) => Promise<void>;
  createTopic: (input: CreateTopicInput) => Promise<Topic>;
  toggleTopicLike: (topicId: string) => Promise<void>;
  incrementTopicView: (topicId: string) => Promise<void>;
  markTopicAsRead: (topicId: string, lastMessageId: string) => Promise<void>;
  getTopicUnreadCount: (topicId: string) => Promise<number>;
  subscribeToTopics: (groupId: string) => void;
  unsubscribeFromTopics: () => void;
  syncTopicsToServer: () => Promise<void>;
  getTopicMessages: (topicId: string) => Promise<any[]>;
  cleanupExpiredTopics: () => Promise<void>;
}

const TOPICS_PAGE_SIZE = 20;

export const createTopicActions = (set: any, get: any): TopicActions => ({
  /**
   * Task 6.1: Implement fetchTopics action with pagination
   * - Load from SQLite cache first (instant display)
   * - Fetch from Supabase with pagination parameters
   * - Merge and deduplicate by ID
   * - Update SQLite cache
   * - Handle offline mode (SQLite only)
   */
  fetchTopics: async (groupId: string, page: number = 0) => {
    return measureOperation('fetchTopics', async () => {
      try {
        console.log(`📋 Fetching topics for group ${groupId}, page ${page}`);
        set({ isLoadingTopics: true });

        const isNative = Capacitor.isNativePlatform();
        const isSqliteReady = isNative && await sqliteService.isReady();

        // STEP 1: Load from SQLite cache first for instant display
        if (isSqliteReady) {
          try {
            const offset = page * TOPICS_PAGE_SIZE;
            const cachedTopics = await measureOperation('fetchTopics:cache', async () => {
              return await sqliteService.getTopicsFromCache(
                groupId,
                TOPICS_PAGE_SIZE,
                offset
              );
            }, { source: 'cache', groupId, page });

            if (cachedTopics && cachedTopics.length > 0) {
              console.log(`⚡ Loaded ${cachedTopics.length} topics from cache`);

            // Get current user for like status
            const session = await supabasePipeline.getCachedSession();
            const userId = session?.user?.id;

            // Convert cached topics to UI format
            const topics: Topic[] = cachedTopics.map(ct => ({
              id: ct.id,
              group_id: ct.group_id,
              message_id: ct.message_id,
              type: ct.type as any,
              title: ct.title || undefined,
              content: ct.content,
              author: ct.author_id ? {
                id: ct.author_id,
                display_name: ct.author_name || 'Unknown',
                avatar_url: ct.author_avatar
              } : undefined,
              pseudonym: ct.pseudonym || undefined,
              expires_at: ct.expires_at,
              views_count: ct.views_count,
              likes_count: ct.likes_count,
              replies_count: ct.replies_count,
              unread_count: 0, // Will be calculated separately
              is_anonymous: ct.is_anonymous === 1,
              is_liked_by_user: false, // Will be checked below
              created_at: ct.created_at
            }));

            // Check like status for each topic
            if (userId) {
              for (const topic of topics) {
                topic.is_liked_by_user = await sqliteService.isTopicLikedByUser(topic.id, userId);
              }
            }

            // Update state with cached topics
            const currentTopics = page === 0 ? [] : get().topics;
            set({
              topics: [...currentTopics, ...topics],
              topicsPage: page,
              hasMoreTopics: cachedTopics.length === TOPICS_PAGE_SIZE,
              isLoadingTopics: false
            });
          }
        } catch (error) {
          console.error('Error loading topics from cache:', error);
        }
      }

      // STEP 2: Check if we're online (Task 11.1)
      const isOnline = await topicErrorHandler.isOnline();

      if (!isOnline) {
        console.log('📵 Offline mode: Using cached topics only');
        set({ isLoadingTopics: false });
        return;
      }

      // STEP 3: Fetch from Supabase with timeout and fallback to cache (Task 11.1)
      console.log('🌐 Fetching topics from Supabase...');
      const session = await supabasePipeline.getCachedSession();
      if (!session?.user) {
        throw new Error('Not authenticated');
      }

      const offset = page * TOPICS_PAGE_SIZE;
      const timeoutConfig = topicErrorHandler.getTimeoutConfig();
      
      const result: any = await topicErrorHandler.withTimeout(
        async () => {
          return await supabasePipeline.rpc('get_topics_paginated', {
            p_group_id: groupId,
            p_limit: TOPICS_PAGE_SIZE,
            p_offset: offset
          });
        },
        timeoutConfig.fetchTimeout,
        async () => {
          // Fallback to cache on timeout
          console.log('⏱️ Fetch timed out, using cached data');
          set({ isLoadingTopics: false });
          return { data: [], error: null };
        }
      );

      if (result.error) {
        throw result.error;
      }

      const supabaseTopics: any[] = result.data || [];
      console.log(`✅ Fetched ${supabaseTopics.length} topics from Supabase`);

      // STEP 4: Convert to UI format
      const topics: Topic[] = supabaseTopics.map((st: any) => ({
        id: st.id,
        group_id: st.group_id,
        message_id: st.id, // Topic ID is same as message ID
        type: st.type,
        title: st.title,
        content: st.content,
        author: st.author_id ? {
          id: st.author_id,
          display_name: st.author_name,
          avatar_url: st.author_avatar
        } : undefined,
        pseudonym: st.pseudonym,
        expires_at: st.expires_at ? new Date(st.expires_at).getTime() : null,
        views_count: st.views_count,
        likes_count: st.likes_count,
        replies_count: st.replies_count,
        unread_count: 0, // Will be calculated separately
        is_anonymous: st.is_anonymous,
        is_liked_by_user: st.is_liked_by_user,
        created_at: new Date(st.created_at).getTime(),
        image_url: st.image_url
      }));

      // STEP 5: Save to SQLite cache
      if (isSqliteReady) {
        try {
          for (const topic of topics) {
            await sqliteService.saveTopicToCache({
              id: topic.id,
              group_id: topic.group_id,
              message_id: topic.message_id,
              type: topic.type,
              title: topic.title || null,
              content: topic.content,
              author_id: topic.author?.id || null,
              author_name: topic.author?.display_name || null,
              author_avatar: topic.author?.avatar_url || null,
              pseudonym: topic.pseudonym || null,
              expires_at: topic.expires_at,
              views_count: topic.views_count,
              likes_count: topic.likes_count,
              replies_count: topic.replies_count,
              is_anonymous: topic.is_anonymous ? 1 : 0,
              created_at: topic.created_at,
              synced_at: Date.now()
            });
          }
          console.log(`✅ Saved ${topics.length} topics to cache`);

          // Task 14.1: Update cache metadata and cleanup if needed
          topicCacheManager.updateCacheMetadata(groupId, topics.length);
          
          // Check if we need to cleanup old cache
          if (await topicCacheManager.shouldCleanupCache(groupId)) {
            await topicCacheManager.cleanupOldCache(groupId);
          }
        } catch (error) {
          console.error('Error saving topics to cache:', error);
        }
      }

      // STEP 6: Merge with existing topics and deduplicate
      const currentTopics = page === 0 ? [] : get().topics;
      const topicMap = new Map<string, Topic>();
      
      // Add existing topics
      currentTopics.forEach((t: Topic) => topicMap.set(t.id, t));
      
      // Add/update with new topics
      topics.forEach(t => topicMap.set(t.id, t));
      
      const mergedTopics = Array.from(topicMap.values());
      
      // Sort by created_at descending (newest first)
      mergedTopics.sort((a, b) => b.created_at - a.created_at);

      set({
        topics: mergedTopics,
        topicsPage: page,
        hasMoreTopics: topics.length === TOPICS_PAGE_SIZE,
        isLoadingTopics: false
      });

      } catch (error) {
        console.error('Error fetching topics:', error);
        set({ isLoadingTopics: false });
        throw error;
      }
    }, { groupId, page });
  },

  /**
   * Task 6.3: Implement createTopic action for all topic types
   * - Generate client-side UUID and dedupe_key
   * - Handle text, poll, confession, news, image types
   * - Calculate expires_at based on duration ('24h', '7d', 'never')
   * - Insert to SQLite immediately (optimistic)
   * - Queue in outbox if offline
   * - Insert to Supabase (message + topic + poll if applicable)
   * - Handle anonymity for confessions
   */
  createTopic: async (input: CreateTopicInput): Promise<Topic> => {
    try {
      console.log(`📝 Creating topic: ${input.type}`);

      // Task 11.2: Validate and sanitize input
      const { isValid, errors, sanitizedInput } = validateAndSanitize(input);
      
      if (!isValid) {
        const errorMessage = getErrorMessage(errors);
        console.error('❌ Topic validation failed:', errorMessage);
        throw new Error(errorMessage);
      }

      // Use sanitized input for the rest of the operation
      const validatedInput = sanitizedInput;

      const session = await supabasePipeline.getCachedSession();
      if (!session?.user) {
        throw new Error('Not authenticated');
      }

      const userId = session.user.id;
      const topicId = uuidv4();
      const dedupeKey = `topic-${topicId}`;
      const now = Date.now();

      // Calculate expires_at based on duration
      let expiresAt: number | null = null;
      if (validatedInput.expires_in === '24h') {
        expiresAt = now + (24 * 60 * 60 * 1000);
      } else if (validatedInput.expires_in === '7d') {
        expiresAt = now + (7 * 24 * 60 * 60 * 1000);
      }
      // 'never' means expiresAt stays null

      // Determine if anonymous (confessions are always anonymous)
      const isAnonymous = validatedInput.type === 'confession' || validatedInput.is_anonymous || false;

      // Create topic object for optimistic update
      const topic: Topic = {
        id: topicId,
        group_id: validatedInput.group_id,
        message_id: topicId,
        type: validatedInput.type,
        title: validatedInput.title,
        content: validatedInput.content,
        author: isAnonymous ? undefined : {
          id: userId,
          display_name: 'You', // Will be updated from server
          avatar_url: null
        },
        pseudonym: isAnonymous ? 'Anonymous' : undefined,
        expires_at: expiresAt,
        views_count: 0,
        likes_count: 0,
        replies_count: 0,
        unread_count: 0,
        is_anonymous: isAnonymous,
        is_liked_by_user: false,
        created_at: now
      };

      // STEP 1: Insert to SQLite immediately (optimistic)
      const isNative = Capacitor.isNativePlatform();
      const isSqliteReady = isNative && await sqliteService.isReady();

      if (isSqliteReady) {
        try {
          await sqliteService.saveTopicToCache({
            id: topic.id,
            group_id: topic.group_id,
            message_id: topic.message_id,
            type: topic.type,
            title: topic.title || null,
            content: topic.content,
            author_id: isAnonymous ? null : userId,
            author_name: isAnonymous ? null : 'You',
            author_avatar: null,
            pseudonym: topic.pseudonym || null,
            expires_at: topic.expires_at,
            views_count: 0,
            likes_count: 0,
            replies_count: 0,
            is_anonymous: isAnonymous ? 1 : 0,
            created_at: now,
            synced_at: null
          });
          console.log('✅ Saved topic to cache (optimistic)');
        } catch (error) {
          console.error('Error saving topic to cache:', error);
        }
      }

      // STEP 2: Update UI immediately
      const currentTopics = get().topics;
      set({ topics: [topic, ...currentTopics] });

      // STEP 3: Check if online (Task 11.1: Detect offline state)
      const isOnline = await topicErrorHandler.isOnline();

      if (!isOnline) {
        console.log('📵 Offline: Queueing topic creation');
        
        // Task 11.1: Queue operations in outbox
        if (isSqliteReady) {
          await sqliteService.addTopicOperationToOutbox({
            operation_type: 'create_topic',
            topic_id: topicId,
            user_id: userId,
            group_id: validatedInput.group_id,
            payload: JSON.stringify({
              type: validatedInput.type,
              title: validatedInput.title,
              content: validatedInput.content,
              expires_in: validatedInput.expires_in,
              is_anonymous: isAnonymous,
              poll_options: validatedInput.poll_options,
              dedupe_key: dedupeKey
            }),
            retry_count: 0,
            next_retry_at: Date.now(),
            created_at: now
          });
          console.log('✅ Topic creation queued in outbox');
        }
        
        return topic;
      }

      // STEP 4: Insert to Supabase with retry and timeout (Task 11.1)
      console.log('🌐 Creating topic in Supabase...');
      
      const timeoutConfig = topicErrorHandler.getTimeoutConfig();
      
      await topicErrorHandler.withRetry(
        async () => {
          return await topicErrorHandler.withTimeout(
            async () => {
              const client = await supabasePipeline.getDirectClient();

              // Create message first
              const messageData: any = {
                id: topicId,
                group_id: validatedInput.group_id,
                user_id: userId,
                content: validatedInput.content,
                is_ghost: isAnonymous,
                message_type: validatedInput.type === 'poll' ? 'poll' : validatedInput.type === 'image' ? 'image' : 'text',
                category: 'topic',
                dedupe_key: dedupeKey,
                image_url: validatedInput.image_file ? null : undefined // TODO: Handle image upload
              };

              const { error: messageError } = await client
                .from('messages')
                .insert(messageData);

              if (messageError) {
                throw messageError;
              }

              // Create topic entry
              const topicData: any = {
                id: topicId,
                group_id: validatedInput.group_id,
                type: validatedInput.type,
                title: validatedInput.title,
                expires_at: expiresAt ? new Date(expiresAt).toISOString() : null,
                is_anonymous: isAnonymous
              };

              const { error: topicError } = await client
                .from('topics')
                .insert(topicData);

              if (topicError) {
                throw topicError;
              }

              // If poll, create poll entry
              if (validatedInput.type === 'poll' && validatedInput.poll_options && validatedInput.poll_options.length > 0) {
                const pollData = {
                  id: uuidv4(),
                  message_id: topicId,
                  question: validatedInput.content,
                  options: validatedInput.poll_options,
                  closes_at: new Date(now + (7 * 24 * 60 * 60 * 1000)).toISOString() // Default 7 days
                };

                const { error: pollError } = await client
                  .from('polls')
                  .insert(pollData);

                if (pollError) {
                  console.error('Error creating poll:', pollError);
                }
              }

              console.log('✅ Topic created in Supabase');
            },
            timeoutConfig.operationTimeout
          );
        },
        'createTopic',
        async () => {
          // Queue if offline
          if (isSqliteReady) {
            await sqliteService.addTopicOperationToOutbox({
              operation_type: 'create_topic',
              topic_id: topicId,
              user_id: userId,
              group_id: validatedInput.group_id,
              payload: JSON.stringify({
                type: validatedInput.type,
                title: validatedInput.title,
                content: validatedInput.content,
                expires_in: validatedInput.expires_in,
                is_anonymous: isAnonymous,
                poll_options: validatedInput.poll_options,
                dedupe_key: dedupeKey
              }),
              retry_count: 0,
              next_retry_at: Date.now(),
              created_at: now
            });
          }
        }
      );

      // STEP 5: Update cache with synced status
      if (isSqliteReady) {
        try {
          await sqliteService.saveTopicToCache({
            id: topic.id,
            group_id: topic.group_id,
            message_id: topic.message_id,
            type: topic.type,
            title: topic.title || null,
            content: topic.content,
            author_id: isAnonymous ? null : userId,
            author_name: isAnonymous ? null : 'You',
            author_avatar: null,
            pseudonym: topic.pseudonym || null,
            expires_at: topic.expires_at,
            views_count: 0,
            likes_count: 0,
            replies_count: 0,
            is_anonymous: isAnonymous ? 1 : 0,
            created_at: now,
            synced_at: Date.now()
          });
        } catch (error) {
          console.error('Error updating topic cache:', error);
        }
      }

      return topic;

    } catch (error) {
      console.error('Error creating topic:', error);
      
      // Task 11.1: Provide user-friendly error message
      const userMessage = topicErrorHandler.getUserFriendlyMessage(error);
      throw new Error(userMessage);
    }
  },

  /**
   * Task 6.5: Implement toggleTopicLike action
   * - Update SQLite immediately (optimistic)
   * - Update UI state instantly
   * - Queue in outbox if offline
   * - Call toggle_topic_like RPC
   * - Handle errors with rollback
   */
  toggleTopicLike: async (topicId: string): Promise<void> => {
    try {
      console.log(`❤️ Toggling like for topic ${topicId}`);

      const session = await supabasePipeline.getCachedSession();
      if (!session?.user) {
        throw new Error('Not authenticated');
      }

      const userId = session.user.id;
      const isNative = Capacitor.isNativePlatform();
      const isSqliteReady = isNative && await sqliteService.isReady();

      // STEP 1: Check current like status
      let isCurrentlyLiked = false;
      if (isSqliteReady) {
        isCurrentlyLiked = await sqliteService.isTopicLikedByUser(topicId, userId);
      }

      const newLikeStatus = !isCurrentlyLiked;

      // STEP 2: Update SQLite immediately (optimistic)
      if (isSqliteReady) {
        try {
          if (newLikeStatus) {
            await sqliteService.saveTopicLike(topicId, userId);
          } else {
            await sqliteService.deleteTopicLike(topicId, userId);
          }
          console.log(`✅ Updated like status in cache: ${newLikeStatus}`);
        } catch (error) {
          console.error('Error updating like in cache:', error);
        }
      }

      // STEP 3: Update UI state instantly
      const topics = get().topics;
      const updatedTopics = topics.map((t: Topic) => {
        if (t.id === topicId) {
          return {
            ...t,
            is_liked_by_user: newLikeStatus,
            likes_count: newLikeStatus ? t.likes_count + 1 : Math.max(0, t.likes_count - 1)
          };
        }
        return t;
      });
      set({ topics: updatedTopics });

      // STEP 4: Check if online (Task 11.1)
      const isOnline = await topicErrorHandler.isOnline();

      if (!isOnline) {
        console.log('📵 Offline: Like will be synced later');
        
        // Task 11.1: Queue in outbox for later sync
        if (isSqliteReady) {
          await sqliteService.addTopicOperationToOutbox({
            operation_type: 'toggle_like',
            topic_id: topicId,
            user_id: userId,
            group_id: get().topics.find((t: Topic) => t.id === topicId)?.group_id || '',
            payload: JSON.stringify({ new_like_status: newLikeStatus }),
            retry_count: 0,
            next_retry_at: Date.now(),
            created_at: Date.now()
          });
          console.log('✅ Like operation queued in outbox');
        }
        
        return;
      }

      // STEP 5: Call toggle_topic_like RPC with retry (Task 11.1)
      console.log('🌐 Syncing like to Supabase...');
      
      const timeoutConfig = topicErrorHandler.getTimeoutConfig();
      
      try {
        await topicErrorHandler.withRetry(
          async () => {
            return await topicErrorHandler.withTimeout(
              async () => {
                const result = await supabasePipeline.rpc('toggle_topic_like', {
                  p_topic_id: topicId
                });

                if (result.error) {
                  throw result.error;
                }

                console.log('✅ Like synced to Supabase');
              },
              timeoutConfig.operationTimeout
            );
          },
          'toggleTopicLike',
          async () => {
            // Queue if offline
            if (isSqliteReady) {
              await sqliteService.addTopicOperationToOutbox({
                operation_type: 'toggle_like',
                topic_id: topicId,
                user_id: userId,
                group_id: get().topics.find((t: Topic) => t.id === topicId)?.group_id || '',
                payload: JSON.stringify({ new_like_status: newLikeStatus }),
                retry_count: 0,
                next_retry_at: Date.now(),
                created_at: Date.now()
              });
            }
          }
        );
      } catch (error) {
        // Task 11.3: Rollback on error (don't block UI)
        console.error('Error toggling like:', error);
        
        // Rollback SQLite
        if (isSqliteReady) {
          if (newLikeStatus) {
            await sqliteService.deleteTopicLike(topicId, userId);
          } else {
            await sqliteService.saveTopicLike(topicId, userId);
          }
        }

        // Rollback UI
        const rollbackTopics = get().topics.map((t: Topic) => {
          if (t.id === topicId) {
            return {
              ...t,
              is_liked_by_user: isCurrentlyLiked,
              likes_count: isCurrentlyLiked ? t.likes_count + 1 : Math.max(0, t.likes_count - 1)
            };
          }
          return t;
        });
        set({ topics: rollbackTopics });

        throw error;
      }

    } catch (error) {
      console.error('Error toggling topic like:', error);
      throw error;
    }
  },

  /**
   * Task 6.7: Implement incrementTopicView action
   * - Update SQLite immediately
   * - Queue in outbox if offline
   * - Call increment_topic_view RPC
   * - Use atomic operation to prevent race conditions
   */
  incrementTopicView: async (topicId: string): Promise<void> => {
    try {
      console.log(`👁️ Incrementing view for topic ${topicId}`);

      const session = await supabasePipeline.getCachedSession();
      if (!session?.user) {
        throw new Error('Not authenticated');
      }

      const userId = session.user.id;
      const isNative = Capacitor.isNativePlatform();
      const isSqliteReady = isNative && await sqliteService.isReady();

      // STEP 1: Update SQLite immediately
      if (isSqliteReady) {
        try {
          // Queue view for sync
          await sqliteService.queueTopicView(topicId, userId);
          
          // Update local count optimistically
          const topics = get().topics;
          const topic = topics.find((t: Topic) => t.id === topicId);
          if (topic) {
            await sqliteService.updateTopicMetrics(topicId, {
              views_count: topic.views_count + 1
            });
          }
          
          console.log('✅ Queued view increment in cache');
        } catch (error) {
          console.error('Error queueing view:', error);
        }
      }

      // STEP 2: Update UI
      const topics = get().topics;
      const updatedTopics = topics.map((t: Topic) => {
        if (t.id === topicId) {
          return { ...t, views_count: t.views_count + 1 };
        }
        return t;
      });
      set({ topics: updatedTopics });

      // STEP 3: Check if online (Task 11.1)
      const isOnline = await topicErrorHandler.isOnline();

      if (!isOnline) {
        console.log('📵 Offline: View will be synced later');
        // View is already queued in topic_views_queue table
        // No need to add to outbox - views are handled separately
        return;
      }

      // STEP 4: Queue view increment for batching (Task 14.2)
      // Batch view increments every 5 seconds to reduce server load
      console.log('📊 Queueing view increment for batching...');
      topicBatchProcessor.queueViewIncrement(topicId, userId);

    } catch (error) {
      console.error('Error incrementing topic view:', error);
      // Don't throw - view counts are not critical
    }
  },

  /**
   * Task 6.9: Implement markTopicAsRead action (local-first)
   * - Update SQLite read status immediately
   * - Update UI unread count instantly
   * - Queue sync to Supabase in background
   * - Don't wait for server confirmation
   */
  markTopicAsRead: async (topicId: string, lastMessageId: string): Promise<void> => {
    try {
      console.log(`✅ Marking topic ${topicId} as read`);

      const session = await supabasePipeline.getCachedSession();
      if (!session?.user) {
        throw new Error('Not authenticated');
      }

      const userId = session.user.id;
      const isNative = Capacitor.isNativePlatform();
      const isSqliteReady = isNative && await sqliteService.isReady();

      if (!isSqliteReady) {
        console.log('⚠️ SQLite not ready, skipping read status update');
        return;
      }

      const now = Date.now();
      const topic = get().topics.find((t: Topic) => t.id === topicId);
      if (!topic) {
        console.log('⚠️ Topic not found in state');
        return;
      }

      // STEP 1: Update SQLite read status immediately (local-first)
      try {
        await sqliteService.updateTopicReadStatus(
          topicId,
          topic.group_id,
          userId,
          lastMessageId,
          now
        );
        console.log('✅ Updated read status in SQLite');
      } catch (error) {
        console.error('Error updating read status:', error);
        return;
      }

      // STEP 2: Update UI unread count instantly
      const topics = get().topics;
      const updatedTopics = topics.map((t: Topic) => {
        if (t.id === topicId) {
          return { ...t, unread_count: 0 };
        }
        return t;
      });
      set({ topics: updatedTopics });

      // STEP 3: Queue sync to Supabase for batching (Task 14.2)
      // Batch read status syncs to reduce server load
      console.log('📖 Queueing read status for batching...');
      topicBatchProcessor.queueReadStatusUpdate(
        topicId,
        topic.group_id,
        userId,
        lastMessageId,
        now
      );

    } catch (error) {
      console.error('Error marking topic as read:', error);
      // Don't throw - read status is not critical
    }
  },

  /**
   * Task 6.11: Implement getTopicUnreadCount action
   * - Calculate from SQLite read status
   * - Count messages after last_read_at
   * - Don't query server
   */
  getTopicUnreadCount: async (topicId: string): Promise<number> => {
    try {
      const session = await supabasePipeline.getCachedSession();
      if (!session?.user) {
        return 0;
      }

      const userId = session.user.id;
      const isNative = Capacitor.isNativePlatform();
      const isSqliteReady = isNative && await sqliteService.isReady();

      if (!isSqliteReady) {
        return 0;
      }

      // Calculate unread count from SQLite (local-first)
      const unreadCount = await sqliteService.calculateTopicUnreadCount(topicId, userId);
      
      console.log(`📊 Topic ${topicId} unread count: ${unreadCount}`);
      return unreadCount;

    } catch (error) {
      console.error('Error getting topic unread count:', error);
      return 0;
    }
  },

  /**
   * Task 6.13: Implement subscribeToTopics action
   * Task 9.3: Implement cache invalidation on real-time updates
   * - Subscribe to INSERT events on topics table for group
   * - Subscribe to UPDATE events for metric changes
   * - Subscribe to DELETE events for expired topics
   * - Handle new topics in real-time
   * - Update UI without refresh
   * - Update SQLite cache when changes arrive
   * - Remove expired topics from cache
   */
  subscribeToTopics: (groupId: string) => {
    try {
      console.log(`🔔 Subscribing to topics for group ${groupId}`);

      // Unsubscribe from previous subscription if any
      const currentChannel = get().realtimeChannel;
      if (currentChannel) {
        currentChannel.unsubscribe();
      }

      // Create new channel for topics
      supabasePipeline.getDirectClient().then(client => {
        client
          .channel(`topics:${groupId}`)
          .on(
            'postgres_changes',
            {
              event: 'INSERT',
              schema: 'public',
              table: 'topics',
              filter: `group_id=eq.${groupId}`
            },
            async (payload: any) => {
              console.log('🆕 New topic received:', payload.new);
              
              // Fetch full topic data with author info
              const result: any = await supabasePipeline.rpc('get_topics_paginated', {
                p_group_id: groupId,
                p_limit: 1,
                p_offset: 0
              });
              
              if (!result.error && result.data && result.data.length > 0) {
                const topicData = result.data.find((t: any) => t.id === payload.new.id);
                
                if (topicData) {
                  // Convert to UI format
                  const newTopic: Topic = {
                    id: topicData.id,
                    group_id: topicData.group_id,
                    message_id: topicData.id,
                    type: topicData.type,
                    title: topicData.title,
                    content: topicData.content,
                    author: topicData.author_id ? {
                      id: topicData.author_id,
                      display_name: topicData.author_name,
                      avatar_url: topicData.author_avatar
                    } : undefined,
                    pseudonym: topicData.pseudonym,
                    expires_at: topicData.expires_at ? new Date(topicData.expires_at).getTime() : null,
                    views_count: topicData.views_count || 0,
                    likes_count: topicData.likes_count || 0,
                    replies_count: topicData.replies_count || 0,
                    unread_count: 0,
                    is_anonymous: topicData.is_anonymous,
                    is_liked_by_user: topicData.is_liked_by_user,
                    created_at: new Date(topicData.created_at).getTime(),
                    image_url: topicData.image_url
                  };

                  // Add to topics list (at the beginning since it's newest)
                  const topics = get().topics;
                  set({ topics: [newTopic, ...topics] });

                  // Task 9.3: Update SQLite cache
                  const isNative = Capacitor.isNativePlatform();
                  const isSqliteReady = isNative && await sqliteService.isReady();
                  if (isSqliteReady) {
                    await sqliteService.saveTopicToCache({
                      id: newTopic.id,
                      group_id: newTopic.group_id,
                      message_id: newTopic.message_id,
                      type: newTopic.type,
                      title: newTopic.title || null,
                      content: newTopic.content,
                      author_id: newTopic.author?.id || null,
                      author_name: newTopic.author?.display_name || null,
                      author_avatar: newTopic.author?.avatar_url || null,
                      pseudonym: newTopic.pseudonym || null,
                      expires_at: newTopic.expires_at,
                      views_count: newTopic.views_count,
                      likes_count: newTopic.likes_count,
                      replies_count: newTopic.replies_count,
                      is_anonymous: newTopic.is_anonymous ? 1 : 0,
                      created_at: newTopic.created_at,
                      synced_at: Date.now()
                    });
                    console.log('✅ New topic saved to cache');
                  }
                }
              }
            }
          )
          .on(
            'postgres_changes',
            {
              event: 'UPDATE',
              schema: 'public',
              table: 'topics',
              filter: `group_id=eq.${groupId}`
            },
            async (payload: any) => {
              console.log('🔄 Topic updated:', payload.new);
              
              // Task 9.3: Update topic metrics in state
              const topics = get().topics;
              const updatedTopics = topics.map((t: Topic) => {
                if (t.id === payload.new.id) {
                  return {
                    ...t,
                    views_count: payload.new.views_count || t.views_count,
                    likes_count: payload.new.likes_count || t.likes_count,
                    replies_count: payload.new.replies_count || t.replies_count
                  };
                }
                return t;
              });
              set({ topics: updatedTopics });

              // Task 9.3: Update cache with new metrics
              const isNative = Capacitor.isNativePlatform();
              const isSqliteReady = isNative && await sqliteService.isReady();
              if (isSqliteReady) {
                await sqliteService.updateTopicMetrics(payload.new.id, {
                  views_count: payload.new.views_count,
                  likes_count: payload.new.likes_count,
                  replies_count: payload.new.replies_count
                });
                console.log('✅ Topic metrics updated in cache');
              }
            }
          )
          .on(
            'postgres_changes',
            {
              event: 'DELETE',
              schema: 'public',
              table: 'topics',
              filter: `group_id=eq.${groupId}`
            },
            async (payload: any) => {
              console.log('🗑️ Topic deleted (expired):', payload.old);
              
              const topicId = payload.old.id;
              
              // Task 9.3: Remove from state
              const topics = get().topics;
              const filteredTopics = topics.filter((t: Topic) => t.id !== topicId);
              set({ topics: filteredTopics });

              // Task 9.3: Remove from SQLite cache
              const isNative = Capacitor.isNativePlatform();
              const isSqliteReady = isNative && await sqliteService.isReady();
              if (isSqliteReady) {
                await sqliteService.deleteTopicFromCache(topicId);
                console.log('✅ Expired topic removed from cache');
              }
            }
          )
          .subscribe();

        console.log('✅ Subscribed to topics channel (INSERT, UPDATE, DELETE)');
      });

    } catch (error) {
      console.error('Error subscribing to topics:', error);
    }
  },

  /**
   * Unsubscribe from topics updates
   */
  unsubscribeFromTopics: () => {
    try {
      const currentChannel = get().realtimeChannel;
      if (currentChannel) {
        currentChannel.unsubscribe();
        console.log('✅ Unsubscribed from topics');
      }
    } catch (error) {
      console.error('Error unsubscribing from topics:', error);
    }
  },

  /**
   * Task 9.3 & Task 10.2: Cleanup expired topics from cache with cascade deletion
   * Should be called periodically (e.g., on app resume, every hour)
   * Removes expired topics from both state and SQLite cache
   * Handles cascade deletion of associated data (likes, messages, read status, views)
   * 
   * Requirements: 6.1, 6.4, 6.6
   */
  cleanupExpiredTopics: async (): Promise<void> => {
    try {
      console.log('🧹 Cleaning up expired topics with cascade deletion...');

      const isNative = Capacitor.isNativePlatform();
      const isSqliteReady = isNative && await sqliteService.isReady();

      if (!isSqliteReady) {
        console.log('⚠️ SQLite not ready, skipping cleanup');
        return;
      }

      // Get expired topic IDs
      const expiredIds = await sqliteService.getExpiredTopicIds();

      if (expiredIds.length > 0) {
        console.log(`🗑️ Found ${expiredIds.length} expired topics`);

        // Remove from state
        const topics = get().topics;
        const filteredTopics = topics.filter((t: Topic) => !expiredIds.includes(t.id));
        set({ topics: filteredTopics });

        // Task 10.2: Perform cascade deletion in SQLite
        // This deletes:
        // - Topic from topics_cache
        // - Associated likes from topic_likes_cache
        // - Associated messages with topic_id
        // - Read status from topic_read_status
        // - Queued views from topic_views_queue
        const removedCount = await sqliteService.cleanupExpiredTopicsWithCascade();
        console.log(`✅ Cleaned up ${removedCount} expired topics with cascade deletion`);
      } else {
        console.log('✅ No expired topics to clean up');
      }

    } catch (error) {
      console.error('Error cleaning up expired topics:', error);
    }
  },

  /**
   * Task 6.14: Implement syncTopicsToServer action
   * - Process outbox queue for topics
   * - Sync likes, views, read status
   * - Batch operations to minimize requests
   * - Handle conflicts (server wins)
   * - Update local cache with server state
   */
  syncTopicsToServer: async (): Promise<void> => {
    try {
      console.log('🔄 Syncing topics to server...');

      const session = await supabasePipeline.getCachedSession();
      if (!session?.user) {
        console.log('⚠️ Not authenticated, skipping sync');
        return;
      }

      const isNative = Capacitor.isNativePlatform();
      const isSqliteReady = isNative && await sqliteService.isReady();

      if (!isSqliteReady) {
        console.log('⚠️ SQLite not ready, skipping sync');
        return;
      }

      // Task 11.1: Check if online
      const isOnline = await topicErrorHandler.isOnline();
      if (!isOnline) {
        console.log('📵 Offline, skipping sync');
        return;
      }

      // STEP 1: Process outbox operations (topic creations, likes)
      try {
        const pendingOps = await sqliteService.getPendingTopicOperations();
        
        if (pendingOps.length > 0) {
          console.log(`🔄 Processing ${pendingOps.length} pending topic operations...`);
          
          for (const op of pendingOps) {
            try {
              const payload = JSON.parse(op.payload);
              
              switch (op.operation_type) {
                case 'create_topic': {
                  console.log(`📝 Syncing topic creation: ${op.topic_id}`);
                  const client = await supabasePipeline.getDirectClient();
                  
                  // Calculate expires_at
                  let expiresAt: string | null = null;
                  if (payload.expires_in === '24h') {
                    expiresAt = new Date(op.created_at + (24 * 60 * 60 * 1000)).toISOString();
                  } else if (payload.expires_in === '7d') {
                    expiresAt = new Date(op.created_at + (7 * 24 * 60 * 60 * 1000)).toISOString();
                  }
                  
                  // Create message
                  const { error: messageError } = await client
                    .from('messages')
                    .insert({
                      id: op.topic_id,
                      group_id: op.group_id,
                      user_id: op.user_id,
                      content: payload.content,
                      is_ghost: payload.is_anonymous,
                      message_type: payload.type === 'poll' ? 'poll' : payload.type === 'image' ? 'image' : 'text',
                      category: 'topic',
                      dedupe_key: payload.dedupe_key
                    });
                  
                  if (messageError) throw messageError;
                  
                  // Create topic
                  const { error: topicError } = await client
                    .from('topics')
                    .insert({
                      id: op.topic_id,
                      group_id: op.group_id,
                      type: payload.type,
                      title: payload.title,
                      expires_at: expiresAt,
                      is_anonymous: payload.is_anonymous
                    });
                  
                  if (topicError) throw topicError;
                  
                  // If poll, create poll entry
                  if (payload.type === 'poll' && payload.poll_options?.length > 0) {
                    const { error: pollError } = await client
                      .from('polls')
                      .insert({
                        id: uuidv4(),
                        message_id: op.topic_id,
                        question: payload.content,
                        options: payload.poll_options,
                        closes_at: new Date(op.created_at + (7 * 24 * 60 * 60 * 1000)).toISOString()
                      });
                    
                    if (pollError) console.error('Error creating poll:', pollError);
                  }
                  
                  console.log(`✅ Topic created: ${op.topic_id}`);
                  break;
                }
                
                case 'toggle_like': {
                  console.log(`❤️ Syncing like toggle: ${op.topic_id}`);
                  const result = await supabasePipeline.rpc('toggle_topic_like', {
                    p_topic_id: op.topic_id
                  });
                  
                  if (result.error) throw result.error;
                  console.log(`✅ Like synced: ${op.topic_id}`);
                  break;
                }
                
                case 'increment_view': {
                  console.log(`👁️ Syncing view increment: ${op.topic_id}`);
                  const result = await supabasePipeline.rpc('increment_topic_view', {
                    p_topic_id: op.topic_id
                  });
                  
                  if (result.error) throw result.error;
                  console.log(`✅ View synced: ${op.topic_id}`);
                  break;
                }
                
                case 'update_read_status': {
                  console.log(`✅ Syncing read status: ${op.topic_id}`);
                  // Read status sync will be implemented later
                  console.log('⚠️ Read status sync not yet implemented');
                  break;
                }
              }
              
              // Remove from outbox on success
              await sqliteService.removeTopicOperationFromOutbox(op.id!);
              
            } catch (error) {
              // Task 11.3: Handle conflicts and continue processing on partial failures
              console.error(`Error processing operation ${op.id}:`, error);
              
              // Check if it's a conflict error (server wins)
              if (topicErrorHandler.isNetworkError(error)) {
                console.log('📵 Network error during sync, will retry later');
                // Don't increment retry count for network errors
                return;
              }
              
              // Update retry count for other errors
              const newRetryCount = op.retry_count + 1;
              if (newRetryCount < 5) {
                // Task 11.3: Mark failed items for retry
                await sqliteService.updateTopicOperationRetry(op.id!, newRetryCount);
                console.log(`⚠️ Operation ${op.id} will retry (attempt ${newRetryCount}/5)`);
              } else {
                // Task 11.3: Continue processing - don't block on max retries
                console.error(`❌ Operation ${op.id} exceeded max retries, removing`);
                await sqliteService.removeTopicOperationFromOutbox(op.id!);
              }
            }
          }
          
          console.log(`✅ Processed ${pendingOps.length} operations`);
        }
      } catch (error) {
        console.error('Error processing outbox:', error);
      }

      // STEP 2: Sync queued views (from topic_views_queue)
      try {
        const unsyncedViews = await sqliteService.getUnsyncedViewsQueue();
        
        if (unsyncedViews.length > 0) {
          console.log(`🔄 Syncing ${unsyncedViews.length} queued views...`);
          
          // Batch views by topic
          const viewsByTopic = new Map<string, number>();
          unsyncedViews.forEach((view: any) => {
            const count = viewsByTopic.get(view.topic_id) || 0;
            viewsByTopic.set(view.topic_id, count + 1);
          });

          // Sync each topic's views
          for (const [topicId, count] of viewsByTopic.entries()) {
            for (let i = 0; i < count; i++) {
              const result = await supabasePipeline.rpc('increment_topic_view', {
                p_topic_id: topicId
              });
              
              if (result.error) {
                console.error(`Error syncing view for topic ${topicId}:`, result.error);
              }
            }
          }

          // Mark views as synced
          const viewIds = unsyncedViews.map((v: any) => v.id!).filter((id: any) => id !== undefined);
          if (viewIds.length > 0) {
            await sqliteService.markViewsAsSynced(viewIds);
          }
          
          console.log(`✅ Synced ${unsyncedViews.length} views`);
        }
      } catch (error) {
        console.error('Error syncing views:', error);
      }

      // STEP 3: Fetch latest topic data from server (Task 11.3: server wins conflict resolution)
      try {
        const topics = get().topics;
        if (topics.length > 0) {
          // Get first topic's group_id
          const groupId = topics[0].group_id;
          
          // Fetch latest data
          const result: any = await supabasePipeline.rpc('get_topics_paginated', {
            p_group_id: groupId,
            p_limit: 100, // Sync up to 100 topics
            p_offset: 0
          });

          if (!result.error && result.data) {
            const serverTopics: any[] = Array.isArray(result.data) ? result.data : [];
            
            // Task 11.3: Update local cache with server data (server wins on conflicts)
            for (const st of serverTopics) {
              const topic: Topic = {
                id: st.id,
                group_id: st.group_id,
                message_id: st.id,
                type: st.type,
                title: st.title,
                content: st.content,
                author: st.author_id ? {
                  id: st.author_id,
                  display_name: st.author_name,
                  avatar_url: st.author_avatar
                } : undefined,
                pseudonym: st.pseudonym,
                expires_at: st.expires_at ? new Date(st.expires_at).getTime() : null,
                views_count: st.views_count,
                likes_count: st.likes_count,
                replies_count: st.replies_count,
                unread_count: 0,
                is_anonymous: st.is_anonymous,
                is_liked_by_user: st.is_liked_by_user,
                created_at: new Date(st.created_at).getTime(),
                image_url: st.image_url
              };

              // Update cache
              await sqliteService.saveTopicToCache({
                id: topic.id,
                group_id: topic.group_id,
                message_id: topic.message_id,
                type: topic.type,
                title: topic.title || null,
                content: topic.content,
                author_id: topic.author?.id || null,
                author_name: topic.author?.display_name || null,
                author_avatar: topic.author?.avatar_url || null,
                pseudonym: topic.pseudonym || null,
                expires_at: topic.expires_at,
                views_count: topic.views_count,
                likes_count: topic.likes_count,
                replies_count: topic.replies_count,
                is_anonymous: topic.is_anonymous ? 1 : 0,
                created_at: topic.created_at,
                synced_at: Date.now()
              });
            }

            console.log(`✅ Synced ${serverTopics.length} topics from server`);
          }
        }
      } catch (error) {
        console.error('Error syncing from server:', error);
      }

      console.log('✅ Topic sync complete');

    } catch (error) {
      console.error('Error syncing topics to server:', error);
    }
  },

  /**
   * Task 7.3: Create getTopicMessages action
   * - Filter messages where topic_id matches
   * - Load from SQLite first
   * - Fetch from Supabase if needed
   */
  getTopicMessages: async (topicId: string): Promise<any[]> => {
    try {
      console.log(`📨 Fetching messages for topic ${topicId}`);

      const isNative = Capacitor.isNativePlatform();
      const isSqliteReady = isNative && await sqliteService.isReady();

      // STEP 1: Load from SQLite first (instant display)
      if (isSqliteReady) {
        try {
          // Get messages from SQLite where topic_id matches
          const cachedMessages = await sqliteService.getMessagesByTopicId(topicId);
          
          if (cachedMessages && cachedMessages.length > 0) {
            console.log(`⚡ Loaded ${cachedMessages.length} messages from cache for topic ${topicId}`);
            
            // Convert to UI format
            const messages = cachedMessages.map((msg: any) => ({
              id: msg.id,
              group_id: msg.group_id,
              user_id: msg.user_id,
              content: msg.content,
              is_ghost: msg.is_ghost === 1,
              message_type: msg.message_type,
              category: msg.category,
              parent_id: msg.parent_id,
              topic_id: msg.topic_id,
              image_url: msg.image_url,
              created_at: new Date(msg.created_at).toISOString(),
              author: msg.is_ghost === 1 ? undefined : {
                display_name: msg.author_name || 'Unknown',
                avatar_url: msg.author_avatar
              },
              pseudonym: msg.is_ghost === 1 ? msg.pseudonym : undefined,
              reactions: [],
              replies: [],
              reply_count: 0,
              delivery_status: 'sent' as const
            }));

            // Return cached messages immediately
            return messages;
          }
        } catch (error) {
          console.error('Error loading messages from cache:', error);
        }
      }

      // STEP 2: Check if we're online
      const networkStatus = await Network.getStatus();
      const isOnline = networkStatus.connected;

      if (!isOnline) {
        console.log('📵 Offline mode: No cached messages available');
        return [];
      }

      // STEP 3: Fetch from Supabase
      console.log('🌐 Fetching messages from Supabase...');
      const session = await supabasePipeline.getCachedSession();
      if (!session?.user) {
        throw new Error('Not authenticated');
      }

      const client = await supabasePipeline.getDirectClient();
      
      // Query messages where topic_id matches
      const { data: messages, error } = await client
        .from('messages')
        .select(`
          *,
          author:users!messages_user_id_fkey(display_name, avatar_url),
          pseudonym:user_pseudonyms(pseudonym)
        `)
        .eq('topic_id', topicId)
        .order('created_at', { ascending: true });

      if (error) {
        throw error;
      }

      console.log(`✅ Fetched ${messages?.length || 0} messages from Supabase`);

      // STEP 4: Convert to UI format
      const formattedMessages = (messages || []).map((msg: any) => ({
        id: msg.id,
        group_id: msg.group_id,
        user_id: msg.user_id,
        content: msg.content,
        is_ghost: msg.is_ghost,
        message_type: msg.message_type,
        category: msg.category,
        parent_id: msg.parent_id,
        topic_id: msg.topic_id,
        image_url: msg.image_url,
        created_at: msg.created_at,
        author: msg.is_ghost ? undefined : {
          display_name: msg.author?.display_name || 'Unknown',
          avatar_url: msg.author?.avatar_url
        },
        pseudonym: msg.is_ghost ? msg.pseudonym?.pseudonym : undefined,
        reactions: [],
        replies: [],
        reply_count: 0,
        delivery_status: 'sent' as const
      }));

      // STEP 5: Save to SQLite cache
      if (isSqliteReady) {
        try {
          for (const msg of formattedMessages) {
            // Save message to cache
            await sqliteService.saveMessage({
              id: msg.id,
              group_id: msg.group_id,
              user_id: msg.user_id,
              content: msg.content,
              is_ghost: msg.is_ghost ? 1 : 0,
              message_type: msg.message_type,
              category: msg.category,
              parent_id: msg.parent_id,
              topic_id: msg.topic_id,
              image_url: msg.image_url,
              created_at: new Date(msg.created_at).getTime()
            });
          }
          console.log(`✅ Saved ${formattedMessages.length} messages to cache`);
        } catch (error) {
          console.error('Error saving messages to cache:', error);
        }
      }

      return formattedMessages;

    } catch (error) {
      console.error('Error fetching topic messages:', error);
      throw error;
    }
  }
});
