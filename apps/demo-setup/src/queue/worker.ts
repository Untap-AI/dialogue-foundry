import { hostname } from 'node:os'
import { env } from '../config/env'
import { logger } from '../lib/logger'
import { deriveCompanyId } from '../lib/slug'
import { killActiveCrawls } from '../integrations/crawler'
import {
  sendDemoPendingEmail,
  sendDemoReadyEmail,
  sendInternalAlert
} from '../integrations/sendgrid'
import { runPipeline } from '../pipeline/run-pipeline'
import {
  claimPending,
  markComplete,
  markFailed,
  reapStale,
  releaseClaims,
  setCompanyId,
  setCompanyName,
  setDemoUrl
} from './repo'
import type { DemoRequestRow } from '../types'

const WORKER_ID = `${hostname()}:${process.pid}`

// Reaping is cheap but pointless every tick; roughly once a minute is plenty.
const REAP_EVERY_N_TICKS = 6

/* Rows we currently hold, so shutdown can hand them back rather than leaving
 * them to time out via DEMO_STALE_MINUTES. */
const inFlight = new Set<string>()
let stopping = false
let timer: NodeJS.Timeout | undefined
let ticks = 0

const errorMessage = (error: unknown): string =>
  error instanceof Error ? error.message : String(error)

const processRequest = async (row: DemoRequestRow): Promise<void> => {
  // Reuse the id from a previous attempt; a fresh slug would orphan that
  // attempt's S3 objects and Upstash namespace. Derived from the URL, not the
  // company name — the prospect no longer supplies one, and the slug is
  // needed immediately, before the pipeline has scraped anything.
  const companyId = row.company_id ?? deriveCompanyId(row.website_url)
  if (!row.company_id) await setCompanyId(row.id, companyId)

  // Only on the row's first-ever claim — claim_demo_requests increments
  // attempts on every claim, including reclaims after a restart or stale
  // timeout, so attempts > 1 here means the prospect already got this email
  // for this request. Best-effort: a prospect not getting the receipt is far
  // less costly than stalling the actual build over a SendGrid hiccup, so
  // don't await-and-fail the request over it.
  if (row.attempts === 1) {
    void sendDemoPendingEmail({
      to: row.email,
      companyId,
      websiteUrl: row.website_url
    })
  }

  const { demoUrl, companyName, crawlDone } = await runPipeline({
    companyId,
    companyName: row.company_name ?? undefined,
    companyWebsite: row.website_url,
    companyEmail: row.email,
    isProd: row.is_prod
  })
  await Promise.all([
    setDemoUrl(row.id, demoUrl),
    setCompanyName(row.id, companyName)
  ])

  // The demo is live and branded now, but its RAG namespace is empty until the
  // crawl lands. Emailing before this resolves sends the prospect to a chatbot
  // that can't answer anything about them.
  await crawlDone

  const sent = await sendDemoReadyEmail({
    to: row.email,
    companyId,
    demoUrl,
    companyName
  })
  await markComplete(row.id)

  if (!sent) {
    // The demo itself is fine — retrying would burn the LLM spend again for
    // nothing. Flag it so a human can forward the link.
    logger.error(`Demo ${companyId} built but the email failed to send`)
    await sendInternalAlert({
      subject: `[demo-setup] Built ${companyId} but could not email ${row.email}`,
      body: `The demo is live at ${demoUrl} but SendGrid rejected the notification. Forward it manually.`
    })
  }
}

const handleFailure = async (row: DemoRequestRow, error: unknown) => {
  // A shutdown kills in-flight crawls, which surfaces here as a rejection. That
  // isn't a real failure — releaseClaims() hands the row back and refunds the
  // attempt, so don't also charge it one via markFailed.
  if (stopping) return

  const message = errorMessage(error)
  // `attempts` was already incremented when the row was claimed.
  const exhausted = row.attempts >= row.max_attempts
  logger.error(
    `Demo request ${row.id} failed (attempt ${row.attempts}/${row.max_attempts}):`,
    message
  )

  try {
    await markFailed(row.id, message, exhausted)
  } catch (updateError) {
    // Losing the DB here means the row stays 'processing' until the reaper
    // notices. Log loudly rather than crashing the worker loop.
    logger.error(`Could not record failure for ${row.id}:`, updateError)
    return
  }

  if (exhausted) {
    await sendInternalAlert({
      subject: `[demo-setup] Demo request failed after ${row.max_attempts} attempts`,
      body: [
        `Company: ${row.company_name ?? '(not yet known)'}`,
        `Website: ${row.website_url}`,
        `Email: ${row.email}`,
        `Request id: ${row.id}`,
        '',
        `Last error: ${message}`
      ].join('\n')
    })
  }
}

