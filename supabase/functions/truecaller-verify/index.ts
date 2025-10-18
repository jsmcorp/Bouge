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

    // Step 3: Create Supabase admin client
    const supabase = createClient(PROJECT_URL, SERVICE_ROLE, {
      auth: { autoRefreshToken: false, persistSession: false }
    });

    // Step 4: Check if user exists in Supabase Auth
    const { data: { users: existingUsers } } = await supabase.auth.admin.listUsers();
    let authUser = existingUsers.find(u => u.phone === userInfo.phone_number);

    // Generate email: Use Truecaller email if available, otherwise generate from phone
    // Format: phone_digits@truecaller.confessr.app (e.g., 917744939966@truecaller.confessr.app)
    const phoneDigits = userInfo.phone_number.replace(/[^0-9]/g, '');
    const emailToUse = userInfo.email || `${phoneDigits}@truecaller.confessr.app`;

    if (!authUser) {
      console.log('[Truecaller] Creating new user in Supabase Auth...');

      // Create user with email (real from Truecaller OR generated)
      // Both phone_confirm and email_confirm are true - NO SMS/EMAIL sent!
      const { data: newUserData, error: createError } = await supabase.auth.admin.createUser({
        email: emailToUse,
        email_confirm: true,  // Mark email as verified - NO EMAIL sent!
        phone: userInfo.phone_number,
        phone_confirm: true,  // Mark phone as verified - NO SMS sent!
        user_metadata: {
          display_name: userInfo.name,
          avatar_url: userInfo.picture,
          truecaller_verified: true,
        },
      });

      if (createError) {
        console.error('[Truecaller] Error creating auth user:', createError);
        throw createError;
      }

      authUser = newUserData.user;
      console.log('[Truecaller] Auth user created:', authUser.id, 'with email:', emailToUse);

      // Create profile in users table
      const { error: profileError } = await supabase.from('users').insert({
        id: authUser.id,
        phone_number: userInfo.phone_number,
        display_name: userInfo.name,
        avatar_url: userInfo.picture,
        is_onboarded: false,
      });

      if (profileError) {
        console.error('[Truecaller] Error creating user profile:', profileError);
        // Don't fail - auth user is created, profile can be created later
      } else {
        console.log('[Truecaller] User profile created');
      }
    } else {
      console.log('[Truecaller] Existing auth user found:', authUser.id);

      // CRITICAL: Check if existing user has an email
      if (!authUser.email) {
        console.log('[Truecaller] Existing user has no email - adding email now...');

        // Update user to add email (required for generateLink)
        const { data: updatedUser, error: updateEmailError } = await supabase.auth.admin.updateUserById(
          authUser.id,
          {
            email: emailToUse,
            email_confirm: true,  // Mark as verified - NO EMAIL sent!
          }
        );

        if (updateEmailError) {
          console.error('[Truecaller] Error adding email to existing user:', updateEmailError);
          throw updateEmailError;
        }

        authUser = updatedUser.user;
        console.log('[Truecaller] Email added to existing user:', emailToUse);
      } else {
        console.log('[Truecaller] Existing user already has email:', authUser.email);
      }

      // Update user metadata
      const { error: updateError } = await supabase.auth.admin.updateUserById(
        authUser.id,
        {
          user_metadata: {
            display_name: userInfo.name,
            avatar_url: userInfo.picture,
            truecaller_verified: true,
          },
        }
      );

      if (updateError) {
        console.error('[Truecaller] Error updating user metadata:', updateError);
      }
    }

    // Step 5: Generate recovery link (NO EMAIL SENT!)
    console.log('[Truecaller] Generating recovery link for instant login...');

    // CRITICAL: Use the EXACT email that's in auth.users.email
    const emailForLink = authUser.email!;
    console.log('[Truecaller] Using email for recovery link:', emailForLink);

    const { data: linkData, error: linkError } = await supabase.auth.admin.generateLink({
      type: 'recovery',
      email: emailForLink,
    });

    if (linkError) {
      console.error('[Truecaller] Link generation error:', linkError);
      throw linkError;
    }

    // Extract the token from the recovery link
    const url = new URL(linkData.properties.action_link);
    const token = url.searchParams.get('token');
    const type = url.searchParams.get('type');

    if (!token) {
      throw new Error('No token in recovery link');
    }

    console.log('[Truecaller] Recovery link generated successfully');

    // Step 6: Fetch user profile for response
    const { data: userProfile } = await supabase
      .from('users')
      .select('is_onboarded')
      .eq('id', authUser.id)
      .single();

    // Step 7: Return token for frontend to create session
    return new Response(
      JSON.stringify({
        success: true,
        user: {
          id: authUser.id,
          phoneNumber: userInfo.phone_number,
          displayName: userInfo.name,
          avatarUrl: userInfo.picture,
          isOnboarded: userProfile?.is_onboarded || false,
        },
        // Frontend uses this token to create Supabase Auth session
        sessionToken: token,
        sessionType: type || 'recovery',
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
