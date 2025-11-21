# Unified Unread Count & Separator System - Implementation Plan

## Current State Analysis

### Two Separate Systems:

1. **Unread Separator (firstUnreadMessageId)**
   - Managed in: `src/store/chatstore_refactored/` (state)
   - Calculated by: `sqliteService.calculateFirstUnreadLocal()` in `memberOperations.ts`
   - Logic: Uses `last_read_message_id` from SQLite to find first unread message
   - Displayed in: `MessageList.tsx` as a visual separator line

2. **Unread Count Badge**
   - Managed in: `Sidebar.tsx` component state (`unreadCounts` Map)
   - Calculated by: `unreadTracker.getAllUnreadCounts()` (separate service)
   - Updated via: Global functions `__updateUnreadCount` and `__incrementUnreadCount`
   - Displayed in: `Sidebar.tsx` as green badge next to group names

### The Problem:
- **Two sources of truth** → Can get out of sync
- **Duplicate logic** → Harder to maintain
- **Inconsistent updates** → Badge might show 5 unread, but separator shows 3
- **Race conditions** → Updates happen independently

---

## Proposed Solution: Single Source of Truth

### Core Principle:
**The unread separator calculation should be the ONLY source of truth for unread counts.**

### Why This Makes Sense:
1. ✅ `calculateFirstUnreadLocal()` already counts unread messages
2. ✅ It's based on SQLite (persistent, reliable)
3. ✅ It uses `last_read_message_id` (accurate tracking)
4. ✅ It filters out own messages (correct logic)
5. ✅ It's already called when opening a chat

---

## Implementation Plan

### Phase 1: Enhance the Store State
**File:** `src/store/chatstore_refactored/types.ts`

**Changes:**
```typescript
// Add unread counts map to global state
unreadCounts: Map<string, number>; // groupId → unread count
```

**Rationale:** Store unread counts for ALL groups in Zustand, not just active group.

---

### Phase 2: Create Unified Unread Actions
**File:** `src/store/chatstore_refactored/unreadActions.ts` (NEW)

**Functions to create:**

1. **`calculateUnreadForGroup(groupId: string)`**
   - Calls `sqliteService.calculateFirstUnreadLocal()`
   - Updates BOTH `firstUnreadMessageId` AND `unreadCounts` map
   - Single function = single source of truth

2. **`refreshAllUnreadCounts()`**
   - Loops through all groups
   - Calculates unread for each
   - Updates the `unreadCounts` map
   - Called on app startup and when returning to dashboard

3. **`incrementUnreadForGroup(groupId: string)`**
   - For realtime/FCM background messages
   - Increments count in map
   - Does NOT recalculate (performance)

4. **`clearUnreadForGroup(groupId: string)`**
   - When marking as read
   - Sets count to 0
   - Clears `firstUnreadMessageId`

---

### Phase 3: Update Fetch Actions
**File:** `src/store/chatstore_refactored/fetchActions.ts`

**Changes:**
- When calling `calculateFirstUnreadLocal()`, also update `unreadCounts` map
- Replace all instances of:
  ```typescript
  setSafely({
    firstUnreadMessageId: firstUnreadId,
    unreadCount: unreadCount
  });
  ```
  With:
  ```typescript
  setSafely({
    firstUnreadMessageId: firstUnreadId,
    unreadCount: unreadCount,
    unreadCounts: new Map(get().unreadCounts).set(groupId, unreadCount)
  });
  ```

---

### Phase 4: Update Realtime Actions
**File:** `src/store/chatstore_refactored/realtimeActions.ts`

**Changes:**
- When incrementing unread for background groups, update the map:
  ```typescript
  const counts = new Map(get().unreadCounts);
  counts.set(groupId, (counts.get(groupId) || 0) + 1);
  set({ unreadCounts: counts });
  ```

---

### Phase 5: Update Sidebar Component
**File:** `src/components/dashboard/Sidebar.tsx`

**Changes:**
- Remove local `unreadCounts` state
- Remove `unreadTracker` import
- Read from Zustand store instead:
  ```typescript
  const { groups, activeGroup, unreadCounts } = useChatStore();
  ```
- Remove global functions `__updateUnreadCount` and `__incrementUnreadCount`
- Call store actions directly

---

### Phase 6: Update State Actions
**File:** `src/store/chatstore_refactored/stateActions.ts`

**Changes:**
- When clearing unread separator, also clear from map:
  ```typescript
  clearUnreadSeparator: () => {
    const groupId = get().activeGroup?.id;
    if (groupId) {
      const counts = new Map(get().unreadCounts);
      counts.set(groupId, 0);
      set({ 
        firstUnreadMessageId: null,
        unreadCount: 0,
        unreadCounts: counts
      });
    }
  }
  ```

---

### Phase 7: Remove Duplicate Code
**Files to clean up:**
- Remove `src/lib/unreadTracker.ts` (if it exists)
- Remove any other unread counting logic outside the store

---

