import { useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useChatStore } from '@/store/chatStore';
import { GroupDetailsPanel } from '@/components/dashboard/GroupDetailsPanel';

export default function GroupDetailsViewPage() {
  const { groupId } = useParams();
  const navigate = useNavigate();
  const { 
    groups, 
    activeGroup, 
    setActiveGroup,
    setShowGroupDetailsPanel
  } = useChatStore();

  useEffect(() => {
    if (groupId) {
      // Set active group if not already set
      const group = groups.find(g => g.id === groupId);
      if (group && (!activeGroup || activeGroup.id !== group.id)) {
        setActiveGroup(group);
      }
      
      // Show group details panel
      setShowGroupDetailsPanel(true);
    }
  }, [groupId, groups, activeGroup, setActiveGroup, setShowGroupDetailsPanel]);

  const handleBack = () => {
    setShowGroupDetailsPanel(false);
    if (groupId) {
      navigate(`/groups/${groupId}`);
    } else {
      navigate('/dashboard');
    }
  };

  return (
    <div className="h-screen w-screen bg-background flex flex-col">
      {/* Mobile Header */}
      <div className="flex-shrink-0 flex items-center p-2 sm:p-4 border-b border-border/50 bg-card/30 backdrop-blur-sm">
        <Button
          variant="ghost"
          size="sm"
          onClick={handleBack}
          className="mr-2 sm:mr-3 h-8 w-8 p-0 hover:bg-muted/50"
        >
          <ArrowLeft className="w-4 h-4" />
        </Button>
        <div>
          <h1 className="font-semibold text-base sm:text-lg">Group Details</h1>
          <p className="text-xs sm:text-sm text-muted-foreground truncate max-w-[200px] sm:max-w-none">
            {activeGroup?.name}
          </p>
        </div>
      </div>

      {/* Group Details Content */}
      <div className="flex-1 overflow-hidden">
        <GroupDetailsPanel />
      </div>
    </div>
  );
}