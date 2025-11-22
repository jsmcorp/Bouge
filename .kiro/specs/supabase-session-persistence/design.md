# Design Document

## Overview

This design addresses the critical issue where Supabase session tokens exist in memory but are not persisted to localStorage, resulting in `supabaseKeyCount: 0`. 

**Current Status: Root cause is UNKNOWN**

The logs show that the storage adapter works correctly (operations complete in <0.10ms), but critically, there are **NO logs showing `storage.setItem()` being called with an auth-token key** after OTP verification. This means one of the following is true:

1. **Config Issue**: `persistSession: true` is not actually applied at runtime
2. **Client Mismatch**: The OTP flow uses a different client than the pipeline's client
3. **Supabase Bug**: The Supabase JS client has a bug preventing persistence
4. **Storage Disconnection**: The storage adapter is not properly connected to the client

**This design focuses on DISCOVERY, not recovery.** The goal is to definitively identify why `storage.setItem()` is never called, then implement the appropriate fix based on findings.

The solution involves:
1. Adding enhanced storage adapter logging to prove whether `setItem()` is ever called
2. Adding runtime configuration verification to check actual `persistSession` value
3. Adding client instance tracking to verify the correct client is used
4. Adding session structure validation after OTP verification
5. Implementing conditional fixes based on diagnostic findings

## Architecture

### Current Flow (Observed)

```
1. User enters OTP code
   ↓
2. VerifyPage calls supabasePipeline.verifyOtp(phone, code)
   ↓
3. Pipeline calls client.auth.verifyOtp({ phone, token, type: 'sms' })
   ↓
4. Supabase returns { data: { session, user }, error: null }
   ↓
5. ❌ NO storage.setItem() call logged (persistence never triggered)
   ↓
6. Internal auth listener fires (SIGNED_IN event)
   ↓
7. Listener caches tokens to sessionState (in-memory only)
   ↓
8. ❌ Diagnostics show: supabaseKeyCount: 0
   ↓
9. ❌ NO [storage-adapter] setItem("sb-...-auth-token") log EVER appears
```

**Key Observation**: If this were a timing issue, we would see the `setItem()` log eventually (even seconds later). We don't. This means `setItem()` is never called.

### Discovery Flow (Phase 1)

```
1. Enhance storage adapter with prominent auth-token logging
   ↓
2. Add runtime config verification (check actual persistSession value)
   ↓
3. Add client instance tracking (verify correct client used)
   ↓
4. Add session structure validation after verifyOtp
   ↓
5. Run OTP flow and check logs
   ↓
6. IF we see 🔑 AUTH TOKEN WRITE log:
   → Root cause is timing (proceed to Phase 2A)
   ↓
7. IF we NEVER see 🔑 AUTH TOKEN WRITE log:
   → Root cause is config/client/bug (proceed to Phase 2B)
```

### Target Flow (Phase 2A - If Timing Issue)

```
1. User enters OTP code
   ↓
2. verifyOtp() calls client.auth.verifyOtp()
   ↓
3. Supabase returns session
   ↓
4. ✅ storage.setItem("sb-...-auth-token") called (logged)
   ↓
5. Add 100ms delay to allow persistence to complete
   ↓
6. Verify supabaseKeyCount > 0
   ↓
7. Auth listener fires and caches tokens
```

### Target Flow (Phase 2B - If Config/Client Issue)

```
1. User enters OTP code
   ↓
2. verifyOtp() calls client.auth.verifyOtp()
   ↓
3. Supabase returns session
   ↓
4. ❌ storage.setItem() NOT called (persistence disabled)
   ↓
5. Manually call client.auth.setSession() to force persistence
   ↓
6. ✅ storage.setItem("sb-...-auth-token") called (logged)
   ↓
7. Verify supabaseKeyCount > 0
   ↓
8. Auth listener fires and caches tokens
```

## Components and Interfaces

### 1. Enhanced Storage Adapter (Phase 1 - Discovery)

**CRITICAL**: This is the first thing to implement. It will definitively answer whether `setItem()` is ever called.