## Benefits of This Approach

### 1. **Single Source of Truth**
- All unread data comes from `calculateFirstUnreadLocal()`
- No more sync issues between badge and separator

### 2. **Consistency**
- Badge count = Number of messages after separator
- Always accurate, always in sync

### 3. **Performance**
- Calculate once, use everywhere
- No duplicate queries to SQLite

### 4. **Maintainability**
- One place to fix bugs
- One place to add features
- Clear data flow

### 5. **Reliability**
- Based on SQLite (persistent)
- Survives app restarts
- Handles offline scenarios

---

## Data Flow Diagram

```
┌─────────────────────────────────────────────────────────────┐
│                     USER ACTIONS                             │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│              SQLite: last_read_message_id                    │
│              (Single Source of Truth)                        │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│      calculateFirstUnreadLocal(groupId, userId, messages)    │
│      Returns: { firstUnreadId, unreadCount }                 │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│                    Zustand Store State                       │
│  • firstUnreadMessageId (for active group)                   │
│  • unreadCount (for active group)                            │
│  • unreadCounts: Map<groupId, count> (for ALL groups)        │
└─────────────────────────────────────────────────────────────┘
                              │
                ┌─────────────┴─────────────┐
                ▼                           ▼
┌───────────────────────────┐   ┌───────────────────────────┐
│     MessageList.tsx       │   │      Sidebar.tsx          │
│  Shows separator line     │   │  Shows badge count        │
│  at firstUnreadMessageId  │   │  from unreadCounts map    │
└───────────────────────────┘   └───────────────────────────┘
```

---

## Edge Cases to Handle

### 1. **First Time Opening Chat**
- `last_read_message_id` = null
- Result: No separator, count = 0
- ✅ Already handled in `calculateFirstUnreadLocal()`

### 2. **All Messages Read**
- `last_read_message_id` = latest message
- Result: No separator, count = 0
- ✅ Already handled

### 3. **Background Message Arrives**
- Increment count in map
- Don't recalculate (performance)
- Recalculate when user opens chat
- ✅ Needs implementation

### 4. **User Sends Message**
- Don't increment count (own message)
- ✅ Already filtered in `calculateFirstUnreadLocal()`

### 5. **Lazy Loading Older Messages**
- Separator might not be visible yet
- Count should still be accurate
- ✅ Already handled (based on message ID, not index)

### 6. **App Restart**
- Recalculate all counts from SQLite
- ✅ Needs implementation in app startup

---

## Testing Checklist

### Unit Tests:
- [ ] `calculateFirstUnreadLocal()` returns correct count
- [ ] Own messages are excluded from count
- [ ] First time opening chat returns 0
- [ ] All read returns 0

### Integration Tests:
- [ ] Badge count matches separator count
- [ ] Marking as read clears both badge and separator
- [ ] Background message increments badge
- [ ] Opening chat recalculates accurately

### Manual Tests:
- [ ] Open chat with unread → Badge and separator match
- [ ] Mark as read → Badge clears immediately
- [ ] Receive background message → Badge increments
- [ ] Restart app → Counts persist correctly
- [ ] Multiple groups → Each has correct count

---

## Migration Strategy

### Step 1: Add new state (non-breaking)
- Add `unreadCounts` map to store
- Keep old logic working

### Step 2: Implement new actions (parallel)
- Create `unreadActions.ts`
- Don't remove old code yet

### Step 3: Update components (gradual)
- Update Sidebar to use store
- Test thoroughly

### Step 4: Remove old code (cleanup)
- Remove `unreadTracker`
- Remove global functions
- Remove duplicate logic

---

## Estimated Effort

- **Phase 1-2:** 30 minutes (state + actions)
- **Phase 3-4:** 45 minutes (update existing actions)
- **Phase 5:** 20 minutes (update Sidebar)
- **Phase 6:** 15 minutes (update state actions)
- **Phase 7:** 10 minutes (cleanup)
- **Testing:** 30 minutes

**Total:** ~2.5 hours

---

## Success Criteria

✅ Badge count always equals number of messages after separator
✅ No more sync issues between badge and separator
✅ Single source of truth (SQLite)
✅ Performance maintained (no extra queries)
✅ Code is cleaner and more maintainable

---

## Questions to Answer Before Implementation

1. **Should we keep `unreadCount` in state for active group?**
   - Yes, for backward compatibility and quick access

2. **Should we recalculate on every message?**
   - No, only when opening chat or marking as read
   - Increment for background messages (performance)

3. **Should we persist `unreadCounts` map?**
   - No, recalculate on app startup from SQLite

4. **Should we expose actions globally?**
   - No, use Zustand store directly
   - Cleaner, more React-like

---

## Next Steps

1. Review this plan
2. Confirm approach
3. Start with Phase 1 (add state)
4. Implement incrementally
5. Test each phase
6. Deploy when stable

---

**Ready to implement? Let me know if you want to proceed or if you have any questions/changes!**
