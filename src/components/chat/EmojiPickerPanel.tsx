import { useState } from 'react';
import EmojiPicker, { EmojiClickData, Theme, Categories } from 'emoji-picker-react';
import { useTheme } from '@/components/theme-provider';
import { Input } from '@/components/ui/input';
import { Search } from 'lucide-react';

interface EmojiPickerPanelProps {
  onEmojiSelect: (emoji: string) => void;
  className?: string;
}

export function EmojiPickerPanel({ onEmojiSelect, className }: EmojiPickerPanelProps) {
  const { theme } = useTheme();
  const [searchValue, setSearchValue] = useState('');

  const handleEmojiClick = (emojiData: EmojiClickData) => {
    onEmojiSelect(emojiData.emoji);
  };

  const getTheme = (): Theme => {
    if (theme === 'dark') return Theme.DARK;
    if (theme === 'light') return Theme.LIGHT;
    // For system theme, default to dark since our app is primarily dark
    return Theme.DARK;
  };

  return (
    <div className={`bg-background border border-border/50 rounded-lg shadow-xl overflow-hidden ${className}`}>
      {/* Search Bar */}
      <div className="p-3 border-b border-border/50">
        <div className="relative">
          <Search className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search emojis..."
            value={searchValue}
            onChange={(e) => setSearchValue(e.target.value)}
            className="pl-10 h-9 text-sm bg-muted/30 border-border/50"
          />
        </div>
      </div>

      {/* Emoji Picker */}
      <div className="emoji-picker-container">
        <EmojiPicker
          onEmojiClick={handleEmojiClick}
          theme={getTheme()}
          searchPlaceholder="Search emojis..."
          width={320}
          height={400}
          previewConfig={{
            showPreview: false,
          }}
          skinTonesDisabled
          categories={[
            {
              name: 'Smileys & People',
              category: Categories.SMILEYS_PEOPLE,
            },
            {
              name: 'Animals & Nature',
              category: Categories.ANIMALS_NATURE,
            },
            {
              name: 'Food & Drink',
              category: Categories.FOOD_DRINK,
            },
            {
              name: 'Activities',
              category: Categories.ACTIVITIES,
            },
            {
              name: 'Travel & Places',
              category: Categories.TRAVEL_PLACES,
            },
            {
              name: 'Objects',
              category: Categories.OBJECTS,
            },
            {
              name: 'Symbols',
              category: Categories.SYMBOLS,
            },
            {
              name: 'Flags',
              category: Categories.FLAGS,
            },
          ]}
        />
      </div>
    </div>
  );
}