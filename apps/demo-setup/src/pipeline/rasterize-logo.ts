import sharp from 'sharp'
import { logger } from '../lib/logger'
import { fetchImageBuffer } from './sample-logo-color'

/* Renders a logo candidate to a small PNG the vision model can actually look
 * at, so logo selection happens by inspecting the candidate images themselves
 * rather than by heuristic score or screenshot-coordinate matching. */

const MAX_EDGE = 256
// sharp rasterizes SVGs at their intrinsic size (72 DPI) — a 14x44 mark would
// come out too small for a vision model to judge. A higher density renders it
// ~4x larger; raster inputs ignore this option.
const SVG_DENSITY = 288
// Flatten transparency onto light grey, not white: plenty of marks are drawn
// as white ink for a colored header and would vanish on a white tile.
const BACKGROUND = { r: 230, g: 230, b: 230 }

export const rasterizeLogoCandidate = async (
  url: string
): Promise<string | null> => {
  const buffer = await fetchImageBuffer(url)
  if (!buffer) return null

  try {
    const rendered = await sharp(buffer, { density: SVG_DENSITY })
      .resize(MAX_EDGE, MAX_EDGE, { fit: 'inside', withoutEnlargement: true })
      .flatten({ background: BACKGROUND })
      .png()
      .toBuffer()
    return rendered.toString('base64')
  } catch {
    // .ico favicons, corrupt images, unsupported formats — drop the candidate
    // rather than failing brand detection over it.
    return null
  }
}

/* The widget renders logoUrl directly in its header, so the chosen asset has to
 * be *tight*. Social-preview images (og:image) are the cleanest rendition of a
 * mark on many sites but are drawn on a 1200x630 canvas — used as-is, the mark
 * renders as a speck in a sea of white. Crop the uniform border away and inline
 * the result, which also frees the widget from hotlinking the prospect's CDN.
 *
 * Only worth it when the crop actually reclaims meaningful area; a header logo
 * is already tight, and re-encoding it as a data URI would only cost bytes. */
const DISPLAY_MAX_EDGE = 512
const TRIM_THRESHOLD = 10
// Below this fraction of the original area retained, the trim earned its keep.
const WORTHWHILE_AREA_RATIO = 0.85
// A data URI beyond this is worse than hotlinking; the widget inlines it into
// the page's config blob.
const MAX_DATA_URI_BYTES = 96_000

export const trimLogoForDisplay = async (
  url: string,
  companyId: string
): Promise<string> => {
  // Inline SVGs are vector and already tightly bounded by their viewBox.
  if (url.startsWith('data:')) return url

  const buffer = await fetchImageBuffer(url)
  if (!buffer) return url

  try {
    const original = await sharp(buffer).metadata()
    if (!original.width || !original.height) return url

    // Measure the crop before any resize, so the ratio compares like with like.
    // Transparency is preserved: a mark drawn as white ink on a transparent
    // background must not be flattened onto white and then trimmed to nothing.
    const trimmed = await sharp(buffer)
      .trim({ threshold: TRIM_THRESHOLD })
      .png()
      .toBuffer({ resolveWithObject: true })

    const retained =
      (trimmed.info.width * trimmed.info.height) /
      (original.width * original.height)
    // A uniform image trims to nothing; a tight one trims to ~itself.
    if (retained < 0.001 || retained > WORTHWHILE_AREA_RATIO) return url

    const resized = await sharp(trimmed.data)
      .resize(DISPLAY_MAX_EDGE, DISPLAY_MAX_EDGE, {
        fit: 'inside',
        withoutEnlargement: true
      })
      .png()
      .toBuffer()

    const dataUri = `data:image/png;base64,${resized.toString('base64')}`
    if (dataUri.length > MAX_DATA_URI_BYTES) return url

    logger.info(
      `[brand ${companyId}] trimmed logo padding: ${original.width}x${original.height} → ${trimmed.info.width}x${trimmed.info.height}`
    )
    return dataUri
  } catch {
    // A logo we can't decode is still a logo the browser probably can.
    return url
  }
}
