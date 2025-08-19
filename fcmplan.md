## FCM/APNs Push + Foreground Resync Plan (WhatsApp-style background delivery)

Status: draft plan committed — feature-flagged rollout. Defaults: enabled. Kill-switch included.

---

### Objectives

- Allow sockets to die in background; wake via FCM/APNs data pushes; on wake/resume perform fast resubscribe and missed-message fetch.
- Keep realtime subscription setup non-blocking on auth. For writes only, require a valid token; queue/defer safely.
- Prevent “disappearing” messages after lock/unlock by guarding writes and draining outbox robustly.

### Hard constraints (must not violate)

1. Do not alter message schema, message sending semantics, or how messages render.
2. Preserve the recent change that skips blocking auth checks during realtime subscription setup.
3. For writes (send/outbox), ensure a valid auth token before hitting Supabase; never silently fail.
4. Keep all existing function names and public signatures intact unless adding clearly named helpers; avoid breaking imports.
5. Preserve current logs; add only new logs with the specified tags below.
6. New behavior is feature-flagged and default enabled, with a global kill-switch.

### New logging tags

- `[push] token:registered <platform> <truncatedToken>`
- `[push] notify:fanout group=<id> recipients=<n>`
- `[push] wake reason=<type>`
- `[sync] start group=<id> since=<cursor>`
- `[sync] merged count=<n>`
- `[auth] writes:ready|blocked reason=<…>`
- `[rt] rebuild channel=<name> status=<…>`
- `[rt] degraded backoff=<ms>`
- `[outbox] drain start count=<n>`
- `[outbox] deferred reason=auth_refresh`

### Feature flag and tunables

- Location: `src/lib/featureFlags.ts` (new)
  - Export shape:
    - `features.push_resync.enabled: boolean` (default true)
    - `features.push_resync.killSwitch: boolean` (default false)
    - `sync.maxBatch: number` (default 200)
    - `realtime.retryBackoff: number[]` (default [1500, 3000, 6000])
    - `auth.refreshTimeoutMs: number` (default 1800)
    - `outbox.retryShortDelayMs: number` (default 700)
- Allow runtime override via remote config (optional, if available) and localStorage fallback (`app:featureOverrides`). Kill-switch short-circuits to current behavior.

---

## Client implementation plan (Capacitor + React + Supabase)

### 1) Push plumbing (FCM/APNs)

- Plugins
  - Use `@capacitor-firebase/messaging` for FCM/APNs tokens and data message handling (Android/iOS).
  - Use `@capacitor/app` for `appStateChange`/resume; `@capacitor/network` for connectivity events.
- Token lifecycle
  - On app start and token refresh: upsert token to Supabase `user_devices` with `{ user_id, platform, token, app_version, last_seen_at=now(), active=true }`.
  - On logout: mark all user device rows inactive.
  - Never log full token; only truncate (first 6 + '…').
- Event bridge
  - Handle data messages (`type="new_message"`, `group_id`, `message_id`, `created_at`): emit `push:wakeup` event with reason `data`.
  - Handle notification taps: route to `group_id` if present and emit `push:wakeup` with reason `tap`.
- Storage
  - No schema change to messages. Device tokens stored in `user_devices` only.

### 2) Foreground reconnection & watchdog (resync state machine)

Events to react to:

- `app:resume` (Capacitor `App`)
- `network:online` (Capacitor `Network`)
- `push:wakeup` (from push listener)

On any of the above:

1) Ensure auth for writes only
   - Helper: `ensureAuthForWrites()` (new; see below) with timeout = `auth.refreshTimeoutMs`.
   - If token valid → set `writes_blocked=false`; log `[auth] writes:ready`.
   - If refresh in-flight or timeout → set `writes_blocked=true`; log `[auth] writes:blocked reason=refresh_timeout` and retry in background.

2) Realtime reset (non-blocking)
   - Force-close existing channel(s) and create a fresh channel for active group(s).
   - Request a fresh realtime JWT non-blockingly; if refreshing, reuse last good token.
   - No loops; create and proceed; log `[rt] rebuild channel=<name> status=<…>`.
   - Watchdog: on `CLOSED`/`CHANNEL_ERROR`, re-create once immediately; then backoff using `realtime.retryBackoff` and after exhaustion set `realtime_degraded=true` and enable fetch-poll fallback (~10s).

