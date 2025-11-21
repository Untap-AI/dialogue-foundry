import {
  Conversation,
  ConversationContent,
  ConversationScrollButton,
} from '@/components/conversation';
import { Message, MessageContent } from '@/components/message';
import {
  PromptInput,
  PromptInputSubmit,
  PromptInputTextarea,
} from '@/components/prompt-input';
import React, { useState } from 'react';
import { Response } from '@/components/response';

import { Loader } from '@/components/loader';
import { useConfig } from '@/contexts/ConfigContext';
import { cn } from '@/lib/utils';
import { useChatPersistence } from '../../hooks/useChatPersistence';
import type { ChatStatus } from '../../hooks/useChatPersistence';
import { EmailInputMessage } from '../EmailInputMessage/EmailInputMessage';
import { Suggestions, Suggestion } from '../suggestion';

// Loading state component
const ChatLoadingState = () => (
  <div className="df:flex df:flex-col df:items-center df:justify-center df:h-full df:space-y-4">
    <Loader size={32} className="df:text-primary" />
    <div className="df:text-center df:space-y-2">
      <h3 className="df:text-lg df:font-medium df:text-foreground">Setting up your chat</h3>
      <p className="df:text-sm df:text-muted-foreground">Please wait while we initialize...</p>
    </div>
  </div>
);

// Error state component
const ChatErrorState = () => (
  <div className="df:flex df:flex-col df:items-center df:justify-center df:h-full df:space-y-4 df:p-8">
    <div className="df:size-12 df:rounded-full df:bg-destructive/10 df:flex df:items-center df:justify-center">
      <svg className="df:size-6 df:text-destructive" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L3.732 16.5c-.77.833.192 2.5 1.732 2.5z" />
      </svg>
    </div>
    <div className="df:text-center df:space-y-2">
      <h3 className="df:text-lg df:font-medium df:text-foreground">Unable to start chat</h3>
      <p className="df:text-sm df:text-muted-foreground">There was a problem initializing the chat. Please refresh the page to try again.</p>
    </div>
  </div>
);

// Stream error banner component
interface StreamErrorBannerProps {
  streamError: string | null;
  onClearError: () => void;
}

const StreamErrorBanner = ({ streamError, onClearError }: StreamErrorBannerProps) => {
  if (!streamError) return null;
  
  return (
    <div className="df:mx-4 df:my-2 df:p-3 df:rounded-md df:bg-destructive/10 df:border df:border-destructive/20">
      <div className="df:flex df:items-start df:space-x-3">
        <svg className="df:size-4 df:text-destructive df:mt-0.5 df:flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
        </svg>
        <div className="df:flex-1 df:min-w-0">
          <p className="df:text-sm df:text-destructive df:font-medium">Message failed to send</p>
          <p className="df:text-xs df:text-destructive/80 df:mt-1">Please try sending your message again.</p>
        </div>
        <button
          onClick={onClearError}
          className="df:text-destructive/60 df:hover:text-destructive df:transition-colors"
        >
          <svg className="df:size-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>
    </div>
  );
};

interface ChatInterfaceProps {
  onNewChatRequest?: () => void;
  onChatStatusChange?: (status: ChatStatus) => void;
}

// Create a ref interface for exposing methods to parent
export interface ChatInterfaceRef {
  createNewChat: () => Promise<void>;
}

const DEFAULT_POWERED_BY_TEXT = 'Untap AI'
const DEFAULT_POWERED_BY_URL = 'https://untap-ai.com' 

