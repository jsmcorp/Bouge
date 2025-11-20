# Current Status Summary - Unread Count System

## ✅ What's Working

### 1. Foreground Message Increments
**Status:** WORKING PERFECTLY ✅

**Flow:**
```
FCM Message → Native Service → NativeEventsPlugin → JS Listener → 
window.__incrementUnreadCount() → Sidebar State Update → Badge Render
```

**Evidence:** Logs show complete flow, badge updates immediately (~220ms)

### 2. Local Mark as Read
**Status:** WORKING LOCALLY ✅

**Flow:**
```
Open Chat → Messages Load → unreadTracker.markGroupAsRead() → 
window.__updateUnreadCount(groupId, 0) → Badge Goes to 0
```

**Evidence:** Badge goes to 0 when opening chat

### 3. Initial Count Fetch
**Status:** WORKING ✅

**Flow:**
```
App Start → Sidebar Mounts → unreadTracker.getAllUnreadCounts() → 
Supabase RPC → Counts Displayed
```

**Evidence:** Badges show correct counts on app start

## ❌ What's Broken

### 1. Background Message Increments
**Status:** NOT WORKING ❌

**Problem:**
- When app is backgrounded, JavaScript execution is paused
- Native FCM service receives message and writes to SQLite
- Native tries to call `NativeEventsPlugin.notifyNewMessage()` but JS is paused
- No increment happens in UI state
- Badge doesn't update until app is reopened

**Impact:**
- User backgrounds app
- Receives 5 messages
- Reopens app
- Badge still shows old count (not incremented by 5)

**Root Cause:** JavaScript can't run when app is backgrounded on Android

### 2. Mark as Read Persistence
**Status:** NOT PERSISTING ❌

**Problem:**
- `unreadTracker.markGroupAsRead()` is called
- RPC call to Supabase fails with error
- Error is logged as `[object Object]` (not detailed enough)
- Local state updates to 0 (badge goes to 0)
- But Supabase `last_read_at` is NOT updated
- On app restart, `get_all_unread_counts` returns stale high value (like 15)
- Badge jumps from 0 to 15

**Impact:**
- User opens chat, badge goes to 0
- User closes app
- User reopens app
- Badge shows 15 (phantom count)

**Root Cause:** Supabase RPC `mark_group_as_read` is failing

**Evidence from Logs:**
```
POST https://sxykfyqrqwifkirveqgr.supabase.co/rest/v1/rpc/mark_group_as_read
[unread] Error marking group as read in Supabase: [object Object]
```

## 🔧 Fixes Applied

### 1. Improved Error Logging
**File:** `src/lib/unreadTracker.ts`

**Change:**
```typescript
if (error) {
  console.error('[unread] ❌ Mark as read RPC error:', {
    message: error.message,
    details: error.details,
    hint: error.hint,
    code: error.code,
  });
  return false;
}
```

**Benefit:** Will show exact error details to diagnose Supabase RPC issue

**Status:** ✅ Built and synced, ready to test

## 🎯 Next Steps

### Immediate (Priority 1)

#### Step 1: Deploy and Check Error Logs
```bash
npx cap run android
```

**Action:** Open chat, check logs for detailed RPC error

**Expected:**
```
[unread] ❌ Mark as read RPC error: {
  message: "function mark_group_as_read does not exist",
  details: "...",
  hint: "...",
  code: "42883"
}
```

#### Step 2: Fix Supabase RPC Based on Error

**Possible Issues:**
1. Function doesn't exist → Run migration
2. Permission denied → Grant EXECUTE permission
3. Invalid UUID → Change parameter type to TEXT
4. RLS policy → Add UPDATE policy

**See:** `ACTION_PLAN_NEXT_STEPS.md` for detailed SQL fixes

#### Step 3: Test Mark as Read Persistence

**Test:**
1. Open chat → Badge goes to 0
2. Close app
3. Reopen app
4. **Expected:** Badge stays at 0 (not jumping to 15)

### Next (Priority 2)

#### Step 4: Fix Background Message Increments

**Strategy:** Use Supabase as source of truth