3) Missed messages resync
   - Helper: `syncMissed(groupId)` (new) in `sqliteServices_Refactored/syncOperations.ts` or a thin wrapper in `store/chatstore_refactored/fetchActions.ts`.
   - Determine cursor using `last_server_created_at` per group or last local message timestamp/id.
   - Fetch where `created_at > cursor` (bounded by `sync.maxBatch`).
   - Merge idempotently into local cache; update cursor; logs: `[sync] start …`, `[sync] merged count=<n>`.

4) Outbox drain
   - If `writes_blocked=false` and online → drain outbox.
   - If blocked → schedule short retry after `outbox.retryShortDelayMs` and log `[outbox] deferred reason=auth_refresh`.

### 3) Send/outbox safety gate

- `ensureAuthForWrites()`
  - Reads cached session; if missing/stale, `refreshSession` with timeout `auth.refreshTimeoutMs`.
  - No UI blocking; returns `{ canWrite: boolean, reason?: string }` and flips a store flag (`writes_blocked`).
- Guard writes only
  - Wrap Supabase `insert/update/delete` calls involved in sending messages/reactions with the helper.
  - If blocked: queue the write shortly (500–800ms, default `outbox.retryShortDelayMs`) up to a small cap, else push to local outbox with visible “sending…” state.
- Outbox processor improvements
  - Triggers on `app:resume`, `network:online`, `push:wakeup`.
  - Each batch gates on `ensureAuthForWrites()`; if blocked, skip this cycle to avoid burning retries.

### 4) Events wiring

- Add wiring in app bootstrap (e.g., `src/main.tsx` or store init) to register listeners:
  - `App.addListener('appStateChange', ...)` → when `isActive`, treat as `app:resume`.
  - `Network.addListener('networkStatusChange', ...)` → when online.
  - Messaging data/tap events → emit `push:wakeup` and route when appropriate.
- Dispatch to a central `onWake(reason, groupId?)` handler in the chat store that performs the sequence: `ensureAuthForWrites` → `realtime reset` → `syncMissed` → `outbox drain`.

### 5) UI considerations

- Keep render flow unchanged.
- When `realtime_degraded=true`, start a 10s fetch-poll for active group(s) until healed.
- Maintain “sending…” chip on outbox items; after N minutes (configurable), show a retry chip action.

---

## Server implementation plan (Supabase)

### 1) Table: `user_devices`

Migration (new file under `supabase/migrations/*_user_devices.sql`):

```sql
create table if not exists public.user_devices (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  platform text not null check (platform in ('android','ios')),
  token text not null,
  last_seen_at timestamptz not null default now(),
  app_version text,
  active boolean not null default true,
  unique (token)
);

create index if not exists idx_user_devices_user_active on public.user_devices (user_id, active);
create index if not exists idx_user_devices_token on public.user_devices (token);

alter table public.user_devices enable row level security;

-- RLS policies
create policy "device_owner_rw" on public.user_devices
  for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- service role can read all (no extra policy needed; use service key from Edge Function)
```

Notes:

- Only the owning user can manage their device rows.
- Service role (Edge Function) will use `service_key` to read all rows when fanning out.

### 2) Edge Function: push fan-out on message insert

- Directory: `supabase/functions/push-fanout/index.ts` (Deno)
- Triggering: PostgreSQL trigger on `public.messages` inserts calls `http_request()` to the Edge Function OR a simple trigger that inserts into a `notification_queue` table and the function runs on a cron to drain it (safer for retries). For first pass, use direct HTTP trigger for simplicity; optionally evolve to queue for reliability.
- Function behavior:
  - Read row (`message_id`, `group_id`, `sender_id`, `created_at`) from payload.
  - Compute recipients: `group_members` of the group where `member_id != sender_id` and not blocked.
  - Fetch device tokens from `public.user_devices where user_id in (…) and active=true`.
  - Coalesce bursts within ~2–3s per user/group (in-memory debounce map or queue record merging) to avoid floods.
  - Send high-priority FCM data messages via FCM HTTP v1 or legacy API.
    - Payload: `{ type: 'new_message', group_id, message_id, created_at, preview?: <small non-sensitive> }`.
  - Handle invalid/expired tokens: if FCM returns `NotRegistered`/`InvalidRegistration`, mark `active=false`.
  - Log `[push] notify:fanout group=<id> recipients=<n>`.
