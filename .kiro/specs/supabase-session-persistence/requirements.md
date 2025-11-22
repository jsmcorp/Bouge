# Requirements Document

## Introduction

This specification addresses a critical authentication issue where Supabase session tokens are not being persisted to localStorage after successful OTP verification, resulting in `supabaseKeyCount: 0` in diagnostics. The system has an in-memory session (with valid user ID, access token, and refresh token) but no persisted storage keys, causing authentication timeouts and session refresh failures.

## Glossary

- **Supabase Client**: The Supabase JavaScript client instance created via `createClient()` that manages authentication and database operations
- **Session Token**: The authentication session data containing access_token, refresh_token, and user information
- **Storage Adapter**: The custom synchronous storage interface that wraps `window.localStorage` for Supabase client persistence
- **Pipeline**: The `supabasePipeline` singleton that manages the Supabase client lifecycle
- **OTP Flow**: The authentication flow where users verify their phone number with a one-time password
- **Storage Key**: The localStorage key in format `sb-{project-ref}-auth-token` where Supabase persists session data
- **persistSession**: A Supabase client configuration option that controls whether sessions are written to storage

## Requirements

### Requirement 1

**User Story:** As a developer, I want to understand why session tokens are not being persisted to localStorage, so that I can identify the root cause of the authentication issue.

#### Acceptance Criteria

1. WHEN the diagnostic code scans localStorage for keys containing "supabase", THEN the system SHALL accurately count and report all matching keys
2. WHEN the Supabase client is initialized with a storage adapter, THEN the system SHALL log the actual configuration values passed to `createClient()`
3. WHEN `verifyOtp()` is called, THEN the system SHALL log whether the returned session includes persistence metadata
4. WHEN the storage adapter's `setItem()` is called, THEN the system SHALL log the operation with the key name and success/failure status
5. WHEN authentication state changes occur, THEN the system SHALL log which client instance (pipeline vs direct) triggered the change

### Requirement 2

**User Story:** As a user completing OTP verification, I want my session to be persisted to localStorage, so that I remain authenticated across app restarts.

#### Acceptance Criteria

1. WHEN `verifyOtp()` successfully returns a session, THEN the Supabase client SHALL write the session to localStorage via the storage adapter
2. WHEN the storage adapter's `setItem()` is called with the session key, THEN localStorage SHALL contain a key matching the pattern `sb-*-auth-token`
3. WHEN diagnostics run after successful OTP verification, THEN `supabaseKeyCount` SHALL be greater than zero
4. WHEN the app restarts after successful authentication, THEN the Supabase client SHALL restore the session from localStorage
5. WHEN session persistence fails, THEN the system SHALL log the specific error and attempt recovery
6. WHEN `client.auth.verifyOtp()` returns a non-null session, THEN the system SHALL either rely on Supabase's internal persistence OR invoke `auth.setSession(session)` without disabling persistence, resulting in a `sb-*-auth-token` key in storage
7. WHEN the SIGNED_IN auth event fires, THEN diagnostics SHALL immediately verify that at least one Supabase auth key exists in localStorage

### Requirement 3

**User Story:** As a developer, I want to ensure the `persistSession` configuration is correctly set, so that Supabase actually writes sessions to storage.

#### Acceptance Criteria

1. WHEN the Supabase client is created in `supabasePipeline.ts`, THEN `persistSession` SHALL be set to `true` in the auth configuration
2. WHEN `verifyOtp()` is called, THEN the method SHALL NOT pass `{ persistSession: false }` to any Supabase auth methods
3. WHEN the internal auth listener receives an auth state change, THEN the system SHALL allow Supabase's persistence mechanism to complete before caching tokens
4. WHEN multiple Supabase clients exist, THEN all clients SHALL use the same storage adapter instance
5. WHEN the client configuration is logged, THEN the actual `persistSession` value SHALL be visible in diagnostics
6. WHEN any auth-related flow executes (OTP verification, magic links, session recovery), THEN the system SHALL use only the `supabasePipeline` client instance
7. WHEN the storage adapter is passed to `createClient()`, THEN the same adapter object SHALL be used for all diagnostic storage scans

### Requirement 4

**User Story:** As a developer, I want to verify that the storage adapter is being called correctly, so that I can confirm the persistence mechanism is functioning.

#### Acceptance Criteria

1. WHEN the Supabase client attempts to persist a session, THEN the storage adapter's `setItem()` SHALL be invoked with the correct key format
2. WHEN `setItem()` is called, THEN the operation SHALL complete in less than 100ms
3. WHEN `setItem()` succeeds, THEN a subsequent `getItem()` call SHALL return the same data
4. WHEN the storage adapter logs operations, THEN each log SHALL include the operation name, key, duration, and result
5. WHEN storage operations fail, THEN the error SHALL be logged with full details including the exception type and message

### Requirement 5

**User Story:** As a developer, I want to ensure the auth state change listener doesn't interfere with session persistence, so that Supabase can write to storage before we cache tokens.

#### Acceptance Criteria

1. WHEN an auth state change event fires, THEN the internal auth listener SHALL wait for Supabase's persistence to complete before caching tokens
2. WHEN `onAuthStateChange` receives a SIGNED_IN event, THEN the system SHALL verify the session exists in localStorage before proceeding
3. WHEN token caching occurs, THEN it SHALL happen after storage persistence, not before
4. WHEN the auth listener updates `sessionState`, THEN it SHALL not prevent Supabase from writing to storage
5. WHEN multiple auth listeners are registered, THEN they SHALL not create race conditions that prevent persistence

### Requirement 6

**User Story:** As a developer, I want comprehensive diagnostics to track the session persistence flow, so that I can quickly identify where persistence fails.

#### Acceptance Criteria

1. WHEN `verifyOtp()` is called, THEN the system SHALL log the entry point with timestamp and phone number (masked)
2. WHEN the Supabase auth method returns, THEN the system SHALL log whether a session was returned and if it contains tokens
3. WHEN the auth state change listener fires, THEN the system SHALL log the event type and whether storage contains the session key
4. WHEN storage operations occur, THEN each operation SHALL be logged with timing information
5. WHEN diagnostics are captured, THEN the system SHALL include a timeline showing the order of operations from OTP verification through storage persistence
6. WHEN the SIGNED_IN event occurs, THEN diagnostics SHALL run immediately to check if `supabaseKeyCount > 0`
7. WHEN any `setSession()` call completes, THEN diagnostics SHALL verify the session was written to storage before proceeding

### Requirement 7

**User Story:** As a developer, I want to fix any code that might be preventing session persistence, so that authentication works reliably.

#### Acceptance Criteria

1. WHEN `verifyOtp()` calls `client.auth.verifyOtp()`, THEN it SHALL NOT pass any options that disable persistence
2. WHEN the client is initialized, THEN `autoRefreshToken` SHALL be set to `false` to prevent conflicts with manual refresh logic
3. WHEN the internal auth listener caches tokens, THEN it SHALL not intercept or block Supabase's storage write operations
4. WHEN session refresh occurs, THEN it SHALL use the persisted tokens from localStorage, not only in-memory tokens
5. WHEN the pipeline's `updateSessionCache()` method is called, THEN it SHALL verify the session was persisted to storage before updating the cache
