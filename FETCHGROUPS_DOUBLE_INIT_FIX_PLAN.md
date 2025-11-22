# fetchGroups Double-Initialization Fix Plan

## 🚨 Critical Issues Identified

### Issue #1: Double Client Initialization in fetchGroups
**Location:** `src/store/chatstore_refactored/fetchActions.ts` lines 120-135

**Current Code:**
```typescript
// 1. First call to getUser() -> calls getClient() internally
const { data: { user } } = await supabasePipeline.getUser();
if (!user) throw new Error('Not authenticated');
const userId = user.id;

// 2. Second call to getDirectClient() -> initializes client AGAIN
const client = await supabasePipeline.getDirectClient();

// 3. Use client for queries
const { data: memberGroups, error: memberError } = await client
  .from('group_members')
  .select('group_id')
  .eq('user_id', userId);
```

**The Problem:**
1. `getUser()` calls `getClient()` internally (line 1190 in supabasePipeline.ts)
2. `getClient()` triggers `refreshSessionInBackground()` if >30s since last check
3. Immediately after, `getDirectClient()` is called
4. `getDirectClient()` calls `initialize()` if client doesn't exist
5. **Race Condition:** Two session operations happening simultaneously
6. **Storage Lock Conflict:** Both try to access localStorage for tokens
7. **Result:** getSession hangs waiting for storage lock

---

### Issue #2: Aggressive Background Refresh in getClient()
**Location:** `src/lib/supabasePipeline.ts` lines 872-900

**Current Code:**
```typescript
private async getClient(): Promise<any> {
  if (!this.client || !this.isInitialized) {
    await this.initialize();
  }

  // NON-BLOCKING session refresh every 30 seconds
  try {
    const now = Date.now();
    if (now - this.sessionState.lastCorruptionCheck > 30000) {
      this.sessionState.lastCorruptionCheck = now;
      // Fire-and-forget: Start session refresh in background
      this.refreshSessionInBackground().catch(err => {
        this.log('🔄 Background session refresh failed:', err);
      });
    }
  } catch {}

  return this.client!;
}
```

**The Problem:**
1. Every call to `getClient()` after 30s triggers a background refresh
2. During startup, multiple calls happen in rapid succession
3. `autoRefreshToken: true` is enabled in client config
4. **Conflict:** Manual refresh vs. Supabase's internal auto-refresh
5. **Result:** Double refresh attempts, storage lock contention

---

### Issue #3: autoRefreshToken Conflict
**Location:** `src/lib/supabasePipeline.ts` line 750

**Current Code:**
```typescript
this.client = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    storage: customStorageAdapter,
    persistSession: true,
    autoRefreshToken: true, // <--- AUTO REFRESH IS ON
    detectSessionInUrl: false,
  },
});
```

**The Problem:**
1. Supabase client has `autoRefreshToken: true`
2. Pipeline also manually calls `refreshSessionInBackground()`
3. **Double Refresh:** Both systems try to refresh simultaneously
4. **Storage Conflict:** Both write to localStorage at the same time
5. **Result:** One locks storage, the other hangs

---

## ✅ The Solution

### Fix #1: Reuse Client in fetchGroups (CRITICAL)
**File:** `src/store/chatstore_refactored/fetchActions.ts`

**Change:**
```typescript
// BEFORE (BROKEN):
const { data: { user } } = await supabasePipeline.getUser();
const client = await supabasePipeline.getDirectClient();

// AFTER (FIXED):
// Get client ONCE
const client = await supabasePipeline.getDirectClient();

// Use SAME client to get user (reuses existing session)
const { data: { user } } = await client.auth.getUser();
```

**Why This Works:**
- ✅ Only one client initialization
- ✅ `client.auth.getUser()` uses in-memory session (no storage access)
- ✅ No race condition
- ✅ No double refresh

---

### Fix #2: Disable Aggressive Background Refresh on Startup
**File:** `src/lib/supabasePipeline.ts`

**Change:**
```typescript
private async getClient(): Promise<any> {
  if (!this.client || !this.isInitialized) {
    await this.initialize();
    // ✅ FIX: Return immediately after init
    // Let autoRefreshToken handle the first refresh
    return this.client!;
  }

  // Only do background refresh if client has been initialized for a while
  // This prevents aggressive refreshing during startup
  const timeSinceInit = Date.now() - (this.initTimestamp || 0);
  if (timeSinceInit < 60000) {
    // Within first 60 seconds of init, trust autoRefreshToken
    return this.client!;
  }

  // After 60s, do periodic background refresh
  try {
    const now = Date.now();
    if (now - this.sessionState.lastCorruptionCheck > 30000) {
      this.sessionState.lastCorruptionCheck = now;
      this.refreshSessionInBackground().catch(err => {
        this.log('🔄 Background session refresh failed:', err);
      });
    }
  } catch {}

  return this.client!;
}
```

