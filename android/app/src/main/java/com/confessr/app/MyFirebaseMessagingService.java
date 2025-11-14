package com.confessr.app;

import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.os.Build;
import android.util.Base64;
import android.util.Log;

import androidx.core.app.NotificationCompat;

import com.google.firebase.messaging.FirebaseMessagingService;
import com.google.firebase.messaging.RemoteMessage;

import net.zetetic.database.sqlcipher.SQLiteDatabase;

import java.io.File;
import java.util.Map;



/**
 * Native Firebase Messaging Service for handling FCM messages when app is dead/killed.
 * 
 * This service:
 * 1. Receives FCM messages even when app is completely dead
 * 2. Retrieves encryption key from SharedPreferences (stored by JS layer)
 * 3. Writes message data directly to encrypted SQLite using SQLCipher
 * 4. Shows system notification
 * 5. When tapped, opens app with message already in SQLite
 */
public class MyFirebaseMessagingService extends FirebaseMessagingService {
    private static final String TAG = "MyFCMService";
    
    @Override
    public void onCreate() {
        super.onCreate();
        Log.e(TAG, "🚨 MyFirebaseMessagingService CREATED 🚨");
    }
    private static final String CHANNEL_ID = "confessr_messages";
    private static final String CHANNEL_NAME = "Messages";
    private static final String PREFS_NAME = "CapacitorStorage";
    private static final String KEY_SQLITE_ENCRYPTION = "sqlite_encryption_key";

    static {
        // Load SQLCipher native library (bundled with CapacitorSQLite)
        System.loadLibrary("sqlcipher");
    }

    @Override
    public void onMessageReceived(RemoteMessage remoteMessage) {
        // CRITICAL: Log at ERROR level so it shows up even with filtered logcat
        Log.e(TAG, "🚨🚨🚨 FCM MESSAGE RECEIVED IN NATIVE SERVICE 🚨🚨🚨");
        Log.d(TAG, "📨 FCM message received in native service");
        
        // Get data payload
        Map<String, String> data = remoteMessage.getData();
        
        if (data.isEmpty()) {
            Log.w(TAG, "⚠️ Empty data payload, ignoring");
            return;
        }
        
        Log.d(TAG, "📦 Data payload size: " + data.size());
        
        // Extract message data
        String type = data.get("type");
        String messageId = data.get("message_id");
        String groupId = data.get("group_id");
        String content = data.get("content");
        String userId = data.get("user_id");
        String isGhost = data.get("is_ghost");
        String msgType = data.get("msg_type");
        String createdAt = data.get("created_at");
        String groupName = data.get("group_name");
        String category = data.get("category");
        String parentId = data.get("parent_id");
        String imageUrl = data.get("image_url");
        
        if (!"new_message".equals(type) || messageId == null || groupId == null) {
            Log.w(TAG, "⚠️ Invalid message data, ignoring");
            return;
        }
        
        Log.d(TAG, "✅ Valid message data: messageId=" + messageId + ", groupId=" + groupId);
        
        // Write to encrypted SQLite
        boolean success = writeMessageToEncryptedSQLite(
            messageId, groupId, userId, content, isGhost, msgType, 
            createdAt, category, parentId, imageUrl
        );
        
        if (success) {
            Log.d(TAG, "✅ Message written to encrypted SQLite successfully");
        } else {
            Log.w(TAG, "⚠️ Failed to write message to SQLite (will be synced when app opens)");
        }
        
        // Show notification
        showNotification(
            groupName != null ? groupName : "New message", 
            content != null ? content : "You have a new message",
            groupId,
            remoteMessage
        );
        
        Log.d(TAG, "✅ Notification shown");
    }

