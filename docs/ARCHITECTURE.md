# Bouge Architecture Documentation

## Overview

Bouge is a real-time messaging application built with:
- **Frontend**: Vite + React + TypeScript + Tailwind CSS
- **Mobile**: Capacitor (Android wrapper)
- **Backend**: Supabase (Auth, PostgreSQL, Realtime WebSockets, Edge Functions)
- **Local Storage**: SQLite (offline-first architecture)
- **Push Notifications**: Firebase Cloud Messaging (FCM)

## Core Architecture Principles

### 1. Offline-First Design
All data is cached locally in SQLite. The app works offline and syncs when connectivity returns.

### 2. Multi-Layer Message Delivery
```
Layer 1: Realtime WebSocket (instant, <100ms)
    ↓ (if connection dead)
Layer 2: FCM Push Notification (fast, <1s)
    ↓ (if fetch fails)
Layer 3: Outbox Queue (reliable, eventual delivery)
    ↓ (if offline)
Layer 4: SQLite Cache (offline-first, always available)
```

### 3. Session Management Strategy
- Custom localStorage adapter (avoids Capacitor Preferences async hangs)
- Cached session with TTL (15 seconds)
- Single-flight refresh pattern (prevents duplicate calls)
- Circuit breaker for repeated failures

## Key Components

### `/src/lib/supabasePipeline.ts`
Central orchestrator for all Supabase operations:
- Authentication (OTP, session refresh, token management)
- Database queries (groups, messages, members, reactions)
- Realtime channel management
- Outbox processing for offline messages
- Health checks and circuit breaker logic

### `/src/store/chatstore_refactored/`
Zustand store split into focused action modules:
- `stateActions.ts` - Core state management, app lifecycle
- `realtimeActions.ts` - WebSocket subscriptions, heartbeat, recovery
- `messageActions.ts` - Send/receive messages, optimistic updates
- `fetchActions.ts` - Data fetching from Supabase
- `groupActions.ts` - Group CRUD, member management
- `offlineActions.ts` - SQLite sync, offline queue

### `/src/lib/sqliteService.ts`
SQLite wrapper for local persistence:
- Messages, groups, members cached locally
- Outbox queue for offline messages
- Unread tracking per group

### `/src/lib/push.ts`
FCM push notification handling:
- Token registration and storage
- Notification received handler
- Background message sync trigger

### `/src/lib/reconnectionManager.ts`
Handles app resume and network reconnection:
- WebView readiness checks
- SQLite encryption validation
- Network stability verification
- Realtime subscription recovery

## Data Flow

### Sending a Message
```
1. User sends message
2. Optimistic UI update (instant)
3. Check realtime connection health
4. If healthy: Direct Supabase upsert
5. If unhealthy: Queue to SQLite outbox
6. On success: Trigger FCM push-fanout
7. Outbox processor retries failed messages
```

### Receiving a Message
```
1. Realtime WebSocket delivers INSERT event
2. Message attached to React state (instant UI)
3. Message persisted to SQLite
4. Unread count updated
5. If realtime dead: FCM notification triggers sync
```

### Session Recovery Flow
```
1. Check cached session (TTL 15s)
2. If valid: Use cached, skip network
3. If expired: Try setSession() with cached tokens
4. If fails: Try refreshSession()
5. If all fail: Circuit breaker opens
6. On success: Update cache, apply to realtime
```

## Realtime Connection Lifecycle

### Heartbeat Mechanism
- Send heartbeat every 30 seconds
- Check for death every 10 seconds
- Detect death if no events for 60 seconds
- Auto-recovery: remove channel → refresh session → recreate subscription

### Zombie Connection Detection
A "zombie" connection appears connected but stops receiving messages.
Detection: No messages for 5 minutes but heartbeat OK.
Recovery: Force unsubscribe and resubscribe.

## Offline Queue (Outbox)

### Message Lifecycle
```
1. Message fails direct send
2. Stored in SQLite outbox with retry_count=0
3. Outbox processor triggered
4. Retry with exponential backoff (1-3s jitter)
5. Max 5 retries, then removed
6. On success: Remove from outbox, trigger FCM fanout
```

### Pseudonym Handling (Ghost Mode)
Ghost messages require pseudonym upsert before send.
Outbox processor handles this with 2 attempts, 3s timeout each.

## Configuration

### Environment Variables
```
VITE_SUPABASE_URL=https://xxx.supabase.co
VITE_SUPABASE_ANON_KEY=eyJhbGc...
VITE_SIMPLIFIED_REALTIME=true  # Feature flag for v2 realtime
```

### Timeout Configuration
```typescript
SESSION_CACHE_TTL: 15000      // 15 seconds
SESSION_FETCH_TIMEOUT: 5000   // 5 seconds
REFRESH_SESSION_TIMEOUT: 5000 // 5 seconds
HEALTH_CHECK_TIMEOUT: 5000    // 5 seconds
GLOBAL_FETCH_TIMEOUT: 30000   // 30 seconds
```

### Circuit Breaker
```typescript
maxFailures: 1                // Open on first failure
circuitBreakerResetMs: 30000  // Reset after 30 seconds
maxConsecutiveRefreshFailures: 3
```
