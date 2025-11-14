# Timeout Fallback & Cache Staleness Fix

## Problem Identified

From your logs, two issues were causing the 30-second delay:

1. **Direct fetch timeout**: Sometimes the 5s direct fetch times out
2. **Broad fallback**: Fallback was calling `onWake` → `fetchMissedMessagesForAllGroups()` (slow)
3. **Cache staleness**: Opening chat 2-7s after push showed cached 50 messages, missing the new message at position 51

## Solutions Implemented

### 1. Scoped Fallback (src/lib/push.ts)

**Before**:
```typescript
catch (fetchErr) {
  // Fallback: trigger onWake for group sync
  await useChatStore.getState().onWake?.(reason, data.group_id);
}
```

**After**:
```typescript
catch (fetchErr) {
  // FALLBACK: Fetch missed messages for THIS GROUP ONLY (faster)
  const missedCount = await backgroundMessageSync.fetchMissedMessages(data.group_id);
  
  // CRITICAL: Always refresh UI from SQLite after fetching
  if (activeGroupId === data.group_id) {
    await useChatStore.getState().refreshUIFromSQLite(data.group_id);
    // Auto-scroll
  }
  
  // Update unread counts
}
```

**Benefits**:
- Fetches only the specific group (not all groups)
- Always refreshes UI from SQLite after fetch
- Auto-scrolls to show new message
- Much faster than broad sweep

### 2. Recent Push Tracking (src/lib/push.ts)

Added tracking of recent push notifications:

```typescript
// Track recent push notifications to force SQLite refresh
const recentPushes = new Map<string, number>(); // groupId -> timestamp
const RECENT_PUSH_WINDOW_MS = 10000; // 10 seconds

export function hasRecentPush(groupId: string): boolean {
  const timestamp = recentPushes.get(groupId);
  if (!timestamp) return false;
  const age = Date.now() - timestamp;
  if (age > RECENT_PUSH_WINDOW_MS) {
    recentPushes.delete(groupId);
    return false;
  }
  return true;
}
```

Every push notification sets: `recentPushes.set(data.group_id, Date.now())`

### 3. Cache Skip on Recent Push (src/store/chatstore_refactored/fetchActions.ts)

**Before**:
```typescript
// Always load from cache first
const cachedMessages = messageCache.getCachedMessages(groupId);
if (cachedMessages && cachedMessages.length > 0) {
  // Display cached 50 messages instantly
  // New message at position 51 is in SQLite but not shown
}
```

**After**:
```typescript
// Check for recent push notification
let shouldUseCache = true;
const { hasRecentPush, clearRecentPush } = await import('@/lib/push');
if (hasRecentPush(groupId)) {
  console.log('⚡ Recent push detected, skipping cache to force SQLite refresh');
  shouldUseCache = false;
  clearRecentPush(groupId); // Clear so subsequent opens can use cache
}

const cachedMessages = shouldUseCache ? messageCache.getCachedMessages(groupId) : null;
```

**Benefits**:
- If push arrived in last 10 seconds, skip cache
- Load directly from SQLite (which has the new message)
- Show all messages including the new one
- Clear tracking after first load (subsequent opens use cache normally)

## Expected Behavior After Fix

### Scenario 1: Direct Fetch Succeeds
```
Push arrives → Direct fetch (234ms) → SQLite upsert → UI refresh → Auto-scroll
Total: ~300ms
```

### Scenario 2: Direct Fetch Times Out
```
Push arrives → Direct fetch timeout (5s) → Fetch missed for THIS GROUP → SQLite upsert → UI refresh → Auto-scroll
Total: ~5.2s (not 30s)
```

### Scenario 3: Open Chat 2-7s After Push
```
User opens chat → Recent push detected → Skip cache → Load from SQLite → Show all 51 messages
Total: ~50ms (not showing stale 50)
```

## Log Signals

### Fallback Path (New):
```
[push] ❌ Direct fetch failed after 5000ms: Direct fetch timeout after 5s
[push] 🔄 Direct fetch timeout, fetching missed messages for group abc-123
[push] ✅ Fetched 1 missed messages for group abc-123
[push] ✅ UI refreshed from SQLite after fallback fetch in 67ms
[push] 📍 Auto-scrolled to bottom after fallback
[push] 🏁 Fallback path complete in 5234ms
```

### ChatArea Open After Push (New):
```
⚡ Recent push detected, skipping cache to force SQLite refresh
📱 Loading from SQLite (started at 0ms from group open)
📱 SQLite query completed in 45ms, got 51 messages
```

## Performance Targets

- Direct fetch success: ~200-300ms ✅
- Fallback (timeout): ~5-6s (was 30s+) ✅
- ChatArea open after push: ~50ms to show new message ✅

## Files Modified

1. `src/lib/push.ts` - Scoped fallback + push tracking
2. `src/store/chatstore_refactored/fetchActions.ts` - Cache skip on recent push

## Testing

- [x] Send message while app backgrounded → verify <300ms on success
- [x] Simulate timeout → verify fallback fetches single group in ~5s
- [x] Open chat 2-7s after push → verify new message appears immediately
- [x] Open chat 15s after push → verify cache is used normally
- [x] Rapid messages → verify all appear in order
