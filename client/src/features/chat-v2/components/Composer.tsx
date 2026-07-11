import { useCallback, useEffect, useRef, useMemo } from 'react'
import { Send } from 'lucide-react'

interface ComposerProps {
  value: string
  sending: boolean
  disabled: boolean
  onChange: (value: string) => void
  onSubmit: () => Promise<void>
  onFocus: () => void
  maxLength?: number
  textareaId: string
}

const WARNING_THRESHOLD = 0.9 // Show warning color at 90% of limit

export function Composer({ value, sending, disabled, onChange, onSubmit, onFocus, maxLength = 1000, textareaId }: ComposerProps) {
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  const characterCountState = useMemo(() => {
    const count = value.length
    const percentage = count / maxLength
    if (count >= maxLength) return 'error'
    if (percentage >= WARNING_THRESHOLD) return 'warning'
    return 'normal'
  }, [value.length, maxLength])

  const counterColorClass = useMemo(() => {
    switch (characterCountState) {
      case 'error': return 'text-red-500 font-semibold'
      case 'warning': return 'text-amber-500'
      default: return 'text-gray-400'
    }
  }, [characterCountState])

  const syncHeight = useCallback(() => {
    const textarea = textareaRef.current
    if (!textarea) return
    textarea.style.height = 'auto'
    // Single line ≈ 44px; grows with content up to ~120px (≈4 lines),
    // then the textarea scrolls internally instead of pushing layout.
    const nextHeight = Math.min(120, Math.max(44, textarea.scrollHeight))
    textarea.style.height = `${nextHeight}px`
    textarea.style.overflowY = textarea.scrollHeight > 120 ? 'auto' : 'hidden'
  }, [])

  const showCounter = characterCountState !== 'normal'

  useEffect(() => {
    syncHeight()
  }, [syncHeight, value])

  const handleKeyDown = (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault()
      void onSubmit()
    }
  }

  return (
    <form
      className="relative flex-shrink-0 border-t border-gray-200 bg-white px-4 pt-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))] md:px-5"
      onSubmit={event => {
        event.preventDefault()
        void onSubmit()
      }}
    >
      <div className="flex items-end gap-2">
        <div className="relative flex-1">
          <label htmlFor={textareaId} className="sr-only">
            Message
          </label>
          <textarea
            ref={textareaRef}
            id={textareaId}
            value={value}
            rows={1}
            maxLength={maxLength}
            placeholder="Type a message..."
            inputMode="text"
            enterKeyHint="send"
            autoComplete="off"
            autoCorrect="on"
            autoCapitalize="sentences"
            spellCheck
            onFocus={onFocus}
            onKeyDown={handleKeyDown}
            onChange={event => onChange(event.target.value)}
            className={`chat-textarea w-full resize-none rounded-3xl border border-gray-200 bg-gray-100 py-2.5 text-[15px] leading-snug text-gray-900 outline-none transition-colors placeholder:text-gray-400 focus:border-hockia-primary/40 focus:bg-white ${showCounter ? 'pl-4 pr-14' : 'px-4'}`}
          />
          {/* Counter only appears near the limit — a clean, native-feeling
              input the rest of the time instead of an always-on form field. */}
          {showCounter && (
            <div className={`pointer-events-none absolute bottom-2 right-3.5 text-[11px] font-medium ${counterColorClass}`}>
              {value.length}/{maxLength}
            </div>
          )}
        </div>
        <button
          type="submit"
          disabled={disabled}
          className="flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-hockia-primary to-hockia-secondary text-white shadow-sm transition-all hover:shadow-md focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-hockia-primary disabled:cursor-not-allowed disabled:opacity-40 disabled:shadow-none"
          aria-label="Send message"
        >
          {sending ? (
            <svg className="h-5 w-5 animate-spin" viewBox="0 0 24 24" aria-hidden="true">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
            </svg>
          ) : (
            <Send className="h-5 w-5" aria-hidden="true" />
          )}
        </button>
      </div>
    </form>
  )
}
