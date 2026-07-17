import { env } from '../config/env'
import { logger } from '../lib/logger'
import { titleCaseFromHostname } from '../lib/slug'
import {
  sendTrialOfferEmail,
  sendTrialNudgeEmail,
  sendTrialStartedEmail,
  sendTrialEndingEmail,
  sendInternalAlert
} from '../integrations/sendgrid'
import {
  backfillFunnelRows,
  getRowsByStage,
  getInstallDomain,
  hasProspectEngagement,
  countChatsSince,
  claimEngagement,
  claimTrialOffer,
  claimNudge,
  claimTrialStarted,
  claimTrialEnding,
  markExpired
} from './repo'
import type { FunnelRow } from '../types'

let stopping = false
let timer: NodeJS.Timeout | undefined

const DAY_MS = 24 * 60 * 60 * 1000

const displayName = (row: FunnelRow): string =>
  row.company_name?.trim() || titleCaseFromHostname(row.website_url)

const formatDate = (iso: string): string =>
  new Date(iso).toLocaleDateString('en-US', {
    month: 'long',
    day: 'numeric',
    year: 'numeric'
  })

const buildInstallUrl = (
  companyId: string,
  platform: string | null,
  campaign: string
): string => {
  const base = platform
    ? `${env.installBaseUrl}/${platform}`
    : env.installBaseUrl
  const params = new URLSearchParams({
    companyId,
    utm_source: 'lifecycle',
    utm_medium: 'email',
    utm_campaign: campaign
  })
  return `${base}?${params.toString()}`
}

/* Any pre-trial row whose widget has beaconed from a real domain jumps straight
 * to trial_started — including a prospect who installed without ever chatting. */
const processInstalls = async (): Promise<void> => {
  const rows = await getRowsByStage(['demo_sent', 'trial_offered', 'nudged'])
  for (const row of rows) {
    try {
      const domain = await getInstallDomain(row.company_id)
      if (!domain) continue

      const trialEndsAt = new Date(
        Date.now() + env.trialLengthDays * DAY_MS
      ).toISOString()
      const claimed = await claimTrialStarted(row.id, domain, trialEndsAt)
      if (!claimed) continue

      await sendTrialStartedEmail({
        to: row.email,
        companyId: row.company_id,
        companyName: displayName(row),
        domain,
        trialEndDate: formatDate(trialEndsAt)
      })
      // Always alert internally: the team needs to know a widget went live (for
      // the concierge promise and general awareness), regardless of the email.
      await sendInternalAlert({
        subject: `[funnel] Widget live: ${displayName(row)} on ${domain}`,
        body: `${displayName(row)} (${row.company_id}) installed the widget on ${domain}. 14-day trial started, ends ${formatDate(trialEndsAt)}.`
      })
      logger.info(`Funnel: ${row.company_id} -> trial_started (${domain})`)
    } catch (error) {
      logger.error(`Funnel install check failed for ${row.company_id}:`, error)
    }
  }
}

/* First prospect chat on the demo -> trial offer, in two phases so the founder
 * note reads as a human reply rather than an instant auto-response:
 *   1. detect engagement and timestamp it (first_engaged_at)
 *   2. once TRIAL_OFFER_DELAY_MINUTES has passed, send the offer as a reply on
 *      the demo-ready email thread. */
const processEngagement = async (): Promise<void> => {
  const rows = await getRowsByStage(['demo_sent'])
  const offerCutoff = Date.now() - env.trialOfferDelayMinutes * 60 * 1000
  for (const row of rows) {
    try {
      // Phase 1: not yet marked engaged. Detect and record the time; don't send.
      if (!row.first_engaged_at) {
        const engaged = await hasProspectEngagement(
          row.company_id,
          row.demo_completed_at,
          env.funnelTeamIps
        )
        if (engaged) {
          await claimEngagement(row.id)
          logger.info(
            `Funnel: ${row.company_id} engaged (offer in ~${env.trialOfferDelayMinutes}m)`
          )
        }
        continue
      }

      // Phase 2: engaged earlier. Hold until the delay has elapsed, then send.
      if (new Date(row.first_engaged_at).getTime() > offerCutoff) continue

      const claimed = await claimTrialOffer(row.id)
      if (!claimed) continue

      await sendTrialOfferEmail({
        to: row.email,
        companyId: row.company_id,
        companyName: displayName(row),
        installUrl: buildInstallUrl(
          row.company_id,
          row.platform,
          'trial_offer'
        ),
        inReplyToMessageId: row.demo_ready_message_id ?? undefined
      })
      logger.info(`Funnel: ${row.company_id} -> trial_offered`)
    } catch (error) {
      logger.error(
        `Funnel engagement check failed for ${row.company_id}:`,
        error
      )
    }
  }
}

