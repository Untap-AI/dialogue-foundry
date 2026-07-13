import express from 'express'
import cors from 'cors'
import dotenv from 'dotenv'
import rateLimit from 'express-rate-limit'
import Honeybadger from '@honeybadger-io/js'
import chatRoutes from './routes/chat-routes'
import analyticsRoutes from './routes/analytics-routes'
import widgetConfigRoutes from './routes/widget-config-routes'
import adminWidgetConfigRoutes from './routes/admin-widget-config-routes'
import { logger } from './lib/logger'

// Load environment variables
dotenv.config()

// Create Express application
const app = express()
const port = parseInt(process.env.PORT || '3000', 10)

// Trust the proxy (required for Render and other hosting platforms)
// This allows Express to trust the X-Forwarded-For header for accurate IP detection
app.set('trust proxy', 1)

// Middleware to handle different content types (especially for sendBeacon)
app.use(express.text({ type: 'text/plain' })) // Handle text/plain for sendBeacon
app.use(express.json({ limit: '10mb' })) // Handle JSON requests
app.use(express.urlencoded({ extended: true })) // Handle form data

// Add Honeybadger request handler (must be after body parsers, before routes)
app.use(Honeybadger.requestHandler as any)

// Health check endpoint - placed at the top to ensure it's always accessible
app.get('/health', (_, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() })
})

// Configure rate limiting
const globalRateLimit = rateLimit({
  windowMs: 5 * 60 * 1000, // 5 minutes
  limit: 200, // Increased limit for mobile compatibility
  standardHeaders: true, // Return rate limit info in the `RateLimit-*` headers
  legacyHeaders: false, // Disable the `X-RateLimit-*` headers
  message: { error: 'Too many requests, please try again later.' },
  // Trust the X-Forwarded-For header from Render's proxy
  skipSuccessfulRequests: false, // Don't skip successful requests
  skip: (req) => {
    // Skip rate limiting for health check and analytics
    return req.path === '/health' || 
           req.path === '/api/analytics/events' || 
           req.path === '/api/analytics' ||
           req.path.startsWith('/api/analytics/')
  }
})

// Apply global rate limit to all requests BEFORE CORS
// This ensures any rate limit error responses will have CORS headers
app.use(globalRateLimit as any)

// Configure CORS - Accept all origins
app.use(
  cors({
    origin: true, // Allow all origins
    credentials: true,
    // Add specific headers needed for sendBeacon and mobile requests
    allowedHeaders: [
      'Content-Type',
      'Authorization',
      'X-Requested-With',
      'Accept',
      'Origin',
      'User-Agent'
    ],
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    // Expose headers that might be needed
    exposedHeaders: ['Content-Length', 'X-Foo', 'X-Bar']
  })
)

// More strict rate limit for chat streaming endpoint
// const chatStreamRateLimit = rateLimit({
//   windowMs: 5 * 60 * 1000, // 5 minutes
//   limit: 20, // 20 requests per 5 minutes
//   standardHeaders: true,
//   legacyHeaders: false,
//   message: { error: 'Too many chat requests, please try again later.' },
//   skipSuccessfulRequests: false,
//   keyGenerator: req => {
//     // Use user ID from authentication if available, otherwise IP
//     return (req as any).user?.userId || req.ip
//   },
//   skip: (req) => {
//     // Skip rate limiting for health check
//     return req.path === '/health'
//   }
// })

// API routes
app.use('/api/chats', chatRoutes)
app.use('/api/analytics', analyticsRoutes)
app.use('/api/events', analyticsRoutes)
app.use('/api/widget-config', widgetConfigRoutes)
app.use('/api/admin/widget-configs', adminWidgetConfigRoutes)

// Add Honeybadger error handler (must be after routes, before custom error handler)
app.use(Honeybadger.errorHandler as any)

// Apply the chat stream rate limiter to the streaming routes
// applyStreamRateLimit(chatStreamRateLimit)

// 404 handler - must come after routes
app.use(
  (
    req: express.Request,
    res: express.Response,
    _next: express.NextFunction
  ) => {
    res.status(404).json({
      error: 'Not Found',
      message: `Route ${req.method} ${req.url} not found`
    })
  }
)

// Primary error handling middleware
// Explicitly defining types without using underscores
app.use(
  (
    err: any,
    _req: express.Request,
    res: express.Response,
    next: express.NextFunction
  ) => {
    // Log the error with our Honeybadger logger
    logger.error(err, {
      stack: err.stack,
      message: err.message,
      name: err.name
    })

    // Safety check to ensure res is valid and has status method
    if (!res || typeof res.status !== 'function') {
      logger.error('Invalid response object in error handler', { res })
      return next(err) // Try to pass to default Express error handler
    }

    // Handle CORS errors differently
    if (err.message && err.message.includes('CORS')) {
      return res.status(403).json({
        error: 'CORS Error',
        message:
          process.env.DEPLOYMENT_ENV === 'development' ||
          process.env.DEPLOYMENT_ENV === 'smokebox'
            ? err.message
            : 'Origin not allowed'
      })
    }

    // Generic error response
    return res.status(500).json({
      error: 'An unexpected error occurred',
      message:
        process.env.DEPLOYMENT_ENV === 'development' ||
        process.env.DEPLOYMENT_ENV === 'smokebox'
          ? err.message
          : undefined
    })
  }
)

// Start the server
app.listen(port, () => {
  logger.info(`Server is running on port ${port}`)
  logger.info(`Health check: http://localhost:${port}/health`)
})

export default app
