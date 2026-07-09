import sharp from 'sharp'
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
