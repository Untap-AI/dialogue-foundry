import { spawn } from 'node:child_process'
import { env } from '../config/env'
import { logger } from '../lib/logger'

export type ScrapedPage = { url: string; markdown: string }
export type ScrapeResult = { pages: ScrapedPage[]; homepageHtml: string }

/* Runs the local crawl4ai scrape entrypoint (web-crawler/scrape_page.py) as a
 * subprocess and returns its JSON payload. This replaces the old Tavily crawl +
 * naive Node fetch() with the same real-browser stack the deep crawler uses, so
 * JS-heavy and anti-bot sites render correctly — and no scraping network calls
 * originate from the Node process (removing the SSRF surface). */
export const scrapeForDemo = (website: string): Promise<ScrapeResult> =>
  new Promise((resolve, reject) => {
    const child = spawn(env.crawlerPython, ['scrape_page.py', website], {
      cwd: env.crawlerDir(),
      env: {
        ...process.env,
        SCRAPE_MAX_PAGES: env.scrapeMaxPages
      }
    })

    let stdout = ''
    let stderr = ''
    child.stdout.on('data', data => (stdout += data.toString()))
    child.stderr.on('data', data => {
      stderr += data.toString()
      logger.info('[scrape]', data.toString().trim())
    })

    child.on('error', reject)
    child.on('close', code => {
      if (code !== 0) {
        return reject(
          new Error(`scrape_page.py exited with code ${code}: ${stderr.trim()}`)
        )
      }
      try {
        const parsed = JSON.parse(stdout) as ScrapeResult
        if (!parsed.pages?.length) {
          return reject(new Error('Scraper returned no pages'))
        }
        resolve(parsed)
      } catch (error) {
        reject(new Error(`Failed to parse scraper output: ${error}`))
      }
    })
  })
