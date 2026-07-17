// Helpers for turning a request Origin header into a normalized hostname and
// deciding whether that host represents a real customer install (vs. our own
// demo/hosted pages or local development).

// Parses an Origin header into a lowercased hostname with a leading "www."
// stripped. Returns undefined when the header is missing or unparseable.
export const normalizeHostname = (
  originHeader: string | undefined
): string | undefined => {
  if (!originHeader) return undefined
  try {
    const { hostname } = new URL(originHeader)
    return hostname.toLowerCase().replace(/^www\./, '')
  } catch {
    return undefined
  }
}

// Hosts that are ours (the hosted demo page, the marketing site) or local dev.
// A beacon from one of these is not a customer install and must not be recorded.
const NON_INSTALL_HOSTS = new Set([
  'demo.untap-ai.com',
  'untap-ai.com',
  'localhost',
  '127.0.0.1',
  '0.0.0.0'
])

// True when a normalized hostname represents a real customer site install.
export const isTrackableInstallDomain = (domain: string): boolean => {
  if (NON_INSTALL_HOSTS.has(domain)) return false
  // Local network / loopback aliases developers hit while testing.
  if (domain.endsWith('.local') || domain.endsWith('.localhost')) return false
  return true
}
