import * as cheerio from 'cheerio'

export type BrandCandidates = {
  logoCandidates: string[]
  colorCandidates: string[]
  fontCandidates: string[]
}

const resolveUrl = (url: string, base: string): string => {
  try {
    return new URL(url, base).href
  } catch {
    return url
  }
}

const scoreLogo = (url: string): number => {
  const lower = url.toLowerCase()
  let score = 0
  if (lower.includes('logo')) score += 50
  if (lower.includes('brand')) score += 25
  if (lower.includes('icon')) score += 10
  return score
}

const extractFontFamilies = (css: string): string[] => {
  const fonts: string[] = []
  const regex = /font-family\s*:\s*([^;{}]+)/gi
  let match: RegExpExecArray | null
  while ((match = regex.exec(css))) {
    const font = match[1].trim().replace(/['"]/g, '')
    if (font && !/inherit|initial|var\(/i.test(font)) fonts.push(font)
  }
  return fonts
}

const extractBackgroundColors = (css: string): string[] => {
  const colors: string[] = []
  const regex = /background(?:-color)?\s*:\s*([^;{}]+)/gi
  let match: RegExpExecArray | null
  while ((match = regex.exec(css))) {
    const value = match[1].trim()
    const color = value.match(/#[0-9a-fA-F]{3,8}|rgba?\([^)]+\)/)
    if (color && !/gradient|url\(/i.test(value)) colors.push(color[0])
  }
  return colors
}

const dedupe = (items: string[], limit: number): string[] =>
  Array.from(new Set(items)).slice(0, limit)

/* Extracts raw brand-signal candidates (logo image URLs, background colors,
 * font families) from the homepage HTML that crawl4ai already rendered. This is
 * a pure function — it performs no network requests (the old version fetched the
 * homepage and its stylesheets, which was the SSRF surface). External stylesheet
 * contents aren't available here; we rely on the rendered inline styles and
 * <style> blocks, which usually carry the brand color/font. The detect-brand LLM
 * picks the best candidate; anything unfound falls back deterministically. */
export const extractBrandCandidates = (
  homepageHtml: string,
  website: string
): BrandCandidates => {
  const $ = cheerio.load(homepageHtml)

  const attrs = (selector: string, attr: string): string[] =>
    $(selector)
      .map((_, el) => $(el).attr(attr))
      .get()
      .filter((value): value is string => Boolean(value))

  const logoCandidates = dedupe(
    [
      ...attrs(
        'header img, img.logo, img[alt*="logo"], img[src*="logo"], [id*="logo"] img, [class*="logo"] img',
        'src'
      ),
      ...attrs(
        'meta[property="og:image"], meta[name="twitter:image"]',
        'content'
      ),
      ...attrs('link[rel*="icon"]', 'href')
    ].map(url => resolveUrl(url, website)),
    8
  ).sort((a, b) => scoreLogo(b) - scoreLogo(a))

  const inlineStyles = attrs('[style]', 'style').join('\n')
  const styleBlocks = $('style')
    .map((_, el) => $(el).html() || '')
    .get()
    .join('\n')
  const allCss = [inlineStyles, styleBlocks].join('\n')

  return {
    logoCandidates,
    colorCandidates: dedupe(extractBackgroundColors(allCss), 12),
    fontCandidates: dedupe(extractFontFamilies(allCss), 8)
  }
}
