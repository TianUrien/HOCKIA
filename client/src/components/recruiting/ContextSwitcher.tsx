/**
 * ContextSwitcher — pill showing the viewer's active recruiting
 * context with a tap-to-edit sheet.
 *
 * Sprint 2 of the recruitment intelligence layer. Solves the
 * Mixed-club problem: when a club has both men's and women's
 * leagues, deriveTargetCategory returns 'Mixed' and Club Fit can't
 * differentiate. The switcher lets the recruiter pick a specific
 * target ("Women" this week) without editing the underlying
 * profile.
 *
 * Visibility:
 *   - Only renders for clubs and coaches. Hidden for everyone
 *     else (players, brands, umpires, anon).
 *   - For clubs without an auto-seeded context (rare — backfill
 *     covers existing clubs), the chip shows "Set recruiting
 *     context →" as an empty-state CTA.
 *
 * Visual: matches ClubFitChip's purple accent + small pill scale
 * so the two read as part of the same family without competing for
 * attention.
 */

import { useState } from 'react'
import { ChevronDown, Target, X } from 'lucide-react'
import { useAuthStore } from '@/lib/auth'
import { useRecruitingContext } from '@/hooks/useRecruitingContext'
import ContextEditSheet from './ContextEditSheet'

interface ContextSwitcherProps {
  className?: string
}

export default function ContextSwitcher({ className = '' }: ContextSwitcherProps) {
  const { profile: viewer } = useAuthStore()
  const { active, loading, clearActive } = useRecruitingContext()
  const [sheetOpen, setSheetOpen] = useState(false)
  const [clearing, setClearing] = useState(false)

  const viewerRole = viewer?.role
  if (viewerRole !== 'club' && viewerRole !== 'coach') return null
  // F4 (QA): during cold-load fetch, render an invisible placeholder
  // matching the chip's intrinsic height so the surrounding layout
  // doesn't reflow when the real chip pops in. Was a 2-3s empty gap
  // above the Community tabs.
  if (loading && !active) {
    return <div className={['inline-flex h-[30px]', className].join(' ')} aria-hidden="true" />
  }

  const summary = formatContextSummary(active)
  const isEmpty = !active
  // Role-aware empty-state copy. Coaches need a context for Club Fit
  // to render at all (no profile-derived target source); clubs get
  // Fit from profile fields, so a context is genuinely optional for
  // them. The old generic "(optional)" copy misled coaches into
  // skipping it and never seeing Fit chips on player cards.
  const isCoach = viewerRole === 'coach'
  const emptyLabel = isCoach ? 'Set scope to enable Club Fit' : 'Add recruiting context'
  const emptyHint = isCoach ? null : '(optional)'
  const ariaEmpty = isCoach
    ? 'Set a recruiting scope to enable Club Fit ratings on player cards'
    : 'Add an optional recruiting context'

  // Clear affordance: only meaningful when there IS an active context.
  // Sprint 4 removed the auto-seed `type='club'` fallback, so there's
  // no "default context" to reset to — clear means "no scope, show
  // everyone". One tap on the chip's X to opt out without opening
  // the full sheet.
  const handleClear = async () => {
    setClearing(true)
    await clearActive()
    setClearing(false)
  }

  return (
    // F14 (QA): cap the row width to the viewport's available space
    // and let the label segment truncate. Without this, long opp
    // titles ("E2E Vacancy - Automated Test") push × Clear off-screen
    // at 390px and produce horizontal scroll. `max-w-full` + `min-w-0`
    // on the inner button enable the ellipsis.
    <div className="inline-flex items-center gap-1.5 max-w-full">
      <button
        type="button"
        onClick={() => setSheetOpen(true)}
        className={[
          'inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full min-w-0',
          'text-xs font-medium border transition-colors',
          isEmpty
            ? 'border-dashed border-gray-300 text-gray-600 hover:border-[#8026FA]/50 hover:text-[#8026FA] hover:bg-[#8026FA]/5'
            : 'border-[#8026FA]/30 bg-[#8026FA]/5 text-[#8026FA] hover:bg-[#8026FA]/10',
          'focus:outline-none focus-visible:ring-2 focus-visible:ring-[#8026FA]/40',
          className,
        ].join(' ')}
        aria-label={isEmpty ? ariaEmpty : `Recruiting context: ${summary}. Tap to change or clear.`}
      >
        <Target className="w-3.5 h-3.5 flex-shrink-0" />
        {isEmpty ? (
          <span>
            {emptyLabel}
            {emptyHint && <span className="text-gray-400"> {emptyHint}</span>}
          </span>
        ) : (
          <>
            <span className="text-gray-500 flex-shrink-0">Scoped to:</span>
            <span className="font-semibold truncate min-w-0" title={summary}>{summary}</span>
          </>
        )}
        <ChevronDown className="w-3 h-3 opacity-60 flex-shrink-0" />
      </button>
      {!isEmpty && (
        <button
          type="button"
          onClick={handleClear}
          disabled={clearing}
          className={[
            'inline-flex items-center gap-1 px-2 py-1.5 rounded-full',
            'text-[11px] font-medium text-gray-500 hover:text-gray-800 hover:bg-gray-100',
            'transition-colors disabled:opacity-50',
            'focus:outline-none focus-visible:ring-2 focus-visible:ring-gray-300',
          ].join(' ')}
          aria-label="Clear active recruiting context"
          title="Clear scope"
        >
          <X className="w-3 h-3" />
          Clear
        </button>
      )}
      <ContextEditSheet
        isOpen={sheetOpen}
        onClose={() => setSheetOpen(false)}
      />
    </div>
  )
}

/** Short, human-friendly summary of a context for the pill body.
 *  Prefers the saved label, falls back to "{target} · {region}" when
 *  the label is missing (e.g., a freshly-seeded club context with
 *  a region but no curated label). */
function formatContextSummary(
  active: { label: string | null; target_category: string | null; region: string | null } | null,
): string {
  if (!active) return ''
  if (active.label && active.label.trim()) return active.label.trim()
  const parts: string[] = []
  if (active.target_category) parts.push(active.target_category)
  if (active.region) parts.push(active.region)
  return parts.length > 0 ? parts.join(' · ') : 'Unscoped'
}