    /**
     * Get encryption key from SharedPreferences (stored by JS layer)
     */
    private String getEncryptionKey() {
        try {
            SharedPreferences prefs = getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE);
            String key = prefs.getString(KEY_SQLITE_ENCRYPTION, null);
            
            if (key == null) {
                Log.e(TAG, "❌ Encryption key not found in SharedPreferences");
                return null;
            }
            
            Log.d(TAG, "✅ Retrieved encryption key from SharedPreferences");
            return key;
            
        } catch (Exception e) {
            Log.e(TAG, "❌ Error retrieving encryption key: " + e.getMessage(), e);
            return null;
        }
    }

    /**
     * Write message directly to encrypted SQLite database using SQLCipher
     */
    private boolean writeMessageToEncryptedSQLite(
            String messageId, String groupId, String userId, String content,
            String isGhost, String msgType, String createdAt, String category,
            String parentId, String imageUrl) {
        
        SQLiteDatabase db = null;
        
        try {
            Log.d(TAG, "📝 Attempting to write message to encrypted SQLite: " + messageId);
            
            // Get encryption key
            String encryptionKey = getEncryptionKey();
            if (encryptionKey == null) {
                Log.w(TAG, "⚠️ No encryption key available");
                return false;
            }
            
            // Get database path
            // CapacitorSQLite adds "SQLite.db" suffix automatically
            File dbFile = getDatabasePath("confessr_dbSQLite.db");
            
            // Also try without suffix if first doesn't exist
            if (!dbFile.exists()) {
                dbFile = getDatabasePath("confessr_db");
            }
            
            if (!dbFile.exists()) {
                Log.w(TAG, "⚠️ Database file does not exist: " + dbFile.getAbsolutePath());
                Log.w(TAG, "⚠️ This is normal if app hasn't been opened yet");
                return false;
            }
            
            Log.d(TAG, "📂 Database path: " + dbFile.getAbsolutePath());
            
            // Open encrypted database with SQLCipher
            // SQLCipher 4.x uses byte[] for passphrase
            byte[] keyBytes = encryptionKey.getBytes("UTF-8");
            db = SQLiteDatabase.openOrCreateDatabase(
                dbFile,
                keyBytes,
                null,
                null
            );
            
            Log.d(TAG, "✅ Encrypted database opened successfully");
            
            // Prepare SQL statement
            String sql = "INSERT OR REPLACE INTO messages " +
                        "(id, group_id, user_id, content, is_ghost, message_type, created_at, category, parent_id, image_url) " +
                        "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)";
            
            // Execute insert
            db.execSQL(sql, new Object[]{
                messageId,
                groupId,
                userId,
                content,
                "true".equals(isGhost) ? 1 : 0,
                msgType != null ? msgType : "text",
                parseTimestamp(createdAt),
                category,
                parentId,
                imageUrl
            });
            
            Log.d(TAG, "✅ Message inserted successfully");
            return true;
            
        } catch (Exception e) {
            Log.e(TAG, "❌ Error writing to encrypted SQLite: " + e.getMessage(), e);
            return false;
        } finally {
            if (db != null && db.isOpen()) {
                db.close();
            }
        }
    }

    /**
     * Parse ISO timestamp to milliseconds
     */
    private long parseTimestamp(String timestamp) {
        if (timestamp == null) {
            return System.currentTimeMillis();
        }
        
        try {
            // Parse ISO 8601 timestamp
            java.text.SimpleDateFormat sdf = new java.text.SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss.SSS'Z'");
            sdf.setTimeZone(java.util.TimeZone.getTimeZone("UTC"));
            return sdf.parse(timestamp).getTime();
        } catch (Exception e) {
            Log.e(TAG, "❌ Error parsing timestamp: " + e.getMessage());
            return System.currentTimeMillis();
        }
    }

    /**
     * Show system notification
     */
    private void showNotification(String title, String body, String groupId, RemoteMessage remoteMessage) {
        NotificationManager notificationManager = 
            (NotificationManager) getSystemService(Context.NOTIFICATION_SERVICE);
        
        // Create notification channel (Android 8.0+)
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            NotificationChannel channel = new NotificationChannel(
                CHANNEL_ID,
                CHANNEL_NAME,
                NotificationManager.IMPORTANCE_HIGH
            );
            channel.setDescription("New messages");
            channel.enableVibration(true);
            notificationManager.createNotificationChannel(channel);
        }
        
        // Create intent to open app
        Intent intent = new Intent(this, MainActivity.class);
        intent.setFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP);
        intent.putExtra("group_id", groupId);
        
        PendingIntent pendingIntent = PendingIntent.getActivity(
            this,
            0,
            intent,
            PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE
        );
        
        // Build notification
        NotificationCompat.Builder builder = new NotificationCompat.Builder(this, CHANNEL_ID)
            .setSmallIcon(android.R.drawable.ic_dialog_info) // TODO: Use your app icon
            .setContentTitle(title)
            .setContentText(body)
            .setPriority(NotificationCompat.PRIORITY_HIGH)
            .setAutoCancel(true)
            .setContentIntent(pendingIntent);
        
        // Show notification
        notificationManager.notify((int) System.currentTimeMillis(), builder.build());
        
        Log.d(TAG, "✅ Notification shown");
    }

    @Override
    public void onNewToken(String token) {
        Log.d(TAG, "🔑 New FCM token: " + token.substring(0, Math.min(10, token.length())) + "...");
        // Token will be handled by JS layer
    }
}
