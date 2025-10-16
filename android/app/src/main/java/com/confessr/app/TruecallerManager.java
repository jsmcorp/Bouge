package com.confessr.app;

import android.app.Activity;
import android.content.Intent;
import com.truecaller.android.sdk.oAuth.*;
import java.math.BigInteger;
import java.security.SecureRandom;

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
     * @param activity Current activity context
     */
    public void initialize(Activity activity) {
        // Configure OAuth SDK options (one-time setup)
        TcSdkOptions tcSdkOptions = new TcSdkOptions.Builder(activity, tcOAuthCallback)
            .loginTextPrefix(TcSdkOptions.LOGIN_TEXT_PREFIX_TO_GET_STARTED)
            .loginTextSuffix(TcSdkOptions.LOGIN_TEXT_SUFFIX_PLEASE_LOGIN)
            .ctaTextPrefix(TcSdkOptions.CTA_TEXT_PREFIX_USE)
            .buttonShapeOptions(TcSdkOptions.BUTTON_SHAPE_ROUNDED)
            .privacyPolicyUrl("https://confessr.app/privacy")  // TODO: Update with actual URL
            .termsOfServiceUrl("https://confessr.app/terms")   // TODO: Update with actual URL
            .footerType(TcSdkOptions.FOOTER_TYPE_SKIP)
            .sdkOptions(TcSdkOptions.OPTION_VERIFY_ALL_USERS)
            .build();

        TcSdk.init(tcSdkOptions);
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
     * Start Truecaller verification flow with proper OAuth parameter setup
     *
     * CRITICAL: This method sets up OAuth parameters (state, scopes, code verifier,
     * code challenge) before initiating the flow. These MUST be set before each
     * call to getAuthorizationCode().
     *
     * @param activity Current activity context
     * @param callback Callback to receive verification results
     */
    public void verifyUser(Activity activity, TruecallerCallback callback) {
        this.callback = callback;

        if (!TcSdk.getInstance().isOAuthFlowUsable()) {
            callback.onFailure(-1, "Truecaller not available");
            return;
        }

        try {
            // Step 1: Generate and set OAuth state (for CSRF protection)
            currentState = new BigInteger(130, new SecureRandom()).toString(32);
            TcSdk.getInstance().setOAuthState(currentState);

            // Step 2: Set OAuth scopes (must match scopes selected in Truecaller console)
            TcSdk.getInstance().setOAuthScopes(new String[]{"profile", "phone", "openid"});

            // Step 3: Generate code verifier using SDK utility (for PKCE flow)
            currentCodeVerifier = CodeVerifierUtil.generateRandomCodeVerifier();

            // Step 4: Generate and set code challenge (SHA-256 hash of code verifier)
            String codeChallenge = CodeVerifierUtil.getCodeChallenge(currentCodeVerifier);
            if (codeChallenge == null) {
                callback.onFailure(-2, "Device doesn't support SHA-256. Cannot proceed with Truecaller verification.");
                return;
            }
            TcSdk.getInstance().setCodeChallenge(codeChallenge);

            // Step 5: Start OAuth authorization flow
            TcSdk.getInstance().getAuthorizationCode(activity);

        } catch (Exception e) {
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
     * @param activity Current activity context
     */
    public void handleActivityResult(int requestCode, int resultCode, Intent data, Activity activity) {
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
            if (callback != null) {
                // Validate state to prevent CSRF attacks
                String receivedState = tcOAuthData.getState();
                if (!currentState.equals(receivedState)) {
                    callback.onFailure(-4, "State mismatch. Possible CSRF attack detected.");
                    return;
                }

                // Return authorization code, state, and code verifier
                // Code verifier is needed for backend token exchange (PKCE flow)
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

