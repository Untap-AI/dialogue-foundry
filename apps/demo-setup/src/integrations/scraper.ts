import { spawn } from 'node:child_process'
import { env } from '../config/env'
import { logger } from '../lib/logger'
import { killProcessTree } from '../lib/process-tree'
import type { BrandProbe } from '../types'

export type ScrapedPage = { url: string; markdown: string }
export type ScrapeResult = {
  pages: ScrapedPage[]
  homepageHtml: string
  /* Computed-style brand signals read out of the live page. `{}` when the probe
   * couldn't run — callers must fall back to parsing homepageHtml. */
  brand: BrandProbe
  /* Base64 JPEG of the homepage above the fold, or '' if capture failed. */
  screenshot: string
  // Pixel dimensions of `screenshot`, as reported by scrape_page.py. No longer
  // consumed since logo selection moved off bounding-box coordinate matching.
  screenshotWidth: number
  screenshotHeight: number
}

/* Runs the local crawl4ai scrape entrypoint (web-crawler/scrape_page.py) as a
 * subprocess and returns its JSON payload. This replaces the old Tavily crawl +
 * naive Node fetch() with the same real-browser stack the deep crawler uses, so
 * JS-heavy and anti-bot sites render correctly — and no scraping network calls
 * originate from the Node process (removing the SSRF surface).
 *
 * Awaited inline by the pipeline, so a hung Chrome here would pin a queue worker
 * slot indefinitely. Bounded by SCRAPE_TIMEOUT_MS, and spawned detached so the
 * timeout can kill the browser along with Python. */
export const scrapeForDemo = (website: string): Promise<ScrapeResult> =>
  new Promise((resolve, reject) => {
    const child = spawn(env.crawlerPython, ['scrape_page.py', website], {
      cwd: env.crawlerDir(),
      detached: true,
      env: {
        ...process.env,
        SCRAPE_MAX_PAGES: env.scrapeMaxPages
      }
    })

    let settled = false
    const settle = (error?: Error, value?: ScrapeResult) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      if (error) reject(error)
      else resolve(value as ScrapeResult)
    }

    const timer = setTimeout(() => {
      logger.error(`[scrape] exceeded ${env.scrapeTimeoutMs}ms; killing`)
      killProcessTree(child)
      settle(new Error(`Scrape timed out after ${env.scrapeTimeoutMs}ms`))
    }, env.scrapeTimeoutMs)

    let stdout = ''
    let stderr = ''
    child.stdout.on('data', data => (stdout += data.toString()))
    child.stderr.on('data', data => {
      stderr += data.toString()
      logger.info('[scrape]', data.toString().trim())
    })

    child.on('error', error => settle(error))
    child.on('close', code => {
      if (code !== 0) {
        return settle(
          new Error(`scrape_page.py exited with code ${code}: ${stderr.trim()}`)
        )
      }
      try {
        const parsed = JSON.parse(stdout) as ScrapeResult
        if (!parsed.pages?.length) {
          return settle(new Error('Scraper returned no pages'))
        }
        settle(undefined, parsed)
      } catch (error) {
        settle(new Error(`Failed to parse scraper output: ${error}`))
      }
    })
  })
