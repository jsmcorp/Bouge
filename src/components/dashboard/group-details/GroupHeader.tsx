import { useState } from 'react';
import { formatDistanceToNow } from 'date-fns';
import { Camera, Edit2, Users, Calendar } from 'lucide-react';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { Group, useChatStore } from '@/store/chatStore';

interface GroupHeaderProps {
  group: Group;
}

export function GroupHeader({ group }: GroupHeaderProps) {
  const [isEditing, setIsEditing] = useState(false);
  const [editName, setEditName] = useState(group.name);
  const [editDescription, setEditDescription] = useState(group.description || '');
  const { groupMembers } = useChatStore();

  const handleSave = () => {
    // TODO: Implement group update functionality
    console.log('Saving group updates:', { name: editName, description: editDescription });
    setIsEditing(false);
  };

  const handleCancel = () => {
    setEditName(group.name);
    setEditDescription(group.description || '');
    setIsEditing(false);
  };

  return (
    <Card className="glass-card border-border/50">
      <CardContent className="p-4 space-y-4">
        {/* Group Avatar and Basic Info */}
        <div className="flex items-start space-x-4">
          <div className="relative">
            <Avatar className="w-16 h-16">
              <AvatarImage src={group.avatar_url || ''} />
              <AvatarFallback className="text-lg font-bold bg-gradient-to-br from-green-500 to-green-600 text-white">
                {group.name.charAt(0).toUpperCase()}
              </AvatarFallback>
            </Avatar>
            <Button
              variant="outline"
              size="sm"
              className="absolute -bottom-1 -right-1 h-6 w-6 p-0 rounded-full bg-background border-2"
            >
              <Camera className="w-3 h-3" />
            </Button>
          </div>
          
          <div className="flex-1 space-y-2">
            {isEditing ? (
              <div className="space-y-2">
                <Input
                  value={editName}
                  onChange={(e) => setEditName(e.target.value)}
                  className="font-semibold text-base"
                  maxLength={50}
                />
                <Textarea
                  value={editDescription}
                  onChange={(e) => setEditDescription(e.target.value)}
                  placeholder="Add a description..."
                  className="text-sm resize-none"
                  rows={2}
                  maxLength={200}
                />
                <div className="flex space-x-2">
                  <Button size="sm" onClick={handleSave} className="h-7 px-3 text-xs">
                    Save
                  </Button>
                  <Button size="sm" variant="outline" onClick={handleCancel} className="h-7 px-3 text-xs">
                    Cancel
                  </Button>
                </div>
              </div>
            ) : (
              <div className="space-y-1">
                <div className="flex items-center space-x-2">
                  <h2 className="font-semibold text-base">{group.name}</h2>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setIsEditing(true)}
                    className="h-6 w-6 p-0 opacity-0 group-hover:opacity-100 transition-opacity"
                  >
                    <Edit2 className="w-3 h-3" />
                  </Button>
                </div>
                {group.description ? (
                  <p className="text-sm text-muted-foreground leading-relaxed">
                    {group.description}
                  </p>
                ) : (
                  <p className="text-sm text-muted-foreground italic">
                    No description
                  </p>
                )}
              </div>
            )}
          </div>
        </div>

        {/* Group Stats */}
        <div className="grid grid-cols-2 gap-3">
          <div className="flex items-center space-x-2 p-2 bg-muted/30 rounded-lg">
            <div className="flex items-center justify-center w-6 h-6 bg-green-500/20 rounded-md">
              <Users className="w-3 h-3 text-green-500" />
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Members</p>
              <p className="text-sm font-medium">{groupMembers.length}</p>
            </div>
          </div>
          
          <div className="flex items-center space-x-2 p-2 bg-muted/30 rounded-lg">
            <div className="flex items-center justify-center w-6 h-6 bg-blue-500/20 rounded-md">
              <Calendar className="w-3 h-3 text-blue-500" />
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Created</p>
              <p className="text-sm font-medium">
                {formatDistanceToNow(new Date(group.created_at), { addSuffix: true })}
              </p>
            </div>
          </div>
        </div>

        {/* Invite Code */}
        <div className="p-3 bg-muted/20 rounded-lg border border-border/50">
          <div className="flex items-center justify-between mb-2">
            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
              Invite Code
            </p>
            <Button variant="ghost" size="sm" className="h-6 px-2 text-xs">
              Copy
            </Button>
          </div>
          <div className="flex items-center space-x-2">
            <Badge variant="secondary" className="font-mono text-sm px-3 py-1">
              {group.invite_code}
            </Badge>
          </div>
          <p className="text-xs text-muted-foreground mt-2">
            Share this code to invite new members
          </p>
        </div>
      </CardContent>
    </Card>
  );
}