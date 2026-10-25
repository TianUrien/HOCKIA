import { useEffect } from 'react'
import { useToastStore } from '../lib/toast'
import Toast from './Toast'

export default function ToastContainer() {
  const { toasts, removeToast, clearToasts } = useToastStore()

  // A sheet opening clears toasts already on screen, so an old "Saved" never
  // covers the sheet's buttons (a destructive one included). Toasts raised
  // after it opens (a failed action inside the sheet) still show.
  useEffect(() => {
    document.addEventListener('hockia:overlay-opened', clearToasts)
    return () => document.removeEventListener('hockia:overlay-opened', clearToasts)
  }, [clearToasts])

  return (
    // Phones: bottom, 16 pt above the tab bar, never over content (Figma
    // Home review 11 Oct, same as the Community block toast). Desktop: top right.
    <div className="pointer-events-none fixed inset-x-4 bottom-[calc(env(safe-area-inset-bottom)+76px)] z-[10001] flex flex-col items-center gap-2 lg:inset-x-auto lg:bottom-auto lg:right-4 lg:top-20 lg:max-w-md lg:items-stretch">
      {toasts.map((toast) => (
        <Toast
          key={toast.id}
          message={toast.message}
          type={toast.type}
          onClose={() => removeToast(toast.id)}
        />
      ))}
    </div>
  )
}
