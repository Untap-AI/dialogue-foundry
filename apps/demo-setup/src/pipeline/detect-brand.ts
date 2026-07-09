import { anthropic } from '@ai-sdk/anthropic'
import { generateObject, jsonSchema } from 'ai'
import { contrastFromLuminances, luminance, parseRgb } from '../lib/color'
import { env } from '../config/env'
import { logger } from '../lib/logger'
import { rasterizeLogoCandidate } from './rasterize-logo'
import { estimateLogoInkLuminance, sampleLogoColor } from './sample-logo-color'
import type { BrandCandidates } from './extract-brand-candidates'
import type { BrandProbe, BrandResult, PreparedInput } from '../types'

/* The model picks *indices* for colors, never invents a hex — "#7A2C3D" for a
 * site whose actual brand is "#7B2D3E" looks right in a chat reply and wrong
 * next to the real site. Every color it can return is a string we read out of
 * the live DOM or the rendered pixels.
 *
 * The logo is picked the same way, but over *images*: each candidate the probe
 * collected is rasterized and attached to the vision call, and the model picks
 * the one that is actually the company's logo by looking at it. Two prior
 * designs both failed on real sites: index-into-a-text-list missed West Hills
 * Vineyards' horse emblem (heuristic ranking never surfaced it), and
 * locate-by-bounding-box shipped apple.com a "TV & Home" nav glyph (the box
 * missed, and the coordinate match fell back to the heuristic top pick).
 * Looking at the candidate pixels sidesteps both: no score decides, and no
 * screenshot geometry has to line up. */
type BrandSelection = {
  primaryIndex: number
  logoIndex: number
}

