import * as React from 'react';
import { cn } from '@/lib/utils';

interface ReactionBarProps {
  onReply?: (e?: React.MouseEvent) => void;
  className?: string;
  children?: React.ReactNode; // extra actions
}

export function ReactionBar({ className, children }: ReactionBarProps) {
  return (
    <div className={cn('inline-flex items-center gap-2 rounded-full bg-muted/30 border border-border/50 px-3 py-1 text-xs text-muted-foreground', className)}>
      {children}
      {/* Reply button removed - will be added back with long-press later */}
    </div>
  );
}


