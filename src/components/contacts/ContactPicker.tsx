import { useState, useEffect, useMemo } from 'react';
import { Users, RefreshCw, UserPlus } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Separator } from '@/components/ui/separator';
import { Skeleton } from '@/components/ui/skeleton';
import { useContactsStore } from '@/store/contactsStore';
import { ContactListItem } from './ContactListItem';
import { ContactSearchBar } from './ContactSearchBar';
import { PermissionRequest } from './PermissionRequest';
import { RegisteredContact } from '@/lib/sqliteServices_Refactored/types';

interface ContactPickerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSelectContacts: (selectedContacts: SelectedContact[]) => void;
  title?: string;
  description?: string;
  maxSelection?: number;
}

export interface SelectedContact {
  contactId: number;
  phoneNumber: string;
  displayName: string;
  userId?: string; // If registered user
  isRegistered: boolean;
}

export function ContactPicker({
  open,
  onOpenChange,
  onSelectContacts,
  title = "Add Members from Contacts",
  description = "Select contacts to add to the group",
  maxSelection,
}: ContactPickerProps) {
  const {
    contacts,
    registeredUsers,
    isLoading,
    permissionGranted,
    error,
    requestPermission,
    smartSync,
    searchContacts,
  } = useContactsStore();

  const [searchQuery, setSearchQuery] = useState('');
  const [selectedContactIds, setSelectedContactIds] = useState<Set<number>>(new Set());
  const [isSyncing, setIsSyncing] = useState(false);

  // Filter contacts based on search query
  const filteredContacts = useMemo(() => {
    if (!searchQuery.trim()) {
      return contacts;
    }
    return searchContacts(searchQuery);
  }, [contacts, searchQuery, searchContacts]);

  // Create a map of registered users for quick lookup
  const registeredUserMap = useMemo(() => {
    const map = new Map<number, RegisteredContact>();
    registeredUsers.forEach(user => {
      map.set(user.contact_id, user);
    });
    return map;
  }, [registeredUsers]);

  // Sort contacts: registered users first, then alphabetically
  const sortedContacts = useMemo(() => {
    return [...filteredContacts].sort((a, b) => {
      const aIsRegistered = registeredUserMap.has(a.id);
      const bIsRegistered = registeredUserMap.has(b.id);
      
      if (aIsRegistered && !bIsRegistered) return -1;
      if (!aIsRegistered && bIsRegistered) return 1;
      
      return a.display_name.localeCompare(b.display_name);
    });
  }, [filteredContacts, registeredUserMap]);

  // Handle contact toggle
  const handleToggleContact = (contactId: number) => {
    setSelectedContactIds(prev => {
      const newSet = new Set(prev);
      if (newSet.has(contactId)) {
        newSet.delete(contactId);
      } else {
        // Check max selection limit
        if (maxSelection && newSet.size >= maxSelection) {
          return prev; // Don't add if limit reached
        }
        newSet.add(contactId);
      }
      return newSet;
    });
  };

  // Handle sync
  const handleSync = async () => {
    setIsSyncing(true);
    try {
      await smartSync();
    } catch (error) {
      console.error('Failed to sync contacts:', error);
    } finally {
      setIsSyncing(false);
    }
  };

  // Handle permission request
  const handleRequestPermission = async () => {
    const granted = await requestPermission();
    if (granted) {
      // Auto-sync after permission granted
      await handleSync();
    }
  };

  // Handle confirm selection
  const handleConfirm = () => {
    const selected: SelectedContact[] = [];
    
    selectedContactIds.forEach(contactId => {
      const contact = contacts.find(c => c.id === contactId);
      if (!contact) return;

      const registeredUser = registeredUserMap.get(contactId);
      
      selected.push({
        contactId: contact.id,
        phoneNumber: contact.phone_number,
        displayName: contact.display_name,
        userId: registeredUser?.user_id,
        isRegistered: !!registeredUser,
      });
    });

    onSelectContacts(selected);
    onOpenChange(false);
    
    // Reset state
    setSelectedContactIds(new Set());
    setSearchQuery('');
  };

  // Reset state when dialog closes
  useEffect(() => {
    if (!open) {
      setSelectedContactIds(new Set());
      setSearchQuery('');
    }
  }, [open]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg max-h-[80vh] flex flex-col p-0">
        <DialogHeader className="px-6 pt-6 pb-4">
          <div className="flex items-center space-x-2">
            <div className="flex items-center justify-center w-10 h-10 bg-green-500/20 rounded-lg">
              <Users className="w-5 h-5 text-green-500" />
            </div>
            <div>
              <DialogTitle>{title}</DialogTitle>
              <DialogDescription>{description}</DialogDescription>
            </div>
          </div>
        </DialogHeader>

        {/* Permission Request Screen */}
        {!permissionGranted ? (
          <div className="px-6 pb-6">
            <PermissionRequest
              onRequestPermission={handleRequestPermission}
              isLoading={isLoading}
              error={error}
            />
          </div>
        ) : (
          <>
            {/* Search Bar & Sync Button */}
            <div className="px-6 space-y-3">
              <ContactSearchBar
                value={searchQuery}
                onChange={setSearchQuery}
                placeholder="Search by name or phone..."
              />
              
              <div className="flex items-center justify-between">
                <p className="text-sm text-muted-foreground">
                  {selectedContactIds.size > 0 && (
                    <span className="font-medium text-green-600">
                      {selectedContactIds.size} selected
                    </span>
                  )}
                  {selectedContactIds.size === 0 && (
                    <span>
                      {filteredContacts.length} contact{filteredContacts.length !== 1 ? 's' : ''}
                      {registeredUsers.length > 0 && (
                        <> · {registeredUsers.length} on Confessr</>
                      )}
                    </span>
                  )}
                </p>
                
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={handleSync}
                  disabled={isSyncing}
                  className="h-8"
                >
                  <RefreshCw className={`h-4 w-4 mr-2 ${isSyncing ? 'animate-spin' : ''}`} />
                  Sync
                </Button>
              </div>
            </div>

            <Separator />

            {/* Contact List */}
            <ScrollArea className="flex-1 px-6">
              {isLoading ? (
                // Loading skeleton
                <div className="space-y-3 py-4">
                  {[...Array(5)].map((_, i) => (
                    <div key={i} className="flex items-center space-x-3">
                      <Skeleton className="h-4 w-4 rounded" />
                      <Skeleton className="h-10 w-10 rounded-full" />
                      <div className="flex-1 space-y-2">
                        <Skeleton className="h-4 w-32" />
                        <Skeleton className="h-3 w-24" />
                      </div>
                    </div>
                  ))}
                </div>
              ) : sortedContacts.length === 0 ? (
                // Empty state
                <div className="flex flex-col items-center justify-center py-12 space-y-4">
                  <div className="flex items-center justify-center w-16 h-16 bg-muted rounded-full">
                    <UserPlus className="w-8 h-8 text-muted-foreground" />
                  </div>
                  <div className="text-center space-y-1">
                    <p className="text-sm font-medium">No contacts found</p>
                    <p className="text-xs text-muted-foreground">
                      {searchQuery ? 'Try a different search term' : 'Sync your contacts to get started'}
                    </p>
                  </div>
                  {!searchQuery && (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={handleSync}
                      disabled={isSyncing}
                    >
                      <RefreshCw className={`h-4 w-4 mr-2 ${isSyncing ? 'animate-spin' : ''}`} />
                      Sync Contacts
                    </Button>
                  )}
                </div>
              ) : (
                // Contact list
                <div className="space-y-1 py-4">
                  {sortedContacts.map(contact => {
                    const registeredUser = registeredUserMap.get(contact.id);
                    return (
                      <ContactListItem
                        key={contact.id}
                        contactId={contact.id}
                        displayName={contact.display_name}
                        phoneNumber={contact.phone_number}
                        avatarUrl={registeredUser?.user_avatar_url}
                        isRegistered={!!registeredUser}
                        isSelected={selectedContactIds.has(contact.id)}
                        onToggle={handleToggleContact}
                      />
                    );
                  })}
                </div>
              )}
            </ScrollArea>

            <Separator />

            {/* Footer */}
            <DialogFooter className="px-6 py-4">
              <Button
                type="button"
                variant="outline"
                onClick={() => onOpenChange(false)}
              >
                Cancel
              </Button>
              <Button
                type="button"
                onClick={handleConfirm}
                disabled={selectedContactIds.size === 0}
                className="bg-gradient-to-r from-green-500 to-green-600 hover:from-green-600 hover:to-green-700"
              >
                Add {selectedContactIds.size > 0 && `(${selectedContactIds.size})`}
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

