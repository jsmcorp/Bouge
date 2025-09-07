// No explicit React import needed for Vite + TS JSX
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { ChatBubble } from '@/components/chat/ui/ChatBubble';
import { BubbleBadge } from '@/components/chat/ui/BubbleBadge';

export function ChatPreview() {
  return (
    <div className="max-w-md mx-auto p-4 space-y-6">
      {/* Ghost */}
      <div className="flex items-start gap-3">
        <div className="flex-shrink-0 pt-1">
          <div className="w-8 h-8 rounded-full avatar-ghost flex items-center justify-center">
            <span className="text-white text-sm font-semibold">👻</span>
          </div>
        </div>
        <div className="flex-1">
          <div className="text-sm font-bold mb-2">Ghost</div>
          <ChatBubble variant="ghost">
            <div className="text-sm">Hello there.</div>
          </ChatBubble>
          <div className="mt-1 text-xs timestamp">2:32 PM</div>
        </div>
      </div>

      {/* Emma (user) */}
      <div className="flex items-start gap-3 justify-end">
        <div className="flex-1" />
        <div className="flex-1 max-w-[78%]">
          <div className="flex items-center justify-end gap-2 mb-2">
            <div className="text-sm font-bold">Emma</div>
            <Avatar className="w-8 h-8 avatar-emma">
              <AvatarImage src="" />
              <AvatarFallback className="bg-primary/10 text-primary font-semibold">E</AvatarFallback>
            </Avatar>
          </div>
          <ChatBubble align="right" variant="user">
            <div className="text-sm">Hi!</div>
          </ChatBubble>
          <div className="mt-1 text-xs timestamp text-right">2:32 PM</div>
        </div>
      </div>

      {/* Anonymous with Funny badge */}
      <div className="flex items-start gap-3">
        <Avatar className="w-8 h-8 avatar-emma">
          <AvatarImage src="" />
          <AvatarFallback className="bg-primary/10 text-primary font-semibold">A</AvatarFallback>
        </Avatar>
        <div className="flex-1">
          <div className="text-sm font-bold mb-2">Anonymus</div>
          <ChatBubble variant="anonymous">
            <div className="flex items-center gap-2 mb-1">
              <BubbleBadge type="anony">Anony</BubbleBadge>
              <BubbleBadge type="funny">Funny</BubbleBadge>
            </div>
            <div className="text-sm">I once accidentally called my teacher ‘mom’ in class!</div>
          </ChatBubble>
        </div>
      </div>

      {/* Confession */}
      <div className="flex items-start gap-3">
        <div className="flex-shrink-0 pt-1">
          <div className="w-8 h-8 rounded-full avatar-confession flex items-center justify-center">
            <span className="text-white font-bold">C</span>
          </div>
        </div>
        <div className="flex-1">
          <div className="text-sm font-bold mb-2">Confession</div>
          <ChatBubble variant="confession">
            <div className="text-sm">What’s your deepest, darkest secret?</div>
          </ChatBubble>
        </div>
      </div>
    </div>
  );
}


