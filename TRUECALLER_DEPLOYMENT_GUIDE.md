# Truecaller Integration - Deployment & Testing Guide

## 🚀 Quick Start - Deploy & Test in 5 Minutes

### Step 1: Set Environment Variables (1 minute)

Create `.env.local` file in the project root:

```bash
# Copy from example
cp .env.example .env.local
```

Ensure these variables are set:
```env
VITE_SUPABASE_URL=your_supabase_url
VITE_SUPABASE_ANON_KEY=your_supabase_anon_key
TRUECALLER_CLIENT_ID=ppahhdlivw5_ublvua1eg6xawmferfdcapccbtf9sg8
```

### Step 2: Deploy Supabase Edge Function (2 minutes)

```bash
# Login to Supabase (if not already logged in)
npx supabase login

# Link to your project
npx supabase link --project-ref your-project-ref

# Deploy the truecaller-verify function
npx supabase functions deploy truecaller-verify

# Set the environment variable for the function
npx supabase secrets set TRUECALLER_CLIENT_ID=ppahhdlivw5_ublvua1eg6xawmferfdcapccbtf9sg8
```

### Step 3: Build & Run on Android Device (2 minutes)

```bash
# Build the web app
npm run build

# Sync with Android
npx cap sync android

# Run on connected Android device or emulator
npx cap run android
```

---

## 📱 Testing Scenarios

### ✅ Scenario 1: Truecaller App Installed & User Logged In

**Expected Behavior:**
1. Open the app on Android device
2. Navigate to Login screen
3. **You should see "Continue with Truecaller" button** (blue gradient)
4. Tap the button
5. Truecaller app opens with authorization dialog
6. Tap "Continue" in Truecaller
7. App receives phone number and redirects to verification page
8. Enter OTP to complete login

**What to Check:**
- ✅ Truecaller button is visible on login screen
- ✅ Truecaller app opens when button is tapped
- ✅ Authorization dialog shows correct app name
- ✅ Phone number is correctly received
- ✅ User is redirected to OTP verification
- ✅ Login completes successfully

**Logs to Monitor:**
```
[Truecaller] Available: true
[Truecaller] Starting verification...
[Truecaller] Authorization code received
[Truecaller] User verified: +91XXXXXXXXXX
```

---

### ✅ Scenario 2: Truecaller App NOT Installed

**Expected Behavior:**
1. Open the app on Android device
2. Navigate to Login screen
3. **Truecaller button should NOT be visible**
4. Only phone number input and "Send OTP" button visible
5. User can login with manual OTP flow

**What to Check:**
- ✅ Truecaller button is hidden
- ✅ Manual OTP flow works normally
- ✅ No errors in console

**Logs to Monitor:**
```
[Truecaller] Available: false
```

---

### ✅ Scenario 3: User Cancels Truecaller Dialog

**Expected Behavior:**
1. Tap "Continue with Truecaller" button
2. Truecaller app opens
3. User taps "Cancel" or back button
4. App shows error toast: "Truecaller verification failed. Please use phone number instead."
5. User can still use manual OTP flow

**What to Check:**
- ✅ Error is handled gracefully
- ✅ User can retry with Truecaller
- ✅ User can switch to manual OTP
- ✅ No app crash

---

### ✅ Scenario 4: Network Error During Verification

**Expected Behavior:**
1. Tap "Continue with Truecaller" button
2. Truecaller completes successfully
3. Backend call fails due to network error
4. App shows error toast with network error message
5. User can retry

**What to Check:**
- ✅ Network errors are caught and displayed
- ✅ User can retry verification
- ✅ No app crash

---

### ✅ Scenario 5: Backend Token Exchange Success

**Expected Behavior:**
1. Complete Truecaller flow
2. Backend successfully exchanges authorization code for access token
3. Backend retrieves user profile (phone number, name)
4. User is redirected to OTP verification with pre-filled phone number
5. Login completes successfully

**What to Check:**
- ✅ Backend function executes successfully
- ✅ Phone number is correctly extracted
- ✅ User profile data is returned
- ✅ OTP is sent to verified phone number

**Backend Logs to Monitor (Supabase Dashboard):**
```
[Truecaller Verify] Request received
[Truecaller Verify] Exchanging authorization code for access token
[Truecaller Verify] Token exchange successful
[Truecaller Verify] User profile retrieved: +91XXXXXXXXXX
```

---

### ✅ Scenario 6: Multiple Devices & Android Versions

**Test on:**
- ✅ Android 7.0 (API 24) - Minimum supported version
- ✅ Android 10 (API 29)
- ✅ Android 12 (API 31)
- ✅ Android 14 (API 34) - Latest

