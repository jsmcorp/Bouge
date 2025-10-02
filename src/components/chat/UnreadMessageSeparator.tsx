import React from 'react';

/**
 * Unread Message Separator Component
 * 
 * WhatsApp-style separator line that appears between read and unread messages.
 * Helps users quickly identify where they left off in the conversation.
 */
interface UnreadMessageSeparatorProps {
  className?: string;
}

export const UnreadMessageSeparator: React.FC<UnreadMessageSeparatorProps> = ({ className = '' }) => {
  return (
    <div 
      className={`flex items-center gap-3 my-4 px-4 ${className}`}
      data-unread-separator="true"
    >
      {/* Left line */}
      <div className="flex-1 h-[1px] bg-green-500/60" />
      
      {/* Text label */}
      <span className="text-xs font-medium text-green-500 uppercase tracking-wide whitespace-nowrap">
        Unread Messages
      </span>
      
      {/* Right line */}
      <div className="flex-1 h-[1px] bg-green-500/60" />
    </div>
  );
};

export default UnreadMessageSeparator;

