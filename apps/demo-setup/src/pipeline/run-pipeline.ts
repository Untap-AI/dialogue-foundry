import { logger } from '../lib/logger'
import { persistCompanyConfig } from '../integrations/supabase'
import { uploadDemo } from '../integrations/s3'
import { startCrawl } from '../integrations/crawler'
import { scrapeForDemo } from '../integrations/scraper'
import { prepareInput } from './prepare-input'
import { extractBrandCandidates } from './extract-brand-candidates'
import { analyzeContent } from './analyze-content'
import { detectBrand } from './detect-brand'
import { enforceQuality } from './quality'
import { buildSystemPrompt } from './system-prompt'
import { buildHtml } from './build-html'
import type { DemoInput } from '../types'

/* Orchestrates the full demo-setup flow. Everything up to and including the S3
 * upload runs inline so the caller gets a working demo URL back. The full deep
 * crawl (which seeds the RAG namespace) is kicked off last as a background job,
 * since the demo is usable (minus RAG answers) before it finishes. */
export const runPipeline = async (
  rawInput: DemoInput
): Promise<{ demoUrl: string }> => {
  const input = await prepareInput(rawInput)
  logger.info(
    `Starting demo setup for ${input.companyId} (${input.companyWebsite})`
  )

  // Single real-browser scrape (crawl4ai) provides both the page content for
  // analysis and the rendered homepage HTML for brand-candidate extraction.
  const scraped = await scrapeForDemo(input.companyWebsite)
  const pages = scraped.pages.map(page => page.markdown)
  const candidates = extractBrandCandidates(
    scraped.homepageHtml,
    input.companyWebsite
  )

  // The two consolidated LLM calls, run in parallel.
  const [rawAnalysis, rawBrand] = await Promise.all([
    analyzeContent(pages),
    detectBrand(input, candidates)
  ])

  const { analysis, brand } = enforceQuality(
    input.companyId,
    rawAnalysis,
    rawBrand
  )

  const systemPrompt = buildSystemPrompt(input, analysis)

  // Persist config and upload the demo pages in parallel.
  const html = buildHtml(input, analysis, brand)
  const [, demoUrl] = await Promise.all([
    persistCompanyConfig(input, systemPrompt),
    uploadDemo(input.companyId, html)
  ])

  // Fire-and-forget: seed the RAG namespace in the background.
  startCrawl(input)

  logger.info(`Demo setup complete for ${input.companyId}: ${demoUrl}`)
  return { demoUrl }
}
