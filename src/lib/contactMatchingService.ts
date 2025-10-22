import { supabasePipeline } from './supabasePipeline';

/**
 * Contact Matching Service
 * Simple server-side contact matching using real phone numbers
 * No hashing - direct phone number matching
 */
class ContactMatchingService {
  private static instance: ContactMatchingService;

  private constructor() {}

  public static getInstance(): ContactMatchingService {
    if (!ContactMatchingService.instance) {
      ContactMatchingService.instance = new ContactMatchingService();
    }
    return ContactMatchingService.instance;
  }

  /**
   * Sync contacts and get registered users
   * Uploads contacts with names and phone numbers, returns matched users
   *
   * @param contacts - Array of {name: string, phone: string}
   * @returns Array of registered users
   */
  public async syncContacts(contacts: Array<{name: string, phone: string}>): Promise<any[]> {
    console.log(`📇 [MATCHING] Syncing ${contacts.length} contacts...`);

    if (contacts.length === 0) {
      console.log('📇 [MATCHING] No contacts to sync');
      return [];
    }

    try {
      // Get current user
      const client = await supabasePipeline.getDirectClient();
      const { data: { user } } = await client.auth.getUser();
      if (!user) {
        throw new Error('User not authenticated');
      }

      console.log('📇 [MATCHING] Calling sync_contacts RPC function...');

      // Call the sync_contacts function which:
      // 1. Deletes old contacts
      // 2. Inserts new contacts
      // 3. Returns registered users
      const { data, error } = await client.rpc('sync_contacts', {
        p_user_id: user.id,
        p_contacts: contacts
      });

      if (error) {
        console.error('📇 [MATCHING] Error syncing contacts:', error);
        throw error;
      }

      const registeredUsers = data || [];
      console.log(`✅ [MATCHING] Found ${registeredUsers.length} registered users`);

      return registeredUsers;
    } catch (error) {
      console.error('📇 [MATCHING] Error in syncContacts:', error);
      throw error;
    }
  }

  /**
   * Get registered contacts (without uploading)
   * Returns users who are in the current user's contact list
   */
  public async getRegisteredContacts(): Promise<any[]> {
    console.log('📇 [MATCHING] Fetching registered contacts from server...');

    try {
      const client = await supabasePipeline.getDirectClient();
      const { data: { user } } = await client.auth.getUser();
      if (!user) {
        throw new Error('User not authenticated');
      }

      const { data, error } = await client.rpc('get_registered_contacts', {
        p_user_id: user.id
      });

      if (error) {
        console.error('📇 [MATCHING] Error fetching registered contacts:', error);
        throw error;
      }

      console.log(`✅ [MATCHING] Found ${data?.length || 0} registered contacts`);

      return data || [];
    } catch (error) {
      console.error('📇 [MATCHING] Error in getRegisteredContacts:', error);
      throw error;
    }
  }

  /**
   * Clear all uploaded contacts for current user
   * Useful for testing or when user wants to re-sync
   */
  public async clearUploadedContacts(): Promise<void> {
    console.log('📇 [MATCHING] Clearing uploaded contacts...');

    try {
      const client = await supabasePipeline.getDirectClient();
      const { data: { user } } = await client.auth.getUser();
      if (!user) {
        throw new Error('User not authenticated');
      }

      const { error } = await client
        .from('user_contacts')
        .delete()
        .eq('user_id', user.id);

      if (error) {
        console.error('📇 [MATCHING] Error clearing contacts:', error);
        throw error;
      }

      console.log('✅ [MATCHING] Cleared all uploaded contacts');
    } catch (error) {
      console.error('📇 [MATCHING] Error in clearUploadedContacts:', error);
      throw error;
    }
  }
}

export const contactMatchingService = ContactMatchingService.getInstance();

