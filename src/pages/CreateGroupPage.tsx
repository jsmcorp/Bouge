import { useState, useEffect } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { ArrowLeft, Hash, Users, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { toast } from 'sonner';
import { useChatStore } from '@/store/chatStore';
import { Capacitor } from '@capacitor/core';

export interface SelectedContact {
  contactId: number;
  phoneNumber: string;
  displayName: string;
  userId?: string;
  isRegistered: boolean;
}

export default function CreateGroupPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [selectedContacts, setSelectedContacts] = useState<SelectedContact[]>([]);
  const { createGroup, setActiveGroup } = useChatStore();

  const isNativePlatform = Capacitor.isNativePlatform();

  // Update selected contacts when returning from contact selection page
  useEffect(() => {
    const stateContacts = (location.state as any)?.selectedContacts as SelectedContact[];
    if (stateContacts && stateContacts.length > 0) {
      setSelectedContacts(stateContacts);
    }
  }, [location.state]);

  const handleBack = () => {
    navigate(-1);
  };

  const handleAddMembers = () => {
    // Navigate to contact selection page
    navigate('/create-group/select-contacts', {
      state: { selectedContacts }
    });
  };

  const handleRemoveContact = (contactId: number) => {
    setSelectedContacts(prev => prev.filter(c => c.contactId !== contactId));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;

    setIsLoading(true);
    try {
      const group = await createGroup(
        name.trim(),
        description.trim() || undefined,
        selectedContacts
      );
      setActiveGroup(group);

      const memberCount = selectedContacts.length;
      const successMessage = memberCount > 0
        ? `Group "${group.name}" created with ${memberCount} member${memberCount !== 1 ? 's' : ''}!`
        : `Group "${group.name}" created successfully!`;

      toast.success(successMessage);
      
      // Navigate to the new group
      navigate(`/groups/${group.id}`, { replace: true });
    } catch (error) {
      toast.error('Failed to create group. Please try again.');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="flex flex-col h-screen bg-background">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b bg-card">
        <div className="flex items-center space-x-3">
          <Button
            variant="ghost"
            size="sm"
            className="h-9 w-9 p-0"
            onClick={handleBack}
          >
            <ArrowLeft className="h-5 w-5" />
          </Button>
          <div>
            <h1 className="text-lg font-semibold">New Group</h1>
            <p className="text-xs text-muted-foreground">
              Create a new conversation space
            </p>
          </div>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto">
        <form onSubmit={handleSubmit} className="max-w-2xl mx-auto p-4 space-y-6">
          {/* Group Icon Placeholder */}
          <div className="flex justify-center">
            <div className="flex items-center justify-center w-24 h-24 bg-green-500/20 rounded-full">
              <Hash className="w-12 h-12 text-green-500" />
            </div>
          </div>

          {/* Group Name */}
          <div className="space-y-2">
            <Label htmlFor="name" className="text-base">Group Name</Label>
            <Input
              id="name"
              placeholder="e.g., Study Group, Friends Chat"
              value={name}
              onChange={(e) => setName(e.target.value)}
              maxLength={50}
              required
              className="text-base h-12"
              autoFocus
            />
            <p className="text-xs text-muted-foreground">
              {name.length}/50 characters
            </p>
          </div>

          {/* Description */}
          <div className="space-y-2">
            <Label htmlFor="description" className="text-base">Description (Optional)</Label>
            <Textarea
              id="description"
              placeholder="What's this group about?"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              maxLength={200}
              rows={4}
              className="text-base resize-none"
            />
            <p className="text-xs text-muted-foreground">
              {description.length}/200 characters
            </p>
          </div>

          {/* Add Members Section (Native only) */}
          {isNativePlatform && (
            <div className="space-y-3">
              <Label className="text-base">Members (Optional)</Label>
              
              <Button
                type="button"
                variant="outline"
                className="w-full justify-start h-12 text-base"
                onClick={handleAddMembers}
              >
                <Users className="h-5 w-5 mr-3" />
                Add Members from Contacts
                {selectedContacts.length > 0 && (
                  <Badge variant="secondary" className="ml-auto">
                    {selectedContacts.length}
                  </Badge>
                )}
              </Button>

              {/* Selected Contacts List */}
              {selectedContacts.length > 0 && (
                <div className="space-y-2">
                  <p className="text-sm font-medium text-muted-foreground">
                    {selectedContacts.length} member{selectedContacts.length !== 1 ? 's' : ''} selected
                  </p>
                  <div className="space-y-2 p-3 bg-muted/50 rounded-lg max-h-48 overflow-y-auto">
                    {selectedContacts.map(contact => (
                      <div
                        key={contact.contactId}
                        className="flex items-center justify-between p-2 rounded-md bg-background"
                      >
                        <div className="flex items-center space-x-3 flex-1 min-w-0">
                          <div className="flex items-center justify-center w-10 h-10 bg-green-500/20 rounded-full flex-shrink-0">
                            <span className="text-sm font-medium text-green-600">
                              {contact.displayName.charAt(0).toUpperCase()}
                            </span>
                          </div>
                          <div className="flex-1 min-w-0">
                            <p className="text-sm font-medium truncate">{contact.displayName}</p>
                            <p className="text-xs text-muted-foreground truncate">{contact.phoneNumber}</p>
                          </div>
                        </div>
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          className="h-8 w-8 p-0 ml-2 flex-shrink-0"
                          onClick={() => handleRemoveContact(contact.contactId)}
                        >
                          <X className="h-4 w-4" />
                        </Button>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Create Button */}
          <div className="pt-4">
            <Button
              type="submit"
              disabled={isLoading || !name.trim()}
              className="w-full h-12 text-base bg-gradient-to-r from-green-500 to-green-600 hover:from-green-600 hover:to-green-700"
            >
              {isLoading ? 'Creating Group...' : 'Create Group'}
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}

