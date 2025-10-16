import { registerPlugin } from '@capacitor/core';

/**
 * Truecaller Authentication Plugin Interface
 * 
 * Provides Truecaller OAuth SDK 3.1.0 functionality to React/TypeScript.
 * 
 * IMPORTANT: OAuth SDK returns authorization code, not user profile directly.
 * You must exchange the authorization code for an access token via your backend.
 */
export interface TruecallerAuthPlugin {
  /**
   * Check if Truecaller is available on this device
   * Returns true if Truecaller app is installed and user is logged in
   * 
   * @returns Promise resolving to { available: boolean }
   */
  isAvailable(): Promise<{ available: boolean }>;

  /**
   * Start Truecaller verification flow
   * Opens Truecaller app for one-tap authentication
   *
   * IMPORTANT: Returns OAuth authorization code, NOT user profile.
   * You must send the authorization code AND code verifier to your backend
   * to exchange for an access token (PKCE flow) and fetch the user profile.
   *
   * @returns Promise resolving to:
   * {
   *   success: boolean,
   *   authorizationCode?: string,  // OAuth authorization code
   *   state?: string,               // OAuth state parameter for CSRF protection
   *   codeVerifier?: string         // PKCE code verifier (REQUIRED for token exchange)
   * }
   *
   * @throws Error if Truecaller verification fails
   */
  verifyWithTruecaller(): Promise<{
    success: boolean;
    authorizationCode?: string;
    state?: string;
    codeVerifier?: string;
  }>;
}

const TruecallerAuth = registerPlugin<TruecallerAuthPlugin>('TruecallerAuth', {
  web: () => {
    // Web implementation - Truecaller is not available on web
    return {
      isAvailable: async () => ({ available: false }),
      verifyWithTruecaller: async () => {
        throw new Error('Truecaller is only available on Android');
      },
    };
  },
});

export default TruecallerAuth;

