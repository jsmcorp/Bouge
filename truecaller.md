# Truecaller SDK Integration Guide

## Overview

This document provides comprehensive guidance for integrating the Truecaller OAuth SDK 3.1.0 into the Confessr mobile application. The integration enables one-tap phone number verification for users who have the Truecaller app installed, providing a faster and more seamless authentication experience.

### Purpose

- **Primary Goal**: Offer Truecaller-based phone verification as an alternative to Twilio OTP
- **User Experience**: Enable instant authentication for Truecaller users (one-tap login)
- **Fallback Strategy**: Maintain Twilio OTP verification for non-Truecaller users
- **Platform**: Android only (Capacitor-based mobile app)

### Benefits

1. **Faster Authentication**: One-tap verification vs. waiting for OTP SMS
2. **Better UX**: No manual OTP entry required for Truecaller users
3. **Cost Optimization**: Reduce SMS costs for Truecaller users
4. **Verified Data**: Get verified phone number and user name from Truecaller
5. **Trust Signal**: Truecaller verification adds credibility

---

## Prerequisites

### 1. Truecaller Developer Account
- **Client ID**: `ppahhdlivw5_ublvua1eg6xawmferfdcapccbtf9sg8`
- **Documentation**: https://docs.truecaller.com/truecaller-sdk/android/oauth-sdk-3.1.0

### 2. Technical Requirements
- **Minimum Android SDK**: API Level 24 (Android 7.0)
- **Android Gradle Plugin**: 7.4.2 or higher
- **Gradle Version**: 7.5 or higher
- **Java Version**: 1.8 (already configured in project)
- **Capacitor**: 7.0.0 (already installed)

### 3. Current Project Setup
- **Package**: `com.confessr.app`
- **Build System**: Gradle with Android plugin
- **Existing Auth**: Twilio Verify API via Supabase
- **State Management**: Zustand stores

---

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────┐
│                     React/TypeScript Layer                   │
│  ┌────────────────┐         ┌──────────────────────────┐   │
│  │  LoginPage.tsx │────────▶│ TruecallerPlugin.ts      │   │
│  │  (UI Component)│         │ (Capacitor Plugin)       │   │
│  └────────────────┘         └──────────────────────────┘   │
└─────────────────────────────────────────────────────────────┘
                                      │
                                      ▼
┌─────────────────────────────────────────────────────────────┐
│                    Capacitor Bridge Layer                    │
│  ┌──────────────────────────────────────────────────────┐  │
│  │  TruecallerPlugin.java (Capacitor Plugin)            │  │
│  │  - Exposes native methods to JavaScript              │  │
│  │  - Handles callbacks and data conversion             │  │
│  └──────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────┘
                                      │
                                      ▼
┌─────────────────────────────────────────────────────────────┐
│                    Native Android Layer                      │
│  ┌──────────────────────────────────────────────────────┐  │
│  │  TruecallerManager.java                              │  │
│  │  - Initializes Truecaller SDK                        │  │
│  │  - Handles OAuth flow                                │  │
│  │  - Processes user profile data                       │  │
│  └──────────────────────────────────────────────────────┘  │
│                          │                                   │
│                          ▼                                   │
│  ┌──────────────────────────────────────────────────────┐  │
│  │  Truecaller OAuth SDK 3.1.0                          │  │
│  │  - Communicates with Truecaller app                  │  │
│  │  - Returns verified phone number and profile         │  │
│  └──────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────┘
```

---

## ⚠️ CRITICAL: OAuth Parameter Setup

### Understanding OAuth PKCE Flow

OAuth SDK 3.1.0 uses **PKCE (Proof Key for Code Exchange)** flow, which requires setting up specific parameters **before each verification request**:

1. **OAuth State** - Random 32-character string for CSRF protection
2. **OAuth Scopes** - Array of permissions: `["profile", "phone", "openid"]`
3. **Code Verifier** - Random string generated by SDK utility
4. **Code Challenge** - SHA-256 hash of code verifier

### Why This Matters

**❌ WRONG** - Calling `getAuthorizationCode()` directly will FAIL:
```java
TcSdk.getInstance().getAuthorizationCode(activity); // Missing OAuth parameters!
```

**✅ CORRECT** - Set OAuth parameters first:
```java
// 1. Set state
String state = new BigInteger(130, new SecureRandom()).toString(32);
TcSdk.getInstance().setOAuthState(state);

