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
          // Check if user is logged in via custom JWT (Truecaller)
          const customToken = localStorage.getItem('truecaller_token');

          if (customToken) {
            console.log('🔐 Using custom JWT for profile update');

            // Call backend endpoint with custom JWT
            const response = await fetch(
              `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/update-user-profile`,
              {
                method: 'POST',
                headers: {
                  'Content-Type': 'application/json',
                  'apikey': import.meta.env.VITE_SUPABASE_ANON_KEY,
                  'Authorization': `Bearer ${import.meta.env.VITE_SUPABASE_ANON_KEY}`,
                },
                body: JSON.stringify({
                  token: customToken,
                  updates
                })
              }
            );

            if (!response.ok) {
              const errorData = await response.json();
              throw new Error(errorData.error || 'Failed to update profile');
            }

            const data = await response.json();
            console.log('✅ User profile updated successfully via custom JWT');
            set({ user: data.user });
          } else {
            // Use Supabase Auth for regular users
            console.log('🔑 Using Supabase Auth for profile update');
            const { data, error } = await supabasePipeline.updateUser(user.id, updates);

            if (error) {
              console.error('❌ User update error:', error);
              throw error;
            }

            console.log('✅ User profile updated successfully');
            set({ user: data });
          }
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

          // Check for Truecaller custom JWT first
          const truecallerToken = localStorage.getItem('truecaller_token');
          const truecallerUserStr = localStorage.getItem('truecaller_user');

          if (truecallerToken && truecallerUserStr) {
            console.log('🔐 Truecaller custom JWT found - using custom auth');
            try {
              const truecallerUser = JSON.parse(truecallerUserStr);
              console.log('👤 Truecaller user loaded:', truecallerUser.id);
              set({ user: truecallerUser, session: null });
              return;
            } catch (error) {
              console.error('❌ Error parsing Truecaller user:', error);
              // Clear invalid data
              localStorage.removeItem('truecaller_token');
              localStorage.removeItem('truecaller_user');
            }
          }

          // Fallback to Supabase Auth session
          console.log('🔑 Checking Supabase Auth session...');
          const { data: { session }, error: sessionError } = await supabasePipeline.getSession();

          if (sessionError) {
            console.error('❌ Session fetch error:', sessionError);
            set({ user: null, session: null });
            return;
          }

          if (session?.user) {
            console.log('👤 Active Supabase session found for user:', session.user.id);
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