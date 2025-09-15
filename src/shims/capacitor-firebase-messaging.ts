// Web shim for @capacitor-firebase/messaging to avoid bundling firebase/messaging
// Provides minimal API used in the app with no-ops

export const FirebaseMessaging = {
	requestPermissions: async () => ({ receive: 'denied' as const }),
	getToken: async () => ({ token: null as unknown as string | null }),
	addListener: async (_event: string, _listener: (...args: any[]) => void) => ({ remove: () => {} }),
};

export type PluginListenerHandle = { remove: () => void };

