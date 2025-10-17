# Truecaller Integration - Quick Deployment Script
# Run this script to deploy and test Truecaller integration

Write-Host "🚀 Truecaller Integration - Quick Deployment" -ForegroundColor Cyan
Write-Host "=============================================" -ForegroundColor Cyan
Write-Host ""

# Step 1: Check environment variables
Write-Host "📋 Step 1: Checking environment variables..." -ForegroundColor Yellow

if (-not (Test-Path ".env.local")) {
    Write-Host "⚠️  .env.local not found. Creating from .env.example..." -ForegroundColor Yellow
    Copy-Item ".env.example" ".env.local"
    Write-Host "✅ Created .env.local - Please update with your actual values!" -ForegroundColor Green
    Write-Host ""
    Write-Host "Required variables:" -ForegroundColor Cyan
    Write-Host "  - VITE_SUPABASE_URL" -ForegroundColor White
    Write-Host "  - VITE_SUPABASE_ANON_KEY" -ForegroundColor White
    Write-Host "  - TRUECALLER_CLIENT_ID (already set)" -ForegroundColor White
    Write-Host ""
    $continue = Read-Host "Press Enter to continue after updating .env.local, or Ctrl+C to exit"
} else {
    Write-Host "✅ .env.local found" -ForegroundColor Green
}

Write-Host ""

# Step 2: Deploy Supabase Edge Function
Write-Host "📦 Step 2: Deploying Supabase Edge Function..." -ForegroundColor Yellow
Write-Host ""

$deployFunction = Read-Host "Deploy truecaller-verify function to Supabase? (y/n)"

if ($deployFunction -eq "y") {
    Write-Host "Deploying function..." -ForegroundColor Cyan
    
    # Check if supabase CLI is installed
    $supabaseInstalled = Get-Command npx -ErrorAction SilentlyContinue
    
    if ($supabaseInstalled) {
        # Deploy function
        npx supabase functions deploy truecaller-verify
        
        if ($LASTEXITCODE -eq 0) {
            Write-Host "✅ Function deployed successfully!" -ForegroundColor Green
            
            # Set environment variable
            Write-Host ""
            Write-Host "Setting environment variable..." -ForegroundColor Cyan
            npx supabase secrets set TRUECALLER_CLIENT_ID=ppahhdlivw5_ublvua1eg6xawmferfdcapccbtf9sg8
            
            if ($LASTEXITCODE -eq 0) {
                Write-Host "✅ Environment variable set!" -ForegroundColor Green
            } else {
                Write-Host "⚠️  Failed to set environment variable. Please set manually:" -ForegroundColor Yellow
                Write-Host "  npx supabase secrets set TRUECALLER_CLIENT_ID=ppahhdlivw5_ublvua1eg6xawmferfdcapccbtf9sg8" -ForegroundColor White
            }
        } else {
            Write-Host "❌ Function deployment failed. Please check your Supabase connection." -ForegroundColor Red
            Write-Host "   Run: npx supabase login" -ForegroundColor White
            Write-Host "   Then: npx supabase link --project-ref your-project-ref" -ForegroundColor White
        }
    } else {
        Write-Host "❌ Supabase CLI not found. Please install it first." -ForegroundColor Red
    }
} else {
    Write-Host "⏭️  Skipping function deployment" -ForegroundColor Yellow
}

Write-Host ""

# Step 3: Build web app
Write-Host "🔨 Step 3: Building web app..." -ForegroundColor Yellow
npm run build

if ($LASTEXITCODE -eq 0) {
    Write-Host "✅ Build successful!" -ForegroundColor Green
} else {
    Write-Host "❌ Build failed. Please check errors above." -ForegroundColor Red
    exit 1
}

Write-Host ""

# Step 4: Sync with Capacitor
Write-Host "🔄 Step 4: Syncing with Capacitor..." -ForegroundColor Yellow
npx cap sync android

if ($LASTEXITCODE -eq 0) {
    Write-Host "✅ Sync successful!" -ForegroundColor Green
} else {
    Write-Host "❌ Sync failed. Please check errors above." -ForegroundColor Red
    exit 1
}

Write-Host ""

# Step 5: Run on Android
Write-Host "📱 Step 5: Running on Android device..." -ForegroundColor Yellow
Write-Host ""

$runOnDevice = Read-Host "Run on connected Android device? (y/n)"

if ($runOnDevice -eq "y") {
    Write-Host "Launching app on Android device..." -ForegroundColor Cyan
    npx cap run android
} else {
    Write-Host "⏭️  Skipping device launch" -ForegroundColor Yellow
    Write-Host ""
    Write-Host "To run manually:" -ForegroundColor Cyan
    Write-Host "  npx cap run android" -ForegroundColor White
    Write-Host "  or" -ForegroundColor White
    Write-Host "  npx cap open android" -ForegroundColor White
}

Write-Host ""
Write-Host "=============================================" -ForegroundColor Cyan
Write-Host "✅ Deployment Complete!" -ForegroundColor Green
Write-Host "=============================================" -ForegroundColor Cyan
Write-Host ""
Write-Host "📖 Next Steps:" -ForegroundColor Yellow
Write-Host "  1. Open the app on your Android device" -ForegroundColor White
Write-Host "  2. Navigate to the Login screen" -ForegroundColor White
Write-Host "  3. Look for 'Continue with Truecaller' button" -ForegroundColor White
Write-Host "  4. Test the verification flow" -ForegroundColor White
Write-Host ""
Write-Host "📚 For detailed testing scenarios, see:" -ForegroundColor Yellow
Write-Host "  TRUECALLER_DEPLOYMENT_GUIDE.md" -ForegroundColor White
Write-Host ""
Write-Host "🐛 Debugging:" -ForegroundColor Yellow
Write-Host "  - Check Android logs: adb logcat | grep -i truecaller" -ForegroundColor White
Write-Host "  - Check Supabase function logs in dashboard" -ForegroundColor White
Write-Host "  - See TRUECALLER_DEPLOYMENT_GUIDE.md for common issues" -ForegroundColor White
Write-Host ""

