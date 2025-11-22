# All createClient Locations - Complete Audit

## Summary

Found **2 files** that create Supabase clients:

1. ✅ `src/lib/supabase-client.ts` - autoRefreshToken: **false**
2. ✅ `src/lib/supabasePipeline.ts` - autoRefreshToken: **false**

## Detailed Analysis

### 1. src/lib/supabase-client.ts

**Line 58:** `export const supabaseClient = createClient(...)`

**Configuration:**
```typescript
{
  auth: {
    storage: customStorageAdapter,  // ✅ Custom sync adapter
    persistSession: true,
    autoRefreshToken: false,        // ✅ DISABLED
    detectSessionInUrl: false,
  },
  realtime: {
    worker: true,
  },
}
```

**Status:** ✅ Correctly configured

**Exports:**
- `supabaseClient` - The raw client
- `supabaseQuery` - Type-safe wrapper

**Usage:** Unknown (search didn't find imports, might be legacy)

---

### 2. src/lib/supabasePipeline.ts

**Line ~768:** `this.client = createClient(...)`

**Configuration:**
```typescript
{
  auth: {
    storage: customStorageAdapter,  // ✅ Custom sync adapter
    persistSession: true,
    autoRefreshToken: false,        // ✅ DISABLED
    detectSessionInUrl: false,
  },
  realtime: {
    worker: true,
  },
  global: {
    fetch: async (input, init) => {
      // Custom fetch with 30s timeout
    }
  }
}
```

**Status:** ✅ Correctly configured

**Exports:**
- `supabasePipeline` - Singleton instance
- Methods: `getClient()`, `getClientFast()`, `getCachedSession()`, etc.

**Usage:** Primary client used throughout the app

---

## Verification Checklist

### Both Clients Have:
- ✅ Custom storage adapter (synchronous localStorage wrapper)
- ✅ `autoRefreshToken: false`
- ✅ `persistSession: true`
- ✅ `detectSessionInUrl: false`

### Key Differences:
| Feature | supabase-client.ts | supabasePipeline.ts |
|---------|-------------------|---------------------|
| Custom fetch | ❌ No | ✅ Yes (30s timeout) |
| Singleton | ❌ No | ✅ Yes |
| Session management | ❌ No | ✅ Yes (manual refresh) |
| Used by | Unknown | fetchActions, stores |

## Recommendation

### Primary Client: supabasePipeline
This should be the **only** client used in the app because:
- Has proper timeout handling
- Has manual session refresh logic
- Has `getCachedSession()` for fast auth checks
- Has `getClientFast()` for read operations
- Is a singleton (no duplicate clients)

### Legacy Client: supabase-client.ts
This file might be legacy code. Check if it's actually used:

```bash
# Search for imports
grep -r "from '@/lib/supabase-client'" src/
grep -r "supabaseClient" src/
grep -r "supabaseQuery" src/
```

If not used, consider removing it to avoid confusion.

## Testing Verification

When testing, check logs for:

### Should See (Once):
```
[storage-adapter] 🔧 Custom synchronous storage adapter initialized for supabasePipeline.ts
🔄 Supabase client created ONCE (persistSession=true, autoRefreshToken=false)
```

### Should NOT See:
```
❌ [storage-adapter] 🔧 Custom synchronous storage adapter initialized for supabase-client.ts
❌ Multiple "Supabase client created" messages
❌ autoRefreshToken=true
```

If you see multiple client creations, there's a problem.

## Next Steps

1. **Verify supabase-client.ts is unused:**
   ```bash
   grep -r "supabase-client" src/ --include="*.ts" --include="*.tsx"
   ```

2. **If unused, remove it:**
   ```bash
   rm src/lib/supabase-client.ts
   ```

3. **Ensure all code uses supabasePipeline:**
   - Import: `import { supabasePipeline } from '@/lib/supabasePipeline'`
   - Use: `await supabasePipeline.getClientFast()`
   - Auth: `await supabasePipeline.getCachedSession()`

## Summary

✅ Both clients have `autoRefreshToken: false`
✅ Both clients have custom storage adapter
✅ supabasePipeline is the primary client
⚠️ supabase-client.ts might be legacy/unused

**Action:** Verify supabase-client.ts usage and remove if unused.
