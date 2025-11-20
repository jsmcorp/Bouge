# Unread Count - Clean Implementation Plan

## Problem

The current implementation has too many layers:
- Caching in multiple places
- Timers and debouncing
- Complex listener system
- Unclear data flow

**Result:** Hard to debug, unclear where it breaks

## Solution: Start Fresh with Minimal Implementation

Build in strict order, test each step before moving to the next.

---

## Step 1: Minimal RPC-Only System (NO REALTIME YET)

### Goal
Get unread counts working with ONLY Supabase RPCs. No caching, no timers, no realtime.

### Implementation

**File: `src/components/dashboard/Sidebar.tsx`**

```typescript
// Simple state - no caching, no complexity
const [unreadCounts, setUnreadCounts] = useState<Map<string, number>>(new Map());

// Fetch from Supabase on mount
useEffect(() => {
  if (groups.length > 0) {
    fetchUnreadCounts();
  }
}, [groups]);

async function fetchUnreadCounts() {
  try {
    const client = await supabasePipeline.getDirectClient();
    const { data: { user } } = await client.auth.getUser();
    if (!user) return;

    const { data, error } = await client.rpc('get_all_unread_counts', {
      p_user_id: user.id
    });

    if (error) {
      console.error('[unread] RPC error:', error);
      return;
    }

    const counts = new Map<string, number>();
    for (const row of data || []) {
      counts.set(row.group_id, row.unread_count);
    }

    console.log('[unread] Fetched counts:', Array.from(counts.entries()));
    setUnreadCounts(counts);
  } catch (err) {
    console.error('[unread] Failed to fetch:', err);
  }
}

// Render badge
{unreadCounts.get(group.id) > 0 && (
  <div className="badge">
    {unreadCounts.get(group.id)}
  </div>
)}
```

**File: `src/components/dashboard/ChatArea.tsx`**

```typescript
// Mark as read when opening chat
useEffect(() => {
  if (activeGroup?.id && messages.length > 0) {
    markAsRead();
  }
}, [activeGroup?.id, messages.length]);

async function markAsRead() {
  try {
    const lastMessage = messages[messages.length - 1];
    if (!lastMessage) return;

    const client = await supabasePipeline.getDirectClient();
    const { data: { user } } = await client.auth.getUser();
    if (!user) return;

    const { error } = await client.rpc('mark_group_as_read', {
      p_group_id: activeGroup.id,
      p_user_id: user.id,
      p_last_message_id: lastMessage.id
    });

    if (error) {
      console.error('[unread] Mark as read error:', error);
      return;
    }

    console.log('[unread] Marked as read:', activeGroup.id);
    
    // Update Sidebar state directly
    // TODO: Add a way to notify Sidebar
  } catch (err) {
    console.error('[unread] Failed to mark as read:', err);
  }
}
```

### Test Step 1

**Test 1.1: Initial Load**
- [ ] Open app
- [ ] Check logs: `[unread] Fetched counts: [[groupId, count]]`
- [ ] Verify badges show correct counts
- [ ] Restart app
- [ ] Verify counts persist (from Supabase)

**Test 1.2: Mark as Read**
- [ ] Open group with unread count
- [ ] Check logs: `[unread] Marked as read: <groupId>`
- [ ] Restart app
- [ ] Verify count is now 0 (persisted in Supabase)

**DO NOT PROCEED until both tests pass!**

---

## Step 2: Add Simple State Updates (NO REALTIME YET)

### Goal
Make badge update immediately when marking as read, without waiting for restart.

### Implementation

**Create simple helper in Sidebar:**

```typescript
// Helper to update a single group's count
function updateUnreadCount(groupId: string, count: number) {
  console.log(`[unread] Updating count for ${groupId}: ${count}`);
  setUnreadCounts(prev => {
    const next = new Map(prev);
    next.set(groupId, count);
    return next;
  });
}

// Expose to ChatArea via context or store
```

**Update ChatArea to call helper:**

```typescript
async function markAsRead() {
  // ... existing RPC call ...
  
  if (!error) {
    console.log('[unread] Marked as read, updating UI');
    // Call Sidebar helper to update count to 0
    updateUnreadCount(activeGroup.id, 0);
  }
}
```

