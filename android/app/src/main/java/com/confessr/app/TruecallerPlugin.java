package com.confessr.app;

import android.content.Intent;
import androidx.fragment.app.FragmentActivity;
import com.getcapacitor.*;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;

/**
 * TruecallerPlugin - Capacitor plugin for Truecaller OAuth SDK 3.1.0
 * 
 * Exposes Truecaller authentication functionality to JavaScript/TypeScript.
 * Bridges native Android Truecaller SDK with React frontend.
 */
@CapacitorPlugin(name = "TruecallerAuth")
public class TruecallerPlugin extends Plugin {
    
    private TruecallerManager truecallerManager;
    
    /**
     * Initialize plugin and Truecaller SDK
     * Called automatically when plugin is loaded
     */
    @Override
    public void load() {
        android.util.Log.d("TruecallerPlugin", "Plugin load() called");
        try {
            truecallerManager = TruecallerManager.getInstance();
            // BridgeActivity extends AppCompatActivity which extends FragmentActivity
            truecallerManager.initialize((FragmentActivity) getActivity());
            android.util.Log.d("TruecallerPlugin", "Plugin initialized successfully");
        } catch (Exception e) {
            android.util.Log.e("TruecallerPlugin", "Error initializing plugin", e);
        }
    }
    
    /**
     * Check if Truecaller is available on this device
     *
     * Returns:
     * {
     *   available: boolean
     * }
     */
    @PluginMethod
    public void isAvailable(PluginCall call) {
        android.util.Log.d("TruecallerPlugin", "isAvailable() called");
        try {
            if (truecallerManager == null) {
                android.util.Log.e("TruecallerPlugin", "TruecallerManager is null!");
                call.reject("TruecallerManager not initialized");
                return;
            }
            boolean available = truecallerManager.isUsable();
            android.util.Log.d("TruecallerPlugin", "Truecaller available: " + available);
            JSObject ret = new JSObject();
            ret.put("available", available);
            call.resolve(ret);
        } catch (Exception e) {
            android.util.Log.e("TruecallerPlugin", "Error checking availability", e);
            call.reject("Error checking Truecaller availability: " + e.getMessage());
        }
    }
    
    /**
     * Start Truecaller verification flow
     * Opens Truecaller app for one-tap authentication
     *
     * CRITICAL: Sets up OAuth parameters (state, scopes, code verifier, code challenge)
     * before initiating the flow. These are required for PKCE OAuth flow.
     *
     * Returns on success:
     * {
     *   success: true,
     *   authorizationCode: string,
     *   state: string,
     *   codeVerifier: string  // Required for backend token exchange
     * }
     *
     * Rejects on failure with error message
     */
    @PluginMethod
    public void verifyWithTruecaller(PluginCall call) {
        // Save call for later resolution in callback
        saveCall(call);

        truecallerManager.verifyUser((FragmentActivity) getActivity(), new TruecallerManager.TruecallerCallback() {
            @Override
            public void onSuccess(String authorizationCode, String state, String codeVerifier) {
                JSObject ret = new JSObject();
                ret.put("success", true);
                ret.put("authorizationCode", authorizationCode);
                ret.put("state", state);
                ret.put("codeVerifier", codeVerifier);  // CRITICAL: Needed for PKCE token exchange
                call.resolve(ret);
            }

            @Override
            public void onFailure(int errorCode, String errorMessage) {
                call.reject("Truecaller verification failed: " + errorMessage, String.valueOf(errorCode));
            }
        });
    }
    
    /**
     * Handle activity result from Truecaller SDK
     * Called automatically by Capacitor when activity returns
     */
    @Override
    protected void handleOnActivityResult(int requestCode, int resultCode, Intent data) {
        super.handleOnActivityResult(requestCode, resultCode, data);
        handleTruecallerActivityResult(requestCode, resultCode, data);
    }

    /**
     * Public method to handle Truecaller activity result
     * Called from MainActivity.onActivityResult() for request code 100
     */
    public void handleTruecallerActivityResult(int requestCode, int resultCode, Intent data) {
        android.util.Log.d("TruecallerPlugin", "handleTruecallerActivityResult called: requestCode=" + requestCode + ", resultCode=" + resultCode);
        truecallerManager.handleActivityResult(requestCode, resultCode, data, (FragmentActivity) getActivity());
    }
}

