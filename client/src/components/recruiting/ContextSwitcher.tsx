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
import { ChevronDown, RotateCcw, Target } from 'lucide-react'
import { useAuthStore } from '@/lib/auth'
import { useRecruitingContext } from '@/hooks/useRecruitingContext'
import ContextEditSheet from './ContextEditSheet'

interface ContextSwitcherProps {
  className?: string
}

export default function ContextSwitcher({ className = '' }: ContextSwitcherProps) {
  const { profile: viewer } = useAuthStore()
  const { active, available, loading, activate } = useRecruitingContext()
  const [sheetOpen, setSheetOpen] = useState(false)
  const [resetting, setResetting] = useState(false)

  const viewerRole = viewer?.role
  if (viewerRole !== 'club' && viewerRole !== 'coach') return null
  if (loading && !active) return null

  const summary = formatContextSummary(active)
  const isEmpty = !active

  // Reset-to-default affordance: the auto-seeded type='club' context
  // is the implicit fallback. When the recruiter has navigated into
  // an opportunity (type='opportunity') or set up a custom scope
  // (type='custom'), expose a one-tap path back to the default so
  // they don't have to open the full sheet just to revert. Coaches
  // have no auto-seed, so this hides for them by virtue of no
  // 'club' row existing.
  const defaultContext = available.find((c) => c.type === 'club')
  const canReset = Boolean(
    active && defaultContext && active.id !== defaultContext.id,
  )
  const handleReset = async () => {
    if (!defaultContext) return
    setResetting(true)
    await activate(defaultContext.id)
    setResetting(false)
  }

  return (
    <div className="inline-flex items-center gap-1.5">
      <button
        type="button"
        onClick={() => setSheetOpen(true)}
        className={[
          'inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full',
          'text-xs font-medium border transition-colors',
          isEmpty
            ? 'border-dashed border-[#8026FA]/50 text-[#8026FA] hover:bg-[#8026FA]/5'
            : 'border-[#8026FA]/30 bg-[#8026FA]/5 text-[#8026FA] hover:bg-[#8026FA]/10',
          'focus:outline-none focus-visible:ring-2 focus-visible:ring-[#8026FA]/40',
          className,
        ].join(' ')}
        aria-label={isEmpty ? 'Set recruiting context' : `Recruiting context: ${summary}. Tap to change.`}
      >
        <Target className="w-3.5 h-3.5" />
        {isEmpty ? (
          <span>Set recruiting context</span>
        ) : (
          <>
            <span className="text-gray-500">Recruiting:</span>
            <span className="font-semibold">{summary}</span>
          </>
        )}
        <ChevronDown className="w-3 h-3 opacity-60" />
      </button>
      {canReset && (
        <button
          type="button"
          onClick={handleReset}
          disabled={resetting}
          className={[
            'inline-flex items-center gap-1 px-2 py-1.5 rounded-full',
            'text-[11px] font-medium text-gray-500 hover:text-gray-800 hover:bg-gray-100',
            'transition-colors disabled:opacity-50',
            'focus:outline-none focus-visible:ring-2 focus-visible:ring-gray-300',
          ].join(' ')}
          aria-label="Reset to your default recruiting context"
          title="Reset to your default context"
        >
          <RotateCcw className="w-3 h-3" />
          Reset
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
