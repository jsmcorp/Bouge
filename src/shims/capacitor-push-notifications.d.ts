declare module '@capacitor/push-notifications' {
  export type ReceivePermission = 'granted' | 'denied' | 'prompt';
  export interface PermissionStatus { receive: ReceivePermission }
  export interface RegistrationToken { value?: string; token?: string }
  export const PushNotifications: {
    checkPermissions(): Promise<PermissionStatus>;
    requestPermissions(): Promise<PermissionStatus>;
    register(): Promise<void>;
    addListener(eventName: 'registration', listener: (token: RegistrationToken) => void): any;
  }
}

