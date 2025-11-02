import { useState } from 'react';
import { Users } from 'lucide-react';
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
import { toast } from 'sonner';
import { useChatStore } from '@/store/chatStore';

interface JoinGroupDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function JoinGroupDialog({ open, onOpenChange }: JoinGroupDialogProps) {
  const [inviteCode, setInviteCode] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const { joinGroup } = useChatStore();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!inviteCode.trim()) return;

    setIsLoading(true);
    try {
      const result = await joinGroup(inviteCode.trim());

      // Show the message returned from the joinGroup function
      if (result.success) {
        toast.success(result.message || 'Join request sent! Waiting for admin approval.');
      }

      onOpenChange(false);
      setInviteCode('');
    } catch (error: any) {
      toast.error(error.message || 'Failed to join group. Please try again.');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <div className="flex items-center space-x-2">
            <div className="flex items-center justify-center w-10 h-10 bg-green-500/20 rounded-lg">
              <Users className="w-5 h-5 text-green-500" />
            </div>
            <div>
              <DialogTitle>Join a Group</DialogTitle>
              <DialogDescription>
                Enter the 6-digit invite code to join a group
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>
        
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="inviteCode">Invite Code</Label>
            <Input
              id="inviteCode"
              placeholder="ABC123"
              value={inviteCode}
              onChange={(e) => setInviteCode(e.target.value.toUpperCase())}
              maxLength={6}
              className="text-center text-lg font-mono tracking-wider"
              required
            />
            <p className="text-xs text-muted-foreground text-center">
              Ask a group member for the invite code
            </p>
          </div>

          <div className="flex justify-end space-x-2 pt-4">
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={isLoading}
            >
              Cancel
            </Button>
            <Button
              type="submit"
              disabled={isLoading || inviteCode.length !== 6}
              className="bg-gradient-to-r from-green-500 to-green-600 hover:from-green-600 hover:to-green-700"
            >
              {isLoading ? 'Joining...' : 'Join Group'}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}