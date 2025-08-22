import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { supabasePipeline } from '@/lib/supabasePipeline';
import { Capacitor } from '@capacitor/core';

export interface User {
  id: string;
  phone_number: string;
  display_name: string;
  avatar_url: string | null;
  is_onboarded: boolean;
  created_at: string;
}

interface AuthState {
  user: User | null;
  isLoading: boolean;
  session: any;
  isInitialized: boolean;
  setUser: (user: User | null) => void;
  setSession: (session: any) => void;
  setLoading: (loading: boolean) => void;
  setInitialized: (initialized: boolean) => void;
  logout: () => Promise<void>;
  updateUser: (updates: Partial<User>) => Promise<void>;
  initializeAuth: () => Promise<void>;
  syncUserProfile: (sessionUser: any) => Promise<void>;
  clearPersistedState: () => void;
}

// Global auth listener to prevent multiple listeners
let globalAuthListener: any = null;

export const useAuthStore = create<AuthState>()(
  persist(
    (set, get) => ({
      user: null,
      session: null,
      isLoading: true,
      isInitialized: false,
      
      setUser: (user) => {
        console.log('📝 Setting user:', user?.id || 'null');
        set({ user });
      },
      
      setSession: (session) => {
        console.log('📝 Setting session:', session?.user?.id || 'null');
        set({ session });
      },
      
      setLoading: (loading) => {
        console.log('⏳ Setting loading:', loading);
        set({ isLoading: loading });
      },
      
      setInitialized: (initialized) => {
        console.log('🎯 Setting initialized:', initialized);
        set({ isInitialized: initialized });
      },
      
      clearPersistedState: () => {
        console.log('🧹 Clearing persisted state');
        set({ user: null, session: null, isLoading: true, isInitialized: false });
      },
      
      logout: async () => {
        console.log('🚪 Starting logout process...');
        try {
          set({ isLoading: true });
          
          // Sign out from Supabase via pipeline
          const { error } = await supabasePipeline.signOut();
          if (error) {
            console.error('❌ Logout error:', error);
          }
          try {
            // Best-effort deactivate device tokens on logout
            const isNative = Capacitor.isNativePlatform();
            if (isNative) {
              const { FirebaseMessaging } = await import(/* @vite-ignore */ '@capacitor-firebase/messaging');
              const tokenRes = await FirebaseMessaging.getToken();
              const token = tokenRes?.token;
              if (token) {
                await supabasePipeline.deactivateDeviceToken(token);
              }
            }
          } catch {}
          
          // Clear all state
          set({ 
            user: null, 
            session: null, 
            isLoading: false, 
            isInitialized: true 
          });
          
          console.log('✅ Logout successful');
        } catch (error) {
          console.error('💥 Logout error:', error);
          set({ isLoading: false });
        }
      },
      
      updateUser: async (updates) => {
        const { user } = get();
        if (!user) {
          console.warn('⚠️ Cannot update user: no user found');
          return;
        }

        console.log('📝 Updating user profile:', updates);
        
        try {
          const { data, error } = await supabasePipeline.updateUser(user.id, updates);

          if (error) {
            console.error('❌ User update error:', error);
            throw error;
          }
          
          console.log('✅ User profile updated successfully');
          set({ user: data });
        } catch (error) {
          console.error('💥 Update user error:', error);
          throw error;
        }
      },

      syncUserProfile: async (sessionUser) => {
        console.log('🔄 Syncing user profile for:', sessionUser.id);
        
        try {
          // First check if user exists in our database via pipeline
          const client = await supabasePipeline.getDirectClient();
          const { data: userData, error: fetchError } = await client
            .from('users')
            .select('*')
            .eq('id', sessionUser.id)
            .maybeSingle();

          if (fetchError && fetchError.code !== 'PGRST116') {
            console.error('❌ Error fetching user profile:', fetchError);
            throw fetchError;
          }

          if (userData) {
            // User exists, update our state
            console.log('✅ User profile found and loaded');
            set({ user: userData });
          } else {
            // User doesn't exist, create new profile
            console.log('🆕 Creating new user profile...');
            
            const newUserData = {
              id: sessionUser.id,
              phone_number: sessionUser.phone || sessionUser.user_metadata?.phone || '',
              display_name: sessionUser.user_metadata?.display_name || 'New User',
              avatar_url: sessionUser.user_metadata?.avatar_url || null,
              is_onboarded: false,
            };

            const { data: newUser, error: createError } = await client
              .from('users')
              .insert(newUserData)
              .select()
              .single();

            if (createError) {
              console.error('❌ Error creating user profile:', createError);
              throw createError;
            }

            console.log('✅ New user profile created successfully');
            set({ user: newUser });
          }
        } catch (error) {
          console.error('💥 User profile sync failed:', error);
          // Don't set user to null here, let the session remain valid
        }
      },

      initializeAuth: async () => {
        console.log('🔍 Initializing authentication...');
        
        try {
          // Explicitly set loading state at the beginning
          set({ isLoading: true, isInitialized: false });
          
          // Get current session via pipeline
          const { data: { session }, error: sessionError } = await supabasePipeline.getSession();
          
          if (sessionError) {
            console.error('❌ Session fetch error:', sessionError);
            set({ user: null, session: null });
            return;
          }

          if (session?.user) {
            console.log('👤 Active session found for user:', session.user.id);
            set({ session });
            
            // Sync user profile
            await get().syncUserProfile(session.user);
          } else {
            console.log('🚫 No active session found');
            set({ user: null, session: null });
          }
          
        } catch (error) {
          console.error('💥 Auth initialization error:', error);
          set({ user: null, session: null });
        } finally {
          // This is the ONLY place where isLoading and isInitialized are set after initialization
          console.log('🏁 Auth initialization complete');
          set({ isLoading: false, isInitialized: true });
        }
      },
    }),
    {
      name: 'auth-storage',
      partialize: (state) => ({ 
        user: state.user,
      }),
      onRehydrateStorage: () => (state) => {
        console.log('💧 Rehydrating auth state...');
        if (state) {
          // Reset loading and initialization state on rehydration
          state.isLoading = true;
          state.isInitialized = false;
          state.session = null;
          console.log('💧 Auth state rehydrated with user:', state.user?.id || 'null');
        }
      },
    }
  )
);

