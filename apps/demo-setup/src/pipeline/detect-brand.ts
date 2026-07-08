import { anthropic } from '@ai-sdk/anthropic'
import { generateObject, jsonSchema } from 'ai'
import { contrastFromLuminances, luminance, parseRgb } from '../lib/color'
import { env } from '../config/env'
import { logger } from '../lib/logger'
import { estimateLogoInkLuminance, sampleLogoColor } from './sample-logo-color'
import type { BrandCandidates } from './extract-brand-candidates'
import type { BrandProbe, BrandResult, PixelRect, PreparedInput } from '../types'

/* The model picks *indices* for colors, never invents a hex — "#7A2C3D" for a
 * site whose actual brand is "#7B2D3E" looks right in a chat reply and wrong
 * next to the real site. Every color it can return is a string we read out of
 * the live DOM or the rendered pixels.
 *
 * The logo is different: asking for an index into a text-described list is
 * exactly how the real horse-emblem logo on West Hills Vineyards got missed —
 * it wasn't a top candidate by any selector heuristic, so it was never index 0
 * or 1 in a list a model skims. A human designer just points at the picture.
 * So logoBox asks the model to do the same: locate the logo visually, as a
 * bounding box on the screenshot. We then match that box against whatever
 * concrete asset (image URL or inline SVG) sits in the same place — turning
 * vision into a spatial filter over real candidates, not a freeform picker. */
type BrandSelection = {
  primaryIndex: number
  logoBox: {
    found: boolean
    xPct: number
    yPct: number
    widthPct: number
    heightPct: number
  }
}

const selectionSchema = jsonSchema<BrandSelection>({
  type: 'object',
  additionalProperties: false,
  required: ['primaryIndex', 'logoBox'],
  properties: {
    primaryIndex: {
      type: 'integer',
      description:
        "Index of the color that visually dominates this brand's identity — the color used most prominently across the header, navigation, buttons, and accents in the screenshot. Think like a designer describing the brand's \"main color\": not necessarily the single largest area (a photo background doesn't count), but the flat brand color that recurs across UI elements. Never a white, off-white, black, or grey page background. When several candidates are near-identical shades of the same hue, prefer whichever one's note says it covers more of the rendered page — that measurement comes directly from the screenshot's pixels and can't be wrong the way a CSS variable name can (site builders like Wix often name variables generically, e.g. '--wst-color-custom-4', which tells you nothing about whether it's actually the primary color). Use -1 if none of the candidates match."
    },
    logoBox: {
      type: 'object',
      additionalProperties: false,
      required: ['found', 'xPct', 'yPct', 'widthPct', 'heightPct'],
      description:
        "Locate the company's logo mark or wordmark as it visually appears in the screenshot — this may be a text wordmark in the header, OR a distinct pictorial mark/emblem/seal (e.g. an icon, crest, or illustration representing the brand), which is often the more recognizable 'logo' even if a text banner also appears elsewhere on the page. Prefer the pictorial mark over a plain text banner when both are present.",
      properties: {
        found: {
          type: 'boolean',
          description: 'true if a distinct logo mark or wordmark is visible anywhere in the screenshot'
        },
        xPct: { type: 'number', description: 'Left edge of the logo, as a percentage (0-100) of the screenshot width' },
        yPct: { type: 'number', description: 'Top edge of the logo, as a percentage (0-100) of the screenshot height' },
        widthPct: { type: 'number', description: 'Width of the logo, as a percentage (0-100) of the screenshot width' },
        heightPct: { type: 'number', description: 'Height of the logo, as a percentage (0-100) of the screenshot height' }
      }
    }
  }
})

/* Sample color directly from the logo image's own pixels, weighted by
 * saturation — the technique the open-source OpenBrand project uses. A logo
 * is (almost) never a photo, so this sidesteps the whole-page pixel scan's
 * failure mode entirely (a gradient hero sky can never masquerade as "flat").
 * Favicon/apple-touch-icon go first: a favicon is commonly simplified to a
 * single dominant brand chip precisely because it renders at 16-32px, which
 * often makes it a *more* reliable color source than the full logo mark.
 * Bounded to a handful of candidates so one slow/dead image can't stall brand
 * detection; a monochrome logo (WHV's cream line-art horse emblem, say)
 * legitimately yields nothing here; other tiers cover that case. */
