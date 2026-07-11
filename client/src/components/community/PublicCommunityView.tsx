import { useEffect, useState, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { ShieldCheck, Users, FileText, MessageSquare } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { logger } from '@/lib/logger'
import PublicReferencesSection from '../PublicReferencesSection'
import CommentsTab from '../CommentsTab'
import ProfilePostsTab from '../ProfilePostsTab'
import type { Profile } from '@/lib/supabase'

/**
 * PublicCommunityView — visitor-facing community page.
 *
 * Slimmer than the owner hub:
 *   - Lightweight stats strip (references, connections, posts) so visitors
 *     get the same trust signals as the dashboard's CommunityCard.
 *   - Trusted references — read-only carousel (re-uses
 *     PublicReferencesSection — its empty state and copy are already
 *     visitor-tuned per the Phase 4 References UX work).
 *   - Public connections — count + link to find people; we don't surface
 *     the connection list since it can be sensitive.
 *   - Comments — read-only; visitors can leave one if signed in.
 *   - Posts — public feed.
 */
interface PublicCommunityViewProps {
  profile: Pick<
    Profile,
    'id' | 'role' | 'full_name' | 'username' | 'accepted_friend_count' | 'accepted_reference_count' | 'post_count'
  >
}

export default function PublicCommunityView({ profile }: PublicCommunityViewProps) {
  const navigate = useNavigate()

  const [commentCount, setCommentCount] = useState<number | null>(null)
  useEffect(() => {
    let cancelled = false
    const load = async () => {
      try {
        const { count, error } = await supabase
          .from('profile_comments')
          .select('id', { count: 'exact', head: true })
          .eq('profile_id', profile.id)
          .is('parent_id', null)
        if (error) throw error
        if (!cancelled) setCommentCount(count ?? 0)
      } catch (err) {
        logger.error('[PublicCommunityView] comment count failed', err)
      }
    }
    void load()
    return () => {
      cancelled = true
    }
  }, [profile.id])

  const firstName = useMemo(
    () => profile.full_name?.split(' ')[0]?.trim() || profile.username || 'this member',
    [profile.full_name, profile.username],
  )

  return (
    // pb-32 leaves enough scroll headroom so ?section=posts (the last
    // section) can anchor flush at the top of the viewport — see the
    // matching fix in PlayerCommunityHub.
    <div className="space-y-4 pb-32">
      <header>
        <h1 className="text-xl md:text-2xl font-bold text-gray-900">Network</h1>
        <p className="mt-1 text-sm text-gray-600">
          {firstName}'s trust signals, connections, and activity.
        </p>
      </header>

      {/* Visitor stats strip — single card, 3 metrics, no CTAs */}
      <section
        data-testid="public-community-stats"
        className="bg-white rounded-2xl border border-gray-200/80 shadow-sm p-5 md:p-6"
      >
        <div className="grid grid-cols-3 gap-2.5">
          <Stat
            icon={ShieldCheck}
            label="References"
            value={(profile.accepted_reference_count ?? 0).toString()}
            accent="emerald"
          />
          <Stat
            icon={Users}
            label="Connections"
            value={(profile.accepted_friend_count ?? 0).toString()}
            accent="gray"
          />
          <Stat
            icon={FileText}
            label="Posts"
            value={(profile.post_count ?? 0).toString()}
            accent="purple"
          />
        </div>
      </section>

      <section
        id="community-references"
        data-testid="public-community-references"
        className="bg-white rounded-2xl border border-gray-200/80 shadow-sm p-5 md:p-6 scroll-mt-20"
      >
        <PublicReferencesSection
          profileId={profile.id}
          profileName={profile.full_name ?? profile.username ?? null}
        />
      </section>

      <section
        id="community-comments"
        data-testid="public-community-comments"
        className="bg-white rounded-2xl border border-gray-200/80 shadow-sm p-5 md:p-6 scroll-mt-20"
      >
        <header className="flex items-center gap-2.5 mb-4">
          <MessageSquare className="h-5 w-5 text-hockia-primary" aria-hidden="true" />
          <h2 className="text-base font-semibold text-gray-900">Comments</h2>
          {commentCount !== null && (
            <span className="ml-1 text-sm text-gray-500">({commentCount})</span>
          )}
          <button
            type="button"
            onClick={() => {
              // Visitor route is /<role-prefix>/:username/comments OR
              // /<role-prefix>/id/:id/comments — role-aware so coach
              // visitors land on /coaches/...:
              const rolePrefix =
                profile.role === 'coach'
                  ? '/coaches'
                  : profile.role === 'club'
                    ? '/clubs'
                    : profile.role === 'umpire'
                      ? '/umpires'
                      : profile.role === 'brand'
                        ? '/brands'
                        : '/players'
              const base = profile.username
                ? `${rolePrefix}/${profile.username}`
                : `${rolePrefix}/id/${profile.id}`
              navigate(`${base}/comments`)
            }}
            className="ml-auto text-sm font-medium text-hockia-primary hover:text-[#6B20D4]"
          >
            View all
          </button>
        </header>
        <CommentsTab profileId={profile.id} profileRole={profile.role} forceVisitorMode />
      </section>

      <section
        id="community-posts"
        data-testid="public-community-posts"
        className="bg-white rounded-2xl border border-gray-200/80 shadow-sm p-5 md:p-6 scroll-mt-20"
      >
        <ProfilePostsTab profileId={profile.id} readOnly />
      </section>
    </div>
  )
}

interface StatProps {
  icon: React.ComponentType<{ className?: string }>
  label: string
  value: string
  accent: 'emerald' | 'gray' | 'purple'
}

const ACCENT_CLASSES: Record<StatProps['accent'], { iconBg: string; iconColor: string }> = {
  emerald: { iconBg: 'bg-emerald-50', iconColor: 'text-emerald-600' },
  gray: { iconBg: 'bg-gray-100', iconColor: 'text-gray-500' },
  purple: { iconBg: 'bg-hockia-primary/10', iconColor: 'text-hockia-primary' },
}

function Stat({ icon: Icon, label, value, accent }: StatProps) {
  const { iconBg, iconColor } = ACCENT_CLASSES[accent]
  return (
    <div className="rounded-xl bg-gray-50/80 border border-gray-100 p-3">
      <div className={`flex h-7 w-7 items-center justify-center rounded-lg ${iconBg} mb-2`}>
        <Icon className={`h-3.5 w-3.5 ${iconColor}`} />
      </div>
      <p className="text-base font-bold text-gray-900 tabular-nums leading-none">{value}</p>
      <p className="mt-1 text-[11px] font-medium text-gray-500 leading-none">{label}</p>
    </div>
  )
}
