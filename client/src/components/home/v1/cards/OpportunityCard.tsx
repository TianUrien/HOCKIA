import { useNavigate } from 'react-router-dom'
import { useAuthStore } from '@/lib/auth'
import { useCountries } from '@/hooks/useCountries'
import { roleTitle } from '@/lib/homeEngagement'
import { trackCardClick } from '@/lib/homeInstrumentation'
import { navState } from '@/lib/navSource'
import { RoleCoverCard } from '../RoleCoverCard'
import type { OpportunityPostedFeedItem } from '@/types/homeFeed'

/**
 * Opportunity (Figma 60:380): cover + crest card, OPEN ROLE chip, Apply as
 * the secondary action (Next step owns the primary). Apply only for someone
 * who can apply — a player on a player role, a coach on a coach role, never
 * the publisher; clubs never see Apply (spec 65:329) and get "View".
 */
export function OpportunityCard({ item }: { item: OpportunityPostedFeedItem }) {
  const viewerId = useAuthStore((s) => s.user?.id ?? null)
  const viewerRole = useAuthStore((s) => s.profile?.role ?? null)
  const { countries } = useCountries()
  const navigate = useNavigate()
  // The v2 role page, the same as Opportunities; Back returns to Home at the same scroll.
  const open = () => {
    trackCardClick(item.feed_item_id, item.item_type, `/opportunities/${item.opportunity_id}`)
    navigate(`/opportunities/${item.opportunity_id}`, navState('home_feed_card'))
  }
  const roleType = item.opportunity_type ?? 'player'
  const canApply = Boolean(viewerId) && viewerId !== item.club_id
    && ((viewerRole === 'player' && roleType === 'player') || (viewerRole === 'coach' && roleType === 'coach'))
  const clubName = item.world_club_name || item.club_name || 'Club'
  const crest = item.world_club_avatar || item.club_logo
  const country = countries.find((c) => c.name === item.location_country || c.common_name === item.location_country)
  const where = [clubName, [country?.flag_emoji, item.location_country].filter(Boolean).join(' ') || item.location_city].filter(Boolean).join(' · ')

  return (
    <article className="p-4" data-testid="home-opportunity-card">
      <RoleCoverCard
        size="feed"
        chip="OPEN ROLE"
        clubId={item.club_id}
        clubName={clubName}
        crestUrl={crest}
        title={roleTitle(item.position, item.gender, item.title)}
        subtitle={where}
        onOpen={open}
        cta={
          <button
            type="button"
            onClick={open}
            className="flex h-11 items-center rounded-full bg-white px-4 text-[14px] font-semibold text-ink-1 transition-transform duration-300 active:scale-[0.97]"
          >
            {canApply ? 'Apply' : 'View'}
          </button>
        }
      />
    </article>
  )
}
