import { useState, useRef, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Send, Ghost, Image, Smile, Plus, X, Reply, BarChart3, Keyboard } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
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
  const [isLoading, setIsLoading] = useState(false);
  const [selectedImage, setSelectedImage] = useState<File | null>(null);
  const [imagePreview, setImagePreview] = useState<string | null>(null);
  const [messageType, setMessageType] = useState<'text' | 'confession' | 'poll'>('text');
  const [category, setCategory] = useState<string>('');
  const [isTyping, setIsTyping] = useState(false);
  const [showPollModal, setShowPollModal] = useState(false);
  const isMobile = useIsMobile();
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const typingTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  
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

  const handleImageButtonClick = () => {
    if (uploadingFile) return;
    fileInputRef.current?.click();
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if ((!message.trim() && !selectedImage) || !activeGroup || isLoading || uploadingFile) return;

    setIsLoading(true);
    handleTypingStop(); // Stop typing indicator immediately
    
    try {
      const isGhost = messageType === 'confession' ? true : currentGhostMode;
      
      const messageContent = selectedImage ? (message.trim() || 'Image') : message.trim();
      
      await sendMessage(
        activeGroup.id,
        messageContent,
        isGhost,
        selectedImage ? 'image' : messageType,
        category || null,
        replyingTo?.id || null,
        null,
        selectedImage
      );
      
      setMessage('');
      setMessageType('text');
      setCategory('');
      clearSelectedImage();
      
      // Focus back to textarea
      if (textareaRef.current) {
        textareaRef.current.focus();
      }
    } catch (error) {
      toast.error('Failed to send message. Please try again.');
    } finally {
      setIsLoading(false);
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
  
  const handleEmojiButtonClick = async () => {
    if (isMobile && setShowEmojiPanel) {
      if (showEmojiPanel) {
        // Switch from emoji panel to keyboard
        setShowEmojiPanel(false);
        // Focus textarea to bring up keyboard
        if (textareaRef.current) {
          textareaRef.current.focus();
        }
      } else {
        // Switch from keyboard to emoji panel
        try {
          await CapacitorKeyboard.hide();
        } catch (error) {
          console.log('Keyboard hide not available or failed:', error);
        }
        setShowEmojiPanel(true);
      }
    }
  };

  const handleTextareaFocus = () => {
    if (isMobile && setShowEmojiPanel && showEmojiPanel) {
      setShowEmojiPanel(false);
    }
  };

  const getPlaceholderText = () => {
    if (isInThread) {
      return 'Write your reply...';
    }
    if (selectedImage) {
      return 'Add a caption (optional)...';
    }
    if (replyingTo) {
      return 'Write your reply...';
    }
    switch (messageType) {
      case 'confession':
        return 'Share your confession anonymously...';
      case 'poll':
        return 'Create a poll to get group feedback...';
      default:
        return currentGhostMode 
          ? 'Send an anonymous message...' 
          : 'Type your message...';
    }
  };

  return (
    <>
      <div className={`space-y-3 ${isInThread ? 'p-2' : 'p-3'}`}>
        {/* Connection Status */}
        {connectionStatus !== 'connected' && (
          <motion.div
            initial={{ opacity: 0, y: -10 }}
            animate={{ opacity: 1, y: 0 }}
            className="flex items-center justify-center p-2 bg-yellow-500/10 border border-yellow-500/20 rounded-lg"
          >
            <div className="flex items-center space-x-2">
              <div className="w-2 h-2 bg-yellow-500 rounded-full animate-pulse"></div>
              <span className="text-sm text-yellow-600">
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

        {/* Ghost Mode Toggle */}
        {messageType === 'text' && !selectedImage && (
          <div className="flex items-center justify-between mb-2">
            <div className="flex items-center space-x-2">
              <Ghost className={`w-4 h-4 ${currentGhostMode ? 'text-green-500' : 'text-muted-foreground'}`} />
              <Label htmlFor={`ghost-mode-${isInThread ? 'thread' : 'main'}`} className="text-sm">
                Ghost Mode
              </Label>
              <Switch
                id={`ghost-mode-${isInThread ? 'thread' : 'main'}`}
                checked={currentGhostMode}
                onCheckedChange={toggleGhostMode}
              />
            </div>
            <div className="text-xs text-muted-foreground">
              {currentGhostMode ? 'Messages will be anonymous' : 'Messages will show your identity'}
            </div>
          </div>
        )}

      

        {/* Compact Input Bar */}
        <form onSubmit={handleSubmit} className={`message-input-area flex items-center gap-2 p-2 shadow-lg ${isInThread ? 'h-12' : 'h-14'}`}>
          {/* Hidden file input */}
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            onChange={handleImageSelect}
            className="hidden"
          />
          
          {/* Message Type Button */}
          {!replyingTo && !isInThread && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button 
                  type="button" 
                  variant="ghost" 
                  className={`${isInThread ? 'h-8 w-8' : 'h-10 w-10'} p-0 rounded-full hover:bg-muted/50`}
                >
                  <Plus className={isInThread ? "w-4 h-4" : "w-5 h-5"} />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start">
                <DropdownMenuItem onClick={() => setMessageType('text')}>
                  <Ghost className="w-4 h-4 mr-2" />
                  Regular Message
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => setMessageType('confession')}>
                  <Ghost className="w-4 h-4 mr-2 text-green-500" />
                  Anonymous Confession
                </DropdownMenuItem>
                <DropdownMenuItem onClick={handleCreatePoll}>
                  <BarChart3 className="w-4 h-4 mr-2 text-blue-500" />
                  Create Poll
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          )}

          {/* Emoji Button */}
          <Button
            type="button"
            variant="ghost"
            onClick={handleEmojiButtonClick}
            className={`${isInThread ? 'h-8 w-8' : 'h-10 w-10'} p-0 rounded-full hover:bg-muted/50`}
          >
            {isMobile && showEmojiPanel ? (
              <Keyboard className={isInThread ? "w-4 h-4" : "w-5 h-5"} />
            ) : (
              <Smile className={isInThread ? "w-4 h-4" : "w-5 h-5"} />
            )}
          </Button>

          {/* Text Input */}
          <Textarea
            ref={textareaRef}
            value={message}
            onChange={handleInputChange}
            onKeyDown={handleKeyDown}
            onBlur={handleTypingStop}
            onFocus={handleTextareaFocus}
            placeholder={getPlaceholderText()}
            className={`flex-1 min-h-0 ${isInThread ? 'h-8' : 'h-10'} py-2 px-4 rounded-3xl resize-none overflow-hidden ${isInThread ? 'text-sm' : 'text-base'} border-0 bg-transparent focus:ring-0 focus:outline-none ${
              connectionStatus !== 'connected' || uploadingFile ? 'opacity-75' : ''
            }`}
            maxLength={2000}
            disabled={connectionStatus === 'disconnected' || uploadingFile}
            rows={1}
          />

          {/* Image Button */}
          <Button
            type="button"
            variant="ghost"
            onClick={handleImageButtonClick}
            disabled={uploadingFile || connectionStatus === 'disconnected'}
            className={`${isInThread ? 'h-8 w-8' : 'h-10 w-10'} p-0 rounded-full hover:bg-muted/50`}
          >
            {uploadingFile ? (
              <div className={`border-2 border-muted-foreground border-t-transparent rounded-full animate-spin ${isInThread ? 'w-4 h-4' : 'w-5 h-5'}`} />
            ) : (
              <Image className={isInThread ? "w-4 h-4" : "w-5 h-5"} />
            )}
          </Button>

          {/* Send Button */}
          <Button
            type="submit"
            disabled={(!message.trim() && !selectedImage) || isLoading || uploadingFile || connectionStatus === 'disconnected'}
            size="sm"
            className={`send-button ${isInThread ? 'h-8 w-8' : 'h-10 w-10'} p-0 disabled:opacity-50`}
          >
            {isLoading || uploadingFile ? (
              <div className={`border-2 border-white border-t-transparent rounded-full animate-spin ${isInThread ? 'w-4 h-4' : 'w-5 h-5'}`} />
            ) : (
              <Send className={isInThread ? "w-4 h-4" : "w-5 h-5"} />
            )}
          </Button>
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