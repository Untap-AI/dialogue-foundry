#!/usr/bin/env ts-node

/**
 * Upserts a company's widget_configs row directly via the service-role client
 * (no running server or admin token needed). Accepts the same shape as
 * PUT /api/admin/widget-configs/:companyId.
 *
 * Usage:
 * npx ts-node scripts/upsert-widget-config.ts <company_id> <path_to_json_file>
 *
 * Example config file:
 * {
 *   "title": "Acme Inc",
 *   "welcomeMessage": "Welcome! How can I help?",
 *   "suggestions": [{ "prompt": "What do you offer?" }]
 * }
 */

import fs from 'fs'
import { createClient } from '@supabase/supabase-js'
import dotenv from 'dotenv'
import { widgetConfigInputSchema } from '../src/routes/admin-widget-config-routes'
import type { Database, Json } from '../src/types/database'

dotenv.config()

const supabaseUrl = process.env.SUPABASE_URL
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY

if (!supabaseUrl || !supabaseServiceKey) {
  console.error('Error: SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set in .env')
  process.exit(1)
}

const supabase = createClient<Database>(supabaseUrl, supabaseServiceKey, {
  auth: { autoRefreshToken: false, persistSession: false }
})

const [companyId, configPath] = process.argv.slice(2)

if (!companyId || !configPath) {
  console.error('Error: Missing required arguments.')
  console.log(`
  Usage:
    npx ts-node scripts/upsert-widget-config.ts <company_id> <path_to_json_file>
  `)
  process.exit(1)
}

const run = async () => {
  const raw = JSON.parse(fs.readFileSync(configPath, 'utf-8'))
  const parseResult = widgetConfigInputSchema.safeParse(raw)

  if (!parseResult.success) {
    console.error('Error: Invalid config file.')
    console.error(parseResult.error.issues)
    process.exit(1)
  }

  const input = parseResult.data
  const { error } = await supabase.from('widget_configs').upsert(
    {
      company_id: companyId,
      title: input.title,
      logo_url: input.logoUrl,
      popup_message: input.popupMessage,
      welcome_message: input.welcomeMessage,
      open_on_load: input.openOnLoad,
      theme: input.theme,
      suggestions: (input.suggestions ?? []) as unknown as Json,
      powered_by: (input.poweredBy ?? {}) as unknown as Json,
      styles: (input.styles ?? {}) as unknown as Json,
      locales: (input.locales ?? {}) as unknown as Json,
      updated_at: new Date().toISOString()
    },
    { onConflict: 'company_id' }
  )

  if (error) {
    console.error(`Error upserting widget config: ${error.message}`)
    process.exit(1)
  }

  console.log(`Widget config for company ID "${companyId}" has been upserted.`)
}

run()
