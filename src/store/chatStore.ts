import { create } from 'zustand';
import { supabase } from '@/lib/supabase';
import { Json } from '@/lib/supabase';
import { RealtimeChannel } from '@supabase/supabase-js';
import { sqliteService } from '@/lib/sqliteService';
import { Capacitor } from '@capacitor/core';
import { Network } from '@capacitor/network';

export interface Group {
  id: string;
  name: string;
  description: string | null;
  invite_code: string;
  created_by: string;
  created_at: string;
  avatar_url?: string | null;
}

export interface GroupMember {
  id: string;
  user_id: string;
  group_id: string;
  role: 'admin' | 'participant';
  joined_at: string;
  user: {
    display_name: string;
    phone_number: string;
    avatar_url: string | null;
  };
}

export interface GroupMedia {
  id: string;
  group_id: string;
  user_id: string;
  type: 'photo' | 'document' | 'link';
  url: string;
  name: string;
  uploaded_at: string;
  user: {
    display_name: string;
    avatar_url: string | null;
  };
}

export interface Poll {
  id: string;
  message_id: string;
  question: string;
  options: string[];
  created_at: string;
  closes_at: string;
  vote_counts: number[]; // Client-side computed
  total_votes: number; // Client-side computed
  user_vote?: number | null; // Client-side computed
  is_closed: boolean; // Client-side computed
}

export interface PollVote {
  poll_id: string;
  user_id: string;
  option_index: number;
  created_at: string;
}

export interface Message {
  id: string;
  group_id: string;
  user_id: string;
  content: string;
  is_ghost: boolean;
  message_type: string;
  category: string | null;
  parent_id: string | null;
  image_url: string | null;
  created_at: string;
  author?: {
    display_name: string;
    avatar_url: string | null;
  };
  reactions?: Reaction[];
  replies?: Message[];
  reply_count?: number;
  delivery_status?: 'sending' | 'sent' | 'delivered' | 'failed';
  poll?: Poll;
}

export interface Reaction {
  id: string;
  message_id: string;
  user_id: string;
  emoji: string;
}

export interface TypingUser {
  user_id: string;
  display_name: string;
  avatar_url: string | null;
  is_ghost: boolean;
}

interface ChatState {
  groups: Group[];
  activeGroup: Group | null;
  messages: Message[];
  polls: Poll[];
  userVotes: Record<string, number | null>;
  isLoadingPolls: boolean;
  mainChatGhostMode: boolean;
  threadGhostMode: boolean;
  isLoading: boolean;
  replyingTo: Message | null;
  activeThread: Message | null;
  threadReplies: Message[];
  isThreadLoading: boolean;
  typingUsers: TypingUser[];
  isConnected: boolean;
  connectionStatus: 'connecting' | 'connected' | 'disconnected' | 'reconnecting';
  realtimeChannel: RealtimeChannel | null;
  typingTimeout: NodeJS.Timeout | null;
  showGroupDetailsPanel: boolean;
  groupMembers: GroupMember[];
  groupMedia: GroupMedia[];
  uploadingFile: boolean;
  isLoadingGroupDetails: boolean;
  messageReactions: Record<string, Reaction[]>;
  online: boolean;
  outboxProcessorInterval: NodeJS.Timeout | null;
  setGroups: (groups: Group[]) => void;
  setActiveGroup: (group: Group | null) => void;
  setMessages: (messages: Message[]) => void;
  addMessage: (message: Message) => void;
  updateMessage: (messageId: string, updates: Partial<Message>) => void;
  setPolls: (polls: Poll[]) => void;
  addPoll: (poll: Poll) => void;
  updatePoll: (pollId: string, updates: Partial<Poll>) => void;
  setUserVotes: (votes: Record<string, number | null>) => void;
  setLoadingPolls: (loading: boolean) => void;
  toggleMainChatGhostMode: () => void;
  toggleThreadGhostMode: () => void;
  setLoading: (loading: boolean) => void;
  setReplyingTo: (message: Message | null) => void;
  setActiveThread: (message: Message | null) => void;
  setThreadReplies: (replies: Message[]) => void;
  setThreadLoading: (loading: boolean) => void;
  setTypingUsers: (users: TypingUser[]) => void;
  setConnectionStatus: (status: 'connecting' | 'connected' | 'disconnected' | 'reconnecting') => void;
  setShowGroupDetailsPanel: (show: boolean) => void;
  
  // Swipe gesture state
  activeSwipeMessageId: string | null;
  setActiveSwipeMessage: (messageId: string | null) => void;
  closeGroupDetailsPanel: () => void;
  setGroupMembers: (members: GroupMember[]) => void;
  setGroupMedia: (media: GroupMedia[]) => void;
  setLoadingGroupDetails: (loading: boolean) => void;
  setUploadingFile: (uploading: boolean) => void;
  addOrRemoveReaction: (messageId: string, emoji: string) => Promise<void>;
  fetchGroups: () => Promise<void>;
  fetchMessages: (groupId: string) => Promise<void>;
  fetchMessageById: (messageId: string) => Promise<Message | null>;
  fetchReplies: (messageId: string) => Promise<Message[]>;
  fetchGroupMembers: (groupId: string) => Promise<void>;
  fetchGroupMedia: (groupId: string) => Promise<void>;
  fetchPollsForGroup: (groupId: string) => Promise<void>;
  createPoll: (groupId: string, question: string, options: string[]) => Promise<Poll>;
  voteOnPoll: (pollId: string, optionIndex: number) => Promise<void>;
  sendMessage: (groupId: string, content: string, isGhost: boolean, messageType?: string, category?: string | null, parentId?: string | null, pollId?: string | null, imageFile?: File | null) => Promise<void>;
  createGroup: (name: string, description?: string) => Promise<Group>;
  joinGroup: (inviteCode: string) => Promise<void>;
  openThread: (message: Message) => Promise<void>;
  closeThread: () => void;
  openThreadMobile: (groupId: string, messageId: string) => void;
  openGroupDetailsMobile: (groupId: string) => void;
  addReaction: (messageId: string, emoji: string) => Promise<void>;
  removeReaction: (messageId: string, emoji: string) => Promise<void>;
  setupRealtimeSubscription: (groupId: string) => Promise<void>;
  cleanupRealtimeSubscription: () => void;
  sendTypingStatus: (isTyping: boolean, isGhost?: boolean) => void;
  handlePresenceSync: () => void;
  compressImage: (file: File, maxWidth?: number, maxHeight?: number, quality?: number) => Promise<Blob>;
  uploadFileToStorage: (file: File) => Promise<string>;
  generateUniqueFileName: (originalName: string, userId: string) => string;
  processOutbox: () => Promise<void>;
  setupNetworkListener: () => void;
  cleanupNetworkListener: () => void;
  setOnlineStatus: (status: boolean) => void;
  startOutboxProcessor: () => void;
  stopOutboxProcessor: () => void;
  syncMessageRelatedData: (groupId: string, messages: any[]) => Promise<void>;
  forceMessageSync: (groupId: string) => Promise<void>;
}

// Helper function to compress images
const compressImage = async (
  file: File, 
  maxWidth: number = 800, 
  maxHeight: number = 600, 
  quality: number = 0.8
): Promise<Blob> => {
  return new Promise((resolve) => {
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d')!;
    const img = new Image();
    
    img.onload = () => {
      // Calculate new dimensions while maintaining aspect ratio
      let { width, height } = img;
      
      if (width > height) {
        if (width > maxWidth) {
          height = (height * maxWidth) / width;
          width = maxWidth;
        }
      } else {
        if (height > maxHeight) {
          width = (width * maxHeight) / height;
          height = maxHeight;
        }
      }
      
      canvas.width = width;
      canvas.height = height;
      
      // Draw and compress
      ctx.drawImage(img, 0, 0, width, height);
      
      canvas.toBlob(
        (blob) => {
          resolve(blob!);
        },
        'image/jpeg',
        quality
      );
    };
    
    img.src = URL.createObjectURL(file);
  });
};
// Helper function to generate unique file names
const generateUniqueFileName = (originalName: string, userId: string): string => {
  const timestamp = Date.now();
  const randomString = Math.random().toString(36).substring(2, 8);
  const extension = originalName.split('.').pop() || 'jpg';
  return `${userId}/${timestamp}_${randomString}.${extension}`;
};

// Global variables for outbox processing
let outboxProcessorInterval: NodeJS.Timeout | null = null;

