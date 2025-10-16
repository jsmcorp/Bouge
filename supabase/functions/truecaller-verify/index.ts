// Supabase Edge Function for Truecaller OAuth token exchange
// Exchanges authorization code for access token and creates/updates user in Supabase

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4';

// CORS helpers
const DEV_ORIGINS = (Deno.env.get('DEV_CORS_ORIGINS') || 'https://localhost,capacitor://localhost,http://localhost').split(',');
function buildCorsHeaders(origin: string | null): HeadersInit {
  const allowed = (origin && DEV_ORIGINS.includes(origin)) ? origin : '*';
  return {
    'Access-Control-Allow-Origin': allowed,
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Access-Control-Max-Age': '86400',
    'Vary': 'Origin'
  };
}

// Environment variables
const PROJECT_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const TRUECALLER_CLIENT_ID = Deno.env.get('TRUECALLER_CLIENT_ID') || 'ppahhdlivw5_ublvua1eg6xawmferfdcapccbtf9sg8';

// Truecaller API endpoints
const TRUECALLER_TOKEN_URL = 'https://oauth-account-noneu.truecaller.com/v1/token';
const TRUECALLER_USERINFO_URL = 'https://oauth-account-noneu.truecaller.com/v1/userinfo';

interface TruecallerVerifyRequest {
  authorizationCode: string;
  state: string;
  codeVerifier: string;  // CRITICAL: Required for PKCE flow
}

interface TruecallerTokenResponse {
  access_token: string;
  token_type: string;
  expires_in: number;
  scope: string;
}

interface TruecallerUserInfo {
  sub: string;           // Truecaller user ID
  name: string;          // Full name
  given_name?: string;   // First name
  family_name?: string;  // Last name
  phone_number: string;  // Verified phone number (E.164 format)
  phone_number_verified: boolean;
  email?: string;
  email_verified?: boolean;
  picture?: string;      // Profile picture URL
}

