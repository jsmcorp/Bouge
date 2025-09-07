import * as React from 'react';
import { cn } from '@/lib/utils';

type BubbleBadgeType = 'anony' | 'funny' | 'confession' | 'neutral';

interface BubbleBadgeProps extends React.HTMLAttributes<HTMLSpanElement> {
  type?: BubbleBadgeType;
  children?: React.ReactNode;
}

export function BubbleBadge({ type = 'neutral', className, children, ...props }: BubbleBadgeProps) {
  const base = 'inline-flex items-center rounded-md border px-2 py-0.5 text-xs font-medium';
  const typeClass =
    type === 'anony'
      ? 'badge-anony-ultra'
      : type === 'funny'
      ? 'badge-funny-ultra'
      : type === 'confession'
      ? 'badge-confession-ultra'
      : 'bg-muted/40 text-muted-foreground border-border/50';

  return (
    <span className={cn(base, typeClass, className)} {...props}>
      {children}
    </span>
  );
}


