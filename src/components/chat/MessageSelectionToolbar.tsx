import { Reply, Star, Trash2, AlertTriangle, X } from 'lucide-react';
import { Button } from '@/components/ui/button';

interface MessageSelectionToolbarProps {
  selectedCount: number;
  onReply: () => void;
  onStar: () => void;
  onDelete: () => void;
  onReport: () => void;
  onCancel: () => void;
}

export function MessageSelectionToolbar({
  selectedCount,
  onReply,
  onStar,
  onDelete,
  onReport,
  onCancel
}: MessageSelectionToolbarProps) {
  return (
    <div className="fixed top-0 left-0 right-0 z-50 bg-primary text-primary-foreground shadow-lg">
      <div className="flex items-center justify-between p-3 md:p-4">
        {/* Left: Cancel and count */}
        <div className="flex items-center gap-3">
          <Button
            variant="ghost"
            size="sm"
            onClick={onCancel}
            className="h-9 w-9 p-0 hover:bg-primary-foreground/10 text-primary-foreground"
          >
            <X className="w-5 h-5" />
          </Button>
          <span className="text-lg font-semibold">
            {selectedCount} selected
          </span>
        </div>

        {/* Right: Action buttons */}
        <div className="flex items-center gap-1 md:gap-2">
          {selectedCount === 1 && (
            <Button
              variant="ghost"
              size="sm"
              onClick={onReply}
              className="h-9 w-9 p-0 hover:bg-primary-foreground/10 text-primary-foreground"
              title="Reply"
            >
              <Reply className="w-5 h-5" />
            </Button>
          )}
          
          <Button
            variant="ghost"
            size="sm"
            onClick={onStar}
            className="h-9 w-9 p-0 hover:bg-primary-foreground/10 text-primary-foreground"
            title="Star"
          >
            <Star className="w-5 h-5" />
          </Button>
          
          <Button
            variant="ghost"
            size="sm"
            onClick={onDelete}
            className="h-9 w-9 p-0 hover:bg-primary-foreground/10 text-primary-foreground"
            title="Delete"
          >
            <Trash2 className="w-5 h-5" />
          </Button>
          
          <Button
            variant="ghost"
            size="sm"
            onClick={onReport}
            className="h-9 w-9 p-0 hover:bg-primary-foreground/10 text-primary-foreground"
            title="Report"
          >
            <AlertTriangle className="w-5 h-5" />
          </Button>
        </div>
      </div>
    </div>
  );
}
