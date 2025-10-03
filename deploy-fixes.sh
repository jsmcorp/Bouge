#!/bin/bash

# Deployment script for FCM notification fixes
# Root Causes #2, #3, #4, #6

echo "🚀 Deploying FCM Notification Fixes"
echo "===================================="
echo ""

# Step 1: Build the app
echo "📦 Step 1: Building app..."
npm run build
if [ $? -ne 0 ]; then
    echo "❌ Build failed!"
    exit 1
fi
echo "✅ Build complete"
echo ""

# Step 2: Sync with Android
echo "🔄 Step 2: Syncing with Android..."
npx cap sync android
if [ $? -ne 0 ]; then
    echo "❌ Sync failed!"
    exit 1
fi
echo "✅ Sync complete"
echo ""

# Step 3: Deploy Edge Function
echo "☁️  Step 3: Deploying Edge Function..."
npx supabase functions deploy push-fanout
if [ $? -ne 0 ]; then
    echo "❌ Edge Function deployment failed!"
    exit 1
fi
echo "✅ Edge Function deployed"
echo ""

echo "✅ All deployments complete!"
echo ""
echo "📱 Next steps:"
echo "1. Run: npx cap run android"
echo "2. Test foreground notifications"
echo "3. Test background notifications"
echo "4. Test killed app notifications"
echo "5. Check logs: adb logcat | grep 'push\\|FirebaseMessaging'"
echo ""
echo "🎯 Expected in logs:"
echo "  - [push] ✅✅✅ ALL LISTENERS REGISTERED SUCCESSFULLY ✅✅✅"
echo "  - [push] ✅ Listeners confirmed registered"
echo "  - [push] token received(firebase): AIzaSy..."
echo ""
echo "❌ Should NOT see:"
echo "  - No listeners found for event notificationReceived"
echo ""

