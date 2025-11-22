# Auth Calls Audit - Session Refresh Triggers

## Executive Summary

Found **3 active files** with direct `auth.getUser()` calls that can trigger Supabase's internal refresh:

1. ✅ **FIXED:** `src/store/chatstore_refactored/fetchActions.ts` - Already replaced with `getCachedSession()`
2. ⚠️ **NEEDS FIX:** `src/lib/contactMatchingService.ts` - 3 instances of `auth.getUser()`
3. ⚠️ **NEEDS FIX:** `src/lib/unreadTracker.ts` - 1 instance of `auth.getUser()`

## Detailed Findings

### Files with Direct Auth Calls (Active Code)

#### 1. src/lib/contactMatchingService.ts ⚠️ HIGH PRIORITY
**Lines:** 39, 109, 208
**Pattern:**
```typescript
const client = await supabasePipeline.getDirectClient();
const { data: { user } } = await client.auth.getUser();  // ❌ Can trigger refresh
```

**Impact:** 
- Called during contact matching/discovery
- Can cause 10-15s hangs
- Blocks contact sync operations

**Fix Needed:**
```typescript
// Replace with:
const session = await supabasePipeline.getCachedSession();
if (!session?.user) throw new Error('Not authenticated');
const userId = session.user.id;
```

---

#### 2. src/lib/unreadTracker.ts ⚠️ MEDIUM PRIORITY
**Line:** 71
**Pattern:**
```typescript
const { data: { user } } = await client.auth.getUser();  // ❌ Can trigger refresh
```

**Impact:**
- Called during unread count calculations
- Can cause delays in unread badge updates
- Less critical than contact matching

**Fix Needed:**
```typescript
// Replace with:
const session = await supabasePipeline.getCachedSession();
if (!session?.user) throw new Error('Not authenticated');
const userId = session.user.id;
```

**Note:** Line 186 has a comment about using cached session but doesn't implement it yet.

---

### Files with Auth Calls (Backup/Inactive)

#### 3. src/lib/supabasePipeline.phase2.backup.ts
**Status:** ⚠️ BACKUP FILE - Not active code
**Lines:** Multiple instances of `auth.setSession()`, `auth.refreshSession()`, `auth.getSession()`, `auth.getUser()`

**Action:** No fix needed (backup file)

---

#### 4. src/lib/supabasePipeline.ts (Internal Use Only)
**Status:** ✅ INTERNAL - Only used within refreshSessionUnified()
**Lines:** 390, 406, 499, 517, 1151, 1166, 1256, 1327, 1384, 3267, 3290

**Pattern:**
```typescript
// These are INTERNAL to the pipeline's refresh logic
client.auth.setSession()      // Used in refreshSessionUnified()
client.auth.refreshSession()  // Used in refreshSessionUnified()
client.auth.getSession()      // Used in getSession() wrapper
client.auth.getUser()         // Used in getUser() wrapper
```

**Action:** No fix needed - these are controlled by the pipeline with proper timeouts

---

### Files Using getClient() (Potential Triggers)

These files call `getClient()` or `getDirectClient()` which **could** trigger refresh if token is expiring:

1. `src/lib/sqliteServices_Refactored/syncOperations.ts` - Line 50
2. `src/lib/backgroundMessageSync.ts` - Lines 98, 111
3. `src/lib/connectivityTest.ts` - Line 472
4. `src/lib/contactMatchingService.ts` - Lines 38, 108, 207
5. `src/lib/joinRequestService.ts` - Lines 40, 75, 106, 137, 169, 201, 229, 257
6. `src/lib/networkDiagnostics.ts` - Line 155

**Status:** ✅ SAFE - These use `getClient()` which now has smart token expiration checks (only refreshes if token expires in < 5 minutes)

---

## Priority Fix List

### HIGH PRIORITY (Blocks Operations)

1. **src/lib/contactMatchingService.ts** - 3 instances
   - Line 39: `matchContactsWithUsers()`
   - Line 109: `discoverRegisteredUsers()`
   - Line 208: `syncContactsToSupabase()`

### MEDIUM PRIORITY (Causes Delays)

2. **src/lib/unreadTracker.ts** - 1 instance
   - Line 71: `getUnreadCount()`

---

## Recommended Fix Pattern

### Before (Triggers Refresh):
```typescript
const client = await supabasePipeline.getDirectClient();
const { data: { user } } = await client.auth.getUser();  // ❌ Can hang 10-15s
if (!user) throw new Error('Not authenticated');
const userId = user.id;
```

### After (Uses Cache):
```typescript
const session = await supabasePipeline.getCachedSession();  // ✅ Instant
if (!session?.user) throw new Error('Not authenticated');
const userId = session.user.id;

// Still get client for queries (but don't call auth methods on it)
const client = await supabasePipeline.getDirectClient();
```

---

## Implementation Plan

### Step 1: Fix contactMatchingService.ts
```typescript
// Line 39 - matchContactsWithUsers()
const session = await supabasePipeline.getCachedSession();
if (!session?.user) throw new Error('Not authenticated');
const userId = session.user.id;

// Line 109 - discoverRegisteredUsers()
const session = await supabasePipeline.getCachedSession();
if (!session?.user) throw new Error('Not authenticated');
const userId = session.user.id;

// Line 208 - syncContactsToSupabase()
const session = await supabasePipeline.getCachedSession();
if (!session?.user) throw new Error('Not authenticated');
const userId = session.user.id;
```

### Step 2: Fix unreadTracker.ts
```typescript
// Line 71 - getUnreadCount()
const session = await supabasePipeline.getCachedSession();
if (!session?.user) throw new Error('Not authenticated');
const userId = session.user.id;
```

---

## Testing Checklist

After fixes:
- [ ] Contact matching completes without 10-15s delays
- [ ] Contact discovery works instantly
- [ ] Unread count updates quickly
- [ ] No "refreshSession TIMEOUT" in logs
- [ ] No "auth.getUser()" calls in hot paths

---

## Summary Statistics

| Category | Count | Status |
|----------|-------|--------|
| Active files with auth.getUser() | 2 | ⚠️ Need fixing |
| Total auth.getUser() calls to fix | 4 | ⚠️ Need fixing |
| Backup files with auth calls | 1 | ✅ Ignore |
| Internal pipeline auth calls | Many | ✅ Safe (controlled) |
| Files using getClient() | 6 | ✅ Safe (smart refresh) |

---

## Expected Impact After Fixes

| Operation | Before | After |
|-----------|--------|-------|
| Contact matching | 10-15s timeout | < 1s |
| Contact discovery | 10-15s timeout | < 1s |
| Unread count fetch | 5-10s delay | < 1s |
| Contact sync | 10-15s timeout | < 1s |

---

**Audit Date:** 2024-11-23
**Status:** 2 files need fixing (4 total calls)
**Priority:** HIGH (blocks contact operations)
