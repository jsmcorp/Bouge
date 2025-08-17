# Manual Test Guide for Offline Messaging

## Test Scenarios

### 1. Offline Text Messaging
**Steps:**
1. Open the application and join a group chat
2. Disconnect from the internet (disable WiFi/mobile data)
3. Verify the connection status shows "Disconnected - Messages may not send"
4. Type a text message in the input field
5. Click the send button

**Expected Results:**
- ✅ Message input field should remain enabled when disconnected
- ✅ Send button should be enabled for text messages
- ✅ Message should appear in the chat with "sent" status
- ✅ Message should be stored in local outbox for later sync

### 2. Image Upload Restrictions When Offline
**Steps:**
1. Ensure you're disconnected from the internet
2. Try to click the image upload button (camera icon)
3. Verify the button behavior

**Expected Results:**
- ✅ Image upload button should be disabled when disconnected
- ✅ Button should appear grayed out/non-interactive

### 3. Mixed Content (Text + Image) When Offline
**Steps:**
1. While online, select an image for upload
2. Add some text as a caption
3. Disconnect from the internet
4. Try to send the message

**Expected Results:**
- ✅ Send button should be disabled when trying to send image while offline
- ✅ User should not be able to send messages with images when disconnected

### 4. Connection Status Display
**Steps:**
1. Start online and verify no connection status is shown
2. Disconnect from internet
3. Observe the connection status indicator

**Expected Results:**
- ✅ When connected: No connection status banner
- ✅ When disconnected: Yellow banner with "Disconnected - Messages may not send"
- ✅ Banner should not block message sending functionality

### 5. Message Synchronization (Background Functionality)
**Steps:**
1. Send several text messages while offline
2. Reconnect to the internet
3. Wait for automatic synchronization
4. Check if messages appear on other devices/browser tabs

**Expected Results:**
- ✅ Messages sent offline should automatically sync when connection returns
- ✅ Messages should appear with proper timestamps and delivery status
- ✅ No duplicate messages should appear

## Verification Checklist

- [ ] Text messages can be sent when offline
- [ ] Image upload is properly disabled when offline  
- [ ] Connection status is clearly displayed
- [ ] Send button logic works correctly for different scenarios
- [ ] Messages sync properly when connection returns
- [ ] No errors in browser console during offline operations
- [ ] Ghost mode and confession messages work offline
- [ ] Reply functionality works offline

## Notes

The existing outbox system handles all the backend synchronization automatically. These UI changes simply remove the restrictions that were preventing users from accessing the already-implemented offline functionality.