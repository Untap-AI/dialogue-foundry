/* The "demo ready" email used to live entirely as a SendGrid dynamic template
 * (d-75e4a3c87e304f638c01730516bc9396), which only ever received `company_id`
 * and built both the primary and secondary demo links itself (a second link to
 * a widget variant nothing else in this codebase ever decided between). Now that
 * detectBrand picks a single theme per demo (see pickTheme in detect-brand.ts),
 * there's exactly one link to send, and keeping the markup here means it's
 * readable, diffable, and testable like the rest of the pipeline instead of
 * being an opaque reference to an ID in SendGrid's UI. */

const escapeHtml = (value: string): string =>
  value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')

export const DEMO_READY_SUBJECT = 'Your Personalized Demo is Ready!'

export const renderDemoReadyEmail = ({
  demoUrl,
  companyName
}: {
  demoUrl: string
  companyName: string
}): { html: string; text: string } => {
  const safeUrl = escapeHtml(demoUrl)
  const displayUrl = demoUrl.replace(/^https?:\/\//, '')
  const safeName = escapeHtml(companyName)

  const html = `<div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; color: #222;">
  <h2 style="color: #465cff; margin-bottom: 20px;">Your Personalized Demo is Ready!</h2>

  <p style="margin-bottom: 15px;">Thank you for your interest in <strong>Untap AI!</strong> We've prepared your personalized AI assistant demo for <strong>${safeName}</strong> as requested.</p>

  <p style="margin-bottom: 15px;">
    <strong>Your live demo:</strong><br>
    <a href="${safeUrl}" style="color: #465cff; text-decoration: none;">${escapeHtml(displayUrl)}</a>
  </p>

  <p style="margin-bottom: 15px;">The AI assistant is trained on your website and acts as your instant customer support rep, ready to answer questions and capture inbound leads.</p>

  <p style="margin-bottom: 15px;">If you'd like a walkthrough, have questions, or want to talk about next steps, just reply to this email. Our team (cc'd) can quickly hop on a call or customize the solution further for your needs.</p>

  <p style="margin-bottom: 20px;">
    Thanks again for considering Untap AI.<br>
    <strong>The Untap AI Team</strong>
  </p>

  <hr style="border: none; border-top: 1px solid #eee; margin: 30px 0;">

  <p style="color: #666; font-size: 14px; margin: 0;">
    Questions? Reply to this email or contact us at
    <a href="mailto:contact@untap-ai.com" style="color: #465cff; text-decoration: none;">contact@untap-ai.com</a>
  </p>
</div>`

  const text = `Thank you for your interest in Untap AI! We've prepared your personalized AI assistant demo for ${companyName} as requested.

Your live demo: ${demoUrl}

The AI assistant is trained on your website and acts as your instant customer support rep, ready to answer questions and capture inbound leads.

If you'd like a walkthrough, have questions, or want to talk about next steps, just reply to this email. Our team (cc'd) can quickly hop on a call or customize the solution further for your needs.

Thanks again for considering Untap AI.
The Untap AI Team

Questions? Reply to this email or contact us at contact@untap-ai.com`

  return { html, text }
}

/* Sent the moment a request is claimed off the queue, before the site's even
 * scraped or branded, so a prospect isn't left wondering whether their
 * submission went anywhere during the ~15 minute build. */
export const DEMO_PENDING_SUBJECT = 'Your Personalized Demo is Being Created'

export const renderDemoPendingEmail = ({
  websiteUrl
}: {
  websiteUrl: string
}): { html: string; text: string } => {
  const displayUrl = websiteUrl.replace(/^https?:\/\//, '')
  const safeDisplayUrl = escapeHtml(displayUrl)

  const html = `<div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
  <h2 style="color: #465cff; margin-bottom: 20px;">Your Personalized Demo is Being Created</h2>

  <p style="margin-bottom: 15px;">Hi there!</p>

  <p style="margin-bottom: 15px;">We've received your request for a personalized demo for <strong>${safeDisplayUrl}</strong>.</p>

  <p style="margin-bottom: 15px;">Our team is now training your AI assistant on your website's content and styling it to match your brand. This usually takes about <strong>15 minutes</strong>.</p>

  <p style="margin-bottom: 15px;">You'll receive another email with your private demo link once it's ready.</p>

  <p style="margin-bottom: 15px;">In the meantime, feel free to explore our <a href="https://untap-ai.com/pricing" style="color: #465cff; text-decoration: none;">pricing plans</a> or reach out with any questions.</p>

  <p style="margin-bottom: 20px;">
    Best regards,<br>
    The Untap AI Team
  </p>

  <hr style="border: none; border-top: 1px solid #eee; margin: 30px 0;">

  <p style="color: #666; font-size: 14px; margin: 0;">
    Questions? Reply to this email or contact us at
    <a href="mailto:contact@untap-ai.com" style="color: #465cff; text-decoration: none;">contact@untap-ai.com</a>
  </p>
</div>`

  const text = `Hi there!

We've received your request for a personalized demo for ${displayUrl}.

Our team is now training your AI assistant on your website's content and styling it to match your brand. This usually takes about 15 minutes.

You'll receive another email with your private demo link once it's ready.

In the meantime, feel free to explore our pricing plans (https://untap-ai.com/pricing) or reach out with any questions.

Best regards,
The Untap AI Team

Questions? Reply to this email or contact us at contact@untap-ai.com`

  return { html, text }
}

/* ---- Conversion funnel emails ----
 *
 * Sent by the funnel poller (src/funnel), not the build worker. The offer and
 * nudge are deliberately plain, founder-signed, and sent from a real person's
 * address so they read like a human noticed and reached out (first sales touches
 * convert better that way than branded HTML). The offer is also sent as a reply
 * on the original demo email thread (see sendgrid.ts). The trial-started and
 * trial-ending emails are branded milestone confirmations, not the pitch.
 * Install/pricing links are built by the caller so these stay pure. */

// A first name for the display name is enough personalization without risking a
// wrong or awkward company name in the greeting.
const founderSignoff = 'Peyton\nCo-founder, Untap AI'

export const TRIAL_OFFER_SUBJECT = (companyName: string): string =>
  `Want ${companyName}'s AI assistant on your real site?`

export const renderTrialOfferEmail = ({
  companyName,
  installUrl
}: {
  companyName: string
  installUrl: string
}): { html: string; text: string } => {
  const safeName = escapeHtml(companyName)
  const safeUrl = escapeHtml(installUrl)

  const html = `<div style="font-family: Arial, sans-serif; max-width: 560px; margin: 0 auto; padding: 20px; color: #222; font-size: 16px; line-height: 1.5;">
  <p>Hi, Peyton here, one of the founders of Untap AI.</p>

  <p>I saw the demo assistant we built for <strong>${safeName}</strong> is getting some use, so I wanted to offer you the real thing, free for two weeks. No credit card, nothing to sign.</p>

  <p>Getting it onto your site is quick. Most people are up and running in about 10 minutes, and you can pick your website platform for step-by-step instructions:</p>

  <p><a href="${safeUrl}" style="color: #465cff; font-weight: bold;">Put it on my site</a></p>

  <p>Or if you'd rather not touch any code, there's an "Install it for me" button on that page and we'll handle it for you within one business day.</p>

  <p>Your trial only starts once the assistant is live, so there's no clock running while you decide.</p>

  <p style="white-space: pre-line;">${founderSignoff}</p>
</div>`

  const text = `Hi, Peyton here, one of the founders of Untap AI.

I saw the demo assistant we built for ${companyName} is getting some use, so I wanted to offer you the real thing, free for two weeks. No credit card, nothing to sign.

Getting it onto your site is quick. Most people are up and running in about 10 minutes, and you can pick your website platform for step-by-step instructions:

Put it on my site: ${installUrl}

Or if you'd rather not touch any code, there's an "Install it for me" button on that page and we'll handle it for you within one business day.

Your trial only starts once the assistant is live, so there's no clock running while you decide.

${founderSignoff}`

  return { html, text }
}

export const TRIAL_NUDGE_SUBJECT = 'It takes about 10 minutes to go live'

export const renderTrialNudgeEmail = ({
  companyName,
  installUrl
}: {
  companyName: string
  installUrl: string
}): { html: string; text: string } => {
  const safeName = escapeHtml(companyName)
  const safeUrl = escapeHtml(installUrl)

  const html = `<div style="font-family: Arial, sans-serif; max-width: 560px; margin: 0 auto; padding: 20px; color: #222; font-size: 16px; line-height: 1.5;">
  <p>Hi again, just following up on getting <strong>${safeName}</strong>'s AI assistant live.</p>

  <p>The two-week free trial is still open, and getting set up is genuinely quick. Most people are done in about 10 minutes, and there's a step-by-step guide for your platform:</p>

  <p><a href="${safeUrl}" style="color: #465cff; font-weight: bold;">Put it on my site</a></p>

  <p>Honestly, the easiest option is to let us do it: click <strong>"Install it for me"</strong> on that page, and we'll add it for you within one business day. No call, no back and forth.</p>

  <p>Want me to just take care of it? Reply "yes" and I'll get it done.</p>

  <p style="white-space: pre-line;">${founderSignoff}</p>
</div>`

  const text = `Hi again, just following up on getting ${companyName}'s AI assistant live.

The two-week free trial is still open, and getting set up is genuinely quick. Most people are done in about 10 minutes, and there's a step-by-step guide for your platform:

Put it on my site: ${installUrl}

Honestly, the easiest option is to let us do it: click "Install it for me" on that page, and we'll add it for you within one business day. No call, no back and forth.

Want me to just take care of it? Reply "yes" and I'll get it done.

${founderSignoff}`

  return { html, text }
}

export const TRIAL_STARTED_SUBJECT = (domain: string): string =>
  `You're live on ${domain}, your free trial has started`

export const renderTrialStartedEmail = ({
  companyName,
  domain,
  trialEndDate
}: {
  companyName: string
  domain: string
  trialEndDate: string
}): { html: string; text: string } => {
  const safeName = escapeHtml(companyName)
  const safeDomain = escapeHtml(domain)
  const safeDate = escapeHtml(trialEndDate)

  const html = `<div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; color: #222;">
  <h2 style="color: #465cff; margin-bottom: 20px;">You're live! 🎉</h2>

  <p style="margin-bottom: 15px;">Your Untap AI assistant is now running on <strong>${safeDomain}</strong> and answering visitors for <strong>${safeName}</strong>.</p>

  <p style="margin-bottom: 15px;">Your two-week free trial has started and runs through <strong>${safeDate}</strong>. Nothing is charged, and you don't need to do anything else to keep it running during the trial.</p>

  <p style="margin-bottom: 15px;">Now that you're live, we'll keep an eye on how it's doing and share simple ways to turn more of your visitors into real conversations. Want to fine-tune what it says or tweak the styling? Just reply to this email and we'll help you get the most out of it.</p>

  <p style="margin-bottom: 20px;">
    Cheers,<br>
    <strong>The Untap AI Team</strong>
  </p>

  <hr style="border: none; border-top: 1px solid #eee; margin: 30px 0;">
  <p style="color: #666; font-size: 14px; margin: 0;">
    Questions? Reply to this email or contact us at
    <a href="mailto:contact@untap-ai.com" style="color: #465cff; text-decoration: none;">contact@untap-ai.com</a>
  </p>
</div>`

  const text = `You're live!

Your Untap AI assistant is now running on ${domain} and answering visitors for ${companyName}.

Your two-week free trial has started and runs through ${trialEndDate}. Nothing is charged, and you don't need to do anything else to keep it running during the trial.

Now that you're live, we'll keep an eye on how it's doing and share simple ways to turn more of your visitors into real conversations. Want to fine-tune what it says or tweak the styling? Just reply to this email and we'll help you get the most out of it.

Cheers,
The Untap AI Team

Questions? Reply to this email or contact us at contact@untap-ai.com`

  return { html, text }
}

export const TRIAL_ENDING_SUBJECT = (trialEndDate: string): string =>
  `Your Untap AI trial ends ${trialEndDate}`

export const renderTrialEndingEmail = ({
  companyName,
  trialEndDate,
  chatCount,
  pricingUrl
}: {
  companyName: string
  trialEndDate: string
  chatCount: number
  pricingUrl: string
}): { html: string; text: string } => {
  const safeName = escapeHtml(companyName)
  const safeDate = escapeHtml(trialEndDate)
  const safeUrl = escapeHtml(pricingUrl)

  // Only surface the stat when it's genuinely impressive; "0 conversations"
  // undercuts the pitch.
  const statLine =
    chatCount > 0
      ? `<p style="margin-bottom: 15px;">During your trial, your assistant handled <strong>${chatCount} conversation${chatCount === 1 ? '' : 's'}</strong> for ${safeName}. That's ${chatCount === 1 ? 'a visitor' : `${chatCount} visitors`} who got instant answers instead of leaving.</p>`
      : ''
  const statText =
    chatCount > 0
      ? `During your trial, your assistant handled ${chatCount} conversation${chatCount === 1 ? '' : 's'} for ${companyName}. That's ${chatCount === 1 ? 'a visitor' : `${chatCount} visitors`} who got instant answers instead of leaving.\n\n`
      : ''

  const html = `<div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; color: #222;">
  <h2 style="color: #465cff; margin-bottom: 20px;">Your free trial ends ${safeDate}</h2>

  <p style="margin-bottom: 15px;">Quick heads up, your Untap AI free trial wraps up on <strong>${safeDate}</strong>.</p>

  ${statLine}

  <p style="margin-bottom: 15px;">To keep your assistant answering visitors without interruption, pick a plan here:</p>

  <p style="margin-bottom: 15px;">
    <a href="${safeUrl}" style="background: #465cff; color: #fff; padding: 12px 20px; border-radius: 8px; text-decoration: none; font-weight: bold; display: inline-block;">Keep my assistant</a>
  </p>

  <p style="margin-bottom: 15px;">Questions about plans, or want to talk through what's working? Just reply, happy to help.</p>

  <p style="margin-bottom: 20px;">
    Thanks,<br>
    <strong>The Untap AI Team</strong>
  </p>

  <hr style="border: none; border-top: 1px solid #eee; margin: 30px 0;">
  <p style="color: #666; font-size: 14px; margin: 0;">
    Questions? Reply to this email or contact us at
    <a href="mailto:contact@untap-ai.com" style="color: #465cff; text-decoration: none;">contact@untap-ai.com</a>
  </p>
</div>`

  const text = `Your free trial ends ${trialEndDate}

Quick heads up, your Untap AI free trial wraps up on ${trialEndDate}.

${statText}To keep your assistant answering visitors without interruption, pick a plan here: ${pricingUrl}

Questions about plans, or want to talk through what's working? Just reply, happy to help.

Thanks,
The Untap AI Team

Questions? Reply to this email or contact us at contact@untap-ai.com`

  return { html, text }
}
