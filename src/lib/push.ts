import { Capacitor } from '@capacitor/core';
import { App } from '@capacitor/app';
import { Network } from '@capacitor/network';
import { supabase } from '@/lib/supabase';
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
		await supabase.from('user_devices').upsert({
			user_id: user.id,
			platform: platform === 'web' ? 'android' : platform, // default to android for web dev
			token,
			app_version: appVersion,
			active: true,
			last_seen_at: new Date().toISOString(),
		}, { onConflict: 'token' });
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
		// Dynamic import to avoid bundling on web
		const { FirebaseMessaging } = await import('@capacitor-firebase/messaging');

		await FirebaseMessaging.requestPermissions();
		const tokenResult = await FirebaseMessaging.getToken();
		if (tokenResult?.token) {
			currentToken = tokenResult.token;
			await upsertDeviceToken(currentToken);
		}

		FirebaseMessaging.addListener('tokenReceived', async (event: any) => {
			currentToken = event.token;
			await upsertDeviceToken(currentToken);
		});

		FirebaseMessaging.addListener('messageReceived', async (event: any) => {
			try {
				const data = event?.data || {};
				const reason = data?.type === 'new_message' ? 'data' : 'other';
				console.log(`[push] wake reason=${reason}`);
				// Dispatch directly if store is ready; also fire window event to decouple
				try { useChatStore.getState().onWake?.(reason, data?.group_id); } catch {}
				window.dispatchEvent(new CustomEvent('push:wakeup', { detail: data }));
			} catch {}
		});

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
	} catch (e) {
		console.warn('Push init skipped (plugin missing or error):', e);
	}
}

export function getCurrentToken(): string | null {
	return currentToken;
}


