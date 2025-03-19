-- Migration: add_title_to_messages
-- Created at: 2025-03-18T18:10:38.175Z

-- Up Migration
-- Add title column to messages table
ALTER TABLE IF EXISTS public.messages 
ADD COLUMN IF NOT EXISTS title TEXT;

-- Create an index for searching by title
CREATE INDEX IF NOT EXISTS idx_messages_title ON public.messages (title);

-- Down Migration (Optional)
-- Add SQL statements to revert the changes if needed (prefixed with -- for comments)
-- 
-- ALTER TABLE IF EXISTS public.messages DROP COLUMN IF EXISTS title;
-- DROP INDEX IF EXISTS idx_messages_title;

