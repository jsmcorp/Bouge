import { useState } from 'react';
import { X, Ghost, Loader2 } from 'lucide-react';
import { Capacitor } from '@capacitor/core';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { cn } from '@/lib/utils';
import { supabasePipeline } from '@/lib/supabasePipeline';
import { toast } from 'sonner';

interface CreateTopicModalProps {
  isOpen: boolean;
  onClose: () => void;
  groupId: string;
  onTopicCreated: () => void;
}

type TopicType = 'text' | 'news' | 'poll';

const TOPIC_TYPES: { value: TopicType; label: string }[] = [
  { value: 'text', label: 'Discussion' },
  { value: 'news', label: 'News' },
  { value: 'poll', label: 'Poll' },
];

const MAX_TITLE_LENGTH = 100;
const MAX_CONTENT_LENGTH = 1000;

export default function CreateTopicModal({
  isOpen,
  onClose,
  groupId,
  onTopicCreated,
}: CreateTopicModalProps) {
  const [type, setType] = useState<TopicType>('text');
  const [title, setTitle] = useState('');
  const [content, setContent] = useState('');
  const [isAnonymous, setIsAnonymous] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const isContentValid = content.trim().length > 0;
  const canSubmit = isContentValid && !isSubmitting;

  const handleClose = () => {
    if (!isSubmitting) {
      // Reset form state
      setType('text');
      setTitle('');
      setContent('');
      setIsAnonymous(false);
      onClose();
    }
  };

  const handleSubmit = async () => {
    if (!canSubmit) return;
    
    setIsSubmitting(true);
    try {
      // Get current user
      const { data: { user } } = await supabasePipeline.getUser();
      if (!user) {
        toast.error('Not authenticated. Please log in again.');
        return;
      }

      // CIRCULAR FK CONSTRAINT: topics.id references messages.id AND messages.topic_id references topics.id
      // Solution: Use same ID, insert message first (without topic_id), then topic, then update message
      const sharedId = crypto.randomUUID();

      const client = await supabasePipeline.getDirectClient();

      // Step 1: Insert message WITHOUT topic_id (to satisfy topics.id -> messages.id FK)
      const { error: messageError } = await client
        .from('messages')
        .insert({
          id: sharedId,
          group_id: groupId,
          user_id: user.id,
          content: content.trim(),
          is_ghost: isAnonymous,
          message_type: 'text',
          topic_id: null, // Will update after topic is created
        });

      if (messageError) {
        console.error('[CreateTopicModal] Message insert error:', messageError);
        throw messageError;
      }

      // Step 2: Insert topic with same ID (now message exists to satisfy FK)
      const { error: topicError } = await client
        .from('topics')
        .insert({
          id: sharedId,
          group_id: groupId,
          type: type,
          title: title.trim() || null,
          is_anonymous: isAnonymous,
        });

      if (topicError) {
        console.error('[CreateTopicModal] Topic insert error:', topicError);
        // Clean up the message
        await client.from('messages').delete().eq('id', sharedId);
        throw topicError;
      }

      // Step 3: Update message with topic_id reference
      const { error: updateError } = await client
        .from('messages')
        .update({ topic_id: sharedId })
        .eq('id', sharedId);

      if (updateError) {
        console.error('[CreateTopicModal] Message update error:', updateError);
        // Not critical - topic still works, just log it
      }

      console.log('[CreateTopicModal] Topic created successfully:', { id: sharedId });
      
      // Success: show toast, trigger refresh, close modal
      toast.success('Topic created successfully!');
      onTopicCreated();
      handleClose();
    } catch (error: any) {
      console.error('[CreateTopicModal] Error creating topic:', error);
      toast.error(error?.message || 'Failed to create topic. Please try again.');
    } finally {
      setIsSubmitting(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50">
      {/* Overlay */}
      <div 
        className="absolute inset-0 bg-black/50 animate-in fade-in duration-200"
        onClick={handleClose}
      />
      
      {/* Modal */}
      <div 
        className={cn(
          "absolute inset-x-0 bottom-0 bg-white rounded-t-2xl",
          "animate-in slide-in-from-bottom duration-300 ease-out",
          "flex flex-col max-h-[90vh]"
        )}
        style={{
          paddingBottom: Capacitor.getPlatform() === 'ios' ? 'env(safe-area-inset-bottom, 0px)' : undefined
        }}
      >
        {/* Header */}
        <div 
          className="flex items-center justify-between px-4 py-3 border-b border-slate-100"
          style={{
            paddingTop: Capacitor.getPlatform() === 'ios' ? 'calc(env(safe-area-inset-top, 0px) + 12px)' : undefined
          }}
        >
          <Button
            variant="ghost"
            size="icon"
            onClick={handleClose}
            disabled={isSubmitting}
            className="hover:bg-slate-100 rounded-full"
          >
            <X className="w-6 h-6 text-slate-600" />
          </Button>
          
          <h2 className="font-bold text-slate-900 text-lg">Create Topic</h2>
          
          <Button
            onClick={handleSubmit}
            disabled={!canSubmit}
            className={cn(
              "rounded-full px-5 py-2 font-semibold text-sm transition-colors",
              canSubmit 
                ? "bg-sky-500 hover:bg-sky-600 text-white" 
                : "bg-slate-200 text-slate-400 cursor-not-allowed"
            )}
          >
            {isSubmitting ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              'Post'
            )}
          </Button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto px-4 py-4 space-y-5">
          {/* Topic Type Selector */}
          <div className="flex gap-2">
            {TOPIC_TYPES.map((topicType) => (
              <button
                key={topicType.value}
                onClick={() => setType(topicType.value)}
                className={cn(
                  "px-4 py-2 rounded-full text-sm font-medium transition-colors",
                  type === topicType.value
                    ? "bg-sky-500 text-white"
                    : "bg-slate-100 text-slate-600 hover:bg-slate-200"
                )}
              >
                {topicType.label}
              </button>
            ))}
          </div>

          {/* Title Input */}
          <div className="space-y-2">
            <label className="text-sm font-medium text-slate-500">
              Title (optional)
            </label>
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value.slice(0, MAX_TITLE_LENGTH))}
              placeholder="Add a title..."
              className={cn(
                "w-full px-4 py-3 rounded-xl border border-slate-200",
                "bg-slate-50 text-slate-900 placeholder:text-slate-400",
                "focus:outline-none focus:ring-2 focus:ring-sky-500/20 focus:border-sky-500",
                "transition-colors"
              )}
              maxLength={MAX_TITLE_LENGTH}
            />
          </div>

          {/* Content Textarea */}
          <div className="space-y-2">
            <label className="text-sm font-medium text-slate-500">
              What's on your mind?
            </label>
            <textarea
              value={content}
              onChange={(e) => setContent(e.target.value.slice(0, MAX_CONTENT_LENGTH))}
              placeholder="Share your thoughts..."
              rows={6}
              className={cn(
                "w-full px-4 py-3 rounded-xl border border-slate-200",
                "bg-slate-50 text-slate-900 placeholder:text-slate-400",
                "focus:outline-none focus:ring-2 focus:ring-sky-500/20 focus:border-sky-500",
                "transition-colors resize-none"
              )}
              maxLength={MAX_CONTENT_LENGTH}
            />
            <div className="flex justify-end">
              <span className={cn(
                "text-xs font-medium",
                content.length >= MAX_CONTENT_LENGTH * 0.9 
                  ? "text-orange-500" 
                  : "text-slate-400"
              )}>
                {content.length}/{MAX_CONTENT_LENGTH}
              </span>
            </div>
          </div>

          {/* Anonymous Toggle */}
          <div className={cn(
            "flex items-center justify-between p-4 rounded-xl",
            "bg-slate-50 border border-slate-200"
          )}>
            <div className="flex items-center gap-3">
              <Ghost className={cn(
                "w-5 h-5 transition-colors",
                isAnonymous ? "text-purple-500" : "text-slate-400"
              )} />
              <span className="font-medium text-slate-700">Post Anonymously</span>
            </div>
            <Switch
              checked={isAnonymous}
              onCheckedChange={setIsAnonymous}
              className={cn(
                isAnonymous && "data-[state=checked]:bg-purple-500"
              )}
            />
          </div>
        </div>
      </div>
    </div>
  );
}
