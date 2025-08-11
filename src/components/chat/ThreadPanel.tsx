import { useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X, MessageCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Separator } from '@/components/ui/separator';
import { Badge } from '@/components/ui/badge';
import { useChatStore } from '@/store/chatStore';
import { MessageBubble } from '@/components/chat/MessageBubble';
import { ChatInput } from '@/components/chat/ChatInput';

export function ThreadPanel() {
  const { 
    activeThread, 
    threadReplies, 
    isThreadLoading, 
    closeThread 
  } = useChatStore();
  const scrollRef = useRef<HTMLDivElement>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  // Auto-scroll to bottom when new replies arrive - instant scroll
  useEffect(() => {
    if (messagesEndRef.current) {
      messagesEndRef.current.scrollIntoView({ 
        behavior: 'instant',
        block: 'end'
      });
    }
  }, [threadReplies]);

  if (!activeThread) return null;

  return (
    <motion.div
      initial={{ x: '100%', opacity: 0 }}
      animate={{ x: 0, opacity: 1 }}
      exit={{ x: '100%', opacity: 0 }}
      transition={{ type: 'spring', stiffness: 300, damping: 30 }}
      className="w-80 h-full bg-card/30 backdrop-blur-sm border-l border-border/50 flex flex-col"
    >
      {/* Header */}
      <div className="flex-shrink-0 flex items-center justify-between p-3 border-b border-border/50 bg-card/20">
        <div className="flex items-center space-x-2">
          <div className="flex items-center justify-center w-6 h-6 bg-green-500/20 rounded-md">
            <MessageCircle className="w-3 h-3 text-green-500" />
          </div>
          <div>
            <h3 className="font-medium text-sm">Thread</h3>
            <p className="text-xs text-muted-foreground">
              {threadReplies.length} {threadReplies.length === 1 ? 'reply' : 'replies'}
            </p>
          </div>
        </div>
        <Button
          variant="ghost"
          size="sm"
          onClick={closeThread}
          className="h-6 w-6 p-0 hover:bg-muted/50"
        >
          <X className="w-3 h-3" />
        </Button>
      </div>

      {/* Thread Content */}
      <div className="flex-1 flex flex-col overflow-hidden">
        <ScrollArea className="flex-1" ref={scrollRef}>
          <div className="p-3 space-y-3">
            {/* Original Message */}
            <div className="pb-2">
              <div className="text-xs text-muted-foreground mb-2 uppercase tracking-wide font-medium">
                Original Message
              </div>
              <MessageBubble 
                message={activeThread} 
                isThreadOriginal={true}
                showInlineReplies={false}
              />
            </div>

            <Separator className="my-2" />

            {/* Replies */}
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <div className="text-xs text-muted-foreground uppercase tracking-wide font-medium">
                  Replies ({threadReplies.length})
                </div>
                {threadReplies.length > 0 && (
                  <Badge variant="secondary" className="text-xs">
                    {threadReplies.length}
                  </Badge>
                )}
              </div>
              
              {isThreadLoading ? (
                <div className="flex items-center justify-center py-6">
                  <div className="animate-spin w-5 h-5 border-2 border-green-500 border-t-transparent rounded-full"></div>
                </div>
              ) : threadReplies.length === 0 ? (
                <div className="text-center py-6">
                  <MessageCircle className="w-6 h-6 text-muted-foreground mx-auto mb-2" />
                  <p className="text-sm text-muted-foreground">No replies yet</p>
                  <p className="text-xs text-muted-foreground">
                    Be the first to reply!
                  </p>
                </div>
              ) : (
                <div className="space-y-3">
                  <AnimatePresence>
                    {threadReplies.map((reply, index) => (
                      <motion.div
                        key={reply.id}
                        initial={{ opacity: 0, y: 10 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0, y: -10 }}
                        transition={{ delay: index * 0.03 }}
                      >
                        <MessageBubble 
                          message={reply} 
                          isThreadReply={true}
                          showInlineReplies={false}
                        />
                      </motion.div>
                    ))}
                  </AnimatePresence>
                  {/* Invisible element to scroll to */}
                  <div ref={messagesEndRef} className="h-1" />
                </div>
              )}
            </div>
          </div>
        </ScrollArea>

        {/* Reply Input */}
        <div className="flex-shrink-0 border-t border-border/50 bg-card/20">
          <div className="p-2">
            <div className="text-xs text-muted-foreground mb-2 font-medium">
              Reply to thread
            </div>
            <ChatInput 
              isInThread={true}
              showEmojiPanel={false}
              setShowEmojiPanel={() => {}}
            />
          </div>
        </div>
      </div>
    </motion.div>
  );
}