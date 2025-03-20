-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Create updated_at function for triggers
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Chats Table
CREATE TABLE IF NOT EXISTS chats (
    -- ID
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    
    -- RELATIONSHIPS
    user_id UUID NOT NULL,
    
    -- METADATA
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ,
    
    -- REQUIRED
    name TEXT NOT NULL CHECK (char_length(name) <= 500)
);

-- Create indexes for chats
CREATE INDEX IF NOT EXISTS idx_chats_user_id ON chats (user_id);

-- Messages Table
CREATE TABLE IF NOT EXISTS messages (
    -- ID
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    
    -- RELATIONSHIPS
    chat_id UUID NOT NULL REFERENCES chats(id) ON DELETE CASCADE,
    user_id UUID NOT NULL,
    
    -- METADATA
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ,
    
    -- REQUIRED
    content TEXT NOT NULL CHECK (char_length(content) <= 100000),
    role TEXT NOT NULL CHECK (char_length(role) <= 100),
    sequence_number INT NOT NULL
);

-- Create indexes for messages
CREATE INDEX IF NOT EXISTS idx_messages_chat_id ON messages (chat_id);
CREATE INDEX IF NOT EXISTS idx_messages_user_id ON messages (user_id);
CREATE INDEX IF NOT EXISTS idx_messages_sequence_number ON messages (sequence_number);

-- Set up triggers for keeping updated_at current
CREATE TRIGGER update_chats_updated_at
BEFORE UPDATE ON chats
FOR EACH ROW
EXECUTE PROCEDURE update_updated_at_column();

CREATE TRIGGER update_messages_updated_at
BEFORE UPDATE ON messages
FOR EACH ROW
EXECUTE PROCEDURE update_updated_at_column();

-- Enable Row Level Security
ALTER TABLE chats ENABLE ROW LEVEL SECURITY;
ALTER TABLE messages ENABLE ROW LEVEL SECURITY;

-- Set up RLS policies
CREATE POLICY "Allow full access to own chats"
ON chats
USING (user_id = auth.uid())
WITH CHECK (user_id = auth.uid());

CREATE POLICY "Allow full access to own messages"
ON messages
USING (user_id = auth.uid())
WITH CHECK (user_id = auth.uid()); 