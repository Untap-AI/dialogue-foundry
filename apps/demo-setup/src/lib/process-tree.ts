import { logger } from './logger'
import type { ChildProcess } from 'node:child_process'

/* Kills a child and everything it spawned.
 *
 * The Python crawler launches Chrome via Playwright. Signalling only the Python
 * PID leaves those browsers running — that's how orchestrator.py runs ended up
 * lingering for hours holding CLOSE_WAIT sockets. Children spawned with
 * `detached: true` lead their own process group, so a negative PID signals the
 * whole group in one call. */
export const killProcessTree = (
  child: ChildProcess,
  signal: NodeJS.Signals = 'SIGKILL'
): void => {
  // exitCode is a number once the child has exited, and null while it runs.
  if (child.pid === undefined || typeof child.exitCode === 'number') return

  try {
    process.kill(-child.pid, signal)
  } catch (error) {
    // ESRCH: the group is already gone, which is the outcome we wanted. Anything
    // else means we may have leaked a process, so fall back to the bare PID.
    if ((error as NodeJS.ErrnoException).code !== 'ESRCH') {
      logger.warn(`Failed to kill process group ${child.pid}:`, error)
      try {
        child.kill(signal)
      } catch {
        // The child exited between the two calls. Nothing left to kill.
      }
    }
  }
}
