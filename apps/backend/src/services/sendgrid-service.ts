import sgMail from '@sendgrid/mail'
import dotenv from 'dotenv'
import { getChatConfigByCompanyId } from '../db/chat-configs'
import { logger } from '../lib/logger'
import type { MailDataRequired } from '@sendgrid/mail'

dotenv.config()

// Get SendGrid API key from environment variables
const API_KEY = process.env.SENDGRID_API_KEY
const DEFAULT_TEMPLATE_ID = 'd-010e0d2e7c14484e923e40f7ffab2fc1'
const UNBRANDED_TEMPLATE_ID = 'd-7b58dc32ebc34bdab186cfd2b6b220a7'

if (!API_KEY) {
  throw new Error(
    'SENDGRID_API_KEY is not set in environment variables. Email functionality will not work.'
  )
} else {
  sgMail.setApiKey(API_KEY)
}

/**
 * Utility function to capitalize the first letter of a string
 * Handles edge cases like empty strings and leading whitespace
 */
const capitalizeFirstLetter = (text: string): string => {
  if (!text) return text
  const trimmed = text.trim()
  if (!trimmed) return text
  return trimmed.charAt(0).toUpperCase() + trimmed.slice(1)
}

/**
 * Utility function to strip markdown formatting from text
 * Makes the text more readable in plain text email format
 */
const stripMarkdown = (text: string): string => {
  return text
    // Remove headers (## Header -> Header)
    .replace(/^#{1,6}\s+/gm, '')
    // Remove bold formatting (**text** -> text)
    .replace(/\*\*(.*?)\*\*/g, '$1')
    // Remove italic formatting (*text* -> text)
    .replace(/\*(.*?)\*/g, '$1')
    // Remove links [text](url) -> text
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    // Remove inline code `code` -> code
    .replace(/`([^`]+)`/g, '$1')
    // Remove code blocks ```code``` -> code
    .replace(/```[\s\S]*?```/g, (match) => {
      // Extract just the code content, removing the language identifier
      return match.replace(/```[\w]*\n?/g, '').replace(/```/g, '')
    })
    // Clean up bullet points and lists
    .replace(/^\s*[-*+]\s+/gm, '• ')
    // Clean up numbered lists
    .replace(/^\s*\d+\.\s+/gm, (_match, offset, string) => {
      const lineStart = string.lastIndexOf('\n', offset) + 1
      const indent = string.slice(lineStart, offset)
      return indent + '• '
    })
    // Remove horizontal rules
    .replace(/^---+$/gm, '')
    // Clean up extra whitespace and line breaks
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

// TODO: Create zod schema for email data and use in function tool
export interface EmailData {
  userEmail: string
  subject: string
  conversationSummary: string
  recentMessages: {
    role: string
    content: string
  }[]
  companyId: string
  isUnbranded?: boolean
}

/**
 * Sends an email using SendGrid template
 * @param emailData The data needed to send the email
 * @returns Promise that resolves when the email is sent
 */
export const sendInquiryEmail = async (
  {
    userEmail,
    subject,
    conversationSummary,
    recentMessages,
    companyId,
    isUnbranded = false
  }: EmailData
): Promise<boolean> => {
  try {
    // Get company configuration to check for custom template ID
    const companyConfig = await getChatConfigByCompanyId(companyId)

    if (!companyConfig) {
      logger.error(
        `No company config found for company ID: ${companyId}`,
        {
          companyId: companyId,
          service: 'sendgrid-service'
        }
      )
      return false
    }

    // Format recent messages for better readability in the email
    const formattedMessages = recentMessages.map(msg => ({
      role: msg.role.charAt(0).toUpperCase() + msg.role.slice(1), // Capitalize role
      content: stripMarkdown(msg.content) // Strip markdown formatting
    }))

    // Convert messages to presentable format for email with better structure
    const chatHistory = formattedMessages
      .map(msg => {
        // Add visual separation and structure
        const separator = msg.role === 'User' ? '👤' : '🤖'
        return `${separator} ${msg.role}:\n${msg.content}`
      })
      .join('\n\n' + '─'.repeat(50) + '\n\n')

    // Define support email - required for SendGrid
    const supportEmail = companyConfig.support_email

    // This should never happen, but is required for type safety
    if (!supportEmail) {
      logger.error(
        `No support email found for company ID: ${companyId}`,
        {
          companyId: companyId,
          service: 'sendgrid-service'
        }
      )
      return false
    }

    const templateId = isUnbranded ? UNBRANDED_TEMPLATE_ID : DEFAULT_TEMPLATE_ID

    // Capitalize the first letter of the subject
    const capitalizedSubject = capitalizeFirstLetter(subject)

    // Create the email with proper types
    const msg = {
      to: [{ email: supportEmail }],
      from: {
        email: 'peyton@untap-ai.com',
        name: isUnbranded ? 'AI Assistant' : 'Untap AI'  
      },
      templateId,
      dynamicTemplateData: {
        subject: capitalizedSubject,
        conversationSummary,
        chatHistory,
        userEmail: userEmail,
        date: new Date().toLocaleDateString('en-US', {
          year: 'numeric',
          month: 'long',
          day: 'numeric'
        })
      },
      hideWarnings: true
    } as const satisfies MailDataRequired

    // Send the email
    await sgMail.send(msg)
    
    return true
  } catch (error) {
    logger.error('Error sending email', {
      error: error as Error,
      userEmail: userEmail,
      companyId: companyId,
      service: 'sendgrid-service'
    })
    if (error.response) {
      logger.error('SendGrid API response error details', {
        responseBody: error.response.body,
        service: 'sendgrid-service'
      })
    }
    return false
  }
}
