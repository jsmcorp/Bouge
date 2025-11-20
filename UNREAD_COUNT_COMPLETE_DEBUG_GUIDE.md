# Complete Unread Count Debug Guide

## Current Status

✅ **UI Wiring Fixed** - The Sidebar correctly updates when `setUnreadCounts` is called  
❓ **Backend Mark-as-Read** - Need to verify if `markGroupAsRead` is being called and working

## New Comprehensive Logging Added

### ChatArea Component Logs

**When messages load:**
```
[ChatArea] Updated lastMessageIdRef to: <messageId>
```

**When mark-as-read effect triggers:**
```
[ChatArea] Mark-as-read effect triggered for group: <groupId>, lastMessageId: <messageId>
[ChatArea] Setting 2-second timer to mark group <groupId> as read
```

**When 2-second timer fires:**
```
[ChatArea] 2-second timer fired! Marking group <groupId> as read
✅ [ChatArea] Timer: Marked group <groupId> as read up to message <messageId>
```

**When navigating away (cleanup):**
```
[ChatArea] Cleanup effect running for group: <groupId>
[ChatArea] Cleanup: Clearing timer
[ChatArea] Cleanup: Marking group <groupId> as read (navigation away)
✅ [ChatArea] Cleanup: Marked group <groupId> as read on navigation away
```

### Unread Tracker Logs

**When markGroupAsRead is called:**
```
[unread] 🔵 markGroupAsRead CALLED - groupId: <groupId>, lastMessageId: <messageId>
[unread] 📡 Calling Supabase RPC mark_group_as_read for user <userId>
[unread] ✅ Supabase RPC mark_group_as_read succeeded
[unread] 📱 Native platform - updating SQLite
[unread] ✅ SQLite updated
[unread] 🗑️ Clearing cache for group <groupId>
[unread] 📢 Notifying listeners: groupId=<groupId>, count=0
[unread] ✅ markGroupAsRead COMPLETED for group <groupId>
```

**If there's an error:**
```
[unread] ❌ Error marking group as read in Supabase: <error>
[unread] ❌ markGroupAsRead FAILED: <error>
```

### Sidebar Logs

**When callback fires:**
```
[Sidebar] Unread callback fired: groupId=<groupId>, count=0
[Sidebar] Updated unreadCounts map: [[groupId, 0]]
[Sidebar] unreadCounts state changed: [[groupId, 0]]
```

**When dashboard refresh happens:**
```
📊 Dashboard visible - force refreshing unread counts
[unread] Force refresh - clearing cache
[unread] Fetched counts for X groups: [[groupId, count], ...]
[Sidebar] Dashboard refresh - setUnreadCounts called with: [[groupId, count], ...]
```

**When badge renders:**
```
[SidebarRow] Rendering badge for <GroupName>: count=<count>
```

## Complete Test Scenario

### Test: Open Chat, Wait, Return to Dashboard

**Steps:**
1. Open app to dashboard (should show unread badge)
2. Tap group with unread messages
3. Wait 3 seconds (to let timer fire)
4. Tap back button to return to dashboard
5. Wait 1 second for dashboard refresh

**Expected Complete Log Sequence:**

