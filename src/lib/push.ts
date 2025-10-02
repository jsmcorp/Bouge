import { Capacitor } from '@capacitor/core';
import { App } from '@capacitor/app';
import { Network } from '@capacitor/network';
import { supabasePipeline } from '@/lib/supabasePipeline';
import { FEATURES_PUSH } from '@/lib/featureFlags';
import { useAuthStore } from '@/store/authStore';
import { useChatStore } from '@/store/chatstore_refactored';

// Optional dependency: @capacitor-firebase/messaging
// We import dynamically to keep web builds working without the plugin

let currentToken: string | null = null;

// CRITICAL: Store listener handles to prevent garbage collection
// If these are garbage collected, the listeners are removed!
const listenerHandles: any[] = [];

// ============================================================================
// CRITICAL FIX: Single shared Promise for FirebaseMessaging import
// This ensures we only import once and all code waits for the same Promise
// ============================================================================
let firebaseMessagingPromise: Promise<any> | null = null;
let listenersRegistered = false;

function getFirebaseMessaging(): Promise<any> {
	if (!firebaseMessagingPromise) {
		console.log('[push] 🚀 FIRST IMPORT: Starting @capacitor-firebase/messaging import');
		firebaseMessagingPromise = import('@capacitor-firebase/messaging')
			.then((module) => {
				console.log('[push] ✅ FirebaseMessaging module imported successfully');
				return module;
			})
			.catch((err) => {
				console.error('[push] ❌ CRITICAL: Failed to import @capacitor-firebase/messaging:', err);
				throw err;
			});
	}
	return firebaseMessagingPromise;
}

// ============================================================================
// CRITICAL: Register listeners at MODULE LOAD TIME (EARLIEST POSSIBLE POINT)
// This ensures listeners are active BEFORE any async operations
// ============================================================================
if (Capacitor.isNativePlatform()) {
	console.log('[push] 🚀 CRITICAL: Module load - starting listener registration');

	// Start import and listener registration immediately
	getFirebaseMessaging().then(({ FirebaseMessaging }) => {
		console.log('[push] 🎯 CRITICAL: Registering all listeners NOW');

		// Register notificationReceived listener
		FirebaseMessaging.addListener('notificationReceived', async (notification: any) => {
			console.log('[push] 🔔 CRITICAL: FirebaseMessaging.notificationReceived FIRED!', notification);
			console.log('[push] 🔔 Raw notification object:', JSON.stringify(notification));

			try {
				// Data is in notification.data for FirebaseMessaging plugin
				const data = notification?.data || notification?.notification?.data || {};
				console.log('[push] 🔔 Extracted data:', JSON.stringify(data));

				if (!data.type && !data.message_id) {
					console.warn('[push] ⚠️ Notification missing required fields (type/message_id), treating as generic wake');
				}

				// Call handler (defined below)
				await handleNotificationReceived(data);
			} catch (error) {
				console.error('[push] ❌ Error handling FirebaseMessaging notification:', error);
			}
		}).then((handle: any) => {
			listenerHandles.push(handle);
			console.log('[push] ✅ CRITICAL: notificationReceived listener registered and handle stored!');
		}).catch((err: any) => {
			console.error('[push] ❌ CRITICAL: Failed to register notificationReceived listener:', err);
		});

		// Register tokenReceived listener
		FirebaseMessaging.addListener('tokenReceived', async (event: any) => {
			currentToken = event.token;
			console.log('[push] 🔔 FirebaseMessaging.tokenReceived fired:', truncateToken(currentToken || ''));
			if (typeof currentToken === 'string') {
				backgroundUpsertDeviceToken(currentToken);
			}
		}).then((handle: any) => {
			listenerHandles.push(handle);
			console.log('[push] ✅ tokenReceived listener registered and handle stored!');
		}).catch((err: any) => {
			console.error('[push] ❌ Failed to register tokenReceived listener:', err);
		});

		// Register notificationActionPerformed listener
		FirebaseMessaging.addListener('notificationActionPerformed', (event: any) => {
			try {
				const data = event?.notification?.data || {};
				const groupId = data?.group_id;
				if (groupId) {
					console.log('[push] wake reason=notification_tap');
					window.dispatchEvent(new CustomEvent('push:wakeup', { detail: { type: 'tap', group_id: groupId } }));
				}
			} catch {}
		}).then((handle: any) => {
			listenerHandles.push(handle);
			console.log('[push] ✅ notificationActionPerformed listener registered and handle stored!');

			// Mark listeners as registered
			listenersRegistered = true;
			console.log('[push] ✅✅✅ ALL LISTENERS REGISTERED SUCCESSFULLY ✅✅✅');
		}).catch((err: any) => {
			console.error('[push] ❌ Failed to register notificationActionPerformed listener:', err);
		});
	}).catch((err: any) => {
		console.error('[push] ❌ CRITICAL: Failed to import FirebaseMessaging for listener registration:', err);
	});
}
// ============================================================================