### Test Step 2

**Test 2.1: Immediate Update**
- [ ] Open group with unread count
- [ ] Badge should go to 0 immediately (no restart needed)
- [ ] Check logs: `[unread] Updating count for <groupId>: 0`
- [ ] Restart app
- [ ] Verify count stays at 0

**DO NOT PROCEED until test passes!**

---

## Step 3: Verify Realtime/FCM Ingestion Works

### Goal
Confirm messages are actually being received before adding unread logic.

### Implementation

**Add test logs to realtime handler:**

```typescript
channel.on('postgres_changes', {
  event: 'INSERT', schema: 'public', table: 'messages'
}, (payload) => {
  console.log('[realtime-test] ✅ INSERT received:', payload.new.id);
  // ... existing logic ...
});
```

**Add test logs to FCM handler:**

```typescript
async function handleNotificationReceived(data: any) {
  console.log('[fcm-test] ✅ Notification received:', data.message_id);
  // ... existing logic ...
}
```

### Test Step 3

**Test 3.1: Realtime**
- [ ] User A: Open app, stay on dashboard
- [ ] User B: Send message
- [ ] Check User A logs: `[realtime-test] ✅ INSERT received`
- [ ] If missing → Fix realtime subscription first

**Test 3.2: FCM**
- [ ] User A: Open app, stay on dashboard
- [ ] User B: Send message
- [ ] Check User A logs: `[fcm-test] ✅ Notification received`
- [ ] If missing → Fix FCM configuration first

**DO NOT PROCEED until both tests pass!**

---

## Step 4: Add Increment on New Message

### Goal
Increment badge when message arrives (realtime or FCM).

### Implementation

**Add increment helper in Sidebar:**

```typescript
function incrementUnreadCount(groupId: string) {
  console.log(`[unread] Incrementing count for ${groupId}`);
  setUnreadCounts(prev => {
    const current = prev.get(groupId) || 0;
    const next = current + 1;
    console.log(`[unread] ${groupId}: ${current} → ${next}`);
    
    const newCounts = new Map(prev);
    newCounts.set(groupId, next);
    return newCounts;
  });
}
```

**Call from realtime handler:**

```typescript
channel.on('postgres_changes', {
  event: 'INSERT', schema: 'public', table: 'messages'
}, (payload) => {
  const row = payload.new;
  console.log('[realtime-test] ✅ INSERT received:', row.id);
  
  // ... existing message handling ...
  
  // Check if should increment unread
  const { user } = useAuthStore.getState();
  const { activeGroup } = useChatStore.getState();
  
  const isOwnMessage = row.user_id === user?.id;
  const isActiveGroup = activeGroup?.id === row.group_id;
  
  console.log('[realtime-test] Increment check:', {
    isOwnMessage,
    isActiveGroup,
    shouldIncrement: !isOwnMessage && !isActiveGroup
  });
  
  if (!isOwnMessage && !isActiveGroup) {
    console.log('[realtime-test] ✅ Calling incrementUnreadCount');
    incrementUnreadCount(row.group_id);
  }
});
```

**Call from FCM handler:**

```typescript
async function handleNotificationReceived(data: any) {
  console.log('[fcm-test] ✅ Notification received:', data.message_id);
  
  // ... existing message handling ...
  
  // Check if should increment unread
  const { user } = useAuthStore.getState();
  const { activeGroup } = useChatStore.getState();
  
  const isOwnMessage = data.user_id === user?.id;
  const isActiveGroup = activeGroup?.id === data.group_id;
  
  console.log('[fcm-test] Increment check:', {
    isOwnMessage,
    isActiveGroup,
    shouldIncrement: !isOwnMessage && !isActiveGroup
  });
  
  if (!isOwnMessage && !isActiveGroup) {
    console.log('[fcm-test] ✅ Calling incrementUnreadCount');
    incrementUnreadCount(data.group_id);
  }
}
```

### Test Step 4

