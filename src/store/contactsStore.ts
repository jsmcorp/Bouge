import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { contactsService } from '@/lib/contactsService';
import { sqliteService } from '@/lib/sqliteServices_Refactored/sqliteService';
import { LocalContact, RegisteredContact } from '@/lib/sqliteServices_Refactored/types';

/**
 * ContactsStore - Zustand store for contacts feature
 * 
 * State:
 * - contacts: All synced device contacts
 * - registeredUsers: Contacts that are registered Confessr users
 * - isLoading: Loading state for async operations
 * - permissionGranted: READ_CONTACTS permission status
 * - lastSyncTime: Timestamp of last successful sync
 * - error: Error message from last operation
 * 
 * Actions:
 * - requestPermission: Request READ_CONTACTS permission
 * - syncContacts: Sync contacts from device
 * - loadFromSQLite: Load contacts from local database
 * - discoverUsers: Discover registered users
 * - fullSync: Complete sync (contacts + user discovery)
 * - searchContacts: Search contacts by name or phone
 * - clearContacts: Clear all contact data
 */

interface ContactsState {
  // State
  contacts: LocalContact[];
  registeredUsers: RegisteredContact[];
  isLoading: boolean;
  permissionGranted: boolean;
  lastSyncTime: number | null;
  error: string | null;
  isInitialized: boolean;

  // Actions
  setContacts: (contacts: LocalContact[]) => void;
  setRegisteredUsers: (users: RegisteredContact[]) => void;
  setLoading: (loading: boolean) => void;
  setPermissionGranted: (granted: boolean) => void;
  setLastSyncTime: (time: number | null) => void;
  setError: (error: string | null) => void;
  setInitialized: (initialized: boolean) => void;

  // Async Actions
  requestPermission: () => Promise<boolean>;
  checkPermission: () => Promise<boolean>;
  syncContacts: () => Promise<void>;
  loadFromSQLite: () => Promise<void>;
  discoverUsers: () => Promise<void>;
  fullSync: () => Promise<void>;
  searchContacts: (query: string) => LocalContact[];
  clearContacts: () => Promise<void>;
  initialize: () => Promise<void>;
}

