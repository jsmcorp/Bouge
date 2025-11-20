@echo off
echo ========================================
echo Deploying Unread Count Inflation Fix
echo ========================================
echo.
echo This will:
echo 1. Upgrade mark_group_as_read to prevent backward-moving read pointer
echo 2. Upgrade get_all_unread_counts to use strict timestamp logic
echo.

REM Check if Supabase CLI is installed
where supabase >nul 2>nul
if %ERRORLEVEL% NEQ 0 (
    echo ERROR: Supabase CLI not found. Please install it first.
    echo Visit: https://supabase.com/docs/guides/cli
    pause
    exit /b 1
)

echo Applying migration...
supabase db push --db-url %SUPABASE_DB_URL%

if %ERRORLEVEL% EQU 0 (
    echo.
    echo ========================================
    echo ✅ Migration applied successfully!
    echo ========================================
    echo.
    echo The fix is now live. This should resolve:
    echo - Inflated unread counts on app restart
    echo - Counts jumping to wrong values after resume
    echo - Out-of-order requests causing "un-read" messages
    echo.
) else (
    echo.
    echo ========================================
    echo ❌ Migration failed
    echo ========================================
    echo.
    echo Please check the error above and try again.
    echo.
)

pause
