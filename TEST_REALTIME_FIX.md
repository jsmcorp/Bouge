# Testing Realtime Message Delivery Fix

## Overview
This guide helps you verify that the realtime fix is working correctly and messages are being delivered instantly without relying on FCM push notifications.

## Prerequisites

- [ ] Migration `20251114_enable_realtime_messages.sql` has been applied
- [ ] App has been rebuilt and deployed
- [ ] Two test devices or one device + web browser

## Test Scenarios

### Test 1: Basic Instant Messaging (WhatsApp-style)

**Setup:**
1. Device A: User Alice logged in, viewing Group Chat
2. Device B: User Bob logged in, viewing the same Group Chat

**Steps:**
1. Bob sends a message: "Hello from Bob"
2. Observe Alice's device

**Expected Result:**
- ✅ Message appears on Alice's device within 100ms
- ✅ No visible delay or loading state
- ✅ Auto-scrolls to show new message
- ✅ Logs show: `📨 Realtime INSERT received: id=xxx`

**Failure Indicators:**
- ❌ Message doesn't appear until Alice refreshes
- ❌ Message appears only after FCM notification arrives (1-3 seconds delay)
- ❌ No "📨 Realtime INSERT received" in logs

---

### Test 2: Background to Foreground

**Setup:**
1. Device A: Alice viewing Group Chat
2. Device B: Bob sends message, then Alice puts app in background

**Steps:**
1. Bob sends: "Message 1"
2. Alice puts app in background (home button)
3. Wait 5 seconds
4. Bob sends: "Message 2"
5. Alice brings app to foreground

**Expected Result:**
- ✅ "Message 1" appeared instantly before backgrounding
- ✅ "Message 2" appears within 100ms of foregrounding
- ✅ Both messages visible without manual refresh
- ✅ Logs show realtime reconnection: `✅ Realtime connected successfully`

---

### Test 3: Multiple Messages Rapid Fire

**Setup:**
1. Device A: Alice viewing Group Chat
2. Device B: Bob ready to send multiple messages

**Steps:**
1. Bob sends 5 messages rapidly (1 per second):
   - "Message 1"
   - "Message 2"
   - "Message 3"
   - "Message 4"
   - "Message 5"

**Expected Result:**
- ✅ All 5 messages appear on Alice's device in real-time
- ✅ Messages appear in correct order
- ✅ No messages missing or duplicated
- ✅ Logs show 5 separate "📨 Realtime INSERT received" events

---

### Test 4: Multiple Groups

**Setup:**
1. Device A: Alice member of Group 1 and Group 2
2. Device B: Bob member of Group 1
3. Device C: Charlie member of Group 2

**Steps:**
1. Alice opens Group 1 chat
2. Bob sends message in Group 1: "Hello Group 1"
3. Charlie sends message in Group 2: "Hello Group 2"
4. Alice switches to Group 2 chat

