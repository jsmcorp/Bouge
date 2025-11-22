# Implementation Plan

## Phase 1: Discovery - Prove Whether setItem() is Called

- [x] 1. Enhance storage adapter with prominent auth-token logging


  - Add call stack capture to see WHO calls setItem
  - Add prominent `🔑🔑🔑 AUTH TOKEN WRITE` logging for auth-token keys
  - Log value length and caller information
  - Keep existing logging for non-auth-token keys
  - _Requirements: 1.4, 4.4, 4.5, 6.4_

- [x] 2. Add runtime configuration verification after createClient


  - Access `(this.client.auth as any)._supabaseAuthClientOptions` to get runtime config
  - Log actual `persistSession` value at runtime
  - Log whether storage adapter is present
  - Log whether storage adapter matches the one we passed
  - Add critical warnings if config doesn't match expectations
  - _Requirements: 1.2, 3.1, 3.5_

- [x] 3. Enhance verifyOtp with discovery diagnostics


  - Add trace ID generation for tracking
  - Add client instance verification logging
  - Add pre-verification diagnostics capture
  - Add session structure validation after verifyOtp returns
  - Add 200ms wait with prominent "WATCH FOR" message about 🔑🔑🔑 log
  - Add post-verification diagnostics to check supabaseKeyCount
  - Add manual setSession test if supabaseKeyCount is 0
  - Add post-manual diagnostics to verify if manual persistence works
  - Log conclusions about what the diagnostics prove
  - _Requirements: 2.1, 2.3, 2.5, 2.6, 6.1, 6.2, 6.5_

- [x] 4. Enhance internal auth listener with discovery logging


  - Add trace ID generation for auth events
  - Add prominent "WATCH FOR" message on SIGNED_IN events
  - Add delayed check (100ms) to verify persistence (non-blocking)
  - Keep immediate token caching (don't block on persistence)
  - Wrap all listener code in try-catch for error handling
  - _Requirements: 5.2, 6.3, 6.6_

- [x] 5. Enhance storage diagnostics to include auth-token count


  - Add authTokenCount field to diagnostics.storage
  - Add hasAuthToken boolean field
  - Log auth-token keys separately if found
  - Keep existing supabaseKeyCount and storageKeys
  - _Requirements: 1.1, 4.4, 6.4_

- [x] 6. Test Phase 1 discovery implementation


  - Build and deploy the code
  - Run OTP verification flow
  - Check logs for `🔑🔑🔑 AUTH TOKEN WRITE`
  - Check runtime config verification logs
  - Document findings: Does setItem get called or not?
  - _Requirements: All_

## Phase 2A: If setItem IS Called (Timing Issue)

- [ ] 7. Implement timing-based fixes (only if Phase 1 shows setItem is called)
  - Add appropriate delays in verifyOtp to wait for persistence
  - Add post-delay verification of supabaseKeyCount
  - Keep manual setSession as fallback if delays don't work
  - _Requirements: 2.1, 2.6, 3.3, 5.1, 5.3_

## Phase 2B: If setItem is NEVER Called (Config/Client Issue)

- [ ] 8. Fix runtime configuration (only if Phase 1 shows persistSession is false)
  - Investigate why persistSession: true in source doesn't reach runtime
  - Fix configuration application
  - Re-test to verify setItem is now called
  - _Requirements: 3.1, 3.2_

- [ ] 9. Implement manual persistence workaround (only if automatic persistence fails)
  - Always call client.auth.setSession() after successful verifyOtp
  - Verify this triggers storage.setItem()
  - Add error handling if manual persistence also fails
  - _Requirements: 2.1, 2.5, 2.6_

- [ ] 10. Audit client usage (only if Phase 1 suggests wrong client)
  - Check VerifyPage.tsx uses supabasePipeline.verifyOtp
  - Check LoginPage.tsx for direct client usage
  - Ensure all auth operations use pipeline client
  - _Requirements: 3.6_
