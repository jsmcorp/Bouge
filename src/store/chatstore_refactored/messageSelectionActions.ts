import { sqliteService } from '@/lib/sqliteService';
import { toast } from 'sonner';

// In-memory state for undo
interface PendingDeletion {
  messageIds: string[];
  messages: any[]; // Store full message objects for restoration
  timeoutId: NodeJS.Timeout;
  timestamp: number;
}

let pendingDeletion: PendingDeletion | null = null;

/**
 * Finalize deletion after 3-second undo window expires
 * Deletes from SQLite and creates tombstones
 */
async function finalizeDeletion(messageIds: string[]): Promise<void> {
  try {
    console.log(`🗑️ Finalizing deletion of ${messageIds.length} messages`);

    // 1. Delete from local SQLite
    await sqliteService.deleteMessages(messageIds);
    console.log(`✅ Deleted ${messageIds.length} messages from SQLite`);

    // 2. Create tombstones to prevent re-sync
    await sqliteService.markMessagesAsDeleted(messageIds);
    console.log(`🪦 Created tombstones for ${messageIds.length} messages`);

  } catch (error) {
    console.error('❌ Error finalizing deletion:', error);
  }
}

export interface MessageSelectionActions {
  deleteSelectedMessages: () => Promise<void>;
  undoDeleteMessages: () => Promise<void>;
  starSelectedMessages: () => Promise<void>;
  reportSelectedMessages: () => Promise<void>;
}

export const createMessageSelectionActions = (set: any, get: any): MessageSelectionActions => ({
  /**
   * Delete selected messages with 3-second undo window
   * Messages are hidden immediately but can be restored within 3 seconds
   * After 3 seconds, deletion is finalized with tombstone
   */
  deleteSelectedMessages: async () => {
    const { selectedMessageIds, activeGroup, messages } = get();
    
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
      
      // Store messages for potential undo
      const messagesToDelete = messages.filter((m: any) => selectedMessageIds.has(m.id));
      
      console.log(`🗑️ Preparing to delete ${messageIdsArray.length} messages (3s undo window)...`);

      // 1. Immediately hide from UI (optimistic)
      set((state: any) => ({
        messages: state.messages.filter((m: any) => !selectedMessageIds.has(m.id)),
        selectionMode: false,
        selectedMessageIds: new Set()
      }));

      // 2. Cancel any existing pending deletion
      if (pendingDeletion) {
        clearTimeout(pendingDeletion.timeoutId);
      }

      // 3. Set up new pending deletion with timeout
      pendingDeletion = {
        messageIds: messageIdsArray,
        messages: messagesToDelete,
        timeoutId: setTimeout(async () => {
          await finalizeDeletion(messageIdsArray);
          pendingDeletion = null;
        }, 3000),
        timestamp: Date.now()
      };

      // 4. Show undo toast
      toast.success(
        `Deleted ${messageIdsArray.length} message${messageIdsArray.length > 1 ? 's' : ''}`,
        {
          duration: 3000,
          action: {
            label: 'Undo',
            onClick: async () => {
              await get().undoDeleteMessages();
            }
          }
        }
      );

    } catch (error) {
      console.error('Error deleting messages:', error);
      toast.error('Failed to delete messages');
    }
  },

  /**
   * Undo message deletion within the 3-second window
   */
  undoDeleteMessages: async () => {
    if (!pendingDeletion) {
      console.log('⚠️ No pending deletion to undo');
      return;
    }

    try {
      console.log(`🔄 Undoing deletion of ${pendingDeletion.messageIds.length} messages`);

      // 1. Cancel timeout
      clearTimeout(pendingDeletion.timeoutId);

      // 2. Restore messages in UI
      set((state: any) => {
        const existingIds = new Set(state.messages.map((m: any) => m.id));
        const messagesToRestore = pendingDeletion!.messages.filter(
          (m: any) => !existingIds.has(m.id)
        );
        
        // Merge and sort by created_at
        const merged = [...state.messages, ...messagesToRestore];
        merged.sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());
        
        return { messages: merged };
      });

      // 3. Clear pending state
      const count = pendingDeletion.messageIds.length;
      pendingDeletion = null;

      toast.success(`Restored ${count} message${count > 1 ? 's' : ''}`);
    } catch (error) {
      console.error('Error undoing deletion:', error);
      toast.error('Failed to undo deletion');
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