```
# Step 1: Dashboard loads
[Sidebar] Subscribing to unread count updates
[unread] Fetched counts for 1 groups: [[groupId, 5]]
[Sidebar] setUnreadCounts called with: [[groupId, 5]]
[Sidebar] unreadCounts state changed: [[groupId, 5]]
[SidebarRow] Rendering badge for Admin: count=5

# Step 2: Open chat
💬 ChatArea: Opening chat for group <groupId> (Admin)
[ChatArea] Mark-as-read effect triggered for group: <groupId>, lastMessageId: null
[ChatArea] Not setting timer - activeGroup: <groupId>, lastMessageId: null
💬 ChatArea: Messages loaded in XXms
[ChatArea] Updated lastMessageIdRef to: <messageId>

# Step 3: Timer setup after messages load
[ChatArea] Mark-as-read effect triggered for group: <groupId>, lastMessageId: <messageId>
[ChatArea] Setting 2-second timer to mark group <groupId> as read

# Step 4: Timer fires after 2 seconds
[ChatArea] 2-second timer fired! Marking group <groupId> as read
[unread] 🔵 markGroupAsRead CALLED - groupId: <groupId>, lastMessageId: <messageId>
[unread] 📡 Calling Supabase RPC mark_group_as_read for user <userId>
[unread] ✅ Supabase RPC mark_group_as_read succeeded
[unread] 📱 Native platform - updating SQLite
[unread] ✅ SQLite updated
[unread] 🗑️ Clearing cache for group <groupId>
[unread] 📢 Notifying listeners: groupId=<groupId>, count=0
[unread] ✅ markGroupAsRead COMPLETED for group <groupId>
✅ [ChatArea] Timer: Marked group <groupId> as read up to message <messageId>
[Sidebar] Unread callback fired: groupId=<groupId>, count=0
[Sidebar] Updated unreadCounts map: [[groupId, 0]]
[Sidebar] unreadCounts state changed: [[groupId, 0]]

# Step 5: Navigate back to dashboard
[ChatArea] Cleanup effect running for group: <groupId>
[ChatArea] Cleanup: Clearing timer
📊 Dashboard visible - force refreshing unread counts
[unread] Force refresh - clearing cache
[unread] Fetched counts for 1 groups: [[groupId, 0]]
[Sidebar] Dashboard refresh - setUnreadCounts called with: [[groupId, 0]]
[Sidebar] unreadCounts state changed: [[groupId, 0]]
[SidebarRow] Rendering badge for Admin: count=0
```

### Test: Quick Navigation (< 2 seconds)

**Steps:**
1. Open app to dashboard
2. Tap group with unread messages
3. Immediately tap back (< 1 second)
4. Wait 1 second on dashboard

**Expected Log Sequence:**

```
# Open chat
💬 ChatArea: Opening chat for group <groupId>
[ChatArea] Mark-as-read effect triggered for group: <groupId>, lastMessageId: null
💬 ChatArea: Messages loaded
[ChatArea] Updated lastMessageIdRef to: <messageId>
[ChatArea] Mark-as-read effect triggered for group: <groupId>, lastMessageId: <messageId>
[ChatArea] Setting 2-second timer to mark group <groupId> as read

# Navigate back immediately (cleanup fires)
[ChatArea] Cleanup effect running for group: <groupId>
[ChatArea] Cleanup: Clearing timer
[ChatArea] Cleanup: Marking group <groupId> as read (navigation away)
[unread] 🔵 markGroupAsRead CALLED - groupId: <groupId>, lastMessageId: <messageId>
[unread] 📡 Calling Supabase RPC mark_group_as_read
[unread] ✅ Supabase RPC mark_group_as_read succeeded
[unread] 📢 Notifying listeners: groupId=<groupId>, count=0
[unread] ✅ markGroupAsRead COMPLETED
✅ [ChatArea] Cleanup: Marked group <groupId> as read on navigation away
[Sidebar] Unread callback fired: groupId=<groupId>, count=0
[Sidebar] Updated unreadCounts map: [[groupId, 0]]
[Sidebar] unreadCounts state changed: [[groupId, 0]]

# Dashboard refresh
📊 Dashboard visible - force refreshing unread counts
[unread] Force refresh - clearing cache
[unread] Fetched counts for 1 groups: [[groupId, 0]]
[Sidebar] Dashboard refresh - setUnreadCounts called with: [[groupId, 0]]
[SidebarRow] Rendering badge for Admin: count=0
```

## Diagnostic Checklist

Use this to identify exactly where the flow breaks:

### ✅ ChatArea Mounting
- [ ] See `💬 ChatArea: Opening chat for group`
- [ ] See `[ChatArea] Mark-as-read effect triggered`
- [ ] See `[ChatArea] Updated lastMessageIdRef`

### ✅ Timer Setup
- [ ] See `[ChatArea] Setting 2-second timer`
- [ ] OR see `[ChatArea] Not setting timer` (if no messages yet)

