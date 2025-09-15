import { supabasePipeline } from '@/lib/supabasePipeline';
import { Json } from '@/lib/supabase';
import { Poll } from './types';

export interface PollActions {
  fetchPollsForGroup: (groupId: string) => Promise<void>;
  createPoll: (groupId: string, question: string, options: string[]) => Promise<Poll>;
  voteOnPoll: (pollId: string, optionIndex: number) => Promise<void>;
}

export const createPollActions = (set: any, get: any): PollActions => ({
  fetchPollsForGroup: async (groupId: string) => {
    try {
      set({ isLoadingPolls: true });

      const { data: { user } } = await supabasePipeline.getUser();
      if (!user) throw new Error('Not authenticated');

      // Fetch polls for messages in this group
      const client = await supabasePipeline.getDirectClient();
      const { data: polls, error } = await client
        .from('polls')
        .select(`
          *,
          messages!polls_message_id_fkey(group_id)
        `)
        .eq('messages.group_id', groupId);

      if (error) throw error;

      const pollsWithVotes = await Promise.all((polls || []).map(async (poll: any) => {
        // Fetch vote counts
        const { data: votes } = await client
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
        const { data: userVote } = await client
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
      const { data: { user } } = await supabasePipeline.getUser();
      if (!user) throw new Error('Not authenticated');

      // First create a message for the poll
      const client = await supabasePipeline.getDirectClient();
      const { data: message, error: messageError } = await client
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
      const { data: poll, error: pollError } = await client
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
      const { data: { user } } = await supabasePipeline.getUser();
      if (!user) throw new Error('Not authenticated');

      // Check if user has already voted
      const client = await supabasePipeline.getDirectClient();
      const { data: existingVote } = await client
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
      const updatedPolls = state.polls.map((poll: Poll) => {
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
      const updatedMessages = state.messages.map((msg: any) => {
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
      const { error } = await client
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

      // Save vote to local storage for offline access
      try {
        const { sqliteService } = await import('@/lib/sqliteService');
        const { Capacitor } = await import('@capacitor/core');
        
        if (Capacitor.isNativePlatform() && await sqliteService.isReady()) {
          await sqliteService.savePollVote({
            poll_id: pollId,
            user_id: user.id,
            option_index: optionIndex,
            created_at: Date.now()
          });
          console.log('✅ Poll vote saved to local storage');
        }
      } catch (localError) {
        console.error('❌ Error saving poll vote to local storage:', localError);
        // Don't throw - the vote was successful on the server
      }

    } catch (error) {
      console.error('Error voting on poll:', error);
      throw error;
    }
  },
});