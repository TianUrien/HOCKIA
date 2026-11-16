import { useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { Sparkles, X } from 'lucide-react'
import { useAuthStore } from '@/lib/auth'
import { profilePath } from '@/lib/profileNavigation'
import type { PulseItem } from '@/hooks/useMyPulse'
import { useHomeT } from '@/i18n/ns/home'

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

function buildCopy(item: PulseItem, t: ReturnType<typeof useHomeT>): CelebrationCopy | null {
  const signal = readString(item.metadata, 'signal')
  if (!isCelebrationSignal(signal)) return null

  switch (signal) {
    case 'first_reference': {
      const name = readString(item.metadata, 'endorser_name')
      return {
        title: t('celebration.reference.title'),
        subtitle: name
          ? t('celebration.reference.bodyNamed', { name })
          : t('celebration.reference.body'),
      }
    }
    case 'first_highlight_video':
      return {
        title: t('celebration.highlight.title'),
        subtitle: t('celebration.highlight.body'),
      }
    case 'first_career_entry': {
      const club = readString(item.metadata, 'club_name')
      return {
        title: t('celebration.career.title'),
        subtitle: club
          ? t('celebration.career.bodyNamed', { club })
          : t('celebration.career.body'),
      }
    }
    case 'first_world_club_link': {
      const club = readString(item.metadata, 'club_name')
      return {
        title: t('celebration.clubLink.title'),
        subtitle: club
          ? t('celebration.clubLink.bodyNamed', { club })
          : t('celebration.clubLink.body'),
      }
    }
  }
}

export function SnapshotGainCelebrationCard({
  item,
  onClick,
  onDismiss,
}: SnapshotGainCelebrationCardProps) {
  const t = useHomeT()
  const navigate = useNavigate()
  const profile = useAuthStore((state) => state.profile)

  const copy = useMemo(() => buildCopy(item, t), [item, t])

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
        aria-label={t('celebration.dismiss')}
      >
        <X className="w-4 h-4" />
      </button>

      <div className="flex items-start gap-3 pr-6">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-purple-100">
          <Sparkles className="w-5 h-5 text-hockia-primary" aria-hidden="true" />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold text-gray-900">{copy.title}</p>
          <p className="text-xs text-gray-600 mt-0.5">{copy.subtitle}</p>
          <button
            type="button"
            onClick={handleView}
            className="mt-2 inline-flex items-center px-3 py-1.5 text-xs font-medium text-white bg-gradient-to-r from-hockia-primary to-hockia-secondary rounded-lg hover:opacity-90 transition-opacity"
          >
            {t('celebration.cta')}
          </button>
        </div>
      </div>
    </article>
  )
}
