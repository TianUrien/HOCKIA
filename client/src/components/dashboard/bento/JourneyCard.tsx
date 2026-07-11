import { useEffect, useMemo, useState } from 'react'
import { Flag, Landmark, Globe2, Award, Calendar } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { logger } from '@/lib/logger'
import { requestCache } from '@/lib/requestCache'
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
  /** Denormalized total entry count on profiles.career_entry_count
   *  (trigger-maintained). When passed AND zero, the card renders the
   *  empty state without firing the breakdown fetch — the common case
   *  on fresh profiles. Optional for back-compat; omit to always
   *  fetch. */
  careerEntryCount?: number | null
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

export default function JourneyCard({ profileId, readOnly, role = 'player', careerEntryCount, bio, onViewJourney }: JourneyCardProps) {
  const [counts, setCounts] = useState<GroupedCounts | null>(null)

  // Pure regex scan; same patterns as the Hockia AI owner-handler
  // (supabase/functions/nl-search/index.ts). Empty array when no bio
  // or no credentials match — section renders nothing in that case.
  const bioCredentials = useMemo(() => detectBioCredentials(bio), [bio])

  // F2 fix — short-circuit the fetch when the denormalized total is
  // known to be 0. Avoids a wasted GET on fresh profiles (common case
  // for the coach dashboard QA flagged).
  const knownEmpty = careerEntryCount === 0

  useEffect(() => {
    if (knownEmpty) {
      setCounts(EMPTY)
      return
    }
    let cancelled = false
    // F2 fix — requestCache.dedupe so re-mounts of the same profile in
    // a session reuse the same breakdown. Bento Grid re-renders + tab
    // navigations used to fire the same GET repeatedly. 30s TTL keeps
    // the breakdown fresh enough after a Journey edit (the edit flow
    // also clears the cache via cacheKey below).
    const cacheKey = `journey-counts-${profileId}`
    const run = async () => {
      try {
        const grouped = await requestCache.dedupe<GroupedCounts>(
          cacheKey,
          async () => {
            const { data, error } = await supabase
              .from('career_history')
              .select('entry_type')
              .eq('user_id', profileId)
            if (error) throw error
            const result: GroupedCounts = { ...EMPTY }
            for (const row of data ?? []) {
              const type = (row.entry_type ?? 'other') as string
              switch (type) {
                case 'club':
                  result.clubs += 1
                  break
                case 'national_team':
                  // DB enum value is legacy ('national_team') but the
                  // bucket now covers any representative-team experience:
                  // regional, provincial, state, or national. JourneyTab
                  // uses "Representative Team" as the entry-type label.
                  result.representative += 1
                  break
                case 'achievement':
                case 'tournament':
                  result.achievements += 1
                  break
                case 'milestone':
                case 'academy':
                  result.milestones += 1
                  break
              }
              result.total += 1
            }
            return result
          },
          30000,
        )
        if (!cancelled) setCounts(grouped)
      } catch (err) {
        if (cancelled) return
        logger.error('[JOURNEY_CARD] Failed to fetch journey counts', err)
        setCounts(EMPTY)
      }
    }
    void run()
    return () => {
      cancelled = true
    }
  }, [profileId, knownEmpty])

  const isEmpty = counts !== null && counts.total === 0

  return (
    <DashboardCard
      icon={Flag}
      title="Career History"
      subtitle="Clubs, teams, and achievements"
      ctaLabel={isEmpty && readOnly ? undefined : isEmpty ? 'Add entry' : 'View all'}
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
                className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-purple-50 text-hockia-primary"
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
