# FCM Reserved Key Fix

## Problem
FCM was rejecting the payload with error:
```
Invalid data payload key: message_type
```

## Root Cause
`message_type` is a **reserved key** in FCM and cannot be used in the data payload.

## Solution
Renamed `message_type` to `msg_type` in both server and client code.

### Changes Made:

**Server-Side** (`supabase/functions/push-fanout/index.ts`):
```typescript
// Before:
fcmData.message_type = String(messageData.message_type || 'text');

// After:
fcmData.msg_type = String(messageData.message_type || 'text'); // Renamed from message_type
```

**Client-Side** (`src/lib/push.ts`):
```typescript
// Before:
message_type: data.message_type || 'text',

// After:
message_type: data.msg_type || 'text', // FCM sends as msg_type
```

## Deployment
- ✅ Edge function redeployed
- ✅ Client rebuilt and synced

## Testing
Send a test message and verify:
1. No FCM errors in Supabase edge function logs
2. Message arrives on device
3. Fast-path logs appear:
   ```
   [push] ⚡ FAST PATH: FCM payload contains full message
   [push] ✅ Message stored in SQLite in 67ms (fast path)
   ```

## FCM Reserved Keys to Avoid
Common reserved keys in FCM data payload:
- `message_type` ❌
- `notification` ❌
- `from` ❌
- `collapse_key` ❌
- `priority` ❌

Use custom prefixes like `msg_type`, `app_notification`, etc. to avoid conflicts.

---

**Status**: ✅ Fixed and deployed
**Date**: 2025-11-14
