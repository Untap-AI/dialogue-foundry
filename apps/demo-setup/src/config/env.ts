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
  // Fast/cheap extraction model for content analysis + brand selection.
  modelAnalysis: optional('MODEL_ANALYSIS', 'claude-haiku-4-5'),
  // The generative copy step (welcome message + suggestions) can use a stronger
  // model for a quality bump; defaults to the same cheap model.
  modelBrand: optional('MODEL_BRAND', 'claude-haiku-4-5'),

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

  widgetScriptUrl: optional(
    'WIDGET_SCRIPT_URL',
    'https://djwdzs5n3r4m2.cloudfront.net/0.4/index.js'
  ),
  apiBaseUrl: (isProd: boolean) =>
    isProd
      ? optional(
          'API_BASE_URL_PROD',
          'https://dialogue-foundry-backend-v2-test.onrender.com/api'
        )
      : optional(
          'API_BASE_URL_TEST',
          'https://dialogue-foundry-backend-smokebox-swjv.onrender.com/api'
        ),

  crawlerDir: () => required('CRAWLER_DIR'),
  crawlerPython: optional('CRAWLER_PYTHON', 'python3'),
  crawlerMaxDepth: (isProd: boolean) =>
    isProd
      ? optional('CRAWLER_MAX_DEPTH_PROD', '0')
      : optional('CRAWLER_MAX_DEPTH_TEST', '0'),

  // Number of pages the demo-prep scrape reads for content analysis.
  scrapeMaxPages: optional('SCRAPE_MAX_PAGES', '5'),

  // Hard bounds on the two Python subprocesses. Both spawn Chrome, and a hung
  // browser would otherwise pin a queue worker slot forever.
  scrapeTimeoutMs: optionalInt('SCRAPE_TIMEOUT_MS', 5 * 60 * 1000),
  crawlTimeoutMs: optionalInt('CRAWL_TIMEOUT_MS', 15 * 60 * 1000),

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
  queueStaleMinutes: optionalInt('DEMO_STALE_MINUTES', 30),

  /* ---- SendGrid (demo-ready notification) ---- */
  // Optional: unset means email is skipped with a warning, so `POST /demos` and
  // local runs work without it.
  sendgridApiKey: (): string | undefined => process.env.SENDGRID_API_KEY,
  demoAlertEmail: optional('DEMO_ALERT_EMAIL', 'contact@untap-ai.com')
}
