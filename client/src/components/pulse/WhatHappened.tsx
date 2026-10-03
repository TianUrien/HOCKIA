import { Link } from 'react-router-dom'
import { Bell, Briefcase, ChevronRight, Heart } from 'lucide-react'
import { EntityAvatar } from '@/components/ui/EntityAvatar'
import { dayFirst } from '@/lib/dayFirst'
import { getImageUrl } from '@/lib/imageUrl'
import { STATUS_TONE_TEXT } from '@/lib/statusTone'
import type { HappenedIcon, HappenedLine } from '@/lib/pulseWeek'

/**
 * "What happened" (Your week v2, Figma 42:276; row = List item / Activity
 * 531:469): the week's facts, one neutral line each. Row anatomy: leading
 * avatar 40 (the club's crest as the Organisation shape, a person as a
 * circle; a system event with no actor gets a brand-soft circle with a
 * brand-coloured icon), the sentence in ink-1 16/22, the day-first date in
 * ink-3 13 under it, and — only when the row navigates — a trailing ink-4
 * chevron (icon only; ink-4 is never text). A row with no destination is
 * plain: no chevron, not tappable. Rows are 14 px tall-padded with hairline
 * dividers.
 *
 * Everything here is grey — a player waiting on a club cannot act, so
 * nothing is amber (lib/statusTone). The line "Your application to X
 * expired with no reply" included.
 */
const ICONS: Record<HappenedIcon, typeof Bell> = { briefcase: Briefcase, heart: Heart, bell: Bell }

function LeadingVisual({ line }: { line: HappenedLine }) {
  if (line.actor) {
    return (
      <EntityAvatar
        src={getImageUrl(line.actor.avatarUrl, 'avatar-sm') ?? line.actor.avatarUrl}
        name={line.actor.name}
        role={line.actor.role}
        size={40}
      />
    )
  }
  const Icon = ICONS[line.icon]
  return (
    <span
      className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-hockia-soft text-hockia-primary"
      aria-hidden="true"
      data-testid="happened-icon"
      data-icon={line.icon}
    >
      <Icon className="h-5 w-5" strokeWidth={1.75} />
    </span>
  )
}

export function WhatHappened({ lines }: { lines: readonly HappenedLine[] }) {
  if (lines.length === 0) return null
  return (
    <section aria-label="What happened" data-testid="what-happened">
      <h2 className="px-1 pb-2 text-body font-semibold text-ink-1">What happened</h2>
      <ol className="divide-y divide-line overflow-hidden rounded-card bg-surface-grouped">
        {lines.map((l) => {
          const inner = (
            <>
              <LeadingVisual line={l} />
              <span className="min-w-0 flex-1">
                <span className={`block text-[16px] leading-[22px] ${l.tone === 'grey' ? 'text-ink-1' : STATUS_TONE_TEXT[l.tone]}`} data-testid="happened-line">{l.text}</span>
                <span className="mt-0.5 block text-secondary text-ink-3" data-testid="happened-when">{dayFirst(l.at)}</span>
              </span>
            </>
          )
          return (
            <li key={l.key}>
              {l.path ? (
                <Link to={l.path} className="flex items-center gap-3 px-4 py-3.5 active:bg-surface-muted" data-testid="happened-row-link">
                  {inner}
                  <ChevronRight className="h-4 w-4 shrink-0 text-ink-4" aria-hidden="true" data-testid="happened-chevron" />
                </Link>
              ) : (
                <div className="flex items-center gap-3 px-4 py-3.5" data-testid="happened-row-plain">{inner}</div>
              )}
            </li>
          )
        })}
      </ol>
    </section>
  )
}
