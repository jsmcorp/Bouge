import { UserMinus, LogOut } from 'lucide-react';
import { Alert, AlertDescription } from '@/components/ui/alert';

interface NonMemberBannerProps {
  reason: 'left' | 'removed';
}

export function NonMemberBanner({ reason }: NonMemberBannerProps) {
  return (
    <Alert className="border-destructive/50 bg-destructive/10 text-destructive mb-4">
      <div className="flex items-center gap-2">
        {reason === 'left' ? (
          <LogOut className="h-4 w-4" />
        ) : (
          <UserMinus className="h-4 w-4" />
        )}
        <AlertDescription className="font-medium">
          {reason === 'left' 
            ? "You left this group" 
            : "You were removed from this group"}
        </AlertDescription>
      </div>
    </Alert>
  );
}

