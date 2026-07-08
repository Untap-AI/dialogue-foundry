import { anthropic } from '@ai-sdk/anthropic'
import { generateObject, jsonSchema } from 'ai'
import { env } from '../config/env'
import type { BrandCandidates } from './extract-brand-candidates'
import type { BrandResult, PreparedInput } from '../types'

/* JSON schema (not zod) to stay decoupled from the workspace's mixed zod
 * versions, which conflict with the AI SDK types. */
const brandSchema = jsonSchema<BrandResult>({
  type: 'object',
  additionalProperties: false,
  required: ['logoUrl', 'brandColor', 'fontFamily'],
  properties: {
    logoUrl: {
      type: 'string',
      description:
        "The URL most likely to be the site's official brand logo (prefer SVG/PNG/JPG named logo/brand over favicons). Empty string if none suitable."
    },
    brandColor: {
      type: 'string',
      description:
        'The primary brand color (bold, saturated, used for buttons/links/accents), not white/black/neutral backgrounds. Empty string if none found.'
    },
    fontFamily: {
      type: 'string',
      description:
        "The website's primary body font family (or full font stack). Empty string if none found."
    }
  }
})

/* Single LLM call that replaces the old three "Determination" nodes (logo,
 * color, font). Only invoked for signals the caller did not already supply.
 * Returns the caller-supplied values verbatim for any field already set. */
export const detectBrand = async (
  input: PreparedInput,
  candidates: BrandCandidates
): Promise<BrandResult> => {
  const supplied = {
    logoUrl: input.logoUrl,
    brandColor: input.styles?.primaryColor,
    fontFamily: input.styles?.fontFamily
  }

  // Nothing to infer — skip the LLM entirely.
  if (supplied.logoUrl && supplied.brandColor && supplied.fontFamily) {
    return {
      logoUrl: supplied.logoUrl,
      brandColor: supplied.brandColor,
      fontFamily: supplied.fontFamily
    }
  }

  const { object } = await generateObject({
    model: anthropic(env.modelBrand),
    schema: brandSchema,
    system:
      'You are a web branding analyst. Given candidate logo URLs, colors, and font families extracted from a website, select the single best value for each, following the field descriptions.',
    prompt: [
      `Logo candidates:\n${candidates.logoCandidates.join('\n') || '(none)'}`,
      `Color candidates:\n${candidates.colorCandidates.join('\n') || '(none)'}`,
      `Font candidates:\n${candidates.fontCandidates.join('\n') || '(none)'}`
    ].join('\n\n')
  })

  return {
    logoUrl: supplied.logoUrl ?? object.logoUrl,
    brandColor: supplied.brandColor ?? object.brandColor,
    fontFamily: supplied.fontFamily ?? object.fontFamily
  }
}
