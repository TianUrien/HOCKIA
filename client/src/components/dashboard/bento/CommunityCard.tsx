import { useEffect, useState } from 'react'
import { Users, Shield, MessageSquare, FileText } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { logger } from '@/lib/logger'
import { requestCache } from '@/lib/requestCache'
import { cn } from '@/lib/utils'
import DashboardCard from './DashboardCard'
import type { Profile } from '@/lib/supabase'

/**
 * CommunityCard — 4 mini-tiles for the social surfaces:
 *   - Friends     → profiles.accepted_friend_count (denormalized)
 *   - References  → profiles.accepted_reference_count (denormalized)
 *   - Comments    → profile_comments where status='visible' (one query)
 *   - Posts       → profiles.post_count (denormalized)
 *
 * Tile taps route to the relevant tab. The card CTA defaults to
 * "Go to community" → friends tab.
 */
interface CommunityCardProps {
  profile: Pick<Profile, 'id' | 'accepted_friend_count' | 'accepted_reference_count' | 'post_count'>
  /** Tile clicks deep-link to specific sections; the card's "Go to
   *  community" CTA opens the unified bundle view that stacks all four. */
  onOpenTab: (tab: 'friends' | 'references' | 'comments' | 'posts' | 'community') => void
  /** Hide the References tile. References are a player/coach trust
   *  signal — clubs don't request or receive them — so the club
   *  dashboard renders a 3-tile grid (Connections, Comments, Posts). */
  hideReferences?: boolean
  /** Visitor view. Relabels the main CTA from "Go to my network" to
   *  "View network" — a visitor isn't looking at *their* network. */
  readOnly?: boolean
}

export default function CommunityCard({ profile, onOpenTab, hideReferences = false, readOnly = false }: CommunityCardProps) {
  const [commentCount, setCommentCount] = useState<number | null>(null)

  useEffect(() => {
    let cancelled = false
    // Bento-card fetch dedup pattern (mirror of JourneyCard fix).
    // Bento re-renders + tab navs back to landing were firing this
    // count query repeatedly. 30s TTL keeps the comment number fresh
    // enough after a moderation action — the comments tab itself
    // refetches on visit.
    const cacheKey = `community-card-comments-${profile.id}`
    async function fetchCount() {
      try {
        const count = await requestCache.dedupe<number>(
          cacheKey,
          async () => {
            const res = await supabase
              .from('profile_comments')
              .select('id', { count: 'exact', head: true })
              .eq('profile_id', profile.id)
              .eq('status', 'visible')
            if (res.error) throw res.error
            return res.count ?? 0
          },
          30000,
        )
        if (!cancelled) setCommentCount(count)
      } catch (err) {
        if (cancelled) return
        logger.error('[COMMUNITY_CARD] Failed to fetch comment count', err)
        setCommentCount(0)
      }
    }
    void fetchCount()
    return () => {
      cancelled = true
    }
  }, [profile.id])

  const friends = profile.accepted_friend_count ?? 0
  const references = profile.accepted_reference_count ?? 0
  const posts = profile.post_count ?? 0
  const comments = commentCount ?? 0

  return (
    <DashboardCard
      icon={Users}
      // "My Network" is the user's personal social hub (friends, refs,
      // comments, posts on their own profile). The bottom-nav "Community"
      // is the global HOCKIA directory — same word, different scope.
      // Renaming this card resolves the label collision QA flagged.
      title="My Network"
      subtitle={hideReferences ? 'Connections, comments and posts' : 'Friends, references, comments and posts'}
      ctaLabel={readOnly ? 'View network' : 'Go to my network'}
      // Opens the unified My Network page (all sections stacked).
      // The individual tile clicks below still deep-link to their own
      // dedicated section pages so users have both: a hub view AND
      // focused views.
      onCtaClick={() => onOpenTab('community')}
      testId="community-card"
    >
      <div className="grid grid-cols-2 gap-2.5">
        <Tile
          icon={Users}
          label="Connections"
          count={friends}
          onClick={() => onOpenTab('friends')}
        />
        {!hideReferences && (
          <Tile
            icon={Shield}
            label="References"
            count={references}
            onClick={() => onOpenTab('references')}
          />
        )}
        <Tile
          icon={MessageSquare}
          label="Comments"
          count={comments}
          loading={commentCount === null}
          onClick={() => onOpenTab('comments')}
        />
        <Tile
          icon={FileText}
          label="Posts"
          count={posts}
          onClick={() => onOpenTab('posts')}
        />
      </div>
    </DashboardCard>
  )
}

interface TileProps {
  icon: React.ComponentType<{ className?: string }>
  label: string
  count: number
  loading?: boolean
  onClick: () => void
}

function Tile({ icon: Icon, label, count, loading = false, onClick }: TileProps) {
  const ariaLabel = loading
    ? `View ${label.toLowerCase()}`
    : `View ${count} ${label.toLowerCase()}`
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={ariaLabel}
      className={cn(
        'flex items-center gap-3 rounded-xl border border-gray-100 bg-gray-50/60 p-3 text-left',
        'transition-colors hover:bg-[#8026FA]/[0.04] hover:border-[#8026FA]/30',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#8026FA]/30',
      )}
    >
      <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-white shadow-sm flex-shrink-0">
        <Icon className="h-4 w-4 text-[#8026FA]" />
      </div>
      <div className="min-w-0 flex-1">
        <p className="text-base font-bold text-gray-900 tabular-nums leading-none">
          {loading ? '—' : count}
        </p>
        <p className="text-[11px] text-gray-500 uppercase tracking-wide mt-1 leading-none">
          {label}
        </p>
      </div>
    </button>
  )
}
