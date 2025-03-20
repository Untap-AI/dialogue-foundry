import { Request, Response, NextFunction } from 'express';
import { extractTokenFromHeader, verifyToken } from '../lib/jwt-utils';

// Extend Express Request interface to include user and chat information
declare global {
  namespace Express {
    interface Request {
      user?: {
        userId: string;
        chatId?: string;
      };
    }
  }
}

/**
 * Middleware to authenticate chat access using JWT token
 */
export const authenticateChatAccess = (req: Request, res: Response, next: NextFunction) => {
  try {
    // Get the authorization header
    const authHeader = req.headers.authorization;
    
    // Extract token from header
    const token = extractTokenFromHeader(authHeader);
    if (!token) {
      return res.status(401).json({ error: 'Authentication required. Provide a valid Bearer token.' });
    }
    
    // Verify token
    const payload = verifyToken(token);
    if (!payload) {
      return res.status(401).json({ error: 'Invalid or expired token' });
    }
    
    // Check if the requested chat ID matches the token's chat ID
    const { chatId } = req.params;
    if (chatId && chatId !== payload.chatId) {
      return res.status(403).json({ error: 'You do not have access to this chat' });
    }
    
    // Add user info to request for future middleware/handlers
    req.user = {
      userId: payload.userId,
      chatId: payload.chatId
    };
    
    return next();
  } catch (error: any) {
    console.error('Auth middleware error:', error);
    return res.status(500).json({ error: 'Authentication failed' });
  }
};

/**
 * Middleware for routes that only need user authentication without specific chat access
 */
export const authenticateUser = (req: Request, res: Response, next: NextFunction) => {
  try {
    // Get the authorization header
    const authHeader = req.headers.authorization;
    
    // Extract token from header
    const token = extractTokenFromHeader(authHeader);
    if (!token) {
      return res.status(401).json({ error: 'Authentication required. Provide a valid Bearer token.' });
    }
    
    // Verify token
    const payload = verifyToken(token);
    if (!payload) {
      return res.status(401).json({ error: 'Invalid or expired token' });
    }
    
    // Add user info to request for future middleware/handlers
    req.user = {
      userId: payload.userId,
      chatId: payload.chatId
    };
    
    return next();
  } catch (error: any) {
    console.error('Auth middleware error:', error);
    return res.status(500).json({ error: 'Authentication failed' });
  }
}; 