import { useNavigate } from 'react-router-dom'
import { useCountries } from '@/hooks/useCountries'
import { roleTitle } from '@/lib/homeEngagement'
import { trackCardClick } from '@/lib/homeInstrumentation'
import { navState } from '@/lib/navSource'
import { RoleCoverCard } from '../RoleCoverCard'
import type { OpportunityPostedFeedItem } from '@/types/homeFeed'

/**
 * Opportunity (Figma 60:380): cover + crest card, OPEN ROLE chip. No button
 * on the card (audit A5): the whole card opens the role page, where Apply lives.
 */
export function OpportunityCard({ item }: { item: OpportunityPostedFeedItem }) {
  const { countries } = useCountries()
  const navigate = useNavigate()
  // The v2 role page, the same as Opportunities; Back returns to Home at the same scroll.
  const open = () => {
    trackCardClick(item.feed_item_id, item.item_type, `/opportunities/${item.opportunity_id}`)
    navigate(`/opportunities/${item.opportunity_id}`, navState('home_feed_card'))
  }
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
        roleId={item.opportunity_id}
      />
    </article>
  )
}
