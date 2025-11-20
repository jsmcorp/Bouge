# Contacts Sync Fix - "0 Contacts Synced" Issue

## Problem
When users tried to add members or create groups, the contact picker showed "0 contacts synced" even after clicking the manual "Sync" button.

## Root Cause
The contact sync flow was broken into two separate operations that were not being called together:

1. **`syncContacts()`** - Fetches contacts FROM DEVICE → saves to SQLite
2. **`discoverInBackgroundV3()`** - Matches SQLite contacts → finds registered users via RPC

The "Sync" button was ONLY calling `discoverInBackgroundV3()`, which expects contacts to already be in SQLite. If SQLite was empty, it would immediately return with 0 results without fetching from the device.

### The Broken Flow:
```typescript
// OLD CODE - Only discovery, no device sync
const handleSync = async () => {
  await discoverInBackgroundV3();  // ❌ Expects contacts already in SQLite
};
```

When `discoverInBackgroundV3()` ran:
```typescript
const contacts = await sqliteService.getAllContacts();

if (contacts.length === 0) {
  console.warn('⚠️ [V3] No contacts in SQLite - did you forget to call syncContacts() first?');
  return [];  // ❌ Returns empty immediately!
}
```

## Solution
Updated the sync flow to call BOTH operations in sequence:

### 1. Fixed ContactPicker Sync Button
**File:** `src/components/contacts/ContactPicker.tsx`

```typescript
// NEW CODE - Complete sync flow
const handleSync = async () => {
  setIsSyncing(true);
  try {
    console.log('📇 [ContactPicker] Starting full sync...');
    
    // Step 1: Sync contacts from device to SQLite
    console.log('📇 [ContactPicker] Step 1: Syncing contacts from device...');
    await syncContacts();
    console.log('📇 [ContactPicker] ✅ Device contacts synced');
    
    // Step 2: Discover which contacts are registered users
    console.log('📇 [ContactPicker] Step 2: Discovering registered users...');
    await discoverInBackgroundV3();
    console.log('📇 [ContactPicker] ✅ Discovery complete');
  } catch (error) {
    console.error('📇 [ContactPicker] ❌ Failed to sync contacts:', error);
  } finally {
    setIsSyncing(false);
  }
};
```

### 2. Added Background Sync on App Startup
**File:** `src/App.tsx`

Added automatic background sync if permission is granted but no contacts are in SQLite:

```typescript
await initializeContacts();

// If permission is granted but no contacts in SQLite, trigger initial sync
const contactsState = useContactsStore.getState();
if (contactsState.permissionGranted && contactsState.contacts.length === 0) {
  console.log('📇 Permission granted but no contacts found, triggering initial sync...');
  // Run in background without blocking app startup
  contactsState.syncContacts()
    .then(() => contactsState.discoverInBackgroundV3())
    .then(() => console.log('✅ Background contact sync complete'))
    .catch(err => console.warn('⚠️ Background contact sync failed:', err));
}
```

## Changes Made

### 1. `src/components/contacts/ContactPicker.tsx`
- Added `syncContacts` to the destructured hooks from `useContactsStore`
- Updated `handleSync()` to call both `syncContacts()` and `discoverInBackgroundV3()` in sequence
- Added detailed logging for debugging

### 2. `src/App.tsx`
- Added automatic background sync on app startup if permission is granted but SQLite is empty
- Runs in background without blocking app initialization

## Testing
1. **Fresh Install**: Grant contacts permission → contacts should sync automatically in background
2. **Manual Sync**: Click "Sync" button → should fetch from device then discover registered users
3. **Add Members**: Open contact picker → should show synced contacts with registered users highlighted

## Expected Behavior
- When user clicks "Sync", they should see:
  1. Contacts being fetched from device
  2. Discovery RPC call matching contacts with registered users
  3. UI updating with total contacts and registered users count
  
- Console logs should show:
  ```
  📇 [ContactPicker] Starting full sync...
  📇 [ContactPicker] Step 1: Syncing contacts from device...
  📇 Fetched X contacts from device in Yms
  📇 [ContactPicker] ✅ Device contacts synced
  📇 [ContactPicker] Step 2: Discovering registered users...
  📇 [V3] Loaded X contacts from SQLite
  📇 [V3] RPC completed in Yms, found Z matches
  📇 [ContactPicker] ✅ Discovery complete
  ```

## Related Files
- `src/store/contactsStore.ts` - Contact store with sync methods
- `src/lib/contactsService.ts` - Contact service with device sync and discovery
- `src/lib/contactMatchingService.ts` - RPC calls for user discovery
- `src/lib/sqliteServices_Refactored/contactOperations.ts` - SQLite operations

## Notes
- The two operations must run in sequence: device sync THEN discovery
- Discovery expects contacts to already be in SQLite
- The RPC call `discover_contacts_v3` is working correctly - it was just never being called with data
