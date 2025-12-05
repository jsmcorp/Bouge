import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.tsx';
import './index.css';
import { App as CapApp } from '@capacitor/app';
import { Network } from '@capacitor/network';
import { initPush } from '@/lib/push';
import { useChatStore } from '@/store/chatstore_refactored';
// Import WhatsApp-style connection system
import { whatsappConnection } from '@/lib/whatsappStyleConnection';
import { mobileLogger } from '@/lib/mobileLogger';
// Import topic debug utilities (Task 14.3)
import '@/lib/topicDebug';
// Import connectivity tester for debugging
// Dev-only connectivity tester to avoid extra startup cost in production
// Moved to dynamic import inside the async IIFE below

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>
);

// Initialize push and listeners (non-blocking)
console.log('[main] 🚀 IIFE starting - about to initialize push notifications');
(async () => {
	console.log('[main] 🔥 Inside async IIFE - before try block');
	try {
		console.log('[main] 📱 Initializing push notifications...');
		await initPush();
		console.log('[main] ✅ Push notifications initialized');
	} catch (error) {
		console.error('[main] ❌ Failed to initialize push notifications:', error);
		console.error('[main] ❌ Error stack:', error);
	}

		// Dev-only: load connectivity tester
		if (import.meta.env.DEV) {
			try { await import('@/lib/connectivityTest'); } catch {}
		}


	// Initialize WhatsApp-style connection system
	mobileLogger.log('info', 'general', 'Initializing WhatsApp-style connection system');

	// Get initial network status and update store
	try {
		const networkStatus = await Network.getStatus();
		const chatStore = useChatStore.getState();
		mobileLogger.log('info', 'network', `Initial network status: ${networkStatus.connected ? 'online' : 'offline'}`, {
			connectionType: networkStatus.connectionType
		});

		// Set initial network status in store
		chatStore.setOnlineStatus?.(networkStatus.connected);

		// Set initial connection status based on network
		if (networkStatus.connected) {
			whatsappConnection.setConnectionState('connecting', 'Initializing connection...');
		} else {
			whatsappConnection.setConnectionState('disconnected', 'No network connection');
		}
	} catch (error) {
		mobileLogger.log('error', 'network', 'Failed to get initial network status', { error });
		// Default to offline to be safe
		const chatStore = useChatStore.getState();
		chatStore.setOnlineStatus?.(false);
		whatsappConnection.setConnectionState('disconnected', 'Network status unknown');
	}

	// Setup connection status monitoring
	whatsappConnection.onStatusChange((status) => {
		mobileLogger.log('info', 'connection', `Connection status: ${status.state} - ${status.message}`, {
			progress: status.progress,
			isUserVisible: status.isUserVisible,
		});

		// Update chat store connection status
		try {
			const chatStore = useChatStore.getState();
			chatStore.setConnectionStatus?.(status.state === 'connected' ? 'connected' :
				status.state === 'connecting' || status.state === 'reconnecting' ? 'connecting' : 'disconnected');
		} catch (error) {
			mobileLogger.log('error', 'connection', 'Failed to update chat store status', { error });
		}
	});

	// Setup reconnection metrics monitoring
	whatsappConnection.onReconnectionComplete((metrics) => {
		mobileLogger.log('info', 'timing', 'Reconnection completed', metrics);
	});

	// Debounced resume handler to prevent duplicate calls
	let lastResumeTime = 0;
	let resumeTimeout: NodeJS.Timeout | null = null;

	const handleAppResume = async (source: string) => {
		const now = Date.now();
		const timeSinceLastResume = now - lastResumeTime;

		mobileLogger.log('info', 'device-lifecycle', `App resume from ${source}`, {
			timeSinceLastResume,
			source
		});

		// Clear any pending resume call
		if (resumeTimeout) {
			clearTimeout(resumeTimeout);
			resumeTimeout = null;
		}

		// Debounce rapid resume events (common during lock/unlock cycles)
		if (timeSinceLastResume < 3000) {
			mobileLogger.log('debug', 'device-lifecycle', 'Resume debounced (too soon after last resume)');
			return;
		}

		lastResumeTime = now;

		// Trigger outbox processing and light session recovery on app resume (non-blocking)
		(async () => {
			try {
				const { supabasePipeline } = await import('@/lib/supabasePipeline');
				await supabasePipeline.onAppResume();
				mobileLogger.log('info', 'general', 'Triggered outbox processing on app resume');
			} catch (error) {
				mobileLogger.log('error', 'general', 'Failed to trigger outbox on app resume', { error });
			}
		})();

		// Sync unread counts from Supabase on app resume (runs immediately, doesn't wait for session recovery)
		try {
			console.log('[main] 📱 App resumed - syncing unread counts from Supabase');
			console.log('[main] 🔄 Importing unreadTracker...');
			const { unreadTracker } = await import('@/lib/unreadTracker');
			console.log('[main] ✅ unreadTracker imported');
			
			console.log('[main] 🔄 Fetching fresh counts from Supabase (fast mode - uses cached session)...');
			const freshCounts = await unreadTracker.getAllUnreadCountsFast();
			console.log('[main] ✅ Got fresh counts from Supabase:', Array.from(freshCounts.entries()));
			
			// Update UI if helper is available
			if (typeof (window as any).__updateUnreadCount === 'function') {
				console.log('[main] 🔄 Updating UI with fresh counts...');
				for (const [groupId, count] of freshCounts.entries()) {
					(window as any).__updateUnreadCount(groupId, count);
					console.log('[main] ✅ Updated count for group:', groupId, '→', count);
				}
				console.log('[main] ✅ Unread counts synced to UI');
			} else {
				console.log('[main] ℹ️ UI helper not ready, Sidebar will fetch on mount');
			}
		} catch (error) {
			console.error('[main] ❌ Error syncing unread counts on resume:', error);
			console.error('[main] ❌ Error details:', {
				message: (error as any)?.message,
				stack: (error as any)?.stack,
				error
			});
		}

		// The WhatsApp-style connection system will handle the reconnection
		// We just need to mark activity and let the device lock detection handle it
		mobileLogger.log('info', 'device-lifecycle', `App resume processed from ${source}`);
	};

	// App resume - primary handler
	CapApp.addListener('appStateChange', ({ isActive }) => {
		if (isActive) {
			handleAppResume('appStateChange');
		}
	});

	// Some Android builds emit 'resume' separately; handle it too but with same debouncing
	CapApp.addListener('resume', () => {
		handleAppResume('resume');
	});

	// Network status changes - simplified with reconnection manager
	Network.addListener('networkStatusChange', async (status) => {
		try {
			const chatStore = useChatStore.getState();
			mobileLogger.logNetworkStatusChange(status.connected, status.connectionType);

			// Update online status in store
			chatStore.setOnlineStatus?.(status.connected);

			if (status.connected) {
				// Network came online: mirror "reopen chat" behavior in a safe, idempotent way
				mobileLogger.log('info', 'network', 'Network reconnected');
				try {
					// Use store's unified handler to notify pipeline, trigger outbox, and kick reconnection
					chatStore.onNetworkOnline?.();
				} catch (err) {
					mobileLogger.log('warn', 'network', 'onNetworkOnline handler failed', { err });
				}
				// After a short delay, fast-path resubscribe and refetch messages for the active chat (like re-entering screen)
				setTimeout(() => {
					try {
						const st = useChatStore.getState();
						const gid = st?.activeGroup?.id;
						if (gid) {
							st.ensureSubscribedFastPath?.(gid);
							st.fetchMessages?.(gid);
						}
					} catch (e) {
						mobileLogger.log('warn', 'network', 'Post-reconnect fast-path failed', { e });
					}
				}, 600);
			} else {
				// Handle network going offline
				mobileLogger.log('warn', 'network', 'Network disconnected');
				whatsappConnection.setConnectionState('disconnected', 'No network connection');
				chatStore.setConnectionStatus?.('disconnected');
				chatStore.cleanupRealtimeSubscription?.();
			}
		} catch (error) {
			mobileLogger.log('error', 'network', 'Network status change handler error', { error });
		}
	});

	// Push wake bridge - WHATSAPP-STYLE instant message handling
	window.addEventListener('push:wakeup', (e: any) => {
		try {
			const detail = e?.detail || {};
			console.log('📱 Push wakeup received:', detail);
			// Call onWake handler for instant message display
			const onWake = useChatStore.getState().onWake;
			if (typeof onWake === 'function') {
				onWake(detail?.type || 'data', detail?.group_id).catch((err: any) => {
					console.error('Push wakeup handler error:', err);
				});
			} else {
				console.warn('⚠️ onWake handler not available in chatStore');
			}
		} catch (error) {
			console.error('Push wakeup handler error:', error);
		}
	});
})();
