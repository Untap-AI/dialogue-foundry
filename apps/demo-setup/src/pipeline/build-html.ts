import { env } from '../config/env'
import type { BrandResult, ContentAnalysis, PreparedInput } from '../types'

export type WidgetConfig = Record<string, unknown>

const buildStyles = (input: PreparedInput, brand: BrandResult) => {
  const styles: Record<string, string> = {
    primaryColor: input.styles?.primaryColor || brand.brandColor,
    fontFamily: input.styles?.fontFamily || brand.fontFamily
  }
  const secondaryColor = input.styles?.secondaryColor || brand.secondaryColor
  if (secondaryColor) styles.secondaryColor = secondaryColor
  if (input.styles?.backgroundColor)
    styles.backgroundColor = input.styles.backgroundColor
  return styles
}

const buildConfig = (
  input: PreparedInput,
  analysis: ContentAnalysis,
  brand: BrandResult
): WidgetConfig => {
  const logoUrl = input.logoUrl || brand.logoUrl
  const config: WidgetConfig = {
    chatConfig: {
      apiBaseUrl: env.apiBaseUrl(input.isProd),
      companyId: input.companyId
    },
    popupMessage: input.popupMessage || 'Have questions? Click here for help!',
    openOnLoad: 'desktop-only',
    poweredBy: { show: false },
    welcomeMessage: analysis.welcomeMessage,
    suggestions: analysis.suggestions,
    styles: buildStyles(input, brand)
  }

  // A logo takes precedence; otherwise fall back to a text title.
  if (logoUrl && logoUrl.trim()) {
    config.logoUrl = logoUrl
  } else {
    config.title = input.title || input.companyName
    config.logoUrl = ''
  }

  // 'primary' is the widget's own default theme — only set it explicitly for
  // 'secondary', same as the config always did.
  if (brand.theme === 'secondary') config.theme = 'secondary'
  return config
}

const LINE_SEPARATOR = String.fromCharCode(0x2028)
const PARAGRAPH_SEPARATOR = String.fromCharCode(0x2029)

/* Config values (welcomeMessage, suggestions, company name) come from an LLM
 * reading untrusted scraped web content, so a page could contain a sequence
 * that breaks out of the inline <script> block. Escape script-terminating
 * sequences after serializing so the JSON payload can never close the tag or
 * be misparsed as HTML (U+2028/2029 are valid in JSON but invalid in JS).
 * Uses split/join instead of regex so the unicode separators don't have to
 * appear as literal characters in source. */
const escapeForInlineScript = (json: string): string =>
  json
    .split('<')
    .join('\\u003c')
    .split('-->')
    .join('--\\u003e')
    .split(LINE_SEPARATOR)
    .join('\\u2028')
    .split(PARAGRAPH_SEPARATOR)
    .join('\\u2029')

// fontLinkHref is built by google-fonts.ts via encodeURIComponent, so it's
// already safe to embed directly in an href attribute.
const renderFontLinks = (fontLinkHref: string | null): string =>
  fontLinkHref
    ? `
  <link rel="preconnect" href="https://fonts.googleapis.com" />
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
  <link rel="stylesheet" href="${fontLinkHref}" />`
    : ''

// companyName reaches here from an LLM reading scraped web content, so it can't
// be trusted into markup unescaped.
const escapeHtml = (value: string): string =>
  value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')

/* The demo page is otherwise an empty page hosting a chat widget: a prospect who
 * comes back to it later has no way to say yes without digging up our email.
 * This is the only conversion path on the page itself, so it stays visible
 * rather than being another thing to click open. Deliberately styled in Untap's
 * own colors, not the prospect's brand — it's us talking, not their site. */
const renderCta = (companyName: string | undefined): string => {
  const site = companyName ? escapeHtml(companyName) : 'your site'

  return `  <footer class="untap-cta">
    <div class="untap-cta__text">
      <strong>This assistant was built for ${site} by Untap AI.</strong>
      <span>Put it on your real site and it answers questions and captures leads around the clock.</span>
    </div>
    <div class="untap-cta__actions">
      <a class="untap-cta__button" href="${env.demoCtaUrl}">Get this on my site</a>
      <a class="untap-cta__link" href="mailto:${env.demoCtaEmail}">Talk to us</a>
    </div>
  </footer>`
}

const CTA_STYLES = `    :root { color-scheme: light dark; }
    body { margin: 0; min-height: 100vh; display: flex; flex-direction: column; }
    #root { flex: 1 0 auto; }
    .untap-cta {
      flex-shrink: 0;
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      justify-content: space-between;
      gap: 16px 24px;
      /* Extra right padding keeps the actions clear of the widget's floating
       * launcher, which is fixed to the bottom-right corner and would otherwise
       * sit on top of them. */
      padding: 20px 96px 20px 24px;
      background: #0f1222;
      color: #ffffff;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Arial, sans-serif;
    }
    .untap-cta__text { display: flex; flex-direction: column; gap: 4px; }
    .untap-cta__text strong { font-size: 15px; font-weight: 600; }
    .untap-cta__text span { font-size: 14px; color: #b6bad0; }
    .untap-cta__actions { display: flex; align-items: center; gap: 16px; }
    .untap-cta__button {
      background: #465cff;
      color: #ffffff;
      padding: 10px 18px;
      border-radius: 8px;
      font-size: 14px;
      font-weight: 600;
      text-decoration: none;
      white-space: nowrap;
    }
    .untap-cta__button:hover { background: #3549e0; }
    .untap-cta__link { color: #b6bad0; font-size: 14px; text-decoration: none; white-space: nowrap; }
    .untap-cta__link:hover { color: #ffffff; }`

const renderHtml = (
  config: WidgetConfig,
  fontLinkHref: string | null,
  companyName: string | undefined
): string =>
  `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Dialogue Foundry Chat Playground</title>${renderFontLinks(fontLinkHref)}
  <style>
${CTA_STYLES}
  </style>
  <script id="dialogue-foundry-config" type="application/json">
${escapeForInlineScript(JSON.stringify(config, undefined, 2))}
  </script>
</head>
<body>
  <div id="root"></div>
${renderCta(companyName)}
  <script type="module" src="${env.widgetScriptUrl}"></script>
</body>
</html>`

/* Builds the widget landing page in whichever theme detectBrand picked for
 * this logo/color combination. Unlike the n8n "Build HTML" node (which
 * string-templated raw JSON and was fragile), this builds a real config
 * object and serializes it, so escaping is always correct.
 *
 * Returns the config alongside the html so the caller can also persist it to
 * widget_configs -- the same object that's baked into the page is what backs
 * the company's widget-config API response going forward. */
export const buildHtml = (
  input: PreparedInput,
  analysis: ContentAnalysis,
  brand: BrandResult
): { config: WidgetConfig; html: string } => {
  const config = buildConfig(input, analysis, brand)
  return {
    config,
    html: renderHtml(config, brand.fontLinkHref, input.companyName)
  }
}
