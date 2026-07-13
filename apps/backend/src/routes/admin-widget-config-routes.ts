import express from 'express'
import { z } from 'zod'
import {
  getWidgetConfigByCompanyId,
  upsertWidgetConfig,
  deleteWidgetConfig
} from '../db/widget-configs'
import { authenticateAdmin } from '../middleware/auth-middleware'
import { logger } from '../lib/logger'
import type { Json } from '../types/database'

const router = express.Router()

// Shared with scripts/upsert-widget-config.ts so the CLI and the HTTP route
// accept exactly the same shape.
export const widgetConfigInputSchema = z.object({
  title: z.string().max(200).optional(),
  logoUrl: z.string().max(2000).optional(),
  popupMessage: z.string().max(1000).optional(),
  welcomeMessage: z.string().max(5000).optional(),
  openOnLoad: z.enum(['all', 'mobile-only', 'desktop-only', 'none']).optional(),
  theme: z.enum(['primary', 'secondary']).optional(),
  suggestions: z
    .array(z.object({ label: z.string().optional(), prompt: z.string() }))
    .optional(),
  poweredBy: z
    .object({
      text: z.string().optional(),
      url: z.string().optional(),
      show: z.boolean().optional()
    })
    .optional(),
  styles: z
    .object({
      primaryColor: z.string().optional(),
      secondaryColor: z.string().optional(),
      mutedColor: z.string().optional(),
      accentColor: z.string().optional(),
      backgroundColor: z.string().optional(),
      foregroundColor: z.string().optional(),
      fontFamily: z.string().optional()
    })
    .optional(),
  locales: z.record(z.string(), z.record(z.string(), z.unknown())).optional()
})

export type WidgetConfigInput = z.infer<typeof widgetConfigInputSchema>

const toRow = (input: WidgetConfigInput) => ({
  title: input.title,
  logo_url: input.logoUrl,
  popup_message: input.popupMessage,
  welcome_message: input.welcomeMessage,
  open_on_load: input.openOnLoad,
  theme: input.theme,
  suggestions: (input.suggestions ?? []) as unknown as Json,
  powered_by: (input.poweredBy ?? {}) as unknown as Json,
  styles: (input.styles ?? {}) as unknown as Json,
  locales: (input.locales ?? {}) as unknown as Json
})

router.get('/:companyId', authenticateAdmin, async (req, res) => {
  try {
    const { widgetConfig } = await getWidgetConfigByCompanyId(
      req.params.companyId
    )
    if (!widgetConfig) {
      return res.status(404).json({ error: 'Widget config not found' })
    }
    return res.json(widgetConfig)
  } catch (error) {
    logger.error('Error getting widget config (admin)', {
      error: error as Error
    })
    return res.status(500).json({ error: 'Failed to get widget config' })
  }
})

router.put('/:companyId', authenticateAdmin, async (req, res) => {
  const parseResult = widgetConfigInputSchema.safeParse(req.body)
  if (!parseResult.success) {
    return res.status(400).json({
      error: 'Invalid request body',
      details: parseResult.error.issues
    })
  }

  try {
    const row = await upsertWidgetConfig(
      req.params.companyId,
      toRow(parseResult.data)
    )
    return res.json(row)
  } catch (error) {
    logger.error('Error upserting widget config (admin)', {
      error: error as Error
    })
    return res.status(500).json({ error: 'Failed to upsert widget config' })
  }
})

router.delete('/:companyId', authenticateAdmin, async (req, res) => {
  try {
    const deleted = await deleteWidgetConfig(req.params.companyId)
    if (!deleted) {
      return res.status(404).json({ error: 'Widget config not found' })
    }
    return res.status(204).send()
  } catch (error) {
    logger.error('Error deleting widget config (admin)', {
      error: error as Error
    })
    return res.status(500).json({ error: 'Failed to delete widget config' })
  }
})

export default router
