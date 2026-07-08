/* The "demo ready" email used to live entirely as a SendGrid dynamic template
 * (d-75e4a3c87e304f638c01730516bc9396), which only ever received `company_id`
 * and built both the primary and secondary demo links itself — a second link
 * to a widget variant nothing else in this codebase ever decided between.
 * Now that detectBrand picks a single theme per demo (see pickTheme in
 * detect-brand.ts), there's exactly one link to send, and keeping the markup
 * here means it's readable, diffable, and testable like the rest of the
 * pipeline instead of being an opaque reference to an ID in SendGrid's UI. */

const escapeHtml = (value: string): string =>
  value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')

export const DEMO_READY_SUBJECT = 'Your Personalized Demo is Ready!'

export const renderDemoReadyEmail = ({ demoUrl }: { demoUrl: string }): { html: string; text: string } => {
  const safeUrl = escapeHtml(demoUrl)
  const displayUrl = demoUrl.replace(/^https?:\/\//, '')

  const html = `<div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; color: #222;">
  <h2 style="color: #465cff; margin-bottom: 20px;">Your Personalized Demo is Ready!</h2>

  <p style="margin-bottom: 15px;">Thank you for your interest in <strong>Untap AI!</strong> We've prepared your personalized AI assistant demo as requested.</p>

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

  const text = `Thank you for your interest in Untap AI! We've prepared your personalized AI assistant demo as requested.

Your live demo: ${demoUrl}

The AI assistant is trained on your website and acts as your instant customer support rep, ready to answer questions and capture inbound leads.

If you'd like a walkthrough, have questions, or want to talk about next steps, just reply to this email. Our team (cc'd) can quickly hop on a call or customize the solution further for your needs.

Thanks again for considering Untap AI.
The Untap AI Team

Questions? Reply to this email or contact us at contact@untap-ai.com`

  return { html, text }
}

/* Sent the moment a request is claimed off the queue — before the site's even
 * scraped, let alone branded — so a prospect isn't left wondering whether
 * their submission went anywhere during the ~30 minute build. */
export const DEMO_PENDING_SUBJECT = 'Your Personalized Demo is Being Created'

export const renderDemoPendingEmail = ({ companyName }: { companyName: string }): { html: string; text: string } => {
  const safeName = escapeHtml(companyName)

  const html = `<div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
  <h2 style="color: #465cff; margin-bottom: 20px;">Your Personalized Demo is Being Created</h2>

  <p style="margin-bottom: 15px;">Hi there!</p>

  <p style="margin-bottom: 15px;">We've received your request for a personalized demo for <strong>${safeName}</strong>.</p>

  <p style="margin-bottom: 15px;">Our team is now training your AI assistant on your website's content and styling it to match your brand. This usually takes about <strong>30 minutes</strong>.</p>

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

We've received your request for a personalized demo for ${companyName}.

Our team is now training your AI assistant on your website's content and styling it to match your brand. This usually takes about 30 minutes.

You'll receive another email with your private demo link once it's ready.

In the meantime, feel free to explore our pricing plans (https://untap-ai.com/pricing) or reach out with any questions.

Best regards,
The Untap AI Team

Questions? Reply to this email or contact us at contact@untap-ai.com`

  return { html, text }
}