export const ChatInterface = React.forwardRef<ChatInterfaceRef, ChatInterfaceProps>(
  ({ onChatStatusChange }, _ref) => {
  const { poweredBy, suggestions: configSuggestions } = useConfig()
  const [input, setInput] = useState('');

  const showPoweredBy = poweredBy?.show ?? true
  const poweredByText = poweredBy?.text ?? DEFAULT_POWERED_BY_TEXT
  const poweredByUrl = poweredBy?.url ?? DEFAULT_POWERED_BY_URL
  
  // Determine if email should be unbranded based on poweredBy config
  const isUnbranded = 
    poweredBy?.show === false ||
    (poweredBy?.text !== undefined && poweredBy.text !== DEFAULT_POWERED_BY_TEXT) ||
    (poweredBy?.url !== undefined && poweredBy.url !== DEFAULT_POWERED_BY_URL)
  
  // Use the chat persistence hook
  const {
    messages,
    sendMessage,
    status,
    chatStatus,
    streamError,
    clearStreamError,
    submitEmailForToolCall,
    recordLinkClick,
    recordConversationStarterClick,
  } = useChatPersistence();

  const isInitialized = chatStatus === 'initialized'

  // Notify parent of chat status changes
  React.useEffect(() => {
    onChatStatusChange?.(chatStatus)
  }, [chatStatus, onChatStatusChange])

  // Determine if we should show suggestions (only when there are no user messages)
  const hasUserMessages = messages.some(message => message.role === 'user')
  const shouldShowSuggestions = isInitialized && !hasUserMessages && configSuggestions && configSuggestions.length > 0

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (input.trim() && isInitialized) {
      sendMessage({
        text: input,
      });
      setInput('');
    }
  };

  // Handle suggestion clicks - send the prompt, not the label
  const handleSuggestionClick = (prompt: string) => {
    if (isInitialized) {
      sendMessage({
        text: prompt,
      });
    }
  };


  // Show loading state when initializing
  if (chatStatus === 'loading') {
    return (
      <>
        <ChatLoadingState />
        {showPoweredBy && (
          <div className={cn(
            "df:text-center df:text-[11px] df:leading-[11px] df:text-primary-foreground df:py-[3px] df:px-0 df:bg-primary"
          )}>
            Powered by{' '}
            <a
              href={poweredByUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="df:text-inherit df:underline"
            >
              {poweredByText}
            </a>
          </div>
        )}
      </>
    );
  }

  // Show error state when chat failed to initialize
  if (chatStatus === 'error') {
    return (
      <>
        <ChatErrorState />
        {showPoweredBy && (
          <div className={cn(
            "df:text-center df:text-[11px] df:leading-[11px] df:text-primary-foreground df:py-[3px] df:px-0 df:bg-primary"
          )}>
            Powered by{' '}
            <a
              href={poweredByUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="df:text-inherit df:underline"
            >
              {poweredByText}
            </a>
          </div>
        )}
      </>
    );
  }
  
  return (
    <>
      <StreamErrorBanner streamError={streamError} onClearError={clearStreamError} />
      <Conversation className="df:h-full">
        <ConversationContent>
          {messages.map((message) => {
            if(!message.parts.some(part => part.type === 'text')) {
              return <Loader key={message.id} />
            }

            return (
              <Message from={message.role} key={message.id}>
                <MessageContent>
                  {/* First render all text parts */}
                  {message.parts
                    .filter(part => part.type === 'text')
                    .map((part, i) => (
                      <Response 
                        key={`${message.id}-${i}`} 
                        messageId={message.id}
                        onLinkClick={recordLinkClick}
                      >
                        {part.type === 'text' ? part.text : ''}
                      </Response>
                    ))
                  }
                  
                  {/* Then render tool calls after the text */}
                  {message.parts
                    .filter(part => part.type === 'tool-request_user_email')
                    .map((part, i) => {
                      if(part.type !== 'tool-request_user_email') {
                        return null
                      }

                      const args = part.output as { subject: string; conversationSummary: string } 
                      return (
                        <EmailInputMessage
                          key={`${message.id}-tool-${i}`}
                          onSubmit={async (email: string) => {
                            await submitEmailForToolCall(email, part.toolCallId, args.subject, args.conversationSummary, isUnbranded)
                          }}
                        />
                      )
                    })
                  }
                </MessageContent>
              </Message>
            )
          })}
          {status === 'submitted' && <Loader />}
        </ConversationContent>
        <ConversationScrollButton />
      </Conversation>
    
      <div className="df:pt-2">
        {/* Suggestions area - positioned just above prompt input */}
        {shouldShowSuggestions && (
            <Suggestions scrollAreaClassName="df:pb-2">
              {configSuggestions?.map((suggestion, index) => (
                <Suggestion
                  key={index}
                  suggestion={suggestion.label || suggestion.prompt}
                  analyticsLabel={suggestion.label}
                  analyticsPosition={index}
                  onAnalyticsClick={() => recordConversationStarterClick(suggestion.label || suggestion.prompt, index, suggestion.prompt)}
                  onClick={() => handleSuggestionClick(suggestion.prompt)}
                />
              ))}
            </Suggestions>
        )}
        <div className="df:pb-4 df:px-4">
        <PromptInput onSubmit={handleSubmit} className="df:flex df:items-center df:pr-3">
          <PromptInputTextarea
            onChange={(e) => setInput(e.target.value)}
            value={input}
            disabled={status === 'submitted' || !isInitialized || status === 'streaming'}
          />
          <PromptInputSubmit disabled={!input || !isInitialized || status === 'submitted' || status === 'streaming'} status={status} />
        </PromptInput>
        </div>
      </div>

      {showPoweredBy && (
        <div className={cn(
          "df:text-center df:text-[11px] df:leading-[11px] df:text-primary-foreground df:py-[3px] df:px-0 df:bg-primary"
        )}>
          Powered by{' '}
          <a
            href={poweredByUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="df:text-inherit df:underline"
          >
            {poweredByText}
          </a>
        </div>
      )}


    </>
  );
});

ChatInterface.displayName = 'ChatInterface';