serve(async (req) => {
  const origin = req.headers.get('origin');
  const corsHeaders = buildCorsHeaders(origin);

  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  try {
    console.log('[Truecaller] Edge Function called - method:', req.method);
    console.log('[Truecaller] Headers:', Object.fromEntries(req.headers.entries()));

    // Parse request body
    const bodyText = await req.text();
    console.log('[Truecaller] Request body:', bodyText);

    const { authorizationCode, state, codeVerifier } = JSON.parse(bodyText) as TruecallerVerifyRequest;

    if (!authorizationCode || !codeVerifier) {
      console.error('[Truecaller] Missing parameters:', { authorizationCode: !!authorizationCode, codeVerifier: !!codeVerifier });
      return new Response(
        JSON.stringify({ error: 'Missing required parameters: authorizationCode and codeVerifier' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log('[Truecaller] Starting OAuth token exchange...');

    // Step 1: Exchange authorization code for access token using PKCE
    const tokenResponse = await fetch(TRUECALLER_TOKEN_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        client_id: TRUECALLER_CLIENT_ID,
        code: authorizationCode,
        code_verifier: codeVerifier,
        redirect_uri: 'https://confessr.app/callback',
      }),
    });

    if (!tokenResponse.ok) {
      const errorText = await tokenResponse.text();
      console.error('[Truecaller] Token exchange failed:', errorText);
      return new Response(
        JSON.stringify({ error: 'Token exchange failed', details: errorText }),
        { status: tokenResponse.status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const tokenData: TruecallerTokenResponse = await tokenResponse.json();
    console.log('[Truecaller] Token exchange successful');

    // Step 2: Fetch user profile from Truecaller using access token
    const userInfoResponse = await fetch(TRUECALLER_USERINFO_URL, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${tokenData.access_token}`,
      },
    });

    if (!userInfoResponse.ok) {
      const errorText = await userInfoResponse.text();
      console.error('[Truecaller] User info fetch failed:', errorText);
      return new Response(
        JSON.stringify({ error: 'Failed to fetch user info', details: errorText }),
        { status: userInfoResponse.status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const userInfo: TruecallerUserInfo = await userInfoResponse.json();
    console.log('[Truecaller] User info fetched:', userInfo.phone_number);

    // Validate phone number is verified
    if (!userInfo.phone_number_verified) {
      return new Response(
        JSON.stringify({ error: 'Phone number not verified by Truecaller' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Step 3: Create or update user in Supabase
    const db = createClient(PROJECT_URL, SERVICE_ROLE);

    // Check if user exists with this phone number
    const { data: existingUser, error: fetchError } = await db
      .from('users')
      .select('id, phone_number, display_name, avatar_url')  // FIXED: display_name
      .eq('phone_number', userInfo.phone_number)
      .single();

    if (fetchError && fetchError.code !== 'PGRST116') {
      console.error('[Truecaller] Error fetching user:', fetchError);
      return new Response(
        JSON.stringify({ error: 'Database error', details: fetchError.message }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    let userId: string;

    if (existingUser) {
      // User exists - update profile if needed
      userId = existingUser.id;
      console.log('[Truecaller] Existing user found:', userId);

      // Update display_name and avatar if not set
      const updates: any = {};
      if (!existingUser.display_name && userInfo.name) {  // FIXED: display_name
        updates.display_name = userInfo.name;  // FIXED: display_name
      }
      if (!existingUser.avatar_url && userInfo.picture) {
        updates.avatar_url = userInfo.picture;
      }

      if (Object.keys(updates).length > 0) {
        const { error: updateError } = await db
          .from('users')
          .update(updates)
          .eq('id', userId);

        if (updateError) {
          console.error('[Truecaller] Error updating user:', updateError);
        } else {
          console.log('[Truecaller] User profile updated');
        }
      }
    } else {
      // New user - create profile
      const { data: newUser, error: insertError } = await db
        .from('users')
        .insert({
          phone_number: userInfo.phone_number,
          display_name: userInfo.name || null,  // FIXED: display_name
          avatar_url: userInfo.picture || null,
          created_at: new Date().toISOString(),
        })
        .select('id')
        .single();

      if (insertError) {
        console.error('[Truecaller] Error creating user:', insertError);
        return new Response(
          JSON.stringify({ error: 'Failed to create user', details: insertError.message }),
          { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      userId = newUser.id;
      console.log('[Truecaller] New user created:', userId);
    }

    console.log('[Truecaller] User profile ready:', userId);

    // Step 5: Generate custom JWT for Truecaller user (bypass Supabase Auth entirely)
    // This is a simple base64-encoded token with user info
    // Frontend will store this and use it to identify the user
    const customToken = btoa(JSON.stringify({
      userId: userId,
      phoneNumber: userInfo.phone_number,
      displayName: userInfo.name,
      provider: 'truecaller',
      truecallerId: userInfo.sub,
      issuedAt: Date.now(),
      expiresAt: Date.now() + (30 * 24 * 60 * 60 * 1000), // 30 days
    }));

    console.log('[Truecaller] Custom JWT generated for user:', userId);

    // Step 6: Return success response with custom JWT and full user data
    // Frontend will store the token and user data, bypassing Supabase Auth
    return new Response(
      JSON.stringify({
        success: true,
        customAuth: true,  // Flag that this uses custom JWT, not Supabase Auth
        token: customToken,
        user: {
          id: userId,
          phone_number: userInfo.phone_number,
          display_name: userInfo.name,
          avatar_url: userInfo.picture || null,
          is_onboarded: existingUser?.is_onboarded || false,
          created_at: existingUser?.created_at || new Date().toISOString(),
        },
      }),
      {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      }
    );

  } catch (error) {
    console.error('[Truecaller] Unexpected error:', error);
    return new Response(
      JSON.stringify({
        error: 'Internal server error',
        details: error instanceof Error ? error.message : 'Unknown error'
      }),
      {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      }
    );
  }
});