const tick = async (): Promise<void> => {
  if (stopping) return

  if (ticks++ % REAP_EVERY_N_TICKS === 0) {
    try {
      const reaped = await reapStale()
      if (reaped.length > 0) {
        logger.warn(`Reaped ${reaped.length} stale demo request(s)`)
      }
    } catch (error) {
      logger.error('Reap failed:', error)
    }
  }

  const free = env.queueConcurrency - inFlight.size
  if (free <= 0) return

  let rows: DemoRequestRow[]
  try {
    rows = await claimPending(WORKER_ID, free)
  } catch (error) {
    // Transient Supabase blip. Next tick tries again.
    logger.error('Claim failed:', error)
    return
  }

  for (const row of rows) {
    inFlight.add(row.id)
    logger.info(
      `Claimed demo request ${row.id} for ${row.company_name ?? row.website_url}`
    )

    // Not awaited: the loop must stay free to fill the other concurrency slots.
    // Nothing may escape this IIFE — an unhandled rejection would kill the
    // process and strand every other in-flight row.
    void (async () => {
      try {
        await processRequest(row)
      } catch (error) {
        try {
          await handleFailure(row, error)
        } catch (failureError) {
          logger.error(`Failure handling threw for ${row.id}:`, failureError)
        }
      } finally {
        inFlight.delete(row.id)
      }
    })()
  }
}

/* Polls demo_requests, claims what it can hold, and runs each to completion.
 *
 * Runs in the same process as the Express app — pm2 already supervises it, and
 * the pipeline shells out to Python on this machine anyway. */
export const startWorker = (): void => {
  if (!env.queueEnabled) {
    logger.info('Demo request queue disabled (DEMO_QUEUE_ENABLED=false)')
    return
  }

  // The reaper must not be able to steal a row from a worker that is merely
  // slow. Worst case a job takes scrape + crawl plus the LLM calls between them
  // (analyze-content, detect-brand) — those aren't individually bounded by a
  // timeout, so budget a fixed allowance for them rather than ignoring them.
  const LLM_CALL_BUDGET_MS = 5 * 60 * 1000
  const worstCaseMs =
    env.scrapeTimeoutMs + env.crawlTimeoutMs + LLM_CALL_BUDGET_MS
  if (env.queueStaleMinutes * 60_000 <= worstCaseMs) {
    throw new Error(
      `DEMO_STALE_MINUTES (${env.queueStaleMinutes}m) must exceed SCRAPE_TIMEOUT_MS + CRAWL_TIMEOUT_MS + ` +
        `${LLM_CALL_BUDGET_MS / 60_000}m LLM budget (${Math.ceil(worstCaseMs / 60_000)}m), or the reaper ` +
        `will reclaim rows a healthy worker still holds.`
    )
  }

  logger.info(
    `Demo request worker ${WORKER_ID} polling every ${env.queuePollIntervalMs}ms, concurrency ${env.queueConcurrency}`
  )

  const schedule = () => {
    timer = setTimeout(async () => {
      await tick()
      if (!stopping) schedule()
    }, env.queuePollIntervalMs)
  }
  schedule()
}

/* Stops claiming, kills in-flight crawls, and hands their rows back so another
 * process (or this one after restart) picks them up immediately. */
export const stopWorker = async (): Promise<void> => {
  if (stopping) return
  stopping = true
  if (timer) clearTimeout(timer)

  killActiveCrawls()

  const held = [...inFlight]
  if (held.length === 0) return

  logger.info(`Releasing ${held.length} in-flight demo request(s)`)
  try {
    await releaseClaims(held)
  } catch (error) {
    // The reaper will recover these after DEMO_STALE_MINUTES.
    logger.error('Failed to release claims on shutdown:', error)
  }
}
