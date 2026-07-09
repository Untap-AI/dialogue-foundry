import { logger } from '../lib/logger'
import { env } from '../config/env'
import { persistCompanyConfig } from '../integrations/supabase'
import { uploadDemo } from '../integrations/s3'
import { runCrawl } from '../integrations/crawler'
import { scrapeForDemo } from '../integrations/scraper'
import { titleCaseFromHostname } from '../lib/slug'
import { prepareInput } from './prepare-input'
import { extractBrandCandidates } from './extract-brand-candidates'
import { analyzeContent } from './analyze-content'
import { detectBrand } from './detect-brand'
import { enforceQuality } from './quality'
import { buildSystemPrompt } from './system-prompt'
import { buildHtml } from './build-html'
import type {
  BrandProbe,
  ContentAnalysis,
  DemoInput,
  PreparedInput
} from '../types'

export type PipelineResult = {
  demoUrl: string
  /* The name actually used to brand this demo — whatever the caller supplied,
   * or whatever was inferred (see resolveCompanyName below). The queue worker
   * writes this back onto the demo_requests row once known. */
  companyName: string
  /* Resolves when the RAG namespace is seeded. The demo URL is already live and
   * correctly branded before this settles, but the widget can't answer anything
   * company-specific until it does. `POST /demos` ignores it (logging failures);
   * the queue worker awaits it before emailing the prospect. */
  crawlDone: Promise<void>
}

/* The prospect no longer supplies a company name up front, so one is inferred
 * once the crawl has run — preferring the highest-quality signal available:
 * the content-analysis LLM call (instructed to extract the exact business
 * name off the site), then the brand probe's og:site_name/<title> read, then
 * the domain itself as a last resort. A caller-supplied companyName (e.g. a
 * direct POST /demos request) always wins, same as logoUrl/title overrides. */
const resolveCompanyName = (
  input: PreparedInput,
  analysis: ContentAnalysis,
  brand: BrandProbe
): string =>
  input.companyName?.trim() ||
  analysis.businessName?.trim() ||
  brand.title?.trim() ||
  titleCaseFromHostname(input.companyWebsite)

/* Orchestrates the full demo-setup flow. Everything up to and including the S3
 * upload runs inline so the caller gets a working demo URL back. The deep crawl
 * is started last and handed back as a promise, since the demo is usable (minus
 * RAG answers) before it finishes. */
export const runPipeline = async (
  rawInput: DemoInput
): Promise<PipelineResult> => {
  const input = await prepareInput(rawInput)
  logger.info(
    `Starting demo setup for ${input.companyId} (${input.companyWebsite})`
  )

  // Fail before we publish anything if the crawl couldn't run anyway. Resolving
  // these lazily inside runCrawl meant a missing Upstash var surfaced as a 500
  // only after S3 and Supabase had already been written.
  env.upstash()
  env.crawlerOpenaiApiKey()

  // Single real-browser scrape (crawl4ai) provides page content for analysis,
  // computed-style brand signals (colors/logo/fonts read live off the DOM), and
  // a screenshot for the vision-based brand tiebreak. The HTML-regex candidates
  // are now only a fallback for when the in-browser probe couldn't run.
  const scraped = await scrapeForDemo(input.companyWebsite)
  const pages = scraped.pages.map(page => page.markdown)
  const fallbackCandidates = extractBrandCandidates(
    scraped.homepageHtml,
    input.companyWebsite
  )

  // The two consolidated LLM calls, run in parallel.
  const [rawAnalysis, rawBrand] = await Promise.all([
    analyzeContent(pages),
    detectBrand(
      input,
      scraped.brand,
      scraped.screenshot,
      scraped.screenshotWidth,
      scraped.screenshotHeight,
      fallbackCandidates
    )
  ])

  const { analysis, brand } = enforceQuality(
    input.companyId,
    rawAnalysis,
    rawBrand
  )

  const companyName = resolveCompanyName(input, analysis, scraped.brand)
  const resolvedInput = { ...input, companyName }

  const systemPrompt = buildSystemPrompt(resolvedInput, analysis)

  // Persist config and upload the demo page in parallel.
  const html = buildHtml(resolvedInput, analysis, brand)
  const [, demoUrl] = await Promise.all([
    persistCompanyConfig(resolvedInput, systemPrompt),
    uploadDemo(input.companyId, html)
  ])

  // Seed the RAG namespace. Started here, awaited (or not) by the caller.
  const crawlDone = runCrawl(resolvedInput)

  logger.info(`Demo setup complete for ${input.companyId}: ${demoUrl}`)
  return { demoUrl, companyName, crawlDone }
}
