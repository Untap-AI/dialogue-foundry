/* Best-effort detection of the website platform from the scraped homepage HTML,
 * so the trial-offer email can deep-link straight to the matching install guide
 * (/install/<platform>). Pure string matching — no network, no LLM. Returns null
 * when nothing recognizable is found; the funnel falls back to the picker page.
 *
 * Slugs here must match the guide slugs in the marketing site's
 * src/config/installGuides.ts. */

type PlatformSignal = {
  platform: string
  patterns: RegExp[]
}

// Ordered by specificity: the first platform with a matching signature wins.
// Signatures are stable fingerprints these builders leave in served HTML
// (asset CDNs, generator meta tags, framework data attributes).
const SIGNALS: PlatformSignal[] = [
  { platform: 'shopify', patterns: [/cdn\.shopify\.com/i, /Shopify\.theme/i] },
  {
    platform: 'squarespace',
    patterns: [/static1\.squarespace\.com/i, /squarespace\.com/i, /Squarespace/]
  },
  {
    platform: 'wix',
    patterns: [/wixstatic\.com/i, /wix\.com/i, /_wixCssStates/]
  },
  {
    platform: 'webflow',
    patterns: [
      /data-wf-domain/i,
      /assets\.website-files\.com/i,
      /assets-global\.website-files\.com/i
    ]
  },
  { platform: 'framer', patterns: [/framerusercontent\.com/i, /framer\.com/i] },
  { platform: 'godaddy', patterns: [/wsimg\.com/i, /websites\.godaddy/i] },
  // WordPress last: wp-content/wp-includes are common, but a more specific
  // builder (e.g. a WP-hosted Shopify Buy Button) should win first.
  { platform: 'wordpress', patterns: [/wp-content/i, /wp-includes/i] }
]

export const detectPlatform = (
  html: string | undefined
): string | undefined => {
  if (!html) return undefined
  for (const { platform, patterns } of SIGNALS) {
    if (patterns.some(pattern => pattern.test(html))) {
      return platform
    }
  }
  return undefined
}
