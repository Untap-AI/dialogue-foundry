import { logger } from '../lib/logger'

/* Google Fonts serves modern woff2 @font-face rules only to a browser-like
 * User-Agent; without one it falls back to old formats we don't want. An
 * unknown family still returns 200 with an empty stylesheet rather than a
 * 404, so "does the response actually contain a @font-face rule" is the only
 * reliable signal that the family exists in Google's catalog. */
const MODERN_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36'

const FETCH_TIMEOUT_MS = 5000

/* Resolves the primary font in a CSS font-family stack to a loadable Google
 * Fonts stylesheet URL, or null if it isn't (or can't be confirmed to be) a
 * real Google Fonts family. Queries Google directly rather than maintaining a
 * static catalog — their catalog changes over time and a stale local list
 * would silently stop matching new/renamed families. */
export const resolveGoogleFontLink = async (fontFamily: string): Promise<string | null> => {
  const primary = fontFamily.split(',')[0]?.trim().replace(/^["']|["']$/g, '')
  if (!primary) return null

  const href = `https://fonts.googleapis.com/css2?family=${encodeURIComponent(primary)}:wght@400;500;600;700&display=swap`

  try {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS)
    const response = await fetch(href, {
      headers: { 'User-Agent': MODERN_UA },
      signal: controller.signal
    }).finally(() => clearTimeout(timeout))

    if (!response.ok) return null
    const css = await response.text()
    return css.includes('@font-face') ? href : null
  } catch (error) {
    logger.warn(`[fonts] Google Fonts lookup failed for "${primary}": ${error}`)
    return null
  }
}
