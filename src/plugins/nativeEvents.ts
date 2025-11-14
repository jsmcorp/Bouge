import { registerPlugin } from '@capacitor/core';

export interface NativeEventsPlugin {
  /**
   * Dummy method to keep Capacitor happy
   */
  ping(): Promise<void>;
  
  /**
   * Add listener for native new message events
   */
  addListener(
    eventName: 'nativeNewMessage',
    listenerFunc: (event: { groupId: string; messageId: string }) => void
  ): Promise<any>;
  
  /**
   * Remove all listeners for this plugin
   */
  removeAllListeners(): Promise<void>;
}

const NativeEvents = registerPlugin<NativeEventsPlugin>('NativeEvents');

export default NativeEvents;
