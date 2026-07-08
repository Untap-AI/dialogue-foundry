import sgMail from '@sendgrid/mail'
import { env } from '../config/env'
import { logger } from '../lib/logger'

/* Ported verbatim from the SendGrid node of the n8n workflow this service
 * replaces. The template renders the demo link itself from company_id, so
 * company_id is the only dynamic field it needs. */
const DEMO_READY_TEMPLATE_ID = 'd-75e4a3c87e304f638c01730516bc9396'
const FROM = { email: 'demo@untap-ai.com', name: 'Untap AI' } as const
const INTERNAL_CC = [
  { email: 'james@untap-ai.com' },
  { email: 'peyton@untap-ai.com' }
]

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
  companyId
}: {
  to: string
  companyId: string
}): Promise<boolean> => {
  const mail = client()
  if (!mail) {
    logger.warn(
      `SENDGRID_API_KEY unset — skipping demo-ready email to ${to} for ${companyId}`
    )
    return false
  }

  try {
    await mail.send({
      personalizations: [
        {
          to: [{ email: to }],
          cc: INTERNAL_CC,
          dynamicTemplateData: { company_id: companyId }
        }
      ],
      from: FROM,
      templateId: DEMO_READY_TEMPLATE_ID
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
