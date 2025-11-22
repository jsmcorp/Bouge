# Complete Supabase Client Audit

## Executive Summary

✅ **2 active clients found** - Both correctly configured with `autoRefreshToken: false`
✅ **Primary client:** `supabasePipeline` - Used throughout the app
⚠️ **Secondary client:** `supabase-client.ts` - Appears to be **UNUSED**

## All createClient Locations

### 1. src/lib/supabasePipeline.ts ✅ PRIMARY
**Line:** ~768
**Status:** ✅ Correctly configured
**Config:**
```typescript
createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    storage: customStorageAdapter,
    persistSession: true,
    autoRefreshToken: false,  // ✅ DISABLED
    detectSessionInUrl: false,
  },
  realtime: { worker: true },
  global: { fetch: /* 30s timeout */ }
})
```

**Used By (20+ files):**
- `src/lib/sqliteServices_Refactored/syncOperations.ts`
- `src/lib/backgroundMessageSync.ts`
- `src/lib/connectivityTest.ts`
- `src/lib/joinRequestService.ts`
- `src/store/chatstore_refactored/fetchActions.ts`
- Many more...

**Methods Used:**
- `supabasePipeline.getDirectClient()`
- `supabasePipeline.getCachedAccessToken()`
- `supabasePipeline.getCachedSession()` ← NEW FIX
- `supabasePipeline.onAppResume()`
- `supabasePipeline.checkHealth()`
- `supabasePipeline.recoverSession()`
- `supabasePipeline.processOutbox()`

---

### 2. src/lib/supabase-client.ts ⚠️ UNUSED
**Line:** 56
**Status:** ✅ Correctly configured but **appears unused**
**Config:**
```typescript
export const supabaseClient = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    storage: customStorageAdapter,
    persistSession: true,
    autoRefreshToken: false,  // ✅ DISABLED
    detectSessionInUrl: false,
  },
  realtime: { worker: true },
})
```

**Exports:**
- `supabaseClient` - Raw client
- `supabaseQuery` - Wrapper object

**Used By:** **NONE FOUND** ⚠️

The search found:
- ✅ The file itself (definition)
- ✅ A backup file (`supabasePipeline.phase2.backup.ts`)
- ❌ No actual usage in active code

**Recommendation:** This file can likely be **deleted** as it's not being used.

---

## Verification Results

### ✅ Both Clients Correctly Configured
| Setting | supabasePipeline | supabase-client |
|---------|------------------|-----------------|
| autoRefreshToken | ✅ false | ✅ false |
| persistSession | ✅ true | ✅ true |
| Custom storage | ✅ Yes | ✅ Yes |
| detectSessionInUrl | ✅ false | ✅ false |

### ✅ No Other createClient Calls Found
Searched:
- All `.ts` and `.tsx` files
- All imports from `@supabase/supabase-js`
- All `createClient(` patterns

Result: Only these 2 files create clients.

---

## Usage Analysis

### supabasePipeline - ACTIVE (Primary Client)

**Files Using It:**
1. `src/lib/sqliteServices_Refactored/syncOperations.ts`
2. `src/lib/backgroundMessageSync.ts`
3. `src/lib/connectivityTest.ts`
4. `src/lib/joinRequestService.ts`
5. `src/store/chatstore_refactored/fetchActions.ts` ← **FIXED**
6. Many more...

**Common Patterns:**
```typescript
// Get client
const client = await supabasePipeline.getDirectClient();

// Get cached session (NEW FIX)
const session = await supabasePipeline.getCachedSession();

// Get cached token
const token = supabasePipeline.getCachedAccessToken();

// Health check
const healthy = await supabasePipeline.checkHealth();
```

### supabase-client.ts - INACTIVE (Unused)

**Files Using It:** **NONE**

**Search Results:**
```bash
# Searched for:
- "from '@/lib/supabase-client'"
- "supabaseClient"
- "supabaseQuery"

# Found:
- Only the definition file itself
- Only backup files
- No active usage
```

**Conclusion:** This file is **legacy code** and can be removed.

---

## Recommendations

### 1. Keep supabasePipeline ✅
This is the primary client and is correctly configured:
- ✅ `autoRefreshToken: false`
- ✅ Custom storage adapter
- ✅ Manual session refresh with timeout control
- ✅ `getCachedSession()` for fast auth checks
- ✅ Used throughout the app

### 2. Remove supabase-client.ts ⚠️
This file appears to be unused:
- No active imports found
- No usage in production code
- Only found in backup files
- Keeping it creates confusion

**Action:**
```bash
# Verify it's unused
grep -r "supabase-client" src/ --include="*.ts" --include="*.tsx" --exclude="*.backup.*"

# If no results, delete it
rm src/lib/supabase-client.ts
```

### 3. Verify No Other Clients
Search completed - no other `createClient` calls found.

---

## Testing Verification

### What to Look For in Logs:

**Should See (Once per app launch):**
```
[storage-adapter] 🔧 Custom synchronous storage adapter initialized for supabasePipeline.ts
🔄 Supabase client created ONCE (persistSession=true, autoRefreshToken=false)
```

**Should NOT See:**
```
❌ [storage-adapter] initialized for supabase-client.ts
❌ autoRefreshToken=true
❌ Multiple "Supabase client created" messages
❌ refreshSession TIMEOUT
```

### Key Metrics:
- ✅ Only 1 client initialization per app launch
- ✅ `autoRefreshToken: false` in logs
- ✅ Storage operations < 1ms
- ✅ No refresh timeouts

---

## Summary

| Item | Status | Action |
|------|--------|--------|
| supabasePipeline.ts | ✅ Active & Correct | Keep |
| supabase-client.ts | ⚠️ Unused | Remove |
| autoRefreshToken | ✅ Disabled in both | None |
| Custom storage | ✅ Both have it | None |
| Other clients | ✅ None found | None |

**Final Verdict:** 
- ✅ All active clients correctly configured
- ✅ No rogue clients with `autoRefreshToken: true`
- ⚠️ One unused legacy file to clean up

---

## Files to Modify

### To Remove (Optional Cleanup):
```
src/lib/supabase-client.ts  ← Unused legacy file
```

### Already Fixed:
```
✅ src/lib/supabasePipeline.ts - autoRefreshToken: false
✅ src/store/chatstore_refactored/fetchActions.ts - Using getCachedSession()
```

---

**Audit Date:** 2024-11-23
**Status:** ✅ Complete
**Confidence:** High (comprehensive search completed)
