import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { formatDistanceToNow } from 'date-fns';
import { BarChart3, Clock, CheckCircle, Users, Sparkles } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { toast } from 'sonner';
import { useChatStore, Poll } from '@/store/chatStore';
import { cn } from '@/lib/utils';

interface PollComponentProps {
  poll: Poll;
  className?: string;
}

// Confetti component for celebration
const Confetti = () => {
  const particles = Array.from({ length: 20 }, (_, i) => i);
  
  return (
    <div className="absolute inset-0 pointer-events-none overflow-hidden">
      {particles.map((i) => (
        <motion.div
          key={i}
          className="absolute w-2 h-2 bg-gradient-to-r from-green-400 to-green-600 rounded-full"
          initial={{
            x: '50%',
            y: '50%',
            scale: 0,
            rotate: 0,
          }}
          animate={{
            x: `${50 + (Math.random() - 0.5) * 200}%`,
            y: `${50 + (Math.random() - 0.5) * 200}%`,
            scale: [0, 1, 0],
            rotate: 360,
          }}
          transition={{
            duration: 2,
            delay: i * 0.1,
            ease: 'easeOut',
          }}
        />
      ))}
    </div>
  );
};

export function PollComponent({ poll, className }: PollComponentProps) {
  const [selectedOption, setSelectedOption] = useState<number | null>(null);
  const [isVoting, setIsVoting] = useState(false);
  const [showConfetti, setShowConfetti] = useState(false);
  const [timeLeft, setTimeLeft] = useState<string>('');
  const { voteOnPoll, userVotes } = useChatStore();

  const userVote = userVotes[poll.id] ?? poll.user_vote;
  const hasVoted = userVote !== null && userVote !== undefined;
  const isExpired = poll.is_closed || new Date(poll.closes_at) < new Date();
  const totalVotes = poll.total_votes || 0;

  // Update countdown timer
  useEffect(() => {
    if (isExpired) return;

    const updateTimer = () => {
      const now = new Date();
      const closesAt = new Date(poll.closes_at);
      const diff = closesAt.getTime() - now.getTime();

      if (diff <= 0) {
        setTimeLeft('Closed');
        return;
      }

      const hours = Math.floor(diff / (1000 * 60 * 60));
      const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));

      if (hours > 0) {
        setTimeLeft(`${hours}h ${minutes}m left`);
      } else {
        setTimeLeft(`${minutes}m left`);
      }
    };

    updateTimer();
    const interval = setInterval(updateTimer, 60000); // Update every minute

    return () => clearInterval(interval);
  }, [poll.closes_at, isExpired]);

  const handleVote = async (optionIndex: number) => {
    if (hasVoted || isExpired || isVoting) return;

    setIsVoting(true);
    setSelectedOption(optionIndex);

    try {
      await voteOnPoll(poll.id, optionIndex);
      
      // Show confetti celebration
      setShowConfetti(true);
      setTimeout(() => setShowConfetti(false), 2000);
      
      toast.success('Vote submitted successfully!');
    } catch (error: any) {
      toast.error(error.message || 'Failed to submit vote');
      setSelectedOption(null);
    } finally {
      setIsVoting(false);
    }
  };

  const getOptionPercentage = (optionIndex: number) => {
    if (!poll.vote_counts || totalVotes === 0) return 0;
    return Math.round((poll.vote_counts[optionIndex] / totalVotes) * 100);
  };

  const getOptionVotes = (optionIndex: number) => {
    return poll.vote_counts?.[optionIndex] || 0;
  };

  return (
    <Card className={cn("glass-card border-border/50 shadow-lg relative overflow-hidden", className)}>
      {showConfetti && <Confetti />}
      
      <CardContent className="p-4 space-y-4">
        {/* Poll Header */}
        <div className="flex items-start justify-between">
          <div className="flex items-center space-x-2">
            <div className="flex items-center justify-center w-8 h-8 bg-gradient-to-br from-green-500 to-green-600 rounded-lg shadow-md">
              <BarChart3 className="w-4 h-4 text-white" />
            </div>
            <div>
              <Badge variant="secondary" className="text-xs bg-green-500/20 text-green-600 border-green-500/20">
                Anonymous Poll
              </Badge>
            </div>
          </div>
          
          <div className="flex items-center space-x-2 text-xs text-muted-foreground">
            <Clock className="w-3 h-3" />
            <span>{isExpired ? 'Closed' : timeLeft}</span>
          </div>
        </div>

        {/* Question */}
        <div className="space-y-2">
          <h3 className="font-semibold text-base leading-relaxed">
            {poll.question}
          </h3>
          
          {/* Poll Stats */}
          <div className="flex items-center space-x-4 text-sm text-muted-foreground">
            <div className="flex items-center space-x-1">
              <Users className="w-3 h-3" />
              <motion.span
                key={totalVotes}
                initial={{ scale: 1.2, color: '#10b981' }}
                animate={{ scale: 1, color: 'inherit' }}
                transition={{ duration: 0.3 }}
              >
                {totalVotes} {totalVotes === 1 ? 'vote' : 'votes'}
              </motion.span>
            </div>
            <div className="flex items-center space-x-1">
              <span>•</span>
              <span>
                {formatDistanceToNow(new Date(poll.created_at), { addSuffix: true })}
              </span>
            </div>
          </div>
        </div>

        {/* Poll Options */}
        <div className="space-y-3">
          <AnimatePresence>
            {(Array.isArray(poll.options) ? poll.options : []).map((option: string, index: number) => {
              const percentage = getOptionPercentage(index);
              const votes = getOptionVotes(index);
              const isSelected = selectedOption === index;
              const isUserVote = userVote === index;
              const showResults = hasVoted || isExpired;

              return (
                <motion.div
                  key={index}
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: index * 0.1 }}
                  className="relative"
                >
                  <Button
                    variant="outline"
                    onClick={() => handleVote(index)}
                    disabled={hasVoted || isExpired || isVoting}
                    className={cn(
                      "w-full h-auto p-0 overflow-hidden transition-all duration-300 border-border/50",
                      !hasVoted && !isExpired && "hover:border-green-500/50 hover:shadow-md hover:scale-[1.02] poll-option",
                      isSelected && "border-green-500/50 shadow-md scale-[1.02] poll-vote-success",
                      isUserVote && "border-green-500 bg-green-500/10",
                      hasVoted || isExpired ? "cursor-default" : "cursor-pointer"
                    )}
                  >
                    <div className="relative w-full p-3">
                      {/* Background progress bar */}
                      {showResults && (
                        <motion.div
                          initial={{ width: 0 }}
                          animate={{ width: `${percentage}%` }}
                          transition={{ duration: 1, ease: 'easeOut' }}
                          className="absolute inset-0 bg-gradient-to-r from-green-500/20 to-green-600/20 rounded-lg poll-progress-bar"
                          style={{ '--progress-width': `${percentage}%` } as any}
                        />
                      )}
                      
                      {/* Option content */}
                      <div className="relative flex items-center justify-between">
                        <div className="flex items-center space-x-3">
                          <div className={cn(
                            "flex items-center justify-center w-6 h-6 rounded-full text-xs font-medium transition-colors",
                            isUserVote 
                              ? "bg-green-500 text-white" 
                              : showResults 
                                ? "bg-muted text-muted-foreground"
                                : "bg-muted/50 text-muted-foreground"
                          )}>
                            {isUserVote ? (
                              <CheckCircle className="w-3 h-3" />
                            ) : (
                              String.fromCharCode(65 + index)
                            )}
                          </div>
                          <span className="text-sm font-medium text-left">
                            {option}
                          </span>
                        </div>
                        
                        {showResults && (
                          <div className="flex items-center space-x-2 text-xs">
                            <motion.span
                              key={`votes-${votes}`}
                              initial={{ opacity: 0, y: 10 }}
                              animate={{ opacity: 1, y: 0 }}
                              transition={{ delay: 0.5 }}
                              className="font-medium number-count"
                            >
                              {votes} {votes === 1 ? 'vote' : 'votes'}
                            </motion.span>
                            <motion.span
                              key={`percentage-${percentage}`}
                              initial={{ opacity: 0, scale: 0.8 }}
                              animate={{ opacity: 1, scale: 1 }}
                              transition={{ delay: 0.7, type: 'spring' }}
                              className="font-bold text-green-600 number-count"
                            >
                              {percentage}%
                            </motion.span>
                          </div>
                        )}
                      </div>
                      
                      {/* Loading indicator */}
                      {isVoting && isSelected && (
                        <motion.div
                          initial={{ opacity: 0 }}
                          animate={{ opacity: 1 }}
                          className="absolute inset-0 bg-green-500/10 flex items-center justify-center rounded-lg"
                        >
                          <div className="w-4 h-4 border-2 border-green-500 border-t-transparent rounded-full animate-spin"></div>
                        </motion.div>
                      )}
                    </div>
                  </Button>
                </motion.div>
              );
            })}
          </AnimatePresence>
        </div>

        {/* Poll Status */}
        <div className="pt-2 border-t border-border/50">
          <div className="flex items-center justify-between text-xs text-muted-foreground">
            <div className="flex items-center space-x-2">
              {hasVoted && (
                <motion.div
                  initial={{ opacity: 0, scale: 0.8 }}
                  animate={{ opacity: 1, scale: 1 }}
                  className="flex items-center space-x-1 text-green-600"
                >
                  <CheckCircle className="w-3 h-3" />
                  <span>You voted</span>
                </motion.div>
              )}
              {isExpired && (
                <Badge variant="secondary" className="text-xs bg-muted">
                  Poll Closed
                </Badge>
              )}
            </div>
            
            <div className="flex items-center space-x-1">
              <Sparkles className="w-3 h-3" />
              <span>Anonymous voting</span>
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}