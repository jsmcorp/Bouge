import * as React from 'react';
import { Button } from '@/components/ui/button';
import { Reply } from 'lucide-react';
import { cn } from '@/lib/utils';

interface ReactionBarProps {
  onReply?: (e?: React.MouseEvent) => void;
  className?: string;
  children?: React.ReactNode; // extra actions
}

export function ReactionBar({ onReply, className, children }: ReactionBarProps) {
  return (
    <div className={cn('inline-flex items-center gap-2 rounded-full bg-muted/30 border border-border/50 px-3 py-1 text-xs text-muted-foreground', className)}>
      {children}
      <Button variant="ghost" size="sm" className="h-6 px-2 text-xs text-muted-foreground hover:text-foreground hover:bg-muted/40" onClick={onReply}>
        <Reply className="w-3 h-3 mr-1" /> Reply
      </Button>
    </div>
  );
}


