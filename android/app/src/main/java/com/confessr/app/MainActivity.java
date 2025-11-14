package com.confessr.app;

import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.content.Context;
import android.content.Intent;
import android.os.Build;
import android.os.Bundle;

import com.getcapacitor.BridgeActivity;
import com.getcapacitor.Plugin;
import getcapacitor.community.contacts.ContactsPlugin;

import java.util.ArrayList;

public class MainActivity extends BridgeActivity {

  private TruecallerPlugin truecallerPlugin;

  @Override
  public void onCreate(Bundle savedInstanceState) {
    registerPlugin(TruecallerPlugin.class);
    registerPlugin(ContactsPlugin.class);
    registerPlugin(NativeEventsPlugin.class);
    super.onCreate(savedInstanceState);
    createDefaultNotificationChannel();
  }

  @Override
  protected void onActivityResult(int requestCode, int resultCode, Intent data) {
    super.onActivityResult(requestCode, resultCode, data);

    // Forward Truecaller SDK result to TruecallerPlugin
    // Truecaller SDK uses request code 100 (TcSdk.SHARE_PROFILE_REQUEST_CODE)
    if (requestCode == 100) {
      android.util.Log.d("MainActivity", "Truecaller activity result received, forwarding to plugin");

      // Get the TruecallerPlugin instance and forward the result
      if (truecallerPlugin == null) {
        truecallerPlugin = (TruecallerPlugin) getBridge().getPlugin("TruecallerAuth").getInstance();
      }

      if (truecallerPlugin != null) {
        truecallerPlugin.handleTruecallerActivityResult(requestCode, resultCode, data);
      } else {
        android.util.Log.e("MainActivity", "TruecallerPlugin not found!");
      }
    }
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
