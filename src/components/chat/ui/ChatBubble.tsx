import * as React from 'react';
import { cn } from '@/lib/utils';

type BubbleVariant = 'ghost' | 'anonymous' | 'user' | 'confession' | 'image';

interface ChatBubbleProps extends React.HTMLAttributes<HTMLDivElement> {
  variant?: BubbleVariant;
  align?: 'left' | 'right';
  children: React.ReactNode;
  isReply?: boolean;
}

export function ChatBubble({ variant = 'user', align = 'left', isReply, className, children, ...props }: ChatBubbleProps) {
  const variantClass =
    variant === 'ghost'
      ? 'chat-bubble-ghost-ultra'
      : variant === 'anonymous'
      ? 'chat-bubble-anonymous-ultra'
      : variant === 'confession'
      ? 'chat-bubble-confession-ultra'
      : variant === 'image'
      ? 'chat-bubble-ultra-fade'
      : 'chat-bubble-emma-ultra';

  return (
    <div
      className={cn(
        'chat-bubble-base rounded-2xl px-4 py-3 transition-all duration-200 max-w-[90%] w-fit relative shadow-sm',
        variantClass,
        isReply && 'chat-bubble-thread-reply',
        align === 'right' && 'ml-auto',
        className
      )}
      {...props}
    >
      <div className="chat-bubble-content relative z-[1]">{children}</div>
    </div>
  );
}