// 2. Set scopes
TcSdk.getInstance().setOAuthScopes(new String[]{"profile", "phone", "openid"});

// 3. Generate code verifier
String codeVerifier = CodeVerifierUtil.generateRandomCodeVerifier();

// 4. Generate and set code challenge
String codeChallenge = CodeVerifierUtil.getCodeChallenge(codeVerifier);
TcSdk.getInstance().setCodeChallenge(codeChallenge);

// 5. NOW call getAuthorizationCode
TcSdk.getInstance().getAuthorizationCode(activity);
```

### Initialization vs. Per-Request Setup

| Setup Type | When | What |
|------------|------|------|
| **One-time initialization** | Activity onCreate | `TcSdk.init(tcSdkOptions)` |
| **Per-request setup** | Before each verification | Set state, scopes, code verifier, code challenge |

**Important**: The SDK is initialized **once**, but OAuth parameters must be set **before each verification request**.

### OAuth Scopes Configuration

The scopes set in your code **must match** the scopes you selected when creating credentials in the Truecaller Developer Console:

| Scope | Description | Required |
|-------|-------------|----------|
| `openid` | OAuth 2.0 authentication | ✅ Yes |
| `profile` | User's name and basic profile info | Recommended |
| `phone` | User's verified phone number | Recommended |

**Example:**
```java
TcSdk.getInstance().setOAuthScopes(new String[]{"profile", "phone", "openid"});
```

⚠️ **Important**: If your code requests scopes that weren't enabled in the Truecaller console, the OAuth flow will fail. Make sure these match your console configuration!

---

## Integration Steps

### Step 1: Add SDK Dependencies

**File**: `android/app/build.gradle`

```gradle
dependencies {
    // ... existing dependencies
    
    // Truecaller OAuth SDK
    implementation "com.truecaller.android.sdk:truecaller-sdk:3.1.0"
}
```

**Note**: Java 8 compatibility is already configured in the project.

### Step 2: Configure Maven Repository

**File**: `android/build.gradle` (project-level)

Ensure `mavenCentral()` is present in repositories:

```gradle
allprojects {
    repositories {
        google()
        mavenCentral()  // Required for Truecaller SDK
    }
}
```

### Step 3: Configure Client ID

**File**: `android/app/src/main/res/values/strings.xml`

Add the Truecaller Client ID:

```xml
<resources>
    <!-- ... existing strings -->
    <string name="truecaller_client_id">ppahhdlivw5_ublvua1eg6xawmferfdcapccbtf9sg8</string>
</resources>
```

**File**: `android/app/src/main/AndroidManifest.xml`

Add meta-data inside `<application>` tag:

```xml
<application
    android:label="@string/app_name"
    ...>
    
    <!-- ... existing configuration -->
    
    <!-- Truecaller SDK Configuration -->
    <meta-data
        android:name="com.truecaller.android.sdk.ClientId"
        android:value="@string/truecaller_client_id" />
        
</application>
```

### Step 4: Create Native Android Manager

**File**: `android/app/src/main/java/com/confessr/app/TruecallerManager.java`

**CRITICAL**: OAuth SDK 3.1.0 requires manual setup of OAuth parameters before each verification:
1. **OAuth State** - Random string for CSRF protection
2. **OAuth Scopes** - Data permissions (profile, phone, openid)
3. **Code Verifier** - Random string for PKCE flow
4. **Code Challenge** - SHA-256 hash of code verifier

These MUST be set before calling `getAuthorizationCode()`.

```java
package com.confessr.app;

import android.app.Activity;
import android.content.Intent;
import com.truecaller.android.sdk.oAuth.*;
import com.truecaller.android.sdk.oAuth.CodeVerifierUtil;  // CRITICAL: Required for PKCE
import java.math.BigInteger;
import java.security.SecureRandom;

public class TruecallerManager {
    private static TruecallerManager instance;
    private TruecallerCallback callback;
    private String currentCodeVerifier; // Store for backend token exchange
    private String currentState; // Store for CSRF validation

    public interface TruecallerCallback {
        void onSuccess(String authorizationCode, String state, String codeVerifier);
        void onFailure(int errorCode, String errorMessage);
    }

    public static TruecallerManager getInstance() {
        if (instance == null) {
            instance = new TruecallerManager();
        }
        return instance;
    }

