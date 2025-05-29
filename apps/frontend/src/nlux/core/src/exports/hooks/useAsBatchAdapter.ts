import { useMemo } from 'react'
import type { DependencyList } from 'react'
import type { BatchSend } from '../../../../shared/types/adapters/chat/chatAdapter'
import type { ChatAdapter } from '../../types/chatAdapter'

/**
 * Use the function provided as a batch adapter to send and receive messages in a single batch.
 *
 * @param send
 * @param dependencies
 */
export const useAsBatchAdapter = function <AiMsg = string>(
  send: BatchSend<AiMsg>,
  dependencies?: DependencyList
): ChatAdapter<AiMsg> {
  return useMemo(
    () => ({ batchText: send }),
    dependencies ?? [{}] // If no dependencies are provided, we use an empty object to force the hook
    // to run every time (no memoization).
  )
}
