import { useEffect, useRef, type ReactNode } from 'react'
import { X } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useFocusTrap } from '@/hooks/useFocusTrap'
import { useBodyScrollLock } from '@/hooks/useBodyScrollLock'
import { useAnimatedPresence } from '@/hooks/useAnimatedPresence'

interface ModalProps {
  isOpen: boolean
  onClose: () => void
  children: ReactNode
  className?: string
  showClose?: boolean
}

export default function Modal({ isOpen, onClose, children, className, showClose = true }: ModalProps) {
  const dialogRef = useRef<HTMLDivElement>(null)
  const { mounted, status } = useAnimatedPresence(isOpen)
  const closing = status === 'closing'

  useFocusTrap({ containerRef: dialogRef, isActive: isOpen })

  // Scroll lock pins scrollY so closing a modal nested inside a scrolled
  // page (e.g. SignInPrompt over the Community list) doesn't dump the
  // user back at the top on iOS WKWebView. Held through `mounted` (not just
  // isOpen) so the page behind stays put while the modal animates OUT.
  useBodyScrollLock(mounted)

  useEffect(() => {
    if (!isOpen) return
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', handleEscape)
    return () => {
      document.removeEventListener('keydown', handleEscape)
    }
  }, [isOpen, onClose])

  if (!mounted) return null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" role="presentation">
      {/* Backdrop */}
      <div
        className={cn(
          "absolute inset-0 bg-black/60 backdrop-blur-sm",
          closing ? "animate-fade-out" : "animate-fade-in"
        )}
        onClick={onClose}
      />

      {/* Modal Content */}
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        tabIndex={-1}
        className={cn(
          "relative bg-white rounded-2xl shadow-2xl max-w-md w-full max-h-[90vh] overflow-y-auto focus:outline-none",
          closing ? "animate-scale-out" : "animate-scale-in",
          className
        )}
      >
        {showClose && (
          <button
            onClick={onClose}
            className="absolute top-4 right-4 p-2 rounded-lg hover:bg-gray-100 transition-colors"
            aria-label="Close modal"
          >
            <X className="w-5 h-5 text-gray-500" />
          </button>
        )}
        {children}
      </div>
    </div>
  )
}