const sampleLogoColors = async (probe: BrandProbe): Promise<string[]> => {
  const logos = probe.logos ?? []
  const byKind = (kind: string) => logos.filter(logo => logo.kind === kind)
  const candidates = [
    ...byKind('apple-touch-icon'),
    ...byKind('favicon'),
    ...[...logos]
      .filter(logo => !['apple-touch-icon', 'favicon', 'ld+json', 'og'].includes(logo.kind))
      .sort((a, b) => b.score - a.score)
      .slice(0, 2)
  ].slice(0, 4)

  const results = await Promise.all(candidates.map(logo => sampleLogoColor(logo.url)))
  return [...new Set(results.filter((hex): hex is string => hex !== null))]
}

type ColorCandidate = { hex: string; note: string }

/* Rank the probe's color signals into one candidate list, each carrying a
 * human-readable note so the vision prompt can explain *why* a candidate is
 * there — critical when two near-identical greens both show up (a real
 * dominant color and a minor accent) and the model has to pick between them.
 *
 * Screenshot pixel-dominance leads: it's measured directly off the rendered
 * page and ranked by how much of it a color actually covers, so it can't lie
 * the way a CSS variable name can (West Hills Vineyards' Wix theme names its
 * real primary "--wst-color-custom-4" — a generic index that gives no signal
 * it's the important one). Logo-sampled colors come next: exact pixel data
 * from a small, almost-certainly-not-a-photo image, though note this can
 * legitimately point at a *different* image than the one that ends up as
 * logoUrl (that's matched separately, by vision-bbox position). CSS custom
 * properties named primary/brand and per-element computed styles fill out
 * the rest. */
const rankColors = (probe: BrandProbe, logoColors: string[]): ColorCandidate[] => {
  const ranked: ColorCandidate[] = []
  const seen = new Set<string>()
  const push = (hex: string | null | undefined, note: string) => {
    if (!hex) return
    const normalized = hex.toLowerCase()
    if (seen.has(normalized)) return
    seen.add(normalized)
    ranked.push({ hex: normalized, note })
  }

  for (const color of probe.pixelDominantColors ?? []) {
    push(color.hex, `covers ${Math.round(color.coverage * 100)}% of the rendered page (dominant flat color)`)
  }
  for (const hex of logoColors) push(hex, 'sampled from the logo/icon image pixels')
  for (const variable of probe.cssVariables ?? []) {
    push(
      variable.hex,
      variable.weight >= 60
        ? `CSS variable named "${variable.name}" (explicitly named primary/brand/accent)`
        : `CSS variable "${variable.name}" (generic name, no signal on purpose)`
    )
  }
  for (const color of probe.computedColors ?? []) {
    push(color.hex, `computed style, used ${color.uses}x on ${color.sources.join(', ')}`)
  }
  push(probe.themeColor, 'meta theme-color')

  return ranked.slice(0, 10)
}

/* A data: URI is a legitimate logo (we serialize inline <svg> wordmarks), but it
 * can be 20KB — far too long to put in a prompt. Show the model a stable stub
 * and map the index back to the real value afterwards. */
const describeLogo = (url: string): string =>
  url.startsWith('data:')
    ? `${url.slice(0, 40)}… (inline SVG, ${url.length} chars)`
    : url

const pick = (list: ColorCandidate[], index: number): string =>
  Number.isInteger(index) && index >= 0 && index < list.length ? list[index].hex : ''

const intersectionOverUnion = (a: PixelRect, b: PixelRect): number => {
  const x1 = Math.max(a.left, b.left)
  const y1 = Math.max(a.top, b.top)
  const x2 = Math.min(a.left + a.width, b.left + b.width)
  const y2 = Math.min(a.top + a.height, b.top + b.height)
  const overlap = Math.max(0, x2 - x1) * Math.max(0, y2 - y1)
  if (overlap <= 0) return 0
  const union = a.width * a.height + b.width * b.height - overlap
  return union > 0 ? overlap / union : 0
}