function truncateToken(token: string): string {
	if (!token) return '';
	return token.length <= 8 ? token : `${token.slice(0, 6)}…`;
}

// Background upsert manager: serialize per-token, 5s per attempt, jittered backoff up to 60s
const inflightUpserts = new Map<string, Promise<void>>();
const successfulTokens = new Set<string>();
const backoffByToken = new Map<string, number>();

async function backgroundUpsertDeviceToken(token: string): Promise<void> {
	if (!token) return;
	if (successfulTokens.has(token)) return;
	if (inflightUpserts.has(token)) return; // coalesce in-flight

	const attempt = async (): Promise<void> => {
		const startedAt = Date.now();
		try {
			const { user } = useAuthStore.getState();
			if (!user) return;
			const platform = Capacitor.getPlatform() === 'android' ? 'android' : (Capacitor.getPlatform() === 'ios' ? 'ios' : 'web');
			const appVersion = (window as any).APP_VERSION || 'web';

			// Per-attempt 5s timeout
			const timeoutMs = 5000;
			const timeout = new Promise<never>((_, reject) => setTimeout(() => reject(new Error('device-token upsert timeout')), timeoutMs));
			const exec = supabasePipeline.upsertDeviceToken({
				user_id: user.id,
				platform: platform === 'web' ? 'android' : platform,
				token,
				app_version: appVersion,
				active: true,
				last_seen_at: new Date().toISOString(),
			});
			await Promise.race([exec, timeout]);
			console.log(`[push] ${new Date().toISOString()} token:registered ${platform} ${truncateToken(token)}`);
			successfulTokens.add(token);
		} catch (e:any) {
			const elapsed = Date.now() - startedAt;
			console.warn(`[push] ${new Date().toISOString()} upsert device token failed after ${elapsed}ms:`, e?.message || e);
			// Schedule retry with jittered exponential backoff up to 60s
			const prev = backoffByToken.get(token) || 2000;
			const next = Math.min(prev * 2, 60000);
			const jitter = Math.floor(Math.random() * 500);
			backoffByToken.set(token, next);
			setTimeout(() => {
				inflightUpserts.delete(token);
				backgroundUpsertDeviceToken(token).catch(() => {});
			}, next + jitter);
			return;
		}
		finally {
			// If succeeded, clear inflight
			if (successfulTokens.has(token)) {
				inflightUpserts.delete(token);
			}
		}
	};

	const p = attempt();
	inflightUpserts.set(token, p);
}

// Maintain public interface, but make it non-blocking
async function upsertDeviceToken(token: string): Promise<void> {
	try { backgroundUpsertDeviceToken(token); } catch {}
}

/**
 * Shared handler for notification received events
 * Handles FCM notifications when app is in foreground
 */
