import dns from 'node:dns/promises'
import net from 'node:net'

/* SSRF guard for the caller-supplied company website. The service resolves and
 * scrapes whatever URL is submitted, so we must reject anything pointing at
 * internal infrastructure (cloud metadata endpoints, loopback, private LANs)
 * before any request is made.
 *
 * Known limitation: this validates the hostname once, up front; the actual
 * fetch happens later in a separate crawl4ai/Playwright subprocess that
 * re-resolves the hostname itself. A DNS host that resolves to a public IP
 * here and rebinds to a private one by the time the browser connects would
 * slip through (TOCTOU). Closing that fully means pinning the resolved IP
 * through to the browser layer, which isn't practical with crawl4ai today.
 * Accepted as a residual risk for now — this guard still blocks the common
 * cases (literal metadata/loopback/RFC1918 addresses and hostnames that
 * resolve to them at request time). */

export class SsrfError extends Error {}

const isPrivateIPv4 = (ip: string): boolean => {
  const [a, b] = ip.split('.').map(Number)
  if (a === 10) return true // 10.0.0.0/8
  if (a === 127) return true // loopback
  if (a === 0) return true // 0.0.0.0/8
  if (a === 169 && b === 254) return true // link-local (incl. 169.254.169.254)
  if (a === 172 && b >= 16 && b <= 31) return true // 172.16.0.0/12
  if (a === 192 && b === 168) return true // 192.168.0.0/16
  if (a === 100 && b >= 64 && b <= 127) return true // CGNAT 100.64.0.0/10
  if (a >= 224) return true // multicast + reserved
  return false
}

const isPrivateIPv6 = (ip: string): boolean => {
  const lower = ip.toLowerCase()
  if (lower === '::1' || lower === '::') return true // loopback / unspecified
  if (lower.startsWith('fe80')) return true // link-local
  if (lower.startsWith('fc') || lower.startsWith('fd')) return true // unique local
  // IPv4-mapped (::ffff:a.b.c.d) — validate the embedded v4 address.
  const mapped = lower.match(/::ffff:(\d+\.\d+\.\d+\.\d+)$/)
  if (mapped) return isPrivateIPv4(mapped[1])
  return false
}

const isPrivateAddress = (ip: string): boolean =>
  net.isIPv4(ip) ? isPrivateIPv4(ip) : isPrivateIPv6(ip)

/* Validates a URL for outbound fetching: must be http(s), must have a hostname,
 * and every resolved address must be public. Returns the normalized href.
 * Throws SsrfError on any violation. */
export const assertSafeUrl = async (rawUrl: string): Promise<string> => {
  let url: URL
  try {
    url = new URL(rawUrl)
  } catch {
    throw new SsrfError(`Invalid URL: ${rawUrl}`)
  }

  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new SsrfError(`Unsupported protocol: ${url.protocol}`)
  }

  const host = url.hostname
  if (!host) throw new SsrfError('URL has no hostname')

  // A literal IP in the URL — check it directly.
  if (net.isIP(host)) {
    if (isPrivateAddress(host)) {
      throw new SsrfError(`Refusing to fetch private address: ${host}`)
    }
    return url.href
  }

  // Resolve the hostname and reject if any address is private/reserved.
  let addresses: { address: string }[]
  try {
    addresses = await dns.lookup(host, { all: true })
  } catch {
    throw new SsrfError(`Could not resolve host: ${host}`)
  }

  if (addresses.length === 0) {
    throw new SsrfError(`Host did not resolve: ${host}`)
  }

  for (const { address } of addresses) {
    if (isPrivateAddress(address)) {
      throw new SsrfError(
        `Host ${host} resolves to a private address (${address})`
      )
    }
  }

  return url.href
}
