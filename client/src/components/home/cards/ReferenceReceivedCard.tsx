import { Link } from 'react-router-dom'
import { ShieldCheck } from 'lucide-react'
import { Avatar } from '@/components'
import { FeedCard, FeedCardAction, FeedCardBody, FeedCardCaption, FeedCardFooter, FeedCardHeader, profilePathForRole } from '../FeedCard'
import type { ReferenceReceivedFeedItem } from '@/types/homeFeed'
import { Trans } from 'react-i18next'
import { useHomeT } from '@/i18n/ns/home'

interface ReferenceReceivedCardProps {
  item: ReferenceReceivedFeedItem
}

/**
 * reference_received — the RECEIVER is the card's author (header); the
 * referee who vouched for them is named in the body. The CTA goes to the
 * receiver's profile, where the full reference + endorsement text live.
 */
export function ReferenceReceivedCard({ item }: ReferenceReceivedCardProps) {
  const t = useHomeT()
  const receiverPath = profilePathForRole(item.role, item.profile_id)
  const refereePath = item.referee_role
    ? profilePathForRole(item.referee_role, item.referee_id)
    : null
  const refereeName = item.referee_name || t('cards.reference.unknownReferee')

  const referee = (
    <>
      <Avatar
        src={item.referee_avatar}
        initials={refereeName.slice(0, 2)}
        size="sm"
        className="flex-shrink-0"
        role={item.referee_role}
      />
      <span className="min-w-0 truncate text-[14px] leading-5">
        <Trans
          t={t}
          i18nKey="cards.reference.vouched"
          values={{ referee: refereeName, member: item.full_name || t('cards.reference.unknownMember') }}
          tOptions={{ interpolation: { escapeValue: true } }}
          shouldUnescape
          components={{ name: <span className="font-semibold text-gray-900" />, rest: <span className="text-gray-500" /> }}
        />
      </span>
    </>
  )

  return (
    <FeedCard testId="reference-received-card">
      <FeedCardHeader
        authorId={item.profile_id}
        name={item.full_name}
        avatarUrl={item.avatar_url}
        role={item.role}
        createdAt={item.created_at}
        profilePath={receiverPath}
      />
      <FeedCardCaption icon={<ShieldCheck />}>{t('cards.reference.caption')}</FeedCardCaption>

      <FeedCardBody>
        {refereePath ? (
          <Link to={refereePath} className="flex items-center gap-2.5">{referee}</Link>
        ) : (
          <div className="flex items-center gap-2.5">{referee}</div>
        )}

        {item.endorsement_text && (
          <blockquote className="mt-3 line-clamp-3 rounded-xl bg-gray-50 px-4 py-3 text-[14px] italic leading-5 text-gray-700">
            &ldquo;{item.endorsement_text}&rdquo;
          </blockquote>
        )}
      </FeedCardBody>

      <FeedCardFooter>
        <FeedCardAction to={receiverPath}>{t('cards.reference.viewProfile')}</FeedCardAction>
      </FeedCardFooter>
    </FeedCard>
  )
}
