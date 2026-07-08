import { contrastRatio, parseRgb, toHex, type Rgb } from '../lib/color'
import { logger } from '../lib/logger'
import type { BrandResult, ContentAnalysis, Suggestion } from '../types'

const isValidHttpUrl = (value: string): boolean => {
  try {
    const url = new URL(value)
    return url.protocol === 'http:' || url.protocol === 'https:'
  } catch {
    return false
  }
}

const isValidCssColor = (value: string): boolean =>
  /^#[0-9a-fA-F]{3,8}$/.test(value) || /^rgba?\([^)]+\)$/i.test(value)

const DEFAULT_BRAND_COLOR = '#1d4ed8'
const DEFAULT_FONT_FAMILY = 'system-ui, sans-serif'

/* The widget paints white text on primaryColor (--df-color-primary). WCAG AA for
 * large text / UI components is 3:1; below that the send button is unreadable. */
const MIN_CONTRAST_ON_WHITE = 3
const WHITE: Rgb = { r: 255, g: 255, b: 255 }

/* Scale the color toward black. Multiplying all three channels by the same
 * factor keeps the hue and saturation intact, so a pale brand yellow darkens to
 * a readable amber rather than being thrown away for a generic blue. */
const darkenToContrast = (color: Rgb): Rgb => {
  let current = color
  for (let i = 0; i < 20 && contrastRatio(current, WHITE) < MIN_CONTRAST_ON_WHITE; i++) {
    current = { r: current.r * 0.9, g: current.g * 0.9, b: current.b * 0.9 }
  }
  return current
}

/* secondaryColor paints the assistant message bubble (message.tsx: `bg-secondary
 * df:text-foreground`), and the widget always renders it with the fixed dark
 * foreground text below — never white — so it must be checked against that
 * exact color, not against white. Matches ConfigContext's default
 * `foregroundColor: '#1f2937'`. */
const FOREGROUND_TEXT_COLOR: Rgb = { r: 0x1f, g: 0x29, b: 0x37 }
const MIN_CONTRAST_SECONDARY_TEXT = 4.5

/* Scale the color toward white rather than black — the bubble needs to stay
 * light enough to carry the fixed dark text, so darkening (as primaryColor
 * gets) would make this worse, not better. */
const lightenToContrast = (color: Rgb, against: Rgb): Rgb => {
  let current = color
  for (let i = 0; i < 20 && contrastRatio(current, against) < MIN_CONTRAST_SECONDARY_TEXT; i++) {
    current = {
      r: current.r + (255 - current.r) * 0.15,
      g: current.g + (255 - current.g) * 0.15,
      b: current.b + (255 - current.b) * 0.15
    }
  }
  return current
}

/* Derive a button label from a question when the model omits one. */
const labelFromPrompt = (prompt: string): string =>
  prompt
    .replace(/[?.!,]/g, '')
    .split(/\s+/)
    .filter(word => !/^(do|does|can|what|how|is|are|the|a|an|you|your|i|we)$/i.test(word))
    .slice(0, 3)
    .join(' ')
    .replace(/\b\w/g, character => character.toUpperCase()) || 'Learn More'

const FALLBACK_SUGGESTION: Suggestion = {
  label: 'What You Offer',
  prompt: 'What do you offer?'
}

/* Validates the generated analysis + brand fields before publish, and repairs
 * anything that fails so a bad LLM output never ships a broken widget (empty
 * welcome message, malformed color, garbage logo URL). Logs every repair so
 * regressions are visible without failing the whole request. */
export const enforceQuality = (
  companyId: string,
  analysis: ContentAnalysis,
  brand: BrandResult
): { analysis: ContentAnalysis; brand: BrandResult } => {
  const safeAnalysis = { ...analysis }
  const safeBrand = { ...brand }

  if (!safeAnalysis.welcomeMessage?.trim()) {
    logger.warn(`[quality ${companyId}] empty welcomeMessage, using fallback`)
    safeAnalysis.welcomeMessage = `**Welcome!**\n\nHave a question? Just type it here and I'll help out.`
  }

  const suggestions = (safeAnalysis.suggestions ?? []).map(suggestion => ({
    label: suggestion.label?.trim() || labelFromPrompt(suggestion.prompt ?? ''),
    prompt: suggestion.prompt?.trim() ?? ''
  }))
  const usable = suggestions.filter(suggestion => suggestion.prompt)
  if (usable.length !== 4) {
    logger.warn(
      `[quality ${companyId}] expected 4 suggestions, got ${usable.length}`
    )
    while (usable.length < 4) usable.push(FALLBACK_SUGGESTION)
  }
  safeAnalysis.suggestions = usable.slice(0, 4)

  if (safeBrand.brandColor && !isValidCssColor(safeBrand.brandColor)) {
    logger.warn(
      `[quality ${companyId}] invalid brandColor "${safeBrand.brandColor}", using default`
    )
    safeBrand.brandColor = DEFAULT_BRAND_COLOR
  } else if (!safeBrand.brandColor) {
    safeBrand.brandColor = DEFAULT_BRAND_COLOR
  }

  // The site's real color may be too light to carry white widget text. Darken it
  // rather than discard it — a dark version of their brand still reads as theirs.
  const primary = parseRgb(safeBrand.brandColor)
  if (primary && contrastRatio(primary, WHITE) < MIN_CONTRAST_ON_WHITE) {
    const darkened = toHex(darkenToContrast(primary))
    logger.warn(
      `[quality ${companyId}] brandColor ${safeBrand.brandColor} fails contrast on white; darkened to ${darkened}`
    )
    safeBrand.brandColor = darkened
  }

  if (safeBrand.secondaryColor && !isValidCssColor(safeBrand.secondaryColor)) {
    logger.warn(
      `[quality ${companyId}] invalid secondaryColor "${safeBrand.secondaryColor}", dropping`
    )
    safeBrand.secondaryColor = ''
  }

  // The assistant bubble always renders this color behind fixed dark text
  // (never white) — a dark or highly saturated secondaryColor makes that text
  // unreadable. Lighten toward white rather than dropping it, same rationale
  // as brandColor's darken-not-discard treatment above.
  const secondary = safeBrand.secondaryColor ? parseRgb(safeBrand.secondaryColor) : null
  if (secondary && contrastRatio(secondary, FOREGROUND_TEXT_COLOR) < MIN_CONTRAST_SECONDARY_TEXT) {
    const lightened = toHex(lightenToContrast(secondary, FOREGROUND_TEXT_COLOR))
    logger.warn(
      `[quality ${companyId}] secondaryColor ${safeBrand.secondaryColor} fails contrast against bubble text; lightened to ${lightened}`
    )
    safeBrand.secondaryColor = lightened
  }

  if (!safeBrand.fontFamily) {
    safeBrand.fontFamily = DEFAULT_FONT_FAMILY
  }

  // Inline-SVG logos are serialized to data: URIs by the brand probe, which
  // isValidHttpUrl would reject — the widget renders them in an <img> just fine.
  const isDataImage = safeBrand.logoUrl?.startsWith('data:image/')
  if (safeBrand.logoUrl && !isDataImage && !isValidHttpUrl(safeBrand.logoUrl)) {
    logger.warn(
      `[quality ${companyId}] invalid logoUrl "${safeBrand.logoUrl.slice(0, 80)}", dropping`
    )
    safeBrand.logoUrl = ''
  }

  return { analysis: safeAnalysis, brand: safeBrand }
}
