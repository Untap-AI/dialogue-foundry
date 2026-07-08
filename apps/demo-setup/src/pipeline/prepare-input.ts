import { assertSafeUrl } from '../lib/ssrf'
import type { DemoInput, PreparedInput } from '../types'

const coerceBool = (value: boolean | string): boolean =>
  typeof value === 'string' ? value.toLowerCase() === 'true' : value

/* Normalizes the raw request into the shape the rest of the pipeline uses:
 * ensures the website has a protocol, validates it against SSRF (the service
 * scrapes whatever URL is submitted), and derives the RAG namespace. */
export const prepareInput = async (
  input: DemoInput
): Promise<PreparedInput> => {
  const rawWebsite = /^https?:\/\//i.test(input.companyWebsite)
    ? input.companyWebsite
    : `https://${input.companyWebsite}`

  // Throws SsrfError for private/loopback/reserved targets or bad protocols.
  const website = await assertSafeUrl(rawWebsite)

  return {
    ...input,
    companyWebsite: website,
    isProd: coerceBool(input.isProd),
    // Legacy naming: the backend reads chat_configs.pinecone_index_name and
    // uses it as the Upstash namespace. Keep the "-df" suffix for continuity.
    namespace: `${input.companyId}-df`
  }
}
