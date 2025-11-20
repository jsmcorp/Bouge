# First App Start Separator Fix - LOCAL-FIRST Approach

## Problem
The unread separator didn't work on the first app start/restart, but worked correctly after that.

## Root Cause
On first app start, when `fetchMessages` is called:
1. It tries to calculate the separator using `sqliteService.getLocalLastReadMessageId()`
2. But the `group_members` table doesn't have any row for this user+group yet
3. The code tried to call a non-existent `fetchGroupMembers` function
4. Result: Separator calculation happens with NO local read status → shows as "first time" (no separator)

## The Fix - TRUE Local-First Approach
**Create local row FIRST, sync from Supabase in background**

### Why This Approach is Better
1. **No blocking Supabase call** - UI is instant
2. **Works offline** - creates local row even without network
3. **True local-first** - SQLite is source of truth, Supabase syncs later
4. **Graceful degradation** - if Supabase sync fails, local data still works

### Implementation Flow

#### Step 1: Check if local row exists (instant)
```typescript
const hasLocalMember = await sqliteService.getLocalLastReadAt(groupId, session.user.id);
```

#### Step 2: If no local row, create it immediately (instant)
```typescript
if (hasLocalMember === null) {
  // Create local group_members row with initial state (never read = 0)
  await sqliteService.updateLocalLastReadAt(
    groupId,
    session.user.id,
    0, // Never read yet
    '' // No last read message
  );
  console.log('[unread] ✅ Created local group_members row (never read)');
}
```

#### Step 3: Background sync from Supabase (non-blocking)
```typescript
setTimeout(async () => {
  // Fetch actual read status from Supabase
  const { data: memberData } = await client
    .from('group_members')
    .select('last_read_at, last_read_message_id')
    .eq('group_id', groupId)
    .eq('user_id', session.user.id)
    .single();
  
  if (memberData && memberData.last_read_at) {
    // Update local with Supabase data
    await sqliteService.syncReadStatusFromSupabase(...);
    
    // Recalculate separator with updated data
    // This will update the UI if there were actually unread messages
  }
}, 500); // Happens in background
```

### Comparison: Old vs New Approach

#### ❌ Old Approach (Blocking)
```
1. Open chat
2. Check local SQLite → no row found
3. BLOCK and fetch from Supabase (50-100ms delay)
4. Sync to SQLite
5. Calculate separator
6. Show messages
```
**Problem**: Blocks UI, requires network, fails offline

#### ✅ New Approach (Local-First)
```
1. Open chat
2. Check local SQLite → no row found
3. Create local row immediately (0ms delay)
4. Calculate separator (shows as "never read" = no separator)
5. Show messages INSTANTLY
6. Background: Sync from Supabase
7. Background: Update separator if needed
```
**Benefits**: Instant UI, works offline, graceful sync

### Edge Cases Handled

1. **First time ever opening chat**
   - Creates local row with "never read" (0)
   - Shows no separator (correct behavior)
   - Background sync finds no Supabase data (truly first time)

2. **First time on THIS device (but read on another device)**
   - Creates local row with "never read" (0)
   - Shows no separator initially
   - Background sync finds Supabase data
   - Updates separator to correct position

3. **Offline mode**
   - Creates local row with "never read" (0)
   - Shows no separator
   - Background sync fails gracefully
   - Next time online, will sync

4. **Supabase sync fails**
   - Local row already exists
   - Separator calculation works with local data
   - User can still use the app

### Performance Impact
- **First open**: 0ms blocking (instant)
- **Background sync**: ~50-100ms (non-blocking)
- **Subsequent opens**: 0ms (uses existing local data)

### Files Changed
- `src/store/chatstore_refactored/fetchActions.ts` - Implemented local-first group_members creation

### Testing
1. Clear app data / reinstall app
2. Open a chat for the first time
3. **Expected**: Messages load instantly, no separator (never read)
4. Wait 1 second for background sync
5. **Expected**: If there were unread messages on Supabase, separator appears
6. Close and reopen chat
7. **Expected**: Separator shows correctly using local data (instant)
