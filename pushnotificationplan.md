## Push Notification Plan (Confessr)

Scope: Android + iOS via FCM; generic content; tap opens target group. Trigger fanout immediately after successful send (client) and via DB queue fallback. Use FCM v1 (configured).

### Components
- Client
  - `src/lib/push.ts`: token registration, listeners (data, tap), wake bridge
  - `src/main.tsx`: init push, route wake events to store
  - `src/store/chatstore_refactored/*`: send paths, outbox, resume/onWake
  - `src/lib/supabasePipeline.ts`: fanout call post-send and after outbox send
- Server
  - `supabase/functions/push-fanout/index.ts`: fan out to device tokens
  - `supabase/migrations/20250819_user_devices.sql`: device registry
  - `supabase/migrations/20250819_push_queue.sql`: queue + trigger

### What we implemented
- Android: added `POST_NOTIFICATIONS` permission.
- Edge Function: include visible `notification` (title/body generic) for background display; keep `data` payload unchanged.
- Client: added `notificationActionPerformed` listener; wake app on tap; existing `notificationReceived` wakes on data message.
- Fanout: client calls `functions/v1/push-fanout` after successful direct send and after outbox delivery.

### Testing steps
1) Build + deploy
   - Web: `npm run build`
   - Native sync: `npx cap sync`
   - Android run: `npx cap run android --target <device>`
2) Token registration
   - Logcat filter: `[push] token:registered`
   - Check table `public.user_devices` for your user
3) Background notification
   - Put app in background
   - From another device/user, send a message
   - Expect OS notification: title “New message”, body “You have a new message”
   - Tap notification → app opens; store receives `push:wakeup`
4) Queue fallback path
   - Ensure DB trigger exists (in migration)
   - If client didn’t call fanout, function drains `notification_queue` and sends
5) iOS spot-check (on macOS)
   - Add iOS platform and APNs setup via FCM
   - Verify notification shows and tap routes

### Troubleshooting
- No notification:
  - Verify device token exists (`user_devices.active=true`)
  - Confirm Edge Function logs `[push] notify:fanout …`
  - Confirm `google-services.json` (Android) / APNs setup (iOS)
  - Check runtime permission granted on Android 13+
- No tap routing:
  - Ensure listener `notificationActionPerformed` is firing
  - Confirm `group_id` present in data payload

### Rollout
- Controlled by `FEATURES_PUSH` flags in `src/lib/featureFlags.ts`
- Kill-switch: set `push_resync.killSwitch = true` in overrides


