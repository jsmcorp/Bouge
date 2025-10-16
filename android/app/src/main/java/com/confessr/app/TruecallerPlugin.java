package com.confessr.app;

import android.content.Intent;
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
        truecallerManager = TruecallerManager.getInstance();
        truecallerManager.initialize(getActivity());
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
        boolean available = truecallerManager.isUsable();
        JSObject ret = new JSObject();
        ret.put("available", available);
        call.resolve(ret);
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

        truecallerManager.verifyUser(getActivity(), new TruecallerManager.TruecallerCallback() {
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
        truecallerManager.handleActivityResult(requestCode, resultCode, data, getActivity());
    }
}