**Expected Result:**
- ✅ Bob's message appears instantly in Group 1
- ✅ Charlie's message appears when Alice opens Group 2
- ✅ Subscription filter includes both groups: `group_id=in.(group1-id,group2-id)`
- ✅ No cross-contamination (Group 1 messages don't appear in Group 2)

---

### Test 5: Network Reconnection

**Setup:**
1. Device A: Alice viewing Group Chat with active internet
2. Device B: Bob ready to send messages

**Steps:**
1. Alice enables airplane mode
2. Wait 5 seconds
3. Bob sends: "Message during offline"
4. Alice disables airplane mode
5. Wait for reconnection

**Expected Result:**
- ✅ Realtime reconnects automatically: `✅ Realtime connected successfully`
- ✅ "Message during offline" appears within 1 second of reconnection
- ✅ No manual refresh needed
- ✅ Logs show: `[realtime-v2] Subscription status: SUBSCRIBED`

---

## Log Patterns to Look For

### Successful Realtime Delivery

```
[realtime-v2] 📡 Subscribing to messages with filter: group_id=in.(xxx,yyy)
[realtime-v2] Subscription status: SUBSCRIBED
[realtime-v2] ✅ Realtime connected successfully
[realtime-v2] 💓 Starting heartbeat mechanism
[realtime-v2] 📨 Realtime INSERT received: id=abc123, group=xxx, content="Hello..."
[realtime-v2] 📨 Built message from row: id=abc123
📨 attachMessageToState: action=added-new, before=50, after=51
[realtime-v2] 📨 Message persisted to SQLite: id=abc123
📍 Auto-scrolled to show new message: abc123
```

### Failed Realtime (Needs Fix)

```
[realtime-v2] 📡 Subscribing to messages with filter: group_id=in.(xxx,yyy)
[realtime-v2] Subscription status: SUBSCRIBED
[realtime-v2] ✅ Realtime connected successfully
[realtime-v2] 💓 Starting heartbeat mechanism
... (no "📨 Realtime INSERT received" messages) ...
[FCM] 📨 Notification received: data-only payload
[FCM] 📨 Processing message_sent event
```

**Problem:** Messages only arrive via FCM, not realtime

---

## Troubleshooting

### Issue: No "📨 Realtime INSERT received" logs

**Possible Causes:**
1. Realtime not enabled for messages table
2. RLS policies blocking realtime events
3. User not authenticated
4. User not a member of the group

**Solutions:**

1. **Verify realtime is enabled:**
   ```sql
   SELECT * FROM pg_publication_tables 
   WHERE pubname = 'supabase_realtime' 
   AND tablename = 'messages';
   ```
   Should return 1 row. If empty, run:
   ```sql
   ALTER PUBLICATION supabase_realtime ADD TABLE messages;
   ```

2. **Verify SELECT policy exists:**
   ```sql
   SELECT * FROM pg_policies 
   WHERE tablename = 'messages' 
   AND cmd = 'SELECT';
   ```
   Should return at least 1 policy allowing SELECT for group members.

3. **Verify user is authenticated:**
   Check logs for: `auth.uid() = xxx`

4. **Verify user is group member:**
   ```sql
   SELECT * FROM group_members 
   WHERE user_id = 'xxx' 
   AND group_id = 'yyy';
   ```

---

### Issue: Realtime connects but then disconnects

**Possible Causes:**
1. Network instability
2. Supabase project limits exceeded
3. Token expiration

**Solutions:**

1. **Check heartbeat logs:**
   ```
   [realtime-v2] 💓 Heartbeat sent
   [realtime-v2] 💓 Heartbeat response received
   ```
   If heartbeat fails, connection will be reset.

2. **Check token expiration:**
   Tokens expire after 1 hour by default. The app should refresh automatically.

3. **Check Supabase dashboard:**
   - Go to Settings → API
   - Check realtime connection limits
   - Verify project is not paused

---

### Issue: Messages appear but with delay

**Possible Causes:**
1. Realtime is working but slow network
2. Message processing is slow
3. UI rendering is slow

**Solutions:**

1. **Check realtime latency:**
   Time between "📨 Realtime INSERT received" and "📍 Auto-scrolled"
   Should be < 50ms

2. **Check network latency:**
   Use browser dev tools or Charles Proxy to measure WebSocket latency

3. **Check message processing:**
   Look for slow operations between INSERT and UI update

---

## Success Criteria

The fix is successful when:

- ✅ Messages appear within 100ms of being sent
- ✅ No manual refresh needed
- ✅ Works like WhatsApp instant messaging
- ✅ Logs show "📨 Realtime INSERT received" for every message
- ✅ FCM is only used for background notifications, not foreground delivery
- ✅ Multiple rapid messages all appear in real-time
- ✅ Works across multiple groups
- ✅ Reconnects automatically after network interruption

---

## Performance Benchmarks

| Metric | Target | Acceptable | Poor |
|--------|--------|------------|------|
| Message delivery latency | < 100ms | < 500ms | > 1s |
| Realtime connection time | < 1s | < 3s | > 5s |
| Reconnection time | < 2s | < 5s | > 10s |
| Messages per second | 10+ | 5+ | < 5 |

---

## Next Steps After Successful Testing

1. Monitor production logs for realtime events
2. Set up alerts for realtime connection failures
3. Track message delivery latency metrics
4. Consider adding retry logic for failed realtime deliveries
5. Optimize message processing pipeline for even faster delivery

---

## Support

If issues persist after following this guide:

1. Check Supabase status page: https://status.supabase.com
2. Review Supabase realtime docs: https://supabase.com/docs/guides/realtime
3. Check app logs for detailed error messages
4. Verify database schema matches expected structure
