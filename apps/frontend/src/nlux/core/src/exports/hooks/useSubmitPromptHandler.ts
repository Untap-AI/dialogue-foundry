import { useCallback, useEffect, useMemo, useRef } from 'react'
import { submitPrompt } from '../../../../shared/services/submitPrompt/submitPromptImpl'
import { isStandardChatAdapter } from '../../../../shared/types/adapters/chat/standardChatAdapter'
import { NLErrors } from '../../../../shared/types/exceptions/errors'
import { warn } from '../../../../shared/utils/warn'
import { useAdapterExtras } from './useAdapterExtras'
import type { ComposerOptions, EventsMap } from '@nlux/core'
import type { ComposerStatus } from '../../../../shared/components/Composer/props'
import type { ChatAdapter as CoreChatAdapter } from '../../../../shared/types/adapters/chat/chatAdapter'
import type { ChatAdapterExtras } from '../../../../shared/types/adapters/chat/chatAdapterExtras'
import type { ServerComponentChatAdapter } from '../../../../shared/types/adapters/chat/serverComponentChatAdapter'
import type { StandardChatAdapter } from '../../../../shared/types/adapters/chat/standardChatAdapter'
import type { ChatSegment } from '../../../../shared/types/chatSegment/chatSegment'
import type { ChatSegmentAiMessage } from '../../../../shared/types/chatSegment/chatSegmentAiMessage'
import type { ChatSegmentUserMessage } from '../../../../shared/types/chatSegment/chatSegmentUserMessage'
import type { MutableRefObject } from 'react'
import type { ImperativeConversationCompProps } from '../../sections/Conversation/props'
import type { ChatAdapter } from '../../types/chatAdapter'
import type { AiChatProps } from '../props'
import { EmailSubmittedCallback } from 'src/nlux/shared/types/chatSegment/chatSegmentEvents'

type SubmitPromptHandlerProps<AiMsg> = {
  aiChatProps: AiChatProps<AiMsg>
  adapterToUse?: ChatAdapter<AiMsg> | StandardChatAdapter<AiMsg>
  prompt: string
  composerOptions?: ComposerOptions
  initialSegment?: ChatSegment<AiMsg>
  cancelledSegmentIds: Array<string>
  cancelledMessageIds: Array<string>
  newSegments: ChatSegment<AiMsg>[]
  showException: (message: string) => void
  setChatSegments: (segments: ChatSegment<AiMsg>[]) => void
  setComposerStatus: (status: ComposerStatus) => void
  setPrompt: (prompt: string) => void
  conversationRef: MutableRefObject<ImperativeConversationCompProps<AiMsg> | null>
}