**Implementation:**
```typescript
App.addListener('appStateChange', async ({ isActive }) => {
  if (isActive) {
    // Re-fetch counts from Supabase on app resume
    const counts = await unreadTracker.getAllUnreadCounts();
    for (const [groupId, count] of counts.entries()) {
      window.__updateUnreadCount(groupId, count);
    }
  }
});
```

**Benefit:**
- Foreground: Fast local increments
- Background: Counted by Supabase
- Resume: Sync from Supabase (always correct)

## 📊 Architecture

### Current Flow

```
┌─────────────────────────────────────────────────────────────┐
│                     FOREGROUND (Working)                     │
├─────────────────────────────────────────────────────────────┤
│ FCM → Native → NativeEventsPlugin → JS → Increment → UI ✅  │
└─────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────┐
│                    BACKGROUND (Broken)                       │
├─────────────────────────────────────────────────────────────┤
│ FCM → Native → NativeEventsPlugin → (JS Paused) ❌          │
│                                                              │
│ Result: No increment, badge stays stale                     │
└─────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────┐
│                  MARK AS READ (Broken)                       │
├─────────────────────────────────────────────────────────────┤
│ Open Chat → markGroupAsRead() → Supabase RPC ❌             │
│                                                              │
│ Local: Badge → 0 ✅                                          │
│ Supabase: last_read_at NOT updated ❌                        │
│                                                              │
│ On Restart: get_all_unread_counts → 15 (stale) ❌           │
└─────────────────────────────────────────────────────────────┘
```

### Target Flow (After Fixes)

```
┌─────────────────────────────────────────────────────────────┐
│                     FOREGROUND (Working)                     │
├─────────────────────────────────────────────────────────────┤
│ FCM → Native → NativeEventsPlugin → JS → Increment → UI ✅  │
└─────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────┐
│                    BACKGROUND (Fixed)                        │
├─────────────────────────────────────────────────────────────┤
│ FCM → Native → SQLite → Supabase counts it ✅               │
│                                                              │
│ On Resume: Fetch from Supabase → Update UI ✅               │
└─────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────┐
│                  MARK AS READ (Fixed)                        │
├─────────────────────────────────────────────────────────────┤
│ Open Chat → markGroupAsRead() → Supabase RPC ✅             │
│                                                              │
│ Local: Badge → 0 ✅                                          │
│ Supabase: last_read_at updated ✅                            │
│                                                              │
│ On Restart: get_all_unread_counts → 0 ✅                    │
└─────────────────────────────────────────────────────────────┘
```

## 🎯 Success Criteria

After all fixes:

✅ **Foreground increments:** Immediate, responsive (already working)  
✅ **Background messages:** Counted by Supabase, synced on resume  
✅ **Mark as read:** Persists to Supabase correctly  
✅ **App restart:** Shows correct counts (no phantom values)  
✅ **WhatsApp-style UX:** Fast, reliable, predictable  

## 📝 Files Modified

### Already Modified
- ✅ `src/lib/unreadTracker.ts` - Improved error logging
- ✅ `src/lib/push.ts` - Added unread increment for non-active groups
- ✅ `src/vite-env.d.ts` - Added Window interface types
- ✅ `android/app/src/main/java/com/confessr/app/MyFirebaseMessagingService.java` - Added JS notification

### Need to Modify (After RPC Fixed)
- ⏳ `src/lib/push.ts` or `src/App.tsx` - Add app resume listener
- ⏳ `supabase/migrations/20250102_unread_tracking.sql` - Fix RPC function (if needed)

## 📋 Testing Status

### Completed Tests
- ✅ Foreground message increment
- ✅ Local mark as read (badge goes to 0)
- ✅ Initial count fetch on app start

### Pending Tests
- ⏳ Mark as read persistence (after RPC fix)
- ⏳ Background message handling (after app resume fix)
- ⏳ Multiple groups scenario
- ⏳ App restart with various unread states

## 🚀 Ready to Continue

**Current Build:** ✅ Ready to deploy  
**Next Action:** Deploy and check detailed RPC error logs  
**Expected Time:** 1-2 hours to complete all fixes  

See `ACTION_PLAN_NEXT_STEPS.md` for detailed step-by-step instructions.
