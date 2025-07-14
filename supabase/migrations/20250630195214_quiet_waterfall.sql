/*
  # Add INSERT policy for users table

  1. Security Changes
    - Add INSERT policy for `users` table to allow authenticated users to create their own profile
    - Policy ensures users can only insert records where the id matches their authenticated user ID (auth.uid())

  This resolves the RLS policy violation that occurs when new users try to create their profile after phone verification.
*/

-- Add INSERT policy for users table
CREATE POLICY "Users can insert their own profile"
  ON users
  FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = id);