export const useSubmitPromptHandler = <AiMsg>(
  props: SubmitPromptHandlerProps<AiMsg>
) => {
  const {
    aiChatProps,
    adapterToUse,
    prompt: promptTyped,
    composerOptions,
    showException,
    initialSegment,
    newSegments,
    cancelledSegmentIds,
    cancelledMessageIds,
    setChatSegments,
    setComposerStatus,
    setPrompt,
    conversationRef
  } = props

  const hasValidInput = useMemo(() => promptTyped.length > 0, [promptTyped])

  // The prompt typed will be read by the submitPrompt function, but it will not be used as a
  // dependency for the submitPrompt function (only the promptToSubmit is a dependency to useCallback).
  // Hence, the use of useRef to store the value and access it within the submitPrompt function, without
  // causing the memoized function to be re-created.
  const promptTypedRef = useRef(promptTyped)
  promptTypedRef.current = promptTyped

  // React functions and state that can be accessed by non-React DOM update code
  const domToReactRef = useRef({
    newSegments,
    cancelledSegmentIds,
    cancelledMessageIds,
    setChatSegments,
    setComposerStatus,
    showException,
    setPrompt
  })

  // Callback events can be used by the non-React DOM update code
  const callbackEvents = useRef<Partial<EventsMap<AiMsg> & {
    emailSubmitted: EmailSubmittedCallback
  }>>({})

  useEffect(() => {
    domToReactRef.current = {
      newSegments,
      cancelledSegmentIds,
      cancelledMessageIds,
      setChatSegments,
      setComposerStatus,
      showException,
      setPrompt
    }
  }, [
    newSegments,
    cancelledSegmentIds,
    cancelledMessageIds,
    setChatSegments,
    setComposerStatus,
    showException,
    setPrompt
  ])

  const adapterExtras: ChatAdapterExtras<AiMsg> = useAdapterExtras(
    aiChatProps,
    initialSegment ? [initialSegment, ...newSegments] : newSegments,
    aiChatProps.conversationOptions?.historyPayloadSize
  )

  useEffect(() => {
    callbackEvents.current = aiChatProps.events || {}
  }, [aiChatProps.events])

  return useCallback(() => {
    if (!adapterToUse) {
      warn('No valid adapter was provided to AiChat component')
      return
    }

    if (!hasValidInput) {
      return
    }

    if (composerOptions?.disableSubmitButton) {
      return
    }

    setComposerStatus('submitting-prompt')
    const promptToSubmit = promptTyped
    const streamedMessageIds: Set<string> = new Set()

    const adapterBridge:
      | CoreChatAdapter<AiMsg>
      | ServerComponentChatAdapter<AiMsg>
      | StandardChatAdapter<AiMsg> = isStandardChatAdapter(adapterToUse)
      ? (adapterToUse as StandardChatAdapter<AiMsg>)
      : (adapterToUse as ChatAdapter<AiMsg>).streamServerComponent
        ? ({
            streamServerComponent: (adapterToUse as ChatAdapter<AiMsg>)
              .streamServerComponent!
          } satisfies ServerComponentChatAdapter<AiMsg>)
        : ({
            batchText: (adapterToUse as CoreChatAdapter<AiMsg>).batchText,
            streamText: (adapterToUse as CoreChatAdapter<AiMsg>).streamText
          } satisfies CoreChatAdapter<AiMsg>)

    //
    // ⭐️ Important
    // This is where the prompt is submitted to the API.
    //
    const { segment: chatSegment, observable: chatSegmentObservable } =
      submitPrompt<AiMsg>(promptToSubmit, adapterBridge, adapterExtras)

    if (chatSegment.status === 'error') {
      warn('Error occurred while submitting prompt')
      showException('Error occurred while submitting prompt')
      setComposerStatus('typing')

      // Reset the prompt if the composer is empty
      if (promptTypedRef.current === '') {
        setPrompt(promptToSubmit)
      }
      return
    }

    // THE FOLLOWING CODE IS USED TO TRIGGER AN UPDATE OF THE REACT STATE.
    // The 'on' event listeners are implemented by @nlux/core non-React prompt handler.
    // On 'complete' and 'update' events, the chat segment is updated, but in order
    // to trigger a check and potentially re-render the React component, we need to change
    // the reference of the parts array by creating a new array.

    const handleSegmentItemReceived = (
      item: ChatSegmentAiMessage<AiMsg> | ChatSegmentUserMessage
    ) => {
      const currentChatSegments = domToReactRef.current.newSegments
      const newChatSegments: ChatSegment<AiMsg>[] = currentChatSegments.map(
        currentChatSegment => {
          if (currentChatSegment.uid !== chatSegmentObservable.segmentId) {
            return currentChatSegment
          }

          return {
            ...currentChatSegment,
            items: [...currentChatSegment.items, { ...item }]
          }
        }
      )

      domToReactRef.current.setChatSegments(newChatSegments)
    }

    chatSegmentObservable.on('userMessageReceived', userMessage => {
      if (
        domToReactRef.current?.cancelledMessageIds.includes(userMessage.uid)
      ) {
        return
      }

      handleSegmentItemReceived(userMessage)
      if (callbackEvents.current?.messageSent) {
        callbackEvents.current.messageSent({
          uid: userMessage.uid,
          message: userMessage.content
        })
      }
    })

    chatSegmentObservable.on('aiMessageStreamStarted', aiStreamedMessage => {
      if (
        domToReactRef.current?.cancelledMessageIds.includes(
          aiStreamedMessage.uid
        )
      ) {
        return
      }

      handleSegmentItemReceived(aiStreamedMessage)
      domToReactRef.current.setComposerStatus('waiting')
      if (promptTypedRef.current === promptToSubmit) {
        domToReactRef.current.setPrompt('')
      }

      streamedMessageIds.add(aiStreamedMessage.uid)
      if (callbackEvents.current?.messageStreamStarted) {
        callbackEvents.current.messageStreamStarted({
          uid: aiStreamedMessage.uid
        })
      }
    })

    chatSegmentObservable.on(
      'aiServerComponentStreamStarted',
      aiServerComponentMessage => {
        if (
          domToReactRef.current?.cancelledMessageIds.includes(
            aiServerComponentMessage.uid
          )
        ) {
          return
        }

        handleSegmentItemReceived(aiServerComponentMessage)
        domToReactRef.current.setComposerStatus('waiting')
        if (promptTypedRef.current === promptToSubmit) {
          domToReactRef.current.setPrompt('')
        }

        streamedMessageIds.add(aiServerComponentMessage.uid)
        if (callbackEvents.current?.serverComponentStreamStarted) {
          callbackEvents.current?.serverComponentStreamStarted({
            uid: aiServerComponentMessage.uid
          })
        }
      }
    )

    chatSegmentObservable.on(
      'aiServerComponentStreamed',
      streamedServerComponent => {
        if (
          domToReactRef.current?.cancelledMessageIds.includes(
            streamedServerComponent.uid
          )
        ) {
          return
        }

        if (
          callbackEvents.current?.serverComponentRendered &&
          !domToReactRef.current.cancelledMessageIds.includes(
            streamedServerComponent.uid
          )
        ) {
          callbackEvents.current?.serverComponentRendered({
            uid: streamedServerComponent.uid
          })
        }
      }
    )

    chatSegmentObservable.on('aiMessageReceived', aiMessage => {
      if (domToReactRef.current?.cancelledMessageIds.includes(aiMessage.uid)) {
        return
      }

      const currentChatSegments = domToReactRef.current.newSegments
      const newChatSegments: ChatSegment<AiMsg>[] = currentChatSegments.map(
        currentChatSegment => {
          if (currentChatSegment.uid !== chatSegmentObservable.segmentId) {
            return currentChatSegment
          }

          return {
            ...currentChatSegment,
            items: [...currentChatSegment.items, { ...aiMessage }]
          }
        }
      )

      domToReactRef.current.setChatSegments(newChatSegments)
      if (callbackEvents.current?.messageReceived) {
        callbackEvents.current.messageReceived({
          uid: aiMessage.uid,
          message: aiMessage.content
        })
      }
    })

    chatSegmentObservable.on('complete', completeChatSegment => {
      if (
        domToReactRef.current?.cancelledMessageIds.includes(
          completeChatSegment.uid
        )
      ) {
        return
      }

      domToReactRef.current.setComposerStatus('typing')
      const currentChatSegments = domToReactRef.current.newSegments
      const newChatSegments: ChatSegment<AiMsg>[] = currentChatSegments.map(
        currentChatSegment => {
          if (currentChatSegment.uid !== chatSegmentObservable.segmentId) {
            return currentChatSegment
          }

          return { ...completeChatSegment }
        }
      )

      domToReactRef.current.setChatSegments(newChatSegments)
      if (promptTypedRef.current === promptToSubmit) {
        setPrompt('')
      }

      if (streamedMessageIds.size > 0) {
        streamedMessageIds.forEach(messageId => {
          requestAnimationFrame(() => {
            conversationRef.current?.completeStream(
              chatSegmentObservable.segmentId,
              messageId
            )
          })
        })

        streamedMessageIds.clear()
      }
    })

    chatSegmentObservable.on('aiChunkReceived', ({ messageId, chunk }) => {
      if (domToReactRef.current?.cancelledMessageIds.includes(messageId)) {
        return
      }

      conversationRef.current?.streamChunk(chatSegment.uid, messageId, chunk)
    })

    chatSegmentObservable.on('aiMessageStreamed', streamedMessage => {
      if (
        domToReactRef.current?.cancelledMessageIds.includes(streamedMessage.uid)
      ) {
        return
      }

      if (callbackEvents.current?.messageReceived) {
        callbackEvents.current?.messageReceived({
          uid: streamedMessage.uid,
          // In streamed messages, the AiMsg is always a string
          message: streamedMessage.content as AiMsg
        })
      }
    })

    chatSegmentObservable.on('error', (errorId, errorObject) => {
      const parts = domToReactRef.current.newSegments
      const newParts = parts.filter(part => part.uid !== chatSegment.uid)
      const errorMessage = NLErrors[errorId]

      domToReactRef.current.setChatSegments(newParts)
      domToReactRef.current.setComposerStatus('typing')
      domToReactRef.current.showException(errorMessage)

      if (promptTypedRef.current === '') {
        setPrompt(promptToSubmit)
      }

      if (callbackEvents.current?.error) {
        callbackEvents.current.error({
          errorId,
          message: errorMessage,
          errorObject
        })
      }
    })

    chatSegmentObservable.on('emailSubmitted', async email => {
      if (callbackEvents.current?.emailSubmitted) {
        try {
          await callbackEvents.current.emailSubmitted(email)
          return { success: true }
        } catch (error) {
          console.error('Error in email submission callback:', error)
          return { success: false, error: 'Email submission failed' }
        }
      }
      return { success: false, error: 'No email handler configured' }
    })

    domToReactRef.current.setChatSegments([
      ...domToReactRef.current.newSegments,
      chatSegment
    ])
  }, [
    promptTyped,
    adapterToUse,
    adapterExtras,
    showException,
    domToReactRef,
    composerOptions?.disableSubmitButton
  ])
}
