import type { ReactNode } from 'react'

/**
 * SectionHeader — the canonical Pulse section title (Home redesign V2).
 * Extra-bold 18 / #14141c, with optional LIVE/new chips and a right-slot
 * action ("See all"). Replaces the one-off headers each surface rolled itself.
 */
interface SectionHeaderProps {
  title: string
  /** Small chip after the title, e.g. "LIVE" or "3 new". */
  chip?: { label: string; tone?: 'live' | 'new' }
  /** Right-aligned action, usually a "See all" button. */
  action?: ReactNode
}

export function SectionHeader({ title, chip, action }: SectionHeaderProps) {
  return (
    <div className="mb-3 flex items-center justify-between gap-2">
      <div className="flex items-center gap-2">
        <h2 className="text-lg font-extrabold text-[#14141c]">{title}</h2>
        {chip && (
          <span
            className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide ${
              chip.tone === 'live'
                ? 'bg-red-50 text-red-600'
                : 'bg-[#f4f0fd] text-hockia-primary'
            }`}
          >
            {chip.tone === 'live' && <span className="h-1.5 w-1.5 rounded-full bg-red-500" />}
            {chip.label}
          </span>
        )}
      </div>
      {action}
    </div>
  )
}