- Secrets/config:
  - `FCM_SERVICE_ACCOUNT` or `FCM_SERVER_KEY` in Supabase project secrets.
  - Optional `APNS_*` only if we directly target APNs; with FCM → APNs this is handled by FCM setup.

### 3) iOS specifics

- Use `content-available: 1` for silent pushes; if throttled, send a visible fallback notification with a `group_id` route.

---

## File-by-file plan (client)

- `src/lib/featureFlags.ts` (new)
  - Export defaults and helpers to read overrides and a kill-switch.

- `src/lib/push.ts` (new)
  - Bridge for token registration and data/tap event handling.
  - Expose `initPush()` and `getCurrentToken()`; handle token refresh events.
  - Upsert to `public.user_devices` via Supabase client (user context).

- `src/store/chatstore_refactored/index.ts`
  - Wire a central `onWake(reason, groupId?)` and hold `writes_blocked` and `realtime_degraded` flags.
  - Initialize listeners in store bootstrap.

- `src/store/chatstore_refactored/realtimeActions.ts`
  - Add `rebuildRealtimeChannels()` that force-closes and re-subscribes without blocking on auth.
  - Add watchdog handling and backoff per `realtime.retryBackoff`.

- `src/store/chatstore_refactored/fetchActions.ts`
  - Add `syncMissed(groupId)` wrapper that calls into sqlite service and updates cursors.

- `src/lib/sqliteServices_Refactored/syncOperations.ts`
  - Implement cursor determination and bounded fetch (`sync.maxBatch`), idempotent merge, and cursor update utilities.

- `src/store/chatstore_refactored/utils.ts` (or `src/lib/utils.ts` if already present)
  - Add `ensureAuthForWrites()` with timeout behavior and background retry hook.

- `src/store/chatstore_refactored/messageActions.ts`
  - Guard actual Supabase writes with `ensureAuthForWrites()`; short defer then outbox if still blocked.

- `src/store/chatstore_refactored/offlineActions.ts` and/or `src/lib/sqliteServices_Refactored/outboxOperations.ts`
  - Update outbox drain to run on `app:resume`, `network:online`, `push:wakeup` and skip cycle when blocked.

- `src/main.tsx`
  - Initialize feature flags; call `initPush()`; register `App`/`Network` listeners; pass events to store.

---

## Non-blocking realtime subscription (preserve)

- Maintain the existing non-blocking behavior added recently. Do not reintroduce `getSession()` waits during channel setup.
- Request realtime JWT in parallel; if not ready, reuse last good token and proceed.

---

## Fallback behavior and edge cases

- App killed: On cold start, before showing chat, run the same resync sequence; avoid empty flicker by showing a lightweight loader when possible.
- Multiple groups: Immediately resubscribe/resync for the open group; schedule background resync for recent groups.
- Doze/Battery savers: Use high-priority FCM; resync logic tolerant of delayed pushes.
- Stale device tokens: Deactivate on FCM errors.

---

## Acceptance checks (manual)

1. Foreground reconnect: Lock 30s, unlock, message from another device appears within ~1–2s; logs show `[rt] rebuild`, `[sync] merged`.
2. Background push wake: App background 10+ minutes; 3 quick messages → one push arrives, app wakes and pulls all 3 without dupes.
3. Outbox safety: Send immediately after unlock with poor network; message stays “sending…” then delivers once `[auth] writes:ready`.
4. Kill app → receive push → tap notification → app opens target group and shows message, no empty-state flash.

---

## Security & privacy

- No full tokens in logs; truncate.
- Data push payload minimal and non-sensitive.
- RLS ensures users can manage only their own device rows; service role reads for fan-out only.

---

## Rollout & kill-switch

- Default enabled: `features.push_resync.enabled = true`.
- Global kill-switch: `features.push_resync.killSwitch = true` reverts to current behavior (no push usage, existing reconnection only).
- Log a single `[rt] degraded backoff=<ms>` line per backoff step to keep noise low; retain existing logs elsewhere.

