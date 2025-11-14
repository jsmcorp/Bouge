// Deno Edge Function for push fan-out using FCM HTTP v1 (OAuth2 Service Account)

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4';


// CORS helpers
const DEV_ORIGINS = (Deno.env.get('DEV_CORS_ORIGINS') || 'https://localhost,capacitor://localhost,http://localhost').split(',');
function buildCorsHeaders(origin: string | null): HeadersInit {
  const allowed = (origin && DEV_ORIGINS.includes(origin)) ? origin : '*';
  return {
    'Access-Control-Allow-Origin': allowed,
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Access-Control-Max-Age': '86400',
    'Vary': 'Origin'
  };
}

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

async function sendFcmV1(tokens: string[], data: Record<string, string>, reqId?: string): Promise<void> {
	if (!FCM_PROJECT_ID || tokens.length === 0) return;
	const accessToken = await getAccessToken();
	if (!accessToken) {
		console.error('FCM v1 access token unavailable');
		return;
	}
	const url = `https://fcm.googleapis.com/v1/projects/${FCM_PROJECT_ID}/messages:send`;
	console.log(JSON.stringify({ tag: 'push-fcm-v1:request', projectId: FCM_PROJECT_ID, endpoint: url, tokenCount: tokens.length, reqId }));
	const invalid: string[] = [];
	for (const token of tokens) {
		// HYBRID payload for production-grade background delivery
		// - notification block: Android shows system notification even when app is dead
		// - data block: Native FirebaseMessagingService writes to SQLite
		// - This is how WhatsApp and other production apps work
		//
		// All data values MUST be strings (FCM requirement)
		const groupName = data.group_name || 'New message';
		const preview = data.content ? String(data.content).substring(0, 100) : 'You have a new message';
		
		const body = {
			message: {
				token,
				// Notification block for system tray (works even when app is dead)
				notification: {
					title: groupName,
					body: preview
				},
				// Data block with full message content (all values must be strings!)
				data: {
					...data,
					// Ensure all values are strings
					type: String(data.type || 'new_message'),
					group_id: String(data.group_id || ''),
					message_id: String(data.message_id || ''),
					created_at: String(data.created_at || ''),
					content: String(data.content || ''),
					user_id: String(data.user_id || ''),
					is_ghost: String(data.is_ghost || 'false'),
					msg_type: String(data.msg_type || 'text'), // Renamed from message_type
					category: String(data.category || ''),
					parent_id: String(data.parent_id || ''),
					image_url: String(data.image_url || ''),
					group_name: String(data.group_name || 'New message')
				},
				android: {
					priority: 'HIGH',
				},
				apns: {
					headers: { 'apns-priority': '10' },
					payload: {
						aps: {
							alert: {
								title: groupName,
								body: preview
							},
							sound: 'default',
							badge: 1
						}
					},
				},
			}
		};
		const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${accessToken}` }, body: JSON.stringify(body) });
		if (!res.ok) {
			const txt = await res.text();
			if (/UNREGISTERED|InvalidArgument/i.test(txt)) invalid.push(token);
			console.error(JSON.stringify({ tag: 'push-fcm-v1:error', reqId, status: res.status, body: (txt || '').slice(0, 500) }));
		} else {
			let messageName: string | undefined = undefined;
			try { const j = await res.clone().json(); messageName = j?.name; } catch (_) {}
			console.log(JSON.stringify({ tag: 'push-fcm-v1:ok', reqId, status: res.status, messageName }));
		}
	}
	if (invalid.length > 0) await deactivateTokens(invalid);
}

async function sendFcm(tokens: string[], data: Record<string, string>, reqId?: string): Promise<void> {
	// Prefer v1 if creds are configured; fallback to legacy key if not
	if (GCP_CLIENT_EMAIL && GCP_PRIVATE_KEY && FCM_PROJECT_ID) {
		return await sendFcmV1(tokens, data, reqId);
	}
	if (!FCM_SERVER_KEY || tokens.length === 0) return;
	const url = 'https://fcm.googleapis.com/fcm/send';
	// HYBRID payload for production-grade background delivery (same as v1)
	// notification block: Android shows system notification even when app is dead
	// data block: Native FirebaseMessagingService writes to SQLite
	// All data values MUST be strings (FCM requirement)
	const groupName = data.group_name || 'New message';
	const preview = data.content ? String(data.content).substring(0, 100) : 'You have a new message';
	
	const payload = {
		registration_ids: tokens,
		priority: 'high',
		// Notification block for system tray
		notification: {
			title: groupName,
			body: preview,
			sound: 'default'
		},
		// Data block with full message content (all values must be strings!)
		data: {
			...data,
			type: String(data.type || 'new_message'),
			group_id: String(data.group_id || ''),
			message_id: String(data.message_id || ''),
			created_at: String(data.created_at || ''),
			content: String(data.content || ''),
			user_id: String(data.user_id || ''),
			is_ghost: String(data.is_ghost || 'false'),
			msg_type: String(data.msg_type || 'text'), // Renamed from message_type
			category: String(data.category || ''),
			parent_id: String(data.parent_id || ''),
			image_url: String(data.image_url || ''),
			group_name: String(data.group_name || 'New message')
		},
		android: {
			priority: 'high',
		},
		apns: {
			headers: { 'apns-priority': '10' },
			payload: {
				aps: {
					alert: {
						title: groupName,
						body: preview
					},
					sound: 'default',
					badge: 1
				}
			}
		},
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

serve(async (req: Request) => {
	const origin = req.headers.get('origin');
	const cors = buildCorsHeaders(origin);
		const reqId = (crypto as any).randomUUID ? (crypto as any).randomUUID() : Math.random().toString(36).slice(2);
		const isPreflight = req.method === 'OPTIONS';
		try { console.log(JSON.stringify({ tag: 'push-fanout:request', reqId, method: req.method, origin, allowedOrigin: (cors as any)['Access-Control-Allow-Origin'], isPreflight })); } catch {}


	if (req.method === 'OPTIONS') {
		return new Response(null, { status: 204, headers: cors });
	}

	if (req.method !== 'POST') {
		return new Response('Method not allowed', { status: 405, headers: cors });
	}
	try {
		// If POST body provided, single message; otherwise drain queue (cron)
		if (req.method === 'POST' && req.headers.get('content-type')?.includes('application/json')) {
			const payload: Payload = await req.json();
			// Log full payload for diagnostics
			try { console.log(JSON.stringify({ tag: "push-fanout:payload", payload })); } catch {}
			// Keep existing structured payload log
			try { console.log(JSON.stringify({ tag: 'push-fanout:payload', reqId, group_id: payload.group_id, sender_id: payload.sender_id, message_id: payload.message_id })); } catch {}

			const recipients = await getRecipients(payload.group_id, payload.sender_id);
			const recipientIds = recipients;
			try { console.log(JSON.stringify({ tag: "push-fanout:members", group_id: payload.group_id, sender_id: payload.sender_id, recipientIds })); } catch {}
			try { console.log(JSON.stringify({ tag: 'push-fanout:members', reqId, memberCount: recipients.length })); } catch {}
			if (recipients.length === 0) return new Response('ok', { headers: cors });
			const tokens = await getActiveTokens(recipients);
			const tokensData = tokens;
			try { console.log(JSON.stringify({ tag: "push-fanout:tokens", tokensData })); } catch {}
			const tokenList = tokens.map((t) => t.token);
				try { console.log(JSON.stringify({ tag: 'push-fanout:fanout', reqId, recipients: tokenList.length })); } catch {}

			if (tokenList.length === 0) return new Response('ok', { headers: cors });
			
			// Fetch full message data to include in FCM payload for instant background delivery
			const { data: messageData, error: messageError } = await db
				.from('messages')
				.select('id, group_id, user_id, content, is_ghost, message_type, category, parent_id, image_url, created_at')
				.eq('id', payload.message_id)
				.single();
			
			if (messageError) {
				console.error(`[push] Failed to fetch message ${payload.message_id}:`, messageError);
			}
			
			// Build FCM data payload with full message content
			const fcmData: Record<string, string> = {
				type: 'new_message',
				group_id: payload.group_id,
				message_id: payload.message_id,
				created_at: payload.created_at,
			};
			
			// Add full message data if available (for instant background delivery)
			// Note: Renamed message_type to msg_type to avoid FCM reserved key conflict
			if (messageData) {
				fcmData.content = String(messageData.content || '');
				fcmData.user_id = String(messageData.user_id || '');
				fcmData.is_ghost = String(messageData.is_ghost || false);
				fcmData.msg_type = String(messageData.message_type || 'text'); // Renamed from message_type
				if (messageData.category) fcmData.category = String(messageData.category);
				if (messageData.parent_id) fcmData.parent_id = String(messageData.parent_id);
				if (messageData.image_url) fcmData.image_url = String(messageData.image_url);
				console.log(`[push] Including full message content in FCM payload (${fcmData.content.length} chars)`);
			}
			
			// Fetch group name for notification
			const { data: groupData } = await db
				.from('groups')
				.select('name')
				.eq('id', payload.group_id)
				.single();
			
			if (groupData) {
				fcmData.group_name = String(groupData.name || 'Group');
			}
			
			await sendFcm(tokenList, fcmData, reqId);
			console.log(`[push] notify:fanout group=${payload.group_id} recipients=${tokenList.length}`);
			return new Response('ok', { headers: cors });
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
				const recipientIds = recipients;
				try { console.log(JSON.stringify({ tag: "push-fanout:members", group_id: it.group_id, sender_id: it.sender_id, recipientIds })); } catch {}
				try { console.log(JSON.stringify({ tag: 'push-fanout:members', reqId, memberCount: recipients.length })); } catch {}
				const tokens = await getActiveTokens(recipients);
				const tokensData = tokens;
				try { console.log(JSON.stringify({ tag: "push-fanout:tokens", tokensData })); } catch {}
				const tokenList = tokens.map((t) => t.token);
					try { console.log(JSON.stringify({ tag: 'push-fanout:fanout', reqId, recipients: tokenList.length })); } catch {}

				if (tokenList.length > 0) {
					await sendFcm(tokenList, {
						type: 'new_message',
						group_id: it.group_id,
						message_id: it.message_id,
						created_at: it.created_at,
					}, reqId);
					console.log(`[push] notify:fanout group=${it.group_id} recipients=${tokenList.length}`);
				}
			} finally {
				await db.from('notification_queue').update({ processed_at: new Date().toISOString(), attempt_count: (it.attempt_count || 0) + 1 }).eq('id', it.id);
			}
		}
		return new Response('ok', { headers: cors });
	} catch (e) {
		console.error('push-fanout error', e);
		return new Response('error', { status: 500, headers: cors });
	}
});


