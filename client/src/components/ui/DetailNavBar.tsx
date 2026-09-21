import type { ReactNode } from 'react'
import { useNavigate } from 'react-router-dom'
import { ChevronLeft } from 'lucide-react'
import { cn } from '@/lib/utils'

interface DetailNavBarProps {
  /** Name of the screen the chevron returns to ("Opportunities", "Home"). */
  parent: string
  /** Centred title. When set, the parent name is not shown next to the chevron. */
  title?: string
  /** Keep the purple parent name beside the chevron even with a title
   *  (Figma References — all: "‹ Valentina   References · 5"). */
  showParent?: boolean
  /** Where "back" goes when there is no history (deep links). */
  fallbackPath?: string
  onBack?: () => void
  trailing?: ReactNode
  className?: string
}

/**
 * Detail-screen header (Figma 03 Player): chevron + parent name in brand
 * purple, or chevron + centred 17/semibold title, plus at most one trailing
 * action. Mobile only.
 */
export function DetailNavBar({
  parent,
  title,
  showParent = false,
  fallbackPath = '/home',
  onBack,
  trailing,
  className,
}: DetailNavBarProps) {
  const navigate = useNavigate()
  const back =
    onBack ??
    (() => {
      if (window.history.length > 1) navigate(-1)
      else navigate(fallbackPath)
    })

  return (
    <div className={cn('relative flex h-11 items-center justify-between px-2 lg:hidden', className)}>
      <button
        type="button"
        onClick={back}
        aria-label={`Back to ${parent}`}
        className="flex h-11 items-center pr-2 text-body text-hockia-primary"
      >
        <span className="flex h-11 w-11 items-center justify-center">
          <ChevronLeft className="h-6 w-6" strokeWidth={2} />
        </span>
        {title && !showParent ? null : <span className="max-w-[96px] truncate">{parent}</span>}
      </button>
      {title ? (
        <h1 className={cn('pointer-events-none absolute text-center text-body font-semibold text-ink-1 truncate', showParent ? 'inset-x-[120px]' : 'inset-x-16')}>
          {title}
        </h1>
      ) : null}
      {trailing ? <div className="flex items-center">{trailing}</div> : <span className="w-11" />}
    </div>
  )
}
