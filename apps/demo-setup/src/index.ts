import { timingSafeEqual } from 'node:crypto'
import express from 'express'
import cors from 'cors'
import { env } from './config/env'
import { logger } from './lib/logger'
import { demoInputSchema } from './types'
import { runPipeline } from './pipeline/run-pipeline'
import type {
  NextFunction,
  Request as ExpressRequest,
  Response as ExpressResponse
} from 'express'

const app = express()
app.use(cors())
app.use(express.json({ limit: '2mb' }))

app.get('/health', (_req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() })
})

/* Optional bearer-token auth. If DEMO_SETUP_API_KEYS is unset, auth is a no-op
 * (fine for a locked-down mac-mini on a private network). */
const timingSafeStringEqual = (a: string, b: string): boolean => {
  const bufA = Buffer.from(a)
  const bufB = Buffer.from(b)
  // Compare against a fixed-length buffer first so differing lengths don't
  // short-circuit before timingSafeEqual (which requires equal-length inputs).
  if (bufA.length !== bufB.length) {
    timingSafeEqual(bufA, bufA)
    return false
  }
  return timingSafeEqual(bufA, bufB)
}

const requireApiKey = (
  req: ExpressRequest,
  res: ExpressResponse,
  next: NextFunction
) => {
  if (env.apiKeys.length === 0) return next()
  const token = req.headers.authorization?.replace(/^Bearer\s+/i, '')
  if (token && env.apiKeys.some(key => timingSafeStringEqual(token, key))) {
    return next()
  }
  return res.status(401).json({ error: 'Unauthorized' })
}

app.post('/demos', requireApiKey, async (req, res) => {
  const parsed = demoInputSchema.safeParse(req.body)
  if (!parsed.success) {
    return res
      .status(400)
      .json({ error: 'Invalid input', issues: parsed.error.issues })
  }

  try {
    const result = await runPipeline(parsed.data)
    return res.status(201).json(result)
  } catch (error) {
    logger.error('Demo setup failed:', error)
    return res.status(500).json({
      error: 'Demo setup failed',
      message: error instanceof Error ? error.message : String(error)
    })
  }
})

app.listen(env.port, () => {
  logger.info(`demo-setup listening on port ${env.port}`)
})
