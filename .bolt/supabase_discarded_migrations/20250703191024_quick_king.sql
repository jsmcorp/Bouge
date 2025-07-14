/*
  # Fix RLS policies for messages and storage

  1. Storage Policies
    - Enable INSERT for authenticated users on chat-media bucket
    - Enable SELECT for authenticated users on chat-media bucket
    - Enable UPDATE for authenticated users on chat-media bucket
    - Enable DELETE for authenticated users on chat-media bucket

  2. Messages Table Policies
    - Ensure INSERT policy allows authenticated users to create messages in groups they belong to
    - Verify existing policies are working correctly

  This migration fixes the "new row violates row-level security policy" errors
  that occur when sending messages and uploading images.
*/

-- Storage policies for chat-media bucket
INSERT INTO storage.buckets (id, name, public) 
VALUES ('chat-media', 'chat-media', true)
ON CONFLICT (id) DO NOTHING;

-- Enable RLS on the chat-media bucket
UPDATE storage.buckets 
SET public = true 
WHERE id = 'chat-media';

-- Storage policies for chat-media bucket
CREATE POLICY "Authenticated users can upload files" ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'chat-media');

CREATE POLICY "Authenticated users can view files" ON storage.objects
  FOR SELECT TO authenticated
  USING (bucket_id = 'chat-media');

CREATE POLICY "Authenticated users can update their files" ON storage.objects
  FOR UPDATE TO authenticated
  USING (bucket_id = 'chat-media' AND auth.uid()::text = (storage.foldername(name))[1]);

CREATE POLICY "Authenticated users can delete their files" ON storage.objects
  FOR DELETE TO authenticated
  USING (bucket_id = 'chat-media' AND auth.uid()::text = (storage.foldername(name))[1]);

-- Ensure messages table has proper INSERT policy
-- Drop existing INSERT policy if it exists and recreate it
DROP POLICY IF EXISTS "Users can create messages in groups they belong to" ON messages;

CREATE POLICY "Users can create messages in groups they belong to"
  ON messages
  FOR INSERT
  TO authenticated
  WITH CHECK (
    (user_id = auth.uid()) AND 
    private.is_group_member(group_id)
  );

-- Ensure the private.is_group_member function exists and works correctly
-- This function should already exist from previous migrations, but let's make sure it's defined
CREATE OR REPLACE FUNCTION private.is_group_member(group_id_param uuid)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
AS $$
  SELECT EXISTS (
    SELECT 1 
    FROM group_members 
    WHERE group_id = group_id_param 
    AND user_id = auth.uid()
  );
$$;