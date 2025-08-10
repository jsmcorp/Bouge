import { Message } from './types';

export interface ThreadActions {
  openThread: (message: Message) => Promise<void>;
  closeThread: () => void;
  openThreadMobile: (groupId: string, messageId: string) => void;
}

export const createThreadActions = (set: any, get: any): ThreadActions => ({
  openThread: async (message: Message) => {
    try {
      set({ isThreadLoading: true, activeThread: message });

      const replies = await get().fetchReplies(message.id);
      set({ threadReplies: replies });
      set({ replyingTo: message });
    } catch (error) {
      console.error('Error opening thread:', error);
    } finally {
      set({ isThreadLoading: false });
    }
  },

  closeThread: () => {
    set({
      activeThread: null,
      threadReplies: [],
      replyingTo: null,
      isThreadLoading: false
    });
  },

  openThreadMobile: (groupId: string, messageId: string) => {
    // Find the message and set it as active thread
    const { messages } = get();
    const message = messages.find((m: Message) => m.id === messageId);
    if (message) {
      set({ activeThread: message });
      // Fetch replies if needed
      get().fetchReplies(messageId).then((replies: Message[]) => {
        set({ threadReplies: replies });
      });
    }

    // Ensure we're using the groupId parameter
    console.log(`Thread opened for message ${messageId} in group ${groupId}`);
  },
});