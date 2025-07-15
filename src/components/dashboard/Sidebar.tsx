import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { 
  Plus, 
  Hash, 
  Settings, 
  LogOut, 
  Users, 
  Ghost,
  Search,
  MoreHorizontal
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Input } from '@/components/ui/input';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Separator } from '@/components/ui/separator';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { useAuthStore } from '@/store/authStore';
import { useChatStore } from '@/store/chatStore';
import { useIsMobile } from '@/hooks/useMediaQuery';
import { CreateGroupDialog } from '@/components/dashboard/CreateGroupDialog';
import { JoinGroupDialog } from '@/components/dashboard/JoinGroupDialog';
import { toast } from 'sonner';

export function Sidebar() {
  const navigate = useNavigate();
  const isMobile = useIsMobile();
  const { user, logout } = useAuthStore();
  const { groups, activeGroup, setActiveGroup } = useChatStore();
  const [showCreateGroup, setShowCreateGroup] = useState(false);
  const [showJoinGroup, setShowJoinGroup] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');

  const filteredGroups = groups.filter(group =>
    group.name.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const handleLogout = async () => {
    try {
      await logout();
      toast.success('Logged out successfully');
    } catch (error) {
      toast.error('Failed to logout');
    }
  };

  const handleSettingsClick = () => {
    navigate('/settings');
  };

  const handleGroupClick = (group: any) => {
    if (isMobile) {
      navigate(`/groups/${group.id}`);
    } else {
      setActiveGroup(group);
    }
  };

  return (
    <>
      <motion.div
        initial={{ x: -300 }}
        animate={{ x: 0 }}
        className={`w-full h-full ${isMobile ? 'bg-background' : 'sm:w-60 md:w-64 bg-card/50 backdrop-blur-sm border-r border-border/50'} flex flex-col`}
      >
        {/* Header - Fixed */}
        <div className={`flex-shrink-0 p-3 sm:p-4 ${!isMobile && 'border-b border-border/50'}`}>
          <div className="flex items-center space-x-2 sm:space-x-3">
            <div className="flex items-center justify-center w-8 h-8 sm:w-10 sm:h-10 bg-gradient-to-br from-green-500 to-green-600 rounded-xl">
              <Ghost className="w-4 h-4 sm:w-5 sm:h-5 text-white" />
            </div>
            <div>
              <h1 className="font-bold text-base sm:text-lg">Confessr</h1>
              <p className="text-xs text-muted-foreground">Anonymous messaging</p>
            </div>
          </div>
        </div>

        {/* Search - Fixed */}
        <div className="flex-shrink-0 p-3 sm:p-4 pb-2">
          <div className="relative">
            <Search className="absolute left-2 sm:left-3 top-2.5 sm:top-3 h-3 w-3 sm:h-4 sm:w-4 text-muted-foreground" />
            <Input
              placeholder="Search groups..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-7 sm:pl-10 text-sm bg-background/50 h-8 sm:h-10"
            />
          </div>
        </div>

        {/* Groups - Scrollable */}
        <div className="flex-1 overflow-hidden">
          <div className="px-4 py-2">
            <div className="flex items-center justify-between mb-2">
              <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">
                Groups
              </h2>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="ghost" size="sm" className="h-6 w-6 p-0">
                    <Plus className="h-4 w-4" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem onClick={() => setShowCreateGroup(true)}>
                    <Plus className="h-4 w-4 mr-2" />
                    Create Group
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => setShowJoinGroup(true)}>
                    <Users className="h-4 w-4 mr-2" />
                    Join Group
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          </div>

          <ScrollArea className="flex-1 px-2">
            <AnimatePresence>
              {filteredGroups.map((group, index) => (
                <motion.div
                  key={group.id}
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -20 }}
                  transition={{ delay: index * 0.1 }}
                  className={`flex items-center space-x-3 px-3 py-2 rounded-lg cursor-pointer transition-colors mb-1 group ${
                    activeGroup?.id === group.id
                      ? 'bg-green-500/20 text-green-400'
                      : 'hover:bg-muted/50'
                  }`}
                  onClick={() => handleGroupClick(group)}
                >
                  <Hash className="h-4 w-4 flex-shrink-0" />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium truncate">{group.name}</p>
                    {group.description && (
                      <p className="text-xs text-muted-foreground truncate">
                        {group.description}
                      </p>
                    )}
                  </div>
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-6 w-6 p-0 opacity-0 group-hover:opacity-100"
                      >
                        <MoreHorizontal className="h-3 w-3" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuItem>
                        Copy Invite Code
                      </DropdownMenuItem>
                      <DropdownMenuItem>
                        Group Settings
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </motion.div>
              ))}
            </AnimatePresence>
          </ScrollArea>
        </div>

        <Separator />

        {/* User Profile - Fixed at bottom */}
        <div className="flex-shrink-0 p-3 sm:p-4">
          <div className="flex items-center space-x-2 sm:space-x-3">
            <Avatar className="h-8 w-8 sm:h-10 sm:w-10">
              <AvatarImage src={user?.avatar_url || ''} />
              <AvatarFallback>
                {user?.display_name?.charAt(0) || 'U'}
              </AvatarFallback>
            </Avatar>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium truncate">{user?.display_name}</p>
              <p className="text-xs text-muted-foreground truncate">
                {user?.phone_number}
              </p>
            </div>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="sm" className="h-7 w-7 sm:h-8 sm:w-8 p-0">
                  <MoreHorizontal className="h-3 w-3 sm:h-4 sm:w-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onClick={handleSettingsClick}>
                  <Settings className="h-3 w-3 sm:h-4 sm:w-4 mr-2" />
                  Settings
                </DropdownMenuItem>
                <DropdownMenuItem onClick={handleLogout}>
                  <LogOut className="h-3 w-3 sm:h-4 sm:w-4 mr-2" />
                  Sign Out
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>
      </motion.div>

      <CreateGroupDialog
        open={showCreateGroup}
        onOpenChange={setShowCreateGroup}
      />
      <JoinGroupDialog
        open={showJoinGroup}
        onOpenChange={setShowJoinGroup}
      />
    </>
  );
}