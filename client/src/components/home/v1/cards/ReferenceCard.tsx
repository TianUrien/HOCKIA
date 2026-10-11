import { Link } from 'react-router-dom'
import { Star } from 'lucide-react'
import { Avatar } from '@/components'
import { profilePathForRole } from '@/lib/feedPaths'
import { initialsOf } from '@/lib/communityCard'
import { compactCount } from '@/lib/homeEngagement'
import { FeedCardMenu } from '../FeedCardMenu'
import { SquircleBox } from '../primitives'
import { CommentButton, CongratsPill } from '../PostParts'
import { useHomeV1 } from '../homeV1Context'
import type { ReferenceReceivedFeedItem } from '@/types/homeFeed'

function firstName(name: string | null | undefined): string {
  return (name ?? '').trim().split(/\s+/)[0] || 'them'
}

function relationship(type: string | null | undefined): string | null {
  if (!type) return null
  const t = type.replace(/_/g, ' ').trim()
  return t ? t.charAt(0).toUpperCase() + t.slice(1) : null
}

function FaceLink({ path, label, url, className }: { path: string | null; label: string | null; url: string | null; className: string }) {
  const face = <Avatar src={url} initials={initialsOf(label)} size="sm" className="!h-9 !w-9 ring-2 ring-gold-soft" />
  const cls = `absolute top-0 ${className}`
  return path ? <Link to={path} aria-label={`${label ?? 'Member'} — view profile`} className={cls}>{face}</Link> : <span className={cls}>{face}</span>
}

/**
 * Reference (Figma 60:364) — trust gold: the quote at 20 semibold, giver →
 * receiver avatars, a star; under it "👏 Congrats <name>" + "N congrats" and
 * comments (v1: Congrats + comments on New signing and Reference only).
 */
export function ReferenceCard({ item }: { item: ReferenceReceivedFeedItem }) {
  const { patchItem, openComments } = useHomeV1()
  const ownerId = item.author_profile_id ?? item.profile_id
  const quote = item.endorsement_text?.trim()
  const congrats = item.congrats_count ?? 0
  const comments = item.comment_count ?? 0
  const giverPath = item.referee_role ? profilePathForRole(item.referee_role as never, item.referee_id) : null
  const receiverPath = profilePathForRole(item.role, item.profile_id)

  return (
    <article className="flex flex-col gap-2.5 px-4 pb-[18px] pt-4" data-testid="home-reference-card">
      <SquircleBox className="flex flex-col gap-3.5 bg-gold-soft px-5 pb-[18px] pt-5 shadow-[inset_0_0_0_0.5px_rgba(15,15,20,0.06)]">
        {quote && <p className="text-[20px] font-semibold leading-6 tracking-[-0.08px] text-ink-1">“{quote}”</p>}
        <div className="flex items-center gap-2.5">
          <span className="relative h-9 w-[60px] shrink-0">
            <FaceLink path={giverPath} label={item.referee_name} url={item.referee_avatar} className="left-0" />
            <FaceLink path={receiverPath} label={item.full_name} url={item.avatar_url} className="left-6" />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block truncate text-[14px] font-semibold leading-[19px] text-ink-1">
              {firstName(item.referee_name)} → {firstName(item.full_name)}
            </span>
            <span className="block truncate text-caption text-ink-2">
              {['Reference', relationship(item.relationship_type)].filter(Boolean).join(' · ')}
            </span>
          </span>
          <Star className="h-[22px] w-[22px] shrink-0 fill-gold-line text-gold-line" strokeWidth={1.5} aria-hidden="true" />
        </div>
      </SquircleBox>

      <div className="flex items-center gap-2.5">
        <CongratsPill
          tone="gold"
          label={`Congrats ${firstName(item.full_name)}`}
          target={{ type: 'feed_item', id: item.feed_item_id }}
          has={Boolean(item.has_congrats)}
          count={congrats}
          onChange={(has, count) => patchItem(item.feed_item_id, { has_congrats: has, congrats_count: count })}
        />
        {congrats > 0 && <span className="text-secondary tabular-nums text-ink-3">{compactCount(congrats)} congrats</span>}
        <span className="flex-1" />
        <CommentButton
          count={comments}
          onOpen={() => openComments({ target: { type: 'feed_item', id: item.feed_item_id }, feedItemId: item.feed_item_id, ownerId, count: comments, enabled: item.comments_enabled !== false })}
        />
        <FeedCardMenu
          authorId={item.profile_id}
          authorName={item.full_name}
          sharePath={receiverPath ?? '/home'}
          report={{ subject: 'feed_item', contentId: item.feed_item_id }}
        />
      </div>
    </article>
  )
}
