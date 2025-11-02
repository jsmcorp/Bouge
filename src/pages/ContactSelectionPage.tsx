import { useState, useEffect, useMemo, useRef } from 'react';
import { useNavigate, useLocation, useParams } from 'react-router-dom';
import { ArrowLeft, Search, RefreshCw, Share2, Check, UserCircle, CheckCircle2, Circle, UserCheck } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { Badge } from '@/components/ui/badge';
import AutoSizer from 'react-virtualized-auto-sizer';
import type { VariableSizeList as RVList, ListOnItemsRenderedProps, ListChildComponentProps } from 'react-window';
import { VariableSizeList } from 'react-window';
import { useContactsStore } from '@/store/contactsStore';
import { useChatStore } from '@/store/chatStore';
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
  const { groupId } = useParams();
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

  const { groupMembers, fetchGroupMembers, addGroupMembers } = useChatStore();

  const [searchQuery, setSearchQuery] = useState('');
  const [selectedContactIds, setSelectedContactIds] = useState<Set<number>>(new Set());
  const [isSyncing, setIsSyncing] = useState(false);
  const [isAddingMembers, setIsAddingMembers] = useState(false);

  // Determine if we're in "add members" mode or "create group" mode
  const isAddMembersMode = !!groupId;

  // Get previously selected contacts from navigation state (typed)
  const navState = location.state as { selectedContacts?: SelectedContact[] } | null;
  const previouslySelected = navState?.selectedContacts ?? [];

  // Fetch existing group members if in add members mode
  useEffect(() => {
    if (isAddMembersMode && groupId) {
      fetchGroupMembers(groupId);
    }
    // CRITICAL FIX: Don't include fetchGroupMembers in deps
    // It's a stable Zustand action and including it causes infinite re-fetches
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAddMembersMode, groupId]);

  // Create a set of existing member user IDs for quick lookup
  const existingMemberUserIds = useMemo(() => {
    if (!isAddMembersMode) return new Set<string>();
    return new Set(groupMembers.map(m => m.user_id));
  }, [isAddMembersMode, groupMembers]);

  // Initialize selected contacts from previous selection
  useEffect(() => {
    if (previouslySelected.length > 0) {
      const ids = new Set(previouslySelected.map(c => c.contactId));
      setSelectedContactIds(ids);
    }
  }, [previouslySelected]);

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

  // Group contacts alphabetically (A-Z) by display name
  const groupedRegistered = useMemo(() => {
    const groups: Record<string, LocalContact[]> = {};
    for (const c of registeredContacts) {
      const letter = (c.display_name?.[0] || '#').toUpperCase();
      const key = /[A-Z]/.test(letter) ? letter : '#';
      (groups[key] ||= []).push(c);
    }
    Object.keys(groups).forEach(k => groups[k].sort((a, b) => a.display_name.localeCompare(b.display_name)));
    return groups;
  }, [registeredContacts]);

  const groupedNonRegistered = useMemo(() => {
    const groups: Record<string, LocalContact[]> = {};
    for (const c of nonRegisteredContacts) {
      const letter = (c.display_name?.[0] || '#').toUpperCase();
      const key = /[A-Z]/.test(letter) ? letter : '#';
      (groups[key] ||= []).push(c);
    }
    Object.keys(groups).forEach(k => groups[k].sort((a, b) => a.display_name.localeCompare(b.display_name)));
    return groups;
  }, [nonRegisteredContacts]);

  // Build a single virtualized list of items: section titles, letters, and contacts
  type Item =
    | { type: 'section'; title: string }
    | { type: 'letter'; letter: string; group: 'registered' | 'non' }
    | { type: 'contact'; contact: LocalContact; registeredUser?: RegisteredContact; group: 'registered' | 'non' };

  const listItems: Item[] = useMemo(() => {
    const items: Item[] = [];
    if (registeredContacts.length > 0) {
      items.push({ type: 'section', title: `On Bouge (${registeredContacts.length})` });
      const letters = Object.keys(groupedRegistered).sort();
      for (const letter of letters) {
        items.push({ type: 'letter', letter, group: 'registered' });
        for (const c of groupedRegistered[letter]) {
          items.push({ type: 'contact', contact: c, registeredUser: registeredUserMap.get(c.id), group: 'registered' });
        }
      }
    }
    if (nonRegisteredContacts.length > 0) {
      items.push({ type: 'section', title: `Invite to Bouge (${nonRegisteredContacts.length})` });
      const letters = Object.keys(groupedNonRegistered).sort();
      for (const letter of letters) {
        items.push({ type: 'letter', letter, group: 'non' });
        for (const c of groupedNonRegistered[letter]) {
          items.push({ type: 'contact', contact: c, group: 'non' });
        }
      }
    }
    return items;
  }, [registeredContacts, groupedRegistered, nonRegisteredContacts, groupedNonRegistered, registeredUserMap]);

  // Map registered letters to their first index in the flat list for fast scroll
  const registeredLetterIndexMap = useMemo(() => {
    const map = new Map<string, number>();
    for (let i = 0; i < listItems.length; i++) {
      const it = listItems[i];
      if (it.type === 'letter' && it.group === 'registered' && !map.has(it.letter)) {
        map.set(it.letter, i);
      }
    }
    return map;
  }, [listItems]);

  // Virtual row sizing
  const SECTION_HEIGHT = 40;
  const LETTER_HEIGHT = 32;
  const CONTACT_HEIGHT = 60;
  const getItemSize = (index: number) => {
    const it = listItems[index];
    if (it.type === 'section') return SECTION_HEIGHT;
    if (it.type === 'letter') return LETTER_HEIGHT;
    return CONTACT_HEIGHT;
  };

  // Virtual list ref and scroll helper
  const listRef = useRef<RVList | null>(null);
  const scrollToLetter = (letter: string) => {
    const idx = registeredLetterIndexMap.get(letter);
    if (idx != null && listRef.current) listRef.current.scrollToItem(idx, 'start');
  };

  const presentLetters = useMemo(() => Object.keys(groupedRegistered).sort(), [groupedRegistered]);
  const [visibleIndex, setVisibleIndex] = useState(0);
  const currentLetter = useMemo(() => {
    for (let i = visibleIndex; i >= 0; i--) {
      const it = listItems[i];
      if (it?.type === 'letter' && it.group === 'registered') return it.letter;
      if (it?.type === 'section' && it.title.startsWith('Invite')) break;
    }
    return null as string | null;
  }, [visibleIndex, listItems]);



  // Keyboard accessibility for selection rows
  const onRowKeyDown = (e: React.KeyboardEvent, contactId: number) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      handleToggleContact(contactId);
    }
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

  const handleDone = async () => {
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

    if (isAddMembersMode && groupId) {
      // Add members mode - add selected users to the group
      setIsAddingMembers(true);
      try {
        const userIds = selected
          .filter(c => c.isRegistered && c.userId)
          .map(c => c.userId!);

        if (userIds.length === 0) {
          toast.error('Please select at least one registered user');
          return;
        }

        await addGroupMembers(groupId, userIds);

        const memberCount = userIds.length;
        toast.success(`${memberCount} member${memberCount !== 1 ? 's' : ''} added successfully`);

        // Navigate back to group details
        navigate(`/groups/${groupId}/details`, { replace: true });
      } catch (error) {
        console.error('Failed to add members:', error);
        toast.error('Failed to add members. Please try again.');
      } finally {
        setIsAddingMembers(false);
      }
    } else {
      // Create group mode - navigate back to create group page with selected contacts
      navigate('/create-group', {
        state: { selectedContacts: selected },
        replace: true
      });
    }
  };

  const handleBack = () => {
    if (isAddMembersMode && groupId) {
      navigate(`/groups/${groupId}/details`);
    } else {
      navigate('/create-group');
    }
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
            <h1 className="text-lg font-semibold">
              {isAddMembersMode ? 'Add Participants' : 'Select Contacts'}
            </h1>
            <p className="text-xs text-muted-foreground">
              {selectedContactIds.size > 0
                ? `${selectedContactIds.size} selected`
                : `${registeredContacts.length} on Bouge`
              }
            </p>
          </div>
        </div>
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
          <div className="px-4 py-3 space-y-3 border-b sticky top-0 z-20 bg-background">
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

          {/* Contact List (virtualized) */}
          <div className="flex-1 min-h-0">
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
              <div className="h-full relative">
                {currentLetter && (
                  <div className="absolute top-0 left-0 right-0 z-10 pointer-events-none">
                    <div className="px-4 py-2 bg-background/80 backdrop-blur supports-[backdrop-filter]:bg-background/60">
                      <p className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wide">{currentLetter}</p>
                    </div>
                  </div>
                )}
                <AutoSizer>
                  {({ height, width }) => (
                    <VariableSizeList
                      ref={listRef}
                      height={height}
                      width={width}
                      itemCount={listItems.length}
                      itemSize={getItemSize}
                      estimatedItemSize={CONTACT_HEIGHT}
                      onItemsRendered={(info: ListOnItemsRenderedProps) => setVisibleIndex(info.visibleStartIndex)}
                    >
                      {({ index, style }: ListChildComponentProps) => {
                        const it = listItems[index];
                        if (it.type === 'section') {
                          return (
                            <div style={style} className="px-4 py-2 bg-muted/50">
                              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">{it.title}</p>
                            </div>
                          );
                        }
                        if (it.type === 'letter') {
                          return (
                            <div style={style} className="px-4 py-2 bg-background">
                              <p className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wide">{it.letter}</p>
                            </div>
                          );
                        }
                        if (it.type === 'contact') {
                          const contact = it.contact;
                          const isSelected = selectedContactIds.has(contact.id);
                          if (it.group === 'registered') {
                            const registeredUser = it.registeredUser;
                            const isAlreadyMember = isAddMembersMode && registeredUser?.user_id && existingMemberUserIds.has(registeredUser.user_id);
                            return (
                              <div style={style} className="w-full">
                                <div
                                  role="checkbox"
                                  aria-checked={isSelected}
                                  aria-disabled={isAlreadyMember || undefined}
                                  tabIndex={isAlreadyMember ? -1 : 0}
                                  onKeyDown={(e) => !isAlreadyMember && onRowKeyDown(e, contact.id)}
                                  onClick={() => !isAlreadyMember && handleToggleContact(contact.id)}
                                  className={`group w-full flex items-center justify-between px-4 py-3 transition-colors min-h-[56px] focus:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
                                    isAlreadyMember
                                      ? 'opacity-50 cursor-not-allowed bg-muted/30'
                                      : isSelected
                                        ? 'bg-green-50 dark:bg-green-950/20'
                                        : 'hover:bg-muted/50 active:bg-muted/70 cursor-pointer'
                                  }`}
                                >
                                  <div className="flex items-center space-x-3 min-w-0 flex-1">
                                    <div className="w-12 h-12 rounded-full bg-green-500/20 flex items-center justify-center flex-shrink-0 overflow-hidden">
                                      {registeredUser?.user_avatar_url ? (
                                        <img src={registeredUser.user_avatar_url} alt={contact.display_name} className="w-12 h-12 object-cover" />
                                      ) : (
                                        <UserCircle className="w-7 h-7 text-green-600" />
                                      )}
                                    </div>
                                    <div className="min-w-0 flex-1">
                                      <p className="text-[15px] font-medium truncate">{contact.display_name}</p>
                                      <p className="text-xs text-muted-foreground truncate">{contact.phone_number}</p>
                                    </div>
                                    {isAlreadyMember && (
                                      <Badge variant="secondary" className="text-xs ml-2 flex-shrink-0">
                                        <UserCheck className="w-3 h-3 mr-1" />
                                        Already in group
                                      </Badge>
                                    )}
                                  </div>
                                  <div className="ml-3 flex-shrink-0">
                                    {isAlreadyMember ? (
                                      <UserCheck className="h-5 w-5 text-muted-foreground" />
                                    ) : isSelected ? (
                                      <CheckCircle2 className="h-5 w-5 text-green-600 transition-opacity" />
                                    ) : (
                                      <Circle className="h-5 w-5 text-muted-foreground/50 transition-opacity" />
                                    )}
                                  </div>
                                </div>
                              </div>
                            );
                          }
                          // non-registered contact row
                          return (
                            <div style={style} className="w-full">
                              <div className="w-full flex items-center justify-between px-4 py-3 hover:bg-muted/30 transition-colors min-h-[56px]">
                                <div className="flex items-center space-x-3 min-w-0">
                                  <div className="w-12 h-12 rounded-full bg-muted flex items-center justify-center flex-shrink-0">
                                    <UserCircle className="w-7 h-7 text-muted-foreground" />
                                  </div>
                                  <div className="min-w-0">
                                    <p className="text-[15px] font-medium truncate">{contact.display_name}</p>
                                    <p className="text-xs text-muted-foreground truncate">{contact.phone_number}</p>
                                  </div>
                                </div>
                                <Button
                                  variant="secondary"
                                  size="sm"
                                  onClick={() => handleInvite(contact)}
                                  className="flex-shrink-0"
                                  aria-label={`Invite ${contact.display_name} to Bouge`}
                                >
                                  <Share2 className="h-4 w-4 mr-1" />
                                  Invite
                                </Button>
                              </div>
                            </div>
                          );
                        }
                        return null;
                      }}
                    </VariableSizeList>
                  )}
                </AutoSizer>

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
          </div>
          {/* Fast scroll index (registered letters) */}
          {presentLetters.length > 0 && (
            <div className="fixed right-1 top-28 bottom-24 z-30 flex flex-col items-center justify-center gap-1 pointer-events-auto">
              {presentLetters.map((letter) => (
                <button
                  key={letter}
                  onClick={() => scrollToLetter(letter)}
                  className="text-[11px] leading-none px-1.5 py-1 rounded text-muted-foreground hover:text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  aria-label={`Jump to ${letter}`}
                >
                  {letter}
                </button>
              ))}
            </div>
          )}

          {/* FAB - confirm selection */}
          {selectedContactIds.size > 0 && (
            <Button
              type="button"
              onClick={handleDone}
              disabled={isAddingMembers}
              className="fixed bottom-6 right-5 h-14 w-14 rounded-full shadow-lg bg-green-600 hover:bg-green-700 text-white disabled:opacity-50"
              aria-label={isAddMembersMode
                ? `Add ${selectedContactIds.size} participant${selectedContactIds.size !== 1 ? 's' : ''}`
                : `Add ${selectedContactIds.size} contact${selectedContactIds.size !== 1 ? 's' : ''}`
              }
            >
              <Check className="h-6 w-6" />
            </Button>
          )}

        </>
      )}
    </div>
  );
}

