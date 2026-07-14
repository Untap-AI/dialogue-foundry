---
"@dialogue-foundry/frontend": patch
---

Widget now resolves appearance config from the backend. On load it fetches `GET /api/widget-config/:companyId` and merges the result as `{ ...defaults, ...backendConfig, ...embedConfig }`, so any inline `#dialogue-foundry-config` JSON still wins per-field and the fetch fails open (bounded timeout, errors ignored). Adds a minimal single-script embed path — `#dialogue-foundry-widget` with a `data-company-id` attribute — that needs no inline JSON blob, resolving `apiBaseUrl` from the build-time `VITE_API_BASE_URL` (or a per-company override).

Patch release on purpose: it keeps the bundle on the `0.4/index.js` CDN path so existing embeds pick up the new behavior automatically.
