import { useState, useEffect, useMemo } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { ArrowLeft, Search, RefreshCw, Share2, Check, UserCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Skeleton } from '@/components/ui/skeleton';
import { useContactsStore } from '@/store/contactsStore';
import { PermissionRequest } from '@/components/contacts/PermissionRequest';
import { RegisteredContact, LocalContact } from '@/lib/sqliteServices_Refactored/types';
import { Share } from '@capacitor/share';
import { toast } from 'sonner';

interface SelectedContact {
  contactId: number;
  phoneNumber: string;
  displayName: string;
  userId?: string;
  isRegistered: boolean;
}

export default function ContactSelectionPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const {
    contacts,
    registeredUsers,
    isLoading,
    permissionGranted,
    error,
    syncProgress,
    requestPermission,
    discoverInBackgroundV3,
    searchContacts,
  } = useContactsStore();

  const [searchQuery, setSearchQuery] = useState('');
  const [selectedContactIds, setSelectedContactIds] = useState<Set<number>>(new Set());
  const [isSyncing, setIsSyncing] = useState(false);

  // Get previously selected contacts from navigation state
  const previouslySelected = (location.state as any)?.selectedContacts as SelectedContact[] || [];

  // Initialize selected contacts from previous selection
  useEffect(() => {
    if (previouslySelected.length > 0) {
      const ids = new Set(previouslySelected.map(c => c.contactId));
      setSelectedContactIds(ids);
    }
  }, []);

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

  // Separate registered and non-registered contacts
  const { registeredContacts, nonRegisteredContacts } = useMemo(() => {
    const registered: LocalContact[] = [];
    const nonRegistered: LocalContact[] = [];

    filteredContacts.forEach(contact => {
      if (registeredUserMap.has(contact.id)) {
        registered.push(contact);
      } else {
        nonRegistered.push(contact);
      }
    });

    // Sort alphabetically
    registered.sort((a, b) => a.display_name.localeCompare(b.display_name));
    nonRegistered.sort((a, b) => a.display_name.localeCompare(b.display_name));

    return { registeredContacts: registered, nonRegisteredContacts: nonRegistered };
  }, [filteredContacts, registeredUserMap]);

  const handleBack = () => {
    navigate(-1);
  };

  const handleToggleContact = (contactId: number) => {
    setSelectedContactIds(prev => {
      const newSet = new Set(prev);
      if (newSet.has(contactId)) {
        newSet.delete(contactId);
      } else {
        newSet.add(contactId);
      }
      return newSet;
    });
  };

  const handleSync = async () => {
    setIsSyncing(true);
    try {
      await discoverInBackgroundV3();
      toast.success('Contacts synced successfully');
    } catch (error) {
      console.error('Failed to sync contacts:', error);
      toast.error('Failed to sync contacts');
    } finally {
      setIsSyncing(false);
    }
  };

  const handleRequestPermission = async () => {
    const granted = await requestPermission();
    if (granted) {
      await handleSync();
    }
  };

  const handleInvite = async (contact: LocalContact) => {
    try {
      await Share.share({
        title: 'Join Bouge',
        text: 'Download the Bouge app - this is something we have been waiting for!',
        dialogTitle: `Invite ${contact.display_name}`,
      });
    } catch (error) {
      console.error('Failed to share invite:', error);
      // User cancelled share or error occurred
    }
  };

  const handleDone = () => {
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

    // Navigate back to create group page with selected contacts
    navigate('/create-group', {
      state: { selectedContacts: selected },
      replace: true
    });
  };

  return (
    <div className="flex flex-col h-screen bg-background">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b bg-card">
        <div className="flex items-center space-x-3 flex-1">
          <Button
            variant="ghost"
            size="sm"
            className="h-9 w-9 p-0"
            onClick={handleBack}
          >
            <ArrowLeft className="h-5 w-5" />
          </Button>
          <div className="flex-1">
            <h1 className="text-lg font-semibold">Select Contacts</h1>
            <p className="text-xs text-muted-foreground">
              {selectedContactIds.size > 0 
                ? `${selectedContactIds.size} selected`
                : `${registeredContacts.length} on Bouge`
              }
            </p>
          </div>
        </div>
        {selectedContactIds.size > 0 && (
          <Button
            onClick={handleDone}
            size="sm"
            className="bg-green-600 hover:bg-green-700"
          >
            <Check className="h-4 w-4 mr-2" />
            Done
          </Button>
        )}
      </div>

      {/* Permission Request Screen */}
      {!permissionGranted ? (
        <div className="flex-1 flex items-center justify-center p-6">
          <div className="max-w-md w-full">
            <PermissionRequest
              onRequestPermission={handleRequestPermission}
              isLoading={isLoading}
              error={error}
            />
          </div>
        </div>
      ) : (
        <>
          {/* Search Bar & Sync */}
          <div className="px-4 py-3 space-y-3 border-b">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search by name or phone..."
                className="pl-10 h-11"
              />
            </div>
            
            <div className="flex items-center justify-between">
              <p className="text-sm text-muted-foreground">
                {filteredContacts.length} contact{filteredContacts.length !== 1 ? 's' : ''}
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

          {/* Selected Contacts Preview (if any) */}
          {selectedContactIds.size > 0 && (
            <div className="px-4 py-2 bg-green-50 dark:bg-green-950/20 border-b">
              <p className="text-sm font-medium text-green-700 dark:text-green-400">
                {selectedContactIds.size} contact{selectedContactIds.size !== 1 ? 's' : ''} selected
              </p>
            </div>
          )}

          {/* Contact List */}
          <ScrollArea className="flex-1">
            {isLoading ? (
              <div className="space-y-4 p-4">
                {/* Progress Bar */}
                {syncProgress && (
                  <div className="space-y-2">
                    <div className="flex items-center justify-between text-sm">
                      <span className="text-muted-foreground">{syncProgress.message}</span>
                      <span className="font-medium">
                        {Math.round((syncProgress.current / syncProgress.total) * 100)}%
                      </span>
                    </div>
                    <div className="h-2 bg-secondary rounded-full overflow-hidden">
                      <div
                        className="h-full bg-primary transition-all duration-300"
                        style={{
                          width: `${(syncProgress.current / syncProgress.total) * 100}%`
                        }}
                      />
                    </div>
                  </div>
                )}

                {/* Loading Skeletons */}
                <div className="space-y-3">
                  {[...Array(8)].map((_, i) => (
                    <div key={i} className="flex items-center space-x-3">
                      <Skeleton className="h-5 w-5 rounded" />
                      <Skeleton className="h-12 w-12 rounded-full" />
                      <div className="flex-1 space-y-2">
                        <Skeleton className="h-4 w-32" />
                        <Skeleton className="h-3 w-24" />
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ) : (
              <div className="pb-4">
                {/* Registered Contacts Section */}
                {registeredContacts.length > 0 && (
                  <div>
                    <div className="px-4 py-2 bg-muted/50 sticky top-0 z-10">
                      <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                        On Bouge ({registeredContacts.length})
                      </p>
                    </div>
                    <div className="px-4 py-2 space-y-1">
                      {registeredContacts.map(contact => {
                        const registeredUser = registeredUserMap.get(contact.id);
                        const isSelected = selectedContactIds.has(contact.id);
                        
                        return (
                          <button
                            key={contact.id}
                            onClick={() => handleToggleContact(contact.id)}
                            className="w-full flex items-center space-x-3 p-2 rounded-lg hover:bg-muted/50 transition-colors"
                          >
                            <div className={`flex items-center justify-center w-5 h-5 rounded border-2 flex-shrink-0 ${
                              isSelected 
                                ? 'bg-green-600 border-green-600' 
                                : 'border-muted-foreground/30'
                            }`}>
                              {isSelected && <Check className="h-3 w-3 text-white" />}
                            </div>
                            <div className="flex items-center justify-center w-12 h-12 bg-green-500/20 rounded-full flex-shrink-0">
                              {registeredUser?.user_avatar_url ? (
                                <img
                                  src={registeredUser.user_avatar_url}
                                  alt={contact.display_name}
                                  className="w-12 h-12 rounded-full object-cover"
                                />
                              ) : (
                                <UserCircle className="w-12 h-12 text-green-600" />
                              )}
                            </div>
                            <div className="flex-1 text-left min-w-0">
                              <p className="text-sm font-medium truncate">{contact.display_name}</p>
                              <p className="text-xs text-muted-foreground truncate">{contact.phone_number}</p>
                            </div>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                )}

                {/* Non-Registered Contacts Section */}
                {nonRegisteredContacts.length > 0 && (
                  <div className="mt-2">
                    <div className="px-4 py-2 bg-muted/50 sticky top-0 z-10">
                      <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                        Invite to Bouge ({nonRegisteredContacts.length})
                      </p>
                    </div>
                    <div className="px-4 py-2 space-y-1">
                      {nonRegisteredContacts.map(contact => (
                        <div
                          key={contact.id}
                          className="flex items-center space-x-3 p-2 rounded-lg hover:bg-muted/30 transition-colors"
                        >
                          <div className="flex items-center justify-center w-12 h-12 bg-muted rounded-full flex-shrink-0">
                            <UserCircle className="w-12 h-12 text-muted-foreground" />
                          </div>
                          <div className="flex-1 text-left min-w-0">
                            <p className="text-sm font-medium truncate">{contact.display_name}</p>
                            <p className="text-xs text-muted-foreground truncate">{contact.phone_number}</p>
                          </div>
                          <Button
                            variant="default"
                            size="sm"
                            onClick={() => handleInvite(contact)}
                            className="flex-shrink-0 bg-blue-600 hover:bg-blue-700 text-white"
                          >
                            <Share2 className="h-4 w-4 mr-1" />
                            Invite
                          </Button>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Empty State */}
                {filteredContacts.length === 0 && !isLoading && (
                  <div className="flex flex-col items-center justify-center py-12 px-4">
                    <div className="text-center space-y-2">
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
                        className="mt-4"
                      >
                        <RefreshCw className={`h-4 w-4 mr-2 ${isSyncing ? 'animate-spin' : ''}`} />
                        Sync Contacts
                      </Button>
                    )}
                  </div>
                )}
              </div>
            )}
          </ScrollArea>
        </>
      )}
    </div>
  );
}

