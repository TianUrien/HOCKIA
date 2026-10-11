import { useCallback, useState } from 'react'
import { Trash2 } from 'lucide-react'
import { useAuthStore } from '@/lib/auth'
import { useToastStore } from '@/lib/toast'
import { usePostInteractions } from '@/hooks/usePostInteractions'
import { useUserPosts } from '@/hooks/useUserPosts'
import { formatActivityAge } from '@/lib/inboxTime'
import { profilePathForRole } from '@/lib/feedPaths'
import { removeSigningTag, signingDetail } from '@/lib/homeEngagement'
import { MENU_ICON_CLASS } from '@/lib/report'
import ConfirmDialog from '@/components/ConfirmDialog'
import { SharePostSheet } from '@/components/home/SharePostSheet'
import { NewSigningArt } from '../NewSigningArt'
import { FeedCardMenu } from '../FeedCardMenu'
import { CommentButton, CongratsPill, LikeButton, PostHeader, ShareButton } from '../PostParts'
import { useHomeV1 } from '../homeV1Context'
import type { SigningMetadata, UserPostFeedItem } from '@/types/homeFeed'

/**
 * New signing (Figma 60:193 — UNION card, player/coach + club): an author
 * header (so ⋯ exists, H10), card E, then Like · Comment · 👏 Congrats · Share.
 * The tagged member gets "Remove my tag" in ⋯ (H16).
 */
export function SigningCard({ item }: { item: UserPostFeedItem }) {
  const meta = item.metadata as SigningMetadata
  const viewerId = useAuthStore((s) => s.user?.id ?? null)
  const addToast = useToastStore((s) => s.addToast)
  const { patchItem, removeItem, openComments } = useHomeV1()
  const { toggleLike } = usePostInteractions()
  const { deletePost } = useUserPosts()
  const [sharing, setSharing] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const clubName = meta.club_name || item.author_name || 'Club'
  const isTagged = Boolean(viewerId && meta.person_profile_id === viewerId)

  const like = useCallback(async () => {
    const prev = { has_liked: item.has_liked, like_count: item.like_count }
    patchItem(item.feed_item_id, { has_liked: !prev.has_liked, like_count: Math.max(0, prev.like_count + (prev.has_liked ? -1 : 1)) } as Partial<UserPostFeedItem>)
    const res = await toggleLike(item.post_id)
    if (!res.success) patchItem(item.feed_item_id, prev as Partial<UserPostFeedItem>)
  }, [item.feed_item_id, item.post_id, item.has_liked, item.like_count, patchItem, toggleLike])

  const untag = async () => {
    const res = await removeSigningTag(item.post_id)
    if (!res.success) { addToast(res.error ?? 'Could not remove your tag', 'error'); return }
    // The card falls back to a plain club post (H16).
    patchItem(item.feed_item_id, { metadata: { ...meta, person_name: null, person_avatar_url: null, person_profile_id: null, person_role: null } } as Partial<UserPostFeedItem>)
    addToast('Your tag was removed', 'success')
  }

  const remove = async () => {
    setConfirmDelete(false)
    const res = await deletePost(item.post_id)
    if (res.success) removeItem(item.feed_item_id)
    else addToast(res.error ?? 'Could not delete the post', 'error')
  }

  return (
    <article className="pb-[18px] pt-4" data-testid="home-signing-card">
      <PostHeader
        authorId={item.author_id}
        name={item.author_name}
        avatarUrl={item.author_avatar}
        role={item.author_role}
        subtitle={formatActivityAge(item.created_at)}
        profilePath={profilePathForRole(item.author_role, item.author_id)}
        small
        menu={
          <FeedCardMenu
            authorId={item.author_id}
            authorName={item.author_name}
            sharePath={`/post/${item.post_id}`}
            report={{ subject: 'post', contentId: item.post_id }}
            onRemoveTag={isTagged ? () => void untag() : undefined}
            onShare={() => setSharing(true)}
            ownerItems={[{ key: 'delete', label: 'Delete post', destructive: true, icon: <Trash2 className={MENU_ICON_CLASS} strokeWidth={1.8} />, onSelect: () => setConfirmDelete(true) }]}
          />
        }
      />
      <div className="px-4">
        <NewSigningArt
          personName={meta.person_name ?? ''}
          personAvatarUrl={meta.person_avatar_url}
          clubName={clubName}
          clubCrestUrl={meta.club_avatar_url ?? item.author_avatar}
          detail={signingDetail(meta)}
        />
        <div className="flex items-center gap-4 pt-1">
          <LikeButton liked={item.has_liked} count={item.like_count} onToggle={() => void like()} />
          <CommentButton
            count={item.comment_count}
            onOpen={() => openComments({ target: { type: 'post', id: item.post_id }, feedItemId: item.feed_item_id, ownerId: item.author_id, count: item.comment_count, enabled: item.comments_enabled !== false })}
          />
          <span className="flex-1" />
          <CongratsPill
            target={{ type: 'post', id: item.post_id }}
            has={Boolean(item.has_congrats)}
            count={item.congrats_count ?? 0}
            onChange={(has, count) => patchItem(item.feed_item_id, { has_congrats: has, congrats_count: count })}
          />
          <ShareButton onShare={() => setSharing(true)} />
        </div>
      </div>

      <SharePostSheet
        isOpen={sharing}
        onClose={() => setSharing(false)}
        postId={item.post_id}
        authorId={item.author_id}
        authorName={item.author_name}
        authorAvatar={item.author_avatar}
        authorRole={item.author_role}
        content={`${meta.person_name ?? ''} × ${clubName}`}
        thumbnailUrl={meta.person_avatar_url}
      />
      <ConfirmDialog
        isOpen={confirmDelete}
        onClose={() => setConfirmDelete(false)}
        onConfirm={remove}
        title="Delete this post?"
        message="It will be removed from Home and your profile."
        confirmLabel="Delete"
        variant="danger"
      />
    </article>
  )
}
