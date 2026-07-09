import sharp from 'sharp'
import { Vibrant } from 'node-vibrant/node'
import { luminance } from '../lib/color'

/* Mirrors the technique used by the open-source OpenBrand project
 * (github.com/ethanjyx/OpenBrand): a logo is (almost) never a photo, so
 * sampling its own pixels is a far more reliable brand-color signal than
 * scanning the whole page — no gradients, no hero photos to filter out.
 *
 * The actual quantization/scoring is node-vibrant (the same median-cut +
 * population/saturation scoring algorithm as Android's Palette API,
 * battle-tested across millions of apps) rather than a hand-rolled
 * saturation-weighted histogram — that homegrown version was fooled by
 * stray high-saturation garbage pixels sharp's `.removeAlpha()` exposed
 * under fully-transparent regions of a WixStatic-served PNG (see the
 * flatten-onto-white step below, which fixes that at the source).
 *
 * Returns null for a genuinely monochrome logo (a white/black line-art
 * mark, say) — that's a legitimate "no signal here", not a failure; the
 * caller has other tiers. */

const SAMPLE_SIZE = 128
const FETCH_TIMEOUT_MS = 5000

export const fetchImageBuffer = async (url: string): Promise<Buffer | null> => {
  if (url.startsWith('data:')) {
    const base64 = url.split(',')[1]
    return base64 ? Buffer.from(base64, 'base64') : null
  }
  try {
    const response = await fetch(url, {
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS)
    })
    if (!response.ok) return null
    return Buffer.from(await response.arrayBuffer())
  } catch {
    return null
  }
}

export const sampleLogoColor = async (url: string): Promise<string | null> => {
  const buffer = await fetchImageBuffer(url)
  if (!buffer) return null

  try {
    // Flatten transparency onto white before handing off to Vibrant — a
    // logo mark is drawn assuming a light background, and compositing onto
    // real white (rather than leaving raw, possibly-garbage RGB under
    // transparent pixels) is what makes the sampled color trustworthy.
    const flattened = await sharp(buffer)
      .resize(SAMPLE_SIZE, SAMPLE_SIZE, { fit: 'inside', withoutEnlargement: true })
      .flatten({ background: { r: 255, g: 255, b: 255 } })
      .png()
      .toBuffer()

    const palette = await Vibrant.from(flattened).getPalette()
    // Prefer a genuinely vibrant swatch over a muted one — a brand mark's
    // "brand color" is its most saturated ink, not its most populous pixel
    // (which on a mostly-white logo would just be white/near-white, already
    // filtered out by Vibrant's own saturation/population scoring).
    const swatch =
      palette.Vibrant ??
      palette.DarkVibrant ??
      palette.LightVibrant ??
      palette.Muted ??
      palette.DarkMuted ??
      palette.LightMuted ??
      null
    return swatch?.hex ?? null
  } catch {
    // Corrupt image, unsupported format, oversized SVG — not worth failing
    // brand detection over one bad candidate.
    return null
  }
}

/* Average luminance of the logo's own drawn pixels — deliberately *not*
 * flattened onto a background first, unlike sampleLogoColor above. Flattening
 * would bias this toward whatever fill color we picked (white) rather than
 * telling us anything about the mark itself, which is exactly what picking a
 * widget header theme needs: "is this logo light or dark ink, regardless of
 * what it's normally shown against?" Used to decide whether a colored
 * (primaryColor) or white header background gives the logo better contrast. */
export const estimateLogoInkLuminance = async (url: string): Promise<number | null> => {
  const buffer = await fetchImageBuffer(url)
  if (!buffer) return null

  try {
    const { data, info } = await sharp(buffer)
      .resize(SAMPLE_SIZE, SAMPLE_SIZE, { fit: 'inside', withoutEnlargement: true })
      .ensureAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true })

    let total = 0
    let count = 0
    const OPAQUE_THRESHOLD = 200
    for (let i = 0; i < data.length; i += info.channels) {
      const alpha = data[i + 3]
      if (alpha < OPAQUE_THRESHOLD) continue
      total += luminance({ r: data[i], g: data[i + 1], b: data[i + 2] })
      count += 1
    }
    if (!count) return null
    return total / count
  } catch {
    return null
  }
}
