import { randomBytes } from 'node:crypto'

// Leaves room for the "demo-" prefix and "-xxxxxxxx" suffix inside chat_configs'
// and demo_requests' 100-char company_id limit.
const MAX_SLUG_BODY = 40

// Latin letters that NFKD leaves alone because they're distinct letters rather
// than a base plus a combining mark. Without these, "Ø" becomes "-", not "o".
const LATIN_FOLD: Record<string, string> = {
  ø: 'o',
  æ: 'ae',
  œ: 'oe',
  ð: 'd',
  þ: 'th',
  ł: 'l',
  đ: 'd',
  ß: 'ss'
}

/* Derives the company id for a demo request.
 *
 * Two things depend on the exact output: it is the S3 key prefix the demo is
 * uploaded under, and it is the only variable the "demo ready" SendGrid template
 * receives — the template builds demo.untap-ai.com/{{company_id}}/ from it. A
 * change here is a change to the link the prospect clicks.
 *
 * The "demo-" prefix keeps generated demos in a namespace of their own. Without
 * it a prospect named "Acme" would slug to `acme` and the pipeline's upsert into
 * `companies` / `chat_configs` would silently overwrite a real customer's
 * system prompt and vector namespace.
 *
 * The random suffix means two prospects with the same company name never collide
 * (and no pre-flight SELECT is needed, so there's no check-then-insert race).
 * It is 4 bytes rather than 2 because a collision is not a retry — the second
 * demo would upsert over the first's chat_config and S3 objects, leaving the
 * first prospect's link serving someone else's company. */
export const deriveCompanyId = (companyName: string): string => {
  const body = companyName
    // Fold accents to ASCII first, so "Ünïcødé Çafé" slugs to "unicode-cafe"
    // rather than "n-c-d-af". The result is the URL the prospect clicks.
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[øæœðþłđß]/g, char => LATIN_FOLD[char])
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, MAX_SLUG_BODY)
    // Slicing mid-run can leave a trailing dash.
    .replace(/-+$/, '')

  const suffix = randomBytes(4).toString('hex')

  // Names with nothing ASCII-alphanumeric in them (e.g. all-CJK) slug to empty.
  return body ? `demo-${body}-${suffix}` : `demo-${suffix}`
}