/* The model localizes the logo visually; this resolves that location to a
 * concrete asset by finding whichever candidate's on-page position overlaps
 * it best. Lenient IoU threshold — the model's box is a rough visual estimate,
 * not a precise crop, so demanding tight overlap would reject good matches. */
const matchLogoByPosition = (
  logos: NonNullable<BrandProbe['logos']>,
  box: BrandSelection['logoBox'],
  screenshotWidth: number,
  screenshotHeight: number
): string => {
  if (!box.found || !screenshotWidth || !screenshotHeight) return ''
  const target: PixelRect = {
    left: (box.xPct / 100) * screenshotWidth,
    top: (box.yPct / 100) * screenshotHeight,
    width: (box.widthPct / 100) * screenshotWidth,
    height: (box.heightPct / 100) * screenshotHeight
  }

  let best: { url: string; iou: number } | null = null
  for (const logo of logos) {
    if (!logo.rect) continue
    const iou = intersectionOverUnion(target, logo.rect)
    if (iou > 0.05 && (!best || iou > best.iou)) best = { url: logo.url, iou }
  }
  return best?.url ?? ''
}

/* Picks which widget header style the logo actually looks good on. Compares
 * the logo's own ink luminance against a colored header (brandColor) and a
 * white header, and keeps whichever gives better contrast — a logo drawn as
 * white-only art (Pizzeria Bianco's `bianco-logo-white.png`, made for a dark
 * photo backdrop) would go invisible on a white 'secondary' header, and the
 * reverse is just as real for a dark wordmark against a colored one. Defaults
 * to 'primary' (the more brand-forward option) when there's no logo, or no
 * ink-luminance signal to compare with (fetch failure, unrasterizable SVG). */
const WHITE_LUMINANCE = 1
const pickTheme = async (
  logoUrl: string,
  brandColor: string,
  companyId: string
): Promise<'primary' | 'secondary'> => {
  if (!logoUrl) return 'primary'
  const inkLuminance = await estimateLogoInkLuminance(logoUrl)
  const brandRgb = parseRgb(brandColor)
  if (inkLuminance === null || !brandRgb) return 'primary'

  const contrastOnPrimary = contrastFromLuminances(inkLuminance, luminance(brandRgb))
  const contrastOnWhite = contrastFromLuminances(inkLuminance, WHITE_LUMINANCE)
  const theme = contrastOnPrimary >= contrastOnWhite ? 'primary' : 'secondary'
  logger.info(
    `[brand ${companyId}] theme=${theme} (logo contrast: ${contrastOnPrimary.toFixed(1)} on primary vs ${contrastOnWhite.toFixed(1)} on white)`
  )
  return theme
}

/* Selects the site's real brand signals. The probe gives us exact values from
 * the live DOM and rendered pixels; the vision call decides which of them the
 * brand actually leads with (colors) and where the logo visually sits (matched
 * back to a real asset by position). Falls back to the probe's own ranking
 * whenever the model abstains, and to the legacy HTML-regex candidates when
 * the probe couldn't run at all.
 *
 * Caller-supplied values always win and skip the LLM. */
