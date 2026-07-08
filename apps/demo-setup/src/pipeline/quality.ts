import { logger } from '../lib/logger'
import type { BrandResult, ContentAnalysis } from '../types'

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
    safeAnalysis.welcomeMessage = `Welcome! Have a question? Just type it here and I'll help out.`
  }

  if (safeAnalysis.suggestions?.length !== 4) {
    logger.warn(
      `[quality ${companyId}] expected 4 suggestions, got ${safeAnalysis.suggestions?.length ?? 0}`
    )
    const prompts = safeAnalysis.suggestions?.map(s => s.prompt) ?? []
    while (prompts.length < 4) prompts.push('What do you offer?')
    safeAnalysis.suggestions = prompts.slice(0, 4).map(p => ({ prompt: p }))
  }

  if (safeBrand.brandColor && !isValidCssColor(safeBrand.brandColor)) {
    logger.warn(
      `[quality ${companyId}] invalid brandColor "${safeBrand.brandColor}", using default`
    )
    safeBrand.brandColor = DEFAULT_BRAND_COLOR
  } else if (!safeBrand.brandColor) {
    safeBrand.brandColor = DEFAULT_BRAND_COLOR
  }

  if (!safeBrand.fontFamily) {
    safeBrand.fontFamily = DEFAULT_FONT_FAMILY
  }

  if (safeBrand.logoUrl && !isValidHttpUrl(safeBrand.logoUrl)) {
    logger.warn(
      `[quality ${companyId}] invalid logoUrl "${safeBrand.logoUrl}", dropping`
    )
    safeBrand.logoUrl = ''
  }

  return { analysis: safeAnalysis, brand: safeBrand }
}
