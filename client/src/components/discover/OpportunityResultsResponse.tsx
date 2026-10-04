import { useState } from 'react'
import type { DiscoverCta, OpportunityResultItem, SuggestedAction } from '@/hooks/useDiscover'
import { fromOpenRolesCaption, OPEN_ROLES_CHIP } from '@/lib/hockiaAi'
import ActionChipRow from './ActionChipRow'
import RoleResultRow from './RoleResultRow'

interface OpportunityResultsResponseProps {
  message: string
  opportunities: OpportunityResultItem[]
  /** Size of the open-role pool the answer came from; omitted when unknown. */
  openRolesTotal?: number | null
  cta?: DiscoverCta | null
  suggestedActions?: SuggestedAction[]
  onAction?: (action: SuggestedAction) => void
}

const COLLAPSED_COUNT = 5

/**
 * Open roles for a player / coach who asked Hockia AI for roles (Figma
 * 44:321 answer, 524:1644 no match). Left-aligned answer text, the role rows
 * inside a muted card (radius 16, gap 8), the "From N open roles · updated
 * today" caption, then the follow-up chips. The backend CTA ("See all open
 * roles") becomes a navigate chip so there is one kind of control.
 *
 * Product rules: no match level, applicant count, level pill or reply-time
 * estimate — only the role's own facts.
 */
export default function OpportunityResultsResponse({
  message,
  opportunities,
  openRolesTotal,
  cta,
  suggestedActions = [],
  onAction,
}: OpportunityResultsResponseProps) {
  const [expanded, setExpanded] = useState(false)
  const visible = expanded ? opportunities : opportunities.slice(0, COLLAPSED_COUNT)
  const hiddenCount = opportunities.length - COLLAPSED_COUNT
  const caption = fromOpenRolesCaption(openRolesTotal)

  const chips: SuggestedAction[] = [...suggestedActions]
  if (cta?.route) {
    chips.push({ label: cta.label, intent: { type: 'navigate', route: cta.route } })
  } else if (opportunities.length === 0 && !chips.some(c => c.intent.type === 'navigate')) {
    chips.push(OPEN_ROLES_CHIP)
  }

  return (
    <div data-testid="ai-role-results">
      <p className="text-row text-ink-1 whitespace-pre-line">{message}</p>

      {opportunities.length > 0 && (
        <div className="mt-3 rounded-[16px] bg-surface-muted p-2">
          <ul className="flex flex-col gap-2">
            {visible.map(o => (
              <RoleResultRow key={o.id} role={o} />
            ))}
          </ul>
          {hiddenCount > 0 && (
            <button
              type="button"
              onClick={() => setExpanded(e => !e)}
              className="mt-1 flex h-11 w-full items-center justify-center rounded-[12px] text-secondary font-semibold text-hockia-primary"
            >
              {expanded ? 'Show fewer' : `Show all ${opportunities.length} roles`}
            </button>
          )}
        </div>
      )}

      {caption && <p className="mt-2 text-caption text-ink-3">{caption}</p>}

      {chips.length > 0 && onAction && <ActionChipRow actions={chips} onAction={onAction} />}
    </div>
  )
}
