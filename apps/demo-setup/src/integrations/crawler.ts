import { spawn } from 'node:child_process'
import { env } from '../config/env'
import { logger } from '../lib/logger'
import type { PreparedInput } from '../types'

/* Runs the local Python web-crawler (orchestrator.py) as a background
 * subprocess. Replaces the old n8n step that provisioned a per-company Render
 * cron job. The crawler crawls the site, chunks + summarizes content, and
 * upserts it into the company's Upstash namespace.
 *
 * Fire-and-forget: we don't await the crawl (it can take minutes). Progress and
 * failures are logged; the demo itself is already live before this runs. */
export const startCrawl = (input: PreparedInput): void => {
  const upstash = env.upstash()

  const child = spawn(env.crawlerPython, ['orchestrator.py'], {
    cwd: env.crawlerDir(),
    env: {
      ...process.env,
      START_URLS: input.companyWebsite,
      MAX_DEPTH: env.crawlerMaxDepth(input.isProd),
      UPSTASH_VECTOR_REST_URL: upstash.url,
      UPSTASH_VECTOR_REST_TOKEN: upstash.token,
      UPSTASH_NAMESPACE: input.namespace,
      OPENAI_API_KEY: env.crawlerOpenaiApiKey()
    }
  })

  const tag = `[crawler ${input.companyId}]`
  child.stdout.on('data', data => logger.info(tag, data.toString().trim()))
  child.stderr.on('data', data => logger.warn(tag, data.toString().trim()))
  child.on('error', error => logger.error(`${tag} failed to start:`, error))
  child.on('close', code =>
    code === 0
      ? logger.info(`${tag} completed`)
      : logger.error(`${tag} exited with code ${code}`)
  )

  logger.info(`${tag} started for ${input.companyWebsite}`)
}