/* No install after NUDGE_AFTER_DAYS, and no concierge request open -> one nudge. */
const processNudges = async (): Promise<void> => {
  const rows = await getRowsByStage(['trial_offered'])
  const cutoff = Date.now() - env.nudgeAfterDays * DAY_MS
  for (const row of rows) {
    try {
      if (row.concierge_requested_at) continue
      if (!row.trial_offer_sent_at) continue
      if (new Date(row.trial_offer_sent_at).getTime() > cutoff) continue

      const claimed = await claimNudge(row.id)
      if (!claimed) continue

      await sendTrialNudgeEmail({
        to: row.email,
        companyId: row.company_id,
        companyName: displayName(row),
        installUrl: buildInstallUrl(row.company_id, row.platform, 'trial_nudge')
      })
      logger.info(`Funnel: ${row.company_id} -> nudged`)
    } catch (error) {
      logger.error(`Funnel nudge failed for ${row.company_id}:`, error)
    }
  }
}

/* Within TRIAL_ENDING_LEAD_DAYS of the trial end -> countdown email with stats. */
const processTrialEnding = async (): Promise<void> => {
  const rows = await getRowsByStage(['trial_started'])
  const threshold = Date.now() + env.trialEndingLeadDays * DAY_MS
  for (const row of rows) {
    try {
      if (!row.trial_ends_at || !row.trial_started_at) continue
      if (new Date(row.trial_ends_at).getTime() > threshold) continue

      const claimed = await claimTrialEnding(row.id)
      if (!claimed) continue

      const chatCount = await countChatsSince(
        row.company_id,
        row.trial_started_at
      )
      await sendTrialEndingEmail({
        to: row.email,
        companyId: row.company_id,
        companyName: displayName(row),
        trialEndDate: formatDate(row.trial_ends_at),
        chatCount,
        pricingUrl: env.demoCtaUrl
      })
      logger.info(`Funnel: ${row.company_id} -> trial_ending`)
    } catch (error) {
      logger.error(`Funnel trial-ending failed for ${row.company_id}:`, error)
    }
  }
}

/* Past the trial end -> mark expired and alert. No customer email and no widget
 * change: conversion is a human conversation for now. */
const processExpiry = async (): Promise<void> => {
  const rows = await getRowsByStage(['trial_started', 'trial_ending'])
  const now = Date.now()
  for (const row of rows) {
    try {
      if (!row.trial_ends_at) continue
      if (new Date(row.trial_ends_at).getTime() > now) continue

      const expired = await markExpired(row.id)
      if (!expired) continue

      await sendInternalAlert({
        subject: `[funnel] Trial expired: ${displayName(row)}`,
        body: `${displayName(row)} (${row.company_id}) reached the end of its trial (${row.install_domain ?? 'unknown domain'}). The widget is still running. Follow up about converting.`
      })
      logger.info(`Funnel: ${row.company_id} -> expired`)
    } catch (error) {
      logger.error(`Funnel expiry failed for ${row.company_id}:`, error)
    }
  }
}

const tick = async (): Promise<void> => {
  if (stopping) return

  // Each step is independent; one failing must not skip the others.
  const steps: Array<[string, () => Promise<unknown>]> = [
    ['backfill', () => backfillFunnelRows(env.funnelBackfillSince)],
    ['installs', processInstalls],
    ['engagement', processEngagement],
    ['nudges', processNudges],
    ['trial-ending', processTrialEnding],
    ['expiry', processExpiry]
  ]
  for (const [label, run] of steps) {
    if (stopping) return
    try {
      await run()
    } catch (error) {
      logger.error(`Funnel step "${label}" failed:`, error)
    }
  }
}

/* Post-demo lifecycle poller. Runs in the same process as the build worker,
 * under the same pm2 supervision. Single instance (instances: 1 in
 * ecosystem.config.cjs), so no cross-process claim locking is needed — but every
 * send still claims its milestone atomically, so a restart mid-tick can't double
 * send. */
export const startFunnelPoller = (): void => {
  if (!env.funnelEnabled) {
    logger.info('Conversion funnel disabled (FUNNEL_ENABLED not true)')
    return
  }

  logger.info(
    `Funnel poller running every ${env.funnelPollIntervalMs}ms (backfill since ${env.funnelBackfillSince})`
  )

  const schedule = () => {
    timer = setTimeout(async () => {
      await tick()
      if (!stopping) schedule()
    }, env.funnelPollIntervalMs)
  }
  schedule()
}

export const stopFunnelPoller = (): void => {
  stopping = true
  if (timer) clearTimeout(timer)
}