const selectionSchema = jsonSchema<BrandSelection>({
  type: 'object',
  additionalProperties: false,
  required: ['primaryIndex', 'logoIndex'],
  properties: {
    primaryIndex: {
      type: 'integer',
      description:
        "Index of the color that visually dominates this brand's identity — the color used most prominently across the header, navigation, buttons, and accents in the screenshot. Think like a designer describing the brand's \"main color\": not necessarily the single largest area (a photo background doesn't count), but the flat brand color that recurs across UI elements. Never a white, off-white, black, or grey page background. When several candidates are near-identical shades of the same hue, prefer whichever one's note says it covers more of the rendered page — that measurement comes directly from the screenshot's pixels and can't be wrong the way a CSS variable name can (site builders like Wix often name variables generically, e.g. '--wst-color-custom-4', which tells you nothing about whether it's actually the primary color). Use -1 if none of the candidates match."
    },
    logoIndex: {
      type: 'integer',
      description:
        "Index of the numbered candidate image that is this company's logo — the mark or wordmark that identifies the brand, usually shown in the site header and often wrapped in a link to the homepage. Judge each candidate by looking at its image: a navigation label, menu icon, product shot, social icon, or promo banner is NOT the logo even if it sits in the header. When both a pictorial mark/emblem and a plain text rendering are among the candidates, prefer the pictorial mark. Use -1 if none of the candidate images is the company's logo."
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

const pick = (list: ColorCandidate[], index: number): string =>
  Number.isInteger(index) && index >= 0 && index < list.length ? list[index].hex : ''

type LogoCandidate = NonNullable<BrandProbe['logos']>[number]
type VisionLogoCandidate = { logo: LogoCandidate; png: string }

/* One line of DOM context per candidate image — where it sat and how it was
 * labeled. The image itself does most of the work; this catches the case where
 * two candidates look alike (a mark vs. its og:image rendition, say). */
const describeCandidate = (logo: LogoCandidate): string => {
  const parts: string[] = [logo.kind === 'svg' ? 'inline SVG' : logo.kind]
  if (logo.rect) {
    parts.push(
      `${logo.rect.width}x${logo.rect.height}px at (${logo.rect.left}, ${logo.rect.top}) on the page`
    )
  }
  if (logo.alt) parts.push(`labeled "${logo.alt}"`)
  if (logo.anchorLabel) parts.push(`inside a link labeled "${logo.anchorLabel}"`)
  if (logo.linksHome) parts.push('links to the homepage')
  if (logo.recurringPages) parts.push(`recurs on ${logo.recurringPages} pages`)
  return parts.join(', ')
}

/* Enough to always include the real mark (the probe's pre-rank only has to get
 * it into the top 8, not to #1), small enough that the vision call stays cheap
 * — the tiles are ≤256px. */
const VISION_CANDIDATE_LIMIT = 8

const rasterizeCandidates = async (
  logos: LogoCandidate[]
): Promise<VisionLogoCandidate[]> => {
  const rendered = await Promise.all(
    logos.slice(0, VISION_CANDIDATE_LIMIT).map(async logo => ({
      logo,
      png: await rasterizeLogoCandidate(logo.url)
    }))
  )
  return rendered.filter((c): c is VisionLogoCandidate => c.png !== null)
}

/* When vision abstains or fails: a schema.org-declared logo is authoritative
 * (score >= 100 keeps Organization.logo and excludes the weaker
 * Organization.image entries that share the kind), an apple-touch-icon is
 * at least always the brand's own mark, and only then the heuristic top pick
 * — the ranking that shipped apple.com a nav glyph — gets a say. */
const fallbackLogoUrl = (
  logos: LogoCandidate[],
  rankedUrls: string[]
): string => {
  const declared = logos.find(
    logo => logo.kind === 'ld+json' && logo.score >= 100
  )?.url
  const touchIcon = logos.find(logo => logo.kind === 'apple-touch-icon')?.url
  return declared ?? touchIcon ?? rankedUrls[0] ?? ''
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
 * brand actually leads with (colors) and which candidate image is the real
 * logo (by looking at the candidates themselves). Falls back to declared
 * logos / the probe's own ranking whenever the model abstains, and to the
 * legacy HTML-regex candidates when the probe couldn't run at all.
 *
 * Caller-supplied values always win and skip the LLM. */
export const detectBrand = async (
  input: PreparedInput,
  probe: BrandProbe,
  screenshot: string,
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
      fontLinkHref: null,
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
      fontLinkHref: null,
      theme: await pickTheme(logoUrl, brandColor, input.companyId)
    }
  }

  // Legacy HTML-regex fallback candidates are bare URLs; wrap them so they can
  // ride the same rasterize-and-look path when the probe found nothing.
  const visionSourceLogos: LogoCandidate[] = logos.length
    ? logos
    : fallback.logoCandidates.map(url => ({ url, kind: 'img', score: 0 }))
  const logoCandidates = await rasterizeCandidates(visionSourceLogos)

  if (logoCandidates.length) {
    logger.info(
      `[brand ${input.companyId}] logo candidates: ` +
        logoCandidates
          .map(
            (candidate, index) =>
              `#${index} ${describeCandidate(candidate.logo)} [score ${candidate.logo.score}] ${candidate.logo.url.slice(0, 100)}`
          )
          .join(' | ')
    )
  }

  const prompt = [
    `Website: ${input.companyWebsite}`,
    '',
    'Colors sampled from the live page (index: value — note):',
    ...finalColorPool.map((candidate, index) => `${index}: ${candidate.hex} — ${candidate.note}`),
    '',
    'The first attached image is a screenshot of the top of this homepage, for context.',
    logoCandidates.length
      ? `After it come ${logoCandidates.length} numbered logo-candidate images, each an image actually found on the page, rendered on a neutral grey tile and captioned with where it sat and how it was labeled. Pick the candidate that is this company's logo.`
      : 'No logo-candidate images could be rendered for this page; return -1 for logoIndex.'
  ].join('\n')

  let selection: BrandSelection
  try {
    const { object } = await generateObject({
      model: anthropic(env.modelBrand),
      schema: selectionSchema,
      system:
        "You are a brand designer reviewing a website. Identify the brand's primary color from the given candidate list by index, and identify the company's logo by looking at the numbered candidate images — judge each by what it actually depicts, the way a designer would.",
      messages: [
        {
          role: 'user',
          content: [
            { type: 'text' as const, text: prompt },
            { type: 'image' as const, image: screenshot, mediaType: 'image/jpeg' },
            ...logoCandidates.flatMap((candidate, index) => [
              {
                type: 'text' as const,
                text: `Logo candidate ${index}: ${describeCandidate(candidate.logo)}`
              },
              {
                type: 'image' as const,
                image: candidate.png,
                mediaType: 'image/png'
              }
            ])
          ]
        }
      ]
    })
    selection = object
  } catch (error) {
    logger.warn(
      `[brand ${input.companyId}] vision selection failed (${error}); using fallback ranking`
    )
    selection = { primaryIndex: 0, logoIndex: -1 }
  }

  // -1 means "none of these" — fall back to the probe's own top pick rather than
  // shipping an empty color, which quality.ts would replace with a generic blue.
  const primary = pick(finalColorPool, selection.primaryIndex) || finalColorPool[0]?.hex || ''

  const visionPickedLogo =
    Number.isInteger(selection.logoIndex) &&
    selection.logoIndex >= 0 &&
    selection.logoIndex < logoCandidates.length
      ? logoCandidates[selection.logoIndex].logo.url
      : null
  const logoUrl =
    supplied.logoUrl ??
    visionPickedLogo ??
    fallbackLogoUrl(logos, finalLogoPool)

  logger.info(
    `[brand ${input.companyId}] primary=${primary} ` +
      `logo=${visionPickedLogo ? `vision-picked #${selection.logoIndex}` : logoUrl ? 'fallback chain' : 'none'} ` +
      `from ${finalColorPool.length} colors, ${logoCandidates.length}/${visionSourceLogos.length} logo candidates rendered`
  )

  const brandColor = supplied.brandColor ?? primary
  return {
    logoUrl,
    brandColor,
    secondaryColor,
    fontFamily: font,
    fontLinkHref: null,
    theme: await pickTheme(logoUrl, brandColor, input.companyId)
  }
}