    public void initialize(Activity activity) {
        // Configure OAuth SDK options (one-time setup in Activity onCreate)
        TcSdkOptions tcSdkOptions = new TcSdkOptions.Builder(activity, tcOAuthCallback)
            .loginTextPrefix(TcSdkOptions.LOGIN_TEXT_PREFIX_TO_GET_STARTED)
            .loginTextSuffix(TcSdkOptions.LOGIN_TEXT_SUFFIX_PLEASE_LOGIN)
            .ctaTextPrefix(TcSdkOptions.CTA_TEXT_PREFIX_USE)
            .buttonShapeOptions(TcSdkOptions.BUTTON_SHAPE_ROUNDED)
            .privacyPolicyUrl("https://confessr.app/privacy")  // Update with your URL
            .termsOfServiceUrl("https://confessr.app/terms")   // Update with your URL
            .footerType(TcSdkOptions.FOOTER_TYPE_SKIP)
            .sdkOptions(TcSdkOptions.OPTION_VERIFY_ALL_USERS)
            .build();

        TcSdk.init(tcSdkOptions);
    }

    public boolean isUsable() {
        return TcSdk.getInstance().isOAuthFlowUsable();
    }

    public void verifyUser(Activity activity, TruecallerCallback callback) {
        this.callback = callback;

        if (!TcSdk.getInstance().isOAuthFlowUsable()) {
            callback.onFailure(-1, "Truecaller not available");
            return;
        }

        try {
            // CRITICAL: Setup OAuth parameters before each verification request

            // Step 1: Generate and set OAuth state (for CSRF protection)
            currentState = new BigInteger(130, new SecureRandom()).toString(32);
            TcSdk.getInstance().setOAuthState(currentState);

            // Step 2: Set OAuth scopes (must match scopes selected in Truecaller Developer Console)
            // Available scopes: "profile" (name), "phone" (verified number), "openid" (required)
            TcSdk.getInstance().setOAuthScopes(new String[]{"profile", "phone", "openid"});

            // Step 3: Generate code verifier using SDK utility (for PKCE flow)
            currentCodeVerifier = CodeVerifierUtil.generateRandomCodeVerifier();

            // Step 4: Generate and set code challenge (SHA-256 hash of code verifier)
            String codeChallenge = CodeVerifierUtil.getCodeChallenge(currentCodeVerifier);
            if (codeChallenge == null) {
                callback.onFailure(-2, "Device doesn't support SHA-256. Cannot proceed.");
                return;
            }
            TcSdk.getInstance().setCodeChallenge(codeChallenge);

            // Step 5: Start OAuth authorization flow
            TcSdk.getInstance().getAuthorizationCode(activity);

        } catch (Exception e) {
            callback.onFailure(-3, "Failed to setup OAuth parameters: " + e.getMessage());
        }
    }

    public void handleActivityResult(int requestCode, int resultCode, Intent data, Activity activity) {
        if (requestCode == TcSdk.SHARE_PROFILE_REQUEST_CODE) {
            TcSdk.getInstance().onActivityResultObtained(activity, requestCode, resultCode, data);
        }
    }

    private final TcOAuthCallback tcOAuthCallback = new TcOAuthCallback() {
        @Override
        public void onSuccess(TcOAuthData tcOAuthData) {
            if (callback != null) {
                // Validate state to prevent CSRF attacks
                String receivedState = tcOAuthData.getState();
                if (!currentState.equals(receivedState)) {
                    callback.onFailure(-4, "State mismatch. Possible CSRF attack detected.");
                    return;
                }

                // Return authorization code, state, and code verifier
                // Code verifier is REQUIRED for backend token exchange (PKCE flow)
                callback.onSuccess(
                    tcOAuthData.getAuthorizationCode(),
                    receivedState,
                    currentCodeVerifier
                );
            }
        }

        @Override
        public void onFailure(TcOAuthError tcOAuthError) {
            if (callback != null) {
                callback.onFailure(
                    tcOAuthError.getErrorCode(),
                    tcOAuthError.getErrorMessage()
                );
            }
        }
    };
}
```

### Step 5: Create Capacitor Plugin

**File**: `android/app/src/main/java/com/confessr/app/TruecallerPlugin.java`

```java
package com.confessr.app;

import android.content.Intent;
import com.getcapacitor.*;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;

@CapacitorPlugin(name = "TruecallerAuth")
public class TruecallerPlugin extends Plugin {

    private TruecallerManager truecallerManager;

