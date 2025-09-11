// Deno Edge Function for push fan-out using FCM HTTP v1 (OAuth2 Service Account)

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4';

type Payload = {
	message_id: string;
	group_id: string;
	sender_id: string;
	created_at: string;
};

const PROJECT_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
// Preferred FCM v1 credentials
const GCP_CLIENT_EMAIL = Deno.env.get('GCP_CLIENT_EMAIL') || Deno.env.get('GOOGLE_CLIENT_EMAIL') || '';
const GCP_PRIVATE_KEY = (Deno.env.get('GCP_PRIVATE_KEY') || Deno.env.get('GOOGLE_PRIVATE_KEY') || '').replace(/\\n/g, '\n');
const FCM_PROJECT_ID = Deno.env.get('FCM_PROJECT_ID') || Deno.env.get('GOOGLE_PROJECT_ID') || Deno.env.get('FIREBASE_PROJECT_ID') || '';
// Legacy fallback key
const FCM_SERVER_KEY = Deno.env.get('FCM_SERVER_KEY') || '';

const db = createClient(PROJECT_URL, SERVICE_ROLE);

async function getRecipients(groupId: string, senderId: string): Promise<string[]> {
	const { data, error } = await db
		.from('group_members')
		.select('user_id')
		.eq('group_id', groupId);
	if (error) throw error;
	return (data || [])
		.map((r: any) => r.user_id)
		.filter((uid: string) => uid !== senderId);
}

async function getActiveTokens(userIds: string[]): Promise<Array<{ user_id: string; token: string }>> {
	const { data, error } = await db
		.from('user_devices')
		.select('user_id, token')
		.in('user_id', userIds)
		.eq('active', true);
	if (error) throw error;
	return data as any[];
}

async function deactivateTokens(tokens: string[]): Promise<void> {
	if (tokens.length === 0) return;
	await db.from('user_devices').update({ active: false }).in('token', tokens);
}

// ===== FCM v1 OAuth token minting and send =====
let tokenCache: { token: string; expiresAt: number } | null = null;

