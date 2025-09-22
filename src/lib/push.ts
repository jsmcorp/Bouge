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

async function upsertDeviceToken(token: string): Promise<void> {
	try {
		const { user } = useAuthStore.getState();
		if (!user) return;
		const platform = Capacitor.getPlatform() === 'android' ? 'android' : (Capacitor.getPlatform() === 'ios' ? 'ios' : 'web');
		const appVersion = (window as any).APP_VERSION || 'web';
		await supabasePipeline.upsertDeviceToken({
			user_id: user.id,
			platform: platform === 'web' ? 'android' : platform, // default to android for web dev
			token,
			app_version: appVersion,
			active: true,
			last_seen_at: new Date().toISOString(),
		});
		console.log(`[push] token:registered ${platform} ${truncateToken(token)}`);
	} catch (e) {
		console.warn('Push token upsert failed:', e);
	}
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
							await upsertDeviceToken(currentToken);
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
					await upsertDeviceToken(currentToken);
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
				await upsertDeviceToken(currentToken);
			}
		});

		FirebaseMessaging.addListener('notificationReceived', async (event: any) => {
			try {
				const data = event?.data || {};
				const reason = data?.type === 'new_message' ? 'data' : 'other';
				console.log(`[push] wake reason=${reason}`);
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
 		 await upsertDeviceToken(currentToken);
    	} else {
      // Try to fetch a new token now that we are authenticated
      	const tokenResult = await FirebaseMessaging.getToken();
      	if (tokenResult?.token) {
        currentToken = tokenResult.token;
        if (currentToken) {
          console.log('[push] token received(after-auth):', truncateToken(currentToken));
          await upsertDeviceToken(currentToken);
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