    @Override
    public void load() {
        truecallerManager = TruecallerManager.getInstance();
        truecallerManager.initialize(getActivity());
    }

    @PluginMethod
    public void isAvailable(PluginCall call) {
        boolean available = truecallerManager.isUsable();
        JSObject ret = new JSObject();
        ret.put("available", available);
        call.resolve(ret);
    }

    @PluginMethod
    public void verifyWithTruecaller(PluginCall call) {
        // Save call for later resolution in callback
        saveCall(call);

        truecallerManager.verifyUser(getActivity(), new TruecallerManager.TruecallerCallback() {
            @Override
            public void onSuccess(String authorizationCode, String state) {
                JSObject ret = new JSObject();
                ret.put("success", true);
                ret.put("authorizationCode", authorizationCode);
                ret.put("state", state);
                call.resolve(ret);
            }

            @Override
            public void onFailure(int errorCode, String errorMessage) {
                call.reject("Truecaller verification failed: " + errorMessage, String.valueOf(errorCode));
            }
        });
    }

    @Override
    protected void handleOnActivityResult(int requestCode, int resultCode, Intent data) {
        super.handleOnActivityResult(requestCode, resultCode, data);
        truecallerManager.handleActivityResult(requestCode, resultCode, data, getActivity());
    }
}
```

### Step 6: Register Plugin in MainActivity

**File**: `android/app/src/main/java/com/confessr/app/MainActivity.java`

```java
package com.confessr.app;

import android.os.Bundle;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        
        // Register Truecaller plugin
        registerPlugin(TruecallerPlugin.class);
        
        createDefaultNotificationChannel();
    }
    
    // ... existing notification channel code
}
```

### Step 7: Create TypeScript Plugin Interface

**File**: `src/plugins/truecaller.ts`

**IMPORTANT**: OAuth SDK returns authorization code, not user profile directly.

```typescript
import { registerPlugin } from '@capacitor/core';

export interface TruecallerAuthPlugin {
  isAvailable(): Promise<{ available: boolean }>;
  verifyWithTruecaller(): Promise<{
    success: boolean;
    authorizationCode?: string;  // OAuth authorization code
    state?: string;               // OAuth state parameter
  }>;
}

const TruecallerAuth = registerPlugin<TruecallerAuthPlugin>('TruecallerAuth');

export default TruecallerAuth;
```

---

## Usage Examples

### Check Truecaller Availability

```typescript
import TruecallerAuth from '@/plugins/truecaller';

const checkTruecallerAvailability = async () => {
  try {
    const { available } = await TruecallerAuth.isAvailable();
    return available;
  } catch (error) {
    console.error('Error checking Truecaller availability:', error);
    return false;
  }
};
```

### Verify with Truecaller (OAuth PKCE Flow)

**CRITICAL**: OAuth SDK 3.1.0 requires backend token exchange with code verifier!

```typescript
const verifyWithTruecaller = async () => {
  try {
    const result = await TruecallerAuth.verifyWithTruecaller();

    if (result.success && result.authorizationCode && result.codeVerifier) {
      // Step 1: Send authorization code AND code verifier to your backend
      const response = await fetch('/api/auth/truecaller/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          authorizationCode: result.authorizationCode,
          state: result.state,
          codeVerifier: result.codeVerifier  // CRITICAL: Required for PKCE
        })
      });

      if (!response.ok) {
        throw new Error('Backend verification failed');
      }

      // Step 2: Backend returns user profile and session
      const { user, session } = await response.json();

      // Step 3: Update auth store with user data
      console.log('User verified:', user.phoneNumber, user.name);
      // ... proceed with Supabase authentication

    }
  } catch (error) {
    console.error('Truecaller verification failed:', error);
    // Fall back to OTP
    toast.error('Truecaller verification failed. Please use OTP instead.');
  }
};
```

---

## Backend Integration (REQUIRED)

### ⚠️ Critical: OAuth Flow Requires Backend

OAuth SDK 3.1.0 **does NOT return user profile directly**. You must implement a backend endpoint to exchange the authorization code for user data.

### Backend Endpoint: `/api/auth/truecaller/verify`

**File**: `netlify/functions/truecaller-verify.ts` (or your backend framework)

```typescript
import { Handler } from '@netlify/functions';
import { createClient } from '@supabase/supabase-js';

