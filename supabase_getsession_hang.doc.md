### Supabase `getSession()` Hanging Issue - Documented Fixes & Workarounds

Problem Summary
- `supabase.auth.getSession()` hangs indefinitely, especially:
  - After app lifecycle events (resume/pause/lock/unlock)
  - On mobile apps (iOS/Android) with Capacitor/Ionic
  - After tab suspension or backgrounding (PWAs, mobile browsers)
  - With certain versions of `@supabase/supabase-js` and `@supabase/gotrue-js`

Observed In Our App
- New logs show `🏥 Health check: starting (navigator.onLine=true)` with no follow-up result, proving `client.auth.getSession()` is hanging post-resume and blocking the send path.

Confirmed Working Solutions

1) Promise.race Timeout Wrapper (Most Reliable)
```typescript
// Example for health check
const sessionPromise = client.auth.getSession();
const timeoutPromise = new Promise<never>((_, reject) => {
  setTimeout(() => reject(new Error('getSession timeout')), 3000);
});
const { data } = await Promise.race([sessionPromise, timeoutPromise]);
```

2) Client Recreation Wrapper (Nuclear Option)
```typescript
const isClientCorrupted = async () => {
  try {
    const timeoutPromise = new Promise((_, reject) => 
      setTimeout(() => reject(new Error('timeout')), 5000)
    );
    await Promise.race([supabase.auth.getSession(), timeoutPromise]);
    return false;
  } catch (error: any) {
    return error?.message === 'timeout';
  }
};

if (await isClientCorrupted()) {
  supabaseClient = createClient(url, key, options);
  // Rehydrate session and re-subscribe
}
```

3) Version Downgrade (Temporary Fix)
```json
{
  "@supabase/supabase-js": "2.29.0",
  "@supabase/gotrue-js": "2.45.0"
}
// or
{
  "@supabase/supabase-js": "2.30.0"
}
```

4) onAuthStateChange Timeout Fix
```typescript
setTimeout(() => {
  supabase.auth.onAuthStateChange((event, session) => {
    // Handle auth changes
  });
}, 1000);
```

5) Clean Package Reinstall
```bash
rm -rf node_modules package-lock.json
npm install
```

Mobile-Specific Solutions

6) Capacitor/Ionic Session Recovery
```typescript
const recoverSession = async () => {
  try {
    const timeoutPromise = new Promise((_, reject) => 
      setTimeout(() => reject(new Error('session recovery timeout')), 5000)
    );
    const { data } = await Promise.race([supabase.auth.getSession(), timeoutPromise]);
    return data?.session;
  } catch (error) {
    return (await supabase.auth.refreshSession())?.data?.session;
  }
};
```

7) Alternative: Use getUser() Instead
```typescript
const checkAuth = async () => {
  try {
    const { data: { user }, error } = await supabase.auth.getUser();
    return !!user && !error;
  } catch {
    return false;
  }
};
```

Prevention Strategies

8) Avoid Multiple Auth State Listeners
```typescript
// Prefer a single centralized listener and broadcast to app state
```

9) Graceful Session Handling
```typescript
const getSessionSafely = async (retries = 3) => {
  for (let i = 0; i < retries; i++) {
    try {
      const timeoutPromise = new Promise((_, reject) => 
        setTimeout(() => reject(new Error('timeout')), 3000)
      );
      const { data } = await Promise.race([supabase.auth.getSession(), timeoutPromise]);
      return data?.session;
    } catch (error) {
      if (i === retries - 1) throw error;
      await new Promise(r => setTimeout(r, 1000 * (i + 1)));
    }
  }
};
```

Root Cause Analysis Summary
- Internal Supabase client/gotrue state can hang after lifecycle events, freezing `getSession()`.
- This blocks any upstream code awaiting it (like our `checkHealth()`), stalling sends.

Recommended Implementation for Our App
- Wrap `getSession()` and `refreshSession()` with `Promise.race` timeouts (3s/5s).
- Fail-open for health checks on timeout; run background refresh.
- Keep direct send path non-blocking; only fallback to outbox on explicit failures.
- Optionally recreate client after repeated timeouts.


