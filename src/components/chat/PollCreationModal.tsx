import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Plus, X, BarChart3, Sparkles } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { toast } from 'sonner';
import { useChatStore } from '@/store/chatStore';

interface PollCreationModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function PollCreationModal({ open, onOpenChange }: PollCreationModalProps) {
  const [question, setQuestion] = useState('');
  const [options, setOptions] = useState(['', '']);
  const [isLoading, setIsLoading] = useState(false);
  const { activeGroup, createPoll } = useChatStore();

  const handleAddOption = () => {
    if (options.length < 6) {
      setOptions([...options, '']);
    }
  };

  const handleRemoveOption = (index: number) => {
    if (options.length > 2) {
      setOptions(options.filter((_, i) => i !== index));
    }
  };

  const handleOptionChange = (index: number, value: string) => {
    const newOptions = [...options];
    newOptions[index] = value;
    setOptions(newOptions);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!question.trim() || !activeGroup) return;

    const validOptions = options.filter(opt => opt.trim());
    if (validOptions.length < 2) {
      toast.error('Please provide at least 2 options');
      return;
    }

    setIsLoading(true);
    try {
      await createPoll(activeGroup.id, question.trim(), validOptions);
      toast.success('Poll created successfully!');
      onOpenChange(false);
      
      // Reset form
      setQuestion('');
      setOptions(['', '']);
    } catch (error: any) {
      toast.error(error.message || 'Failed to create poll');
    } finally {
      setIsLoading(false);
    }
  };

  const handleClose = () => {
    if (!isLoading) {
      onOpenChange(false);
      // Reset form after a delay to avoid visual glitch
      setTimeout(() => {
        setQuestion('');
        setOptions(['', '']);
      }, 300);
    }
  };

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="sm:max-w-md glass-card border-border/50 shadow-2xl">
        <DialogHeader>
          <div className="flex items-center space-x-3">
            <motion.div
              initial={{ scale: 0, rotate: -180 }}
              animate={{ scale: 1, rotate: 0 }}
              transition={{ type: 'spring', stiffness: 200 }}
              className="relative"
            >
              <div className="absolute inset-0 bg-gradient-to-r from-green-500 to-green-600 rounded-xl blur-lg opacity-30 animate-pulse"></div>
              <div className="relative flex items-center justify-center w-10 h-10 bg-gradient-to-br from-green-500 to-green-600 rounded-xl shadow-lg">
                <BarChart3 className="w-5 h-5 text-white" />
              </div>
              <motion.div
                animate={{ rotate: 360 }}
                transition={{ duration: 20, repeat: Infinity, ease: "linear" }}
                className="absolute -top-1 -right-1"
              >
                <Sparkles className="w-4 h-4 text-green-400" />
              </motion.div>
            </motion.div>
            <div>
              <DialogTitle className="text-xl font-bold">Create Anonymous Poll</DialogTitle>
              <DialogDescription className="text-base">
                Ask your group a question and get instant feedback
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>
        
        <form onSubmit={handleSubmit} className="space-y-6 mt-6">
          {/* Question Input */}
          <div className="space-y-2">
            <Label htmlFor="question" className="text-sm font-medium">
              Poll Question
            </Label>
            <Input
              id="question"
              placeholder="What would you like to ask?"
              value={question}
              onChange={(e) => setQuestion(e.target.value)}
              maxLength={200}
              className="h-12 text-base rounded-xl border-border/50 focus:border-green-500/50 focus:ring-green-500/20"
              required
            />
            <div className="flex justify-between items-center">
              <p className="text-xs text-muted-foreground">
                Make it clear and engaging
              </p>
              <span className="text-xs text-muted-foreground">
                {question.length}/200
              </span>
            </div>
          </div>

          {/* Options */}
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <Label className="text-sm font-medium">Poll Options</Label>
              <Badge variant="secondary" className="text-xs">
                {options.filter(opt => opt.trim()).length} options
              </Badge>
            </div>
            
            <AnimatePresence>
              {options.map((option, index) => (
                <motion.div
                  key={index}
                  initial={{ opacity: 0, height: 0, y: -10 }}
                  animate={{ opacity: 1, height: 'auto', y: 0 }}
                  exit={{ opacity: 0, height: 0, y: -10 }}
                  transition={{ duration: 0.2 }}
                  className="flex items-center space-x-2"
                >
                  <div className="flex items-center justify-center w-6 h-6 bg-muted/50 rounded-full text-xs font-medium">
                    {index + 1}
                  </div>
                  <Input
                    placeholder={`Option ${index + 1}`}
                    value={option}
                    onChange={(e) => handleOptionChange(index, e.target.value)}
                    maxLength={100}
                    className="flex-1 h-10 rounded-lg border-border/50 focus:border-green-500/50"
                  />
                  {options.length > 2 && (
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() => handleRemoveOption(index)}
                      className="h-10 w-10 p-0 hover:bg-red-500/10 hover:text-red-500 rounded-lg"
                    >
                      <X className="w-4 h-4" />
                    </Button>
                  )}
                </motion.div>
              ))}
            </AnimatePresence>

            {/* Add Option Button */}
            {options.length < 6 && (
              <motion.div
                whileHover={{ scale: 1.02 }}
                whileTap={{ scale: 0.98 }}
              >
                <Button
                  type="button"
                  variant="outline"
                  onClick={handleAddOption}
                  className="w-full h-10 rounded-lg border-dashed border-border/50 hover:border-green-500/50 hover:bg-green-500/5 transition-all duration-200"
                >
                  <Plus className="w-4 h-4 mr-2" />
                  Add Option
                </Button>
              </motion.div>
            )}
            
            <p className="text-xs text-muted-foreground">
              Add 2-6 options for your poll. Polls automatically close after 24 hours.
            </p>
          </div>

          {/* Action Buttons */}
          <div className="flex space-x-3 pt-4">
            <Button
              type="button"
              variant="outline"
              onClick={handleClose}
              disabled={isLoading}
              className="flex-1 h-12 rounded-xl border-border/50 hover:bg-muted/50"
            >
              Cancel
            </Button>
            <Button
              type="submit"
              disabled={isLoading || !question.trim() || options.filter(opt => opt.trim()).length < 2}
              className="flex-1 h-12 rounded-xl btn-modern"
            >
              {isLoading ? (
                <div className="flex items-center space-x-2">
                  <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
                  <span>Creating...</span>
                </div>
              ) : (
                <div className="flex items-center space-x-2">
                  <BarChart3 className="w-4 h-4" />
                  <span>Create Poll</span>
                </div>
              )}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}