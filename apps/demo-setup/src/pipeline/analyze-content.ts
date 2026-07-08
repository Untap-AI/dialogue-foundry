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
    /* Rendered through Streamdown (see apps/frontend/src/components/response.tsx),
     * so markdown formats correctly — but the widget is a narrow column, and a
     * heading or a bulleted list reads as clutter in a greeting. */
    welcomeMessage: {
      type: 'string',
      description:
        'A chat-widget greeting in GitHub-flavored markdown. Exactly two parts, separated by a blank line: (1) one short bold opening line that names the company, e.g. "**Welcome to Acme Roofing!**", and (2) a single sentence, in second person, saying what you can help the visitor with — grounded in what this business actually offers. No headings, no lists, no links, no emoji. Under 40 words total.'
    },
    suggestions: {
      type: 'array',
      minItems: 4,
      maxItems: 4,
      description:
        'Four starter questions a real customer would ask this specific business. Each must be answerable from the website content above — never invent a service, product, policy, or location that is not present in the content. Cover four different topics.',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['label', 'prompt'],
        properties: {
          /* The widget renders `suggestion.label || suggestion.prompt` inside a
           * ~140px button. A full question wraps to four cramped lines. */
          label: {
            type: 'string',
            description:
              'Button text for this question: 2-4 words, Title Case, no punctuation. Must read clearly in a narrow 140px button. Example: "Wedding Venues".'
          },
          prompt: {
            type: 'string',
            description:
              'The full question the button asks, phrased in the customer\'s own voice. Max 12 words. Example: "Do you host weddings, and what does it cost?"'
          }
        }
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
  const content = pages.slice(0, env.analysisMaxPages).join('\n\n---\n\n')

  const { object } = await generateObject({
    model: anthropic(env.modelAnalysis),
    schema: analysisSchema,
    system:
      'You extract business details from website content for a customer-facing chat widget. Use only information present in the content, and use the business name exactly as it appears on the site. Never invent facts the content does not state.',
    prompt: `Website content:\n\n${content}`
  })

  return object
}
