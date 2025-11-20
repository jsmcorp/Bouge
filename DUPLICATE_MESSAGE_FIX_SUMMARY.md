# Duplicate Message Fix Summary

## Problem
When you send a message, go to dashboard, and reopen the group, the same message appears twice.

## Root Cause
1. You send a message → appears with temp ID (e.g., `1763645385747-abc123`)
2. Message is saved to Supabase → gets server UUID (e.g., `bb0d2dd8-87ba-42f8-92b3-6e7a0f8bcb11`)
3. Temp message is deleted from SQLite
4. You go to dashboard and reopen group
5. SQLite returns 50 messages (with server UUID, no temp ID)
6. React state still has the optimistic message with temp ID
7. `mergeWithPending` preserves the optimistic message: `incoming=50, existing=50, optimistic=1, final=51`
8. Background Supabase sync fetches from server, finds the same message with server UUID
9. Background sync adds it again because it only checked by ID, not by content+timestamp

## Fixes Applied

### 1. mergeWithPending - Signature-based deduplication
**File**: `src/store/chatstore_refactored/fetchActions.ts` (line ~250)

Added signature check to skip messages with same content+timestamp but different IDs:

```typescript
const incomingSignatures = new Set(
  incoming.map(m => `${m.user_id}:${m.content}:${new Date(m.created_at).getTime()}`)
);

const existingNotInIncoming = existing.filter(m => {
  if (incomingMap.has(m.id)) return false;
  
  const signature = `${m.user_id}:${m.content}:${new Date(m.created_at).getTime()}`;
  if (incomingSignatures.has(signature)) {
    console.log(`🔄 Skipping duplicate message with different ID: ${m.id}`);
    return false;
  }
  
  return true;
});
```

### 2. Background Supabase Sync - Signature-based deduplication
**File**: `src/store/chatstore_refactored/fetchActions.ts` (line ~950)

Added same signature check to background sync:

```typescript
const existingSignatures = new Set(
  currentState.messages.map((m: Message) => 
    `${m.user_id}:${m.content}:${new Date(m.created_at).getTime()}`
  )
);

const newMessages = filteredData.filter((msg: any) => {
  if (existingIds.has(msg.id)) {
    console.log(`🔄 Background: Skipping message ${msg.id} (already exists by ID)`);
    return false;
  }
  
  const signature = `${msg.user_id}:${msg.content}:${new Date(msg.created_at).getTime()}`;
  if (existingSignatures.has(signature)) {
    console.log(`🔄 Background: Skipping duplicate message ${msg.id} (signature match)`);
    return false;
  }
  
  console.log(`🔄 Background: Including new message ${msg.id}`);
  return true;
});
```

### 3. Temp Message Deletion - UUID check
**File**: `src/store/chatstore_refactored/messageActions_fixed.ts` (line ~565)

Improved temp message deletion to use UUID regex:

```typescript
const isUUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(messageId);
if (!isUUID) {
  await sqliteService.deleteMessage(messageId);
  console.log(`🗑️ Removed temp message ${messageId}`);
}
```

## Expected Logs After Fix

### When reopening group after sending message:

```
🔄 mergeWithPending: incoming=50, existing=50, optimistic=1, realtime=0, final=51
🔄 Background: Synced 50 messages from Supabase to SQLite
🔄 Background: Skipping message bb0d2dd8-... (already exists by ID) ← If temp was deleted
OR
🔄 Background: Skipping duplicate message bb0d2dd8-... (signature match: 852432e2:Hello:1763645385747) ← If temp still in state
🔄 Background: No new messages to add to UI (all 50 already exist)
MessageList: messages=51 ← Stays at 51, no duplicate
```

### What you should NOT see:

```
🔄 Background: Found 1 new messages from Supabase, updating UI ← This means duplicate was added
MessageList: messages=52 ← This means duplicate exists
```

## Testing

1. Build the app with latest changes
2. Open a group
3. Send a message
4. Go back to dashboard
5. Reopen the group
6. Check logs for "Skipping duplicate message" or "Skipping message ... (already exists by ID)"
7. Verify message count stays at 51, not 52
8. Verify you only see one copy of your sent message

## If Still Seeing Duplicates

Check the logs for:
- `🔄 Background: Including new message ...` - This means the signature check failed
- Compare the signature in the log with the optimistic message signature
- Verify the temp message was deleted from SQLite
- Verify the optimistic message is still in React state when background sync runs
