import { z } from 'zod'

/* Styles the caller can pre-supply. Anything omitted is inferred from the
 * scraped site during brand detection. */
export const stylesSchema = z
  .object({
    primaryColor: z.string().optional(),
    secondaryColor: z.string().optional(),
    backgroundColor: z.string().optional(),
    fontFamily: z.string().optional()
  })
  .optional()

/* Request body for POST /demos. Mirrors the inputs the old n8n "Start" trigger
 * accepted, minus the fields it only passed through untouched. */
export const demoInputSchema = z.object({
  // Used as an S3 key path segment (see integrations/s3.ts) — restrict to a
  // safe slug so it can't traverse into another tenant's prefix.
  companyId: z
    .string()
    .min(1)
    .regex(/^[a-zA-Z0-9_-]+$/, 'companyId must be alphanumeric, - or _ only'),
  companyName: z.string().min(1),
  companyWebsite: z.string().min(1),
  companyEmail: z.string().email(),
  companyPhone: z.string().optional(),
  isProd: z.union([z.boolean(), z.string()]).default(false),
  // Optional overrides — when provided we skip inferring them from the site.
  logoUrl: z.string().optional(),
  title: z.string().optional(),
  popupMessage: z.string().optional(),
  styles: stylesSchema
})

export type DemoInput = z.infer<typeof demoInputSchema>

/* Normalized input produced by prepare-input. */
export type PreparedInput = Omit<DemoInput, 'isProd'> & {
  isProd: boolean
  companyWebsite: string
  namespace: string
}

export type Suggestion = { prompt: string }

/* Output of the single content-analysis LLM call. */
export type ContentAnalysis = {
  businessName: string
  summary: string
  whatTheyOffer: string
  whoItsFor: string
  contactPhone: string
  welcomeMessage: string
  suggestions: Suggestion[]
}

/* Output of the single brand-detection LLM call. */
export type BrandResult = {
  logoUrl: string
  brandColor: string
  fontFamily: string
}
