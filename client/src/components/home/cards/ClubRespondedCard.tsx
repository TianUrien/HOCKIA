import { Zap } from 'lucide-react'
import { FeedCard, FeedCardAction, FeedCardCaption, FeedCardFooter, FeedCardHeader, profilePathForRole } from '../FeedCard'
import type { ClubRespondedFeedItem } from '@/types/homeFeed'
import { Trans } from 'react-i18next'
import { useHomeT } from '@/i18n/ns/home'

interface Props {
  item: ClubRespondedFeedItem
}

/**
 * club_responded — "Active recruiter". An aggregate: one card per (club, week)
 * showing how many applications the club reviewed this week. Signals to
 * players that the club is actively triaging → apply now.
 */
export function ClubRespondedCard({ item }: Props) {
  const t = useHomeT()
  // Vacancies can be coach-published — then club_id/club_name carry the
  // COACH's profile, and the club route 404s ("Club profile not found").
  // author_role comes from the RPC merge; 'club' fallback = cached payloads.
  const publisherRole = item.author_role === 'coach' ? 'coach' : 'club'
  const path = profilePathForRole(publisherRole, item.club_id)
  const n = item.response_count ?? 0

  return (
    <FeedCard testId="club-responded-card">
      <FeedCardHeader
        authorId={item.club_id}
        name={item.club_name}
        avatarUrl={item.club_avatar_url}
        role={publisherRole}
        createdAt={item.created_at}
        profilePath={path}
      />
      <FeedCardCaption icon={<Zap />}>
        <Trans t={t} i18nKey="cards.clubResponded.caption" count={n} components={{ b: <span className="font-semibold text-gray-900" /> }} />
      </FeedCardCaption>
      <FeedCardFooter>
        <FeedCardAction to={path}>{publisherRole === 'coach' ? t('cards.clubResponded.viewCoach') : t('cards.clubResponded.viewClub')}</FeedCardAction>
      </FeedCardFooter>
    </FeedCard>
  )
}
