export type Rgb = { r: number; g: number; b: number }

export const parseRgb = (value: string): Rgb | null => {
  const hex = value.match(/^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/)
  if (hex) {
    const h = hex[1].length === 3 ? [...hex[1]].map(c => c + c).join('') : hex[1]
    return {
      r: parseInt(h.slice(0, 2), 16),
      g: parseInt(h.slice(2, 4), 16),
      b: parseInt(h.slice(4, 6), 16)
    }
  }
  const rgb = value.match(/^rgba?\(\s*(\d+)[,\s]+(\d+)[,\s]+(\d+)/i)
  if (rgb) return { r: +rgb[1], g: +rgb[2], b: +rgb[3] }
  return null
}

export const toHex = ({ r, g, b }: Rgb): string =>
  '#' +
  [r, g, b]
    .map(n => Math.round(Math.min(255, Math.max(0, n))).toString(16).padStart(2, '0'))
    .join('')

/* WCAG 2.1 relative luminance. */
export const luminance = ({ r, g, b }: Rgb): number => {
  const channel = (value: number): number => {
    const c = value / 255
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
  }
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b)
}

/* WCAG 2.1 contrast ratio between two relative luminances — 1 (identical) to
 * 21 (black on white). The two-luminance form is the primitive; contrastRatio
 * below is just it applied to two colors. */
export const contrastFromLuminances = (l1: number, l2: number): number => {
  const lighter = Math.max(l1, l2)
  const darker = Math.min(l1, l2)
  return (lighter + 0.05) / (darker + 0.05)
}

/* WCAG 2.1 contrast ratio between two colors — 1 (identical) to 21 (black on white). */
export const contrastRatio = (a: Rgb, b: Rgb): number =>
  contrastFromLuminances(luminance(a), luminance(b))
