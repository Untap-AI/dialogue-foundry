import React, { useRef, useEffect, useState, useMemo } from 'react'
import './ChatButton.css'
import { useConfig } from '../../contexts/ConfigContext'
import { PopupMessage } from './PopupMessage'

const POPUP_DELAY = 3000
const POPUP_DURATION = 10000

interface ChatButtonProps {
  onClick: () => void
  isOpen: boolean
}

const DIALOGUE_FOUNDRY_POPUP_KEY = 'dialogue_foundry_popup'

export const ChatButton: React.FC<ChatButtonProps> = ({ onClick, isOpen }) => {
  // eslint-disable-next-line no-null/no-null
  const buttonRef = useRef<HTMLButtonElement>(null)
  const { popupMessage } = useConfig()
  const [popupVisible, setPopupVisible] = useState(false)

  const popupEnabled = useMemo(
    () =>
      popupMessage &&
      popupMessage.length > 0 &&
      // This ensures the user is not shown the popup if they have already seen it
      !localStorage.getItem(DIALOGUE_FOUNDRY_POPUP_KEY),
    [popupMessage]
  )

  // Synchronize animation with popup visibility
  useEffect(() => {
    if (!buttonRef.current || !popupEnabled) return

    const button = buttonRef.current
    const animationClass = `chat-button-animation-twist`

    // Add animation class after popup delay (when popup appears)
    const startAnimationTimer = setTimeout(() => {
      button.classList.add(animationClass)
      setPopupVisible(true)
    }, POPUP_DELAY)

    localStorage.setItem(DIALOGUE_FOUNDRY_POPUP_KEY, 'true')

    // Remove animation class when popup disappears
    const stopAnimationTimer = setTimeout(() => {
      button.classList.remove(animationClass)
      setPopupVisible(false)
    }, POPUP_DELAY + POPUP_DURATION)

    return () => {
      clearTimeout(startAnimationTimer)
      clearTimeout(stopAnimationTimer)
      button.classList.remove(animationClass)
    }
  }, [popupEnabled])

  return (
    <>
      <button
        ref={buttonRef}
        data-chat-button
        className="chat-icon-button"
        onClick={onClick}
        aria-label={isOpen ? 'Close chat' : 'Open chat'}
      >
        {/* Icon */}
        <svg viewBox="0 0 24 24">
          <path d="M20 2H4c-1.1 0-2 .9-2 2v18l4-4h14c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2zm0 14H5.17L4 17.17V4h16v12z" />
          <path d="M7 9h10v2H7z" />
          <path d="M7 12h7v2H7z" />
        </svg>
      </button>

      {popupVisible && <PopupMessage buttonRef={buttonRef} />}
    </>
  )
}
