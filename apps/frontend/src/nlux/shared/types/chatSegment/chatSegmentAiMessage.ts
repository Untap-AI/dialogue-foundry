import type { ServerComponentExecutionResult } from '../adapters/chat/serverComponentChatAdapter'

export type AiStreamedMessage<AiMsg> = {
  uid: string
  time: Date
  participantRole: 'assistant'
  dataTransferMode: 'stream'
} & (
  | {
      status: 'streaming'
    }
  | {
      status: 'complete'

      // For streamed messages, AiMsg is used for both chunks and the final message pre-processed by the adapter.
      // For strings, this is straightforward. For objects, the adapter must pre-process the final message passed
      // through complete() to match the AiMsg type.
      content: Array<AiMsg>
      contentType: 'text' | 'email_input'

      // Chunks streamed from the AI. Only available for standard adapters.
      serverResponse: Array<string | object | undefined> | undefined
    }
  | {
      status: 'error'
      error: string
    }
)

export type AiBatchedMessage<AiMsg> = {
  uid: string
  time: Date
  participantRole: 'assistant'
  dataTransferMode: 'batch'
} & (
  | {
      status: 'complete'
      content: AiMsg
      contentType: 'text' | 'email_input'

      // The raw response from the AI. Only available for standard adapters.
      serverResponse: string | object | undefined
    }
  | {
      status: 'error'
      error: string
    }
  | {
      status: 'loading'
    }
)

export type AiStreamedServerComponentMessage = {
  uid: string
  time: Date
  participantRole: 'assistant'
  dataTransferMode: 'stream'
} & (
  | {
      status: 'streaming'
      contentType: 'server-component' | 'email_input'
      content: ServerComponentExecutionResult
    }
  | {
      status: 'complete'
      content: ServerComponentExecutionResult
    }
  | {
      status: 'error'
      error: string
    }
)

export type ChatSegmentAiMessage<AiMsg> =
  | AiStreamedMessage<AiMsg>
  | AiBatchedMessage<AiMsg>
  | AiStreamedServerComponentMessage
