# Placeholder System Removal

## Summary
Removed the placeholder message system from the codebase. The app now relies on direct messages only, ensuring complete data is always displayed.

## Changes Made

### 1. src/lib/push.ts
**Removed**: Placeholder message creation logic (lines 309-370)
- No longer creates temporary messages with `category: 'placeholder'`
- No longer uses `user_id: data.user_id || 'unknown'`
- No longer shows incomplete messages with "..." content
- Removed background reconciliation logic for placeholder messages

**Current Behavior**:
- **Full payload fast path**: When FCM contains complete message data, write directly to SQLite and display immediately
- **REST fallback**: When FCM payload is incomplete, fetch complete message from REST API before displaying
- No intermediate placeholder states

### 2. Documentation Cleanup
**Deleted**:
- `CRITICAL_FIXES_NEEDED.md` - Outdated documentation about placeholder issues
- `.trae/documents/WhatsApp-Style Immediate Message Processing on FCM.md` - Outdated implementation guide

## Benefits

1. **No "unknown user" issues**: Messages always display with proper author information
2. **Simpler code**: Removed ~60 lines of placeholder handling and reconciliation logic
3. **Better UX**: No flicker from placeholder-to-real-content transitions
4. **Data integrity**: Messages are only displayed when complete

## Technical Details

### Before (Placeholder System)
```typescript
// Created placeholder with incomplete data
await sqliteService.saveMessage({
  user_id: data.user_id || 'unknown',  // ❌ Could be "unknown"
  content: data.message_preview || '…', // ❌ Incomplete content
  category: 'placeholder',              // ❌ Temporary marker
});
// Showed placeholder immediately
await onWake(reason, data.group_id);
// Reconciled later in background
backgroundMessageSync.fetchAndStoreMessage(...);
```

### After (Direct Messages Only)
```typescript
// Only display when we have complete data
if (hasFullPayload) {
  // Fast path: Write complete message directly
  await sqliteService.saveMessage({
    user_id: data.user_id,    // ✅ Always valid
    content: data.content,     // ✅ Complete content
    category: data.category,   // ✅ No placeholder marker
  });
  await onWake(reason, data.group_id);
} else {
  // Fallback: Fetch complete message first
  await backgroundMessageSync.fetchAndStoreMessage(...);
  await onWake(reason, data.group_id);
}
```

## Testing Recommendations

1. **Full payload messages**: Verify instant display when FCM contains complete data
2. **Partial payload messages**: Verify proper wait for REST fetch
3. **Author information**: Confirm no "unknown user" appears
4. **Message content**: Confirm no "..." placeholder content appears
5. **Rapid messages**: Test ordering with sequential pushes
