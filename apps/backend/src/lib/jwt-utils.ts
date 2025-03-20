import jwt from 'jsonwebtoken';
import dotenv from 'dotenv';

dotenv.config();

// Get JWT secret from environment variables or use a default for development
const JWT_SECRET = process.env.JWT_SECRET || 'super-secret-jwt-token-with-at-least-32-characters-long';
const TOKEN_EXPIRY = process.env.JWT_EXPIRY ? parseInt(process.env.JWT_EXPIRY) : 86400; // 24 hours in seconds

interface ChatAccessPayload {
  chatId: string;
  userId: string;
  iat?: number;
  exp?: number;
}

/**
 * Generate a JWT token for chat access
 * @param chatId - The ID of the chat
 * @param userId - The ID of the user
 * @returns JWT token
 */
export const generateChatAccessToken = (chatId: string, userId: string): string => {
  const payload: ChatAccessPayload = {
    chatId,
    userId
  };

  return jwt.sign(payload, JWT_SECRET, {
    expiresIn: TOKEN_EXPIRY
  });
};

/**
 * Verify and decode a JWT token
 * @param token - JWT token to verify
 * @returns The decoded payload or null if invalid
 */
export const verifyToken = (token: string): ChatAccessPayload | null => {
  try {
    return jwt.verify(token, JWT_SECRET) as ChatAccessPayload;
  } catch (error) {
    console.error('JWT verification failed:', error);
    return null;
  }
};

/**
 * Extract token from Authorization header
 * @param authHeader - Authorization header value
 * @returns The JWT token or null if not found
 */
export const extractTokenFromHeader = (authHeader?: string): string | null => {
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return null;
  }
  
  return authHeader.substring(7); // Remove 'Bearer ' prefix
}; 