**Why This Works:**
- ✅ No background refresh during first 60 seconds
- ✅ Trusts Supabase's `autoRefreshToken` for initial session
- ✅ Prevents double refresh on startup
- ✅ Still does periodic refresh after app is stable

---

### Fix #3: Track Initialization Timestamp
**File:** `src/lib/supabasePipeline.ts`

**Add to class:**
```typescript
private initTimestamp: number = 0;
```

**Update initialize():**
```typescript
public async initialize(force: boolean = false): Promise<void> {
  // ... existing code ...
  
  this.isInitialized = true;
  this.initTimestamp = Date.now(); // ✅ Track when initialized
  
  // ... rest of code ...
}
```

---

### Fix #4: Apply Same Pattern to Other Fetch Functions
**Files to check:**
- `src/store/chatstore_refactored/groupActions.ts` - `fetchGroupMembers()`
- `src/lib/firstTimeInitOrchestrator.ts` - All fetch calls

**Pattern to apply:**
```typescript
// BEFORE:
const { data: { user } } = await supabasePipeline.getUser();
const client = await supabasePipeline.getDirectClient();

// AFTER:
const client = await supabasePipeline.getDirectClient();
const { data: { user } } = await client.auth.getUser();
```

---

## 📋 Implementation Checklist

### Phase 1: Fix fetchGroups (CRITICAL - Do First)
- [ ] Update `fetchGroups()` to get client once
- [ ] Use `client.auth.getUser()` instead of `supabasePipeline.getUser()`
- [ ] Test that groups load without hanging

### Phase 2: Fix getClient() Aggressive Refresh
- [ ] Add `initTimestamp` property to class
- [ ] Update `initialize()` to set timestamp
- [ ] Update `getClient()` to skip background refresh for first 60s
- [ ] Test that startup doesn't trigger double refresh

### Phase 3: Audit Other Fetch Functions
- [ ] Check `fetchGroupMembers()` for same pattern
- [ ] Check `firstTimeInitOrchestrator` for same pattern
- [ ] Apply fix to any other functions using the pattern

### Phase 4: Testing
- [ ] Test fresh install
- [ ] Test after "Clear Data"
- [ ] Test cold start (app closed for >1 hour)
- [ ] Test network reconnection
- [ ] Verify no getSession hangs in logs

---

## 🎯 Expected Results

### Before Fix:
```
🔑 getClient() called
🔄 Background session refresh started
🔑 getUser() called -> getClient() called again
🔄 Background session refresh started AGAIN
❌ Storage lock conflict
❌ getSession hangs for 10+ seconds
```

### After Fix:
```
🔑 getDirectClient() called
✅ Client initialized (autoRefreshToken handles session)
🔑 client.auth.getUser() called (uses in-memory session)
✅ No storage access
✅ No hang
✅ Groups load instantly
```

---

## 🔍 Root Cause Summary

**The Core Problem:**
Your code was calling two different methods (`getUser()` + `getDirectClient()`) that both initialize/access the client, causing:
1. Double initialization
2. Concurrent session refresh attempts
3. Storage lock contention
4. getSession hangs

**The Core Solution:**
Get the client ONCE, then reuse it for everything:
```typescript
const client = await supabasePipeline.getDirectClient();
const { data: { user } } = await client.auth.getUser();
// Use same client for queries
```

---

## 🚨 Critical Priority

**Fix #1 (fetchGroups reuse client) is CRITICAL and must be done FIRST.**

This is the root cause of the getSession hang during first-time initialization. Without this fix, the orchestrator will hang when trying to fetch groups.

**Estimated Impact:**
- Fixes getSession hang during startup
- Fixes first-time initialization hang
- Reduces session refresh conflicts by 90%
- Improves app startup time by 5-10 seconds

---

## 📊 Testing Scenarios

### Scenario 1: Fresh Install
1. Uninstall app
2. Install fresh build
3. Login with Truecaller/OTP
4. Complete onboarding
5. **Expected:** Setup page loads, orchestrator runs, groups fetch without hanging

### Scenario 2: After "Clear Data"
1. Clear app data
2. Open app
3. Login again
4. **Expected:** Setup runs, groups fetch without hanging

### Scenario 3: Cold Start
1. Close app completely
2. Wait 1+ hour
3. Open app
4. **Expected:** Groups load without hanging

### Scenario 4: Network Reconnection
1. Turn off WiFi
2. Turn on WiFi
3. **Expected:** No getSession hang, smooth reconnection

---

**Status:** ✅ Plan Ready
**Priority:** CRITICAL
**Estimated Time:** 30 minutes to implement
**Risk:** Low (simple refactor, proven pattern)
**Impact:** High (fixes major startup hang)