interface TruecallerVerifyRequest {
  authorizationCode: string;
  state: string;
  codeVerifier: string;  // CRITICAL: Required for PKCE flow
}

export const handler: Handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }

  try {
    const { authorizationCode, state, codeVerifier } = JSON.parse(event.body || '{}') as TruecallerVerifyRequest;

    // Step 1: Exchange authorization code for access token using PKCE
    // CRITICAL: Use code_verifier instead of client_secret for PKCE flow
    const tokenResponse = await fetch('https://oauth-account-noneu.truecaller.com/v1/token', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        client_id: process.env.TRUECALLER_CLIENT_ID!,
        code: authorizationCode,
        code_verifier: codeVerifier,  // PKCE: Use code_verifier, NOT client_secret
        redirect_uri: 'https://yourapp.com/callback', // Must match SDK config
      }),
    });

    if (!tokenResponse.ok) {
      throw new Error('Failed to exchange authorization code');
    }

    const { access_token } = await tokenResponse.json();

    // Step 2: Fetch user profile with access token
    const profileResponse = await fetch('https://profile4-noneu.truecaller.com/v1/default', {
      headers: {
        'Authorization': `Bearer ${access_token}`,
      },
    });

    if (!profileResponse.ok) {
      throw new Error('Failed to fetch user profile');
    }

    const profile = await profileResponse.json();

    // Step 3: Create/update user in Supabase
    const supabase = createClient(
      process.env.VITE_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY! // Use service role key on backend
    );

    // Authenticate user with phone number
    const { data: authData, error: authError } = await supabase.auth.signInWithOtp({
      phone: profile.phoneNumber,
      options: {
        shouldCreateUser: true,
      },
    });

    if (authError) {
      throw authError;
    }

    // Step 4: Update user profile with Truecaller data
    const { data: userData, error: userError } = await supabase
      .from('users')
      .upsert({
        phone: profile.phoneNumber,
        display_name: `${profile.firstName} ${profile.lastName}`.trim(),
        truecaller_verified: true,
        updated_at: new Date().toISOString(),
      })
      .select()
      .single();

    if (userError) {
      throw userError;
    }

    return {
      statusCode: 200,
      body: JSON.stringify({
        success: true,
        user: userData,
        session: authData.session,
      }),
    };
  } catch (error) {
    console.error('Truecaller verification error:', error);
    return {
      statusCode: 500,
      body: JSON.stringify({
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      }),
    };
  }
};
```

### Environment Variables Required

Add to `.env.local` and Netlify environment:

```bash
# Truecaller OAuth Credentials
TRUECALLER_CLIENT_ID=ppahhdlivw5_ublvua1eg6xawmferfdcapccbtf9sg8
# NOTE: PKCE flow does NOT require client_secret!
# Code verifier is sent from frontend instead

# Supabase (backend)
SUPABASE_SERVICE_ROLE_KEY=your_service_role_key_here
```

### Truecaller API Endpoints

- **Token Exchange**: `https://oauth-account-noneu.truecaller.com/v1/token`
- **User Profile**: `https://profile4-noneu.truecaller.com/v1/default`

**Note**: Use `-noneu` endpoints for non-EU regions. For EU, use:
- `https://oauth-account-eu.truecaller.com/v1/token`
- `https://profile4-eu.truecaller.com/v1/default`

---

## Error Handling

### Common Error Scenarios

| Error Code | Description | Handling Strategy |
|------------|-------------|-------------------|
| `-1` | Truecaller not available | Fall back to Twilio OTP |
| `0` | User cancelled | Show alternative login options |
| `1` | Network error | Retry or fall back to OTP |
| `2` | User not verified on Truecaller | Fall back to OTP |
| `3` | SDK initialization failed | Fall back to OTP |

### Error Handling Pattern

```typescript
const handleTruecallerAuth = async () => {
  try {
    // Step 1: Get authorization code from Truecaller SDK
    const result = await TruecallerAuth.verifyWithTruecaller();

    if (result.success && result.authorizationCode) {
      // Step 2: Exchange code for user profile via backend
      const response = await fetch('/api/auth/truecaller/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          authorizationCode: result.authorizationCode,
          state: result.state,
        }),
      });

      if (!response.ok) {
        throw new Error('Backend verification failed');
      }

      const data = await response.json();
      return { method: 'truecaller', data };
    } else {
      return { method: 'otp', data: null };
    }
  } catch (error) {
    console.error('Truecaller error:', error);
    // Always fall back to OTP on any error
    return { method: 'otp', data: null };
  }
};
```

