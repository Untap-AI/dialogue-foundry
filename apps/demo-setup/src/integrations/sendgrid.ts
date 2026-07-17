import sgMail from '@sendgrid/mail'
import { env } from '../config/env'
import { logger } from '../lib/logger'
import {
  DEMO_PENDING_SUBJECT,
  DEMO_READY_SUBJECT,
  TRIAL_OFFER_SUBJECT,
  TRIAL_NUDGE_SUBJECT,
  TRIAL_STARTED_SUBJECT,
  TRIAL_ENDING_SUBJECT,
  renderDemoPendingEmail,
  renderDemoReadyEmail,
  renderTrialOfferEmail,
  renderTrialNudgeEmail,
  renderTrialStartedEmail,
  renderTrialEndingEmail
} from './email-templates'

const FROM = { email: 'demo@untap-ai.com', name: 'Untap AI' } as const
// Funnel sales touches send from a real person so replies land in a human inbox
// and the email reads like outreach, not automation.
const FROM_FOUNDER = {
  email: 'peyton@untap-ai.com',
  name: 'Peyton at Untap AI'
} as const
const INTERNAL_CC = [
  { email: 'james@untap-ai.com' },
  { email: 'peyton@untap-ai.com' }
]
// Founder emails come *from* Peyton, so only James needs the CC (no point
// CC'ing the sender).
const FOUNDER_CC = [{ email: 'james@untap-ai.com' }]

/* Deliberately not the backend's sendgrid-service: that module throws at import
 * when SENDGRID_API_KEY is unset and hardcodes a chat_configs lookup we don't
 * want here. Configure lazily instead, so the service still boots (and
 * `POST /demos` still works) without a mail key. */
let configured = false
const client = (): typeof sgMail | undefined => {
  const apiKey = env.sendgridApiKey()
  if (!apiKey) return undefined
  if (!configured) {
    sgMail.setApiKey(apiKey)
    configured = true
  }
  return sgMail
}

/* Tells the prospect their demo is ready. Sent only after the crawl has seeded
 * the RAG namespace — before that the widget is live but knows nothing.
 *
 * Never throws: a SendGrid outage must not fail a demo that was built fine. The
 * caller records the boolean so a missed email is visible in the queue row. */
export const sendDemoReadyEmail = async ({
  to,
  companyId,
  demoUrl,
  companyName,
  messageId
}: {
  to: string
  companyId: string
  demoUrl: string
  companyName: string
  // RFC Message-ID to stamp on this email so the funnel's trial-offer email can
  // reply on the same thread. Optional; threading is skipped when absent.
  messageId?: string
}): Promise<boolean> => {
  const mail = client()
  if (!mail) {
    logger.warn(
      `SENDGRID_API_KEY unset — skipping demo-ready email to ${to} for ${companyId}`
    )
    return false
  }

  const { html, text } = renderDemoReadyEmail({ demoUrl, companyName })

  try {
    await mail.send({
      to,
      cc: INTERNAL_CC,
      from: FROM,
      subject: DEMO_READY_SUBJECT,
      html,
      text,
      ...(messageId ? { headers: { 'Message-ID': messageId } } : {})
    })
    logger.info(`Demo-ready email sent to ${to} for ${companyId}`)
    return true
  } catch (error) {
    logger.error(`Failed to send demo-ready email for ${companyId}:`, error)
    // SendGrid puts the actionable detail (bad template id, unverified sender)
    // in the response body, not the Error message.
    const body = (error as { response?: { body?: unknown } }).response?.body
    if (body) logger.error('SendGrid response body:', JSON.stringify(body))
    return false
  }
}

/* Sent immediately on claiming a request — before scraping, branding, or
 * crawling have even started — so a prospect isn't left wondering whether
 * their submission went anywhere during the build. Not CC'd to the team;
 * it's a receipt, not a milestone worth their attention. Same never-throws
 * contract as sendDemoReadyEmail. */
export const sendDemoPendingEmail = async ({
  to,
  companyId,
  websiteUrl
}: {
  to: string
  companyId: string
  websiteUrl: string
}): Promise<boolean> => {
  const mail = client()
  if (!mail) {
    logger.warn(
      `SENDGRID_API_KEY unset — skipping demo-pending email to ${to} for ${companyId}`
    )
    return false
  }

  const { html, text } = renderDemoPendingEmail({ websiteUrl })

  try {
    await mail.send({
      to,
      from: FROM,
      subject: DEMO_PENDING_SUBJECT,
      html,
      text
    })
    logger.info(`Demo-pending email sent to ${to} for ${companyId}`)
    return true
  } catch (error) {
    logger.error(`Failed to send demo-pending email for ${companyId}:`, error)
    const body = (error as { response?: { body?: unknown } }).response?.body
    if (body) logger.error('SendGrid response body:', JSON.stringify(body))
    return false
  }
}

/* ---- Conversion funnel emails ----
 *
 * All four share the never-throws contract of the emails above: the funnel
 * poller records the boolean and alerts internally on a miss rather than
 * retrying (a retry would re-send to a prospect who may have already received
 * it). */

/* First real sales touch, sent when a prospect actually uses their demo. Founder
 * sender + CC team (a milestone worth their attention). */
