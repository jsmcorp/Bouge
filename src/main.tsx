import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.tsx';
import './index.css';
import { App as CapApp } from '@capacitor/app';
import { Network } from '@capacitor/network';
import { initPush } from '@/lib/push';
import { useChatStore } from '@/store/chatstore_refactored';

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

	// App resume
	CapApp.addListener('appStateChange', ({ isActive }) => {
		if (isActive) {
			try { useChatStore.getState().onWake?.('resume'); } catch {}
		}
	});

	// Some Android builds emit 'resume' separately; handle it too
	CapApp.addListener('resume', () => {
		try { useChatStore.getState().onWake?.('resume'); } catch {}
	});

	// Network online
	Network.addListener('networkStatusChange', (status) => {
		if (status.connected) {
			try { useChatStore.getState().onWake?.('network'); } catch {}
		}
	});

	// Push wake bridge
	window.addEventListener('push:wakeup', (e: any) => {
		try {
			const detail = e?.detail || {};
			useChatStore.getState().onWake?.(detail?.type || 'data', detail?.group_id);
		} catch {}
	});
})();
