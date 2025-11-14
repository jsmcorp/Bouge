package com.confessr.app;

import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.JSObject;

/**
 * Minimal Capacitor plugin to bridge native events to JS layer.
 * 
 * This plugin allows MyFirebaseMessagingService to notify the JS layer
 * when a new message is written to SQLite while the app is in foreground.
 */
@CapacitorPlugin(name = "NativeEvents")
public class NativeEventsPlugin extends Plugin {
    
    private static NativeEventsPlugin instance;
    
    @Override
    public void load() {
        super.load();
        instance = this;
    }
    
    /**
     * Static method to notify JS layer of a new message from native code.
     * Called by MyFirebaseMessagingService after writing to SQLite.
     */
    public static void notifyNewMessage(String groupId, String messageId) {
        if (instance != null) {
            JSObject data = new JSObject();
            data.put("groupId", groupId);
            data.put("messageId", messageId);
            instance.notifyListeners("nativeNewMessage", data);
        }
    }
    
    /**
     * Dummy method to keep Capacitor happy (plugins need at least one @PluginMethod)
     */
    @PluginMethod
    public void ping(PluginCall call) {
        call.resolve();
    }
}
