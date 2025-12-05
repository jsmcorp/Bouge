/*
  # Topic Expiration Cron Job Setup
  
  This migration sets up a cron job to automatically clean up expired topics.
  The job runs hourly and calls the cleanup-expired-topics edge function.
  
  Note: This requires the pg_cron extension to be enabled in your Supabase project.
  For production deployment, you can also configure this via the Supabase dashboard:
  Database > Cron Jobs > Create a new cron job
*/

-- Enable pg_cron extension if not already enabled
CREATE EXTENSION IF NOT EXISTS pg_cron;

-- Schedule the cleanup job to run every hour
-- This calls the edge function via HTTP
SELECT cron.schedule(
  'cleanup-expired-topics-hourly',  -- Job name
  '0 * * * *',                       -- Cron expression: every hour at minute 0
  $$
  SELECT
    net.http_post(
      url := current_setting('app.settings.supabase_url') || '/functions/v1/cleanup-expired-topics',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'Authorization', 'Bearer ' || current_setting('app.settings.service_role_key')
      ),
      body := '{}'::jsonb
    ) as request_id;
  $$
);

-- Alternative: Direct RPC call (simpler, but doesn't provide HTTP logging)
-- Uncomment this and comment out the above if you prefer direct RPC calls
/*
SELECT cron.schedule(
  'cleanup-expired-topics-hourly',
  '0 * * * *',
  $$
  SELECT delete_expired_topics();
  $$
);
*/

-- View scheduled jobs
-- SELECT * FROM cron.job;

-- To unschedule the job (for testing or removal):
-- SELECT cron.unschedule('cleanup-expired-topics-hourly');

COMMENT ON EXTENSION pg_cron IS 'Cron-based job scheduler for PostgreSQL';
