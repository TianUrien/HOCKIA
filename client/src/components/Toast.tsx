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
    success: 'bg-green-50 border-green-200 text-green-800',
    error: 'bg-red-50 border-red-200 text-red-800',
    info: 'bg-blue-50 border-blue-200 text-blue-800',
    neutral: 'bg-surface-grouped border-line text-ink-1',
  }

  const iconColors = {
    success: 'text-green-600',
    error: 'text-red-600',
    info: 'text-blue-600',
    neutral: 'text-ink-2',
  }

  const Icon = icons[type]

  return (
    <div
      className={`flex items-start gap-3 p-4 rounded-lg border shadow-lg animate-slide-up ${colors[type]}`}
      role="alert"
    >
      <Icon className={`w-5 h-5 flex-shrink-0 mt-0.5 ${iconColors[type]}`} />
      <p className="flex-1 text-sm font-medium">{message}</p>
      <button
        onClick={onClose}
        className="flex-shrink-0 hover:opacity-70 transition-opacity"
        aria-label="Close notification"
      >
        <X className="w-4 h-4" />
      </button>
    </div>
  )
}
