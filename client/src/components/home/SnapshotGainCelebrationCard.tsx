import { useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { Sparkles, X } from 'lucide-react'
import { useAuthStore } from '@/lib/auth'
import { profilePath } from '@/lib/profileNavigation'
import type { PulseItem } from '@/hooks/useMyPulse'

/**
 * SnapshotGainCelebrationCard — first Pulse card type (v5 plan, Phase 1B.3).
 *
 * Owner-only celebration that fires when the profile gains a NEW Snapshot
 * signal for the first time: first reference accepted, first highlight
 * video added, first career entry, or first verified club link. Trigger-
 * based; the SQL helper enforces a 7-day per-user frequency cap so even a
 * burst of signals only celebrates once per week.
 *
 * Trust-aligned copy — celebrate the proof, not the user. We say "Reference
 * accepted" rather than "You're amazing." The CTA opens the user's own
 * Profile Snapshot so they can see how the gain shows up to recruiters.
 */

interface SnapshotGainCelebrationCardProps {
  item: PulseItem
  onClick: (id: string) => void
  onDismiss: (id: string) => void
}

type CelebrationSignal =
  | 'first_reference'
  | 'first_highlight_video'
  | 'first_career_entry'
  | 'first_world_club_link'

interface CelebrationCopy {
  title: string
  subtitle: string
}

function isCelebrationSignal(value: unknown): value is CelebrationSignal {
  return (
    value === 'first_reference' ||
    value === 'first_highlight_video' ||
    value === 'first_career_entry' ||
    value === 'first_world_club_link'
  )
}

function readString(metadata: PulseItem['metadata'], key: string): string | null {
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) return null
  const value = (metadata as Record<string, unknown>)[key]
  return typeof value === 'string' && value.trim().length > 0 ? value : null
}

function buildCopy(item: PulseItem): CelebrationCopy | null {
  const signal = readString(item.metadata, 'signal')
  if (!isCelebrationSignal(signal)) return null

  switch (signal) {
    case 'first_reference': {
      const name = readString(item.metadata, 'endorser_name')
      return {
        title: 'First reference accepted',
        subtitle: name
          ? `${name} endorsed your profile — recruiters can see it now.`
          : 'A coach or peer endorsed your profile — recruiters can see it now.',
      }
    }
    case 'first_highlight_video':
      return {
        title: 'Highlight video added',
        subtitle: 'Your profile now shows recruiters how you actually play.',
      }
    case 'first_career_entry': {
      const club = readString(item.metadata, 'club_name')
      return {
        title: 'First career entry added',
        subtitle: club
          ? `${club} is now part of your career history.`
          : 'Your career history just got its first entry.',
      }
    }
    case 'first_world_club_link': {
      const club = readString(item.metadata, 'club_name')
      return {
        title: 'Club connection verified',
        subtitle: club
          ? `Your profile is now linked to ${club}.`
          : 'Your profile is now linked to a verified club.',
      }
    }
  }
}

export function SnapshotGainCelebrationCard({
  item,
  onClick,
  onDismiss,
}: SnapshotGainCelebrationCardProps) {
  const navigate = useNavigate()
  const profile = useAuthStore((state) => state.profile)

  const copy = useMemo(() => buildCopy(item), [item])

  if (!copy) return null

  const handleView = () => {
    onClick(item.id)
    const path = profilePath(profile?.role, profile?.username, profile?.id)
    if (path) navigate(path)
  }

  const handleDismiss = (event: React.MouseEvent<HTMLButtonElement>) => {
    event.stopPropagation()
    onDismiss(item.id)
  }

  return (
    <article
      className="relative rounded-2xl border border-purple-100 bg-gradient-to-br from-purple-50 to-white p-4 shadow-sm"
      data-testid="pulse-snapshot-gain-celebration"
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
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-purple-100">
          <Sparkles className="w-5 h-5 text-[#8026FA]" aria-hidden="true" />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold text-gray-900">{copy.title}</p>
          <p className="text-xs text-gray-600 mt-0.5">{copy.subtitle}</p>
          <button
            type="button"
            onClick={handleView}
            className="mt-2 inline-flex items-center px-3 py-1.5 text-xs font-medium text-white bg-gradient-to-r from-[#8026FA] to-[#924CEC] rounded-lg hover:opacity-90 transition-opacity"
          >
            View snapshot
          </button>
        </div>
      </div>
    </article>
  )
}