**Test 4.1: Realtime Increment**
- [ ] User A: Stay on dashboard
- [ ] User B: Send message
- [ ] Check User A logs:
  ```
  [realtime-test] ✅ INSERT received
  [realtime-test] Increment check: {isOwnMessage: false, isActiveGroup: false, shouldIncrement: true}
  [realtime-test] ✅ Calling incrementUnreadCount
  [unread] Incrementing count for <groupId>
  [unread] <groupId>: 0 → 1
  ```
- [ ] Verify badge increments immediately

**Test 4.2: FCM Increment**
- [ ] User A: Close app or background it
- [ ] User B: Send message
- [ ] User A: Open app
- [ ] Check logs (same as 4.1)
- [ ] Verify badge shows correct count

**Test 4.3: Own Message (Should NOT Increment)**
- [ ] User A: Stay on dashboard
- [ ] User A: Send message from another device
- [ ] Check logs: `shouldIncrement: false` (isOwnMessage: true)
- [ ] Verify badge does NOT increment

**Test 4.4: Active Group (Should NOT Increment)**
- [ ] User A: Open Group X
- [ ] User B: Send message to Group X
- [ ] Check logs: `shouldIncrement: false` (isActiveGroup: true)
- [ ] Verify badge does NOT increment
- [ ] Badge should go to 0 (mark as read)

**DO NOT PROCEED until all tests pass!**

---

## Step 5: Optional Refactoring

### Goal
If everything works, optionally extract to a shared module.

### Implementation

**Create `src/lib/unreadManager.ts`:**

```typescript
// Simple manager, no caching, no timers
export class UnreadManager {
  private counts = new Map<string, number>();
  private listeners: Array<(counts: Map<string, number>) => void> = [];

  async fetchFromSupabase(userId: string) {
    // ... RPC call ...
    this.counts = newCounts;
    this.notifyListeners();
  }

  increment(groupId: string) {
    const current = this.counts.get(groupId) || 0;
    this.counts.set(groupId, current + 1);
    this.notifyListeners();
  }

  setCount(groupId: string, count: number) {
    this.counts.set(groupId, count);
    this.notifyListeners();
  }

  subscribe(listener: (counts: Map<string, number>) => void) {
    this.listeners.push(listener);
    return () => {
      const index = this.listeners.indexOf(listener);
      if (index > -1) this.listeners.splice(index, 1);
    };
  }

  private notifyListeners() {
    for (const listener of this.listeners) {
      listener(new Map(this.counts));
    }
  }
}

export const unreadManager = new UnreadManager();
```

**Only do this refactoring if:**
- All tests in Steps 1-4 pass
- You need to share state across multiple components
- The simple approach is working perfectly

---

## Key Principles

### ✅ DO
- Start simple (RPC only)
- Test each step before moving on
- Log everything
- Use two different users for testing
- Keep state in one place (Sidebar)

### ❌ DON'T
- Add caching until basic flow works
- Add timers or debouncing
- Add complex listener systems
- Move to next step if current step fails
- Test with same user on both devices

## Success Criteria

After completing all steps:

✅ Badge shows correct count on app start (from Supabase)  
✅ Badge goes to 0 when opening chat (mark as read)  
✅ Badge increments when message arrives (realtime/FCM)  
✅ Badge persists correctly after restart  
✅ Own messages don't increment badge  
✅ Active group messages don't increment badge  

## Why This Approach Works

1. **Incremental** - Each step builds on previous
2. **Testable** - Clear pass/fail for each step
3. **Simple** - No unnecessary complexity
4. **Debuggable** - Clear logs at each step
5. **Proven** - Each step must work before moving on

## Estimated Time

- Step 1: 30 minutes
- Step 2: 15 minutes
- Step 3: 15 minutes (or longer if realtime/FCM broken)
- Step 4: 30 minutes
- Step 5: 30 minutes (optional)

**Total: 2 hours** (vs days of debugging complex system)

---

## Current Status

The existing code has:
- ✅ Working Supabase RPCs
- ✅ Working UI rendering
- ❌ Unclear increment path
- ❌ Too much complexity

**Recommendation:** Start fresh with Step 1, following this plan exactly.
