/*
  # Fix storage policies and RLS for chat-media bucket

  1. Storage Setup
    - Create chat-media bucket if it doesn't exist
    - Set bucket to public for file access
    - Create RLS policies for file operations

  2. Security
    - Authenticated users can upload files to chat-media bucket
    - Authenticated users can view files in chat-media bucket
    - Users can only update/delete their own files (organized by user folder)

  Note: We avoid dropping the private.is_group_member function since other policies depend on it.
  The function already exists and works correctly from previous migrations.
*/

-- Storage policies for chat-media bucket
INSERT INTO storage.buckets (id, name, public) 
VALUES ('chat-media', 'chat-media', true)
ON CONFLICT (id) DO NOTHING;

-- Enable RLS on the chat-media bucket
UPDATE storage.buckets 
SET public = true 
WHERE id = 'chat-media';

-- Drop existing storage policies if they exist
DROP POLICY IF EXISTS "Authenticated users can upload files" ON storage.objects;
DROP POLICY IF EXISTS "Authenticated users can view files" ON storage.objects;
DROP POLICY IF EXISTS "Authenticated users can update their files" ON storage.objects;
DROP POLICY IF EXISTS "Authenticated users can delete their files" ON storage.objects;

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