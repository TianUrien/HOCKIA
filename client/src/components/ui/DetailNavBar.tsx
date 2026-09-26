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
  /** Longer parent label next to a title ("‹ Applicants  Leandro Bica"): the title
   *  centres in the space left between the label and the trailing action. */
  wideParent?: boolean
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
  wideParent = false,
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
        className="flex h-11 shrink-0 items-center pr-2 text-body text-hockia-primary"
      >
        <span className="flex h-11 w-11 items-center justify-center">
          <ChevronLeft className="h-6 w-6" strokeWidth={2} />
        </span>
        {title && !showParent ? null : <span className={cn('truncate', wideParent ? 'max-w-[120px]' : title ? 'max-w-[96px]' : 'max-w-[200px]')}>{parent}</span>}
      </button>
      {title && wideParent ? (
        // Long parent label (Figma 327:318 "‹ Applicants  Leandro Bica  •••"):
        // the title is centred in the space between the label and the
        // trailing action, and truncates there, so it never touches the label.
        <h1 className="min-w-0 flex-1 truncate px-2 text-center text-body font-semibold text-ink-1">{title}</h1>
      ) : title ? (
        <h1 className={cn('pointer-events-none absolute text-center text-body font-semibold text-ink-1 truncate', showParent ? 'inset-x-[120px]' : 'inset-x-16')}>
          {title}
        </h1>
      ) : null}
      {trailing ? <div className="flex items-center">{trailing}</div> : <span className="w-11" />}
    </div>
  )
}