export const detectBrand = async (
  input: PreparedInput,
  probe: BrandProbe,
  screenshot: string,
  screenshotWidth: number,
  screenshotHeight: number,
  fallback: BrandCandidates
): Promise<BrandResult> => {
  const supplied = {
    logoUrl: input.logoUrl,
    brandColor: input.styles?.primaryColor,
    secondaryColor: input.styles?.secondaryColor,
    fontFamily: input.styles?.fontFamily
  }

  const font =
    supplied.fontFamily ||
    probe.fonts?.body ||
    fallback.fontCandidates[0] ||
    ''

  if (supplied.logoUrl && supplied.brandColor) {
    return {
      logoUrl: supplied.logoUrl,
      brandColor: supplied.brandColor,
      secondaryColor: supplied.secondaryColor ?? '',
      fontFamily: font,
      theme: await pickTheme(supplied.logoUrl, supplied.brandColor, input.companyId)
    }
  }

  const logoColors = await sampleLogoColors(probe)
  const colorPool = rankColors(probe, logoColors)
  const finalColorPool = colorPool.length
    ? colorPool
    : fallback.colorCandidates.map(hex => ({ hex, note: 'legacy HTML-regex candidate' }))
  const logos = probe.logos ?? []
  // Ranked purely for the text list shown to the model / the no-vision fallback
  // path; the logo that actually gets used comes from position matching below.
  const logoPool = [...logos].sort((a, b) => b.score - a.score).map(logo => logo.url)
  const finalLogoPool = logoPool.length ? logoPool : fallback.logoCandidates

  // Secondary color is deliberately not detected: it only paints the assistant
  // chat bubble background, isn't a prominent brand signal on most sites, and
  // guessing wrong (a saturated color behind fixed dark text) reads worse than
  // just using the widget's own neutral default. Caller-supplied override
  // still wins; quality.ts's contrast guard still applies to it.
  const secondaryColor = supplied.secondaryColor ?? ''

  // Nothing to choose between, or no screenshot to choose with — take the top
  // ranked candidate rather than burning a vision call to confirm the obvious.
  if (!screenshot || (finalColorPool.length <= 1 && finalLogoPool.length <= 1)) {
    if (!screenshot) {
      logger.warn(
        `[brand ${input.companyId}] no screenshot; using probe ranking directly`
      )
    }
    const logoUrl = supplied.logoUrl ?? finalLogoPool[0] ?? ''
    const brandColor = supplied.brandColor ?? finalColorPool[0]?.hex ?? ''
    return {
      logoUrl,
      brandColor,
      secondaryColor,
      fontFamily: font,
      theme: await pickTheme(logoUrl, brandColor, input.companyId)
    }
  }

  const prompt = [
    `Website: ${input.companyWebsite}`,
    '',
    'Colors sampled from the live page (index: value — note):',
    ...finalColorPool.map((candidate, index) => `${index}: ${candidate.hex} — ${candidate.note}`),
    '',
    'For reference, images found on the page that might be the logo (not used by index — locate the logo visually in the screenshot instead):',
    ...finalLogoPool.map((url, index) => `${index}: ${describeLogo(url)}`),
    '',
    'The attached screenshot is the top of this homepage.'
  ].join('\n')

  let selection: BrandSelection
  try {
    const { object } = await generateObject({
      model: anthropic(env.modelBrand),
      schema: selectionSchema,
      system:
        "You are a brand designer reviewing a website screenshot. Identify the brand's primary color from the given candidate list by index, and locate the company's logo visually in the image (as a bounding box), the way a designer would point at it — not by guessing which listed URL it corresponds to.",
      messages: [
        {
          role: 'user',
          content: [
            { type: 'text', text: prompt },
            { type: 'image', image: screenshot, mediaType: 'image/jpeg' }
          ]
        }
      ]
    })
    selection = object
  } catch (error) {
    logger.warn(
      `[brand ${input.companyId}] vision selection failed (${error}); using probe ranking`
    )
    selection = {
      primaryIndex: 0,
      logoBox: { found: false, xPct: 0, yPct: 0, widthPct: 0, heightPct: 0 }
    }
  }

  // -1 means "none of these" — fall back to the probe's own top pick rather than
  // shipping an empty color, which quality.ts would replace with a generic blue.
  const primary = pick(finalColorPool, selection.primaryIndex) || finalColorPool[0]?.hex || ''

  const positionMatchedLogo = matchLogoByPosition(
    logos,
    selection.logoBox,
    screenshotWidth,
    screenshotHeight
  )
  const logoUrl = supplied.logoUrl ?? positionMatchedLogo ?? finalLogoPool[0] ?? ''

  logger.info(
    `[brand ${input.companyId}] primary=${primary} ` +
      `logo=${positionMatchedLogo ? 'position-matched' : logoUrl ? 'top-ranked fallback' : 'none'} ` +
      `from ${finalColorPool.length} colors, ${finalLogoPool.length} logo candidates`
  )

  const brandColor = supplied.brandColor ?? primary
  return {
    logoUrl,
    brandColor,
    secondaryColor,
    fontFamily: font,
    theme: await pickTheme(logoUrl, brandColor, input.companyId)
  }
}
