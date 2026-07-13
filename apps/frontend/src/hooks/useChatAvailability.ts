import { useState, useEffect } from 'react'
import { useConfig } from '../contexts/ConfigContext'
import { logger } from '../services/logger'
import { isBotActive } from '../utils/chat-availability'
import { NETWORK_TIMEOUT_MS } from '../utils/network'

export type AvailabilityStatus = 'checking' | 'available' | 'unavailable'

/**
 * Checks whether the bot is currently within its configured active hours.
 *
 * When `activeHours` is set in the embed config the window is evaluated
 * client-side with no network call. Otherwise it falls back to the backend's
 * DB-configured hours via the availability endpoint.
 *
 * Fails open: if the availability check errors out, times out, or returns an
 * error status, the bot is treated as available so a transient backend issue
 * never hides the widget.
 */
export function useChatAvailability(): AvailabilityStatus {
  const { chatConfig, activeHours } = useConfig()
  const { apiBaseUrl, companyId } = chatConfig
  const [availabilityStatus, setAvailabilityStatus] =
    useState<AvailabilityStatus>('checking')

  useEffect(() => {
    // Embed config takes precedence: evaluate the window locally, no fetch.
    if (activeHours) {
      setAvailabilityStatus(isBotActive(activeHours) ? 'available' : 'unavailable')
      return
    }

    let cancelled = false
    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), NETWORK_TIMEOUT_MS)

    const checkAvailability = async () => {
      try {
        const response = await fetch(
          `${apiBaseUrl}/chats/availability?companyId=${encodeURIComponent(
            companyId
          )}`,
          { signal: controller.signal }
        )

        if (!response.ok) {
          if (!cancelled) setAvailabilityStatus('available')
          return
        }

        const data = await response.json()
        if (!cancelled) {
          setAvailabilityStatus(
            data.available === false ? 'unavailable' : 'available'
          )
        }
      } catch (error) {
        // Aborts from unmount/cleanup are expected — don't log or update state.
        if (cancelled) return
        logger.warning(
          'Failed to check chat availability, defaulting to available',
          {
            error
          }
        )
        setAvailabilityStatus('available')
      } finally {
        clearTimeout(timeoutId)
      }
    }

    checkAvailability()

    return () => {
      cancelled = true
      clearTimeout(timeoutId)
      controller.abort()
    }
  }, [apiBaseUrl, companyId, activeHours])

  return availabilityStatus
}