```typescript
// In the storage adapter initialization
const customStorageAdapter = {
  getItem: (key: string) => {
    const start = performance.now();
    try {
      const value = window.localStorage.getItem(key);
      const duration = performance.now() - start;
      pipelineLog(`[storage-adapter] ✅ getItem("${key}") (${duration.toFixed(2)}ms)`);
      return value;
    } catch (error) {
      const duration = performance.now() - start;
      pipelineLog(`[storage-adapter] ❌ getItem("${key}") failed after ${duration.toFixed(2)}ms: ${stringifyError(error)}`);
      return null;
    }
  },
  setItem: (key: string, value: string) => {
    const start = performance.now();
    
    // Capture call stack to see WHO is calling setItem
    const stack = new Error().stack?.split('\n').slice(2, 5).join(' <- ') || 'unknown';
    
    try {
      window.localStorage.setItem(key, value);
      const duration = performance.now() - start;
      
      // CRITICAL: Prominent logging for auth-token writes
      const isAuthToken = key.includes('auth-token');
      if (isAuthToken) {
        // If you NEVER see this log, persistence is not happening
        pipelineLog(`🔑🔑🔑 AUTH TOKEN WRITE: setItem("${key}") (${duration.toFixed(2)}ms)`);
        pipelineLog(`🔍 Called from: ${stack}`);
        pipelineLog(`🔍 Value length: ${value.length} chars`);
      } else {
        pipelineLog(`[storage-adapter] ✅ setItem("${key}") (${duration.toFixed(2)}ms)`);
      }
    } catch (error) {
      const duration = performance.now() - start;
      pipelineLog(`[storage-adapter] ❌ setItem("${key}") failed after ${duration.toFixed(2)}ms: ${stringifyError(error)}`);
    }
  },
  removeItem: (key: string) => {
    const start = performance.now();
    try {
      window.localStorage.removeItem(key);
      const duration = performance.now() - start;
      pipelineLog(`[storage-adapter] ✅ removeItem("${key}") (${duration.toFixed(2)}ms)`);
    } catch (error) {
      const duration = performance.now() - start;
      pipelineLog(`[storage-adapter] ❌ removeItem("${key}") failed after ${duration.toFixed(2)}ms: ${stringifyError(error)}`);
    }
  },
};
```

### 2. Runtime Configuration Verification (Phase 1 - Discovery)

```typescript
// After createClient, verify the ACTUAL runtime config
this.client = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    storage: customStorageAdapter,
    persistSession: authPersistSession,
    autoRefreshToken: authAutoRefreshToken,
    detectSessionInUrl: false,
  },
  // ... rest of config
});

// CRITICAL: Verify config was actually applied
try {
  const runtimeConfig = (this.client.auth as any)._supabaseAuthClientOptions || {};
  this.log(`🔍 RUNTIME CONFIG VERIFICATION:`);
  this.log(`🔍   persistSession: ${runtimeConfig.persistSession}`);
  this.log(`🔍   storage: ${runtimeConfig.storage ? 'present' : 'MISSING'}`);
  this.log(`🔍   autoRefreshToken: ${runtimeConfig.autoRefreshToken}`);
  
  // Verify storage adapter is the same object
  const storageMatch = runtimeConfig.storage === customStorageAdapter;
  this.log(`🔍   storage adapter match: ${storageMatch}`);
  
  if (!runtimeConfig.persistSession) {
    this.log(`❌ CRITICAL: persistSession is ${runtimeConfig.persistSession} at runtime!`);
  }
  if (!runtimeConfig.storage) {
    this.log(`❌ CRITICAL: storage adapter is missing at runtime!`);
  }
} catch (configError) {
  this.log(`⚠️ Could not verify runtime config:`, stringifyError(configError));
}
```

### 3. Enhanced verifyOtp Method (Phase 1 - Discovery)

