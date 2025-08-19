// Deno Edge Function for push fan-out (skeleton)
// This is a scaffolding file; wire DB trigger to POST here with message payload

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

async function sendFcm(tokens: string[], data: Record<string, string>): Promise<void> {
	if (!FCM_SERVER_KEY || tokens.length === 0) return;
	const url = 'https://fcm.googleapis.com/fcm/send';
	const payload = {
		registration_ids: tokens,
		priority: 'high',
		data,
	};
	const res = await fetch(url, {
		method: 'POST',
		headers: {
			'Content-Type': 'application/json',
			'Authorization': `key=${FCM_SERVER_KEY}`,
		},
		body: JSON.stringify(payload),
	});
	if (!res.ok) {
		console.error('FCM error', res.status, await res.text());
		return;
	}
	const body = await res.json();
	// Collect invalid tokens and deactivate
	const invalid: string[] = [];
	(body.results || []).forEach((r: any, i: number) => {
		if (r.error && ['NotRegistered', 'InvalidRegistration'].includes(r.error)) {
			invalid.push(tokens[i]);
		}
	});
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


