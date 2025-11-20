/// <reference types="vite/client" />

// Global window helpers for unread count management
interface Window {
  __updateUnreadCount?: (counts: Record<string, number>) => void;
  __incrementUnreadCount?: (groupId: string) => void;
}
