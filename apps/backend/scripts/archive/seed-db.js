#!/usr/bin/env node

require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');
const { v4: uuidv4 } = require('uuid');

// Initialize Supabase client with SERVICE_ROLE_KEY to bypass RLS
const supabaseUrl = process.env.SUPABASE_URL || 'http://localhost:54321';
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU';
const supabase = createClient(supabaseUrl, supabaseKey);

// Sample data
const testUsers = [
  { id: uuidv4(), email: 'user1@example.com' },
  { id: uuidv4(), email: 'user2@example.com' },
];

const testChats = [
  {
    id: uuidv4(),
    user_id: testUsers[0].id,
    name: 'First Conversation',
    model: 'gpt-4',
    temperature: 0.7,
  },
  {
    id: uuidv4(),
    user_id: testUsers[0].id,
    name: 'Technical Chat',
    model: 'gpt-3.5-turbo',
    temperature: 0.5,
  },
  {
    id: uuidv4(),
    user_id: testUsers[1].id,
    name: 'Work Meeting',
    model: 'gpt-4',
    temperature: 0.8,
  },
];

const testMessages = [
  // Messages for first chat
  {
    id: uuidv4(),
    chat_id: testChats[0].id,
    user_id: testUsers[0].id,
    content: 'Hello, how can you help me today?',
    role: 'user',
    model: 'gpt-4',
    sequence_number: 1,
  },
  {
    id: uuidv4(),
    chat_id: testChats[0].id,
    user_id: testUsers[0].id,
    content: 'I can help with various tasks like answering questions, drafting emails, explaining concepts, and more. What would you like assistance with?',
    role: 'assistant',
    model: 'gpt-4',
    sequence_number: 2,
  },
  
  // Messages for second chat
  {
    id: uuidv4(),
    chat_id: testChats[1].id,
    user_id: testUsers[0].id,
    content: 'How do I implement a binary search algorithm?',
    role: 'user',
    model: 'gpt-3.5-turbo',
    sequence_number: 1,
  },
  {
    id: uuidv4(),
    chat_id: testChats[1].id,
    user_id: testUsers[0].id,
    content: 'To implement a binary search algorithm...',
    role: 'assistant',
    model: 'gpt-3.5-turbo',
    sequence_number: 2,
  },
  
  // Messages for third chat
  {
    id: uuidv4(),
    chat_id: testChats[2].id,
    user_id: testUsers[1].id,
    content: 'Can you help me draft an agenda for tomorrow\'s meeting?',
    role: 'user',
    model: 'gpt-4',
    sequence_number: 1,
  },
  {
    id: uuidv4(),
    chat_id: testChats[2].id,
    user_id: testUsers[1].id,
    content: 'Certainly! Here\'s a draft agenda...',
    role: 'assistant',
    model: 'gpt-4',
    sequence_number: 2,
  },
];

// Seed the database
async function seedDatabase() {
  try {
    console.log('Seeding database...');
    
    // In a real application, you would create users via auth.signUp
    // For this example, we'll just pretend they exist and use their IDs
    console.log('Users created (simulated):', testUsers.map(u => u.id).join(', '));
    
    // Insert chats
    const { data: chatsData, error: chatsError } = await supabase
      .from('chats')
      .insert(testChats)
      .select();
    
    if (chatsError) {
      throw new Error(`Error inserting chats: ${chatsError.message}`);
    }
    
    console.log(`${chatsData.length} chats inserted`);
    
    // Insert messages
    const { data: messagesData, error: messagesError } = await supabase
      .from('messages')
      .insert(testMessages)
      .select();
    
    if (messagesError) {
      throw new Error(`Error inserting messages: ${messagesError.message}`);
    }
    
    console.log(`${messagesData.length} messages inserted`);
    
    console.log('Database seeded successfully!');
  } catch (error) {
    console.error('Error seeding database:', error);
  }
}

seedDatabase(); 