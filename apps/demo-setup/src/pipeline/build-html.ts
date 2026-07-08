import { env } from '../config/env'
import type { BrandResult, ContentAnalysis, PreparedInput } from '../types'

type WidgetConfig = Record<string, unknown>

const buildStyles = (input: PreparedInput, brand: BrandResult) => {
  const styles: Record<string, string> = {
    primaryColor: input.styles?.primaryColor || brand.brandColor,
    fontFamily: input.styles?.fontFamily || brand.fontFamily
  }
  if (input.styles?.secondaryColor)
    styles.secondaryColor = input.styles.secondaryColor
  if (input.styles?.backgroundColor)
    styles.backgroundColor = input.styles.backgroundColor
  return styles
}

const buildConfig = (
  input: PreparedInput,
  analysis: ContentAnalysis,
  brand: BrandResult,
  theme?: 'secondary'
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

  if (theme) config.theme = theme
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

const renderHtml = (config: WidgetConfig): string =>
  `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Dialogue Foundry Chat Playground</title>
  <script id="dialogue-foundry-config" type="application/json">
${escapeForInlineScript(JSON.stringify(config, undefined, 2))}
  </script>
</head>
<body>
  <div id="root"></div>
  <script type="module" src="${env.widgetScriptUrl}"></script>
</body>
</html>`

/* Builds the primary and secondary widget landing pages. Unlike the n8n "Build
 * HTML" node (which string-templated raw JSON and was fragile), this builds a
 * real config object and serializes it, so escaping is always correct. */
export const buildHtml = (
  input: PreparedInput,
  analysis: ContentAnalysis,
  brand: BrandResult
): { primary: string; secondary: string } => ({
  primary: renderHtml(buildConfig(input, analysis, brand)),
  secondary: renderHtml(buildConfig(input, analysis, brand, 'secondary'))
})
