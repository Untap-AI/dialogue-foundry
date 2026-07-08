# Mac-mini setup: demo-setup v2

Instructions for a Claude Code (or other agent) session running **on the
mac-mini** to pick up the `demo-setup` v2 pipeline and get it running. This
replaces the old n8n "Demo Setup" workflow with `POST /demos`.

This service depends on two repos, both need the feature branches below
(merge to `main` first if the PRs have landed by the time you read this):

- `dialogue-foundry` — branch `feat/demo-setup-pipeline` (PR [#75](https://github.com/Untap-AI/dialogue-foundry/pull/75))
- `web-crawler` — branch `feat/demo-setup-scrape-endpoint` (PR [#14](https://github.com/Untap-AI/web-crawler/pull/14))

## 1. Pull both repos

```bash
cd ~/Projects/dialogue-foundry && git fetch origin && git checkout main && git pull
cd ~/Projects/web-crawler && git fetch origin && git checkout main && git pull
```

If the PRs haven't merged yet, check out the feature branches instead of `main`.

## 2. web-crawler: Python env

A venv already exists at `~/Projects/web-crawler/venv` on this machine for the
existing deep-crawl workflow — reuse it (it already has crawl4ai + Playwright).
If it's missing or you're on a fresh machine:

```bash
cd ~/Projects/web-crawler
python3 -m venv venv
source venv/bin/activate
pip install -r requirements.txt
playwright install chromium --with-deps
```

Sanity check the new shallow-scrape entrypoint runs standalone:

```bash
source venv/bin/activate
python3 scrape_page.py https://example.com
```

Should print a single JSON line to stdout: `{"pages": [{"url": ..., "markdown": ...}], "homepageHtml": "..."}`.

## 3. dialogue-foundry: build demo-setup

```bash
cd ~/Projects/dialogue-foundry
pnpm install
pnpm --filter @dialogue-foundry/demo-setup build
```

## 4. Configure `.env`

```bash
cd ~/Projects/dialogue-foundry/apps/demo-setup
cp .env.example .env
```

Fill in (see `.env.example` for the full annotated list):

| Var | Notes |
|---|---|
| `ANTHROPIC_API_KEY` | Claude key for this service's own analysis/brand-detection calls |
| `CRAWLER_OPENAI_API_KEY` | **Different key/purpose** — the background deep crawl (`orchestrator.py`) still uses OpenAI internally. Don't conflate with `ANTHROPIC_API_KEY`. |
| `SUPABASE_PROD_URL` / `SUPABASE_PROD_SERVICE_ROLE_KEY` | prod Supabase project |
| `SUPABASE_TEST_URL` / `SUPABASE_TEST_SERVICE_ROLE_KEY` | test Supabase project |
| `UPSTASH_VECTOR_REST_URL` / `UPSTASH_VECTOR_REST_TOKEN` | shared Upstash Vector index (namespace = `{companyId}-df`) |
| `AWS_ACCESS_KEY_ID` / `AWS_SECRET_ACCESS_KEY` | S3 creds for the `demo.untap-ai.com` bucket |
| `CRAWLER_DIR` | absolute path to the `web-crawler` checkout, e.g. `/Users/Peyton/Projects/web-crawler` |
| `CRAWLER_PYTHON` | point at the venv's interpreter: `/Users/Peyton/Projects/web-crawler/venv/bin/python3` (not bare `python3`, so it picks up crawl4ai/Playwright) |
| `DEMO_SETUP_API_KEYS` | comma-separated bearer tokens for `POST /demos`; leave empty only if this is on a locked-down private network |

## 5. Start with pm2

```bash
cd ~/Projects/dialogue-foundry
pm2 start apps/demo-setup/ecosystem.config.cjs
pm2 save   # persist across reboots, assumes pm2 startup already configured on this machine
```

## 6. Verify

```bash
curl http://localhost:4000/health
# {"status":"ok","timestamp":"..."}

curl -X POST http://localhost:4000/demos \
  -H 'Content-Type: application/json' \
  -H 'Authorization: Bearer <token from DEMO_SETUP_API_KEYS>' \
  -d '{
    "companyId": "test-co",
    "companyName": "Test Co",
    "companyWebsite": "https://example.com",
    "companyEmail": "test@example.com"
  }'
# => {"demoUrl": "https://demo.untap-ai.com/test-co/"}
```

Then check:
- The demo URL loads and looks reasonable (real logo/color/welcome message/suggestions, not fallback defaults).
- `chat_configs` row written in the target Supabase project (`isProd: false` → test project).
- `pm2 logs demo-setup` shows the background crawler subprocess started and (eventually) completed — this seeds the Upstash namespace for RAG answers.

## Known limitations (carried over from PR #75)

- SSRF guard (`lib/ssrf.ts`) validates the hostname once up front; a DNS-rebinding
  attack between that check and the actual crawl4ai fetch isn't fully closed
  (would require IP-pinning inside crawl4ai/Playwright). Acceptable residual risk
  for now — the guard still blocks literal metadata/loopback/RFC1918 addresses.
- Cold-start latency: each `POST /demos` spawns a fresh browser via `scrape_page.py`
  (~seconds). If this becomes a bottleneck, the escape hatch is a warm long-running
  local scrape service instead of a subprocess per request — not built yet.