---

## Testing Approach

### Test Scenarios

1. **Truecaller App Installed & User Logged In**
   - Expected: One-tap verification succeeds
   - Verify: Phone number and name are retrieved correctly

2. **Truecaller App Not Installed**
   - Expected: `isAvailable()` returns `false`
   - Verify: UI shows only OTP option

3. **Truecaller App Installed but User Not Logged In**
   - Expected: `requiresOtp` flag is set
   - Verify: Falls back to OTP flow

4. **User Cancels Truecaller Dialog**
   - Expected: Error callback triggered
   - Verify: User can retry or use OTP

5. **Network Error During Verification**
   - Expected: Error callback with network error
   - Verify: Graceful fallback to OTP

### Testing Checklist

- [ ] Build and sync Android project
- [ ] Test on device with Truecaller installed
- [ ] Test on device without Truecaller
- [ ] Test user cancellation flow
- [ ] Test network error scenarios
- [ ] Verify data integration with Supabase
- [ ] Test UI/UX for both paths (Truecaller + OTP)

---

## Configuration Summary

### Files Modified

1. `android/app/build.gradle` - Add SDK dependency
2. `android/build.gradle` - Ensure mavenCentral()
3. `android/app/src/main/res/values/strings.xml` - Add Client ID
4. `android/app/src/main/AndroidManifest.xml` - Add meta-data
5. `android/app/src/main/java/com/confessr/app/MainActivity.java` - Register plugin
6. `src/pages/auth/LoginPage.tsx` - Update with Truecaller option
7. `src/store/authStore.ts` - Add Truecaller auth flow
8. `.env.local` - Add Truecaller credentials

### Files Created

1. `android/app/src/main/java/com/confessr/app/TruecallerManager.java` - Native SDK manager
2. `android/app/src/main/java/com/confessr/app/TruecallerPlugin.java` - Capacitor plugin
3. `src/plugins/truecaller.ts` - TypeScript interface
4. `netlify/functions/truecaller-verify.ts` - Backend token exchange endpoint

---

## Next Steps

After completing the integration:

1. ~~**Obtain Truecaller Client Secret**~~ - **NOT REQUIRED** (PKCE flow uses code_verifier instead)
2. **Implement backend endpoint** for OAuth token exchange (CRITICAL)
3. **Update LoginPage UI** to show Truecaller button when available
4. **Integrate with authStore** to handle Truecaller authentication
5. **Configure Privacy Policy and Terms URLs** in TruecallerManager.java
6. **Verify OAuth scopes** match your Truecaller Developer Console configuration
7. **Add analytics** to track Truecaller vs OTP usage
8. **Test OAuth flow** end-to-end with backend integration
9. **Test thoroughly** on various Android devices
10. **Update documentation** for users about Truecaller option

## Important Notes

### ⚠️ OAuth SDK 3.1.0 vs SDK 2.x

**DO NOT confuse OAuth SDK 3.1.0 with the deprecated SDK 2.x!**

| Feature | SDK 2.x (Deprecated) | OAuth SDK 3.1.0 (Current) |
|---------|---------------------|---------------------------|
| **Main Class** | `TruecallerSDK` | `TcSdk` |
| **Options Class** | `TruecallerSdkScope` | `TcSdkOptions` |
| **Callback Interface** | `ITrueCallback` | `TcOAuthCallback` |
| **Returns** | Direct user profile | Authorization code |
| **Backend Required** | No | Yes (OAuth flow) |
| **Method Names** | `getUserProfile()`, `isUsable()` | `getAuthorizationCode()`, `isOAuthFlowUsable()` |

### 🔐 Security Considerations

1. **Never expose Client Secret** in frontend code
2. **Always validate state parameter** to prevent CSRF attacks
3. **Use HTTPS** for all backend API calls
4. **Store access tokens securely** on backend only
5. **Implement rate limiting** on backend verification endpoint
6. **Add request timeout** for Truecaller API calls

---

## References

- [Truecaller OAuth SDK 3.1.0 Documentation](https://docs.truecaller.com/truecaller-sdk/android/oauth-sdk-3.1.0)
- [Capacitor Plugin Development Guide](https://capacitorjs.com/docs/plugins)
- [Confessr Authentication Flow](./CLAUDE.md#authentication-flow)

