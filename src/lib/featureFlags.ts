// Centralized feature flags and tunables for push + resync

export type PushResyncConfig = {
	enabled: boolean;
	killSwitch: boolean;
	// Tunables
	sync: {
		maxBatch: number;
	};
	realtime: {
		retryBackoff: number[];
	};
	auth: {
		refreshTimeoutMs: number;
	};
	outbox: {
		retryShortDelayMs: number;
	};
};

export const DEFAULT_FEATURES: { push_resync: PushResyncConfig } = {
	push_resync: {
		enabled: true,
		killSwitch: false,
		sync: {
			maxBatch: 200,
		},
		realtime: {
			retryBackoff: [1500, 3000, 6000],
		},
		auth: {
			refreshTimeoutMs: 1800,
		},
		outbox: {
			retryShortDelayMs: 700,
		},
	},
};

// Read overrides from localStorage (and optionally remote-config in the future)
export function loadFeatureOverrides(): Partial<typeof DEFAULT_FEATURES> | null {
	try {
		const raw = localStorage.getItem('app:featureOverrides');
		if (!raw) return null;
		return JSON.parse(raw);
	} catch {
		return null;
	}
}

export function getFeatures(): typeof DEFAULT_FEATURES {
	const overrides = loadFeatureOverrides();
	if (!overrides) return DEFAULT_FEATURES;
	return deepMerge(DEFAULT_FEATURES, overrides);
}

export const FEATURES_PUSH = getFeatures().push_resync;

function deepMerge<T>(base: T, override: Partial<T>): T {
	if (!override) return base;
	const result: any = Array.isArray(base) ? [...(base as any)] : { ...(base as any) };
	for (const key of Object.keys(override as any)) {
		const b: any = (base as any)[key];
		const o: any = (override as any)[key];
		if (o && typeof o === 'object' && !Array.isArray(o)) {
			result[key] = deepMerge(b, o);
		} else {
			result[key] = o;
		}
	}
	return result as T;
}


