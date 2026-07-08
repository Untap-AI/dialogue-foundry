/* Minimal structured logger. Prefixes every line with an ISO timestamp so pm2
 * and Docker logs are greppable. */
const line = (level: string, args: unknown[]) => [
  `[${new Date().toISOString()}]`,
  `[${level}]`,
  ...args
]

export const logger = {
  info: (...args: unknown[]) => console.info(...line('info', args)),
  warn: (...args: unknown[]) => console.warn(...line('warn', args)),
  error: (...args: unknown[]) => console.error(...line('error', args))
}
