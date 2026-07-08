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
          'https://dialogue-foundry-backend-v2-test.onrender.com'
        )
      : optional(
          'API_BASE_URL_TEST',
          'https://dialogue-foundry-backend-smokebox-swjv.onrender.com/api'
        ),

  crawlerDir: () => required('CRAWLER_DIR'),
  crawlerPython: optional('CRAWLER_PYTHON', 'python3'),
  crawlerMaxDepth: (isProd: boolean) =>
    isProd
      ? optional('CRAWLER_MAX_DEPTH_PROD', '3')
      : optional('CRAWLER_MAX_DEPTH_TEST', '0'),

  // Number of pages the demo-prep scrape reads for content analysis.
  scrapeMaxPages: optional('SCRAPE_MAX_PAGES', '5')
}
