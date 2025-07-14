@@ .. @@
 -- Enable RLS on all tables
 ALTER TABLE users ENABLE ROW LEVEL SECURITY;
 ALTER TABLE groups ENABLE ROW LEVEL SECURITY;
 ALTER TABLE group_members ENABLE ROW LEVEL SECURITY;
 ALTER TABLE messages ENABLE ROW LEVEL SECURITY;
 ALTER TABLE reactions ENABLE ROW LEVEL SECURITY;
 ALTER TABLE polls ENABLE ROW LEVEL SECURITY;
 ALTER TABLE poll_votes ENABLE ROW LEVEL SECURITY;
+ALTER TABLE user_pseudonyms ENABLE ROW LEVEL SECURITY;
+
+-- Create pseudonyms table for 24-hour rotating pseudonyms
+CREATE TABLE IF NOT EXISTS pseudonyms (
+  group_id uuid NOT NULL,
+  user_id uuid NOT NULL,
+  pseudonym text NOT NULL,
+  created_at timestamptz DEFAULT now(),
+  PRIMARY KEY (group_id, user_id)
+);
+
+-- Enable RLS on pseudonyms table
+ALTER TABLE pseudonyms ENABLE ROW LEVEL SECURITY;
 
 -- Users policies
 CREATE POLICY "Users can read their own profile"
@@ .. @@
 CREATE POLICY "Users can read pseudonyms for groups they belong to"
   ON user_pseudonyms
   FOR SELECT
   TO authenticated
   USING (
     user_id = auth.uid() OR 
     EXISTS (
       SELECT 1 FROM group_members gm 
       WHERE gm.group_id = user_pseudonyms.group_id 
       AND gm.user_id = auth.uid()
     )
   );
+
+-- Pseudonyms policies
+CREATE POLICY "Users can read pseudonyms for groups they belong to"
+  ON pseudonyms
+  FOR SELECT
+  TO authenticated
+  USING (
+    user_id = auth.uid() OR 
+    EXISTS (
+      SELECT 1 FROM group_members gm 
+      WHERE gm.group_id = pseudonyms.group_id 
+      AND gm.user_id = auth.uid()
+    )
+  );
+
+CREATE POLICY "Users can insert their own pseudonyms"
+  ON pseudonyms
+  FOR INSERT
+  TO authenticated
+  WITH CHECK (user_id = auth.uid());
+
+CREATE POLICY "Users can update their own pseudonyms"
+  ON pseudonyms
+  FOR UPDATE
+  TO authenticated
+  USING (user_id = auth.uid())
+  WITH CHECK (user_id = auth.uid());
+
+-- Create upsert_pseudonym RPC function with 24-hour refresh logic
+CREATE OR REPLACE FUNCTION upsert_pseudonym(q_group_id uuid, q_user_id uuid)
+RETURNS text
+LANGUAGE plpgsql
+SECURITY DEFINER
+AS $$
+DECLARE
+  existing_pseudonym text;
+  existing_created_at timestamptz;
+  new_pseudonym text;
+  adjectives text[] := ARRAY[
+    'Swift', 'Silent', 'Mystic', 'Brave', 'Clever', 'Gentle', 'Fierce', 'Wise',
+    'Bold', 'Quick', 'Calm', 'Sharp', 'Bright', 'Dark', 'Light', 'Wild',
+    'Free', 'Pure', 'Strong', 'Soft', 'Fast', 'Slow', 'Deep', 'High',
+    'Ancient', 'Modern', 'Hidden', 'Open', 'Secret', 'Clear', 'Misty', 'Sunny',
+    'Stormy', 'Peaceful', 'Restless', 'Steady', 'Wandering', 'Still', 'Moving', 'Dancing'
+  ];
+  nouns text[] := ARRAY[
+    'Wolf', 'Eagle', 'Tiger', 'Bear', 'Fox', 'Owl', 'Hawk', 'Lion',
+    'Deer', 'Rabbit', 'Cat', 'Dog', 'Horse', 'Dragon', 'Phoenix', 'Raven',
+    'Falcon', 'Panther', 'Leopard', 'Jaguar', 'Lynx', 'Puma', 'Cheetah', 'Cougar',
+    'Shadow', 'Flame', 'Storm', 'Wind', 'Rain', 'Snow', 'Ice', 'Fire',
+    'Star', 'Moon', 'Sun', 'Sky', 'Ocean', 'River', 'Mountain', 'Forest',
+    'Valley', 'Desert', 'Island', 'Cave', 'Bridge', 'Tower', 'Castle', 'Garden'
+  ];
+  adj_index int;
+  noun_index int;
+BEGIN
+  -- Check if pseudonym exists and get its creation time
+  SELECT pseudonym, created_at 
+  INTO existing_pseudonym, existing_created_at
+  FROM pseudonyms 
+  WHERE group_id = q_group_id AND user_id = q_user_id;
+  
+  -- If pseudonym exists and is less than 24 hours old, return it
+  IF existing_pseudonym IS NOT NULL AND existing_created_at > (now() - interval '24 hours') THEN
+    RETURN existing_pseudonym;
+  END IF;
+  
+  -- Generate new pseudonym
+  adj_index := floor(random() * array_length(adjectives, 1)) + 1;
+  noun_index := floor(random() * array_length(nouns, 1)) + 1;
+  new_pseudonym := adjectives[adj_index] || ' ' || nouns[noun_index];
+  
+  -- Insert or update pseudonym
+  INSERT INTO pseudonyms (group_id, user_id, pseudonym, created_at)
+  VALUES (q_group_id, q_user_id, new_pseudonym, now())
+  ON CONFLICT (group_id, user_id)
+  DO UPDATE SET 
+    pseudonym = EXCLUDED.pseudonym,
+    created_at = EXCLUDED.created_at;
+  
+  RETURN new_pseudonym;
+END;
+$$;