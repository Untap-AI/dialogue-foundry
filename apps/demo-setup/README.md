# @dialogue-foundry/demo-setup

Generates a custom Dialogue Foundry demo for a company from just its website.
This is the code-based replacement for the old n8n "Demo Setup" sub-workflow.

Given a company's name, website, and contact info it will:

1. Validate the website against SSRF (reject private/loopback/reserved targets),
   then scrape it with a **real browser** (crawl4ai, reusing the deep crawler's
   anti-bot-tuned config) for page content + rendered homepage HTML
2. Run **two Claude calls** (down from six LLM nodes in n8n):
   - content analysis → business summary, contact phone, welcome message, 4 starter suggestions
   - brand detection → logo, primary color, font family (only for values not supplied)
3. Run a quality gate that repairs/falls back on any empty or malformed field
   before anything is published
4. Assemble the widget system prompt deterministically in code (no LLM)
5. Upsert the `companies` and `chat_configs` rows in Supabase
6. Build the primary + secondary widget pages (escaping the inlined JSON against
   script-injection from untrusted scraped content) and upload them to the demo S3 bucket
7. Kick off the local Python web-crawler in the background to seed the company's
   Upstash Vector namespace (replaces the old per-company Render cron job)

Pinecone and Tavily have both been removed. Scraping runs entirely through the
local crawl4ai stack (no scraping vendor, no Node-side network fetches — closing
the SSRF surface a naive `fetch()` would have). The crawler and backend both use
Upstash Vector namespaces. The `chat_configs.pinecone_index_name` column is
retained for backwards compatibility and holds the Upstash namespace
(`{companyId}-df`).

## API

`POST /demos`

```json
{
  "companyId": "acme-1234",
  "companyName": "Acme Co",
  "companyWebsite": "acme.com",
  "companyEmail": "hello@acme.com",
  "companyPhone": "555-123-4567",
  "isProd": false,
  "logoUrl": "",
  "styles": { "primaryColor": "", "fontFamily": "" }
}
```

Returns `201 { "demoUrl": "https://demo.untap-ai.com/acme-1234/" }`. The demo is
live immediately; RAG answers become available once the background crawl
finishes.

`GET /health` → `{ "status": "ok" }`

Set `DEMO_SETUP_API_KEYS` (comma-separated) to require a `Authorization: Bearer
<key>` header on `POST /demos`. Leave unset on a private network.

## Running on the mac-mini

Because the service spawns local Python subprocesses (both the shallow
demo-prep scrape and the background crawl), running it natively with pm2 is
simplest:

```bash
cp apps/demo-setup/.env.example apps/demo-setup/.env   # fill in values
pnpm --filter @dialogue-foundry/demo-setup build
pm2 start apps/demo-setup/ecosystem.config.cjs
```

Point `CRAWLER_DIR` at your `web-crawler` checkout and `CRAWLER_PYTHON` at its
virtualenv's Python so the crawler's dependencies are available.

A `Dockerfile` is included as an alternative, but note the crawler must be
reachable from inside the container (mount `CRAWLER_DIR` + install its Python
deps) for the background crawl step to work.

## Development

```bash
pnpm --filter @dialogue-foundry/demo-setup dev   # ts-node-dev, hot reload
```
