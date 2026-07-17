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
  // Optional: inferred from the crawl (business-name extraction, then the
  // site's own branding/title, then the domain) when omitted.
  companyName: z.string().min(1).optional(),
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

/* `label` is the button text the widget renders; `prompt` is what it sends when
 * clicked (see ChatInterface's `suggestion.label || suggestion.prompt`). The
 * button is ~140px wide, so a full question only reads well as a short label. */
export type Suggestion = { label: string; prompt: string }

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

/* Output of the single brand-detection LLM call. `theme` picks which widget
 * header style the demo ships with — 'primary' paints the header in
 * brandColor (the logo sits on top of it), 'secondary' keeps it white (the
 * logo sits on a neutral background, brandColor shows up as accents/border
 * instead). Chosen by comparing the logo's own ink luminance against each
 * option, so a light-only logo (e.g. a mark drawn for a white background)
 * doesn't get rendered on top of a background that swallows it. */
export type BrandResult = {
  logoUrl: string
  brandColor: string
  secondaryColor: string
  fontFamily: string
  theme: 'primary' | 'secondary'
  // Set by quality.ts when fontFamily is a confirmed-loadable Google Fonts
  // family; null when it's a system-safe name or wasn't found in Google's
  // catalog (fontFamily falls back to the default stack in that case).
  fontLinkHref: string | null
}

export type PixelRect = {
  top: number
  left: number
  width: number
  height: number
}

/* Brand signals read out of the live DOM by web-crawler/brand_probe.js. Every
 * field is best-effort: a page that blocks script evaluation yields {}. */
export type BrandProbe = {
  cssVariables?: { name: string; hex: string; weight: number }[]
  computedColors?: {
    hex: string
    score: number
    uses: number
    sources: string[]
  }[]
  // Which flat (non-photographic) color covers the most of the rendered page,
  // read directly from screenshot pixels — see web-crawler/scrape_page.py's
  // _dominant_flat_colors. `coverage` is a 0-1 fraction of sampled flat tiles.
  pixelDominantColors?: { hex: string; coverage: number }[]
  themeColor?: string | null
  fonts?: { body?: string | null; heading?: string | null }
  // `rect` is present for candidates found on the homepage (brand_probe.js);
  // recurrence-only candidates folded in from other pages (scrape_page.py's
  // _apply_logo_recurrence) have no single position and omit those fields.
  // alt/anchorLabel/linksHome are shown to the vision model as per-candidate
  // context when it picks the logo by looking at the candidate images.
  logos?: {
    url: string
    kind: string
    // Which signal family the candidate came from. The probe quotas slots per
    // class rather than globally score-sorting, since scores across families
    // aren't comparable. 'structured' = publisher-declared (schema.org logo,
    // og:image, manifest icon, apple-touch-icon); 'dom' = found by walking the
    // page; 'recurrence' = repeats across scraped pages.
    sourceClass?: 'structured' | 'dom' | 'recurrence'
    area?: number
    score: number
    rect?: PixelRect
    recurringPages?: number
    alt?: string | null
    anchorLabel?: string | null
    linksHome?: boolean
  }[]
  title?: string | null
}

/* A row of the demo_requests queue, written by the marketing site's /api/demo
 * and claimed by the worker. Mirrors the migration in
 * apps/backend/supabase/migrations/20260708000000_add_demo_requests_table.sql */
export type FunnelStage =
  | 'demo_sent'
  | 'trial_offered'
  | 'nudged'
  | 'trial_started'
  | 'trial_ending'
  | 'converted'
  | 'expired'
  | 'closed'

/* One row per demo company in the demo_funnel table. Milestone timestamps are
 * the source of truth; `stage` is materialized alongside for observability. */
export type FunnelRow = {
  id: string
  company_id: string
  demo_request_id: string | null
  email: string
  website_url: string
  company_name: string | null
  platform: string | null
  stage: FunnelStage
  demo_completed_at: string
  first_engaged_at: string | null
  trial_offer_sent_at: string | null
  nudge_sent_at: string | null
  concierge_requested_at: string | null
  install_domain: string | null
  trial_started_at: string | null
  trial_ends_at: string | null
  trial_started_email_sent_at: string | null
  trial_ending_email_sent_at: string | null
  demo_ready_message_id: string | null
  created_at: string
  updated_at: string | null
}

export type DemoRequestRow = {
  id: string
  website_url: string
  // No longer collected by the marketing site's form — null until the worker
  // derives it from the crawl and writes it back (see queue/worker.ts).
  company_name: string | null
  // One address for both roles: it becomes the demo's support_email and is
  // where the "demo ready" link is sent (the form collects a single email).
  email: string
  source_path: string | null
  user_agent: string | null
  company_id: string | null
  demo_url: string | null
  // Website platform detected during the build (wordpress, shopify, ...), or
  // null when unrecognized. Deep-links the funnel's install-guide email.
  platform: string | null
  // Message-ID stamped on the demo-ready email, so the trial-offer follow-up can
  // thread as a reply on the same conversation.
  demo_ready_message_id: string | null
  is_prod: boolean
  status: 'pending' | 'processing' | 'complete' | 'failed'
  attempts: number
  max_attempts: number
  last_error: string | null
  claimed_at: string | null
  claimed_by: string | null
  completed_at: string | null
  created_at: string
  updated_at: string | null
}
