import dotenv from 'dotenv'

dotenv.config()

const required = (key: string): string => {
  const value = process.env[key]
  if (!value) {
    throw new Error(`Missing required environment variable: ${key}`)
  }
  return value
}

const optional = (key: string, fallback: string): string =>
  process.env[key] || fallback

const optionalInt = (key: string, fallback: number): number => {
  const raw = process.env[key]
  if (!raw) return fallback
  const parsed = parseInt(raw, 10)
  if (Number.isNaN(parsed)) {
    throw new Error(
      `Environment variable ${key} must be an integer, got "${raw}"`
    )
  }
  return parsed
}

export const env = {
  port: parseInt(process.env.PORT || '4000', 10),
  apiKeys: (process.env.DEMO_SETUP_API_KEYS || '')
    .split(',')
    .map(key => key.trim())
    .filter(Boolean),

  anthropicApiKey: () => required('ANTHROPIC_API_KEY'),
  // Generates the welcome message + suggestions — the first thing a prospect
  // reads, so quality matters more than the cost delta of one call per demo.
  modelAnalysis: optional('MODEL_ANALYSIS', 'claude-sonnet-5'),
  // Vision call that picks the brand color/logo out of a screenshot. Also one
  // call per demo; vision quality directly determines whether colors match.
  modelBrand: optional('MODEL_BRAND', 'claude-sonnet-5'),

  // The background crawl (orchestrator.py) still uses OpenAI internally for
  // content filtering/summarization — unrelated to this service's own Claude
  // calls above.
  crawlerOpenaiApiKey: () => required('CRAWLER_OPENAI_API_KEY'),

  supabase: (isProd: boolean) =>
    isProd
      ? {
          url: required('SUPABASE_PROD_URL'),
          serviceKey: required('SUPABASE_PROD_SERVICE_ROLE_KEY')
        }
      : {
          url: required('SUPABASE_TEST_URL'),
          serviceKey: required('SUPABASE_TEST_SERVICE_ROLE_KEY')
        },

  upstash: () => ({
    url: required('UPSTASH_VECTOR_REST_URL'),
    token: required('UPSTASH_VECTOR_REST_TOKEN')
  }),

  aws: () => ({
    accessKeyId: required('AWS_ACCESS_KEY_ID'),
    secretAccessKey: required('AWS_SECRET_ACCESS_KEY'),
    region: optional('AWS_REGION', 'us-east-1')
  }),
  demoBucket: optional('DEMO_S3_BUCKET', 'demo.untap-ai.com'),
  demoBaseUrl: optional('DEMO_BASE_URL', 'https://demo.untap-ai.com'),

  // Where the demo page's footer CTA sends a prospect who wants the widget on
  // their own site. The demo page is otherwise a dead end — the only conversion
  // path was replying to the "demo ready" email.
  demoCtaUrl: optional('DEMO_CTA_URL', 'https://untap-ai.com/pricing'),
  demoCtaEmail: optional('DEMO_CTA_EMAIL', 'contact@untap-ai.com'),

  widgetScriptUrl: optional(
    'WIDGET_SCRIPT_URL',
    'https://djwdzs5n3r4m2.cloudfront.net/0.4/index.js'
  ),

  crawlerDir: () => required('CRAWLER_DIR'),
  crawlerPython: optional('CRAWLER_PYTHON', 'python3'),
  // Depth 1 only reaches pages linked directly off the homepage. Depth 2 picks
  // up the next hop (a menu linked from a menus index, a service detail page),
  // which is where specifics tend to live. Safe to raise now that the page cap
  // below is actually enforced by the crawler.
  crawlerMaxDepth: (isProd: boolean) =>
    isProd
      ? optional('CRAWLER_MAX_DEPTH_PROD', '2')
      : optional('CRAWLER_MAX_DEPTH_TEST', '2'),
  // Hard cap on pages visited by the deep RAG crawl. Depth alone isn't a bound —
  // depth 2 on a site with a large footer nav could otherwise be hundreds of
  // pages.
  crawlerMaxPages: optional('CRAWLER_MAX_PAGES', '100'),

  // Number of pages the shallow demo-prep scrape fetches (homepage + internal
  // links, ranked by relevance — see web-crawler/scrape_page.py's PATH_PRIORITIES).
  scrapeMaxPages: optional('SCRAPE_MAX_PAGES', '8'),
  // How many of those scraped pages get fed to the content-analysis LLM call.
  // Kept as its own knob (rather than reusing scrapeMaxPages) since a much
  // larger scrape shouldn't necessarily balloon the prompt.
  analysisMaxPages: optionalInt('ANALYSIS_MAX_PAGES', 8),

  // Hard bounds on the two Python subprocesses. Both spawn Chrome, and a hung
  // browser would otherwise pin a queue worker slot forever. Sized for a depth-1
  // / 100-page crawl parallelized per Phase 3 (~6-8min in practice); the 5min
  // fixed LLM-call budget between them is accounted for by the assertion in
  // queue/worker.ts, not by these values themselves.
  scrapeTimeoutMs: optionalInt('SCRAPE_TIMEOUT_MS', 5 * 60 * 1000),
  crawlTimeoutMs: optionalInt('CRAWL_TIMEOUT_MS', 20 * 60 * 1000),

  /* ---- Demo request queue (Supabase table polled by the worker) ---- */
  // The queue always lives in the prod project, independent of a row's is_prod
  // (which only selects where that demo's company config gets written).
  queueSupabase: () => ({
    url: required('SUPABASE_PROD_URL'),
    serviceKey: required('SUPABASE_PROD_SERVICE_ROLE_KEY')
  }),
  queueEnabled: optional('DEMO_QUEUE_ENABLED', 'true') !== 'false',
  queuePollIntervalMs: optionalInt('DEMO_POLL_INTERVAL_MS', 10_000),
  queueConcurrency: optionalInt('DEMO_WORKER_CONCURRENCY', 2),
  // A row claimed longer than this is assumed dead (pm2 restart, reboot, OOM)
  // and is returned to the queue. Must exceed scrape + crawl timeouts combined,
  // or the reaper will steal rows out from under a healthy worker.
  queueStaleMinutes: optionalInt('DEMO_STALE_MINUTES', 45),

  /* ---- SendGrid (demo-ready notification) ---- */
  // Optional: unset means email is skipped with a warning, so `POST /demos` and
  // local runs work without it.
  sendgridApiKey: (): string | undefined => process.env.SENDGRID_API_KEY,
  demoAlertEmail: optional('DEMO_ALERT_EMAIL', 'contact@untap-ai.com'),

  /* ---- Conversion funnel (post-demo lifecycle poller) ---- */
  // Off by default so enabling the sequence is a deliberate deploy-time choice.
  funnelEnabled: optional('FUNNEL_ENABLED', 'false') === 'true',
  funnelPollIntervalMs: optionalInt('FUNNEL_POLL_INTERVAL_MS', 60_000),
  // Only demos completed after this ISO timestamp enter the funnel, so turning
  // the poller on doesn't email a backlog of stale prospects. Default: the Unix
  // epoch is wrong here (would sweep everything), so require it be set to opt a
  // window in; unset means "only demos completed from now on" via the fallback.
  funnelBackfillSince: optional(
    'FUNNEL_BACKFILL_SINCE',
    '1970-01-01T00:00:00Z'
  ),
  // Comma-separated IPs whose demo chats are the team's own testing, excluded
  // from the engagement signal so we don't email ourselves a trial offer.
  funnelTeamIps: (process.env.FUNNEL_TEAM_IPS || '')
    .split(',')
    .map(ip => ip.trim())
    .filter(Boolean),
  // How long to wait after a prospect first engages before sending the trial
  // offer. A short pause makes the founder note read as a human noticing and
  // replying, not a bot firing the instant they type.
  trialOfferDelayMinutes: optionalInt('TRIAL_OFFER_DELAY_MINUTES', 60),
  nudgeAfterDays: optionalInt('NUDGE_AFTER_DAYS', 3),
  trialLengthDays: optionalInt('TRIAL_LENGTH_DAYS', 14),
  trialEndingLeadDays: optionalInt('TRIAL_ENDING_LEAD_DAYS', 2),
  // Base for the install-guide deep links in funnel emails.
  installBaseUrl: optional('INSTALL_BASE_URL', 'https://untap-ai.com/install')
}