### ✅ Mark as Read Execution
- [ ] See `[unread] 🔵 markGroupAsRead CALLED`
- [ ] See `[unread] 📡 Calling Supabase RPC`
- [ ] See `[unread] ✅ Supabase RPC succeeded` (NOT error)
- [ ] See `[unread] 📢 Notifying listeners`
- [ ] See `[unread] ✅ markGroupAsRead COMPLETED`

### ✅ Callback Notification
- [ ] See `[Sidebar] Unread callback fired: count=0`
- [ ] See `[Sidebar] Updated unreadCounts map: [[groupId, 0]]`
- [ ] See `[Sidebar] unreadCounts state changed: [[groupId, 0]]`

### ✅ Dashboard Refresh
- [ ] See `📊 Dashboard visible - force refreshing`
- [ ] See `[unread] Fetched counts: [[groupId, 0]]`
- [ ] See `[Sidebar] Dashboard refresh - setUnreadCounts: [[groupId, 0]]`

### ✅ Badge Update
- [ ] See `[SidebarRow] Rendering badge: count=0`
- [ ] Badge actually disappears from UI

## Common Issues and Solutions

### Issue 1: markGroupAsRead Never Called
**Symptoms:**
- No `[unread] 🔵 markGroupAsRead CALLED` log
- Badge stays at original count

**Possible Causes:**
- Timer not firing (navigated away too quickly)
- Cleanup not running (effect dependency issue)
- `lastMessageIdRef.current` is null

**Check:**
- Did you see `[ChatArea] Setting 2-second timer`?
- Did you see `[ChatArea] Cleanup effect running`?
- Did you see `[ChatArea] Updated lastMessageIdRef`?

### Issue 2: Supabase RPC Fails
**Symptoms:**
- See `[unread] 🔵 markGroupAsRead CALLED`
- See `[unread] ❌ Error marking group as read in Supabase`
- Badge doesn't update

**Possible Causes:**
- RPC function doesn't exist
- Permission denied
- Network error

**Check:**
- Look at the error message
- Verify `mark_group_as_read` RPC exists in Supabase
- Check network connectivity

### Issue 3: Callback Fires But State Doesn't Update
**Symptoms:**
- See `[Sidebar] Unread callback fired: count=0`
- Don't see `[Sidebar] unreadCounts state changed`
- Badge doesn't update

**Possible Causes:**
- React not detecting Map change
- State update batching issue

**Solution:**
- Already fixed with new Map creation

### Issue 4: State Updates But Badge Still Shows
**Symptoms:**
- See `[Sidebar] unreadCounts state changed: [[groupId, 0]]`
- See `[SidebarRow] Rendering badge: count=0`
- Badge still visible in UI

**Possible Causes:**
- Badge rendering logic bug
- CSS issue
- Multiple Sidebar instances

**Check:**
- Inspect the badge element in DevTools
- Check if `count=0` but badge still renders

### Issue 5: Dashboard Refresh Returns Wrong Count
**Symptoms:**
- See `[unread] ✅ markGroupAsRead COMPLETED`
- See `📊 Dashboard visible - force refreshing`
- See `[unread] Fetched counts: [[groupId, 5]]` (not 0!)

**Possible Causes:**
- Supabase RPC not actually updating the data
- Reading from wrong table/column
- Race condition (fetch happens before write completes)

**Solution:**
- Check Supabase RPC implementation
- Verify `group_members.last_read_at` is being updated
- Add delay before dashboard refresh

## What to Share

When reporting the issue, please share:

1. **Complete log output** from app open to badge issue
2. **Which logs are missing** from the expected sequence
3. **Any error messages** (especially `[unread] ❌` logs)
4. **Exact steps** you performed
5. **Screenshot** of the badge still showing

## Success Criteria

When working correctly, you should see:

✅ All ChatArea logs (mount, timer, cleanup)  
✅ All markGroupAsRead logs (called, RPC, completed)  
✅ All callback logs (fired, updated, state changed)  
✅ All dashboard refresh logs (visible, fetched, setUnreadCounts)  
✅ Badge render log with count=0  
✅ Badge actually disappears from UI  

The extensive logging will pinpoint exactly where the flow breaks!
