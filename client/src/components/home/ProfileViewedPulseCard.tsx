import { Eye, X } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import type { PulseItem } from '@/hooks/useMyPulse'
import { useHomeT } from '@/i18n/ns/home'

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
 * Tap "See viewers" → deep-links to the user's own dashboard viewers
 * section: /dashboard/profile?tab=profile&section=viewers (the exact route
 * the profile-viewed notification uses; ProfileViewersSection mounts on the
 * owner dashboard and the section=viewers anchor scrolls to it). NOTE: this
 * must NOT use profilePath() — that resolves to the PUBLIC /players/:username
 * profile (the "you are viewing your network profile" page), which has no
 * viewers list.
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

function buildHeadline(uniqueClubs: number, uniqueCoaches: number, t: ReturnType<typeof useHomeT>): string {
  if (uniqueClubs > 0 && uniqueCoaches > 0) {
    // Two counts in one sentence: one key per singular/plural pairing.
    const vars = { clubs: uniqueClubs, coaches: uniqueCoaches }
    if (uniqueClubs === 1) return uniqueCoaches === 1 ? t('profileViews.clubAndCoach', vars) : t('profileViews.clubAndCoaches', vars)
    return uniqueCoaches === 1 ? t('profileViews.clubsAndCoach', vars) : t('profileViews.clubsAndCoaches', vars)
  }
  if (uniqueClubs > 0) return t('profileViews.clubs', { count: uniqueClubs })
  return t('profileViews.coaches', { count: uniqueCoaches })
}


export function ProfileViewedPulseCard({
  item,
  onClick,
  onDismiss,
}: ProfileViewedPulseCardProps) {
  const t = useHomeT()
  const navigate = useNavigate()

  const uniqueClubs = readNumber(item.metadata, 'unique_clubs')
  const uniqueCoaches = readNumber(item.metadata, 'unique_coaches')
  const uniqueRecruiters = readNumber(item.metadata, 'unique_recruiters')

  // Defensive: if metadata is malformed, render nothing rather than a
  // broken card. PulseSection's known-types filter still marks the row
  // seen so the dispatcher doesn't fire mark-seen forever.
  if (uniqueRecruiters < 1) return null

  const headline = buildHeadline(uniqueClubs, uniqueCoaches, t)
  const subtitle = readString(item.metadata, 'subtitle') ??
    t('profileViews.subtitle')

  const handleSee = () => {
    onClick(item.id)
    // Owner dashboard viewers section — NOT the public profile. Same route
    // the profile-viewed notification uses (notifications/config.ts).
    navigate('/dashboard/profile?tab=profile&section=viewers')
  }

  const handleDismiss = (event: React.MouseEvent<HTMLButtonElement>) => {
    event.stopPropagation()
    onDismiss(item.id)
  }

  return (
    <article
      className="relative rounded-2xl border border-brand-primary/15 bg-gradient-to-br from-hockia-soft to-white p-4 shadow-sm"
      data-testid="pulse-profile-viewed-by-recruiters"
    >
      <button
        type="button"
        onClick={handleDismiss}
        className="absolute top-3 right-3 p-1 text-gray-400 hover:text-gray-600 transition-colors"
        aria-label={t('profileViews.dismiss')}
      >
        <X className="w-4 h-4" />
      </button>

      <div className="flex items-start gap-3 pr-6">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-white">
          <Eye className="w-5 h-5 text-hockia-primary" />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-brand-text mb-0.5">
            {t('profileViews.eyebrow')}
          </p>
          <p className="text-sm font-semibold text-gray-900 leading-snug">{headline}</p>
          <p className="text-xs text-gray-600 mt-1 leading-relaxed">{subtitle}</p>
          <button
            type="button"
            onClick={handleSee}
            className="mt-3 inline-flex items-center gap-1.5 rounded-full bg-brand-primary px-4 py-1.5 text-xs font-semibold text-white shadow-sm hover:opacity-90 transition-opacity"
          >
            {t('profileViews.cta')}
          </button>
        </div>
      </div>
    </article>
  )
}