async function handleNotificationReceived(data: any): Promise<void> {
	try {
		const reason = data?.type === 'new_message' ? 'data' : 'other';
		console.log(`[push] Notification received, reason=${reason}, data:`, data);

		// Fetch and store message immediately when notification arrives
		if (data.type === 'new_message' && data.message_id && data.group_id) {
			console.log(`[push] Fetching message ${data.message_id} in background`);
			try {
				const { backgroundMessageSync } = await import('@/lib/backgroundMessageSync');
				const success = await backgroundMessageSync.fetchAndStoreMessage(data.message_id, data.group_id);

				if (success) {
					// Update unread count
					const { unreadTracker } = await import('@/lib/unreadTracker');
					await unreadTracker.triggerCallbacks(data.group_id);

					// Show in-app notification if not in active chat
					const activeGroupId = useChatStore.getState().activeGroup?.id;
					if (activeGroupId !== data.group_id) {
						// Show toast notification
						const { toast } = await import('sonner');
						toast.info(data.group_name || 'New message', {
							description: data.message_preview || 'Tap to view',
							duration: 5000,
							action: {
								label: 'View',
								onClick: () => {
									// Navigate to group
									window.location.hash = `#/chat/${data.group_id}`;
								}
							}
						});
					}
				}
			} catch (importErr) {
				console.error('[push] Failed to handle notification:', importErr);
			}
		}

		// Dispatch events for backward compatibility
		try { useChatStore.getState().onWake?.(reason, data?.group_id); } catch {}
		window.dispatchEvent(new CustomEvent('push:wakeup', { detail: data }));
	} catch (error) {
		console.error('[push] Error in handleNotificationReceived:', error);
	}
}

