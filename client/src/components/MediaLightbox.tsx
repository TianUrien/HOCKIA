import { useEffect, useRef } from 'react'
import { X } from 'lucide-react'
import { useFocusTrap } from '@/hooks/useFocusTrap'

interface LightboxMedia {
  id: string
  url: string
  alt?: string
}

interface MediaLightboxProps {
  media: LightboxMedia | null
  onClose: () => void
}

export default function MediaLightbox({ media, onClose }: MediaLightboxProps) {
  const dialogRef = useRef<HTMLDivElement>(null)

  useFocusTrap({ containerRef: dialogRef, isActive: Boolean(media) })

  useEffect(() => {
    if (!media) return

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        onClose()
      }
    }

    document.addEventListener('keydown', handleKeyDown)

    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'

    return () => {
      document.removeEventListener('keydown', handleKeyDown)
      document.body.style.overflow = previousOverflow
    }
  }, [media, onClose])

  if (!media) return null

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/90 p-4" role="presentation" onClick={onClose}>
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-label="Full screen media preview"
        tabIndex={-1}
        className="relative h-full w-full max-h-[min(90vh,800px)] max-w-4xl"
        onClick={(event) => event.stopPropagation()}
      >
        <button
          onClick={onClose}
          className="absolute right-4 top-4 z-10 inline-flex items-center gap-1.5 rounded-full bg-black/70 px-3 py-2 text-sm font-medium text-white transition hover:bg-black"
          aria-label="Close preview"
        >
          <X className="h-5 w-5" />
          <span>Close</span>
        </button>
        <img
          src={media.url}
          alt={media.alt || 'Media preview'}
          className="h-full w-full rounded-xl object-contain"
        />
        {/* Caption + dismiss hint. QA-flagged the overlay as feeling
            like the page had navigated away — no caption, no metadata,
            and the only visible exit was a bare icon. The caption gives
            context; the hint makes the tap-to-close affordance explicit
            (the backdrop is already an onClose target). */}
        <div className="pointer-events-none absolute inset-x-0 bottom-0 rounded-b-xl bg-gradient-to-t from-black/80 to-transparent px-4 pb-4 pt-10 text-center">
          {media.alt && (
            <p className="text-sm font-medium text-white">{media.alt}</p>
          )}
          <p className="mt-0.5 text-xs text-white/60">Tap anywhere to close</p>
        </div>
      </div>
    </div>
  )
}