**What to Check:**
- ✅ Truecaller SDK works on all versions
- ✅ No compatibility issues
- ✅ UI renders correctly on different screen sizes

---

## 🔍 Debugging

### Check if Truecaller Plugin is Loaded

Open Chrome DevTools (chrome://inspect) and run in console:

```javascript
// Check if plugin is available
const result = await TruecallerAuth.isAvailable();
console.log('Truecaller available:', result.available);
```

### Check Android Logs

```bash
# Filter for Truecaller logs
adb logcat | grep -i truecaller

# Filter for app logs
adb logcat | grep -i confessr
```

### Check Supabase Function Logs

1. Go to Supabase Dashboard
2. Navigate to Edge Functions
3. Click on `truecaller-verify`
4. View logs in real-time

### Common Issues

#### Issue 1: Truecaller button not visible

**Possible Causes:**
- App not running on Android device (web browser doesn't support Truecaller)
- Truecaller app not installed
- Plugin not loaded correctly

**Solution:**
```bash
# Rebuild and sync
npm run build
npx cap sync android
npx cap run android

# Check logs
adb logcat | grep -i truecaller
```

#### Issue 2: "Truecaller not available" error

**Possible Causes:**
- Truecaller app not installed
- Truecaller app version too old
- Device doesn't support Truecaller

**Solution:**
- Install latest Truecaller app from Play Store
- Ensure user is logged into Truecaller

#### Issue 3: Backend verification fails

**Possible Causes:**
- Supabase function not deployed
- Environment variable not set
- Network error
- Invalid authorization code

**Solution:**
```bash
# Redeploy function
npx supabase functions deploy truecaller-verify

# Check environment variables
npx supabase secrets list

# Set if missing
npx supabase secrets set TRUECALLER_CLIENT_ID=ppahhdlivw5_ublvua1eg6xawmferfdcapccbtf9sg8
```

#### Issue 4: "State mismatch" error

**Possible Causes:**
- CSRF attack detected
- OAuth state validation failed
- Multiple verification attempts

**Solution:**
- This is a security feature working correctly
- User should retry verification
- If persists, check for clock sync issues on device

---

## 🎯 Success Criteria

Your Truecaller integration is working correctly if:

- ✅ Truecaller button appears on Android devices with Truecaller installed
- ✅ Truecaller button is hidden on devices without Truecaller
- ✅ Tapping button opens Truecaller app
- ✅ Authorization completes successfully
- ✅ Backend exchanges code for user profile
- ✅ Phone number is correctly extracted
- ✅ User is redirected to OTP verification
- ✅ Login completes end-to-end
- ✅ Errors are handled gracefully
- ✅ User can fallback to manual OTP

---

## 📊 Monitoring & Analytics

### Key Metrics to Track

1. **Truecaller Availability Rate**
   - % of Android users with Truecaller installed
   - Track via `isAvailable()` calls

2. **Truecaller Success Rate**
   - % of Truecaller verifications that succeed
   - Track via backend function logs

3. **Truecaller vs OTP Usage**
   - % of users choosing Truecaller vs manual OTP
   - Track via login method analytics

4. **Error Rates**
   - User cancellations
   - Network errors
   - Backend failures
   - State mismatch errors

### Add Analytics (Optional)

```typescript
// In LoginPage.tsx
const handleTruecallerLogin = async () => {
  // Track Truecaller attempt
  analytics.track('truecaller_login_attempt');
  
  try {
    // ... existing code ...
    analytics.track('truecaller_login_success');
  } catch (error) {
    analytics.track('truecaller_login_failure', { error: error.message });
  }
};
```

---

## 🚀 Production Checklist

Before going live:

- [ ] Supabase Edge Function deployed
- [ ] Environment variables set correctly
- [ ] Tested on multiple Android devices
- [ ] Tested with Truecaller installed
- [ ] Tested without Truecaller installed
- [ ] Tested user cancellation flow
- [ ] Tested network error scenarios
- [ ] Verified PKCE flow security
- [ ] Verified state validation (CSRF protection)
- [ ] Error messages are user-friendly
- [ ] Fallback to OTP works correctly
- [ ] Logs are clean (no errors)
- [ ] Analytics tracking implemented (optional)
- [ ] Privacy policy updated (if needed)
- [ ] Terms of service updated (if needed)

---

## 📞 Support

If you encounter issues:

1. Check this guide's debugging section
2. Review `truecaller.md` for detailed API documentation
3. Check Truecaller SDK documentation: https://docs.truecaller.com/
4. Review Supabase Edge Function logs
5. Check Android logcat for native errors

---

**Ready to test!** 🎉

Start with **Step 1** above and follow the testing scenarios to verify everything works correctly.

