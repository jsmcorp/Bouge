```diff
--- a/supabase/migrations/20250702183718_shy_voice.sql
+++ b/supabase/migrations/20250702183718_shy_voice.sql
@@ -1,5 +1,5 @@
 /*
-  # Fix infinite recursion in group_members RLS policies
+  # Fix infinite recursion in group_members RLS policies and add pseudonym service
 
   1. Security Changes
     - Create private schema and is_group_member function
@@ -7,6 +7,9 @@
     - Create new, safe policies for group_members table
     - Update other table policies to use the helper function safely
 
+  2. Pseudonym Service
+    - Add `pseudonyms` table for storing user-group specific pseudonyms
+    - Add `upsert_pseudonym` RPC function to generate/retrieve pseudonyms with 24-hour refresh
   2. Changes Made
     - Add private.is_group_member function for safe group membership checks
     - Replace recursive policies with direct user_id checks on group_members
@@ -109,3 +112,100 @@
       AND private.is_group_member(group_id)
   );
```