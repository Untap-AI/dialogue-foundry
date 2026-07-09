import { spawn } from 'node:child_process'
import { env } from '../config/env'
import { logger } from '../lib/logger'
import { killProcessTree } from '../lib/process-tree'
import type { ChildProcess } from 'node:child_process'
import type { PreparedInput } from '../types'

/* Every crawl currently running, so a SIGTERM can take their browsers down with
 * it instead of orphaning them. */
const activeCrawls = new Set<ChildProcess>()

export const killActiveCrawls = (): void => {
  for (const child of activeCrawls) killProcessTree(child)
  activeCrawls.clear()
}

/* Runs the local Python web-crawler (orchestrator.py) as a subprocess. Replaces
 * the old n8n step that provisioned a per-company Render cron job. The crawler
 * crawls the site, chunks + summarizes content, and upserts it into the
 * company's Upstash namespace.
 *
 * Resolves when the crawl succeeds, rejects on nonzero exit or timeout. The
 * queue worker awaits this before emailing the demo link — the widget is live
 * beforehand but its RAG namespace is empty, so an early email would send the
 * prospect to a chatbot that knows nothing about them. */
export const runCrawl = (input: PreparedInput): Promise<void> =>
  new Promise((resolve, reject) => {
    const upstash = env.upstash()
    const tag = `[crawler ${input.companyId}]`

    const child = spawn(env.crawlerPython, ['orchestrator.py'], {
      cwd: env.crawlerDir(),
      // Lead a new process group so we can kill Chrome along with Python.
      detached: true,
      env: {
        ...process.env,
        // Belt-and-suspenders alongside orchestrator.py's own
        // sys.stdout.reconfigure(line_buffering=True) — a piped stdout is
        // block-buffered by default and can hide many minutes of crawl
        // progress from these logs.
        PYTHONUNBUFFERED: '1',
        START_URLS: input.companyWebsite,
        MAX_DEPTH: env.crawlerMaxDepth(input.isProd),
        MAX_PAGES: env.crawlerMaxPages,
        UPSTASH_VECTOR_REST_URL: upstash.url,
        UPSTASH_VECTOR_REST_TOKEN: upstash.token,
        UPSTASH_NAMESPACE: input.namespace,
        OPENAI_API_KEY: env.crawlerOpenaiApiKey(),
        // web-crawler/.env may carry an EXPECTED_CHUNKS tuned for a different
        // (large-site deep-crawl) workflow. Demo-setup crawls one company site
        // per call with wildly varying size, so opt out of that threshold.
        EXPECTED_CHUNKS: '0'
      }
    })

    activeCrawls.add(child)

    // `error` and `close` can both fire, and the timeout can race either. Settle
    // exactly once so a late `close` can't resolve a promise we already rejected.
    let settled = false
    const settle = (error?: Error) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      activeCrawls.delete(child)
      if (error) reject(error)
      else resolve()
    }

    const timer = setTimeout(() => {
      logger.error(`${tag} exceeded ${env.crawlTimeoutMs}ms; killing`)
      killProcessTree(child)
      settle(new Error(`Crawl timed out after ${env.crawlTimeoutMs}ms`))
    }, env.crawlTimeoutMs)

    child.stdout.on('data', data => logger.info(tag, data.toString().trim()))
    child.stderr.on('data', data => logger.warn(tag, data.toString().trim()))
    child.on('error', error => settle(error))
    child.on('close', code => {
      if (code === 0) {
        logger.info(`${tag} completed`)
        return settle()
      }
      settle(new Error(`orchestrator.py exited with code ${code}`))
    })

    logger.info(`${tag} started for ${input.companyWebsite}`)
  })
