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
// Import connectivity tester for debugging
// Dev-only connectivity tester to avoid extra startup cost in production
// Moved to dynamic import inside the async IIFE below

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>
);

// Initialize push and listeners (non-blocking)
(async () => {
	try {
		initPush();
	} catch {}

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

	const handleAppResume = (source: string) => {
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
				// Handle network coming online with single reconnection manager
				const { reconnectionManager } = await import('@/lib/reconnectionManager');
				mobileLogger.log('info', 'network', 'Network reconnected');

				reconnectionManager.reconnect('network-online').catch(error => {
					mobileLogger.log('error', 'network', 'Network reconnection failed', { error });
					whatsappConnection.setConnectionState('disconnected', 'Connection failed');
				});
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

	// Push wake bridge
	window.addEventListener('push:wakeup', (e: any) => {
		try {
			const detail = e?.detail || {};
			console.log('📱 Push wakeup received:', detail);
			useChatStore.getState().onWake?.(detail?.type || 'data', detail?.group_id);
		} catch (error) {
			console.error('Push wakeup handler error:', error);
		}
	});
})();
