import { useEffect, useMemo, useRef } from 'react'
import { statusClassName as compComposerStatusClassName } from '../../../../shared/components/Composer/utils/applyNewStatusClassName'
import { isSubmitShortcutKey } from '../../../../shared/utils/isSubmitShortcutKey'
import { CancelIconComp } from '../../components/CancelIcon/CancelIconComp'
import { SendIconComp } from '../../components/SendIcon/SendIconComp'
import type { ChangeEvent, KeyboardEvent } from 'react'
import type { ComposerStatus } from '../../../../shared/components/Composer/props'
import type { ComposerProps } from './props'

const submittingPromptStatuses: Array<ComposerStatus> = [
  'submitting-prompt',
  'submitting-edit',
  'submitting-conversation-starter',
  'submitting-external-message'
]

export const ComposerComp = (props: ComposerProps) => {
  const compClassNameFromStats = compComposerStatusClassName[props.status] || ''
  const className = `nlux-comp-composer ${compClassNameFromStats}`

  const disableTextarea = submittingPromptStatuses.includes(props.status)
  const disableButton =
    !props.hasValidInput ||
    props.status === 'waiting' ||
    submittingPromptStatuses.includes(props.status)
  const showSendIcon = props.status === 'typing' || props.status === 'waiting'
  const hideCancelButton = props.hideStopButton === true
  const showCancelButton =
    !hideCancelButton &&
    (submittingPromptStatuses.includes(props.status) ||
      props.status === 'waiting')

  // eslint-disable-next-line no-null/no-null
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  useEffect(() => {
    if (props.status === 'typing' && props.autoFocus && textareaRef.current) {
      textareaRef.current.focus()
    }
  }, [props.status, props.autoFocus])

  const handleChange = useMemo(
    () => (e: ChangeEvent<HTMLTextAreaElement>) => {
      props.onChange?.(e.target.value)
    },
    [props]
  )

  const handleSubmit = useMemo(
    () => () => {
      props.onSubmit?.()
    },
    [props]
  )

  const handleKeyDown = useMemo(
    () => (e: KeyboardEvent<HTMLTextAreaElement>) => {
      if (isSubmitShortcutKey(e, props.submitShortcut)) {
        e.preventDefault()
        handleSubmit()
      }
    },
    [handleSubmit, props.submitShortcut]
  )

  useEffect(() => {
    if (!textareaRef.current) {
      return
    }
    const adjustHeight = () => {
      const textarea = textareaRef.current
      if (textarea) {
        textarea.style.height = 'auto' // Reset height
        textarea.style.height = `${textarea.scrollHeight}px` // Set new height based on content
      }
    }
    const textarea = textareaRef.current
    if (textarea) {
      textarea.addEventListener('input', adjustHeight)
    }
    return () => {
      if (textarea) {
        textarea.removeEventListener('input', adjustHeight)
      }
    }
  }, [])

  return (
    <div className={className}>
      <textarea
        tabIndex={0}
        ref={textareaRef}
        disabled={disableTextarea}
        placeholder={props.placeholder}
        value={props.prompt}
        onChange={handleChange}
        onKeyDown={handleKeyDown}
        aria-label={props.placeholder}
      />
      {!showCancelButton && (
        <button
          tabIndex={0}
          disabled={disableButton}
          onClick={() => props.onSubmit()}
          aria-label="Send"
        >
          {showSendIcon && <SendIconComp />}
        </button>
      )}
      {showCancelButton && (
        <button tabIndex={0} onClick={props.onCancel} aria-label="Cancel">
          <CancelIconComp />
        </button>
      )}
    </div>
  )
}