---

## Work breakdown and progress

### Phase 1 — Foundations

- [x] Add `src/lib/featureFlags.ts` with defaults and kill-switch.
- [x] Add `src/lib/push.ts` with token registration and listeners (no-op if kill-switch on).
- [x] Wire listeners in `src/main.tsx` and store bootstrap; add `onWake()` handler.

### Phase 2 — Server plumbing

- [x] Migration for `public.user_devices` + RLS.
  - [x] Migration file scaffolded (`supabase/migrations/20250819_user_devices.sql`).
- [x] Edge Function `push-fanout` with scaffolding for FCM send + token deactivation.
- [x] DB trigger to enqueue notifications (queue-based alternative) in `20250819_push_queue.sql`.

### Phase 3 — Resync & watchdog

- [ ] Implement `rebuildRealtimeChannels()` with watchdog and backoff.
  - [x] Partial: added degraded logs/backoff tag and channel rebuild logs; watchdog behavior to be finalized.
- [x] Implement `syncMissed(groupId)` and idempotent merge.
- [ ] Add 10s fetch-poll fallback when `realtime_degraded` (start/stop hooks added; wiring pending).
- [x] Add 10s fetch-poll fallback when `realtime_degraded` (backoff -> degraded starts poll; stop on reconnect).

### Phase 4 — Write safety & outbox

- [x] Implement `ensureAuthForWrites()` and integrate with send paths.
- [x] Add short-delay retry and final outbox enqueue on block.
- [x] Update outbox drain triggers and gating.

### Phase 5 — QA & hardening

- [ ] Implement all specified logs.
  - [x] Implemented across client flows and Edge Function; review for completeness during QA.
  - [ ] Client logs added incrementally: auth gate, rt rebuild/degraded, push wake, sync merge, outbox defer. Review and fill remaining gaps.
- [ ] Manual test plan passes (items 1–4 above) on Android; spot-check iOS routing.
- [ ] Telemetry/metrics counters (basic counts via logs for now).
  - [ ] Ensure all new logs use tags: [push], [sync], [auth], [rt], [outbox].

---

## Mapping to current codebase

- Push plumbing
  - New: `src/lib/push.ts`
  - Modify: `src/main.tsx` to init push and listeners

- Realtime & resync
  - Modify: `src/store/chatstore_refactored/realtimeActions.ts`
  - Modify: `src/store/chatstore_refactored/fetchActions.ts`
  - Modify: `src/store/chatstore_refactored/index.ts` (central handler/state)
  - Modify: `src/lib/sqliteServices_Refactored/syncOperations.ts` (add `syncMissed` helpers)

- Write gating & outbox
  - Modify: `src/store/chatstore_refactored/messageActions.ts`
  - Modify: `src/store/chatstore_refactored/offlineActions.ts`
  - Modify: `src/lib/sqliteServices_Refactored/outboxOperations.ts`
  - New/Modify: `src/store/chatstore_refactored/utils.ts` or shared helper location for `ensureAuthForWrites()`

- Supabase server
  - New migration under `supabase/migrations/*_user_devices.sql`
  - New function under `supabase/functions/push-fanout/index.ts`

---

## Notes and assumptions

- Realtime subscription currently non-blocking will remain untouched; new code wraps around it and rebuilds channels proactively.
- We will not change DB schemas for `messages` or `group_members`.
- Client already uses client-generated UUIDs for messages; idempotent upsert semantics remain unchanged.
- Remote-config integration is optional; local defaults + localStorage overrides are sufficient for initial rollout.

---

## Next actions (implementation order)

1) Add feature flags module and no-op wiring guards.
2) Implement push token registration (`src/lib/push.ts`) and ensure it safely no-ops when disabled.
3) Add store listeners (`app:resume`, `network:online`, `push:wakeup`) and central `onWake()`.
4) Implement `ensureAuthForWrites()` and integrate into send/outbox code paths.
5) Implement realtime rebuild + watchdog and missed message resync path.
6) Add server migration and Edge Function scaffolding for fan-out.
7) QA per acceptance and add any missing logs.

---

Changelog

- 2025-08-19: Initial plan created and committed. Defaults: feature enabled; kill-switch available.


