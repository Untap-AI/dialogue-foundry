#!/usr/bin/env ts-node

/**
 * Mints an admin JWT for use against /api/admin/* routes.
 *
 * Usage:
 * npx ts-node scripts/generate-admin-token.ts <user_id>
 *
 * Example:
 * npx ts-node scripts/generate-admin-token.ts peyton
 */

import dotenv from 'dotenv'
import { generateAdminAccessToken } from '../src/lib/jwt-utils'

dotenv.config()

const userId = process.argv[2]

if (!userId) {
  console.error('Error: Missing required argument <user_id>.')
  console.log(`
  Usage:
    npx ts-node scripts/generate-admin-token.ts <user_id>
  `)
  process.exit(1)
}

const token = generateAdminAccessToken(userId)
console.log(token)
