import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { BookmarkCheck, Bookmark } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/lib/auth'
import { logger } from '@/lib/logger'
import { requestCache } from '@/lib/requestCache'
import { Avatar } from '@/components'
import { getInitials } from '@/lib/utils'
import DashboardCard from './DashboardCard'

/**
 * SavedCandidatesCard — Bento card surfacing the recruiter's private
 * Saved Candidates list (Phase 1 of the Career Snapshot + Shortlist
 * initiative). Replaces the buried "Saved (N)" inline link that used
 * to live inside CoachPostedOpportunitiesCard.
 *
 * Owner-only. Shows the total count + up to 3 recent saves as small
 * avatars so the owner remembers who's in there without tapping
 * through. CTA opens /dashboard/saved.
 *
 * Single fetch — reads the most recent saved_profiles rows joined with
 * each saved profile's avatar + name. Cheap (head count + 3 rows).
 */
interface RecentSave {
  saved_profile_id: string
  full_name: string | null
  avatar_url: string | null
  role: string | null
}

/** Recruiters (club/coach) save *candidates*; players save mixed
 *  profiles (clubs, coaches, other players) they want to revisit or
 *  message — so the copy flexes by role. The data + fetch + route are
 *  identical; only the framing changes. */
interface SavedCandidatesCardProps {
  variant?: 'recruiter' | 'player'
}

const VARIANT_COPY = {
  recruiter: {
    title: 'Saved Candidates',
    subtitle: "Players you've bookmarked from Community",
    emptyCount: 'No saved candidates yet',
    emptyHint:
      'Tap the bookmark icon on any player card in Community to save them here. Only you can see this list — saved players are never notified.',
  },
  player: {
    title: 'Saved Profiles',
    subtitle: 'People you saved to revisit later',
    emptyCount: 'No saved profiles yet',
    emptyHint:
      'Tap the bookmark icon on any profile to save them here. Only you can see this list — saved people are never notified.',
  },
} as const

export default function SavedCandidatesCard({ variant = 'recruiter' }: SavedCandidatesCardProps) {
  const copy = VARIANT_COPY[variant]
  const { user } = useAuthStore()
  const navigate = useNavigate()
  const [count, setCount] = useState<number | null>(null)
  const [recent, setRecent] = useState<RecentSave[]>([])

  useEffect(() => {
    if (!user?.id) return
    let cancelled = false
    // Bento-card fetch dedup (JourneyCard pattern). Both queries cached
    // together under one key so Bento re-renders + tab navs share a
    // single round trip. 30s TTL — Save toggles in the grid bust the
    // useSavedProfileIds shared store; this Bento summary refreshes on
    // next visit after TTL.
    const cacheKey = `saved-candidates-card-${user.id}`
    const fetchAll = async () => {
      try {
        const result = await requestCache.dedupe<{ count: number; recent: RecentSave[] }>(
          cacheKey,
          async () => {
            const [countRes, recentRes] = await Promise.all([
              supabase
                .from('saved_profiles')
                .select('id', { count: 'exact', head: true })
                .eq('owner_id', user.id),
              supabase
                .from('saved_profiles')
                .select(`
                  saved_profile_id,
                  profile:profiles!saved_profiles_saved_profile_id_fkey(
                    full_name,
                    avatar_url,
                    role
                  )
                `)
                .eq('owner_id', user.id)
                .order('created_at', { ascending: false })
                .limit(3),
            ])
            if (countRes.error) {
              logger.warn('[SavedCandidatesCard] count failed', countRes.error)
            }
            if (recentRes.error) {
              logger.warn('[SavedCandidatesCard] recent failed', recentRes.error)
            }
            const rows = (recentRes.data ?? []) as unknown as Array<{
              saved_profile_id: string
              profile: { full_name: string | null; avatar_url: string | null; role: string | null } | null
            }>
            return {
              count: countRes.count ?? 0,
              recent: rows
                .filter((r) => r.profile !== null)
                .map((r) => ({
                  saved_profile_id: r.saved_profile_id,
                  full_name: r.profile!.full_name,
                  avatar_url: r.profile!.avatar_url,
                  role: r.profile!.role,
                })),
            }
          },
          30000,
        )
        if (cancelled) return
        setCount(result.count)
        setRecent(result.recent)
      } catch (err) {
        if (cancelled) return
        logger.error('[SavedCandidatesCard] fetch failed', err)
        setCount(0)
        setRecent([])
      }
    }

    void fetchAll()
    return () => {
      cancelled = true
    }
  }, [user?.id])

  const countLabel =
    count === null
      ? '—'
      : count === 0
        ? copy.emptyCount
        : count === 1
          ? '1 saved'
          : `${count} saved`

  const hasSaves = count !== null && count > 0
  const recentDisplayName = recent[0]?.full_name?.split(' ')[0] ?? null

  return (
    <DashboardCard
      icon={BookmarkCheck}
      title={copy.title}
      subtitle={copy.subtitle}
      ctaLabel={hasSaves ? 'View all' : 'Browse Community'}
      onCtaClick={() => navigate(hasSaves ? '/dashboard/saved' : '/community')}
      testId="saved-candidates-card"
    >
      <div className="space-y-3.5">
        <div className="rounded-xl border border-gray-100 bg-gray-50/60 px-4 py-3.5">
          <div className="flex items-center gap-1.5 text-xs text-gray-500 mb-1">
            <Bookmark className="h-3.5 w-3.5 text-[#8026FA]" />
            <span>Your private list</span>
          </div>
          <p
            className={`text-base font-bold tabular-nums leading-none ${
              hasSaves ? 'text-gray-900' : 'text-gray-500'
            }`}
          >
            {countLabel}
          </p>
        </div>

        {recent.length > 0 ? (
          <div className="flex items-center gap-2">
            <div className="flex -space-x-2">
              {recent.map((r) => (
                <div
                  key={r.saved_profile_id}
                  className="ring-2 ring-white rounded-full"
                  title={r.full_name ?? ''}
                >
                  <Avatar
                    src={r.avatar_url}
                    initials={getInitials(r.full_name)}
                    alt={r.full_name ?? ''}
                    role={r.role}
                    size="sm"
                  />
                </div>
              ))}
            </div>
            {recentDisplayName && (
              <p className="text-xs text-gray-600 truncate">
                Recent: <span className="font-medium text-gray-900">{recentDisplayName}</span>
                {count !== null && count > 1 && (
                  <span className="text-gray-500"> + {count - 1} more</span>
                )}
              </p>
            )}
          </div>
        ) : count !== null ? (
          <p className="text-xs text-gray-500 leading-relaxed">
            {copy.emptyHint}
          </p>
        ) : null}
      </div>
    </DashboardCard>
  )
}
