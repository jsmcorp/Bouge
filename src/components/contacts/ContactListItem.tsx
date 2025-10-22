import { Check, User } from 'lucide-react';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Checkbox } from '@/components/ui/checkbox';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';

interface ContactListItemProps {
  contactId: number;
  displayName: string;
  phoneNumber: string;
  avatarUrl?: string | null;
  isRegistered?: boolean;
  isSelected: boolean;
  onToggle: (contactId: number) => void;
}

export function ContactListItem({
  contactId,
  displayName,
  phoneNumber,
  avatarUrl,
  isRegistered = false,
  isSelected,
  onToggle,
}: ContactListItemProps) {
  const initials = displayName
    .split(' ')
    .map(n => n[0])
    .join('')
    .toUpperCase()
    .slice(0, 2);

  return (
    <div
      className={cn(
        "flex items-center space-x-3 p-3 rounded-lg cursor-pointer transition-colors",
        "hover:bg-accent/50",
        isSelected && "bg-accent"
      )}
      onClick={() => onToggle(contactId)}
    >
      {/* Checkbox */}
      <Checkbox
        checked={isSelected}
        onCheckedChange={() => onToggle(contactId)}
        className="data-[state=checked]:bg-green-500 data-[state=checked]:border-green-500"
      />

      {/* Avatar */}
      <Avatar className="h-10 w-10">
        <AvatarImage src={avatarUrl || undefined} alt={displayName} />
        <AvatarFallback className="bg-gradient-to-br from-green-400 to-green-600 text-white">
          {initials || <User className="h-5 w-5" />}
        </AvatarFallback>
      </Avatar>

      {/* Contact Info */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center space-x-2">
          <p className="text-sm font-medium truncate">{displayName}</p>
          {isRegistered && (
            <Badge variant="secondary" className="bg-green-500/20 text-green-600 text-xs">
              <Check className="h-3 w-3 mr-1" />
              On Confessr
            </Badge>
          )}
        </div>
        <p className="text-xs text-muted-foreground truncate">{phoneNumber}</p>
      </div>
    </div>
  );
}

