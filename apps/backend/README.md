# Chatbot Backend

A simple backend for a chatbot application that can be embedded on a small company website. It allows users to interact with an AI chatbot and maintains chat history.

## Features

- REST API for chat interactions
- Persistent chat and message storage with Supabase
- Integration with OpenAI for AI responses
- User identification to maintain chat history between sessions
- CORS protection for security

## Requirements

- Node.js (v14+)
- Supabase account (for database)
- OpenAI API key

## Getting Started

### 1. Set up Supabase

1. Create a new project on [Supabase](https://supabase.com/)
2. Apply the database schema found in `supabase/schema.sql` using the SQL editor in Supabase

### 2. Configure Environment Variables

1. Copy `.env.example` to `.env`
2. Fill in the required environment variables:
   - `SUPABASE_URL`: Your Supabase project URL
   - `SUPABASE_ANON_KEY`: Your Supabase anonymous key
   - `OPENAI_API_KEY`: Your OpenAI API key
   - `PORT`: The port to run the server on (default: 3000)
   - `ALLOWED_ORIGINS`: Comma-separated list of allowed origins for CORS

### 3. Install Dependencies

```bash
npm install
```

### 4. Build and Run the Server

For development:
```bash
npm run dev
```

For production:
```bash
npm run build
npm start
```

## API Endpoints

### Chats

- `GET /api/chats/user/:userId` - Get all chats for a user
- `GET /api/chats/:chatId` - Get a chat by ID with its messages
- `POST /api/chats` - Create a new chat
- `PUT /api/chats/:chatId` - Update a chat
- `DELETE /api/chats/:chatId` - Delete a chat

### Messages

- `POST /api/chats/:chatId/messages` - Send a message and get an AI response

## Integration with NLUX

This backend is designed to work with NLUX for the frontend. Here's a basic example of how to integrate it:

```javascript
import { createChatUi } from '@nlux/react';

const chatUi = createChatUi({
  apiUrl: 'http://localhost:3000/api/chats',
  userId: 'user-123', // Replace with your user identification system
  onError: (error) => console.error('Chat error:', error)
});

// In your React component
function ChatComponent() {
  return (
    <div className="chat-container">
      {chatUi.render()}
    </div>
  );
}
```

## License

MIT 