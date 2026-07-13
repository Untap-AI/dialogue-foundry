import {
  extractTokenFromHeader,
  verifyToken,
  verifyAdminToken
} from '../lib/jwt-utils'
import { logger } from '../lib/logger'
import type * as express from 'express'

// Create a custom interface extending Express Request
export interface CustomRequest extends express.Request {
  user?: {
    userId: string
    chatId?: string
    isAdmin?: boolean
  }
}

/**
 * Helper function to extract token from query parameter
 * This is mainly used for EventSource connections where setting custom headers isn't possible
 */
const extractTokenFromQuery = (req: express.Request): string | undefined => {
  if (req.query && typeof req.query.token === 'string') {
    // Don't log the token for security reasons
    return req.query.token
  }
  return undefined
}

/**
 * Middleware to authenticate chat access using JWT token
 * Supports both Authorization header and token query parameter
 */
export const authenticateChatAccess = (
  req: CustomRequest,
  res: express.Response,
  next: express.NextFunction
) => {
  try {
    let token: string | undefined
    let tokenSource = 'none'

    // First try to get token from header
    const authHeader = req.headers.authorization
    token = extractTokenFromHeader(authHeader)
    if (token) tokenSource = 'header'

    // If no token in header, try query parameter
    if (!token) {
      token = extractTokenFromQuery(req)
      if (token) tokenSource = 'query'
    }

    // If still no token, return authentication error
    if (!token) {
      logger.warn(`Authentication failed: No token provided in request`, {
        path: req.originalUrl,
        method: req.method
      })
      return res.status(401).json({
        error:
          'Authentication required. Provide a valid Bearer token or token parameter.',
        code: 'TOKEN_MISSING'
      })
    }

    // Verify token
    const verifyResult = verifyToken(token)
    if (!verifyResult) {
      // Generic verification failure - could be invalid format, signature, etc.
      logger.warn(`Authentication failed: Invalid token format or signature`, {
        tokenSource,
        path: req.originalUrl,
        method: req.method
      })
      return res.status(401).json({
        error: 'Invalid token. Please reinitialize your chat session.',
        code: 'TOKEN_INVALID'
      })
    }

    // Check for token expiration specifically
    if (verifyResult.expired) {
      // Token is structurally valid but expired - don't log this as a warning
      return res.status(401).json({
        error: 'Your session has expired. Starting a new chat session.',
        code: 'TOKEN_EXPIRED'
      })
    }

    const payload = verifyResult.payload

    // Check if the requested chat ID matches the token's chat ID
    const { chatId } = req.params
    if (chatId && chatId !== payload.chatId) {
      logger.warn(`Chat access denied: Token chat ID mismatch`, {
        tokenChatId: payload.chatId,
        requestedChatId: chatId,
        userId: payload.userId
      })
      return res.status(403).json({
        error: 'You do not have access to this chat',
        code: 'CHAT_ACCESS_DENIED'
      })
    }

    // Add user info to request for future middleware/handlers using Object.assign
    Object.assign(req, {
      user: {
        userId: payload.userId,
        chatId: payload.chatId
      }
    })

    return next()
  } catch (error) {
    logger.error('Auth middleware error', {
      error: error as Error,
      path: req.originalUrl,
      method: req.method
    })
    return res.status(500).json({
      error: 'Authentication failed',
      code: 'AUTH_FAILED'
    })
  }
}

/**
 * Middleware for internal admin routes (e.g. widget-config CRUD). Requires an
 * admin JWT minted via generateAdminAccessToken, distinct from the chat-access
 * tokens the other middleware here verify.
 */
export const authenticateAdmin = (
  req: CustomRequest,
  res: express.Response,
  next: express.NextFunction
) => {
  try {
    const authHeader = req.headers.authorization
    const token = extractTokenFromHeader(authHeader)
    if (!token) {
      return res.status(401).json({
        error: 'Authentication required. Provide a valid Bearer token.',
        code: 'TOKEN_MISSING'
      })
    }

    const verifyResult = verifyAdminToken(token)
    if (!verifyResult) {
      return res.status(401).json({
        error: 'Invalid admin token.',
        code: 'TOKEN_INVALID'
      })
    }

    if (verifyResult.expired) {
      return res.status(401).json({
        error: 'Your admin session has expired.',
        code: 'TOKEN_EXPIRED'
      })
    }

    Object.assign(req, {
      user: {
        userId: verifyResult.payload.userId,
        isAdmin: true
      }
    })

    return next()
  } catch (error) {
    logger.error('Admin auth middleware error', {
      error: error as Error,
      path: req.originalUrl,
      method: req.method
    })
    return res.status(500).json({
      error: 'Authentication failed',
      code: 'AUTH_FAILED'
    })
  }
}

/**
 * Middleware for routes that only need user authentication without specific chat access
 */
export const authenticateUser = (
  req: CustomRequest,
  res: express.Response,
  next: express.NextFunction
) => {
  try {
    // Get the authorization header
    const authHeader = req.headers.authorization

    // Extract token from header
    const token = extractTokenFromHeader(authHeader)
    if (!token) {
      return res.status(401).json({
        error: 'Authentication required. Provide a valid Bearer token.',
        code: 'TOKEN_MISSING'
      })
    }

    // Verify token
    const verifyResult = verifyToken(token)
    if (!verifyResult) {
      return res.status(401).json({
        error: 'Invalid token. Please reinitialize your session.',
        code: 'TOKEN_INVALID'
      })
    }

    // Check for token expiration specifically
    if (verifyResult.expired) {
      return res.status(401).json({
        error: 'Your session has expired. Starting a new session.',
        code: 'TOKEN_EXPIRED'
      })
    }

    const payload = verifyResult.payload

    // Add user info to request for future middleware/handlers using Object.assign
    Object.assign(req, {
      user: {
        userId: payload.userId,
        chatId: payload.chatId
      }
    })

    return next()
  } catch (error) {
    logger.error('User auth middleware error', {
      error: error as Error,
      path: req.originalUrl,
      method: req.method
    })
    return res.status(500).json({
      error: 'Authentication failed',
      code: 'AUTH_FAILED'
    })
  }
}
