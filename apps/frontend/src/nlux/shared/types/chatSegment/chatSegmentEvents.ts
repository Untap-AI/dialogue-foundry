import type { StreamedServerComponent } from '../adapters/chat/serverComponentChatAdapter'
import type { AnyAiMsg } from '../anyAiMsg'
import type { NLErrorId } from '../exceptions/errors'
import type { ChatSegment, ChatSegmentEvent } from './chatSegment'
import type {
  AiStreamedMessage,
  AiStreamedServerComponentMessage,
  ChatSegmentAiMessage
} from './chatSegmentAiMessage'
import type { ChatSegmentUserMessage } from './chatSegmentUserMessage'

export type ChatSegmentEventsMap<AiMsg> = {
  userMessageReceived: UserMessageReceivedCallback
  aiMessageReceived: AiMessageReceivedCallback<AiMsg>
  aiServerComponentStreamStarted: AiServerComponentStreamStartedCallback
  aiServerComponentStreamed: AiServerComponentStreamedCallback
  aiMessageStreamStarted: AiMessageStreamStartedCallback<AiMsg>
  aiChunkReceived: AiMessageChunkReceivedCallback<AiMsg>
  aiMessageStreamed: AiMessageStreamedCallback<AiMsg>
  complete: ChatSegmentCompleteCallback<AiMsg>
  error: ChatSegmentErrorCallback
  emailSubmitted: EmailSubmittedCallback
}

export type UserMessageReceivedCallback = (
  userMessage: ChatSegmentUserMessage
) => void

export type AiMessageReceivedCallback<AiMsg> = (
  aiMessage: ChatSegmentAiMessage<AiMsg> & {
    status: 'complete'
    content: AiMsg
    serverResponse: string | object | undefined
  }
) => void

export type AiServerComponentStreamStartedCallback = (
  aiMessage: AiStreamedServerComponentMessage & {
    status: 'streaming'
    content: StreamedServerComponent
  }
) => void

export type AiServerComponentStreamedCallback = (
  aiMessage: AiStreamedServerComponentMessage & {
    status: 'complete'
    content: StreamedServerComponent
  }
) => void

export type AiMessageStreamStartedCallback<AiMsg> = (
  aiMessage: AiStreamedMessage<AiMsg> & {
    status: 'streaming'
  }
) => void

export type AiMessageStreamedCallback<AiMsg> = (
  aiMessage: AiStreamedMessage<AiMsg> & {
    status: 'complete'
    content: Array<AiMsg>
  }
) => void

export type AiMessageChunkReceivedCallback<AiMsg> = (chunkData: {
  messageId: string
  chunk: AiMsg
  serverResponse?: string | object | undefined
}) => void

export type ChatSegmentCompleteCallback<AiMsg> = (
  updatedChatSegment: ChatSegment<AiMsg>
) => void

export type ChatSegmentErrorCallback = (
  errorId: NLErrorId,
  errorObject?: Error
) => void

export type EmailSubmittedCallback = (email: string) => Promise<{ success: boolean; error?: string }>

//
// Check that the ChatSegmentEventsMap type always satisfies Record<ChatSegmentEvent, function>
// This to ensure that all events in ChatSegmentEvent are covered by a callback function definition.
//
type AlwaysSatisfies<T, U> = T extends U ? true : false
assertAlwaysSatisfies<
  ChatSegmentEventsMap<AnyAiMsg>,
  Record<ChatSegmentEvent, (...args: never[]) => void>
>({} as ChatSegmentEventsMap<AnyAiMsg>, true)

function assertAlwaysSatisfies<T, U>(
  _value: T,
  _check: AlwaysSatisfies<T, U>
): void {
  // Empty function, used for type checking only
}