```typescript
public async verifyOtp(phone: string, token: string): Promise<AuthOperationResult> {
  const traceId = `verify-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  this.log(`🔐 [${traceId}] Verifying OTP for phone: ${phone.substring(0, 6)}...`);

  try {
    const client = await this.getClient();
    
    // Verify we're using the correct client instance
    this.log(`🔐 [${traceId}] Client instance check:`);
    this.log(`🔐 [${traceId}]   Client exists: ${!!client}`);
    this.log(`🔐 [${traceId}]   Client has auth: ${!!client?.auth}`);
    
    // Capture pre-verification diagnostics
    const preDiagnostics = await this.captureAuthDiagnostics(traceId, 'pre-verify');
    this.log(`🔐 [${traceId}] PRE-VERIFY: supabaseKeyCount=${preDiagnostics.storage.supabaseKeyCount}`);
    
    // Call Supabase verifyOtp (NO options that disable persistence)
    this.log(`🔐 [${traceId}] Calling client.auth.verifyOtp()...`);
    const result = await client.auth.verifyOtp({ 
      phone, 
      token, 
      type: 'sms'
      // ✅ NO persistSession: false
      // ✅ NO options that would disable persistence
    });
    
    this.log(`🔐 [${traceId}] OTP verification result: ${result.error ? 'error' : 'success'}`);
    
    if (result.data?.session) {
      // Validate session structure
      this.log(`🔐 [${traceId}] ✅ Session returned from verifyOtp`);
      this.log(`🔐 [${traceId}] Session structure:`);
      this.log(`🔐 [${traceId}]   has user: ${!!result.data.session.user}`);
      this.log(`🔐 [${traceId}]   has access_token: ${!!result.data.session.access_token}`);
      this.log(`🔐 [${traceId}]   has refresh_token: ${!!result.data.session.refresh_token}`);
      this.log(`🔐 [${traceId}]   expires_at: ${result.data.session.expires_at}`);
      
      // CRITICAL: Check if we saw the 🔑🔑🔑 AUTH TOKEN WRITE log
      this.log(`🔐 [${traceId}] ⏳ Waiting 200ms to see if storage.setItem() is called...`);
      this.log(`🔐 [${traceId}] 👀 WATCH FOR: "🔑🔑🔑 AUTH TOKEN WRITE" in logs`);
      
      await new Promise(resolve => setTimeout(resolve, 200));
      
      // Capture post-verification diagnostics
      const postDiagnostics = await this.captureAuthDiagnostics(traceId, 'post-verify-delayed');
      this.log(`🔐 [${traceId}] POST-VERIFY-DELAYED: supabaseKeyCount=${postDiagnostics.storage.supabaseKeyCount}`);
      
      if (postDiagnostics.storage.supabaseKeyCount === 0) {
        this.log(`🔐 [${traceId}] ❌ CRITICAL: supabaseKeyCount is still 0 after 200ms!`);
        this.log(`🔐 [${traceId}] ❌ Did you see "🔑🔑🔑 AUTH TOKEN WRITE" in logs above?`);
        this.log(`🔐 [${traceId}] ❌ If NO: Supabase is not calling storage.setItem() at all`);
        this.log(`🔐 [${traceId}] ❌ If YES: This is a timing issue (setItem called but too late)`);
        
        // Attempt manual persistence to test if it works
        this.log(`🔐 [${traceId}] 🔧 Testing manual persistence via setSession()...`);
        try {
          await client.auth.setSession({
            access_token: result.data.session.access_token,
            refresh_token: result.data.session.refresh_token
          });
          
          this.log(`🔐 [${traceId}] ⏳ Waiting 100ms after manual setSession()...`);
          await new Promise(resolve => setTimeout(resolve, 100));
          
          const manualDiagnostics = await this.captureAuthDiagnostics(traceId, 'post-manual-setSession');
          this.log(`🔐 [${traceId}] POST-MANUAL: supabaseKeyCount=${manualDiagnostics.storage.supabaseKeyCount}`);
          
          if (manualDiagnostics.storage.supabaseKeyCount > 0) {
            this.log(`🔐 [${traceId}] ✅ Manual setSession() worked! This proves:`);
            this.log(`🔐 [${traceId}] ✅   - Storage adapter is connected correctly`);
            this.log(`🔐 [${traceId}] ✅   - persistSession works when explicitly called`);
            this.log(`🔐 [${traceId}] ❌   - verifyOtp() does NOT trigger automatic persistence`);
          } else {
            this.log(`🔐 [${traceId}] ❌ Manual setSession() also failed!`);
            this.log(`🔐 [${traceId}] ❌ This suggests a deeper issue with storage or config`);
          }
        } catch (manualError) {
          this.log(`🔐 [${traceId}] ❌ Manual setSession() threw error:`, stringifyError(manualError));
        }
      } else {
        this.log(`🔐 [${traceId}] ✅ SUCCESS! supabaseKeyCount=${postDiagnostics.storage.supabaseKeyCount}`);
        this.log(`🔐 [${traceId}] ✅ Automatic persistence is working correctly`);
      }
    }
    
    return result;
  } catch (error) {
    this.log(`🔐 [${traceId}] OTP verification failed:`, error);
    return { error };
  }
}
```

### 4. Enhanced Internal Auth Listener (Phase 1 - Discovery)

```typescript
// Attach internal auth listener to cache tokens
try {
  const sub = this.client.auth.onAuthStateChange((event: AuthChangeEvent, session: any) => {
    const traceId = `auth-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    this.log(`🔑 [${traceId}] Auth state change: ${event}`);
    
    try {
      // For SIGNED_IN events, check if persistence happened
      if (event === 'SIGNED_IN') {
        this.log(`🔑 [${traceId}] SIGNED_IN event fired`);
        this.log(`🔑 [${traceId}] 👀 Check logs above for "🔑🔑🔑 AUTH TOKEN WRITE"`);
        
        // Schedule a delayed check (don't block the listener)
        setTimeout(async () => {
          try {
            const checkDiagnostics = await this.captureAuthDiagnostics(traceId, 'signed-in-delayed-check');
            this.log(`🔑 [${traceId}] SIGNED_IN delayed check: supabaseKeyCount=${checkDiagnostics.storage.supabaseKeyCount}`);
            
            if (checkDiagnostics.storage.supabaseKeyCount === 0) {
              this.log(`🔑 [${traceId}] ⚠️ WARNING: SIGNED_IN event but supabaseKeyCount still 0 after 100ms!`);
            } else {
              this.log(`🔑 [${traceId}] ✅ Session persisted! supabaseKeyCount=${checkDiagnostics.storage.supabaseKeyCount}`);
            }
          } catch (checkError) {
            this.log(`🔑 [${traceId}] ⚠️ Delayed check failed:`, stringifyError(checkError));
          }
        }, 100);
      }
      
      // Cache tokens immediately (don't wait for persistence)
      // This is fine - we're just caching what's in memory
      const s = session || {};
      this.sessionState.userId = s?.user?.id || this.sessionState.userId || null;
      this.sessionState.accessToken = s?.access_token || this.sessionState.accessToken || null;
      this.sessionState.refreshToken = s?.refresh_token || this.sessionState.refreshToken || null;
      this.log(`🔑 [${traceId}] Token cached: user=${this.sessionState.userId?.slice(0, 8)} hasAccess=${!!this.sessionState.accessToken} hasRefresh=${!!this.sessionState.refreshToken}`);
    } catch (listenerError) {
      this.log(`🔑 [${traceId}] ⚠️ Auth listener error:`, stringifyError(listenerError));
    }
  });
  this.internalAuthUnsub = () => { try { sub.data.subscription.unsubscribe(); } catch (_) {} };
} catch (e) {
  this.log('⚠️ Failed to attach internal auth listener:', e as any);
}
```

### 5. Enhanced Storage Diagnostics

The existing `captureAuthDiagnostics` method already scans localStorage correctly. We just need to enhance it slightly:

```typescript
// Check storage state
if (typeof window !== 'undefined' && window.localStorage) {
  const storageKeys = Object.keys(window.localStorage);
  const supabaseKeys = storageKeys.filter(k => k.includes('supabase'));
  const authTokenKeys = supabaseKeys.filter(k => k.includes('auth-token'));
  
  this.log(`🔍 [${callId}] localStorage accessible, ${supabaseKeys.length} supabase keys`);
  if (authTokenKeys.length > 0) {
    this.log(`🔍 [${callId}] Found ${authTokenKeys.length} auth-token keys: ${authTokenKeys.join(', ')}`);
  }
  
  diagnostics.storage = {
    accessible: true,
    supabaseKeyCount: supabaseKeys.length,
    authTokenCount: authTokenKeys.length,
    storageKeys: supabaseKeys, // Include actual keys for debugging
    hasAuthToken: authTokenKeys.length > 0,
  };
}
```

This is NOT hardcoded - it dynamically counts keys. The issue is that no keys are being written.

## Data Models

### DiagnosticsResult

```typescript
interface DiagnosticsResult {
  callId: string;
  phase: string;
  timestamp: string;
  timeSinceStart: number;
  network: {
    connected: boolean;
    connectionType: string;
  };
  client: {
    exists: boolean;
    isInitialized: boolean;
    hasAuth: boolean;
  };
  session: {
    hasUserId: boolean;
    hasAccessToken: boolean;
    hasRefreshToken: boolean;
    hasCachedSession: boolean;
    cachedSessionAge: number | null;
  };
  storage: {
    accessible: boolean;
    supabaseKeyCount: number;
    storageKeys: string[];
    hasAuthToken: boolean;
  };
}
```

## Correctness Properties

*A property is a characteristic or behavior that should hold true across all valid executions of a system-essentially, a formal statement about what the system should do. Properties serve as the bridge between human-readable specifications and machine-verifiable correctness guarantees.*

### Property 1: Session persistence after successful OTP verification
*For any* successful OTP verification that returns a session, the Supabase client should write the session to localStorage, resulting in at least one key matching the pattern `sb-*-auth-token`.
**Validates: Requirements 2.1, 2.6**

### Property 2: Storage adapter round-trip consistency
*For any* data written via `setItem(key, value)`, a subsequent `getItem(key)` should return the same value.
**Validates: Requirements 4.3**

### Property 3: Storage operations complete quickly
*For any* storage operation (`getItem`, `setItem`, `removeItem`), the operation should complete in less than 100ms.
**Validates: Requirements 4.2**

### Property 4: Persistence before caching
*For any* auth state change event, Supabase's persistence mechanism should complete before the internal auth listener caches tokens to sessionState.
**Validates: Requirements 3.3, 5.1, 5.3**

### Property 5: SIGNED_IN event implies persisted session
*For any* SIGNED_IN auth event, diagnostics should show `supabaseKeyCount > 0` after the event completes.
**Validates: Requirements 2.7, 5.2, 6.6**

### Property 6: No persistence-disabling options
*For any* call to `verifyOtp()` or `setSession()`, the options parameter should not include `persistSession: false`.
**Validates: Requirements 3.2, 7.1**

### Property 7: Single client instance for auth operations
*For any* auth-related operation (OTP verification, session refresh, sign out), the operation should use the `supabasePipeline` client instance, not a direct client.
**Validates: Requirements 3.6**

### Property 8: Storage adapter logging completeness
*For any* storage operation, the logs should include the operation name, key, duration, and result status.
**Validates: Requirements 4.4, 4.5, 6.4**

### Property 9: Session restoration after app restart
*For any* persisted session in localStorage, restarting the app should restore the session without requiring re-authentication.
**Validates: Requirements 2.4**

### Property 10: Auth listener non-interference
*For any* auth state change, the internal auth listener should not prevent or block Supabase's storage write operations.
**Validates: Requirements 5.4, 7.3**

## Error Handling

### 1. Persistence Failure Detection

When `verifyOtp()` returns a session but `supabaseKeyCount` remains 0:
- Log detailed warning with trace ID
- Attempt manual persistence via `setSession()`
- Re-check storage after recovery attempt
- Log success or failure of recovery

### 2. Storage Adapter Errors

When storage operations fail:
- Log full error details (type, message, stack)
- Include operation timing information
- Continue execution (don't block auth flow)
- Report error to monitoring system

### 3. Auth Listener Errors

When the internal auth listener encounters errors:
- Wrap all listener code in try-catch
- Log errors with trace ID
- Don't throw (prevent listener from breaking)
- Continue with partial state updates if possible

## Testing Strategy

### Unit Tests

1. **Storage Adapter Tests**
   - Test `setItem()` writes to localStorage
   - Test `getItem()` reads from localStorage
   - Test `removeItem()` deletes from localStorage
   - Test operations complete in <100ms
   - Test error handling for storage failures

2. **Diagnostic Tests**
   - Test `captureAuthDiagnostics()` counts keys correctly
   - Test diagnostics include all required fields
   - Test diagnostics handle missing localStorage gracefully

3. **verifyOtp Tests**
   - Test successful OTP verification persists session
   - Test recovery mechanism when persistence fails
   - Test logging includes all required information

### Property-Based Tests

The testing framework will use **fast-check** for TypeScript property-based testing.

Each property-based test should run a minimum of 100 iterations to ensure comprehensive coverage.

1. **Property Test: Session Persistence**
   - Generate random valid sessions
   - Call `verifyOtp()` with each session
   - Verify `supabaseKeyCount > 0` after each call
   - **Feature: supabase-session-persistence, Property 1: Session persistence after successful OTP verification**

2. **Property Test: Storage Round-Trip**
   - Generate random key-value pairs
   - Call `setItem(key, value)`
   - Verify `getItem(key) === value`
   - **Feature: supabase-session-persistence, Property 2: Storage adapter round-trip consistency**

3. **Property Test: Storage Performance**
   - Generate random storage operations
   - Measure operation duration
   - Verify duration < 100ms
   - **Feature: supabase-session-persistence, Property 3: Storage operations complete quickly**

4. **Property Test: No Persistence-Disabling Options**
   - Generate random auth method calls
   - Verify options never include `persistSession: false`
   - **Feature: supabase-session-persistence, Property 6: No persistence-disabling options**

5. **Property Test: Storage Logging**
   - Generate random storage operations
   - Verify logs include operation name, key, duration, result
   - **Feature: supabase-session-persistence, Property 8: Storage adapter logging completeness**

### Integration Tests

1. **End-to-End OTP Flow**
   - Start with clean localStorage
   - Complete full OTP verification
   - Verify session persisted to localStorage
   - Verify app can restart and restore session

2. **Multiple Client Instances**
   - Create multiple Supabase clients
   - Verify all use same storage adapter
   - Verify no conflicts in persistence

3. **Auth Listener Timing**
   - Trigger SIGNED_IN event
   - Verify persistence completes before caching
   - Verify diagnostics show correct timing

## Implementation Notes

### Key Insights from Analysis

1. **supabaseKeyCount is NOT hardcoded** - It's dynamically computed from `Object.keys(window.localStorage).filter(k => k.includes('supabase')).length`

2. **Storage adapter works correctly** - Operations complete in <0.10ms, no errors

3. **persistSession is set to true in source code** - But we need to verify it's true at runtime

4. **NO storage.setItem() logs for auth-token** - This is the smoking gun. If persistence were just "slow", we'd see the log eventually. We don't.

5. **No explicit persistence disabling** - No code passes `persistSession: false` in source

### Root Cause (Unknown - Requires Discovery)

The logs show NO evidence that `storage.setItem()` is ever called with an auth-token key. This means one of:

1. **Config not applied**: `persistSession: true` in source code doesn't reach the runtime client
2. **Wrong client**: OTP flow uses a different client without persistence enabled
3. **Supabase bug**: The JS client has a bug where `verifyOtp()` doesn't trigger persistence
4. **Storage disconnected**: The storage adapter passed to `createClient()` is not the one Supabase uses internally

### Solution Approach (Discovery-First)

**Phase 1: Prove whether setItem is called**
1. Add prominent `🔑🔑🔑 AUTH TOKEN WRITE` logging to storage adapter
2. Add runtime config verification to check actual `persistSession` value
3. Add client instance tracking to verify correct client is used
4. Run OTP flow and check logs

**Phase 2A: If we see 🔑🔑🔑 AUTH TOKEN WRITE (timing issue)**
1. Add delays to allow persistence to complete
2. Add post-persistence verification
3. Keep manual setSession as fallback

**Phase 2B: If we NEVER see 🔑🔑🔑 AUTH TOKEN WRITE (config/client issue)**
1. Fix runtime config if `persistSession` is false
2. Ensure all auth flows use pipeline client
3. Always call manual `setSession()` after `verifyOtp()` to force persistence
4. Consider upgrading Supabase JS client if bug suspected

### Files to Modify

1. `src/lib/supabasePipeline.ts`
   - Enhance `verifyOtp()` method (lines 1218-1230)
   - Enhance internal auth listener (lines 828-838)
   - Add post-verification diagnostics
   - Add recovery mechanism

2. `src/lib/supabasePipeline.ts` (diagnostics)
   - Enhance `captureAuthDiagnostics()` to include storage keys list (line 237)

### Configuration Verification

Current configuration is correct:
```typescript
persistSession: true,  // ✅ Correct
autoRefreshToken: false,  // ✅ Correct (manual refresh)
storage: customStorageAdapter,  // ✅ Correct
```

No changes needed to configuration.
