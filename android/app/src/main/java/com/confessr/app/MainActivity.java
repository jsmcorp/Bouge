package com.confessr.app;

import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.content.Context;
import android.os.Build;
import android.os.Bundle;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
  @Override
  protected void onCreate(Bundle savedInstanceState) {
    super.onCreate(savedInstanceState);

    // Register Truecaller plugin
    registerPlugin(TruecallerPlugin.class);

    createDefaultNotificationChannel();
  }

  private void createDefaultNotificationChannel() {
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
      String channelId = getString(R.string.default_notification_channel_id);
      String channelName = getString(R.string.default_notification_channel_name);
      NotificationManager nm = (NotificationManager) getSystemService(Context.NOTIFICATION_SERVICE);
      if (nm != null && nm.getNotificationChannel(channelId) == null) {
        NotificationChannel channel = new NotificationChannel(
          channelId,
          channelName,
          NotificationManager.IMPORTANCE_HIGH
        );
        channel.setDescription("Default notifications");
        nm.createNotificationChannel(channel);
      }
    }
  }
}
