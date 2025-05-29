import type { AiContext as CoreAiContext, ContextItems } from '@nlux/core'
import type { ComponentClass, Context, FC, ReactNode } from 'react'

export type AiContextProviderProps = {
  initialItems?: ContextItems
  errorComponent?: FC<{ error?: string }> | ComponentClass<{ error?: string }>
  loadingComponent?: FC | ComponentClass
  children: ReactNode
}

/**
 * An object that represents the AI context.
 * This object is created as a result of calling createAiContext().
 *
 * The Provider property is a React component that provides the AI context to the children.
 * To be used as <aiContextInstance.Provider> Context Aware App ... </aiContextInstance.Provider>
 *
 * The ref property is a React context that can be used to access the React context value.
 * Do not use the ref property directly, the useAiContext() and useAiTask() hooks should be used instead.
 */
export type AiContext = {
  Provider: (props: AiContextProviderProps) => ReactNode
  ref: Context<CoreAiContext>
}
