import { Eye, X } from 'lucide-react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { useAuthStore } from '@/lib/auth'
import { profilePath } from '@/lib/profileNavigation'
import type { PulseItem } from '@/hooks/useMyPulse'

/**
 * ProfileViewedPulseCard — Loop Layer L3 (v5 plan).
 *
 * Aggregator: weekly cron enqueue_profile_view_pulse_items() counts
 * club + coach viewers in the last 7 days and inserts one card per user
 * with ≥1 recruiter view, gated by a 7-day per-user cooldown.
 *
 * Card copy adapts to the dominant viewer role:
 *   - "3 clubs viewed your profile this week"
 *   - "2 coaches viewed your profile this week"
 *   - "1 club and 1 coach viewed your profile this week"
 *
 * Tap "See viewers" → deep-links to the user's own dashboard with the
 * ProfileViewersSection visible (it already mounts on every owner-side
 * dashboard tab=profile).
 */

interface ProfileViewedPulseCardProps {
  item: PulseItem
  onClick: (id: string) => void
  onDismiss: (id: string) => void
}

function readNumber(metadata: PulseItem['metadata'], key: string): number {
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) return 0
  const value = (metadata as Record<string, unknown>)[key]
  if (typeof value === 'number') return value
  return 0
}

function readString(metadata: PulseItem['metadata'], key: string): string | null {
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) return null
  const value = (metadata as Record<string, unknown>)[key]
  return typeof value === 'string' && value.trim().length > 0 ? value : null
}

function buildHeadline(uniqueClubs: number, uniqueCoaches: number): string {
  if (uniqueClubs > 0 && uniqueCoaches > 0) {
    const clubLabel = uniqueClubs === 1 ? '1 club' : `${uniqueClubs} clubs`
    const coachLabel = uniqueCoaches === 1 ? '1 coach' : `${uniqueCoaches} coaches`
    return `${clubLabel} and ${coachLabel} viewed your profile this week`
  }
  if (uniqueClubs > 0) {
    return uniqueClubs === 1
      ? '1 club viewed your profile this week'
      : `${uniqueClubs} clubs viewed your profile this week`
  }
  return uniqueCoaches === 1
    ? '1 coach viewed your profile this week'
    : `${uniqueCoaches} coaches viewed your profile this week`
}


export function ProfileViewedPulseCard({
  item,
  onClick,
  onDismiss,
}: ProfileViewedPulseCardProps) {
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const profile = useAuthStore((state) => state.profile)

  const uniqueClubs = readNumber(item.metadata, 'unique_clubs')
  const uniqueCoaches = readNumber(item.metadata, 'unique_coaches')
  const uniqueRecruiters = readNumber(item.metadata, 'unique_recruiters')

  // Defensive: if metadata is malformed, render nothing rather than a
  // broken card. PulseSection's known-types filter still marks the row
  // seen so the dispatcher doesn't fire mark-seen forever.
  if (uniqueRecruiters < 1) return null

  const headline = buildHeadline(uniqueClubs, uniqueCoaches)
  const subtitle = readString(item.metadata, 'subtitle') ??
    'Tap to see who they are and what made them stop by.'

  const handleSee = () => {
    onClick(item.id)
    const path = profilePath(profile?.role, profile?.username, profile?.id)
    if (!path) return
    const next = new URLSearchParams(searchParams)
    next.set('tab', 'profile')
    navigate(`${path}?${next.toString()}`)
  }

  const handleDismiss = (event: React.MouseEvent<HTMLButtonElement>) => {
    event.stopPropagation()
    onDismiss(item.id)
  }

  return (
    <article
      className="relative rounded-2xl border border-blue-100 bg-gradient-to-br from-blue-50 to-white p-4 shadow-sm"
      data-testid="pulse-profile-viewed-by-recruiters"
    >
      <button
        type="button"
        onClick={handleDismiss}
        className="absolute top-3 right-3 p-1 text-gray-400 hover:text-gray-600 transition-colors"
        aria-label="Dismiss"
      >
        <X className="w-4 h-4" />
      </button>

      <div className="flex items-start gap-3 pr-6">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-blue-100">
          <Eye className="w-5 h-5 text-blue-600" />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-blue-700 mb-0.5">
            This week
          </p>
          <p className="text-sm font-semibold text-gray-900 leading-snug">{headline}</p>
          <p className="text-xs text-gray-600 mt-1 leading-relaxed">{subtitle}</p>
          <button
            type="button"
            onClick={handleSee}
            className="mt-3 inline-flex items-center gap-1.5 rounded-full bg-gradient-to-r from-blue-500 to-blue-600 px-4 py-1.5 text-xs font-semibold text-white shadow-sm hover:opacity-90 transition-opacity"
          >
            See viewers
          </button>
        </div>
      </div>
    </article>
  )
}