// Singleton auth listener to prevent multiple listeners
export const initializeAuthListener = async () => {
  if (globalAuthListener) {
    console.log('⚠️ Auth listener already exists, returning existing cleanup');
    return () => {
      if (globalAuthListener) {
        console.log('🧹 Cleaning up auth listener...');
        globalAuthListener.unsubscribe();
        globalAuthListener = null;
      }
    };
  }

  console.log('🎧 Setting up auth state listener...');
  
  const authListener = await supabasePipeline.onAuthStateChange(
    async (event, session) => {
      console.log('🔄 Auth state changed:', event, session?.user?.id || 'no-user');
      
      const store = useAuthStore.getState();
      
      switch (event) {
        case 'SIGNED_IN':
          // Only handle SIGNED_IN if auth is already initialized
          // This prevents conflicts during initial auth setup
          if (store.isInitialized && session?.user) {
            console.log('✅ User signed in (post-init), syncing profile...');
            store.setSession(session);
            await store.syncUserProfile(session.user);
          } else {
            console.log('🔄 User signed in (during init), letting initializeAuth handle it');
          }
          break;
          
        case 'SIGNED_OUT':
          console.log('🚪 User signed out');
          store.setUser(null);
          store.setSession(null);
          break;
          
        case 'TOKEN_REFRESHED':
          console.log('🔄 Token refreshed');
          if (session?.user) {
            store.setSession(session);
          }
          break;
          
        case 'INITIAL_SESSION':
          console.log('📡 Auth event:', event);
          // Don't duplicate the work already done in initializeAuth
          // Just log it for debugging
          break;
          
        default:
          console.log('📡 Auth event:', event);
      }
    }
  );
  
  globalAuthListener = authListener.data.subscription;

  // Return cleanup function
  return () => {
    if (globalAuthListener) {
      console.log('🧹 Cleaning up auth listener...');
      globalAuthListener.unsubscribe();
      globalAuthListener = null;
    }
  };
};