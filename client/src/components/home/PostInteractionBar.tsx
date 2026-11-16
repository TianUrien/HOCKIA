import { useCallback, useState } from 'react'
import { Heart, MessageCircle, Share2 } from 'lucide-react'
import { useAuthStore } from '@/lib/auth'
import { SharePostSheet } from './SharePostSheet'
import { useHomeT } from '@/i18n/ns/home'

interface PostInteractionBarProps {
  postId: string
  likeCount: number
  commentCount: number
  hasLiked: boolean
  onToggleLike: () => Promise<void>
  onToggleComments: () => void
  showComments: boolean
  authorId: string
  authorName: string | null
  authorAvatar: string | null
  authorRole: 'player' | 'coach' | 'club' | 'brand' | 'umpire'
  content: string
  thumbnailUrl: string | null
  /** Questions read "N answers" and carry an Answer pill (Figma post/question). */
  variant?: 'post' | 'question'
  onAnswer?: () => void
}

/**
 * Like · Comment · Share as icon + count, left-aligned (Figma post card
 * "actions": 22px icons, 14px counts, 20px gaps). A zero count is simply
 * not printed. Every control is a ≥44px target with an accessible name.
 */
export function PostInteractionBar({
  postId,
  likeCount,
  commentCount,
  hasLiked,
  onToggleLike,
  onToggleComments,
  showComments,
  authorId,
  authorName,
  authorAvatar,
  authorRole,
  content,
  thumbnailUrl,
  variant = 'post',
  onAnswer,
}: PostInteractionBarProps) {
  const t = useHomeT()
  const { user } = useAuthStore()
  const [isLiking, setIsLiking] = useState(false)
  const [showShareSheet, setShowShareSheet] = useState(false)
  const isQuestion = variant === 'question'

  const handleLike = useCallback(async () => {
    if (!user || isLiking) return
    setIsLiking(true)
    try {
      await onToggleLike()
    } finally {
      setIsLiking(false)
    }
  }, [user, isLiking, onToggleLike])

  const btn = 'inline-flex min-h-[44px] items-center gap-1.5 rounded-full px-2 -ml-2 text-[14px] tabular-nums transition-colors'
  const answersLabel = t('interactions.answerCount', { count: commentCount })

  return (
    <div>
      <div className="flex items-center gap-5 px-5 pb-2 pt-0.5">
        <button
          type="button"
          onClick={handleLike}
          disabled={!user || isLiking}
          aria-pressed={hasLiked}
          aria-label={likeCount ? (hasLiked ? t('interactions.unlikeWithCount', { count: likeCount }) : t('interactions.likeWithCount', { count: likeCount })) : (hasLiked ? t('interactions.unlike') : t('interactions.like'))}
          className={`${btn} ${hasLiked ? 'text-hockia-primary' : 'text-ink-2 hover:text-ink-1'} disabled:opacity-50`}
        >
          <Heart className={`h-[22px] w-[22px] ${hasLiked ? 'fill-hockia-primary' : ''}`} strokeWidth={1.7} />
          {likeCount > 0 && <span>{likeCount}</span>}
        </button>

        <button
          type="button"
          onClick={onToggleComments}
          aria-expanded={showComments}
          aria-label={isQuestion ? t('interactions.answersAria', { total: commentCount }) : commentCount ? t('interactions.commentsAriaWithTotal', { total: commentCount }) : t('interactions.commentsAria')}
          className={`${btn} ${showComments ? 'text-hockia-primary' : 'text-ink-2 hover:text-ink-1'}`}
        >
          <MessageCircle className="h-[22px] w-[22px]" strokeWidth={1.7} />
          {isQuestion ? <span>{answersLabel}</span> : commentCount > 0 && <span>{commentCount}</span>}
        </button>

        <button
          type="button"
          onClick={() => setShowShareSheet(true)}
          aria-label={t('interactions.share')}
          className={`${btn} text-ink-2 hover:text-ink-1`}
        >
          <Share2 className="h-[22px] w-[22px]" strokeWidth={1.7} />
        </button>

        {isQuestion && (
          <button
            type="button"
            onClick={onAnswer ?? onToggleComments}
            className="ml-auto flex h-[30px] items-center rounded-full bg-hockia-soft px-3.5 text-[14px] font-semibold text-hockia-primary transition-colors active:bg-[#e4d9fb]"
          >
            {t('interactions.answer')}
          </button>
        )}
      </div>

      <SharePostSheet
        isOpen={showShareSheet}
        onClose={() => setShowShareSheet(false)}
        postId={postId}
        authorId={authorId}
        authorName={authorName}
        authorAvatar={authorAvatar}
        authorRole={authorRole}
        content={content}
        thumbnailUrl={thumbnailUrl}
      />
    </div>
  )
}
