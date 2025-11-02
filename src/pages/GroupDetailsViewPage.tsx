import { useEffect, useState, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { formatDistanceToNow } from 'date-fns';
import {
  ArrowLeft,
  Camera,
  Users,
  Calendar,
  Copy,
  Image,
  ChevronRight,
  UserPlus,
  Phone,
  Crown,
  LogOut,
  Bell,
  Ghost,
  Check,
  Edit2,
  MoreVertical,
  UserMinus
} from 'lucide-react';
import { motion } from 'framer-motion';
import { FixedSizeList as List } from 'react-window';
import AutoSizer from 'react-virtualized-auto-sizer';
import { Button } from '@/components/ui/button';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Switch } from '@/components/ui/switch';
import { Separator } from '@/components/ui/separator';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { useChatStore } from '@/store/chatStore';
import { useAuthStore } from '@/store/authStore';
import { JoinRequestsTab } from '@/components/group-details/JoinRequestsTab';
import { toast } from 'sonner';

export default function GroupDetailsViewPage() {
  const { groupId } = useParams();
  const navigate = useNavigate();
  const {
    groups,
    activeGroup,
    setActiveGroup,
    groupMembers,
    groupMedia,
    fetchGroupMembers,
    fetchGroupMedia,
    isLoadingGroupDetails,
    mainChatGhostMode,
    toggleMainChatGhostMode,
    updateGroup,
    removeGroupMember,
    leaveGroup,
    getPendingRequestCount
  } = useChatStore();

  const { user } = useAuthStore();

  const [copiedInvite, setCopiedInvite] = useState(false);
  const [showEditDialog, setShowEditDialog] = useState(false);
  const [editName, setEditName] = useState('');
  const [editDescription, setEditDescription] = useState('');
  const [isUpdating, setIsUpdating] = useState(false);
  const [memberToRemove, setMemberToRemove] = useState<string | null>(null);
  const [showExitDialog, setShowExitDialog] = useState(false);
  const [isLeaving, setIsLeaving] = useState(false);
  const [pendingRequestCount, setPendingRequestCount] = useState(0);
  const [activeTab, setActiveTab] = useState('participants');
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Check if current user is a member of the group
  const isMember = activeGroup && user && groupMembers.some(m => m.user_id === user.id);

  // Check if current user is admin
  const isAdmin = activeGroup && user && (
    activeGroup.created_by === user.id ||
    groupMembers.some(m => m.user_id === user.id && m.role === 'admin')
  );

  useEffect(() => {
    if (groupId) {
      // Set active group if not already set
      const group = groups.find(g => g.id === groupId);
      if (group && (!activeGroup || activeGroup.id !== group.id)) {
        setActiveGroup(group);
      }
    }
  }, [groupId, groups, activeGroup, setActiveGroup]);

  // Redirect non-members to dashboard
  useEffect(() => {
    if (activeGroup?.id && user && groupMembers.length > 0 && !isMember) {
      toast.error('You are not a member of this group');
      navigate('/dashboard');
    }
  }, [activeGroup?.id, user, groupMembers, isMember, navigate]);

  useEffect(() => {
    if (activeGroup?.id) {
      console.log('[GroupDetailsViewPage] Fetching members for group:', activeGroup.id);
      fetchGroupMembers(activeGroup.id);
      fetchGroupMedia(activeGroup.id);

      // Load pending request count if user is admin
      if (isAdmin && getPendingRequestCount) {
        getPendingRequestCount(activeGroup.id).then(count => {
          setPendingRequestCount(count);
        });
      }
    }
    // CRITICAL FIX: Don't include fetchGroupMembers/fetchGroupMedia in deps
    // They are stable Zustand actions and including them causes infinite re-fetches
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeGroup?.id, isAdmin]);

  // Debug logging
  useEffect(() => {
    console.log('[GroupDetailsViewPage] groupMembers updated:', groupMembers);
    console.log('[GroupDetailsViewPage] groupMembers.length:', groupMembers.length);
  }, [groupMembers]);

  const handleBack = () => {
    if (groupId) {
      navigate(`/groups/${groupId}`);
    } else {
      navigate('/dashboard');
    }
  };

  const handleCopyInviteCode = async () => {
    if (activeGroup?.invite_code) {
      try {
        await navigator.clipboard.writeText(activeGroup.invite_code);
        setCopiedInvite(true);
        toast.success('Invite code copied to clipboard');
        setTimeout(() => setCopiedInvite(false), 2000);
      } catch {
        toast.error('Failed to copy invite code');
      }
    }
  };

  const handleExitGroup = () => {
    setShowExitDialog(true);
  };

  const handleConfirmExit = async () => {
    if (!activeGroup || !user) return;

    setIsLeaving(true);
    try {
      await leaveGroup(activeGroup.id, user.id);
      toast.success('You have left the group');

      // Navigate back to dashboard
      navigate('/dashboard', { replace: true });
    } catch (error) {
      console.error('Error leaving group:', error);
      toast.error('Failed to leave group. Please try again.');
    } finally {
      setIsLeaving(false);
      setShowExitDialog(false);
    }
  };

  const handleAddMember = () => {
    // Navigate to contact selection page for adding members
    if (activeGroup) {
      navigate(`/groups/${activeGroup.id}/add-members`);
    }
  };

  const handleEditGroup = () => {
    if (activeGroup) {
      setEditName(activeGroup.name);
      setEditDescription(activeGroup.description || '');
      setShowEditDialog(true);
    }
  };

  const handleSaveEdit = async () => {
    if (!activeGroup || !editName.trim()) {
      toast.error('Group name is required');
      return;
    }

    setIsUpdating(true);
    try {
      await updateGroup(activeGroup.id, {
        name: editName.trim(),
        description: editDescription.trim() || undefined,
      });
      toast.success('Group updated successfully');
      setShowEditDialog(false);
    } catch (error) {
      console.error('Error updating group:', error);
      toast.error('Failed to update group');
    } finally {
      setIsUpdating(false);
    }
  };

  const handleAvatarUpload = () => {
    fileInputRef.current?.click();
  };

  const handleFileChange = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file || !activeGroup) return;

    // TODO: Implement file upload to storage and update group avatar
    toast.info('Avatar upload functionality coming soon');
  };

  const handleRemoveMember = async (userId: string) => {
    if (!activeGroup) return;

    try {
      await removeGroupMember(activeGroup.id, userId);
      toast.success('Member removed successfully');
      setMemberToRemove(null);
    } catch (error) {
      console.error('Error removing member:', error);
      toast.error('Failed to remove member');
    }
  };

  const photoMedia = groupMedia.filter(m => m.type === 'photo');
  const documentMedia = groupMedia.filter(m => m.type === 'document');
  const linkMedia = groupMedia.filter(m => m.type === 'link');
  const totalMediaCount = photoMedia.length + documentMedia.length + linkMedia.length;

  if (!activeGroup) {
    return (
      <div className="h-screen w-screen bg-background flex items-center justify-center">
        <p className="text-muted-foreground">Group not found</p>
      </div>
    );
  }

  return (
    <div className="h-screen w-screen bg-background flex flex-col">
      {/* Header */}
      <div className="flex-shrink-0 flex items-center justify-between px-4 py-3 border-b border-border/50 bg-background/95 backdrop-blur-sm sticky top-0 z-10">
        <div className="flex items-center">
          <Button
            variant="ghost"
            size="icon"
            onClick={handleBack}
            className="mr-3 h-10 w-10"
          >
            <ArrowLeft className="w-5 h-5" />
          </Button>
          <h1 className="font-semibold text-lg">Group Info</h1>
        </div>
        {isAdmin && (
          <Button
            variant="ghost"
            size="sm"
            onClick={handleEditGroup}
            className="gap-2"
          >
            <Edit2 className="w-4 h-4" />
            Edit
          </Button>
        )}
      </div>

      {/* Content */}
      <ScrollArea className="flex-1">
        <div className="pb-6">
          {/* Group Header Section - Centered */}
          <div className="bg-muted/30 py-8 px-6 text-center">
            <motion.div
              initial={{ scale: 0.9, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              transition={{ duration: 0.3 }}
              className="flex flex-col items-center"
            >
              {/* Large Avatar */}
              <div className="relative mb-4">
                <Avatar className="w-32 h-32 border-4 border-background shadow-lg">
                  <AvatarImage src={activeGroup.avatar_url || ''} />
                  <AvatarFallback className="text-4xl font-bold bg-gradient-to-br from-green-500 to-green-600 text-white">
                    {activeGroup.name.charAt(0).toUpperCase()}
                  </AvatarFallback>
                </Avatar>
                {isAdmin && (
                  <>
                    <Button
                      variant="secondary"
                      size="icon"
                      onClick={handleAvatarUpload}
                      className="absolute bottom-0 right-0 h-10 w-10 rounded-full shadow-md border-2 border-background"
                    >
                      <Camera className="w-5 h-5" />
                    </Button>
                    <input
                      ref={fileInputRef}
                      type="file"
                      accept="image/*"
                      className="hidden"
                      onChange={handleFileChange}
                    />
                  </>
                )}
              </div>

              {/* Group Name */}
              <h2 className="text-2xl font-bold mb-2">{activeGroup.name}</h2>

              {/* Created Date */}
              <p className="text-sm text-muted-foreground flex items-center gap-1">
                <Calendar className="w-4 h-4" />
                Created {formatDistanceToNow(new Date(activeGroup.created_at), { addSuffix: true })}
              </p>
            </motion.div>
          </div>

          {/* Group Info Card */}
          <div className="px-4 py-6 space-y-4">
            {/* Description */}
            {activeGroup.description && (
              <div className="bg-card/50 rounded-lg p-4 border border-border/50">
                <p className="text-sm text-muted-foreground leading-relaxed">
                  {activeGroup.description}
                </p>
              </div>
            )}

            {/* Stats Grid */}
            <div className="grid grid-cols-2 gap-3">
              <div className="bg-card/50 rounded-lg p-4 border border-border/50">
                <div className="flex items-center gap-3">
                  <div className="flex items-center justify-center w-10 h-10 bg-green-500/10 rounded-full">
                    <Users className="w-5 h-5 text-green-600 dark:text-green-500" />
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground">Participants</p>
                    <p className="text-lg font-semibold">{groupMembers.length}</p>
                  </div>
                </div>
              </div>

              <div className="bg-card/50 rounded-lg p-4 border border-border/50">
                <div className="flex items-center gap-3">
                  <div className="flex items-center justify-center w-10 h-10 bg-blue-500/10 rounded-full">
                    <Image className="w-5 h-5 text-blue-600 dark:text-blue-500" />
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground">Media</p>
                    <p className="text-lg font-semibold">{totalMediaCount}</p>
                  </div>
                </div>
              </div>
            </div>

            {/* Invite Code */}
            <div className="bg-card/50 rounded-lg p-4 border border-border/50">
              <div className="flex items-center justify-between mb-3">
                <p className="text-sm font-medium text-muted-foreground">Invite Code</p>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={handleCopyInviteCode}
                  className="h-8 px-3 text-xs"
                >
                  {copiedInvite ? (
                    <>
                      <Check className="w-3 h-3 mr-1" />
                      Copied
                    </>
                  ) : (
                    <>
                      <Copy className="w-3 h-3 mr-1" />
                      Copy
                    </>
                  )}
                </Button>
              </div>
              <Badge variant="secondary" className="font-mono text-base px-4 py-2 w-full justify-center">
                {activeGroup.invite_code}
              </Badge>
              <p className="text-xs text-muted-foreground mt-3 text-center">
                Share this code to invite new members
              </p>
            </div>
          </div>

          <Separator className="my-2" />

          {/* Media Preview Section */}
          {totalMediaCount > 0 && (
            <>
              <div className="px-4 py-4">
                <button
                  className="w-full flex items-center justify-between p-4 bg-card/30 hover:bg-card/50 rounded-lg border border-border/50 transition-colors"
                  onClick={() => toast.info('Media gallery coming soon')}
                >
                  <div className="flex items-center gap-3">
                    <div className="flex items-center justify-center w-10 h-10 bg-purple-500/10 rounded-full">
                      <Image className="w-5 h-5 text-purple-600 dark:text-purple-500" />
                    </div>
                    <div className="text-left">
                      <p className="text-sm font-medium">Media, links, and docs</p>
                      <p className="text-xs text-muted-foreground">
                        {photoMedia.length} photos, {documentMedia.length} docs, {linkMedia.length} links
                      </p>
                    </div>
                  </div>
                  <ChevronRight className="w-5 h-5 text-muted-foreground" />
                </button>
              </div>
              <Separator className="my-2" />
            </>
          )}

          {/* Members & Requests Tabs */}
          <div className="px-4 py-4">
            <Tabs
              defaultValue="participants"
              value={activeTab}
              onValueChange={async (value) => {
                setActiveTab(value);
                // Refresh pending count when switching to requests tab
                if (value === 'requests' && isAdmin && getPendingRequestCount) {
                  const count = await getPendingRequestCount(activeGroup?.id || '');
                  setPendingRequestCount(count);
                }
              }}
              className="w-full"
            >
              <TabsList className="grid w-full grid-cols-2 mb-4">
                <TabsTrigger value="participants">
                  Participants ({groupMembers.length})
                </TabsTrigger>
                {isAdmin && (
                  <TabsTrigger value="requests" className="relative">
                    Requests
                    {pendingRequestCount > 0 && (
                      <Badge
                        variant="destructive"
                        className="ml-2 h-5 min-w-5 px-1.5 text-xs"
                      >
                        {pendingRequestCount}
                      </Badge>
                    )}
                  </TabsTrigger>
                )}
              </TabsList>

              <TabsContent value="participants" className="mt-0">
                {/* Add Member Button - Only for admins */}
                {isAdmin && (
                  <button
                    onClick={handleAddMember}
                    className="w-full flex items-center gap-4 p-3 hover:bg-muted/50 rounded-lg transition-colors mb-2"
                  >
                    <div className="flex items-center justify-center w-12 h-12 bg-green-500/10 rounded-full">
                      <UserPlus className="w-5 h-5 text-green-600 dark:text-green-500" />
                    </div>
                    <span className="text-sm font-medium text-green-600 dark:text-green-500">Add participant</span>
                  </button>
                )}

            {/* Members List - Virtualized */}
            {isLoadingGroupDetails ? (
              // Loading skeleton
              <div className="space-y-1">
                {Array.from({ length: 3 }).map((_, i) => (
                  <div key={i} className="flex items-center gap-4 p-3 animate-pulse">
                    <div className="w-12 h-12 bg-muted rounded-full" />
                    <div className="flex-1 space-y-2">
                      <div className="h-4 bg-muted rounded w-3/4" />
                      <div className="h-3 bg-muted rounded w-1/2" />
                    </div>
                  </div>
                ))}
              </div>
            ) : groupMembers.length > 0 ? (
              <div style={{ height: Math.min(groupMembers.length * 72, 400) }}>
                <AutoSizer>
                  {({ height, width }) => (
                    <List
                      height={height}
                      itemCount={groupMembers.length}
                      itemSize={72}
                      width={width}
                    >
                      {({ index, style }) => {
                        const member = groupMembers[index];
                        const isCreator = activeGroup?.created_by === member.user_id;
                        const isCurrentUser = user?.id === member.user_id;
                        const canManage = isAdmin && !isCurrentUser && !isCreator;

                        return (
                          <div style={style} className="px-1">
                            <div className="flex items-center gap-4 p-3 hover:bg-muted/30 rounded-lg transition-colors">
                              <Avatar className="w-12 h-12">
                                <AvatarImage src={member.user.avatar_url || ''} />
                                <AvatarFallback className="text-base font-medium">
                                  {member.user.display_name.charAt(0).toUpperCase()}
                                </AvatarFallback>
                              </Avatar>

                              <div className="flex-1 min-w-0">
                                <div className="flex items-center gap-2 mb-1">
                                  <p className="text-sm font-medium truncate">
                                    {member.user.display_name}
                                    {isCurrentUser && ' (You)'}
                                  </p>
                                  {member.role === 'admin' && (
                                    <Badge variant="secondary" className="text-xs px-2 py-0.5 gap-1">
                                      <Crown className="w-3 h-3" />
                                      Admin
                                    </Badge>
                                  )}
                                </div>

                                <div className="flex items-center gap-1 text-xs text-muted-foreground">
                                  <Phone className="w-3 h-3" />
                                  <span>{member.user.phone_number}</span>
                                </div>
                              </div>

                              {canManage && (
                                <DropdownMenu>
                                  <DropdownMenuTrigger asChild>
                                    <Button variant="ghost" size="icon" className="h-8 w-8">
                                      <MoreVertical className="w-4 h-4" />
                                    </Button>
                                  </DropdownMenuTrigger>
                                  <DropdownMenuContent align="end">
                                    <DropdownMenuItem
                                      onClick={() => setMemberToRemove(member.user_id)}
                                      className="text-destructive focus:text-destructive"
                                    >
                                      <UserMinus className="w-4 h-4 mr-2" />
                                      Remove from group
                                    </DropdownMenuItem>
                                  </DropdownMenuContent>
                                </DropdownMenu>
                              )}
                            </div>
                          </div>
                        );
                      }}
                    </List>
                  )}
                </AutoSizer>
              </div>
            ) : (
              <p className="text-sm text-muted-foreground text-center py-8">No members found</p>
            )}
              </TabsContent>

              {/* Join Requests Tab - Only visible to admins */}
              {isAdmin && (
                <TabsContent value="requests" className="mt-0">
                  <JoinRequestsTab groupId={activeGroup?.id || ''} />
                </TabsContent>
              )}
            </Tabs>
          </div>

          <Separator className="my-2" />

          {/* Settings Section */}
          <div className="px-4 py-4">
            <h3 className="text-base font-semibold mb-4">Group Settings</h3>

            <div className="space-y-1">
              {/* Ghost Mode Toggle */}
              <div className="flex items-center justify-between p-4 hover:bg-muted/30 rounded-lg transition-colors">
                <div className="flex items-center gap-4">
                  <div className="flex items-center justify-center w-10 h-10 bg-purple-500/10 rounded-full">
                    <Ghost className="w-5 h-5 text-purple-600 dark:text-purple-500" />
                  </div>
                  <div>
                    <p className="text-sm font-medium">Ghost Mode</p>
                    <p className="text-xs text-muted-foreground">Send messages anonymously</p>
                  </div>
                </div>
                <Switch
                  checked={mainChatGhostMode}
                  onCheckedChange={toggleMainChatGhostMode}
                />
              </div>

              {/* Notifications Toggle (Placeholder) */}
              <div className="flex items-center justify-between p-4 hover:bg-muted/30 rounded-lg transition-colors opacity-50">
                <div className="flex items-center gap-4">
                  <div className="flex items-center justify-center w-10 h-10 bg-blue-500/10 rounded-full">
                    <Bell className="w-5 h-5 text-blue-600 dark:text-blue-500" />
                  </div>
                  <div>
                    <p className="text-sm font-medium">Notifications</p>
                    <p className="text-xs text-muted-foreground">Mute group notifications</p>
                  </div>
                </div>
                <Switch disabled />
              </div>
            </div>
          </div>

          <Separator className="my-2" />

          {/* Actions Section */}
          <div className="px-4 py-4 space-y-3">
            <Button
              variant="destructive"
              className="w-full justify-start gap-3 h-12"
              onClick={handleExitGroup}
            >
              <LogOut className="w-5 h-5" />
              Exit Group
            </Button>
          </div>
        </div>
      </ScrollArea>

      {/* Edit Group Dialog */}
      <Dialog open={showEditDialog} onOpenChange={setShowEditDialog}>
        <DialogContent className="sm:max-w-[425px]">
          <DialogHeader>
            <DialogTitle>Edit Group</DialogTitle>
            <DialogDescription>
              Update your group's name and description
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-4">
            <div className="grid gap-2">
              <Label htmlFor="name">Group Name</Label>
              <Input
                id="name"
                value={editName}
                onChange={(e) => setEditName(e.target.value)}
                placeholder="Enter group name"
                maxLength={50}
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="description">Description (Optional)</Label>
              <Textarea
                id="description"
                value={editDescription}
                onChange={(e) => setEditDescription(e.target.value)}
                placeholder="Enter group description"
                rows={3}
                maxLength={200}
              />
            </div>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setShowEditDialog(false)}
              disabled={isUpdating}
            >
              Cancel
            </Button>
            <Button onClick={handleSaveEdit} disabled={isUpdating || !editName.trim()}>
              {isUpdating ? 'Saving...' : 'Save Changes'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Remove Member Confirmation Dialog */}
      <AlertDialog open={!!memberToRemove} onOpenChange={() => setMemberToRemove(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove Member</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to remove this member from the group? They will no longer have access to group messages.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => memberToRemove && handleRemoveMember(memberToRemove)}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Remove
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Exit Group Confirmation Dialog */}
      <AlertDialog open={showExitDialog} onOpenChange={setShowExitDialog}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Exit Group</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to leave this group? You will no longer receive messages from this group.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isLeaving}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleConfirmExit}
              disabled={isLeaving}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {isLeaving ? 'Leaving...' : 'Exit Group'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}