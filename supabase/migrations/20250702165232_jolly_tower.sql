/*
  # Add Poll Expiration Feature

  1. Schema Changes
    - Add `closes_at` column to polls table for 24-hour expiration
    - Update existing polls to have a closes_at timestamp

  2. Security
    - Maintain existing RLS policies
    - No changes needed to poll_votes table
*/

-- Add closes_at column to polls table
ALTER TABLE polls ADD COLUMN IF NOT EXISTS closes_at timestamptz DEFAULT (now() + interval '24 hours');

-- Update existing polls to have closes_at timestamp (24 hours from creation)
UPDATE polls 
SET closes_at = created_at + interval '24 hours' 
WHERE closes_at IS NULL;

-- Make closes_at NOT NULL for future polls
ALTER TABLE polls ALTER COLUMN closes_at SET NOT NULL;