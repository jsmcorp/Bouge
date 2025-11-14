import { sqliteService } from '@/lib/sqliteService';
import { toast } from 'sonner';

export interface MessageSelectionActions {
  deleteSelectedMessages: () => Promise<void>;
  starSelectedMessages: () => Promise<void>;
  reportSelectedMessages: () => Promise<void>;
}

export const createMessageSelectionActions = (set: any, get: any): MessageSelectionActions => ({
  /**
   * Delete selected messages from local SQLite database
   * This ensures the user won't see these messages again
   * Note: Messages are only deleted locally, not from the server
   */
  deleteSelectedMessages: async () => {
    const { selectedMessageIds, activeGroup } = get();
    
    if (selectedMessageIds.size === 0) {
      toast.error('No messages selected');
      return;
    }

    if (!activeGroup?.id) {
      toast.error('No active group');
      return;
    }

    try {
      const messageIdsArray = Array.from(selectedMessageIds) as string[];
      
      console.log(`🗑️ Deleting ${messageIdsArray.length} messages locally...`);

      // 1. Delete from local SQLite (instant UI update)
      try {
        await sqliteService.deleteMessages(messageIdsArray);
        console.log(`✅ Deleted ${messageIdsArray.length} messages from SQLite`);
      } catch (error) {
        console.error('Failed to delete from SQLite:', error);
        toast.error('Failed to delete messages');
        return;
      }

      // 2. Update UI immediately (optimistic update)
      set((state: any) => ({
        messages: state.messages.filter((m: any) => !selectedMessageIds.has(m.id)),
        selectionMode: false,
        selectedMessageIds: new Set()
      }));

      toast.success(`Deleted ${messageIdsArray.length} message${messageIdsArray.length > 1 ? 's' : ''}`);

      // Note: We only delete locally. The messages will still exist on the server
      // and in other users' devices. This is a local "hide" operation.
      // To implement server-side deletion, you would need to:
      // 1. Add a soft-delete column to the messages table
      // 2. Update the message via supabasePipeline
      // 3. Handle the deletion in realtime subscriptions

    } catch (error) {
      console.error('Error deleting messages:', error);
      toast.error('Failed to delete messages');
    }
  },

  /**
   * Star/favorite selected messages (placeholder for future implementation)
   */
  starSelectedMessages: async () => {
    const { selectedMessageIds } = get();
    
    if (selectedMessageIds.size === 0) {
      toast.error('No messages selected');
      return;
    }

    // TODO: Implement starring functionality
    // This would involve:
    // 1. Creating a starred_messages table in Supabase
    // 2. Adding entries for each starred message
    // 3. Updating local SQLite cache
    // 4. Adding UI to view starred messages
    
    toast.info(`Starring ${selectedMessageIds.size} message${selectedMessageIds.size > 1 ? 's' : ''} (coming soon)`);
    
    // Exit selection mode
    set({ selectionMode: false, selectedMessageIds: new Set() });
  },

  /**
   * Report selected messages (placeholder for future implementation)
   */
  reportSelectedMessages: async () => {
    const { selectedMessageIds } = get();
    
    if (selectedMessageIds.size === 0) {
      toast.error('No messages selected');
      return;
    }

    // TODO: Implement reporting functionality
    // This would involve:
    // 1. Creating a message_reports table in Supabase
    // 2. Adding report entries with reason
    // 3. Notifying group admins
    // 4. Potentially auto-hiding reported messages
    
    toast.info(`Reporting ${selectedMessageIds.size} message${selectedMessageIds.size > 1 ? 's' : ''} (coming soon)`);
    
    // Exit selection mode
    set({ selectionMode: false, selectedMessageIds: new Set() });
  },
});
