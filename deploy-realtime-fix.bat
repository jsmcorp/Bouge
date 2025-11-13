@echo off
REM ============================================================================
REM DEPLOY REALTIME FIX FOR INSTANT MESSAGING
REM ============================================================================
REM This script applies the realtime migration to enable instant message delivery
REM ============================================================================

echo.
echo ============================================================================
echo DEPLOYING REALTIME FIX FOR INSTANT MESSAGING
echo ============================================================================
echo.

REM Check if Supabase CLI is installed
where supabase >nul 2>nul
if %ERRORLEVEL% NEQ 0 (
    echo ❌ ERROR: Supabase CLI not found
    echo.
    echo Please install Supabase CLI first:
    echo npm install -g supabase
    echo.
    pause
    exit /b 1
)

echo ✅ Supabase CLI found
echo.

REM Step 1: Link to Supabase project (if not already linked)
echo Step 1: Checking Supabase project link...
echo.
supabase link --project-ref your-project-ref 2>nul
if %ERRORLEVEL% EQU 0 (
    echo ✅ Project linked successfully
) else (
    echo ℹ️  Project already linked or link failed
)
echo.

REM Step 2: Apply the migration
echo Step 2: Applying realtime migration...
echo.
supabase db push
if %ERRORLEVEL% NEQ 0 (
    echo ❌ ERROR: Migration failed
    echo.
    echo Trying alternative method: Direct SQL execution
    echo.
    supabase db execute -f supabase/migrations/20251114_enable_realtime_messages.sql
    if %ERRORLEVEL% NEQ 0 (
        echo ❌ ERROR: Direct SQL execution also failed
        echo.
        echo Please apply the migration manually:
        echo 1. Go to Supabase Dashboard
        echo 2. Navigate to SQL Editor
        echo 3. Run the contents of: supabase/migrations/20251114_enable_realtime_messages.sql
        echo.
        pause
        exit /b 1
    )
)
echo ✅ Migration applied successfully
echo.

REM Step 3: Verify realtime is enabled
echo Step 3: Verifying realtime configuration...
echo.
echo Running verification query...
supabase db execute --query "SELECT tablename, 'Realtime enabled' as status FROM pg_publication_tables WHERE pubname = 'supabase_realtime' AND tablename = 'messages';"
echo.

REM Step 4: Instructions for testing
echo ============================================================================
echo ✅ REALTIME FIX DEPLOYED SUCCESSFULLY
echo ============================================================================
echo.
echo Next steps to test:
echo.
echo 1. Rebuild and deploy your app:
echo    npm run build
echo    npx cap sync
echo.
echo 2. Open the app on two devices
echo.
echo 3. Send a message from one device
echo.
echo 4. Check logs for: "📨 Realtime INSERT received"
echo.
echo 5. Verify message appears instantly (^< 100ms) on the other device
echo.
echo Expected behavior:
echo - Messages appear instantly like WhatsApp
echo - No delay waiting for FCM push notification
echo - Logs show realtime events being received
echo.
echo ============================================================================
echo.
pause
