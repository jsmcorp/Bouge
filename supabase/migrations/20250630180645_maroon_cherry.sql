/*
  # Create Confessr Database Schema

  1. New Tables
    - `users`
      - `id` (uuid, primary key)
      - `phone_number` (text, unique)
      - `display_name` (text)
      - `avatar_url` (text, nullable)
      - `is_onboarded` (boolean, default false)
      - `created_at` (timestamp)
    
    - `groups`
      - `id` (uuid, primary key)
      - `name` (text)
      - `description` (text, nullable)
      - `invite_code` (text, unique, 6 characters)
      - `created_by` (uuid, foreign key to users)
      - `created_at` (timestamp)
    
    - `group_members`
      - `group_id` (uuid, foreign key to groups)
      - `user_id` (uuid, foreign key to users)
      - `joined_at` (timestamp)
      - Primary key: (group_id, user_id)
    
    - `messages`
      - `id` (uuid, primary key)
      - `group_id` (uuid, foreign key to groups)
      - `user_id` (uuid, foreign key to users)
      - `content` (text)
      - `is_ghost` (boolean, default true)
      - `message_type` (text, default 'text')
      - `category` (text, nullable)
      - `parent_id` (uuid, foreign key to messages, nullable)
      - `image_url` (text, nullable)
      - `created_at` (timestamp)
    
    - `reactions`
      - `id` (uuid, primary key)
      - `message_id` (uuid, foreign key to messages)
      - `user_id` (uuid, foreign key to users)
      - `emoji` (text)
      - `created_at` (timestamp)
    
    - `polls`
      - `id` (uuid, primary key)
      - `message_id` (uuid, foreign key to messages)
      - `question` (text)
      - `options` (jsonb)
      - `created_at` (timestamp)
    
    - `poll_votes`
      - `poll_id` (uuid, foreign key to polls)
      - `user_id` (uuid, foreign key to users)
      - `option_index` (integer)
      - `created_at` (timestamp)
      - Primary key: (poll_id, user_id)

  2. Security
    - Enable RLS on all tables
    - Add policies for authenticated users to read/write their own data
    - Special policies for group-based access control
*/

-- Users table
CREATE TABLE IF NOT EXISTS users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  phone_number text UNIQUE NOT NULL,
  display_name text NOT NULL,
  avatar_url text,
  is_onboarded boolean DEFAULT false,
  created_at timestamptz DEFAULT now()
);

-- Groups table
CREATE TABLE IF NOT EXISTS groups (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  description text,
  invite_code text UNIQUE NOT NULL,
  created_by uuid NOT NULL REFERENCES users(id),
  created_at timestamptz DEFAULT now()
);

-- Group members table
CREATE TABLE IF NOT EXISTS group_members (
  group_id uuid NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  joined_at timestamptz DEFAULT now(),
  PRIMARY KEY (group_id, user_id)
);

-- Messages table
CREATE TABLE IF NOT EXISTS messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  group_id uuid NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  content text NOT NULL,
  is_ghost boolean DEFAULT true,
  message_type text DEFAULT 'text',
  category text,
  parent_id uuid REFERENCES messages(id),
  image_url text,
  created_at timestamptz DEFAULT now()
);

-- Reactions table
CREATE TABLE IF NOT EXISTS reactions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  message_id uuid NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  emoji text NOT NULL,
  created_at timestamptz DEFAULT now(),
  UNIQUE(message_id, user_id, emoji)
);

-- Polls table
CREATE TABLE IF NOT EXISTS polls (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  message_id uuid NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
  question text NOT NULL,
  options jsonb NOT NULL,
  created_at timestamptz DEFAULT now()
);