export async function initPush(): Promise<void> {
	console.log('[push] 🚀 initPush() called');

	if (!FEATURES_PUSH.enabled || FEATURES_PUSH.killSwitch) {
		console.log('[push] ❌ Push/resync feature disabled by flag');
		return;
	}
	if (!Capacitor.isNativePlatform()) {
		console.log('[push] ❌ Push init: non-native platform, skipping FCM/APNs registration');
		return;
	}

	console.log('[push] ✅ Starting push initialization...');

	try {
		// CRITICAL: Wait for the SAME FirebaseMessaging import that's registering listeners
		// This ensures we don't race with listener registration
		console.log('[push] 📦 Waiting for FirebaseMessaging import (shared with listener registration)...');
		const { FirebaseMessaging } = await getFirebaseMessaging();
		console.log('[push] ✅ FirebaseMessaging imported successfully');

		// CRITICAL: Wait for listeners to be registered before proceeding
		// This ensures listeners are ready before we request permissions or get token
		if (!listenersRegistered) {
			console.log('[push] ⏳ Waiting for listeners to be registered...');
			// Poll until listeners are registered (with timeout)
			const startTime = Date.now();
			while (!listenersRegistered && (Date.now() - startTime) < 5000) {
				await new Promise(resolve => setTimeout(resolve, 100));
			}
			if (listenersRegistered) {
				console.log('[push] ✅ Listeners confirmed registered, proceeding with initialization');
			} else {
				console.warn('[push] ⚠️ Timeout waiting for listeners, proceeding anyway');
			}
		} else {
			console.log('[push] ✅ Listeners already registered, proceeding with initialization');
		}

		// Android 13+ requires runtime POST_NOTIFICATIONS permission.
		// Request permissions via FirebaseMessaging only (no PushNotifications fallback)
		let permBefore: any = null;
		let permAfter: any = null;
		try { permBefore = await (FirebaseMessaging as any).checkPermissions?.(); } catch {}
		console.log('[push] permission before(FirebaseMessaging):', permBefore?.receive || 'unknown');
		let granted = permBefore?.receive === 'granted';
		if (!granted) {
			try {
				permAfter = await FirebaseMessaging.requestPermissions();
				console.log('[push] permission after(FirebaseMessaging):', permAfter?.receive || 'unknown');
				granted = permAfter?.receive === 'granted';
			} catch (e) {
				console.warn('[push] FirebaseMessaging.requestPermissions failed', e);
			}
		}
		if (!granted) {
			console.warn('[push] ⚠️ Notification permissions not granted. Push notifications may not work.');
		}

		// Try to get FCM token via FirebaseMessaging as primary path regardless of permission outcome
		try {
			const tokenResult = await FirebaseMessaging.getToken();
			if (tokenResult?.token) {
				currentToken = tokenResult.token;
				console.log('[push] token received(firebase):', truncateToken(currentToken || ''));
				if (typeof currentToken === 'string') {
					backgroundUpsertDeviceToken(currentToken);
				}
			} else {
				console.log('[push] FirebaseMessaging.getToken returned empty');
			}
		} catch (e) {
			console.warn('[push] ⚠️ FirebaseMessaging.getToken failed', e);
		}

		console.log('[push] ✅ Push initialization complete');

		// App resume should nudge outbox processing (non-blocking)
		try {
			App.addListener('resume', async () => {
				try {
					const { triggerOutboxProcessing } = await import('@/store/chatstore_refactored/offlineActions');
					triggerOutboxProcessing('app-resume', 'high');
				} catch {}
			});
		} catch {}

		// App launch from notification tap
		App.addListener('appUrlOpen', (data) => {
			try {
				const url = new URL(data.url);
				const groupId = url.searchParams.get('group_id');
				if (groupId) {
					console.log('[push] wake reason=notification_tap');
					window.dispatchEvent(new CustomEvent('push:wakeup', { detail: { type: 'tap', group_id: groupId } }));
				}
			} catch {}
		});

		// Mark online changes for extra wakeups
		Network.addListener('networkStatusChange', (status) => {
			if (status.connected) {
				window.dispatchEvent(new CustomEvent('network:online'));
			}
		});

		// Associate token after auth events to ensure row exists in user_devices
		try {
		(await supabasePipeline.onAuthStateChange(async (event, session) => {
 			 if (session?.user?.id && (event === 'SIGNED_IN' || event === 'TOKEN_REFRESHED' || event === 'INITIAL_SESSION')) {
    		// If we already have a token, upsert it
   		 if (currentToken) {
 		 backgroundUpsertDeviceToken(currentToken);
    	} else {
      // Try to fetch a new token now that we are authenticated
      	const tokenResult = await FirebaseMessaging.getToken();
      	if (tokenResult?.token) {
        currentToken = tokenResult.token;
        if (currentToken) {
          console.log('[push] token received(after-auth):', truncateToken(currentToken));
          backgroundUpsertDeviceToken(currentToken);
        }
      }
    }
  }
})).data.subscription;

		} catch {}
		console.log('[push] ✅ Push initialization completed successfully');
	} catch (e) {
		console.error('[push] ❌ Push init failed (plugin missing or error):', e);
		console.error('[push] ❌ Error details:', JSON.stringify(e, null, 2));
	}
}

export function getCurrentToken(): string | null {
	return currentToken;
}




// Debug helper: force fetch and upsert a fresh FCM token (dev only)
export async function forceRefreshPushToken(): Promise<string | undefined> {
	try {
		const { FirebaseMessaging } = await import('@capacitor-firebase/messaging');
		const res = await FirebaseMessaging.getToken();
		const tok = res?.token;
		if (!tok) {
			console.log('[push] Failed to get FCM token.');
			return undefined;
		}
		console.log('[push] Upserting new FCM token:', truncateToken(tok));
		await upsertDeviceToken(tok);
		console.log('[push] FCM token upserted successfully.');
		return tok;
	} catch (e) {
		console.warn('forceRefreshPushToken error', e);
		return undefined;
	}
}

if (typeof window !== 'undefined') {
	// Attach a global for ad-hoc testing from devtools: await window.__debugUpsertPushToken()
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	(window as any).__debugUpsertPushToken = forceRefreshPushToken;
}
