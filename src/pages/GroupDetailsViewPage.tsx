import { useEffect, useState } from 'react';
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
  Check
} from 'lucide-react';
import { motion } from 'framer-motion';
import { Button } from '@/components/ui/button';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Switch } from '@/components/ui/switch';
import { Separator } from '@/components/ui/separator';
import { useChatStore } from '@/store/chatStore';
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
    toggleMainChatGhostMode
  } = useChatStore();

  const [copiedInvite, setCopiedInvite] = useState(false);

  useEffect(() => {
    if (groupId) {
      // Set active group if not already set
      const group = groups.find(g => g.id === groupId);
      if (group && (!activeGroup || activeGroup.id !== group.id)) {
        setActiveGroup(group);
      }
    }
  }, [groupId, groups, activeGroup, setActiveGroup]);

  useEffect(() => {
    if (activeGroup?.id) {
      fetchGroupMembers(activeGroup.id);
      fetchGroupMedia(activeGroup.id);
    }
  }, [activeGroup?.id, fetchGroupMembers, fetchGroupMedia]);

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
    // TODO: Implement leave group functionality
    toast.info('Leave group functionality coming soon');
  };

  const handleAddMember = () => {
    // TODO: Navigate to add member page
    toast.info('Add member functionality coming soon');
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
      <div className="flex-shrink-0 flex items-center px-4 py-3 border-b border-border/50 bg-background/95 backdrop-blur-sm sticky top-0 z-10">
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
                <Button
                  variant="secondary"
                  size="icon"
                  className="absolute bottom-0 right-0 h-10 w-10 rounded-full shadow-md border-2 border-background"
                >
                  <Camera className="w-5 h-5" />
                </Button>
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

          {/* Members Section */}
          <div className="px-4 py-4">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-base font-semibold">{groupMembers.length} participants</h3>
            </div>

            {/* Add Member Button */}
            <button
              onClick={handleAddMember}
              className="w-full flex items-center gap-4 p-3 hover:bg-muted/50 rounded-lg transition-colors mb-2"
            >
              <div className="flex items-center justify-center w-12 h-12 bg-green-500/10 rounded-full">
                <UserPlus className="w-5 h-5 text-green-600 dark:text-green-500" />
              </div>
              <span className="text-sm font-medium text-green-600 dark:text-green-500">Add participant</span>
            </button>

            {/* Members List */}
            <div className="space-y-1">
              {isLoadingGroupDetails ? (
                // Loading skeleton
                Array.from({ length: 3 }).map((_, i) => (
                  <div key={i} className="flex items-center gap-4 p-3 animate-pulse">
                    <div className="w-12 h-12 bg-muted rounded-full" />
                    <div className="flex-1 space-y-2">
                      <div className="h-4 bg-muted rounded w-3/4" />
                      <div className="h-3 bg-muted rounded w-1/2" />
                    </div>
                  </div>
                ))
              ) : (
                groupMembers.map((member) => (
                  <div
                    key={member.id}
                    className="flex items-center gap-4 p-3 hover:bg-muted/30 rounded-lg transition-colors"
                  >
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
                  </div>
                ))
              )}
            </div>
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
    </div>
  );
}