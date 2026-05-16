import { useEffect, useId, useRef, useState, type ReactNode } from 'react'
import { Info } from 'lucide-react'
import clsx from 'clsx'

interface InfoTooltipProps {
  label: string
  children: ReactNode
  className?: string
  triggerClassName?: string
  iconClassName?: string
  tooltipClassName?: string
  alignment?: 'start' | 'center' | 'end'
}

const ALIGNMENT_CLASSES: Record<'start' | 'center' | 'end', string> = {
  start: 'left-0 -translate-x-0',
  center: 'left-1/2 -translate-x-1/2',
  end: 'right-0 translate-x-0',
}

export default function InfoTooltip({
  label,
  children,
  className,
  triggerClassName,
  iconClassName,
  tooltipClassName,
  alignment = 'center',
}: InfoTooltipProps) {
  const [open, setOpen] = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)
  const tooltipId = useId()

  useEffect(() => {
    if (!open) return

    const handlePointerDown = (event: PointerEvent) => {
      if (!containerRef.current) return
      if (!containerRef.current.contains(event.target as Node)) {
        setOpen(false)
      }
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setOpen(false)
      }
    }

    // Cross-overlay coordination: when another dismissible surface
    // (e.g. SettingsSheet) opens, close the tooltip explicitly. The
    // outside-pointerdown handler above already covers most cases, but
    // QA caught an environment where both stayed visible — this is the
    // belt-and-suspenders guarantee that mutual-exclusion holds.
    const handleOverlayOpened = (event: Event) => {
      const detail = (event as CustomEvent<{ source?: string }>).detail
      if (detail?.source === 'info-tooltip') return
      setOpen(false)
    }

    document.addEventListener('pointerdown', handlePointerDown)
    document.addEventListener('keydown', handleKeyDown)
    document.addEventListener('hockia:overlay-opened', handleOverlayOpened)

    return () => {
      document.removeEventListener('pointerdown', handlePointerDown)
      document.removeEventListener('keydown', handleKeyDown)
      document.removeEventListener('hockia:overlay-opened', handleOverlayOpened)
    }
  }, [open])

  // Broadcast when opening so other overlays close themselves.
  useEffect(() => {
    if (!open) return
    document.dispatchEvent(
      new CustomEvent('hockia:overlay-opened', { detail: { source: 'info-tooltip' } }),
    )
  }, [open])

  return (
    <div
      ref={containerRef}
      className={clsx('relative inline-flex items-center', className)}
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
    >
      <button
        type="button"
        aria-label={label}
        aria-controls={tooltipId}
        onClick={() => setOpen((previous) => !previous)}
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
        className={clsx(
          'inline-flex h-6 w-6 items-center justify-center rounded-full text-gray-400 transition hover:text-gray-900 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gray-300',
          triggerClassName
        )}
      >
        <Info className={clsx('h-4 w-4', iconClassName)} aria-hidden="true" />
        <span className="sr-only">{label}</span>
      </button>

      {open && (
        <div
          id={tooltipId}
          role="tooltip"
          className={clsx(
            'absolute top-full z-30 mt-2 w-64 rounded-2xl border border-gray-800 bg-gray-900/95 px-4 py-3 text-sm leading-relaxed text-gray-100 shadow-2xl',
            ALIGNMENT_CLASSES[alignment],
            tooltipClassName
          )}
        >
          {children}
        </div>
      )}
    </div>
  )
}