function base64UrlEncode(input: Uint8Array): string {
	let str = btoa(String.fromCharCode(...input));
	return str.replace(/=+$/g, '').replace(/\+/g, '-').replace(/\//g, '_');
}

async function importPrivateKey(pkcs8Pem: string): Promise<CryptoKey> {
	const pem = pkcs8Pem
		.replace('-----BEGIN PRIVATE KEY-----', '')
		.replace('-----END PRIVATE KEY-----', '')
		.replace(/\r?\n|\r/g, '');
	const raw = Uint8Array.from(atob(pem), c => c.charCodeAt(0));
	return crypto.subtle.importKey('pkcs8', raw, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['sign']);
}

async function getAccessToken(): Promise<string | null> {
	try {
		if (!GCP_CLIENT_EMAIL || !GCP_PRIVATE_KEY) return null;
		const now = Math.floor(Date.now() / 1000);
		if (tokenCache && tokenCache.expiresAt - 60 > now) return tokenCache.token;

		const header = new TextEncoder().encode(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
		const payload = new TextEncoder().encode(JSON.stringify({
			iss: GCP_CLIENT_EMAIL,
			scope: 'https://www.googleapis.com/auth/firebase.messaging',
			aud: 'https://oauth2.googleapis.com/token',
			exp: now + 3600,
			iat: now,
		}));
		const signingInput = `${base64UrlEncode(header)}.${base64UrlEncode(payload)}`;
		const key = await importPrivateKey(GCP_PRIVATE_KEY);
		const signature = new Uint8Array(await crypto.subtle.sign({ name: 'RSASSA-PKCS1-v1_5' }, key, new TextEncoder().encode(signingInput)));
		const jwt = `${signingInput}.${base64UrlEncode(signature)}`;

		const params = new URLSearchParams();
		params.set('grant_type', 'urn:ietf:params:oauth:grant-type:jwt-bearer');
		params.set('assertion', jwt);

		const resp = await fetch('https://oauth2.googleapis.com/token', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: params.toString() });
		if (!resp.ok) {
			console.error('OAuth token exchange failed', resp.status, await resp.text());
			return null;
		}
		const tokenJson = await resp.json();
		tokenCache = { token: tokenJson.access_token, expiresAt: now + (tokenJson.expires_in || 3600) };
		return tokenCache.token;
	} catch (e) {
		console.error('getAccessToken error', e);
		return null;
	}
}

async function sendFcmV1(tokens: string[], data: Record<string, string>): Promise<void> {
	if (!FCM_PROJECT_ID || tokens.length === 0) return;
	const accessToken = await getAccessToken();
	if (!accessToken) {
		console.error('FCM v1 access token unavailable');
		return;
	}
	const url = `https://fcm.googleapis.com/v1/projects/${FCM_PROJECT_ID}/messages:send`;
	const invalid: string[] = [];
	for (const token of tokens) {
		const body = {
			message: {
				token,
				data,
				notification: {
					title: 'New message',
					body: 'You have a new message',
				},
				android: {
					priority: 'HIGH',
				},
				apns: {
					headers: { 'apns-priority': '10' },
					payload: { aps: { sound: 'default' } },
				},
			}
		};
		const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${accessToken}` }, body: JSON.stringify(body) });
		if (!res.ok) {
			const txt = await res.text();
			if (/UNREGISTERED|InvalidArgument/i.test(txt)) invalid.push(token);
			console.error('FCM v1 send error', res.status, txt);
		}
	}
	if (invalid.length > 0) await deactivateTokens(invalid);
}

async function sendFcm(tokens: string[], data: Record<string, string>): Promise<void> {
	// Prefer v1 if creds are configured; fallback to legacy key if not
	if (GCP_CLIENT_EMAIL && GCP_PRIVATE_KEY && FCM_PROJECT_ID) {
		return await sendFcmV1(tokens, data);
	}
	if (!FCM_SERVER_KEY || tokens.length === 0) return;
	const url = 'https://fcm.googleapis.com/fcm/send';
	const payload = {
		registration_ids: tokens,
		priority: 'high',
		data,
		notification: {
			title: 'New message',
			body: 'You have a new message',
		},
		android: { priority: 'high' },
		apns: { headers: { 'apns-priority': '10' }, payload: { aps: { sound: 'default' } } },
	};
	const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': `key=${FCM_SERVER_KEY}` }, body: JSON.stringify(payload) });
	if (!res.ok) {
		console.error('FCM error', res.status, await res.text());
		return;
	}
	const body = await res.json();
	const invalid: string[] = [];
	(body.results || []).forEach((r: any, i: number) => { if (r.error && ['NotRegistered', 'InvalidRegistration'].includes(r.error)) invalid.push(tokens[i]); });
	if (invalid.length > 0) await deactivateTokens(invalid);
}

serve(async (req) => {
	if (req.method !== 'POST') {
		return new Response('Method not allowed', { status: 405 });
	}
	try {
		// If POST body provided, single message; otherwise drain queue (cron)
		if (req.method === 'POST' && req.headers.get('content-type')?.includes('application/json')) {
			const payload: Payload = await req.json();
			const recipients = await getRecipients(payload.group_id, payload.sender_id);
			if (recipients.length === 0) return new Response('ok');
			const tokens = await getActiveTokens(recipients);
			const tokenList = tokens.map((t) => t.token);
			if (tokenList.length === 0) return new Response('ok');
			await sendFcm(tokenList, {
				type: 'new_message',
				group_id: payload.group_id,
				message_id: payload.message_id,
				created_at: payload.created_at,
			});
			console.log(`[push] notify:fanout group=${payload.group_id} recipients=${tokenList.length}`);
			return new Response('ok');
		}

		// Drain unprocessed queue rows
		const { data: items } = await db
			.from('notification_queue')
			.select('*')
			.is('processed_at', null)
			.limit(100);
		for (const it of items || []) {
			try {
				const recipients = await getRecipients(it.group_id, it.sender_id);
				const tokens = await getActiveTokens(recipients);
				const tokenList = tokens.map((t) => t.token);
				if (tokenList.length > 0) {
					await sendFcm(tokenList, {
						type: 'new_message',
						group_id: it.group_id,
						message_id: it.message_id,
						created_at: it.created_at,
					});
					console.log(`[push] notify:fanout group=${it.group_id} recipients=${tokenList.length}`);
				}
			} finally {
				await db.from('notification_queue').update({ processed_at: new Date().toISOString(), attempt_count: (it.attempt_count || 0) + 1 }).eq('id', it.id);
			}
		}
		return new Response('ok');
	} catch (e) {
		console.error('push-fanout error', e);
		return new Response('error', { status: 500 });
	}
});


