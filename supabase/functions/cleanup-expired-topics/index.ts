// Deno Edge Function for cleaning up expired topics
// This function is designed to be called by a cron job (hourly)
// It calls the delete_expired_topics RPC function and logs the result

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4';

const PROJECT_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

const db = createClient(PROJECT_URL, SERVICE_ROLE);

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

serve(async (req: Request) => {
  const origin = req.headers.get('origin');
  const cors = buildCorsHeaders(origin);
  const reqId = (crypto as any).randomUUID ? (crypto as any).randomUUID() : Math.random().toString(36).slice(2);

  // Log request
  console.log(JSON.stringify({
    tag: 'cleanup-expired-topics:request',
    reqId,
    method: req.method,
    timestamp: new Date().toISOString()
  }));

  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: cors });
  }

  if (req.method !== 'POST') {
    return new Response('Method not allowed', { status: 405, headers: cors });
  }

  try {
    // Call the delete_expired_topics RPC function
    const { data, error } = await db.rpc('delete_expired_topics');

    if (error) {
      console.error(JSON.stringify({
        tag: 'cleanup-expired-topics:error',
        reqId,
        error: error.message,
        details: error.details,
        hint: error.hint
      }));

      return new Response(
        JSON.stringify({ error: error.message }),
        { status: 500, headers: { ...cors, 'Content-Type': 'application/json' } }
      );
    }

    const deletedCount = data || 0;

    // Log the result
    console.log(JSON.stringify({
      tag: 'cleanup-expired-topics:success',
      reqId,
      deletedCount,
      timestamp: new Date().toISOString()
    }));

    return new Response(
      JSON.stringify({
        success: true,
        deletedCount,
        message: `Deleted ${deletedCount} expired topic(s)`
      }),
      { status: 200, headers: { ...cors, 'Content-Type': 'application/json' } }
    );
  } catch (e) {
    console.error(JSON.stringify({
      tag: 'cleanup-expired-topics:exception',
      reqId,
      error: e instanceof Error ? e.message : String(e)
    }));

    return new Response(
      JSON.stringify({ error: 'Internal server error' }),
      { status: 500, headers: { ...cors, 'Content-Type': 'application/json' } }
    );
  }
});
