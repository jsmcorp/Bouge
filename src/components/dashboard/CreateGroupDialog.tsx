import { useState } from 'react';
import { Hash, Users } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { toast } from 'sonner';
import { useChatStore } from '@/store/chatStore';
import { ContactPicker, SelectedContact } from '@/components/contacts/ContactPicker';
import { Capacitor } from '@capacitor/core';

interface CreateGroupDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function CreateGroupDialog({ open, onOpenChange }: CreateGroupDialogProps) {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [selectedContacts, setSelectedContacts] = useState<SelectedContact[]>([]);
  const [showContactPicker, setShowContactPicker] = useState(false);
  const { createGroup, setActiveGroup } = useChatStore();

  // Check if running on native platform
  const isNativePlatform = Capacitor.isNativePlatform();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;

    setIsLoading(true);
    try {
      const group = await createGroup(
        name.trim(),
        description.trim() || undefined,
        selectedContacts // Pass selected contacts to createGroup
      );
      setActiveGroup(group);

      const memberCount = selectedContacts.length;
      const successMessage = memberCount > 0
        ? `Group "${group.name}" created with ${memberCount} member${memberCount !== 1 ? 's' : ''}!`
        : `Group "${group.name}" created successfully!`;

      toast.success(successMessage);
      onOpenChange(false);

      // Reset form
      setName('');
      setDescription('');
      setSelectedContacts([]);
    } catch (error) {
      toast.error('Failed to create group. Please try again.');
    } finally {
      setIsLoading(false);
    }
  };

  const handleContactsSelected = (contacts: SelectedContact[]) => {
    setSelectedContacts(contacts);
  };

  const handleRemoveContact = (contactId: number) => {
    setSelectedContacts(prev => prev.filter(c => c.contactId !== contactId));
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <div className="flex items-center space-x-2">
            <div className="flex items-center justify-center w-10 h-10 bg-green-500/20 rounded-lg">
              <Hash className="w-5 h-5 text-green-500" />
            </div>
            <div>
              <DialogTitle>Create New Group</DialogTitle>
              <DialogDescription>
                Start a new conversation space for your community
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>
        
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="name">Group Name</Label>
            <Input
              id="name"
              placeholder="e.g., Study Group, Friends Chat"
              value={name}
              onChange={(e) => setName(e.target.value)}
              maxLength={50}
              required
            />
            <p className="text-xs text-muted-foreground">
              {name.length}/50 characters
            </p>
          </div>
          
          <div className="space-y-2">
            <Label htmlFor="description">Description (Optional)</Label>
            <Textarea
              id="description"
              placeholder="What's this group about?"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              maxLength={200}
              rows={3}
            />
            <p className="text-xs text-muted-foreground">
              {description.length}/200 characters
            </p>
          </div>

          {/* Add Members Section (Native only) */}
          {isNativePlatform && (
            <div className="space-y-2">
              <Label>Members (Optional)</Label>
              <div className="space-y-2">
                <Button
                  type="button"
                  variant="outline"
                  className="w-full justify-start"
                  onClick={() => setShowContactPicker(true)}
                >
                  <Users className="h-4 w-4 mr-2" />
                  Add from Contacts
                  {selectedContacts.length > 0 && (
                    <Badge variant="secondary" className="ml-auto">
                      {selectedContacts.length}
                    </Badge>
                  )}
                </Button>

                {/* Selected Contacts List */}
                {selectedContacts.length > 0 && (
                  <div className="space-y-1 p-2 bg-muted/50 rounded-md max-h-32 overflow-y-auto">
                    {selectedContacts.map(contact => (
                      <div
                        key={contact.contactId}
                        className="flex items-center justify-between text-sm p-1.5 rounded hover:bg-background"
                      >
                        <span className="truncate">{contact.displayName}</span>
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          className="h-6 w-6 p-0 ml-2"
                          onClick={() => handleRemoveContact(contact.contactId)}
                        >
                          ×
                        </Button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
              <p className="text-xs text-muted-foreground">
                Add members from your contacts to the group
              </p>
            </div>
          )}

          <div className="flex justify-end space-x-2 pt-4">
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={isLoading}
            >
              Cancel
            </Button>
            <Button
              type="submit"
              disabled={isLoading || !name.trim()}
              className="bg-gradient-to-r from-green-500 to-green-600 hover:from-green-600 hover:to-green-700"
            >
              {isLoading ? 'Creating...' : 'Create Group'}
            </Button>
          </div>
        </form>
      </DialogContent>

      {/* Contact Picker Dialog */}
      {isNativePlatform && (
        <ContactPicker
          open={showContactPicker}
          onOpenChange={setShowContactPicker}
          onSelectContacts={handleContactsSelected}
          title="Add Members from Contacts"
          description="Select contacts to add to the group"
        />
      )}
    </Dialog>
  );
}