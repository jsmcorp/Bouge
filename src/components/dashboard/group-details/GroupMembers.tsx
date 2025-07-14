import { useState } from 'react';
import { formatDistanceToNow } from 'date-fns';
import { Search, UserPlus, MoreHorizontal, Crown, User, Phone } from 'lucide-react';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { useChatStore } from '@/store/chatStore';

export function GroupMembers() {
  const [searchQuery, setSearchQuery] = useState('');
  const { groupMembers, isLoadingGroupDetails } = useChatStore();

  const filteredMembers = groupMembers.filter(member =>
    member.user.display_name.toLowerCase().includes(searchQuery.toLowerCase()) ||
    member.user.phone_number.includes(searchQuery)
  );

  const formatPhoneNumber = (phone: string) => {
    // Simple phone number formatting
    if (phone.startsWith('+')) {
      return phone;
    }
    return `+${phone}`;
  };

  if (isLoadingGroupDetails) {
    return (
      <div className="space-y-3">
        {[1, 2, 3].map((i) => (
          <div key={i} className="flex items-center space-x-3 p-3 bg-muted/20 rounded-lg animate-pulse">
            <div className="w-10 h-10 bg-muted rounded-full"></div>
            <div className="flex-1 space-y-2">
              <div className="h-4 bg-muted rounded w-3/4"></div>
              <div className="h-3 bg-muted rounded w-1/2"></div>
            </div>
          </div>
        ))}
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Search and Add Member */}
      <div className="space-y-3">
        <div className="relative">
          <Search className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search members..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-10 h-9 text-sm"
          />
        </div>
        
        <Button variant="outline" size="sm" className="w-full h-9 text-sm">
          <UserPlus className="w-4 h-4 mr-2" />
          Add Member
        </Button>
      </div>

      {/* Members List */}
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <h4 className="text-sm font-medium text-muted-foreground">
            Members ({filteredMembers.length})
          </h4>
          {filteredMembers.length > 0 && (
            <Button variant="ghost" size="sm" className="h-6 px-2 text-xs">
              Manage
            </Button>
          )}
        </div>

        {filteredMembers.length === 0 ? (
          <div className="text-center py-6">
            <User className="w-8 h-8 text-muted-foreground mx-auto mb-2" />
            <p className="text-sm text-muted-foreground">
              {searchQuery ? 'No members found' : 'No members yet'}
            </p>
          </div>
        ) : (
          <div className="space-y-2">
            {filteredMembers.map((member) => (
              <Card key={member.id} className="glass-card border-border/30">
                <CardContent className="p-3">
                  <div className="flex items-center space-x-3">
                    <Avatar className="w-10 h-10">
                      <AvatarImage src={member.user.avatar_url || ''} />
                      <AvatarFallback className="text-sm">
                        {member.user.display_name.charAt(0).toUpperCase()}
                      </AvatarFallback>
                    </Avatar>
                    
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center space-x-2">
                        <p className="text-sm font-medium truncate">
                          {member.user.display_name}
                        </p>
                        {member.role === 'admin' && (
                          <Badge variant="secondary" className="text-xs px-1.5 py-0.5">
                            <Crown className="w-3 h-3 mr-1" />
                            Admin
                          </Badge>
                        )}
                      </div>
                      
                      <div className="flex items-center space-x-1 mt-1">
                        <Phone className="w-3 h-3 text-muted-foreground" />
                        <p className="text-xs text-muted-foreground">
                          {formatPhoneNumber(member.user.phone_number)}
                        </p>
                      </div>
                      
                      <p className="text-xs text-muted-foreground mt-1">
                        Joined {formatDistanceToNow(new Date(member.joined_at), { addSuffix: true })}
                      </p>
                    </div>

                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button variant="ghost" size="sm" className="h-6 w-6 p-0">
                          <MoreHorizontal className="w-3 h-3" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem>View Profile</DropdownMenuItem>
                        <DropdownMenuItem>Send Message</DropdownMenuItem>
                        {member.role !== 'admin' && (
                          <>
                            <DropdownMenuItem>Make Admin</DropdownMenuItem>
                            <DropdownMenuItem className="text-destructive">
                              Remove Member
                            </DropdownMenuItem>
                          </>
                        )}
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}