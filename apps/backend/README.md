# Backend Service

This is the backend service for Dialogue Foundry, providing API endpoints and database connectivity.

## Supabase Configuration

The application uses Supabase for database and authentication services.

### Local Development

1. Make sure Docker is installed and running
2. Start the local Supabase instance:
   ```bash
   npx supabase start
   ```
3. Apply database migrations:
   ```bash
   sh scripts/apply-migrations.sh
   ```
4. Access the Supabase Studio at http://localhost:54323

### Production Setup

1. Create a project on [Supabase](https://supabase.com)
2. Copy `.env.production.example` to `.env.production` and fill in your Supabase project credentials
3. Apply migrations to your remote database:
   ```bash
   npx supabase link --project-ref your-project-ref
   npx supabase db push
   ```

## Environment Variables

The application uses different environment files based on the `NODE_ENV`:

- `.env.local` - Local development (Docker)
- `.env.production` - Production deployment
- `.env.staging` - Staging deployment (optional)

## Authentication System

The application uses JWT tokens for secure chat access:

1. When a user creates a new chat, they receive a JWT token
2. This token must be included in the Authorization header for subsequent requests
3. The token contains the chat ID and user ID, ensuring only authorized users can access their chats

Example:
```
Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...
```

JWT Configuration in environment files:
```
JWT_SECRET=your-secret-key
JWT_EXPIRY=86400  # 24 hours in seconds
```

## Running the Application

```bash
# Development
npm run dev

# Production
npm run build
npm start
```

## Features

- REST API for chat interactions
- Persistent chat and message storage with Supabase
- Integration with OpenAI for AI responses
- User identification to maintain chat history between sessions
- CORS protection for security
- JWT-based authentication for secure chat access

## Requirements

- Node.js (v14+)
- Supabase account (for database)
- OpenAI API key

## API Endpoints

### Chats

- `GET /api/chats/user/:userId` - Get all chats for a user (requires authentication)
- `GET /api/chats/:chatId` - Get a chat by ID with its messages (requires chat-specific token)
- `POST /api/chats` - Create a new chat and receive an access token
- `PUT /api/chats/:chatId` - Update a chat (requires chat-specific token)
- `DELETE /api/chats/:chatId` - Delete a chat (requires chat-specific token)

### Messages

- `POST /api/chats/:chatId/messages` - Send a message and get an AI response (requires chat-specific token)

## Integration with NLUX

This backend is designed to work with NLUX for the frontend. Here's a basic example of how to integrate it:

```javascript
import { createChatUi } from '@nlux/react';
import { createChat, getChat, sendMessage } from '../utils/chat-client';

// First create a chat and get the token
const { chat, accessToken } = await createChat('user-123', 'New Chat');

// Configure NLUX with your custom API functions
const chatUi = createChatUi({
  customApi: {
    sendMessage: async (message) => {
      const response = await sendMessage(chat.id, message);
      return response.aiMessage.content;
    }
  }
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