export const useContactsStore = create<ContactsState>()(
  persist(
    (set, get) => ({
      // Initial State
      contacts: [],
      registeredUsers: [],
      isLoading: false,
      permissionGranted: false,
      lastSyncTime: null,
      error: null,
      isInitialized: false,

      // Setters
      setContacts: (contacts) => {
        console.log('📇 Setting contacts:', contacts.length);
        set({ contacts });
      },

      setRegisteredUsers: (users) => {
        console.log('📇 Setting registered users:', users.length);
        set({ registeredUsers: users });
      },

      setLoading: (loading) => {
        console.log('📇 Setting loading:', loading);
        set({ isLoading: loading });
      },

      setPermissionGranted: (granted) => {
        console.log('📇 Setting permission granted:', granted);
        set({ permissionGranted: granted });
      },

      setLastSyncTime: (time) => {
        console.log('📇 Setting last sync time:', time ? new Date(time).toISOString() : 'null');
        set({ lastSyncTime: time });
      },

      setError: (error) => {
        if (error) {
          console.error('📇 Setting error:', error);
        }
        set({ error });
      },

      setInitialized: (initialized) => {
        console.log('📇 Setting initialized:', initialized);
        set({ isInitialized: initialized });
      },

      // Check if contacts feature is available (native platform only)
      checkPermission: async () => {
        console.log('📇 Checking contacts permission...');
        
        if (!contactsService.isAvailable()) {
          console.log('📇 Contacts not available on this platform');
          set({ permissionGranted: false });
          return false;
        }

        try {
          const granted = await contactsService.checkPermission();
          set({ permissionGranted: granted });
          return granted;
        } catch (error) {
          console.error('📇 Error checking permission:', error);
          set({ 
            error: error instanceof Error ? error.message : 'Failed to check permission',
            permissionGranted: false 
          });
          return false;
        }
      },

      // Request READ_CONTACTS permission
      requestPermission: async () => {
        console.log('📇 Requesting contacts permission...');
        
        if (!contactsService.isAvailable()) {
          const errorMsg = 'Contacts feature is only available on mobile devices';
          console.log('📇', errorMsg);
          set({ error: errorMsg, permissionGranted: false });
          return false;
        }

        try {
          set({ isLoading: true, error: null });
          
          const granted = await contactsService.requestPermission();
          set({ permissionGranted: granted, isLoading: false });
          
          if (!granted) {
            set({ error: 'Contacts permission denied' });
          }
          
          return granted;
        } catch (error) {
          console.error('📇 Error requesting permission:', error);
          set({ 
            error: error instanceof Error ? error.message : 'Failed to request permission',
            permissionGranted: false,
            isLoading: false 
          });
          return false;
        }
      },

      // Sync contacts from device
      syncContacts: async () => {
        console.log('📇 Starting contact sync...');
        
        if (!contactsService.isAvailable()) {
          const errorMsg = 'Contacts feature is only available on mobile devices';
          console.log('📇', errorMsg);
          set({ error: errorMsg });
          return;
        }

        try {
          set({ isLoading: true, error: null });

          // Check permission first
          const hasPermission = await get().checkPermission();
          if (!hasPermission) {
            throw new Error('Contacts permission not granted');
          }

          // Sync contacts from device
          const contacts = await contactsService.syncContacts();
          
          // Update state
          const now = Date.now();
          set({ 
            contacts,
            lastSyncTime: now,
            isLoading: false 
          });

          console.log(`✅ Synced ${contacts.length} contacts`);
        } catch (error) {
          console.error('📇 Error syncing contacts:', error);
          set({ 
            error: error instanceof Error ? error.message : 'Failed to sync contacts',
            isLoading: false 
          });
          throw error;
        }
      },

      // Load contacts from SQLite (for offline access)
      loadFromSQLite: async () => {
        console.log('📇 Loading contacts from SQLite...');

        try {
          set({ isLoading: true, error: null });

          // Load contacts from SQLite
          const contacts = await sqliteService.getAllContacts();
          
          // Load registered users from SQLite
          const registeredUsers = await sqliteService.getRegisteredContacts();
          
          // Load last sync time
          const lastSyncTime = await sqliteService.getContactsLastSyncTime();

          // Update state
          set({ 
            contacts,
            registeredUsers,
            lastSyncTime,
            isLoading: false 
          });

          console.log(`✅ Loaded ${contacts.length} contacts, ${registeredUsers.length} registered users from SQLite`);
        } catch (error) {
          console.error('📇 Error loading contacts from SQLite:', error);
          set({ 
            error: error instanceof Error ? error.message : 'Failed to load contacts',
            isLoading: false 
          });
        }
      },

      // Discover which contacts are registered Confessr users
      discoverUsers: async () => {
        console.log('📇 Discovering registered users...');

        try {
          set({ isLoading: true, error: null });

          // Get current contacts
          const { contacts } = get();
          
          if (contacts.length === 0) {
            console.log('📇 No contacts to check');
            set({ isLoading: false });
            return;
          }

          // Discover registered users
          const registeredUsers = await contactsService.discoverRegisteredUsers(contacts);
          
          // Update state
          set({ 
            registeredUsers,
            isLoading: false 
          });

          console.log(`✅ Found ${registeredUsers.length} registered users`);
        } catch (error) {
          console.error('📇 Error discovering users:', error);
          set({ 
            error: error instanceof Error ? error.message : 'Failed to discover users',
            isLoading: false 
          });
          throw error;
        }
      },

      // Full sync: Sync contacts + discover users
      fullSync: async () => {
        console.log('📇 Starting full sync...');

        if (!contactsService.isAvailable()) {
          const errorMsg = 'Contacts feature is only available on mobile devices';
          console.log('📇', errorMsg);
          set({ error: errorMsg });
          return;
        }

        try {
          set({ isLoading: true, error: null });

          // Check permission first
          const hasPermission = await get().checkPermission();
          if (!hasPermission) {
            throw new Error('Contacts permission not granted');
          }

          // Full sync (contacts + user discovery)
          const registeredUsers = await contactsService.fullSync();
          
          // Load all contacts from SQLite
          const contacts = await sqliteService.getAllContacts();
          
          // Update state
          const now = Date.now();
          set({ 
            contacts,
            registeredUsers,
            lastSyncTime: now,
            isLoading: false 
          });

          console.log(`✅ Full sync complete: ${contacts.length} contacts, ${registeredUsers.length} registered users`);
        } catch (error) {
          console.error('📇 Error during full sync:', error);
          set({ 
            error: error instanceof Error ? error.message : 'Failed to sync contacts',
            isLoading: false 
          });
          throw error;
        }
      },

      // Search contacts by name or phone number
      searchContacts: (query: string) => {
        const { contacts } = get();
        
        if (!query || query.trim() === '') {
          return contacts;
        }

        const lowerQuery = query.toLowerCase().trim();
        
        return contacts.filter(contact => 
          contact.display_name.toLowerCase().includes(lowerQuery) ||
          contact.phone_number.includes(lowerQuery)
        );
      },

      // Clear all contact data
      clearContacts: async () => {
        console.log('📇 Clearing all contact data...');

        try {
          set({ isLoading: true, error: null });

          // Clear from SQLite
          await contactsService.clearAllContacts();
          
          // Clear state
          set({ 
            contacts: [],
            registeredUsers: [],
            lastSyncTime: null,
            isLoading: false 
          });

          console.log('✅ All contact data cleared');
        } catch (error) {
          console.error('📇 Error clearing contacts:', error);
          set({ 
            error: error instanceof Error ? error.message : 'Failed to clear contacts',
            isLoading: false 
          });
          throw error;
        }
      },

      // Initialize contacts store (load from SQLite + check permission)
      initialize: async () => {
        console.log('📇 Initializing contacts store...');

        try {
          set({ isLoading: true, isInitialized: false, error: null });

          // Check if contacts feature is available
          if (!contactsService.isAvailable()) {
            console.log('📇 Contacts not available on this platform');
            set({ 
              isLoading: false, 
              isInitialized: true,
              permissionGranted: false 
            });
            return;
          }

          // Check permission status
          await get().checkPermission();

          // Load contacts from SQLite (for offline access)
          await get().loadFromSQLite();

          console.log('✅ Contacts store initialized');
        } catch (error) {
          console.error('📇 Error initializing contacts store:', error);
          set({ 
            error: error instanceof Error ? error.message : 'Failed to initialize contacts',
          });
        } finally {
          set({ isLoading: false, isInitialized: true });
        }
      },
    }),
    {
      name: 'contacts-storage',
      partialize: (state) => ({
        // Only persist these fields
        permissionGranted: state.permissionGranted,
        lastSyncTime: state.lastSyncTime,
      }),
      onRehydrateStorage: () => (state) => {
        console.log('💧 Rehydrating contacts state...');
        if (state) {
          // Reset loading and initialization state on rehydration
          state.isLoading = false;
          state.isInitialized = false;
          state.error = null;
          // Don't persist contacts/registeredUsers - always load from SQLite
          state.contacts = [];
          state.registeredUsers = [];
          console.log('💧 Contacts state rehydrated');
        }
      },
    }
  )
);

