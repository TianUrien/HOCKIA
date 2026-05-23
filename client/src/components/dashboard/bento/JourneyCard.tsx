import { useEffect, useMemo, useState } from 'react'
import { Flag, Landmark, Globe2, Award, Calendar } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { logger } from '@/lib/logger'
import { detectBioCredentials } from '@/lib/bioCredentials'
import DashboardCard from './DashboardCard'

/**
 * JourneyCard — career-history summary tile. Counts grouped by
 * `career_history.entry_type`:
 *   - club            → "Clubs"
 *   - national_team   → "Representative selections" (covers regional,
 *                       provincial, state, national — not just
 *                       international; the DB enum value is a legacy name)
 *   - achievement     → "Achievements"
 *   - tournament      → folds into "Achievements"
 *   - milestone       → "Milestones"
 *   - academy         → folds into "Milestones"
 *   - other           → ignored
 *
 * Counts come from a single grouped query. Empty profiles see a
 * gentle prompt instead of zeros.
 */
interface JourneyCardProps {
  profileId: string
  /** Used to hide the empty-state prompt for visitors (no edit affordance). */
  readOnly: boolean
  /** Drives the read-only empty-state copy ("This {role} hasn't…"). */
  role?: 'player' | 'coach'
  /** Free-text bio. When present, high-signal credentials (World Cup,
   *  Olympic, NCAA, Pan Am, Premier League, FIH, captain, medals) are
   *  extracted and rendered as a "From bio" footer. Closes the QA-reported
   *  trust gap where Hockia AI surfaces bio-extracted credentials in
   *  recommendation bullets but the profile's Journey section showed
   *  nothing to verify against. */
  bio?: string | null
  onViewJourney: () => void
}

interface GroupedCounts {
  clubs: number
  representative: number
  achievements: number
  milestones: number
  total: number
}

const EMPTY: GroupedCounts = {
  clubs: 0,
  representative: 0,
  achievements: 0,
  milestones: 0,
  total: 0,
}

export default function JourneyCard({ profileId, readOnly, role = 'player', bio, onViewJourney }: JourneyCardProps) {
  const [counts, setCounts] = useState<GroupedCounts | null>(null)

  // Pure regex scan; same patterns as the Hockia AI owner-handler
  // (supabase/functions/nl-search/index.ts). Empty array when no bio
  // or no credentials match — section renders nothing in that case.
  const bioCredentials = useMemo(() => detectBioCredentials(bio), [bio])

  useEffect(() => {
    let cancelled = false
    async function fetchCounts() {
      const { data, error } = await supabase
        .from('career_history')
        .select('entry_type')
        .eq('user_id', profileId)

      if (cancelled) return
      if (error) {
        logger.error('[JOURNEY_CARD] Failed to fetch journey counts', error)
        setCounts(EMPTY)
        return
      }

      const grouped: GroupedCounts = { ...EMPTY }
      for (const row of data ?? []) {
        const type = (row.entry_type ?? 'other') as string
        switch (type) {
          case 'club':
            grouped.clubs += 1
            break
          case 'national_team':
            // DB enum value is legacy ('national_team') but the bucket
            // now covers any representative-team experience: regional,
            // provincial, state, or national. JourneyTab uses
            // "Representative Team" as the entry-type label.
            grouped.representative += 1
            break
          case 'achievement':
          case 'tournament':
            grouped.achievements += 1
            break
          case 'milestone':
          case 'academy':
            grouped.milestones += 1
            break
        }
        grouped.total += 1
      }
      setCounts(grouped)
    }
    void fetchCounts()
    return () => {
      cancelled = true
    }
  }, [profileId])

  const isEmpty = counts !== null && counts.total === 0

  return (
    <DashboardCard
      icon={Flag}
      title="Journey"
      subtitle="Career history and achievements"
      ctaLabel={isEmpty && readOnly ? undefined : isEmpty ? 'Add to your journey' : 'View journey'}
      onCtaClick={onViewJourney}
      testId="journey-card"
    >
      {counts === null ? (
        <div className="space-y-2">
          <div className="h-3 bg-gray-100 rounded animate-pulse w-2/3" />
          <div className="h-3 bg-gray-100 rounded animate-pulse w-1/2" />
        </div>
      ) : isEmpty ? (
        <p className="text-sm text-gray-500">
          {readOnly
            ? `This ${role} hasn't added career history yet.`
            : role === 'coach'
              ? "Add clubs, selections, and achievements so clubs see where you've coached."
              : "Add clubs, selections, and achievements so clubs see where you've played."}
        </p>
      ) : (
        <ul className="space-y-2.5">
          <Row icon={Landmark} label="Clubs" count={counts.clubs} />
          <Row icon={Globe2} label="Representative selections" count={counts.representative} />
          <Row icon={Award} label="Achievements" count={counts.achievements} />
          <Row icon={Calendar} label="Milestones" count={counts.milestones} />
        </ul>
      )}

      {/* "From bio" credentials — labeled as bio-extracted so a club
          reviewing the AI's bullets sees the same source of truth on
          the player's profile, without conflating it with verified
          career_history entries. Renders regardless of whether the
          structured Journey is empty or populated. */}
      {bioCredentials.length > 0 && (
        <div className="mt-4 pt-3 border-t border-gray-100">
          <p className="text-[11px] font-medium uppercase tracking-wide text-gray-400 mb-2">
            From bio
          </p>
          <div className="flex flex-wrap gap-1.5">
            {bioCredentials.map(cred => (
              <span
                key={cred}
                className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-purple-50 text-[#8026FA]"
              >
                {cred}
              </span>
            ))}
          </div>
        </div>
      )}
    </DashboardCard>
  )
}

interface RowProps {
  icon: React.ComponentType<{ className?: string }>
  label: string
  count: number
}

function Row({ icon: Icon, label, count }: RowProps) {
  return (
    <li className="flex items-center justify-between gap-3">
      <span className="flex items-center gap-2 text-sm text-gray-700 min-w-0">
        <Icon className="h-4 w-4 text-gray-400 flex-shrink-0" />
        <span className="truncate">{label}</span>
      </span>
      <span className="text-sm font-semibold text-gray-900 tabular-nums">{count}</span>
    </li>
  )
}
