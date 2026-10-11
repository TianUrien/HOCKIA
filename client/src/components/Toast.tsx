import { useEffect } from 'react'
import { CheckCircle, XCircle, Info, X } from 'lucide-react'

/** neutral = quiet grey info (e.g. "This person isn't accepting requests.") — never red. */
export type ToastType = 'success' | 'error' | 'info' | 'neutral'

interface ToastProps {
  message: string
  type: ToastType
  onClose: () => void
  duration?: number
}

export default function Toast({ message, type, onClose, duration = 4000 }: ToastProps) {
  useEffect(() => {
    if (duration > 0) {
      const timer = setTimeout(onClose, duration)
      return () => clearTimeout(timer)
    }
  }, [duration, onClose])

  const icons = {
    success: CheckCircle,
    error: XCircle,
    info: Info,
    neutral: Info,
  }

  const colors = {
    success: 'lg:bg-green-50 lg:border-green-200 lg:text-green-800',
    error: 'lg:bg-red-50 lg:border-red-200 lg:text-red-800',
    info: 'lg:bg-blue-50 lg:border-blue-200 lg:text-blue-800',
    neutral: 'lg:bg-surface-grouped lg:border-line lg:text-ink-1',
  }

  const iconColors = {
    success: 'text-green-400 lg:text-green-600',
    error: 'text-red-400 lg:text-red-600',
    info: 'text-blue-300 lg:text-blue-600',
    neutral: 'text-white/70 lg:text-ink-2',
  }

  const Icon = icons[type]

  return (
    <div
      // Phones: the dark 14-radius toast (ink on white icons); desktop keeps the tinted card.
      className={`pointer-events-auto flex w-full max-w-[361px] items-center gap-3 rounded-[14px] bg-ink-1 py-3 pl-4 pr-3 text-white shadow-lg animate-slide-up lg:max-w-none lg:items-start lg:rounded-lg lg:border lg:p-4 ${colors[type]}`}
      role="alert"
    >
      <Icon className={`w-5 h-5 flex-shrink-0 lg:mt-0.5 ${iconColors[type]}`} />
      <p className="flex-1 text-[15px] leading-5 lg:text-sm lg:font-medium">{message}</p>
      <button
        onClick={onClose}
        className="flex h-8 w-8 flex-shrink-0 items-center justify-center opacity-70 transition-opacity hover:opacity-100 lg:h-auto lg:w-auto"
        aria-label="Close notification"
      >
        <X className="w-4 h-4" />
      </button>
    </div>
  )
}
