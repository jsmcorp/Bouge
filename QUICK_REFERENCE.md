# Instant Background Delivery - Quick Reference

## 🎯 What It Does
Messages are now stored in SQLite **instantly** when FCM arrives, even when app is backgrounded. No REST fetch needed.

## ⚡ Performance
- **Before**: 200-300ms (foreground only)
- **After**: <150ms (foreground + background)

## 🔍 Quick Test
1. Background app on Device A
2. Send message from Device B
3. Check Device A: Local notification should appear
4. Open app: Message already visible

## 📊 Success Logs
```
[push] ⚡ FAST PATH: FCM payload contains full message
[push] ✅ Message stored in SQLite in 67ms (fast path)
[push] 📢 Local notification shown
[push] 🏁 Fast path complete in 112ms
```

## ❌ Failure Logs
```
[push] ❌ Fast path failed: <error>
[push] 🔄 Falling back to REST fetch
[push] 📥 Starting direct REST fetch
```

## 🔧 Quick Fixes

### No notifications appearing?
```bash
# Check FCM token
adb logcat | grep "token received"

# Check permissions
adb shell dumpsys notification_listener
```

### Fast-path not working?
```bash
# Check edge function logs
Supabase Dashboard → Functions → push-fanout → Logs

# Look for message fetch errors
```

### Fallback always triggering?
```bash
# Check FCM payload in edge function logs
# Should contain: content, user_id, is_ghost, etc.
```

## 📱 ADB Commands
```bash
# View logs
adb logcat | grep -E "\[push\]|\[bg-sync\]"

# Clear logs
adb logcat -c

# Save logs
adb logcat | grep -E "\[push\]|\[bg-sync\]" > logs.txt
```

## 🚨 Emergency Rollback
```bash
# Disable fast-path (quick fix)
# In src/lib/push.ts, line ~250:
const hasFullPayload = false; // Disable

# Rebuild
npm run build && npx cap sync android
```

## 📞 Support
- **Docs**: See `INSTANT_BACKGROUND_DELIVERY_IMPLEMENTATION.md`
- **Testing**: See `TESTING_INSTANT_BACKGROUND_DELIVERY.md`
- **Deployment**: See `DEPLOYMENT_SUMMARY.md`

---

**Status**: ✅ Deployed and ready for testing