export const useChatStore = create<ChatState>((set, get) => ({
  groups: [],
  activeGroup: null,
  messages: [],
  polls: [],
  userVotes: {},
  isLoadingPolls: false,
  mainChatGhostMode: true,
  threadGhostMode: true,
  isLoading: false,
  replyingTo: null,
  activeThread: null,
  threadReplies: [],
  isThreadLoading: false,
  typingUsers: [],
  isConnected: false,
  connectionStatus: 'disconnected',
  realtimeChannel: null,
  typingTimeout: null,
  showGroupDetailsPanel: false,
  groupMembers: [],
  online: true, // Initialize the online property
  outboxProcessorInterval: null,
  
  // Swipe gesture state
  activeSwipeMessageId: null,
  setActiveSwipeMessage: (messageId) => set({ activeSwipeMessageId: messageId }),
  groupMedia: [],
  isLoadingGroupDetails: false,
  uploadingFile: false,
  messageReactions: {},
  
  setGroups: (groups) => set({ groups }),
  setActiveGroup: (group) => {
    const currentGroup = get().activeGroup;
    
    // Cleanup previous subscription
    if (currentGroup && currentGroup.id !== group?.id) {
      get().cleanupRealtimeSubscription();
    }
    
    set({ 
      activeGroup: group, 
      messages: [], 
      polls: [],
      userVotes: {},
      typingUsers: [],
      showGroupDetailsPanel: false,
      groupMembers: [],
      groupMedia: []
    });
    
    // Setup new subscription and fetch polls
    if (group) {
      get().setupRealtimeSubscription(group.id);
      get().fetchPollsForGroup(group.id);
    }
  },
  setMessages: (messages) => set({ messages }),
  addMessage: (message) => set((state) => ({ 
    messages: [...state.messages, message] 
  })),
  updateMessage: (messageId, updates) => set((state) => ({
    messages: state.messages.map(msg => 
      msg.id === messageId ? { ...msg, ...updates } : msg
    )
  })),
  setPolls: (polls) => set({ polls }),
  addPoll: (poll) => set((state) => ({ 
    polls: [...state.polls, poll] 
  })),
  updatePoll: (pollId, updates) => set((state) => ({
    polls: state.polls.map(poll => 
      poll.id === pollId ? { ...poll, ...updates } : poll
    ),
    // Also update the poll in messages
    messages: state.messages.map(msg => 
      msg.poll?.id === pollId ? { ...msg, poll: { ...msg.poll, ...updates } } : msg
    )
  })),
  setUserVotes: (votes) => set({ userVotes: votes }),
  setLoadingPolls: (loading) => set({ isLoadingPolls: loading }),
  toggleMainChatGhostMode: () => set((state) => ({ mainChatGhostMode: !state.mainChatGhostMode })),
  toggleThreadGhostMode: () => set((state) => ({ threadGhostMode: !state.threadGhostMode })),
  setLoading: (loading) => set({ isLoading: loading }),
  setReplyingTo: (message) => set({ replyingTo: message }),
  setActiveThread: (message) => set({ activeThread: message }),
  setThreadReplies: (replies) => set({ threadReplies: replies }),
  setThreadLoading: (loading) => set({ isThreadLoading: loading }),
  setTypingUsers: (users) => set({ typingUsers: users }),
  setConnectionStatus: (status) => set({ 
    connectionStatus: status,
    isConnected: status === 'connected'
  }),
  setShowGroupDetailsPanel: (show) => {
    set({ showGroupDetailsPanel: show });
    // Close thread panel when opening group details
    if (show) {
      set({ activeThread: null, threadReplies: [], replyingTo: null });
    }
  },
  setGroupMembers: (members) => set({ groupMembers: members }),
  setGroupMedia: (media) => set({ groupMedia: media }),
  setLoadingGroupDetails: (loading) => set({ isLoadingGroupDetails: loading }),
  setUploadingFile: (uploading) => set({ uploadingFile: uploading }),
  
  addOrRemoveReaction: async (messageId: string, emoji: string) => {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Not authenticated');

      const state = get();
      const currentReactions = state.messageReactions[messageId] || [];
      const existingReaction = currentReactions.find(r => r.user_id === user.id && r.emoji === emoji);

      if (existingReaction) {
        // Remove reaction
        await get().removeReaction(messageId, emoji);
      } else {
        // Add reaction
        await get().addReaction(messageId, emoji);
      }
    } catch (error) {
      console.error('Error toggling reaction:', error);
      throw error;
    }
  },

  compressImage: compressImage,
  
  generateUniqueFileName: generateUniqueFileName,
  
  uploadFileToStorage: async (file: File) => {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Not authenticated');

      console.log('📤 Starting file upload process...');
      console.log('📁 Original file:', file.name, 'Size:', (file.size / 1024 / 1024).toFixed(2), 'MB');
      
      // Compress the image
      const compressedBlob = await compressImage(file);
      console.log('🗜️ Compressed size:', (compressedBlob.size / 1024 / 1024).toFixed(2), 'MB');
      
      // Generate unique file name
      const fileName = generateUniqueFileName(file.name, user.id);
      console.log('📝 Generated file name:', fileName);
      
      // Upload to Supabase Storage
      const { data, error } = await supabase.storage
        .from('chat-media')
        .upload(fileName, compressedBlob, {
          contentType: 'image/jpeg',
          upsert: false,
        });

      if (error) {
        console.error('❌ Upload error:', error);
        throw error;
      }

      console.log('✅ Upload successful:', data.path);
      
      // Get public URL
      const { data: { publicUrl } } = supabase.storage
        .from('chat-media')
        .getPublicUrl(data.path);

      console.log('🔗 Public URL:', publicUrl);
      return publicUrl;
      
    } catch (error) {
      console.error('💥 File upload failed:', error);
      throw error;
    }
  },
  
  setupRealtimeSubscription: async (groupId: string) => {
    console.log('🔄 Setting up realtime subscription for group:', groupId);
    
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;

      // Cleanup existing subscription
      get().cleanupRealtimeSubscription();
      
      set({ connectionStatus: 'connecting' });
      
      // Create new channel for this group
      const channel = supabase.channel(`group-${groupId}`, {
        config: {
          presence: {
            key: user.id,
          },
        },
      });

      // Subscribe to message inserts
      channel
        .on(
          'postgres_changes',
          {
            event: 'INSERT',
            schema: 'public',
            table: 'messages',
            filter: `group_id=eq.${groupId}`,
          },
          async (payload) => {
            console.log('📨 New message received:', payload.new);
            
            // Fetch the complete message with author info
            const { data: messageData, error } = await supabase
              .from('messages')
              .select(`
                *,
                reactions(*),
                users!messages_user_id_fkey(display_name, avatar_url)
              `)
              .eq('id', payload.new.id)
              .single();

            if (error) {
              console.error('Error fetching new message:', error);
              return;
            }

            // If this is a poll message, fetch the poll data
            let pollData = null;
            if (messageData.message_type === 'poll') {
              const { data: poll } = await supabase
                .from('polls')
                .select('*')
                .eq('message_id', messageData.id)
                .single();
              
              if (poll) {
                // Fetch vote counts
                const { data: votes } = await supabase
                  .from('poll_votes')
                  .select('option_index')
                  .eq('poll_id', poll.id);

                const pollOptions = poll.options as string[];
                const voteCounts = new Array(pollOptions.length).fill(0);
                votes?.forEach(vote => {
                  if (vote.option_index < voteCounts.length) {
                    voteCounts[vote.option_index]++;
                  }
                });

                // Check user's vote
                const { data: userVote } = await supabase
                  .from('poll_votes')
                  .select('option_index')
                  .eq('poll_id', poll.id)
                  .eq('user_id', user.id)
                  .maybeSingle();

                pollData = {
                  ...poll,
                  options: pollOptions,
                  vote_counts: voteCounts,
                  total_votes: votes?.length || 0,
                  user_vote: userVote?.option_index ?? null,
                  is_closed: new Date(poll.closes_at) < new Date(),
                } as Poll;

                // Add poll to store
                get().addPoll(pollData);
                
                // Update user votes
                const currentVotes = get().userVotes;
                set({ userVotes: { ...currentVotes, [poll.id]: userVote?.option_index ?? null } });
              }
            }

            const formattedMessage = {
              ...messageData,
              author: messageData.is_ghost ? undefined : messageData.users,
              reply_count: 0,
              replies: [],
              delivery_status: 'delivered' as const,
              poll: pollData,
            };

            const state = get();
            
            // Check if this is a reply to an existing message
            if (messageData.parent_id) {
              // Check if reply already exists in parent's replies
              const parentMessage = state.messages.find(msg => msg.id === messageData.parent_id);
              const replyExists = parentMessage?.replies?.some(reply => reply.id === messageData.id);
              
              if (!replyExists) {
                // Update parent message's reply count and inline replies
                const updatedMessages = state.messages.map(msg => {
                  if (msg.id === messageData.parent_id) {
                    return {
                      ...msg,
                      reply_count: (msg.reply_count || 0) + 1,
                      replies: [...(msg.replies || []), formattedMessage].slice(0, 3),
                    };
                  }
                  return msg;
                });
                set({ messages: updatedMessages });
              }

              // Update thread replies if this thread is currently open
              if (state.activeThread?.id === messageData.parent_id) {
                const threadReplyExists = state.threadReplies.some(reply => reply.id === messageData.id);
                if (!threadReplyExists) {
                  set({ threadReplies: [...state.threadReplies, formattedMessage] });
                }
              }
            } else {
              // Add as main message if it's not already in the list
              const messageExists = state.messages.some(msg => msg.id === messageData.id);
              if (!messageExists) {
                get().addMessage(formattedMessage);
              } else {
                // Update delivery status if message exists
                get().updateMessage(messageData.id, { delivery_status: 'delivered' });
              }
            }
          }
        )
        // Subscribe to poll inserts
        .on(
          'postgres_changes',
          {
            event: 'INSERT',
            schema: 'public',
            table: 'polls',
          },
          async (payload) => {
            console.log('📊 New poll received:', payload.new);
            
            // Fetch complete poll data with vote counts
            const poll = payload.new;
            
            // Check if this poll belongs to the current group
            const { data: message } = await supabase
              .from('messages')
              .select('group_id')
              .eq('id', poll.message_id)
              .single();
            
            if (!message || message.group_id !== groupId) return;
            
            const { data: votes } = await supabase
              .from('poll_votes')
              .select('option_index')
              .eq('poll_id', poll.id);

            const pollOptions = poll.options as string[];
            const voteCounts = new Array(pollOptions.length).fill(0);
            votes?.forEach(vote => {
              if (vote.option_index < voteCounts.length) {
                voteCounts[vote.option_index]++;
              }
            });

            const { data: userVote } = await supabase
              .from('poll_votes')
              .select('option_index')
              .eq('poll_id', poll.id)
              .eq('user_id', user.id)
              .maybeSingle();

            const pollData = {
              ...poll,
              options: pollOptions,
              vote_counts: voteCounts,
              total_votes: votes?.length || 0,
              user_vote: userVote?.option_index ?? null,
              is_closed: new Date(poll.closes_at) < new Date(),
            } as Poll;

            // Check if poll already exists
            const state = get();
            const pollExists = state.polls.some(p => p.id === poll.id);
            
            if (!pollExists) {
              get().addPoll(pollData);
            }
            
            // Update user votes
            const currentVotes = get().userVotes;
            set({ userVotes: { ...currentVotes, [poll.id]: userVote?.option_index ?? null } });

            // Update the corresponding message with poll data
            const updatedMessages = state.messages.map(msg => {
              if (msg.id === poll.message_id) {
                return { ...msg, poll: pollData };
              }
              return msg;
            });
            set({ messages: updatedMessages });
          }
        )
        // Subscribe to poll vote inserts
        .on(
          'postgres_changes',
          {
            event: 'INSERT',
            schema: 'public',
            table: 'poll_votes',
          },
          async (payload) => {
            console.log('🗳️ New vote received:', payload.new);
            
            const vote = payload.new;
            const state = get();
            
            // Skip updating vote counts if this is the current user's vote
            // (already handled by optimistic update)
            if (vote.user_id === user.id) {
              console.log('🔄 Skipping vote count update for current user (optimistic update already applied)');
              return;
            }
            
            // Update poll vote counts in both polls array and messages
            const updatedPolls = state.polls.map(poll => {
              if (poll.id === vote.poll_id) {
                const newVoteCounts = [...(poll.vote_counts || [])];
                if (vote.option_index < newVoteCounts.length) {
                  newVoteCounts[vote.option_index]++;
                }
                
                return {
                  ...poll,
                  vote_counts: newVoteCounts,
                  total_votes: (poll.total_votes || 0) + 1,
                };
              }
              return poll;
            });
            
            // Update messages with poll data
            const updatedMessages = state.messages.map(msg => {
              if (msg.poll?.id === vote.poll_id) {
                const newVoteCounts = [...(msg.poll?.vote_counts || [])];
                if (vote.option_index < newVoteCounts.length) {
                  newVoteCounts[vote.option_index]++;
                }
                
                return {
                  ...msg,
                  poll: {
                    ...msg.poll,
                    vote_counts: newVoteCounts,
                    total_votes: (msg.poll?.total_votes || 0) + 1,
                  }
                };
              }
              return msg;
            });
            
            set({ polls: updatedPolls, messages: updatedMessages as Message[] });
          }
        )
        .on('presence', { event: 'sync' }, () => {
          get().handlePresenceSync();
        })
        .on('presence', { event: 'join' }, ({ key, newPresences }) => {
          console.log('👋 User joined:', key, newPresences);
          get().handlePresenceSync();
        })
        .on('presence', { event: 'leave' }, ({ key, leftPresences }) => {
          console.log('👋 User left:', key, leftPresences);
          get().handlePresenceSync();
        })
        .subscribe(async (status) => {
          console.log('📡 Subscription status:', status);
          
          if (status === 'SUBSCRIBED') {
            set({ 
              connectionStatus: 'connected',
              realtimeChannel: channel 
            });
            console.log('✅ Successfully subscribed to realtime updates');
          } else if (status === 'CHANNEL_ERROR') {
            set({ connectionStatus: 'disconnected' });
            console.error('❌ Channel subscription error');
            
            // Attempt to reconnect after 3 seconds
            setTimeout(() => {
              console.log('🔄 Attempting to reconnect...');
              get().setupRealtimeSubscription(groupId);
            }, 3000);
          } else if (status === 'TIMED_OUT') {
            set({ connectionStatus: 'reconnecting' });
            console.warn('⏰ Subscription timed out, reconnecting...');
          }
        });

    } catch (error) {
      console.error('💥 Error setting up realtime subscription:', error);
      set({ connectionStatus: 'disconnected' });
    }
  },

  cleanupRealtimeSubscription: () => {
    const { realtimeChannel, typingTimeout } = get();
    
    if (typingTimeout) {
      clearTimeout(typingTimeout);
    }
    
    if (realtimeChannel) {
      console.log('🧹 Cleaning up realtime subscription');
      supabase.removeChannel(realtimeChannel);
      set({ 
        realtimeChannel: null, 
        connectionStatus: 'disconnected',
        typingUsers: [],
        typingTimeout: null
      });
    }
  },

  sendTypingStatus: (isTyping: boolean, isGhost = false) => {
    const { realtimeChannel, activeGroup, typingTimeout } = get();
    
    if (!realtimeChannel || !activeGroup) return;

    // Clear existing timeout
    if (typingTimeout) {
      clearTimeout(typingTimeout);
    }

    if (isTyping) {
      // Send typing status
      realtimeChannel.track({
        is_typing: true,
        is_ghost: isGhost,
        timestamp: Date.now(),
      });

      // Auto-stop typing after 3 seconds of inactivity
      const timeout = setTimeout(() => {
        get().sendTypingStatus(false, isGhost);
      }, 3000);
      
      set({ typingTimeout: timeout });
    } else {
      // Send stop typing status
      realtimeChannel.track({
        is_typing: false,
        is_ghost: isGhost,
        timestamp: Date.now(),
      });
      
      set({ typingTimeout: null });
    }
  },

  handlePresenceSync: () => {
    const { realtimeChannel } = get();
    if (!realtimeChannel) return;

    const presenceState = realtimeChannel.presenceState();
    const typingUsers: TypingUser[] = [];

    Object.entries(presenceState).forEach(([userId, presences]) => {
      const presence = presences[0] as any;
      if (presence?.is_typing) {
        // Get user info from our current user data or fetch it
        // For now, we'll use a simplified approach
        typingUsers.push({
          user_id: userId,
          display_name: presence.is_ghost ? 'Ghost' : 'User',
          avatar_url: null,
          is_ghost: presence.is_ghost || false,
        });
      }
    });

    set({ typingUsers });
  },
  
  fetchGroups: async () => {
    try {
      set({ isLoading: true });
      
      // Check if we're on a native platform with SQLite available
      const isNative = Capacitor.isNativePlatform();
      const isSqliteReady = isNative && await sqliteService.isReady();
      
      // ALWAYS load from local storage first if SQLite is available
      let localDataLoaded = false;
      if (isSqliteReady) {
        console.log('📱 Loading groups from local storage first (local-first approach)');
        try {
          const localGroups = await sqliteService.getGroups();
          if (localGroups && localGroups.length > 0) {
            // Convert LocalGroup to Group
            const groups: Group[] = localGroups.map(lg => ({
              id: lg.id,
              name: lg.name,
              description: null,
              invite_code: 'offline',
              created_by: '',
              created_at: new Date().toISOString(),
              avatar_url: null
            }));
            
            // Update UI with local data immediately
            set({ groups, isLoading: false });
            console.log(`✅ Loaded ${groups.length} groups from local storage`);
            localDataLoaded = true;
            
            // After displaying local data, check if we should sync in background
            const networkStatus = await Network.getStatus();
            const isOnline = networkStatus.connected;
            
            if (!isOnline) {
              // If offline, we're done
              return;
            }
            
            // Continue with background sync if online
            console.log('🔄 Background syncing groups with Supabase...');
          }
        } catch (error) {
          console.error('❌ Error loading groups from local storage:', error);
        }
      }
      
      // If we've already loaded data from local storage, don't show loading indicator for remote fetch
      if (!localDataLoaded) {
        set({ isLoading: true });
      }
      
      // Check network status
      const networkStatus = await Network.getStatus();
      const isOnline = networkStatus.connected;
      
      // If offline and we couldn't load from local storage, show empty state
      if (!isOnline) {
        console.log('📵 Offline and no local group data available');
        if (!localDataLoaded) {
          set({ groups: [], isLoading: false });
        }
        return;
      }
      
      // If we're online, fetch from Supabase
      console.log('🌐 Fetching groups from Supabase...');
      
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Not authenticated');

      const { data: memberGroups, error: memberError } = await supabase
        .from('group_members')
        .select('group_id')
        .eq('user_id', user.id);

      if (memberError) throw memberError;

      if (!memberGroups || memberGroups.length === 0) {
        if (!localDataLoaded) {
          set({ groups: [], isLoading: false });
        }
        return;
      }

      const groupIds = memberGroups.map(mg => mg.group_id);

      const { data: groups, error: groupsError } = await supabase
        .from('groups')
        .select('*')
        .in('id', groupIds);

      if (groupsError) throw groupsError;

      // Update UI with remote data only if we didn't already show local data
      if (!localDataLoaded) {
        set({ groups: groups || [], isLoading: false });
      }
      
      // If SQLite is available, sync groups to local storage
      if (isSqliteReady) {
        try {
          for (const group of groups || []) {
            await sqliteService.saveGroup({
              id: group.id,
              name: group.name,
              description: group.description || null,
              invite_code: group.invite_code || 'offline',
              created_by: group.created_by || '',
              created_at: new Date(group.created_at).getTime(),
              last_sync_timestamp: Date.now(),
              avatar_url: group.avatar_url || null,
              is_archived: 0
            });
          }
          console.log(`🔄 Synced ${groups?.length || 0} groups to local storage`);
        } catch (error) {
          console.error('❌ Error syncing groups to local storage:', error);
        }
      }
    } catch (error) {
      console.error('Error fetching groups:', error);
      set({ groups: [], isLoading: false });
    }
  },

  fetchMessages: async (groupId: string) => {
    try {
      console.log('🔄 Fetching messages for group:', groupId);
      set({ isLoading: true });
      
      // Check if we're on a native platform with SQLite available
      const isNative = Capacitor.isNativePlatform();
      const isSqliteReady = isNative && await sqliteService.isReady();
      
      // ALWAYS load from local storage first if SQLite is available
      let localDataLoaded = false;
      if (isSqliteReady) {
        console.log('📱 Loading messages from local storage first (local-first approach)');
        try {
          const localMessages = await sqliteService.getMessages(groupId);
          
          if (localMessages && localMessages.length > 0) {
            // Convert local messages to the format expected by the UI
            const messages = await Promise.all(localMessages.map(async (msg) => {
              // Get user info from local storage
              let author = undefined;
              if (!msg.is_ghost) {
                const user = await sqliteService.getUser(msg.user_id);
                if (user) {
                  author = {
                    display_name: user.display_name,
                    avatar_url: null
                  };
                }
              }
              
              // Build basic message object
              const message: Message = {
                id: msg.id,
                group_id: msg.group_id,
                user_id: msg.user_id,
                content: msg.content,
                is_ghost: msg.is_ghost === 1,
                message_type: msg.message_type,
                category: msg.category,
                parent_id: msg.parent_id,
                image_url: msg.image_url,
                created_at: new Date(msg.created_at).toISOString(),
                author: author,
                reply_count: 0,
                replies: [],
                delivery_status: 'delivered' as const,
                reactions: [],
                poll: undefined
              };
              
              // Handle polls for poll messages
              if (msg.message_type === 'poll') {
                try {
                  const polls = await sqliteService.getPolls([msg.id]);
                  if (polls.length > 0) {
                    const poll = polls[0];
                    const votes = await sqliteService.getPollVotes([poll.id]);
                    
                    message.poll = {
                      id: poll.id,
                      message_id: poll.message_id,
                      question: poll.question,
                      options: JSON.parse(poll.options),
                      created_at: new Date(poll.created_at).toISOString(),
                      closes_at: new Date(poll.closes_at).toISOString(),
                      vote_counts: [],
                      total_votes: votes.length,
                      user_vote: undefined,
                      is_closed: new Date(poll.closes_at).getTime() < Date.now()
                    };
                  }
                } catch (error) {
                  console.error('Error loading poll from local storage:', error);
                }
              }
              
              return message;
            }));
            
            // Update UI with local data immediately
            set({ messages, isLoading: false });
            console.log(`✅ Loaded ${messages.length} messages from local storage`);
            localDataLoaded = true;
          }
        } catch (error) {
          console.error('❌ Error loading messages from local storage:', error);
        }
      }
      
      // If we've already loaded data from local storage, don't show loading indicator for remote fetch
      if (localDataLoaded) {
        set({ isLoading: false });
      }
      
      // Check network status
      const networkStatus = await Network.getStatus();
      const isOnline = networkStatus.connected;
      
      // If offline and we couldn't load from local storage, show empty state
      if (!isOnline) {
        console.log('📵 Offline and no local data available');
        if (!localDataLoaded) {
          set({ messages: [], isLoading: false });
        }
        return;
      }
      
      // If we're online, fetch from Supabase
      console.log('🌐 Fetching messages from Supabase...');
      const { data, error } = await supabase
        .from('messages')
        .select(`
          *,
          reactions(*),
          users!messages_user_id_fkey(display_name, avatar_url)
        `)
        .eq('group_id', groupId)
        .is('parent_id', null)
        .order('created_at', { ascending: true });

      if (error) throw error;
      
      const messages = await Promise.all((data || []).map(async (msg) => {
        const { count: replyCount } = await supabase
          .from('messages')
          .select('*', { count: 'exact', head: true })
          .eq('parent_id', msg.id);

        const { data: replies } = await supabase
          .from('messages')
          .select(`
            *,
            reactions(*),
            users!messages_user_id_fkey(display_name, avatar_url)
          `)
          .eq('parent_id', msg.id)
          .order('created_at', { ascending: true })
          .limit(3);

        const formattedReplies = (replies || []).map((reply) => ({
          ...reply,
          author: reply.is_ghost ? undefined : reply.users,
          reply_count: 0,
          delivery_status: 'delivered' as const,
        }));

        // Fetch poll data if this is a poll message
        let pollData = null;
        if (msg.message_type === 'poll') {
          const { data: poll } = await supabase
            .from('polls')
            .select('*')
            .eq('message_id', msg.id)
            .single();
          
          if (poll) {
            // Fetch vote counts
            const { data: votes } = await supabase
              .from('poll_votes')
              .select('option_index')
              .eq('poll_id', poll.id);

            const pollOptions = poll.options as string[];
            const voteCounts = new Array(pollOptions.length).fill(0);
            votes?.forEach(vote => {
              if (vote.option_index < voteCounts.length) {
                voteCounts[vote.option_index]++;
              }
            });

            // Check user's vote
            const { data: { user } } = await supabase.auth.getUser();
            const { data: userVote } = await supabase
              .from('poll_votes')
              .select('option_index')
              .eq('poll_id', poll.id)
              .eq('user_id', user?.id)
              .maybeSingle();

            pollData = {
              ...poll,
              options: pollOptions,
              vote_counts: voteCounts,
              total_votes: votes?.length || 0,
              user_vote: userVote?.option_index ?? null,
              is_closed: new Date(poll.closes_at) < new Date(),
            };
          }
        }

        return {
          ...msg,
          author: msg.is_ghost ? undefined : msg.users,
          reply_count: replyCount || 0,
          replies: formattedReplies,
          delivery_status: 'delivered' as const,
          poll: pollData,
        };
      }));

      // If SQLite is available, sync messages and user data to local storage
      if (isSqliteReady) {
        try {
          console.log('🔄 Syncing messages from Supabase to local storage...');
          
          // First, sync user data for message authors
          for (const msg of data || []) {
            if (!msg.is_ghost && msg.users) {
              await sqliteService.saveUser({
                id: msg.user_id,
                display_name: msg.users.display_name,
                phone_number: msg.users.phone_number || null,
                avatar_url: msg.users.avatar_url || null,
                is_onboarded: 1,
                created_at: new Date(msg.users.created_at).getTime()
              });
            }
          }
          
          // Also sync reply authors
          for (const msg of messages) {
            if (msg.replies && msg.replies.length > 0) {
              for (const reply of msg.replies) {
                if (!reply.is_ghost && reply.users) {
                  await sqliteService.saveUser({
                    id: reply.user_id,
                    display_name: reply.users.display_name,
                    phone_number: reply.users.phone_number || null,
                    avatar_url: reply.users.avatar_url || null,
                    is_onboarded: 1,
                    created_at: new Date(reply.users.created_at).getTime()
                  });
                }
              }
            }
          }
          
          // Then sync the messages
          const syncCount = await sqliteService.syncMessagesFromRemote(groupId, data || []);
          console.log(`🔄 Synced ${syncCount} messages from Supabase to local storage`);

          // Sync reactions, polls, and other related data
          await get().syncMessageRelatedData(groupId, data || []);
          
          // If we synced new messages and already had local data loaded, refresh from local storage
          if (syncCount > 0 && localDataLoaded) {
            console.log('🔄 Refreshing UI with updated local data...');
            
            // Re-fetch from local storage to get the updated data
            const updatedLocalMessages = await sqliteService.getMessages(groupId);
            
            if (updatedLocalMessages && updatedLocalMessages.length > 0) {
              // Convert local messages to the format expected by the UI
              const refreshedMessages = await Promise.all(updatedLocalMessages.map(async (msg) => {
                // Get user info from local storage
                let author = undefined;
                if (!msg.is_ghost) {
                  const user = await sqliteService.getUser(msg.user_id);
                  if (user) {
                    author = {
                      display_name: user.display_name,
                      avatar_url: null
                    };
                  }
                }
                
                return {
                  id: msg.id,
                  group_id: msg.group_id,
                  user_id: msg.user_id,
                  content: msg.content,
                  is_ghost: msg.is_ghost === 1,
                  message_type: msg.message_type,
                  created_at: new Date(msg.created_at).toISOString(),
                  author: author,
                  reply_count: 0,
                  replies: [],
                  delivery_status: 'delivered' as const,
                  // Add missing properties required by Message type
                  category: null,
                  parent_id: null,
                  image_url: null
                };
              }));
              
              // Update UI with refreshed data
              set({ messages: refreshedMessages });
              console.log(`✅ UI refreshed with ${refreshedMessages.length} messages from local storage`);
            }
          }
        } catch (error) {
          console.error('❌ Error syncing messages to local storage:', error);
        }
      } else if (!localDataLoaded) {
        // Only update UI with Supabase data if we didn't already load from local storage
        set({ messages, isLoading: false });
      }
    } catch (error) {
      console.error('Error fetching messages:', error);
      set({ isLoading: false });
    }
  },

  fetchMessageById: async (messageId: string) => {
    try {
      const { data, error } = await supabase
        .from('messages')
        .select(`
          *,
          reactions(*),
          users!messages_user_id_fkey(display_name, avatar_url)
        `)
        .eq('id', messageId)
        .single();

      if (error) throw error;

      return {
        ...data,
        author: data.is_ghost ? undefined : data.users,
        reply_count: 0,
        delivery_status: 'delivered' as const,
      };
    } catch (error) {
      console.error('Error fetching message:', error);
      return null;
    }
  },

  fetchReplies: async (messageId: string) => {
    try {
      const { data, error } = await supabase
        .from('messages')
        .select(`
          *,
          reactions(*),
          users!messages_user_id_fkey(display_name, avatar_url)
        `)
        .eq('parent_id', messageId)
        .order('created_at', { ascending: true });

      if (error) throw error;

      return (data || []).map((reply) => ({
        ...reply,
        author: reply.is_ghost ? undefined : reply.users,
        reply_count: 0,
        delivery_status: 'delivered' as const,
      }));
    } catch (error) {
      console.error('Error fetching replies:', error);
      return [];
    }
  },

  fetchGroupMembers: async (groupId: string) => {
    try {
      set({ isLoadingGroupDetails: true });
      
      const { data, error } = await supabase
        .from('group_members')
        .select(`
          *,
          users!group_members_user_id_fkey(display_name, phone_number, avatar_url)
        `)
        .eq('group_id', groupId)
        .order('joined_at', { ascending: true });

      if (error) throw error;

      const members: GroupMember[] = (data || []).map((member) => ({
        id: `${member.group_id}-${member.user_id}`,
        user_id: member.user_id,
        group_id: member.group_id,
        role: 'participant', // Default role, will be enhanced later
        joined_at: member.joined_at,
        user: {
          display_name: member.users.display_name,
          phone_number: member.users.phone_number,
          avatar_url: member.users.avatar_url,
        },
      }));

      set({ groupMembers: members });
    } catch (error) {
      console.error('Error fetching group members:', error);
      set({ groupMembers: [] });
    } finally {
      set({ isLoadingGroupDetails: false });
    }
  },

  fetchGroupMedia: async (groupId: string) => {
    try {
      // Placeholder implementation - will be enhanced when media upload is implemented
      const mockMedia: GroupMedia[] = [
        {
          id: '1',
          group_id: groupId,
          user_id: 'user1',
          type: 'photo',
          url: 'https://images.pexels.com/photos/1040880/pexels-photo-1040880.jpeg?auto=compress&cs=tinysrgb&w=400',
          name: 'group-photo-1.jpg',
          uploaded_at: new Date().toISOString(),
          user: {
            display_name: 'John Doe',
            avatar_url: null,
          },
        },
        {
          id: '2',
          group_id: groupId,
          user_id: 'user2',
          type: 'document',
          url: '#',
          name: 'meeting-notes.pdf',
          uploaded_at: new Date(Date.now() - 86400000).toISOString(),
          user: {
            display_name: 'Jane Smith',
            avatar_url: null,
          },
        },
      ];

      set({ groupMedia: mockMedia });
    } catch (error) {
      console.error('Error fetching group media:', error);
      set({ groupMedia: [] });
    }
  },

  fetchPollsForGroup: async (groupId: string) => {
    try {
      set({ isLoadingPolls: true });
      
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Not authenticated');

      // Fetch polls for messages in this group
      const { data: polls, error } = await supabase
        .from('polls')
        .select(`
          *,
          messages!polls_message_id_fkey(group_id)
        `)
        .eq('messages.group_id', groupId);

      if (error) throw error;

      const pollsWithVotes = await Promise.all((polls || []).map(async (poll: any) => {
        // Fetch vote counts
        const { data: votes } = await supabase
          .from('poll_votes')
          .select('option_index')
          .eq('poll_id', poll.id);

        const pollOptions = poll.options as string[];
        const voteCounts = new Array(pollOptions.length).fill(0);
        votes?.forEach(vote => {
          if (vote.option_index < voteCounts.length) {
            voteCounts[vote.option_index]++;
          }
        });

        // Check user's vote
        const { data: userVote } = await supabase
          .from('poll_votes')
          .select('option_index')
          .eq('poll_id', poll.id)
          .eq('user_id', user.id)
          .maybeSingle();

        return {
          id: poll.id,
          message_id: poll.message_id,
          question: poll.question,
          options: pollOptions,
          created_at: poll.created_at,
          closes_at: poll.closes_at,
          vote_counts: voteCounts,
          total_votes: votes?.length || 0,
          user_vote: userVote?.option_index ?? null,
          is_closed: new Date(poll.closes_at) < new Date(),
        } as Poll;
      }));

      set({ polls: pollsWithVotes });

      // Update user votes
      const userVotes: Record<string, number | null> = {};
      pollsWithVotes.forEach(poll => {
        userVotes[poll.id] = poll.user_vote || null;
      });
      set({ userVotes });

    } catch (error) {
      console.error('Error fetching polls:', error);
      set({ polls: [] });
    } finally {
      set({ isLoadingPolls: false });
    }
  },

  createPoll: async (groupId: string, question: string, options: string[]) => {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Not authenticated');

      // First create a message for the poll
      const { data: message, error: messageError } = await supabase
        .from('messages')
        .insert({
          group_id: groupId,
          user_id: user.id,
          content: question,
          is_ghost: true, // Polls are always anonymous
          message_type: 'poll',
        })
        .select()
        .single();

      if (messageError) throw messageError;

      // Then create the poll
      const { data: poll, error: pollError } = await supabase
        .from('polls')
        .insert({
          message_id: message.id,
          question,
          options,
        })
        .select()
        .single();

      if (pollError) throw pollError;

      const pollWithVotes = {
        ...poll,
        options: options as Json,
        vote_counts: new Array(options.length).fill(0),
        total_votes: 0,
        user_vote: null,
        is_closed: false,
      };

      // Create optimistic message with poll
      const optimisticMessage = {
        ...message,
        author: undefined, // Always anonymous
        reply_count: 0,
        replies: [],
        reactions: [],
        delivery_status: 'sent' as const,
        poll: pollWithVotes,
      };

      // Add to messages immediately for instant UI update
      get().addMessage(optimisticMessage);

      return pollWithVotes;
    } catch (error) {
      console.error('Error creating poll:', error);
      throw error;
    }
  },

  voteOnPoll: async (pollId: string, optionIndex: number) => {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Not authenticated');

      // Check if user has already voted
      const { data: existingVote } = await supabase
        .from('poll_votes')
        .select('*')
        .eq('poll_id', pollId)
        .eq('user_id', user.id)
        .maybeSingle();

      if (existingVote) {
        throw new Error('You have already voted on this poll');
      }

      // Optimistic update - update both polls and messages immediately
      const state = get();
      
      // Update polls array
      const updatedPolls = state.polls.map(poll => {
        if (poll.id === pollId) {
          const pollOptions = poll.options as string[];
          const newVoteCounts = [...(poll.vote_counts || [])];
          if (optionIndex < pollOptions.length && optionIndex < newVoteCounts.length) {
            newVoteCounts[optionIndex]++;
          }
          
          return {
            ...poll,
            vote_counts: newVoteCounts,
            total_votes: (poll.total_votes || 0) + 1,
            user_vote: optionIndex,
          };
        }
        return poll;
      });
      
      // Update messages with poll data
      const updatedMessages = state.messages.map(msg => {
        if (msg.poll?.id === pollId) {
          const pollOptions = msg.poll.options as string[];
          const newVoteCounts = [...(msg.poll.vote_counts || [])];
          if (optionIndex < pollOptions.length && optionIndex < newVoteCounts.length) {
            newVoteCounts[optionIndex]++;
          }
          
          return {
            ...msg,
            poll: {
              ...msg.poll,
              vote_counts: newVoteCounts,
              total_votes: (msg.poll.total_votes || 0) + 1,
              user_vote: optionIndex,
            }
          };
        }
        return msg;
      });
      
      set({ polls: updatedPolls, messages: updatedMessages });
      
      // Update user votes
      const currentVotes = get().userVotes;
      set({ userVotes: { ...currentVotes, [pollId]: optionIndex } });

      // Submit vote to database
      const { error } = await supabase
        .from('poll_votes')
        .insert({
          poll_id: pollId,
          user_id: user.id,
          option_index: optionIndex,
        });

      if (error) {
        // Revert optimistic update on error
        set({ polls: state.polls, messages: state.messages });
        set({ userVotes: currentVotes });
        throw error;
      }

    } catch (error) {
      console.error('Error voting on poll:', error);
      throw error;
    }
  },

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

  sendMessage: async (groupId: string, content: string, isGhost: boolean, messageType = 'text', category: string | null = null, parentId: string | null = null, _pollId: string | null = null, imageFile: File | null = null) => {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Not authenticated');

      // Check if we're on a native platform with SQLite available
      const isNative = Capacitor.isNativePlatform();
      const isSqliteReady = isNative && await sqliteService.isReady();
      
      // Check network status
      const networkStatus = await Network.getStatus();
      const isOnline = networkStatus.connected;
      
      let imageUrl: string | null = null;

      // Upload image if provided - only possible when online
      if (imageFile && isOnline) {
        get().setUploadingFile(true);
        
        try {
          // Compress and resize image
          const canvas = document.createElement('canvas');
          const ctx = canvas.getContext('2d');
          const img = new Image();
          
          await new Promise((resolve, reject) => {
            img.onload = resolve;
            img.onerror = reject;
            img.src = URL.createObjectURL(imageFile);
          });
          
          // Calculate new dimensions (max 1200px width/height)
          const maxSize = 1200;
          let { width, height } = img;
          
          if (width > height) {
            if (width > maxSize) {
              height = (height * maxSize) / width;
              width = maxSize;
            }
          } else {
            if (height > maxSize) {
              width = (width * maxSize) / height;
              height = maxSize;
            }
          }
          
          canvas.width = width;
          canvas.height = height;
          
          ctx?.drawImage(img, 0, 0, width, height);
          
          // Convert to blob with compression
          const blob = await new Promise<Blob>((resolve) => {
            canvas.toBlob((blob) => resolve(blob!), 'image/jpeg', 0.8);
          });
          
          // Create file name
          const fileName = `${user.id}/${Date.now()}_${imageFile.name.replace(/[^a-zA-Z0-9.-]/g, '_')}`;
          
          // Upload to Supabase Storage
          const { data: uploadData, error: uploadError } = await supabase.storage
            .from('chat-media')
            .upload(fileName, blob, {
              contentType: 'image/jpeg',
              upsert: false
            });
          
          if (uploadError) throw uploadError;
          
          // Get public URL
          const { data: { publicUrl } } = supabase.storage
            .from('chat-media')
            .getPublicUrl(uploadData.path);
          
          imageUrl = publicUrl;
          
          // Clean up
          URL.revokeObjectURL(img.src);
        } catch (error) {
          console.error('Error uploading image:', error);
          throw new Error('Failed to upload image');
        } finally {
          get().setUploadingFile(false);
        }
      } else if (imageFile && !isOnline) {
        // Cannot upload images when offline
        console.warn('⚠️ Cannot upload images when offline');
        throw new Error('Cannot upload images when offline');
      }

      // Generate a unique ID for the message
      const messageId = `${Date.now()}-${Math.random().toString(36).substring(2, 15)}`;
      
      // Create optimistic message
      const optimisticMessage: Message = {
        id: messageId,
        group_id: groupId,
        user_id: user.id,
        content,
        is_ghost: isGhost,
        message_type: messageType,
        category,
        parent_id: parentId,
        image_url: imageUrl,
        created_at: new Date().toISOString(),
        author: isGhost ? undefined : { display_name: 'You', avatar_url: null },
        reply_count: 0,
        replies: [],
        reactions: [],
        delivery_status: 'sending',
      };

      // Add optimistic message to UI
      if (parentId) {
        const state = get();
        const updatedMessages = state.messages.map(msg => {
          if (msg.id === parentId) {
            return {
              ...msg,
              replies: [...(msg.replies || []), optimisticMessage],
            };
          }
          return msg;
        });
        set({ messages: updatedMessages });

        if (state.activeThread?.id === parentId) {
          set({ threadReplies: [...state.threadReplies, optimisticMessage] });
        }
      } else {
        get().addMessage(optimisticMessage);
      }

      // Stop typing indicator
      get().sendTypingStatus(false, isGhost);
      
      // If offline, save to local storage and outbox
      if (!isOnline && isSqliteReady) {
        try {
          console.log('📵 Offline mode: Saving message to local storage and outbox');
          
          // Save message to local storage
          await sqliteService.saveMessage({
            id: messageId,
            group_id: groupId,
            user_id: user.id,
            content,
            is_ghost: isGhost ? 1 : 0,
            message_type: messageType,
            category: category || null,
            parent_id: parentId || null,
            image_url: imageUrl || null,
            created_at: Date.now()
          });
          
          // Add to outbox for later sync
          await sqliteService.addToOutbox({
            group_id: groupId,
            user_id: user.id,
            content: content,
            retry_count: 0,
            next_retry_at: Date.now() + 60000, // Try in 1 minute
            message_type: messageType,
            category: category,
            parent_id: parentId,
            image_url: imageUrl,
            is_ghost: isGhost ? 1 : 0
          });
          
          // Update message status
          const updatedMessage = { ...optimisticMessage, delivery_status: 'sent' as const };
          
          if (parentId) {
            const state = get();
            const updatedMessages = state.messages.map(msg => {
              if (msg.id === parentId) {
                return {
                  ...msg,
                  replies: (msg.replies || []).map(reply => 
                    reply.id === messageId ? updatedMessage : reply
                  ),
                };
              }
              return msg;
            });
            set({ messages: updatedMessages });

            if (state.activeThread?.id === parentId) {
              const updatedReplies = state.threadReplies.map(reply => 
                reply.id === messageId ? updatedMessage : reply
              );
              set({ threadReplies: updatedReplies });
            }
          } else {
            const state = get();
            const updatedMessages = state.messages.map(msg => 
              msg.id === messageId ? updatedMessage : msg
            );
            set({ messages: updatedMessages });
          }
          
          // Clear reply state if not in thread
          if (!get().activeThread) {
            set({ replyingTo: null });
          }
          
          console.log('✅ Message saved to local storage and outbox');
          return;
        } catch (error) {
          console.error('❌ Error saving offline message:', error);
          throw error;
        }
      }

      // If online, send to Supabase
      const { data, error } = await supabase
        .from('messages')
        .insert({
          group_id: groupId,
          user_id: user.id,
          content,
          is_ghost: isGhost,
          message_type: messageType,
          category,
          parent_id: parentId,
          image_url: imageUrl,
        })
        .select(`
          *,
          reactions(*),
          users!messages_user_id_fkey(display_name, avatar_url)
        `)
        .single();

      if (error) throw error;

      // Replace optimistic message with real message
      const realMessage = {
        ...data,
        author: data.is_ghost ? undefined : data.users,
        reply_count: 0,
        replies: [],
        delivery_status: 'sent' as const,
      };

      // Update the optimistic message with real data
      if (parentId) {
        const state = get();
        const updatedMessages = state.messages.map(msg => {
          if (msg.id === parentId) {
            return {
              ...msg,
              replies: (msg.replies || []).map(reply => 
                reply.id === messageId ? realMessage : reply
              ),
            };
          }
          return msg;
        });
        set({ messages: updatedMessages });

        if (state.activeThread?.id === parentId) {
          const updatedReplies = state.threadReplies.map(reply => 
            reply.id === messageId ? realMessage : reply
          );
          set({ threadReplies: updatedReplies });
        }
      } else {
        // Replace the optimistic message with the real one
        const state = get();
        const updatedMessages = state.messages.map(msg => 
          msg.id === messageId ? realMessage : msg
        );
        set({ messages: updatedMessages });
      }
      
      // Save message to local storage for offline access
      if (isSqliteReady) {
        try {
          // Save message
          await sqliteService.saveMessage({
            id: data.id,
            group_id: data.group_id,
            user_id: data.user_id,
            content: data.content,
            is_ghost: data.is_ghost ? 1 : 0,
            message_type: data.message_type,
            category: null,
            parent_id: null,
            image_url: null,
            created_at: new Date(data.created_at).getTime()
          });
          
          // Save user info
          if (!data.is_ghost && data.users) {
            await sqliteService.saveUser({
              id: data.user_id,
              display_name: data.users.display_name,
              phone_number: data.users.phone_number || null,
              avatar_url: data.users.avatar_url || null,
              is_onboarded: 1,
              created_at: new Date(data.users.created_at).getTime()
            });
          }
          
          console.log('✅ Message synced to local storage');
        } catch (error) {
          console.error('❌ Error syncing message to local storage:', error);
        }
      }

      // Clear reply state if not in thread
      if (!get().activeThread) {
        set({ replyingTo: null });
      }
    } catch (error) {
      console.error('Error sending message:', error);
      
      // Update optimistic message to show failed status
      if (parentId) {
        const state = get();
        const updatedMessages = state.messages.map(msg => {
          if (msg.id === parentId) {
            return {
              ...msg,
              replies: (msg.replies || []).map(reply => 
                reply.id.startsWith('temp-') 
                  ? { ...reply, delivery_status: 'failed' as const }
                  : reply
              ),
            };
          }
          return msg;
        });
        set({ messages: updatedMessages });
      } else {
        const state = get();
        const updatedMessages = state.messages.map(msg => 
          msg.id.startsWith('temp-') 
            ? { ...msg, delivery_status: 'failed' as const }
            : msg
        );
        set({ messages: updatedMessages });
      }
      
      throw error;
    }
  },

  addReaction: async (messageId: string, emoji: string) => {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Not authenticated');

      const { error } = await supabase
        .from('reactions')
        .insert({
          message_id: messageId,
          user_id: user.id,
          emoji,
        });

      if (error) throw error;

      const state = get();
      const newReaction = {
        id: Date.now().toString(),
        message_id: messageId,
        user_id: user.id,
        emoji,
      };

      // Update messageReactions
      const currentReactions = state.messageReactions[messageId] || [];
      set({
        messageReactions: {
          ...state.messageReactions,
          [messageId]: [...currentReactions, newReaction]
        }
      });

      const updatedMessages = state.messages.map(msg => {
        if (msg.id === messageId) {
          return {
            ...msg,
            reactions: [...(msg.reactions || []), newReaction],
          };
        }
        return msg;
      });
      set({ messages: updatedMessages });

      if (state.activeThread) {
        const updatedReplies = state.threadReplies.map(reply => {
          if (reply.id === messageId) {
            return {
              ...reply,
              reactions: [...(reply.reactions || []), newReaction],
            };
          }
          return reply;
        });
        set({ threadReplies: updatedReplies });
      }
    } catch (error) {
      console.error('Error adding reaction:', error);
      throw error;
    }
  },

  removeReaction: async (messageId: string, emoji: string) => {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Not authenticated');

      const { error } = await supabase
        .from('reactions')
        .delete()
        .eq('message_id', messageId)
        .eq('user_id', user.id)
        .eq('emoji', emoji);

      if (error) throw error;

      const state = get();
      
      // Update messageReactions
      const currentReactions = state.messageReactions[messageId] || [];
      const updatedReactions = currentReactions.filter(
        r => !(r.user_id === user.id && r.emoji === emoji)
      );
      set({
        messageReactions: {
          ...state.messageReactions,
          [messageId]: updatedReactions
        }
      });

      const updatedMessages = state.messages.map(msg => {
        if (msg.id === messageId) {
          return {
            ...msg,
            reactions: (msg.reactions || []).filter(
              r => !(r.user_id === user.id && r.emoji === emoji)
            ),
          };
        }
        return msg;
      });
      set({ messages: updatedMessages });

      if (state.activeThread) {
        const updatedReplies = state.threadReplies.map(reply => {
          if (reply.id === messageId) {
            return {
              ...reply,
              reactions: (reply.reactions || []).filter(
                r => !(r.user_id === user.id && r.emoji === emoji)
              ),
            };
          }
          return reply;
        });
        set({ threadReplies: updatedReplies });
      }
    } catch (error) {
      console.error('Error removing reaction:', error);
      throw error;
    }
  },

  createGroup: async (name: string, description?: string) => {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Not authenticated');

      const inviteCode = Math.random().toString(36).substring(2, 8).toUpperCase();

      const { data, error } = await supabase
        .from('groups')
        .insert({
          name,
          description,
          invite_code: inviteCode,
          created_by: user.id,
        })
        .select()
        .single();

      if (error) throw error;

      const { error: memberError } = await supabase
        .from('group_members')
        .insert({
          group_id: data.id,
          user_id: user.id,
        });

      if (memberError) throw memberError;

      const newGroups = [...get().groups, data];
      set({ groups: newGroups });
      
      return data;
    } catch (error) {
      console.error('Error creating group:', error);
      throw error;
    }
  },

  joinGroup: async (inviteCode: string) => {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Not authenticated');

      const { data: group, error: groupError } = await supabase
        .from('groups')
        .select('*')
        .eq('invite_code', inviteCode.toUpperCase())
        .single();

      if (groupError) throw new Error('Invalid invite code');

      const { data: existingMember } = await supabase
        .from('group_members')
        .select('*')
        .eq('group_id', group.id)
        .eq('user_id', user.id)
        .maybeSingle();

      if (existingMember) throw new Error('Already a member of this group');

      const { error: memberError } = await supabase
        .from('group_members')
        .insert({
          group_id: group.id,
          user_id: user.id,
        });

      if (memberError) throw memberError;

      const newGroups = [...get().groups, group];
      set({ groups: newGroups });
    } catch (error) {
      console.error('Error joining group:', error);
      throw error;
    }
  },

  closeGroupDetailsPanel: () => {
    set({ showGroupDetailsPanel: false });
  },

  openThreadMobile: (groupId: string, messageId: string) => {
    // Find the message and set it as active thread
    const { messages } = get();
    const message = messages.find(m => m.id === messageId);
    if (message) {
      set({ activeThread: message });
      // Fetch replies if needed
      get().fetchReplies(messageId).then((replies) => {
        set({ threadReplies: replies });
      });
    }
    
    // Ensure we're using the groupId parameter
    console.log(`Thread opened for message ${messageId} in group ${groupId}`);
  },

  openGroupDetailsMobile: (groupId: string) => {
    // Find the group and set it as active group if needed
    const { groups, activeGroup } = get();
    if (!activeGroup || activeGroup.id !== groupId) {
      const group = groups.find(g => g.id === groupId);
      if (group) {
        set({ activeGroup: group });
      }
    }
    
    // Show group details panel
    set({ showGroupDetailsPanel: true });
    
    // Load group members and media
    get().fetchGroupMembers(groupId);
    get().fetchGroupMedia(groupId);
  },

  processOutbox: async () => {
    try {
      // Check if we're on a native platform with SQLite available
      const isNative = Capacitor.isNativePlatform();
      const isSqliteReady = isNative && await sqliteService.isReady();
      
      if (!isSqliteReady) return;
      
      // Check network status
      const networkStatus = await Network.getStatus();
      const isOnline = networkStatus.connected;
      
      if (!isOnline) {
        console.log('📵 Cannot process outbox while offline');
        return;
      }
      
      console.log('🔄 Processing outbox messages...');
      
      // Get pending outbox messages
      const outboxMessages = await sqliteService.getOutboxMessages();
      
      if (outboxMessages.length === 0) {
        console.log('✅ No pending outbox messages to process');
        return;
      }
      
      console.log(`📤 Found ${outboxMessages.length} pending messages to send`);
      
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        console.error('❌ Cannot process outbox: User not authenticated');
        return;
      }
      
      // Process each message
      for (const outboxItem of outboxMessages) {
        try {
          // Parse the content
          const messageData = JSON.parse(outboxItem.content);
          
          // Send to Supabase
          const { data, error } = await supabase
            .from('messages')
            .insert({
              id: messageData.id, // Use the same ID we generated offline
              group_id: outboxItem.group_id,
              user_id: outboxItem.user_id,
              content: messageData.content,
              is_ghost: messageData.is_ghost,
              message_type: messageData.message_type,
              category: messageData.category,
              parent_id: messageData.parent_id,
              image_url: messageData.image_url,
            })
            .select(`
              *,
              reactions(*),
              users!messages_user_id_fkey(display_name, avatar_url)
            `)
            .single();
          
          if (error) {
            console.error(`❌ Error sending outbox message ${outboxItem.id}:`, error);
            
            // Update retry count and next retry time
            const nextRetry = Date.now() + (outboxItem.retry_count + 1) * 60000; // Exponential backoff
            await sqliteService.updateOutboxRetry(
              outboxItem.id!,
              outboxItem.retry_count + 1,
              nextRetry
            );
            continue;
          }
          
          console.log(`✅ Successfully sent outbox message ${outboxItem.id}`);
          
          // Remove from outbox
          await sqliteService.removeFromOutbox(outboxItem.id!);
          
          // Update the UI if this message is currently displayed
          const state = get();
          if (messageData.parent_id) {
            // This is a reply
            const updatedMessages = state.messages.map(msg => {
              if (msg.id === messageData.parent_id) {
                return {
                  ...msg,
                  replies: (msg.replies || []).map(reply => 
                    reply.id === messageData.id ? {
                      ...reply,
                      id: data.id, // Use the server-generated ID
                      delivery_status: 'delivered' as const
                    } : reply
                  ),
                };
              }
              return msg;
            });
            set({ messages: updatedMessages as Message[] });
            
            if (state.activeThread?.id === messageData.parent_id) {
              const updatedReplies = state.threadReplies.map(reply => 
                reply.id === messageData.id ? {
                  ...reply,
                  id: data.id,
                  delivery_status: 'delivered' as const
                } : reply
              );
              set({ threadReplies: updatedReplies as Message[] });
            }
          } else {
            // This is a main message
            const updatedMessages = state.messages.map(msg => 
              msg.id === messageData.id ? {
                ...msg,
                id: data.id,
                delivery_status: 'delivered' as const
              } : msg
            );
            set({ messages: updatedMessages as Message[] });
          }
        } catch (error) {
          console.error(`❌ Error processing outbox message ${outboxItem.id}:`, error);
        }
      }
      
      console.log('✅ Finished processing outbox');
    } catch (error) {
      console.error('❌ Error processing outbox:', error);
    }
  },

  setupNetworkListener: () => {
    // Only run on native platforms
    if (!Capacitor.isNativePlatform()) return;
    
    console.log('🔌 Setting up network status listener');
    
    // Listen for network status changes
    Network.addListener('networkStatusChange', async ({ connected }) => {
      console.log(`🌐 Network status changed: ${connected ? 'online' : 'offline'}`);
      
      if (connected) {
        // Process outbox when coming back online
        console.log('🔄 Network is back online, processing outbox...');
        await get().processOutbox();
      }
    });
  },

  cleanupNetworkListener: () => {
    if (!Capacitor.isNativePlatform()) return;
    
    console.log('🧹 Cleaning up network status listener');
    Network.removeAllListeners();
  },

  setOnlineStatus: (status) => {
    set({ online: status });
  },
  
  startOutboxProcessor: () => {
    const { processOutbox } = get();
    
    // Clear any existing interval
    if (outboxProcessorInterval) {
      clearInterval(outboxProcessorInterval);
    }
    
    // Start processing outbox every 30 seconds
    outboxProcessorInterval = setInterval(() => {
      processOutbox();
    }, 30000);
    
    // Process immediately
    processOutbox();
  },
  
  stopOutboxProcessor: () => {
    if (outboxProcessorInterval) {
      clearInterval(outboxProcessorInterval);
      outboxProcessorInterval = null;
    }
  },

  syncMessageRelatedData: async (groupId: string, messages: any[]) => {
    try {
      const isNative = Capacitor.isNativePlatform();
      const isSqliteReady = isNative && await sqliteService.isReady();
      
      if (!isSqliteReady) return;
      
      console.log(`📊 Syncing message-related data for group ${groupId}...`);
      
      // Sync group data
      const { data: groupData } = await supabase
        .from('groups')
        .select('*')
        .eq('id', groupId)
        .single();
      
      if (groupData) {
        await sqliteService.saveGroup({
          id: groupData.id,
          name: groupData.name,
          description: groupData.description,
          invite_code: groupData.invite_code,
          created_by: groupData.created_by,
          created_at: new Date(groupData.created_at).getTime(),
          last_sync_timestamp: Date.now(),
          avatar_url: groupData.avatar_url,
          is_archived: 0
        });
      }

      // Sync group members
      const { data: members } = await supabase
        .from('group_members')
        .select('*, users!group_members_user_id_fkey(*)')
        .eq('group_id', groupId);
      
      if (members) {
        for (const member of members) {
          await sqliteService.saveUser({
            id: member.user_id,
            display_name: member.users.display_name,
            phone_number: member.users.phone_number,
            avatar_url: member.users.avatar_url,
            is_onboarded: member.users.is_onboarded ? 1 : 0,
            created_at: new Date(member.users.created_at).getTime()
          });
          
          await sqliteService.saveGroupMember({
            group_id: groupId,
            user_id: member.user_id,
            role: member.role || 'participant',
            joined_at: new Date(member.joined_at).getTime()
          });
        }
      }
      
      // Sync reactions for all messages
      const messageIds = messages.map(msg => msg.id);
      if (messageIds.length > 0) {
        const { data: reactions } = await supabase
          .from('reactions')
          .select('*')
          .in('message_id', messageIds);
        
        if (reactions) {
          for (const reaction of reactions) {
            await sqliteService.saveReaction({
              id: reaction.id,
              message_id: reaction.message_id,
              user_id: reaction.user_id,
              emoji: reaction.emoji,
              created_at: new Date(reaction.created_at).getTime()
            });
          }
        }
      }
      
      // Sync polls for poll messages
      const pollMessages = messages.filter(msg => msg.message_type === 'poll');
      if (pollMessages.length > 0) {
        const { data: polls } = await supabase
          .from('polls')
          .select('*')
          .in('message_id', pollMessages.map(msg => msg.id));
        
        if (polls) {
          for (const poll of polls) {
            await sqliteService.savePoll({
              id: poll.id,
              message_id: poll.message_id,
              question: poll.question,
              options: JSON.stringify(poll.options),
              created_at: new Date(poll.created_at).getTime(),
              closes_at: new Date(poll.closes_at).getTime()
            });
          }
        }
      }
      
      console.log(`✅ Message-related data synced for group ${groupId}`);
    } catch (error) {
      console.error('❌ Error syncing message-related data:', error);
    }
  },

  forceMessageSync: async (groupId: string) => {
    try {
      console.log('🔄 Forcing full message sync for group:', groupId);
      
      // Check if we're on a native platform with SQLite available
      const isNative = Capacitor.isNativePlatform();
      const isSqliteReady = isNative && await sqliteService.isReady();
      
      if (!isSqliteReady) {
        console.log('❌ SQLite not available, cannot sync messages');
        return;
      }
      
      // Check network status
      const networkStatus = await Network.getStatus();
      const isOnline = networkStatus.connected;
      
      if (!isOnline) {
        console.log('❌ Cannot sync messages while offline');
        return;
      }
      
      // Fetch messages from Supabase
      const { data, error } = await supabase
        .from('messages')
        .select(`
          *,
          reactions(*),
          users!messages_user_id_fkey(display_name, avatar_url)
        `)
        .eq('group_id', groupId)
        .order('created_at', { ascending: true });

      if (error) throw error;
      
      // Sync user data first
      console.log(`🧑‍💼 Syncing user data for ${data?.length || 0} messages`);
      for (const message of data || []) {
        if (!message.is_ghost && message.users) {
          await sqliteService.saveUser({
            id: message.user_id,
            display_name: message.users.display_name,
            phone_number: message.users.phone_number || null,
            avatar_url: message.users.avatar_url || null,
            is_onboarded: 1,
            created_at: new Date(message.users.created_at).getTime()
          });
        }
      }
      
      // Then sync messages
      console.log(`📨 Syncing ${data?.length || 0} messages to local storage`);
      const syncCount = await sqliteService.syncMessagesFromRemote(groupId, data || []);
      
      // Sync reactions, polls, and other related data
      await get().syncMessageRelatedData(groupId, data || []);
      
      console.log(`✅ Force sync complete: ${syncCount} messages synced to local storage`);
      
      // Refresh the UI by re-fetching messages
      await get().fetchMessages(groupId);
      
    } catch (error) {
      console.error('❌ Error force syncing messages:', error);
      throw error;
    }
  },
}));