-- Poll votes table
CREATE TABLE IF NOT EXISTS poll_votes (
  poll_id uuid NOT NULL REFERENCES polls(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  option_index integer NOT NULL,
  created_at timestamptz DEFAULT now(),
  PRIMARY KEY (poll_id, user_id)
);

-- Enable RLS on all tables
ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE groups ENABLE ROW LEVEL SECURITY;
ALTER TABLE group_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE reactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE polls ENABLE ROW LEVEL SECURITY;
ALTER TABLE poll_votes ENABLE ROW LEVEL SECURITY;

-- Users policies
CREATE POLICY "Users can read their own profile"
  ON users FOR SELECT
  TO authenticated
  USING (auth.uid() = id);

CREATE POLICY "Users can update their own profile"
  ON users FOR UPDATE
  TO authenticated
  USING (auth.uid() = id);

-- Groups policies
CREATE POLICY "Users can read groups they are members of"
  ON groups FOR SELECT
  TO authenticated
  USING (
    id IN (
      SELECT group_id FROM group_members
      WHERE user_id = auth.uid()
    )
  );

CREATE POLICY "Users can create groups"
  ON groups FOR INSERT
  TO authenticated
  WITH CHECK (created_by = auth.uid());

-- Group members policies
CREATE POLICY "Users can read group members for groups they belong to"
  ON group_members FOR SELECT
  TO authenticated
  USING (
    group_id IN (
      SELECT group_id FROM group_members
      WHERE user_id = auth.uid()
    )
  );

CREATE POLICY "Users can join groups"
  ON group_members FOR INSERT
  TO authenticated
  WITH CHECK (user_id = auth.uid());

-- Messages policies
CREATE POLICY "Users can read messages from groups they belong to"
  ON messages FOR SELECT
  TO authenticated
  USING (
    group_id IN (
      SELECT group_id FROM group_members
      WHERE user_id = auth.uid()
    )
  );

CREATE POLICY "Users can create messages in groups they belong to"
  ON messages FOR INSERT
  TO authenticated
  WITH CHECK (
    user_id = auth.uid() AND
    group_id IN (
      SELECT group_id FROM group_members
      WHERE user_id = auth.uid()
    )
  );

-- Reactions policies
CREATE POLICY "Users can read reactions for messages they can see"
  ON reactions FOR SELECT
  TO authenticated
  USING (
    message_id IN (
      SELECT id FROM messages
      WHERE group_id IN (
        SELECT group_id FROM group_members
        WHERE user_id = auth.uid()
      )
    )
  );

CREATE POLICY "Users can create reactions for messages they can see"
  ON reactions FOR INSERT
  TO authenticated
  WITH CHECK (
    user_id = auth.uid() AND
    message_id IN (
      SELECT id FROM messages
      WHERE group_id IN (
        SELECT group_id FROM group_members
        WHERE user_id = auth.uid()
      )
    )
  );

-- Polls policies
CREATE POLICY "Users can read polls for messages they can see"
  ON polls FOR SELECT
  TO authenticated
  USING (
    message_id IN (
      SELECT id FROM messages
      WHERE group_id IN (
        SELECT group_id FROM group_members
        WHERE user_id = auth.uid()
      )
    )
  );

CREATE POLICY "Users can create polls for messages they can see"
  ON polls FOR INSERT
  TO authenticated
  WITH CHECK (
    message_id IN (
      SELECT id FROM messages
      WHERE group_id IN (
        SELECT group_id FROM group_members
        WHERE user_id = auth.uid()
      )
    )
  );

-- Poll votes policies
CREATE POLICY "Users can read poll votes for polls they can see"
  ON poll_votes FOR SELECT
  TO authenticated
  USING (
    poll_id IN (
      SELECT id FROM polls
      WHERE message_id IN (
        SELECT id FROM messages
        WHERE group_id IN (
          SELECT group_id FROM group_members
          WHERE user_id = auth.uid()
        )
      )
    )
  );

CREATE POLICY "Users can vote on polls they can see"
  ON poll_votes FOR INSERT
  TO authenticated
  WITH CHECK (
    user_id = auth.uid() AND
    poll_id IN (
      SELECT id FROM polls
      WHERE message_id IN (
        SELECT id FROM messages
        WHERE group_id IN (
          SELECT group_id FROM group_members
          WHERE user_id = auth.uid()
        )
      )
    )
  );

-- Create indexes for better performance
CREATE INDEX IF NOT EXISTS idx_group_members_user_id ON group_members(user_id);
CREATE INDEX IF NOT EXISTS idx_group_members_group_id ON group_members(group_id);
CREATE INDEX IF NOT EXISTS idx_messages_group_id ON messages(group_id);
CREATE INDEX IF NOT EXISTS idx_messages_created_at ON messages(created_at);
CREATE INDEX IF NOT EXISTS idx_messages_parent_id ON messages(parent_id);
CREATE INDEX IF NOT EXISTS idx_reactions_message_id ON reactions(message_id);
CREATE INDEX IF NOT EXISTS idx_polls_message_id ON polls(message_id);
CREATE INDEX IF NOT EXISTS idx_poll_votes_poll_id ON poll_votes(poll_id);

-- Function to generate invite codes
CREATE OR REPLACE FUNCTION generate_invite_code()
RETURNS text AS $$
BEGIN
  RETURN upper(substring(md5(random()::text) from 1 for 6));
END;
$$ LANGUAGE plpgsql;