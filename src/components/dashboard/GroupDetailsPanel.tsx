import { useEffect } from 'react';
import { motion } from 'framer-motion';
import { X, Settings, Users, Image } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useChatStore } from '@/store/chatStore';
import { GroupHeader } from '@/components/dashboard/group-details/GroupHeader';
import { GroupMembers } from '@/components/dashboard/group-details/GroupMembers';
import { GroupMedia } from '@/components/dashboard/group-details/GroupMedia';

export function GroupDetailsPanel() {
  const { 
    activeGroup, 
    showGroupDetailsPanel,
    setShowGroupDetailsPanel,
    fetchGroupMembers,
    fetchGroupMedia
  } = useChatStore();

  useEffect(() => {
    if (activeGroup?.id && showGroupDetailsPanel) {
      fetchGroupMembers(activeGroup.id);
      fetchGroupMedia(activeGroup.id);
    }
  }, [activeGroup?.id, showGroupDetailsPanel, fetchGroupMembers, fetchGroupMedia]);

  if (!activeGroup || !showGroupDetailsPanel) return null;

  return (
    <motion.div
      initial={{ x: '100%', opacity: 0 }}
      animate={{ x: 0, opacity: 1 }}
      exit={{ x: '100%', opacity: 0 }}
      transition={{ type: 'spring', stiffness: 300, damping: 30 }}
      className="w-80 h-full bg-card/30 backdrop-blur-sm border-l border-border/50 flex flex-col"
    >
      {/* Header */}
      <div className="flex-shrink-0 flex items-center justify-between p-4 border-b border-border/50 bg-card/20">
        <div className="flex items-center space-x-2">
          <div className="flex items-center justify-center w-6 h-6 bg-green-500/20 rounded-md">
            <Settings className="w-3 h-3 text-green-500" />
          </div>
          <div>
            <h3 className="font-medium text-sm">Group Details</h3>
            <p className="text-xs text-muted-foreground">
              Manage group settings
            </p>
          </div>
        </div>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => setShowGroupDetailsPanel(false)}
          className="h-6 w-6 p-0 hover:bg-muted/50"
        >
          <X className="w-3 h-3" />
        </Button>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-hidden">
        <ScrollArea className="h-full">
          <div className="p-4 space-y-6">
            {/* Group Header Section */}
            <GroupHeader group={activeGroup} />

            {/* Tabs for Members and Media */}
            <Tabs defaultValue="members" className="w-full">
              <TabsList className="grid w-full grid-cols-2">
                <TabsTrigger value="members" className="text-xs">
                  <Users className="w-3 h-3 mr-1" />
                  Members
                </TabsTrigger>
                <TabsTrigger value="media" className="text-xs">
                  <Image className="w-3 h-3 mr-1" />
                  Media
                </TabsTrigger>
              </TabsList>
              
              <TabsContent value="members" className="mt-4">
                <GroupMembers />
              </TabsContent>
              
              <TabsContent value="media" className="mt-4">
                <GroupMedia />
              </TabsContent>
            </Tabs>
          </div>
        </ScrollArea>
      </div>
    </motion.div>
  );
}