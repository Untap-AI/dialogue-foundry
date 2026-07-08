import { anthropic } from '@ai-sdk/anthropic'
import { generateObject, jsonSchema } from 'ai'
import { env } from '../config/env'
import type { ContentAnalysis } from '../types'

/* JSON schema (rather than a zod schema) to stay decoupled from the workspace's
 * mixed zod v3/v4 versions, which otherwise conflict with the AI SDK types. */
const analysisSchema = jsonSchema<ContentAnalysis>({
  type: 'object',
  additionalProperties: false,
  required: [
    'businessName',
    'summary',
    'whatTheyOffer',
    'whoItsFor',
    'contactPhone',
    'welcomeMessage',
    'suggestions'
  ],
  properties: {
    businessName: {
      type: 'string',
      description: 'The exact business name as it appears on the website'
    },
    summary: {
      type: 'string',
      description: 'A concise summary of what the business is and does'
    },
    whatTheyOffer: {
      type: 'string',
      description: 'The core products or services the business offers'
    },
    whoItsFor: {
      type: 'string',
      description: 'The target audience or ideal customer'
    },
    contactPhone: {
      type: 'string',
      description:
        'The primary contact phone number, or empty string if none found'
    },
    welcomeMessage: {
      type: 'string',
      description:
        'A warm, energetic, second-person greeting for a website chat widget. Mention the company name once. Max 60 words. Use \\n for line breaks.'
    },
    suggestions: {
      type: 'array',
      minItems: 4,
      maxItems: 4,
      description:
        'Four full questions a customer would typically ask, each max 10 words',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['prompt'],
        properties: { prompt: { type: 'string' } }
      }
    }
  }
})

/* Single LLM call that replaces the old "Format Data for System Prompt" and
 * "Formats scraped data" nodes. Extracts the business facts used to build the
 * system prompt plus the widget welcome message and starter suggestions. */
export const analyzeContent = async (
  pages: string[]
): Promise<ContentAnalysis> => {
  const content = pages.slice(0, 5).join('\n\n---\n\n')

  const { object } = await generateObject({
    model: anthropic(env.modelAnalysis),
    schema: analysisSchema,
    system:
      'You extract business details from website content for a customer-facing chat widget. Use only information present in the content, and use the business name exactly as it appears on the site.',
    prompt: `Website content:\n\n${content}`
  })

  return object
}
