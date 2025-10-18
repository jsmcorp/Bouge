import { useState, useRef, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Ghost, X, Reply, BarChart3, Keyboard } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import ghostIconSVG from '@/assets/ghosticon.svg';
import sendIconSVG from '@/assets/sendicon.svg';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { toast } from 'sonner';
import { useChatStore } from '@/store/chatStore';
import { PollCreationModal } from '@/components/chat/PollCreationModal';
import { Keyboard as CapacitorKeyboard } from '@capacitor/keyboard';
import { useIsMobile } from '@/hooks/useMediaQuery';

const CONFESSION_CATEGORIES = [
  { value: 'funny', label: 'Funny', color: 'bg-yellow-500/20 text-yellow-500' },
  { value: 'serious', label: 'Serious', color: 'bg-red-500/20 text-red-500' },
  { value: 'advice', label: 'Advice', color: 'bg-blue-500/20 text-blue-500' },
  { value: 'support', label: 'Support', color: 'bg-purple-500/20 text-purple-500' },
];

interface ChatInputProps {
  isInThread?: boolean;
  showEmojiPanel?: boolean;
  setShowEmojiPanel?: (show: boolean) => void;
}

export function ChatInput({
  isInThread = false,
  showEmojiPanel = false,
  setShowEmojiPanel
}: ChatInputProps) {
  const [message, setMessage] = useState('');
  const [isLoading] = useState(false);
  const [selectedImage, setSelectedImage] = useState<File | null>(null);
  const [imagePreview, setImagePreview] = useState<string | null>(null);
  const [messageType, setMessageType] = useState<'text' | 'confession' | 'poll'>('text');
  const [category, setCategory] = useState<string>('');
  const [isTyping, setIsTyping] = useState(false);
  const [showPollModal, setShowPollModal] = useState(false);
  const [showSendOptions, setShowSendOptions] = useState(false);
  const isMobile = useIsMobile();
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const typingTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const sendButtonLongPressRef = useRef<NodeJS.Timeout | null>(null);
  const ghostButtonLongPressRef = useRef<NodeJS.Timeout | null>(null);
  const maxLines = 6;
  
  const { 
    activeGroup, 
    mainChatGhostMode,
    threadGhostMode,
    toggleMainChatGhostMode,
    toggleThreadGhostMode,
    sendMessage, 
    replyingTo, 
    setReplyingTo,
    sendTypingStatus,
    connectionStatus,
    uploadingFile,
  } = useChatStore();

  const currentGhostMode = isInThread ? threadGhostMode : mainChatGhostMode;
  const toggleGhostMode = isInThread ? toggleThreadGhostMode : toggleMainChatGhostMode;

  // Handle typing indicators
  const handleTypingStart = () => {
    if (!isTyping) {
      setIsTyping(true);
      const isGhost = messageType === 'confession' ? true : currentGhostMode;
      sendTypingStatus(true, isGhost);
    }

    // Clear existing timeout
    if (typingTimeoutRef.current) {
      clearTimeout(typingTimeoutRef.current);
    }

    // Set new timeout to stop typing after 1 second of inactivity
    typingTimeoutRef.current = setTimeout(() => {
      setIsTyping(false);
      const isGhost = messageType === 'confession' ? true : currentGhostMode;
      sendTypingStatus(false, isGhost);
    }, 1000);
  };

  // Autosize textarea up to maxLines, keep compact when empty (ignore placeholder wrapping)
  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    const adjust = () => {
      el.style.height = 'auto';
      const style = window.getComputedStyle(el);
      const lineHeight = parseFloat(style.lineHeight || '20');
      const paddingTop = parseFloat(style.paddingTop || '0');
      const paddingBottom = parseFloat(style.paddingBottom || '0');
      const oneLineHeight = lineHeight + paddingTop + paddingBottom;
      const maxHeight = lineHeight * maxLines + paddingTop + paddingBottom;

      const targetHeight = el.value
        ? Math.min(el.scrollHeight, maxHeight)
        : oneLineHeight;

      el.style.height = `${targetHeight}px`;
      el.style.overflowY = el.scrollHeight > maxHeight ? 'auto' : 'hidden';
    };
    requestAnimationFrame(adjust);
  }, [message]);

  const handleTypingStop = () => {
    if (typingTimeoutRef.current) {
      clearTimeout(typingTimeoutRef.current);
    }
    
    if (isTyping) {
      setIsTyping(false);
      const isGhost = messageType === 'confession' ? true : currentGhostMode;
      sendTypingStatus(false, isGhost);
    }
  };

  // Cleanup typing timeout on unmount
  useEffect(() => {
    return () => {
      if (typingTimeoutRef.current) {
        clearTimeout(typingTimeoutRef.current);
      }
    };
  }, []);

  const handleImageSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    // Validate file type
    if (!file.type.startsWith('image/')) {
      toast.error('Please select an image file');
      return;
    }

    // Validate file size (max 10MB)
    if (file.size > 10 * 1024 * 1024) {
      toast.error('Image size must be less than 10MB');
      return;
    }

    setSelectedImage(file);
    
    // Create preview URL
    const previewUrl = URL.createObjectURL(file);
    setImagePreview(previewUrl);
    
    // Clear the file input
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  const clearSelectedImage = () => {
    if (imagePreview) {
      URL.revokeObjectURL(imagePreview);
    }
    setSelectedImage(null);
    setImagePreview(null);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    console.log('📤 Send button clicked, processing message...', { message: message.trim(), activeGroup: !!activeGroup, isLoading, uploadingFile });
    
    // Keep the keyboard open by ensuring the textarea retains focus immediately on submit
    if (textareaRef.current) {
      textareaRef.current.focus();
    }
    if ((!message.trim() && !selectedImage) || !activeGroup || uploadingFile) {
      console.log('❌ Send blocked:', { hasMessage: !!message.trim(), hasImage: !!selectedImage, hasActiveGroup: !!activeGroup, isLoading, uploadingFile });
      return;
    }
    
    handleTypingStop(); // Stop typing indicator immediately
    
    const isGhost = messageType === 'confession' ? true : currentGhostMode;
    const messageContent = selectedImage ? (message.trim() || 'Image') : message.trim();
    
    console.log('📤 About to send message:', { messageContent, isGhost, connectionStatus });
    
    try {
      // Fire-and-forget: optimistic send should update UI immediately
      sendMessage(
        activeGroup.id,
        messageContent,
        isGhost,
        selectedImage ? 'image' : messageType,
        category || null,
        replyingTo?.id || null,
        null,
        selectedImage
      ).catch((error) => console.error('❌ sendMessage promise rejected:', error));
      
      console.log('✅ Message dispatched, clearing input');
      // Clear input immediately (optimistic UI)
      setMessage('');
      setMessageType('text');
      setCategory('');
      clearSelectedImage();
      
      // Focus back to textarea after sending
      if (textareaRef.current) {
        textareaRef.current.focus();
      }
    } catch (error) {
      console.error('❌ Send message error:', error);
      
      // Always clear input since optimistic message should have been added
      console.log('📝 Clearing input after error (optimistic message should be visible)');
      setMessage('');
      setMessageType('text');
      setCategory('');
      clearSelectedImage();
      
      // Focus back to textarea
      if (textareaRef.current) {
        textareaRef.current.focus();
      }
      
      // Only show error toast when online and there's a real error
      if (connectionStatus !== 'disconnected') {
        toast.error('Failed to send message. Please try again.');
      }
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    // Submit on Enter (but not with shift key for new line)
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSubmit(e as unknown as React.FormEvent<HTMLFormElement>);
    } else {
      handleTypingStart();
    }
  };

  const handleInputChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setMessage(e.target.value);
    if (e.target.value.trim()) {
      handleTypingStart();
    } else {
      handleTypingStop();
    }
  };

  const cancelReply = () => {
    setReplyingTo(null);
  };

  const handleCreatePoll = () => {
    setShowPollModal(true);
  };

  const handleTextareaFocus = () => {
    if (isMobile && setShowEmojiPanel && showEmojiPanel) {
      setShowEmojiPanel(false);
    }
  };

  // Long-press handlers for send button
  const handleSendButtonLongPressStart = () => {
    sendButtonLongPressRef.current = setTimeout(() => {
      setShowSendOptions(true);
    }, 500); // 500ms long press
  };

  const handleSendButtonLongPressEnd = () => {
    if (sendButtonLongPressRef.current) {
      clearTimeout(sendButtonLongPressRef.current);
      sendButtonLongPressRef.current = null;
    }
  };

  // Long-press handlers for ghost button (emoji picker)
  const handleGhostButtonLongPressStart = () => {
    ghostButtonLongPressRef.current = setTimeout(async () => {
      // Show emoji panel on long press
      if (isMobile && setShowEmojiPanel) {
        try {
          await CapacitorKeyboard.hide();
        } catch (error) {
          console.log('Keyboard hide not available or failed:', error);
        }
        setShowEmojiPanel(true);
      }
    }, 500); // 500ms long press
  };

  const handleGhostButtonLongPressEnd = () => {
    if (ghostButtonLongPressRef.current) {
      clearTimeout(ghostButtonLongPressRef.current);
      ghostButtonLongPressRef.current = null;
    }
  };

  // Click handler for ghost button (toggle ghost mode)
  const handleGhostButtonClick = () => {
    // Only toggle if not long-pressing
    if (!ghostButtonLongPressRef.current) {
      toggleGhostMode();
    }
  };

  // Close send options on click outside
  useEffect(() => {
    const handleClickOutside = () => {
      if (showSendOptions) {
        setShowSendOptions(false);
      }
    };

    if (showSendOptions) {
      document.addEventListener('click', handleClickOutside);
      return () => document.removeEventListener('click', handleClickOutside);
    }
  }, [showSendOptions]);

  return (
    <>
      <div className={`space-y-2 sm:space-y-3 ${isInThread ? 'p-1 sm:p-2' : 'p-2 sm:p-3'}`}>
        {/* Connection Status */}
        {connectionStatus !== 'connected' && (
          <motion.div
            initial={{ opacity: 0, y: -10 }}
            animate={{ opacity: 1, y: 0 }}
            className="flex items-center justify-center p-1 sm:p-2 bg-yellow-500/10 border border-yellow-500/20 rounded-lg"
          >
            <div className="flex items-center space-x-2">
              <div className="w-2 h-2 bg-yellow-500 rounded-full animate-pulse"></div>
              <span className="text-xs sm:text-sm text-yellow-600">
                {connectionStatus === 'connecting' && 'Connecting...'}
                {connectionStatus === 'reconnecting' && 'Reconnecting...'}
                {connectionStatus === 'disconnected' && 'Disconnected - Messages may not send'}
              </span>
            </div>
          </motion.div>
        )}

        {/* Reply Context */}
        <AnimatePresence>
          {replyingTo && !isInThread && (
            <motion.div
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: 'auto' }}
              exit={{ opacity: 0, height: 0 }}
              className="flex items-start space-x-3 p-3 bg-muted/30 rounded-lg border-l-4 border-l-green-500"
            >
              <Reply className="w-4 h-4 text-green-500 mt-1 flex-shrink-0" />
              <div className="flex-1 min-w-0">
                <div className="flex items-center space-x-2 mb-1">
                  <span className="text-sm font-medium text-green-500">
                    Replying to {replyingTo.is_ghost ? 'Ghost' : replyingTo.author?.display_name || 'Anonymous'}
                  </span>
                </div>
                <p className="text-sm text-muted-foreground truncate">
                  {replyingTo.content}
                </p>
              </div>
              <Button
                variant="ghost"
                size="sm"
                className="h-6 w-6 p-0"
                onClick={cancelReply}
              >
                <X className="w-3 h-3" />
              </Button>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Image Preview */}
        <AnimatePresence>
          {selectedImage && imagePreview && (
            <motion.div
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: 'auto' }}
              exit={{ opacity: 0, height: 0 }}
              className="relative"
            >
              <div className="relative bg-muted/30 rounded-lg p-3 border border-border/50">
                <div className="flex items-start space-x-3">
                  <div className="relative">
                    <img
                      src={imagePreview}
                      alt="Selected image"
                      className="w-20 h-20 object-cover rounded-lg border border-border/50"
                    />
                    {uploadingFile && (
                      <div className="absolute inset-0 bg-black/50 rounded-lg flex items-center justify-center">
                        <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
                      </div>
                    )}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-foreground">
                      {selectedImage.name}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {(selectedImage.size / 1024 / 1024).toFixed(2)} MB
                    </p>
                    {uploadingFile && (
                      <p className="text-xs text-primary mt-1">
                        Compressing and uploading...
                      </p>
                    )}
                  </div>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={clearSelectedImage}
                    disabled={uploadingFile}
                    className="h-6 w-6 p-0"
                  >
                    <X className="w-3 h-3" />
                  </Button>
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Message Type & Category */}
        {messageType === 'confession' && !isInThread && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            className="flex items-center space-x-2"
          >
            <Badge variant="secondary" className="bg-green-500/20 text-green-500">
              Anonymous Confession
            </Badge>
            <Select value={category} onValueChange={setCategory}>
              <SelectTrigger className="w-32">
                <SelectValue placeholder="Category" />
              </SelectTrigger>
              <SelectContent>
                {CONFESSION_CATEGORIES.map((cat) => (
                  <SelectItem key={cat.value} value={cat.value}>
                    <div className="flex items-center space-x-2">
                      <div className={`w-2 h-2 rounded-full ${cat.color.split(' ')[0]}`} />
                      <span>{cat.label}</span>
                    </div>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </motion.div>
        )}

        {/* iOS-Style Pixel-Perfect Input Bar */}
        <form onSubmit={handleSubmit} className="ios-input-bar">
          {/* Hidden file input */}
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            onChange={handleImageSelect}
            className="hidden"
          />

          {/* Ghost Emoji Button */}
          <button
            type="button"
            onClick={handleGhostButtonClick}
            onPointerDown={handleGhostButtonLongPressStart}
            onPointerUp={handleGhostButtonLongPressEnd}
            onPointerLeave={handleGhostButtonLongPressEnd}
            onMouseDown={(e) => e.preventDefault()}
            onTouchStart={(e) => {
              // Allow touch but prevent focus
              e.currentTarget.style.outline = 'none';
            }}
            tabIndex={-1}
            className={`ios-input-bar__emoji-btn ${currentGhostMode ? 'ghost-active' : ''}`}
            title={currentGhostMode ? 'Ghost Mode ON' : 'Ghost Mode OFF'}
          >
            {isMobile && showEmojiPanel ? (
              <Keyboard className="w-8 h-8 text-gray-700" />
            ) : (
              <img src={ghostIconSVG} alt="Ghost Mode" />
            )}
          </button>

          {/* Text Input Field */}
          <input
            ref={textareaRef as any}
            type="text"
            value={message}
            onChange={(e) => {
              setMessage(e.target.value);
              handleInputChange(e as any);
            }}
            onKeyDown={handleKeyDown as any}
            onBlur={handleTypingStop}
            onFocus={handleTextareaFocus}
            placeholder="Share something..."
            className="ios-input-bar__text"
            maxLength={2000}
            disabled={uploadingFile}
          />

          {/* Send Button */}
          <button
            type="submit"
            disabled={(!message.trim() && !selectedImage) || isLoading || uploadingFile || (connectionStatus === 'disconnected' && !!selectedImage)}
            onPointerDown={handleSendButtonLongPressStart}
            onPointerUp={handleSendButtonLongPressEnd}
            onPointerLeave={handleSendButtonLongPressEnd}
            onMouseDown={(e) => e.preventDefault()}
            onTouchStart={(e) => {
              // Allow touch but prevent focus
              e.currentTarget.style.outline = 'none';
            }}
            tabIndex={-1}
            className="ios-input-bar__send-btn"
          >
            <img src={sendIconSVG} alt="Send" />
          </button>

          {/* Send Options Popup - Long Press Menu */}
          <AnimatePresence>
            {showSendOptions && (
              <motion.div
                initial={{ opacity: 0, y: 10, scale: 0.95 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, y: 10, scale: 0.95 }}
                transition={{ duration: 0.15 }}
                className="absolute bottom-16 right-4 bg-white rounded-2xl shadow-xl border border-gray-200 overflow-hidden z-50"
              >
                <button
                  type="button"
                  onClick={() => {
                    setMessageType('confession');
                    setShowSendOptions(false);
                  }}
                  className="w-full px-4 py-3 flex items-center gap-3 hover:bg-gray-50 transition-colors text-left"
                >
                  <Ghost className="w-5 h-5 text-green-600" />
                  <span className="text-sm font-medium text-gray-900">Anonymous Confession</span>
                </button>
                <div className="h-px bg-gray-100" />
                <button
                  type="button"
                  onClick={() => {
                    handleCreatePoll();
                    setShowSendOptions(false);
                  }}
                  className="w-full px-4 py-3 flex items-center gap-3 hover:bg-gray-50 transition-colors text-left"
                >
                  <BarChart3 className="w-5 h-5 text-blue-600" />
                  <span className="text-sm font-medium text-gray-900">Create Poll</span>
                </button>
              </motion.div>
            )}
          </AnimatePresence>
        </form>
      </div>

      {/* Poll Creation Modal */}
      <PollCreationModal
        open={showPollModal}
        onOpenChange={setShowPollModal}
      />
    </>
  );
}