package com.confessr.app;

import androidx.fragment.app.FragmentActivity;
import android.content.Intent;
import com.truecaller.android.sdk.oAuth.*;
import java.math.BigInteger;
import java.security.SecureRandom;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import android.util.Base64;

/**
 * TruecallerManager - Singleton manager for Truecaller OAuth SDK 3.1.0
 *
 * Handles initialization, verification flow, and callbacks for Truecaller authentication.
 * Uses OAuth PKCE (Proof Key for Code Exchange) flow with proper parameter setup.
 *
 * CRITICAL: OAuth parameters (state, scopes, code verifier, code challenge) must be set
 * before each call to getAuthorizationCode().
 */
public class TruecallerManager {
    private static TruecallerManager instance;
    private TruecallerCallback callback;
    private String currentCodeVerifier; // Store for backend token exchange
    private String currentState; // Store for CSRF validation

    /**
     * Callback interface for Truecaller verification results
     */
    public interface TruecallerCallback {
        /**
         * Called when Truecaller verification succeeds
         * @param authorizationCode OAuth authorization code to exchange for access token
         * @param state OAuth state parameter for CSRF protection
         * @param codeVerifier PKCE code verifier needed for backend token exchange
         */
        void onSuccess(String authorizationCode, String state, String codeVerifier);

        /**
         * Called when Truecaller verification fails
         * @param errorCode Error code from Truecaller SDK
         * @param errorMessage Human-readable error message
         */
        void onFailure(int errorCode, String errorMessage);
    }
    
    /**
     * Get singleton instance
     */
    public static TruecallerManager getInstance() {
        if (instance == null) {
            instance = new TruecallerManager();
        }
        return instance;
    }
    
    /**
     * Initialize Truecaller OAuth SDK with configuration options
     * Should be called ONCE in Activity onCreate
     *
     * @param activity Current FragmentActivity context
     */
    public void initialize(FragmentActivity activity) {
        android.util.Log.d("TruecallerManager", "=== TRUECALLER SDK INITIALIZATION ===");
        android.util.Log.d("TruecallerManager", "Package name: " + activity.getPackageName());

        // Configure OAuth SDK options (one-time setup)
        TcSdkOptions tcSdkOptions = new TcSdkOptions.Builder(activity, tcOAuthCallback)
            .buttonShapeOptions(TcSdkOptions.BUTTON_SHAPE_ROUNDED)
            .footerType(TcSdkOptions.FOOTER_TYPE_SKIP)
            .sdkOptions(TcSdkOptions.OPTION_VERIFY_ALL_USERS)
            .build();

        TcSdk.init(tcSdkOptions);
        android.util.Log.d("TruecallerManager", "✅ Truecaller SDK initialized");
    }
    
    /**
     * Check if Truecaller OAuth flow is available on this device
     * Returns true if Truecaller app is installed and user is logged in
     * 
     * @return true if Truecaller is available, false otherwise
     */
    public boolean isUsable() {
        return TcSdk.getInstance().isOAuthFlowUsable();
    }
    
    /**
     * Generate a random code verifier for PKCE flow
     * @return Random code verifier string
     */
    private String generateCodeVerifier() {
        SecureRandom secureRandom = new SecureRandom();
        byte[] codeVerifier = new byte[32];
        secureRandom.nextBytes(codeVerifier);
        return Base64.encodeToString(codeVerifier, Base64.URL_SAFE | Base64.NO_WRAP | Base64.NO_PADDING);
    }

    /**
     * Generate code challenge from code verifier using SHA-256
     * @param codeVerifier The code verifier
     * @return Base64 URL-encoded SHA-256 hash of code verifier, or null if SHA-256 not supported
     */
    private String generateCodeChallenge(String codeVerifier) {
        try {
            MessageDigest digest = MessageDigest.getInstance("SHA-256");
            byte[] hash = digest.digest(codeVerifier.getBytes());
            return Base64.encodeToString(hash, Base64.URL_SAFE | Base64.NO_WRAP | Base64.NO_PADDING);
        } catch (NoSuchAlgorithmException e) {
            return null;
        }
    }

