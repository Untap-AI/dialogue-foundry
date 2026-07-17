import express from 'express'
import NodeCache from 'node-cache'
import { getWidgetConfigByCompanyId } from '../db/widget-configs'
import { recordWidgetInstall } from '../db/widget-installs'
import { normalizeHostname, isTrackableInstallDomain } from '../lib/origin'
import { logger } from '../lib/logger'
import type { WidgetConfigWithHours } from '../db/widget-configs'

const router = express.Router()

// Collapses every widget page load to ~1 Supabase round trip per company per
// minute. Keyed by companyId; values are the serialized response body.
const CACHE_TTL_SECONDS = 60
const cache = new NodeCache({ stdTTL: CACHE_TTL_SECONDS, useClones: false })

// Write throttle for the install beacon: at most one DB write per
// (company, domain) per 10 minutes per instance. last_seen freshness within
// that window is plenty for an active/inactive signal, and it keeps a busy
// customer site from hammering the RPC on every pageview.
const INSTALL_THROTTLE_SECONDS = 600
const installThrottle = new NodeCache({
  stdTTL: INSTALL_THROTTLE_SECONDS,
  useClones: false
})

// Detect a real-site install from the request Origin and record it. Runs before
// the cache lookup (cache hits must still refresh last_seen) and is fire-and-
// forget so it can never slow or fail the config response.
const recordInstallFromOrigin = (
  companyId: string,
  originHeader?: string
): void => {
  const domain = normalizeHostname(originHeader)
  if (!domain || !isTrackableInstallDomain(domain)) return

  const throttleKey = `${companyId}|${domain}`
  if (installThrottle.get(throttleKey)) return
  installThrottle.set(throttleKey, true)

  void recordWidgetInstall(companyId, domain)
}

/**
 * Maps DB rows to the DialogueFoundryConfig-shaped JSON the frontend merges
 * in verbatim. Fields are omitted (never sent as explicit null) so the
 * frontend's {...defaults, ...backendConfig, ...embedConfig} merge can't have
 * a null stomp a default. activeHours is included only when all three
 * columns are set, mirroring isBotActive's all-or-nothing semantics.
 */
const serializeWidgetConfig = ({
  widgetConfig,
  activeHours
}: WidgetConfigWithHours): Record<string, unknown> => {
  const response: Record<string, unknown> = {}

  if (widgetConfig) {
    if (widgetConfig.title) response.title = widgetConfig.title
    if (widgetConfig.logo_url) response.logoUrl = widgetConfig.logo_url
    if (widgetConfig.popup_message)
      response.popupMessage = widgetConfig.popup_message
    if (widgetConfig.welcome_message)
      response.welcomeMessage = widgetConfig.welcome_message
    if (widgetConfig.open_on_load)
      response.openOnLoad = widgetConfig.open_on_load
    if (widgetConfig.theme) response.theme = widgetConfig.theme

    const suggestions = widgetConfig.suggestions as unknown[]
    if (Array.isArray(suggestions) && suggestions.length > 0) {
      response.suggestions = suggestions
    }

    const poweredBy = widgetConfig.powered_by as Record<string, unknown>
    if (poweredBy && Object.keys(poweredBy).length > 0) {
      response.poweredBy = poweredBy
    }

    const styles = widgetConfig.styles as Record<string, unknown>
    if (styles && Object.keys(styles).length > 0) {
      response.styles = styles
    }

    const locales = widgetConfig.locales as Record<string, unknown>
    if (locales && Object.keys(locales).length > 0) {
      response.locales = locales
    }
  }

  if (
    activeHours?.timezone &&
    activeHours.active_start_time &&
    activeHours.active_end_time
  ) {
    response.activeHours = {
      timezone: activeHours.timezone,
      startTime: activeHours.active_start_time,
      endTime: activeHours.active_end_time
    }
  }

  return response
}

// Public endpoint: no auth (CORS is already wide open). Absence of a config
// row is the expected common case (every pre-migration customer), so it's
// always a 200 with a partial/empty body -- never a 404. Genuine failures are
// the only 500s; the frontend fails open regardless.
router.get('/:companyId', async (req, res) => {
  const { companyId } = req.params

  // Install beacon: the widget fetches this on every boot, so the Origin header
  // tells us which site it's running on. Recorded before the cache lookup so a
  // cache hit still refreshes the install's last_seen.
  recordInstallFromOrigin(companyId, req.headers.origin)

  try {
    const cached = cache.get<Record<string, unknown>>(companyId)
    if (cached) {
      res.set('Cache-Control', 'public, max-age=30')
      return res.json(cached)
    }

    const result = await getWidgetConfigByCompanyId(companyId)
    const body = serializeWidgetConfig(result)

    cache.set(companyId, body)
    res.set('Cache-Control', 'public, max-age=30')
    return res.json(body)
  } catch (error) {
    logger.error('Error getting widget config', { error: error as Error })
    return res.status(500).json({ error: 'Failed to get widget config' })
  }
})

export default router
