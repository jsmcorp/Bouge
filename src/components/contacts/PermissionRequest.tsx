import { Contact, AlertCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Alert, AlertDescription } from '@/components/ui/alert';

interface PermissionRequestProps {
  onRequestPermission: () => void;
  isLoading?: boolean;
  error?: string | null;
}

export function PermissionRequest({
  onRequestPermission,
  isLoading = false,
  error,
}: PermissionRequestProps) {
  return (
    <div className="flex flex-col items-center justify-center py-12 px-4 space-y-6">
      {/* Icon */}
      <div className="flex items-center justify-center w-20 h-20 bg-green-500/20 rounded-full">
        <Contact className="w-10 h-10 text-green-500" />
      </div>

      {/* Title & Description */}
      <div className="text-center space-y-2">
        <h3 className="text-lg font-semibold">Access Your Contacts</h3>
        <p className="text-sm text-muted-foreground max-w-sm">
          To add members from your contacts, we need permission to access your contact list.
          We only read names and phone numbers.
        </p>
      </div>

      {/* Error Alert */}
      {error && (
        <Alert variant="destructive" className="max-w-sm">
          <AlertCircle className="h-4 w-4" />
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      {/* Request Button */}
      <Button
        onClick={onRequestPermission}
        disabled={isLoading}
        className="bg-gradient-to-r from-green-500 to-green-600 hover:from-green-600 hover:to-green-700"
      >
        {isLoading ? 'Requesting...' : 'Grant Permission'}
      </Button>

      {/* Privacy Note */}
      <p className="text-xs text-muted-foreground text-center max-w-sm">
        Your contacts are stored locally on your device and are never uploaded to our servers.
      </p>
    </div>
  );
}

