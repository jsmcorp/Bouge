import { useEffect, useState } from 'react';
import { useChatStore } from '@/store/chatstore_refactored';
import { JoinRequest } from '@/lib/joinRequestService';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { CheckCircle2, XCircle, Clock, Loader2 } from 'lucide-react';
import { toast } from 'sonner';

interface JoinRequestsTabProps {
  groupId: string;
}

export function JoinRequestsTab({ groupId }: JoinRequestsTabProps) {
  const { pendingJoinRequests, fetchPendingJoinRequests, approveJoinRequest, rejectJoinRequest } = useChatStore();
  const [loading, setLoading] = useState(true);
  const [processingRequests, setProcessingRequests] = useState<Set<string>>(new Set());

  useEffect(() => {
    loadRequests();
  }, [groupId]);

  const loadRequests = async () => {
    try {
      setLoading(true);
      await fetchPendingJoinRequests(groupId);
    } catch (error) {
      console.error('Error loading join requests:', error);
      toast.error('Failed to load join requests');
    } finally {
      setLoading(false);
    }
  };

  const handleApprove = async (requestId: string) => {
    try {
      setProcessingRequests(prev => new Set(prev).add(requestId));
      await approveJoinRequest(requestId, groupId);
      toast.success('Join request approved - member added to group');
      // Reload requests to update the list
      await loadRequests();
    } catch (error) {
      console.error('Error approving request:', error);
      toast.error('Failed to approve request');
    } finally {
      setProcessingRequests(prev => {
        const next = new Set(prev);
        next.delete(requestId);
        return next;
      });
    }
  };

  const handleReject = async (requestId: string) => {
    try {
      setProcessingRequests(prev => new Set(prev).add(requestId));
      await rejectJoinRequest(requestId, groupId);
      toast.success('Join request rejected');
      // Reload requests to update the list
      await loadRequests();
    } catch (error) {
      console.error('Error rejecting request:', error);
      toast.error('Failed to reject request');
    } finally {
      setProcessingRequests(prev => {
        const next = new Set(prev);
        next.delete(requestId);
        return next;
      });
    }
  };

  const getInitials = (name: string) => {
    return name
      .split(' ')
      .map(n => n[0])
      .join('')
      .toUpperCase()
      .slice(0, 2);
  };

  const formatDate = (dateString: string) => {
    const date = new Date(dateString);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMs / 3600000);
    const diffDays = Math.floor(diffMs / 86400000);

    if (diffMins < 1) return 'Just now';
    if (diffMins < 60) return `${diffMins}m ago`;
    if (diffHours < 24) return `${diffHours}h ago`;
    if (diffDays < 7) return `${diffDays}d ago`;
    
    return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!pendingJoinRequests || pendingJoinRequests.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-12 px-4 text-center">
        <Clock className="h-12 w-12 text-muted-foreground mb-4" />
        <h3 className="text-lg font-semibold mb-2">No Pending Requests</h3>
        <p className="text-sm text-muted-foreground">
          There are no join requests waiting for approval
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-3 p-4">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-sm font-medium text-muted-foreground">
          {pendingJoinRequests.length} Pending Request{pendingJoinRequests.length !== 1 ? 's' : ''}
        </h3>
      </div>

      {pendingJoinRequests.map((request: JoinRequest) => {
        const isProcessing = processingRequests.has(request.id);
        
        return (
          <Card key={request.id} className="overflow-hidden">
            <CardContent className="p-4">
              <div className="flex items-start gap-3">
                {/* Avatar */}
                <Avatar className="h-12 w-12 flex-shrink-0">
                  <AvatarImage src={request.user?.avatar_url || undefined} />
                  <AvatarFallback className="bg-primary/10 text-primary">
                    {getInitials(request.user?.display_name || request.user?.phone_number || 'U')}
                  </AvatarFallback>
                </Avatar>

                {/* Content */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-start justify-between gap-2 mb-1">
                    <div className="flex-1 min-w-0">
                      <p className="font-medium truncate">
                        {request.user?.display_name || request.user?.phone_number || 'Unknown User'}
                      </p>
                      {request.user?.phone_number && request.user?.display_name && (
                        <p className="text-xs text-muted-foreground truncate">
                          {request.user.phone_number}
                        </p>
                      )}
                    </div>
                    <Badge variant="secondary" className="flex-shrink-0">
                      <Clock className="h-3 w-3 mr-1" />
                      {formatDate(request.created_at)}
                    </Badge>
                  </div>

                  {request.invited_by && request.inviter && (
                    <p className="text-xs text-muted-foreground mb-3">
                      Invited by {request.inviter.display_name || request.inviter.phone_number}
                    </p>
                  )}

                  {/* Action Buttons */}
                  <div className="flex gap-2 mt-3">
                    <Button
                      size="sm"
                      variant="default"
                      className="flex-1"
                      onClick={() => handleApprove(request.id)}
                      disabled={isProcessing}
                    >
                      {isProcessing ? (
                        <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                      ) : (
                        <CheckCircle2 className="h-4 w-4 mr-2" />
                      )}
                      Approve
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      className="flex-1"
                      onClick={() => handleReject(request.id)}
                      disabled={isProcessing}
                    >
                      {isProcessing ? (
                        <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                      ) : (
                        <XCircle className="h-4 w-4 mr-2" />
                      )}
                      Reject
                    </Button>
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}

