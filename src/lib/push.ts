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

export async function initPush(): Promise<void> {
	if (!FEATURES_PUSH.enabled || FEATURES_PUSH.killSwitch) {
		console.log('Push/resync feature disabled by flag');
		return;
	}
	if (!Capacitor.isNativePlatform()) {
		console.log('Push init: non-native platform, skipping FCM/APNs registration');
		return;
	}

	try {
		// Dynamic import that Vite can transform to a chunk
		const { FirebaseMessaging } = await import('@capacitor-firebase/messaging');

		// Android 13+ requires runtime POST_NOTIFICATIONS permission.
		// Prefer FirebaseMessaging permission API; if not granted, fallback to Capacitor PushNotifications to prompt/register.
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
				console.warn('[push] FirebaseMessaging.requestPermissions threw; will try PushNotifications fallback', e);
			}
		}
		if (!granted) {
			try {
				const { PushNotifications } = await import('@capacitor/push-notifications');
				const capPermBefore = await PushNotifications.checkPermissions();
				console.log('[push] permission before(PushNotifications):', capPermBefore.receive);
				if (capPermBefore.receive !== 'granted') {
					const capPermAfter = await PushNotifications.requestPermissions();
					console.log('[push] permission after(PushNotifications):', capPermAfter.receive);
					granted = capPermAfter.receive === 'granted';
				}
				await PushNotifications.register();
				PushNotifications.addListener('registration', async (token: any) => {
					try {
						currentToken = (token as any)?.value || (token as any)?.token || '';
						if (currentToken) {
							console.log('[push] token received(core):', truncateToken(currentToken));
							// Fire-and-forget; do not block UI or send pipeline
						backgroundUpsertDeviceToken(currentToken);
						}
					} catch (e) {
						console.warn('[push] registration listener upsert failed', e);
					}
				});
				(PushNotifications as any).addListener('registrationError', (e: any) => {
					console.warn('[push] PushNotifications registrationError', e);
				});
			} catch (e) {
				console.warn('[push] PushNotifications fallback failed', e);
			}
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
			console.warn('[push] FirebaseMessaging.getToken failed', e);
		}

		FirebaseMessaging.addListener('tokenReceived', async (event: any) => {
			currentToken = event.token;
			if (typeof currentToken === 'string') {
				backgroundUpsertDeviceToken(currentToken);
			}
		});


			// App resume should nudge outbox processing (non-blocking)
			try {
				App.addListener('resume', async () => {
					try {
						const { triggerOutboxProcessing } = await import('@/store/chatstore_refactored/offlineActions');
						triggerOutboxProcessing('app-resume', 'high');
					} catch {}
				});
			} catch {}

		FirebaseMessaging.addListener('notificationReceived', async (event: any) => {
			try {
				const data = event?.data || {};
				const reason = data?.type === 'new_message' ? 'data' : 'other';
				console.log(`[push] wake reason=${reason}`);

				// NEW: Fetch and store message immediately when notification arrives
				if (data.type === 'new_message' && data.message_id && data.group_id) {
					console.log(`[push] Fetching message ${data.message_id} in background`);
					try {
						const { backgroundMessageSync } = await import('@/lib/backgroundMessageSync');
						// Fire and forget - don't block notification handling
						backgroundMessageSync.fetchAndStoreMessage(data.message_id, data.group_id).catch(err => {
							console.error('[push] Background message fetch failed:', err);
						});
					} catch (importErr) {
						console.error('[push] Failed to import backgroundMessageSync:', importErr);
					}
				}

				// Dispatch directly if store is ready; also fire window event to decouple
				try { useChatStore.getState().onWake?.(reason, data?.group_id); } catch {}
				window.dispatchEvent(new CustomEvent('push:wakeup', { detail: data }));
			} catch {}
		});

		// Notification tap (explicit listener provided by plugin)
		try {
			FirebaseMessaging.addListener('notificationActionPerformed', (event: any) => {
				try {
					const data = event?.notification?.data || {};
					const groupId = data?.group_id;
					if (groupId) {
						console.log('[push] wake reason=notification_tap');
						window.dispatchEvent(new CustomEvent('push:wakeup', { detail: { type: 'tap', group_id: groupId } }));
					}
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
	} catch (e) {
		console.warn('Push init skipped (plugin missing or error):', e);
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
