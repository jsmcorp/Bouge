
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
      console.log(`📇 [MATCHING] Uploading ${contacts.length} contacts with names to Supabase...`);
      console.log(`📇 [MATCHING] Sample contacts:`, contacts.slice(0, 3));

      // Call the sync_contacts function which:
      // 1. Deletes old contacts for this user
      // 2. Inserts new contacts with names and phone numbers
      // 3. Returns registered users who match
      const { data, error } = await client.rpc('sync_contacts', {
        p_user_id: user.id,
        p_contacts: contacts
      });

      if (error) {
        console.error('❌ [MATCHING] Error syncing contacts:', error);
        console.error('❌ [MATCHING] Error details:', {
          message: error.message,
          details: error.details,
          hint: error.hint,
          code: error.code
        });
        throw error;
      }

      const registeredUsers = data || [];
      console.log(`✅ [MATCHING] Contacts uploaded successfully to Supabase!`);
      console.log(`✅ [MATCHING] Found ${registeredUsers.length} registered users`);

      // Log matched users
      if (registeredUsers.length > 0) {
        console.log('📋 [MATCHING] Matched users:');
        registeredUsers.forEach((user: any, index: number) => {
          console.log(`  ${index + 1}. ${user.display_name} (${user.phone_number}) - Contact: ${user.contact_name}`);
        });
      } else {
        console.log('⚠️ [MATCHING] No registered users found in your contacts');
      }

      // Verify upload by checking user_contacts table
      console.log('📇 [MATCHING] Verifying upload...');
      const { count, error: countError } = await client
        .from('user_contacts')
        .select('*', { count: 'exact', head: true })
        .eq('user_id', user.id);

      if (!countError) {
        console.log(`✅ [MATCHING] Verified: ${count} contacts stored in Supabase user_contacts table`);
      }

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
   * ✅ PRODUCTION: WhatsApp-like contact discovery with names
   * Improvements over V2:
   * - Preserves original contact names
   * - Efficient MERGE (no full delete churn)
   * - Returns contact names with matches
   *
   * @param contacts - Array of {phone: string, name: string}
   * @returns Array of matched users with contact names
   */
  public async discoverContactsV3(contacts: Array<{phone: string, name: string}>): Promise<any[]> {
    console.log(`📇 [V3] Starting optimized discovery for ${contacts.length} contacts...`);

    if (contacts.length === 0) {
      console.log('📇 [V3] No contacts to discover');
      return [];
    }

    // Validate max limit
    if (contacts.length > 5000) {
      throw new Error(`Too many contacts (max 5000, got ${contacts.length})`);
    }

    try {
      const startTime = performance.now();

      console.log('📇 [V3] Calling discover_contacts_v3 RPC...');
      console.log(`📇 [V3] Sample contacts:`, contacts.slice(0, 3));

      // Prefer direct REST RPC during first-time setup to avoid SDK hydration delays
      const preferDirect = localStorage.getItem('setup_complete') !== 'true';
      let rpcResult: { data: any[] | null; error: any };
      if (preferDirect) {
        console.log('📇 [V3] Using primary-direct REST RPC for first-flow discovery...');
        rpcResult = await supabasePipeline.rpcDirect<any[]>('discover_contacts_v3', { p_contacts: contacts });
        if (rpcResult.error) {
          console.warn('⚠️ [V3] Direct RPC failed, falling back to SDK rpc...', rpcResult.error);
          rpcResult = await supabasePipeline.rpc<any[]>('discover_contacts_v3', { p_contacts: contacts });
        }
      } else {
        rpcResult = await supabasePipeline.rpc<any[]>('discover_contacts_v3', { p_contacts: contacts });
      }
      const { data, error } = rpcResult;

      if (error) {
        console.error('❌ [V3] RPC error:', error);
        throw error;
      }

      const endTime = performance.now();
      const duration = Math.round(endTime - startTime);

      const matches = data || [];
      console.log(`✅ [V3] Discovery complete in ${duration}ms`);
      console.log(`✅ [V3] Found ${matches.length} registered users`);

      if (matches.length > 0) {
        console.log('📋 [V3] Sample matches:', matches.slice(0, 3));
      }

      return matches;
    } catch (error) {
      console.error('📇 [V3] Error in discoverContactsV3:', error);
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