    /**
     * Start Truecaller verification flow with proper OAuth parameter setup
     *
     * CRITICAL: This method sets up OAuth parameters (state, scopes, code verifier,
     * code challenge) before initiating the flow. These MUST be set before each
     * call to getAuthorizationCode().
     *
     * @param activity Current FragmentActivity context
     * @param callback Callback to receive verification results
     */
    public void verifyUser(FragmentActivity activity, TruecallerCallback callback) {
        this.callback = callback;

        android.util.Log.d("TruecallerManager", "=== STARTING TRUECALLER VERIFICATION ===");
        android.util.Log.d("TruecallerManager", "Package name: " + activity.getPackageName());

        if (!TcSdk.getInstance().isOAuthFlowUsable()) {
            android.util.Log.e("TruecallerManager", "❌ Truecaller OAuth flow not usable");
            callback.onFailure(-1, "Truecaller not available");
            return;
        }

        android.util.Log.d("TruecallerManager", "✅ Truecaller OAuth flow is usable");

        try {
            // Step 1: Generate and set OAuth state (for CSRF protection)
            currentState = new BigInteger(130, new SecureRandom()).toString(32);
            TcSdk.getInstance().setOAuthState(currentState);
            android.util.Log.d("TruecallerManager", "✅ Step 1: OAuth state set: " + currentState.substring(0, 8) + "...");

            // Step 2: Set OAuth scopes (must match scopes selected in Truecaller console)
            TcSdk.getInstance().setOAuthScopes(new String[]{"profile", "phone", "openid"});
            android.util.Log.d("TruecallerManager", "✅ Step 2: OAuth scopes set: [profile, phone, openid]");

            // Step 3: Generate code verifier (for PKCE flow)
            currentCodeVerifier = generateCodeVerifier();
            android.util.Log.d("TruecallerManager", "✅ Step 3: Code verifier generated: " + currentCodeVerifier.substring(0, 8) + "...");

            // Step 4: Generate and set code challenge (SHA-256 hash of code verifier)
            String codeChallenge = generateCodeChallenge(currentCodeVerifier);
            if (codeChallenge == null) {
                android.util.Log.e("TruecallerManager", "❌ Step 4: Failed to generate code challenge (SHA-256 not supported)");
                callback.onFailure(-2, "Device doesn't support SHA-256. Cannot proceed with Truecaller verification.");
                return;
            }
            TcSdk.getInstance().setCodeChallenge(codeChallenge);
            android.util.Log.d("TruecallerManager", "✅ Step 4: Code challenge set: " + codeChallenge.substring(0, 8) + "...");

            // Step 5: Start OAuth authorization flow
            android.util.Log.d("TruecallerManager", "🚀 Step 5: Calling getAuthorizationCode()...");
            TcSdk.getInstance().getAuthorizationCode(activity);
            android.util.Log.d("TruecallerManager", "✅ getAuthorizationCode() called successfully");

        } catch (Exception e) {
            android.util.Log.e("TruecallerManager", "❌ Exception during OAuth setup: " + e.getMessage(), e);
            callback.onFailure(-3, "Failed to setup OAuth parameters: " + e.getMessage());
        }
    }
    
    /**
     * Handle activity result from Truecaller SDK
     * Must be called from Activity.onActivityResult()
     *
     * @param requestCode Request code from onActivityResult
     * @param resultCode Result code from onActivityResult
     * @param data Intent data from onActivityResult
     * @param activity Current FragmentActivity context
     */
    public void handleActivityResult(int requestCode, int resultCode, Intent data, FragmentActivity activity) {
        if (requestCode == TcSdk.SHARE_PROFILE_REQUEST_CODE) {
            TcSdk.getInstance().onActivityResultObtained(activity, requestCode, resultCode, data);
        }
    }
    
    /**
     * OAuth callback implementation
     * Receives authorization code or error from Truecaller SDK
     */
    private final TcOAuthCallback tcOAuthCallback = new TcOAuthCallback() {
        @Override
        public void onSuccess(TcOAuthData tcOAuthData) {
            android.util.Log.d("TruecallerManager", "=== TRUECALLER CALLBACK: onSuccess ===");
            android.util.Log.d("TruecallerManager", "Authorization code received: " + tcOAuthData.getAuthorizationCode().substring(0, 8) + "...");
            android.util.Log.d("TruecallerManager", "State received: " + tcOAuthData.getState().substring(0, 8) + "...");

            if (callback != null) {
                // Validate state to prevent CSRF attacks
                String receivedState = tcOAuthData.getState();
                if (!currentState.equals(receivedState)) {
                    android.util.Log.e("TruecallerManager", "❌ State mismatch! Expected: " + currentState.substring(0, 8) + "... Got: " + receivedState.substring(0, 8) + "...");
                    callback.onFailure(-4, "State mismatch. Possible CSRF attack detected.");
                    return;
                }

                android.util.Log.d("TruecallerManager", "✅ State validated successfully");

                // Return authorization code, state, and code verifier
                // Code verifier is needed for backend token exchange (PKCE flow)
                callback.onSuccess(
                    tcOAuthData.getAuthorizationCode(),
                    receivedState,
                    currentCodeVerifier
                );
                android.util.Log.d("TruecallerManager", "✅ Success callback invoked");
            }
        }

        @Override
        public void onFailure(TcOAuthError tcOAuthError) {
            android.util.Log.e("TruecallerManager", "=== TRUECALLER CALLBACK: onFailure ===");
            android.util.Log.e("TruecallerManager", "❌ Error code: " + tcOAuthError.getErrorCode());
            android.util.Log.e("TruecallerManager", "❌ Error message: " + tcOAuthError.getErrorMessage());

            if (callback != null) {
                callback.onFailure(
                    tcOAuthError.getErrorCode(),
                    tcOAuthError.getErrorMessage()
                );
            }
        }

        @Override
        public void onVerificationRequired(TcOAuthError tcOAuthError) {
            // Called when non-Truecaller user verification is required
            // For now, treat as failure and let app handle OTP fallback
            if (callback != null) {
                callback.onFailure(
                    tcOAuthError.getErrorCode(),
                    "Verification required: " + tcOAuthError.getErrorMessage()
                );
            }
        }
    };
}

