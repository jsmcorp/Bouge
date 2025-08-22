## Log Analysis and Root Causes (Android Capacitor + Supabase)

### What the logs show
- Frequent route logs on nearly every interaction:
  - `✅ ProtectedRoute: Access granted to: /groups/...` appears repeatedly for clicks, sends, refreshes.
- Sending a message runs a heavy sequence each time:
  - Direct send attempt → fails → enqueue to outbox → trigger outbox processing → refresh messages (SQLite + Supabase) → sync related data → cache churn.
- Supabase insert failures on message send (two distinct messages):
  - `code: "22P02"` with `message: "invalid input syntax for type uuid: "1755864790887-osmec2vmly7""` and likewise for `1755864802792-lu64q4nei1`.
- Misleading success log after fallback:
  - `📦 Message ... stored in outbox` followed by `✅ Message ... sent successfully` even though the actual insert to Supabase failed and the message was only queued.
- Repeated pseudonym cache logs:
  - `🎭 Returning cached pseudonym for group:user` printed many times rapidly → indicates repeated lookups/renders.
- Heavy fetch/sync cycle triggered multiple times:
  - After outbox processing: `Refreshing messages...` → `📱 Loading from SQLite` → `🌐 Fetching messages from Supabase...` → `🔄 Syncing messages from Supabase to local storage...` → `📊 Syncing message-related data...` (N+1 queries for replies/polls/votes), then cache invalidation and another background load.

### Primary issues and root causes
1) Supabase insert fails (22P02 invalid uuid)
   - Root cause: client-generated non-UUID `message.id` is sent to a Postgres `uuid` column.
   - Where: `src/lib/supabasePipeline.ts` direct send (lines ~784–803 setting `id: message.id`) and outbox processing (lines ~914–933 setting `id: messageData.id`).
   - Impact: Direct sends and outbox retries fail; messages get stuck in outbox and keep retrying; extra refreshes are triggered.

2) Misleading success semantics/logs when falling back to outbox
   - Root cause: `sendMessage()` logs success when `sendMessageInternal()` falls back to outbox without throwing. Callers may treat queued messages as sent.
   - Where: `supabasePipeline.sendMessage` and `sendMessageInternal` return path after `fallbackToOutbox`.
   - Impact: UI/logs say "sent successfully" though nothing reached Supabase; leads to unnecessary refresh and wrong delivery status.

3) Over-aggressive refresh after outbox processing regardless of outcome
   - Root cause: `outbox-unified` triggers `fetchMessages` unconditionally after `processOutbox`, even when all outbox inserts fail.
   - Where: `src/store/chatstore_refactored/offlineActions.ts` (`processOutbox` logs: "Pipeline processing completed successfully" then "Refreshing messages...").
   - Impact: Every send attempts a full message reload (SQLite + Supabase + related data sync), causing perceived "backend reload" and latency.

4) Duplicate/competing refresh triggers
   - Root cause: On send, we both: (a) invalidate message cache and (b) outbox processing triggers a refresh. These can race and double-load.
   - Where: `messageActions.ts` invalidates cache post-send; `offlineActions` refreshes after processing.
   - Impact: Redundant fetches and syncs; extra load and flicker.

5) N+1 network patterns in `fetchMessages`
   - Root cause: For each message, separate queries for reply count, latest replies, poll, votes, user vote.
   - Where: `src/store/chatstore_refactored/fetchActions.ts` (multiple per-message `select` calls).
   - Impact: Large number of queries per refresh; slow and expensive on mobile.

6) Excessive logs and repeated pseudonym lookups
   - Root cause: `ProtectedRoute` logs on every render; pseudonym service logs on each retrieval; multiple components likely call per-render.
   - Where: `src/components/ProtectedRoute.tsx`, `src/lib/pseudonymService.ts` and consumers.
   - Impact: Noise and hint of excessive re-renders; not the main bug but adds overhead and confusion.

### Suggested fixes (no code changes yet)
- P0 Fix: Stop sending client `id` into Supabase; use server-generated id with idempotent upsert
  - Change pipeline direct send and outbox send to use `upsert({ ..., dedupe_key })` with `onConflict: 'dedupe_key'` and remove `id` field entirely.
  - Ensure a unique index on `messages.dedupe_key` (looks present; verify in migrations) to guarantee idempotency.
  - Optionally, if a client id is needed locally, keep it only in SQLite/UI; never send non-UUID `id` to Supabase.

- P0 Fix: Correct success semantics for outbox fallback
  - Make `sendMessage()` return a status enum: `direct_sent | queued | failed`, or throw for non-direct paths, so callers don’t mark as `sent` when merely queued.
  - Update logs accordingly: "queued to outbox" vs "sent to Supabase" to prevent false positives.

- P1 Fix: Refresh only on successful outbox deliveries and dedupe refresh triggers
  - `processOutbox()` should return counts (sent, failed, retried). Only refresh messages if `sent > 0`.
  - Debounce/throttle group refreshes to at most once per X seconds per group.
  - Remove either cache invalidation-triggered fetch or the outbox-triggered refresh to avoid double loads; keep one canonical path.

- P1 Fix: Reduce N+1 in message fetch
  - Replace per-message queries with a single batched fetch:
    - Use a single `in('parent_id', [...])` to fetch replies for the visible page, or a server-side RPC that returns messages with top replies and counts.
    - For polls, fetch votes in one `in('poll_id', [...])` and compute counts client-side.
  - Consider a "delta since last cursor" path as default for active chat to avoid full reloads.

- P2 Fix: Quiet noisy logs and tame pseudonym lookups
  - Downgrade `ProtectedRoute` logs to debug or wrap with `if (import.meta.env.DEV)`.
  - In components, memoize pseudonym lookups per message list render; avoid redundant calls.
  - Option: batch pseudonym RPCs if needed, though current cache already helps.

### Prioritized TODOs (for implementation)
1) Replace pipeline inserts with idempotent upsert-by-dedupe_key and remove `id` from payload to Supabase (direct + outbox paths). [COMPLETED]
2) Adjust pipeline API to report `queued` vs `direct_sent`; update callers to not mark `sent` on `queued`. [COMPLETED]
3) Make outbox processing report success/fail counts and only refresh on success; add per-group throttle. [COMPLETED]
4) Dedupe/centralize refresh so only one path triggers it (either cache invalidation OR outbox-complete, not both). [COMPLETED]
5) Rework `fetchMessages` to batch replies/polls/votes (avoid per-message queries) and prefer delta sync for active chat.
6) Reduce log verbosity in `ProtectedRoute` and memoize pseudonym calls at the component level.

### Why this will fix the observed problems
- Removing client `id` from inserts eliminates `22P02` and allows messages to reach Supabase immediately (or via outbox) using server UUIDs.
- Correct success semantics prevent premature refreshes and false "sent" states.
- Conditional, deduped refresh removes the "full backend reload" perception after every click/send.
- Batching queries cuts network round trips and speeds up reloads, especially on mobile.