export const sendTrialOfferEmail = async ({
  to,
  companyId,
  companyName,
  installUrl,
  inReplyToMessageId
}: {
  to: string
  companyId: string
  companyName: string
  installUrl: string
  // Message-ID of the demo-ready email. When present, the offer is sent as a
  // reply on that thread ("Re: ..." + In-Reply-To/References) so it lands right
  // under the demo the prospect already opened. Falls back to a standalone email.
  inReplyToMessageId?: string
}): Promise<boolean> => {
  const mail = client()
  if (!mail) {
    logger.warn(
      `SENDGRID_API_KEY unset — skipping trial-offer email to ${to} for ${companyId}`
    )
    return false
  }

  const { html, text } = renderTrialOfferEmail({ companyName, installUrl })

  const threaded = inReplyToMessageId
    ? {
        subject: `Re: ${DEMO_READY_SUBJECT}`,
        headers: {
          'In-Reply-To': inReplyToMessageId,
          References: inReplyToMessageId
        }
      }
    : { subject: TRIAL_OFFER_SUBJECT(companyName) }

  try {
    await mail.send({
      to,
      cc: FOUNDER_CC,
      from: FROM_FOUNDER,
      replyTo: FROM_FOUNDER,
      html,
      text,
      ...threaded
    })
    logger.info(`Trial-offer email sent to ${to} for ${companyId}`)
    return true
  } catch (error) {
    logger.error(`Failed to send trial-offer email for ${companyId}:`, error)
    const body = (error as { response?: { body?: unknown } }).response?.body
    if (body) logger.error('SendGrid response body:', JSON.stringify(body))
    return false
  }
}

/* Follow-up ~3 days later if they haven't installed. Founder sender, no CC —
 * it's a light nudge, not a milestone. */
export const sendTrialNudgeEmail = async ({
  to,
  companyId,
  companyName,
  installUrl
}: {
  to: string
  companyId: string
  companyName: string
  installUrl: string
}): Promise<boolean> => {
  const mail = client()
  if (!mail) {
    logger.warn(
      `SENDGRID_API_KEY unset — skipping trial-nudge email to ${to} for ${companyId}`
    )
    return false
  }

  const { html, text } = renderTrialNudgeEmail({ companyName, installUrl })

  try {
    await mail.send({
      to,
      from: FROM_FOUNDER,
      replyTo: FROM_FOUNDER,
      subject: TRIAL_NUDGE_SUBJECT,
      html,
      text
    })
    logger.info(`Trial-nudge email sent to ${to} for ${companyId}`)
    return true
  } catch (error) {
    logger.error(`Failed to send trial-nudge email for ${companyId}:`, error)
    const body = (error as { response?: { body?: unknown } }).response?.body
    if (body) logger.error('SendGrid response body:', JSON.stringify(body))
    return false
  }
}

/* Confirmation that the widget went live on the prospect's own domain — the
 * moment the trial starts. Branded sender, CC team. */
export const sendTrialStartedEmail = async ({
  to,
  companyId,
  companyName,
  domain,
  trialEndDate
}: {
  to: string
  companyId: string
  companyName: string
  domain: string
  trialEndDate: string
}): Promise<boolean> => {
  const mail = client()
  if (!mail) {
    logger.warn(
      `SENDGRID_API_KEY unset — skipping trial-started email to ${to} for ${companyId}`
    )
    return false
  }

  const { html, text } = renderTrialStartedEmail({
    companyName,
    domain,
    trialEndDate
  })

  try {
    await mail.send({
      to,
      cc: INTERNAL_CC,
      from: FROM,
      subject: TRIAL_STARTED_SUBJECT(domain),
      html,
      text
    })
    logger.info(`Trial-started email sent to ${to} for ${companyId}`)
    return true
  } catch (error) {
    logger.error(`Failed to send trial-started email for ${companyId}:`, error)
    const body = (error as { response?: { body?: unknown } }).response?.body
    if (body) logger.error('SendGrid response body:', JSON.stringify(body))
    return false
  }
}

/* Countdown near the end of the trial, with the prospect's own usage stat.
 * Branded sender. */
export const sendTrialEndingEmail = async ({
  to,
  companyId,
  companyName,
  trialEndDate,
  chatCount,
  pricingUrl
}: {
  to: string
  companyId: string
  companyName: string
  trialEndDate: string
  chatCount: number
  pricingUrl: string
}): Promise<boolean> => {
  const mail = client()
  if (!mail) {
    logger.warn(
      `SENDGRID_API_KEY unset — skipping trial-ending email to ${to} for ${companyId}`
    )
    return false
  }

  const { html, text } = renderTrialEndingEmail({
    companyName,
    trialEndDate,
    chatCount,
    pricingUrl
  })

  try {
    await mail.send({
      to,
      from: FROM,
      subject: TRIAL_ENDING_SUBJECT(trialEndDate),
      html,
      text
    })
    logger.info(`Trial-ending email sent to ${to} for ${companyId}`)
    return true
  } catch (error) {
    logger.error(`Failed to send trial-ending email for ${companyId}:`, error)
    const body = (error as { response?: { body?: unknown } }).response?.body
    if (body) logger.error('SendGrid response body:', JSON.stringify(body))
    return false
  }
}

/* Fires when a request exhausts its retries. The success path already CCs the
 * team via the template above, so this only covers failures. */
export const sendInternalAlert = async ({
  subject,
  body
}: {
  subject: string
  body: string
}): Promise<boolean> => {
  const mail = client()
  if (!mail) {
    logger.warn(`SENDGRID_API_KEY unset — skipping internal alert: ${subject}`)
    return false
  }

  try {
    await mail.send({
      to: env.demoAlertEmail,
      from: FROM,
      subject,
      text: body
    })
    return true
  } catch (error) {
    logger.error('Failed to send internal alert:', error)
    return false
  }
}
