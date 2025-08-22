import { Message } from './types';
import { supabase } from '@/lib/supabase';
import { FEATURES_PUSH } from '@/lib/featureFlags';

// Helper function to structure messages with replies nested under parent messages
export const structureMessagesWithReplies = (messages: Message[]): Message[] => {
  const messageMap = new Map<string, Message>();
  const parentMessages: Message[] = [];

  // First pass: Create a map of all messages and add replies array to each parent
  messages.forEach(message => {
    const messageWithReplies = {
      ...message,
      replies: [],
      reply_count: 0
    };
    messageMap.set(message.id, messageWithReplies);
  });

  // Second pass: Connect replies to their parents
  messages.forEach(message => {
    if (message.parent_id) {
      const parentMessage = messageMap.get(message.parent_id);
      if (parentMessage) {
        parentMessage.replies = parentMessage.replies || [];
        parentMessage.replies.push(messageMap.get(message.id)!);
        parentMessage.reply_count = (parentMessage.reply_count || 0) + 1;

        // Sort replies by creation time (oldest first)
        parentMessage.replies.sort((a, b) =>
          new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
        );

        // Limit to 3 inline replies for display
        parentMessage.replies = parentMessage.replies.slice(0, 3);
      }
    } else {
      // This is a parent message, add to the list
      parentMessages.push(messageMap.get(message.id)!);
    }
  });

  // Sort parent messages by creation time (oldest first)
  parentMessages.sort((a, b) =>
    new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
  );

  return parentMessages;
};

// Helper function to compress images
export const compressImage = async (
  file: File,
  maxWidth: number = 800,
  maxHeight: number = 600,
  quality: number = 0.8
): Promise<Blob> => {
  return new Promise((resolve) => {
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d')!;
    const img = new Image();

    img.onload = () => {
      // Calculate new dimensions while maintaining aspect ratio
      let { width, height } = img;

      if (width > height) {
        if (width > maxWidth) {
          height = (height * maxWidth) / width;
          width = maxWidth;
        }
      } else {
        if (height > maxHeight) {
          width = (width * maxHeight) / height;
          height = maxHeight;
        }
      }

      canvas.width = width;
      canvas.height = height;

      // Draw and compress
      ctx.drawImage(img, 0, 0, width, height);

      canvas.toBlob(
        (blob) => {
          resolve(blob!);
        },
        'image/jpeg',
        quality
      );
    };

    img.src = URL.createObjectURL(file);
  });
};

// Helper function to generate unique file names
export const generateUniqueFileName = (originalName: string, userId: string): string => {
  const timestamp = Date.now();
  const randomString = Math.random().toString(36).substring(2, 8);
  const extension = originalName.split('.').pop() || 'jpg';
  return `${userId}/${timestamp}_${randomString}.${extension}`;
};

// Global variables for outbox processing
export let outboxProcessorInterval: NodeJS.Timeout | null = null;

export const setOutboxProcessorInterval = (interval: NodeJS.Timeout | null) => {
  outboxProcessorInterval = interval;
};

// Writes auth safety gate — ensures a valid token for WRITES ONLY
export async function ensureAuthForWrites(timeoutMs?: number): Promise<{ canWrite: boolean; reason?: string }> {
	const sessionId = `auth-${Date.now()}-${Math.random().toString(36).slice(2)}`;
	console.log(`[auth-debug] ${sessionId} - Starting ensureAuthForWrites`);
	
	if (!FEATURES_PUSH.enabled || FEATURES_PUSH.killSwitch) {
		console.log(`[auth-debug] ${sessionId} - Feature disabled, allowing writes`);
		return { canWrite: true };
	}

	const limit = typeof timeoutMs === 'number' ? timeoutMs : FEATURES_PUSH.auth.refreshTimeoutMs;
	console.log(`[auth-debug] ${sessionId} - Using timeout: ${limit}ms`);

	// Initial session check with detailed logging
	try {
		console.log(`[auth-debug] ${sessionId} - Getting current session...`);
		const sessionResult = await supabase.auth.getSession();
		console.log(`[auth-debug] ${sessionId} - Session result received, checking token...`);
		const token = sessionResult?.data?.session?.access_token;
		if (token) {
			console.log(`[auth-debug] ${sessionId} - Valid token found, writes ready`);
			console.log('[auth] writes:ready');
			return { canWrite: true };
		}
		console.log(`[auth-debug] ${sessionId} - No valid token, attempting refresh...`);
	} catch (e) {
		console.log(`[auth-debug] ${sessionId} - Session check failed:`, e);
	}

	// Try refresh with timeout but do not block UI beyond limit
	try {
		console.log(`[auth-debug] ${sessionId} - Creating abort controller for refresh...`);
		const controller = new AbortController();
		
		console.log(`[auth-debug] ${sessionId} - Setting timeout for ${limit}ms...`);
		const timeout = setTimeout(() => {
			console.log(`[auth-debug] ${sessionId} - Timeout reached, aborting refresh...`);
			controller.abort();
		}, limit);
		
		console.log(`[auth-debug] ${sessionId} - Starting refresh session...`);
		const refreshPromise = supabase.auth.refreshSession();
		
		console.log(`[auth-debug] ${sessionId} - Racing refresh vs timeout...`);
		const outcome = await Promise.race([
			refreshPromise.then((res) => {
				console.log(`[auth-debug] ${sessionId} - Refresh completed, checking result...`);
				const hasToken = !!res?.data?.session?.access_token;
				console.log(`[auth-debug] ${sessionId} - Refresh success: ${hasToken}`);
				return { ok: hasToken };
			}),
			new Promise<{ ok: boolean }>((resolve) => {
				controller.signal.addEventListener('abort', () => {
					console.log(`[auth-debug] ${sessionId} - Abort signal received`);
					resolve({ ok: false });
				});
			}),
		]);
		
		clearTimeout(timeout);
		console.log(`[auth-debug] ${sessionId} - Race completed, outcome:`, outcome);
		
		if (outcome.ok) {
			console.log(`[auth-debug] ${sessionId} - Refresh successful, writes ready`);
			console.log('[auth] writes:ready');
			return { canWrite: true };
		}
		console.log(`[auth-debug] ${sessionId} - Refresh failed/timed out`);
		console.log('[auth] writes:blocked reason=refresh_timeout');
		return { canWrite: false, reason: 'refresh_timeout' };
	} catch (e) {
		console.log(`[auth-debug] ${sessionId} - Refresh error:`, e);
		console.log('[auth] writes:blocked reason=refresh_error');
		return { canWrite: false, reason: 'refresh_error' };
	}
}
