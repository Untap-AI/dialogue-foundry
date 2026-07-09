import { randomBytes } from 'node:crypto'

// Leaves room for the "demo-" prefix and "-xxxxxxxx" suffix inside chat_configs'
// and demo_requests' 100-char company_id limit.
const MAX_SLUG_BODY = 40

/* Extracts the registrable label from a website URL for slugging/display —
 * "https://www.acme-roofing.com/path" -> "acme-roofing". Falls back to
 * undefined for anything that isn't a parseable URL, rather than throwing:
 * the caller has its own fallback for that case, and the pipeline's own URL
 * validation (assertSafeUrl) is what should surface a real error to the
 * prospect. */
const hostnameLabel = (websiteUrl: string): string | undefined => {
  try {
    const withProtocol = /^https?:\/\//i.test(websiteUrl)
      ? websiteUrl
      : `https://${websiteUrl}`
    const host = new URL(withProtocol).hostname.replace(/^www\./i, '')
    // Strip the TLD (last dot-segment) so "acme-roofing.com" -> "acme-roofing"
    // rather than "acme-roofing-com".
    const label = host.includes('.')
      ? host.slice(0, host.lastIndexOf('.'))
      : host
    return label || undefined
  } catch {
    return undefined
  }
}

/* Derives the company id for a demo request from its website URL.
 *
 * Two things depend on the exact output: it is the S3 key prefix the demo is
 * uploaded under, and it is the only variable the "demo ready" SendGrid template
 * receives — the template builds demo.untap-ai.com/{{company_id}}/ from it. A
 * change here is a change to the link the prospect clicks.
 *
 * Derived from the URL rather than the company name because it has to exist
 * before anything is scraped — the prospect no longer supplies a name up
 * front, and the slug is needed immediately on claim (S3 prefix, Upstash
 * namespace) well before the pipeline gets around to inferring one.
 *
 * The "demo-" prefix keeps generated demos in a namespace of their own. Without
 * it a site at "acme.com" would slug to `acme` and the pipeline's upsert into
 * `companies` / `chat_configs` would silently overwrite a real customer's
 * system prompt and vector namespace.
 *
 * The random suffix means two prospects on the same domain (or a retry with a
 * fresh URL) never collide (and no pre-flight SELECT is needed, so there's no
 * check-then-insert race). It is 4 bytes rather than 2 because a collision is
 * not a retry — the second demo would upsert over the first's chat_config and
 * S3 objects, leaving the first prospect's link serving someone else's company. */
export const deriveCompanyId = (websiteUrl: string): string => {
  const label = hostnameLabel(websiteUrl)
  const body = (label ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, MAX_SLUG_BODY)
    // Slicing mid-run can leave a trailing dash.
    .replace(/-+$/, '')

  const suffix = randomBytes(4).toString('hex')

  // Unparseable URLs, or hosts with nothing ASCII-alphanumeric in them, slug
  // to empty.
  return body ? `demo-${body}-${suffix}` : `demo-${suffix}`
}

/* Title-cases a hostname label for use as a last-resort company name when
 * neither the content analysis nor the brand probe turned one up —
 * "acme-roofing" -> "Acme Roofing". */
export const titleCaseFromHostname = (websiteUrl: string): string => {
  const label = hostnameLabel(websiteUrl)
  if (!label) return 'Your Company'

  return label
    .replace(/[-_]+/g, ' ')
    .trim()
    .replace(/\b\w/g, character => character.toUpperCase())
}
