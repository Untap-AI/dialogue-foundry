import { useCallback } from 'react'
import type { MutableRefObject } from 'react'
import type { AutoScrollController } from '../../../../shared/interactions/autoScroll/type'

type LastActiveSegmentData = { uid: string; div: HTMLDivElement }

export const useLastActiveSegmentChangeHandler = (
  autoScrollController: AutoScrollController | undefined,
  lastActiveSegmentIdRef: MutableRefObject<string | undefined>
) => {
  return useCallback(
    (data: LastActiveSegmentData | undefined) => {
      if (!autoScrollController) {
        return
      }

      if (data) {
        lastActiveSegmentIdRef.current = data.uid
        autoScrollController.handleNewChatSegmentAdded(data.uid, data.div)
      }
    },
    [autoScrollController]
  )
}
