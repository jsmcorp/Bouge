# Unread Count Debug Logs - What to Look For

## The Issue
Based on the logs you provided, the backend is working correctly:
- ✅ `markGroupAsRead` is being called
- ✅ Supabase RPC returns count=0
- ✅ Dashboard refresh is triggered
- ❌ But the UI badge doesn't update

## Root Cause
The problem is in the **UI state wiring**, not the backend. The data says "0 unread" but React isn't re-rendering the badge.

## New Logging Added

I've added comprehensive logging to trace the exact flow:

### 1. Unread Tracker Logs
```
[unread] Force refresh - clearing cache
[unread] Fetched counts for X groups: [[groupId, count], ...]
```

### 2. Sidebar State Update Logs
```
[Sidebar] Groups changed, fetching unread counts
[Sidebar] setUnreadCounts called with: [[groupId, count], ...]
[Sidebar] Subscribing to unread count updates
[Sidebar] Unread callback fired: groupId=..., count=...
[Sidebar] Updated unreadCounts map: [[groupId, count], ...]
[Sidebar] unreadCounts state changed: [[groupId, count], ...]
```

### 3. Dashboard Refresh Logs
```
📊 Dashboard visible - force refreshing unread counts
[Sidebar] Dashboard refresh - setUnreadCounts called with: [[groupId, count], ...]
```

### 4. Badge Render Logs
```
[SidebarRow] Rendering badge for GroupName: count=X
```

## What to Test

### Test Scenario 1: Open Chat and Return
1. Open the app to dashboard
2. Open a group with unread messages
3. Wait 1 second
4. Navigate back to dashboard

**Expected Log Sequence:**
```
1. [unread] Marking group ... as read, lastMessageId=...
2. [unread] ✅ Group ... marked as read
3. 📊 Dashboard visible - force refreshing unread counts
4. [unread] Force refresh - clearing cache
5. [unread] Fetched counts for 1 groups: [[groupId, 0]]
6. [Sidebar] Dashboard refresh - setUnreadCounts called with: [[groupId, 0]]
7. [Sidebar] unreadCounts state changed: [[groupId, 0]]
8. [SidebarRow] Rendering badge for GroupName: count=0
```

**If badge still shows:**
- Check if step 7 happens (state update)
- Check if step 8 shows count=0 but badge still renders
- This would indicate a rendering/CSS issue, not state

**If step 7 doesn't happen:**
- The Map object might not be triggering re-render
- React might think it's the same object

### Test Scenario 2: Quick Navigation
1. Open group with unread
2. Immediately press back (< 1 second)
3. Wait 1 second on dashboard

**Expected Log Sequence:**
```
1. ✅ [cleanup] Marked group ... as read on navigation away
2. [unread] Marking group ... as read, lastMessageId=...
3. [unread] ✅ Group ... marked as read
4. [Sidebar] Unread callback fired: groupId=..., count=0
5. [Sidebar] Updated unreadCounts map: [[groupId, 0]]
6. [Sidebar] unreadCounts state changed: [[groupId, 0]]
7. 📊 Dashboard visible - force refreshing unread counts
8. [unread] Force refresh - clearing cache
9. [unread] Fetched counts for 1 groups: [[groupId, 0]]
10. [Sidebar] Dashboard refresh - setUnreadCounts called with: [[groupId, 0]]
11. [Sidebar] unreadCounts state changed: [[groupId, 0]]
12. [SidebarRow] Rendering badge for GroupName: count=0
```

## Potential Issues to Identify

### Issue 1: State Update Not Triggering Re-render
**Symptom:** You see:
```
[Sidebar] Dashboard refresh - setUnreadCounts called with: [[groupId, 0]]
```
But NOT:
```
[Sidebar] unreadCounts state changed: [[groupId, 0]]
```

**Cause:** React isn't detecting the state change because the Map object identity is the same.

**Solution:** Ensure we're creating a new Map object, not mutating the existing one.

### Issue 2: Re-render Happens But Badge Still Shows
**Symptom:** You see:
```
[Sidebar] unreadCounts state changed: [[groupId, 0]]
[SidebarRow] Rendering badge for GroupName: count=0
```
But the badge is still visible in the UI.

**Cause:** The badge rendering logic has a bug, or there's a CSS issue.

**Solution:** Check the badge conditional rendering logic.

### Issue 3: Callback Not Firing
**Symptom:** You see:
```
[unread] ✅ Group ... marked as read
```
But NOT:
```
[Sidebar] Unread callback fired: groupId=..., count=0
```

**Cause:** The callback subscription isn't working, or `notifyUpdate` isn't being called.

**Solution:** Check if `this.notifyUpdate(groupId, 0)` is being called in `markGroupAsRead`.

### Issue 4: Dashboard Refresh Not Triggering
**Symptom:** You navigate back to dashboard but don't see:
```
📊 Dashboard visible - force refreshing unread counts
```

**Cause:** The `activeGroup` state isn't being cleared, or the effect dependency isn't triggering.

**Solution:** Check if `setActiveGroup(null)` is being called when navigating to dashboard.

## Quick Diagnostic Commands

### Check Current Unread Counts in Console
```javascript
// In React Native debugger or browser console
const { unreadTracker } = require('./src/lib/unreadTracker');
unreadTracker.getAllUnreadCounts(true).then(counts => {
  console.log('Current unread counts:', Array.from(counts.entries()));
});
```

### Force Clear Cache
```javascript
const { unreadTracker } = require('./src/lib/unreadTracker');
unreadTracker.clearCache();
console.log('Cache cleared');
```

### Check Sidebar State
```javascript
// In React DevTools, find the Sidebar component and inspect:
// - unreadCounts (should be a Map)
// - activeGroup (should be null when on dashboard)
// - groups (should have your groups)
```

## Next Steps Based on Logs

### If you see all logs but badge still shows:
1. Check if the badge component is memoized (React.memo)
2. Check if there's a CSS issue (badge hidden but still in DOM)
3. Check if there are multiple Sidebar instances rendering

### If state update logs are missing:
1. The Map object might not be triggering re-render
2. Try converting to a plain object: `setUnreadCounts(Object.fromEntries(counts))`
3. Or force a new Map: `setUnreadCounts(new Map(counts))`

### If callback logs are missing:
1. Check if `markGroupAsRead` is actually completing
2. Check if there's an error in `notifyUpdate`
3. Check if the subscription is being cleaned up too early

## Success Criteria

When working correctly, you should see this complete flow:

```
[User opens chat]
→ Messages load
→ User navigates back
→ ✅ [cleanup] Marked group as read
→ [unread] Marking group ... as read
→ [unread] ✅ Group marked as read
→ [Sidebar] Unread callback fired: count=0
→ [Sidebar] Updated unreadCounts map: [[groupId, 0]]
→ [Sidebar] unreadCounts state changed: [[groupId, 0]]
→ 📊 Dashboard visible - force refreshing
→ [unread] Force refresh - clearing cache
→ [unread] Fetched counts: [[groupId, 0]]
→ [Sidebar] Dashboard refresh - setUnreadCounts: [[groupId, 0]]
→ [Sidebar] unreadCounts state changed: [[groupId, 0]]
→ [SidebarRow] Rendering badge: count=0
→ Badge disappears from UI ✅
```

## Files Modified for Debugging

1. `src/components/dashboard/Sidebar.tsx` - Added extensive logging
2. `src/lib/unreadTracker.ts` - Added forceRefresh parameter and logging
3. `src/components/dashboard/ChatArea.tsx` - Already has cleanup logging

Run the test scenario and share the complete log output. The logs will tell us exactly where the flow breaks.
