# Cleanup Expired Topics Edge Function

This Supabase Edge Function automatically deletes expired topics from the database. It's designed to be called by a cron job that runs hourly.

## What It Does

1. Calls the `delete_expired_topics()` RPC function
2. Logs the number of topics deleted
3. Returns a JSON response with the deletion count

## Deployment

Deploy the function to Supabase:

```bash
supabase functions deploy cleanup-expired-topics
```

## Testing

### Manual Test (Local)

Start the local Supabase stack:

```bash
supabase start
```

Test the function locally:

```bash
curl -i --location --request POST 'http://127.0.0.1:54321/functions/v1/cleanup-expired-topics' \
  --header 'Authorization: Bearer YOUR_ANON_KEY' \
  --header 'Content-Type: application/json' \
  --data '{}'
```

### Manual Test (Production)

```bash
curl -i --location --request POST 'https://YOUR_PROJECT_REF.supabase.co/functions/v1/cleanup-expired-topics' \
  --header 'Authorization: Bearer YOUR_ANON_KEY' \
  --header 'Content-Type: application/json' \
  --data '{}'
```

## Cron Job Setup

The cron job is configured in the migration file `20251127_topic_expiration_cron.sql`.

### Option 1: Via Migration (Recommended)

The migration automatically sets up a cron job using pg_cron that runs every hour.

```sql
-- View scheduled jobs
SELECT * FROM cron.job;

-- View job run history
SELECT * FROM cron.job_run_details ORDER BY start_time DESC LIMIT 10;
```

### Option 2: Via Supabase Dashboard

1. Go to your Supabase project dashboard
2. Navigate to Database > Cron Jobs
3. Click "Create a new cron job"
4. Configure:
   - **Name**: cleanup-expired-topics-hourly
   - **Schedule**: `0 * * * *` (every hour)
   - **Command**: 
     ```sql
     SELECT delete_expired_topics();
     ```

### Option 3: Via External Cron Service

You can also use an external service like GitHub Actions, Vercel Cron, or any other cron service to call the edge function via HTTP.

Example GitHub Actions workflow:

```yaml
name: Cleanup Expired Topics
on:
  schedule:
    - cron: '0 * * * *'  # Every hour
jobs:
  cleanup:
    runs-on: ubuntu-latest
    steps:
      - name: Call cleanup function
        run: |
          curl -X POST \
            -H "Authorization: Bearer ${{ secrets.SUPABASE_SERVICE_ROLE_KEY }}" \
            -H "Content-Type: application/json" \
            https://YOUR_PROJECT_REF.supabase.co/functions/v1/cleanup-expired-topics
```

## Monitoring

Check the function logs in the Supabase dashboard:

1. Go to Edge Functions > cleanup-expired-topics
2. Click on "Logs" tab
3. Look for entries with tag `cleanup-expired-topics:success`

Example log entry:

```json
{
  "tag": "cleanup-expired-topics:success",
  "reqId": "abc123",
  "deletedCount": 5,
  "timestamp": "2024-11-27T10:00:00.000Z"
}
```

## Response Format

### Success Response

```json
{
  "success": true,
  "deletedCount": 5,
  "message": "Deleted 5 expired topic(s)"
}
```

### Error Response

```json
{
  "error": "Error message here"
}
```

## Requirements

- Supabase project with Edge Functions enabled
- `delete_expired_topics()` RPC function (created in migration `20251126_topics_backend_integration.sql`)
- pg_cron extension enabled (for cron job option)

## Notes

- The function uses the service role key for authentication
- Topics with `expires_at = NULL` are never deleted (they never expire)
- Deletion cascades to related data (messages, likes, read status)
- The function is idempotent - safe to call multiple times
