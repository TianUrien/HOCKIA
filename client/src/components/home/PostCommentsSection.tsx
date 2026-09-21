import { useState, useEffect, useCallback, useRef } from 'react'
import { Flag, Loader2, Send, Trash2 } from 'lucide-react'
import { useAuthStore } from '@/lib/auth'
import { usePostInteractions } from '@/hooks/usePostInteractions'
import { Avatar } from '@/components'
import ReportUserModal from '@/components/ReportUserModal'
import { getTimeAgo } from '@/lib/utils'
import { checkContent } from '@/lib/contentFilter'
import { identityLine } from '@/lib/identity'
import type { PostComment } from '@/types/homeFeed'

interface PostCommentsSectionProps {
  postId: string
  commentCount: number
  onCommentCountChange: (newCount: number) => void
  /** Questions call their comments "answers" (Home v2 DEV NOTE). */
  variant?: 'comments' | 'answers'
  /** Focus the composer on mount (Post detail, "Answer" button). */
  autoFocus?: boolean
}

const INITIAL_LIMIT = 3

/**
 * Comments under a post (Figma Post detail): "N comments" header, one row
 * per comment — 32px avatar, name · role · time, the text — and a pinned
 * composer: avatar, grey pill input, purple send.
 */
export function PostCommentsSection({
  postId,
  commentCount,
  onCommentCountChange,
  variant = 'comments',
  autoFocus = true,
}: PostCommentsSectionProps) {
  const { user, profile } = useAuthStore()
  const { fetchComments, createComment, deleteComment } = usePostInteractions()

  const [comments, setComments] = useState<PostComment[]>([])
  const [total, setTotal] = useState(commentCount)
  const [isLoading, setIsLoading] = useState(true)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [showAll, setShowAll] = useState(false)
  const [newComment, setNewComment] = useState('')
  const [reportingComment, setReportingComment] = useState<{ id: string; authorId: string; authorName: string } | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  // Mirrors `total` for synchronous reads inside add/delete handlers.
  const totalRef = useRef(commentCount)
  useEffect(() => { totalRef.current = total }, [total])

  const noun = variant === 'answers' ? 'answer' : 'comment'
  const plural = (n: number) => `${n} ${noun}${n === 1 ? '' : 's'}`

  useEffect(() => {
    let cancelled = false
    async function load() {
      setIsLoading(true)
      const result = await fetchComments(postId, INITIAL_LIMIT, 0)
      if (!cancelled) {
        setComments(result.comments)
        setTotal(result.total)
        setIsLoading(false)
      }
    }
    load()
    return () => { cancelled = true }
  }, [postId, fetchComments])

  useEffect(() => {
    if (!autoFocus) return
    const id = setTimeout(() => inputRef.current?.focus(), 100)
    return () => clearTimeout(id)
  }, [autoFocus])

  const handleLoadAll = useCallback(async () => {
    setIsLoading(true)
    const result = await fetchComments(postId, 100, 0)
    setComments(result.comments)
    setTotal(result.total)
    setShowAll(true)
    setIsLoading(false)
  }, [postId, fetchComments])

  const handleSubmit = useCallback(async () => {
    const trimmed = newComment.trim()
    if (!trimmed || !user || isSubmitting) return

    const filterResult = checkContent(trimmed)
    if (!filterResult.allowed) {
      alert(filterResult.reason || 'Content violates community guidelines.')
      return
    }

    setIsSubmitting(true)
    const result = await createComment(postId, trimmed)

    if (result.success && result.comment_id && profile) {
      const newCommentObj: PostComment = {
        id: result.comment_id,
        post_id: postId,
        author_id: profile.id,
        author_name: profile.full_name,
        author_avatar: profile.avatar_url,
        author_role: profile.role,
        content: trimmed,
        created_at: new Date().toISOString(),
      }
      setComments(prev => [...prev, newCommentObj])
      const nextTotal = totalRef.current + 1
      totalRef.current = nextTotal
      setTotal(nextTotal)
      onCommentCountChange(nextTotal)
      setNewComment('')
    }

    setIsSubmitting(false)
  }, [newComment, user, isSubmitting, postId, profile, createComment, onCommentCountChange])

  const handleDelete = useCallback(async (commentId: string) => {
    const result = await deleteComment(commentId)
    if (result.success) {
      setComments(prev => prev.filter(c => c.id !== commentId))
      const nextTotal = Math.max(0, totalRef.current - 1)
      totalRef.current = nextTotal
      setTotal(nextTotal)
      onCommentCountChange(nextTotal)
    }
  }, [deleteComment, onCommentCountChange])

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSubmit()
    }
  }, [handleSubmit])

  return (
    <div className="border-t border-line">
      {total > 0 && (
        <p className="px-5 pb-1 pt-3 text-row font-semibold text-ink-1">{plural(total)}</p>
      )}

      {isLoading && comments.length === 0 && (
        <div className="flex justify-center py-3">
          <Loader2 className="h-4 w-4 animate-spin text-ink-3" />
        </div>
      )}

      <ul>
        {comments.map(comment => (
          <li key={comment.id} className="flex gap-2.5 px-5 py-2">
            <Avatar
              src={comment.author_avatar}
              initials={comment.author_name?.slice(0, 2) || '?'}
              size="sm"
              className="mt-0.5 flex-shrink-0"
              role={comment.author_role}
            />
            <div className="min-w-0 flex-1">
              <p className="text-secondary text-ink-2">
                <span className="text-row font-semibold text-ink-1">{comment.author_name || 'Member'}</span>
                {' '}{identityLine(comment.author_role)}
                {' · '}{getTimeAgo(comment.created_at, true)}
              </p>
              <p className="whitespace-pre-wrap text-row text-ink-1">{comment.content}</p>
              {user && comment.author_id === user.id ? (
                <button
                  type="button"
                  onClick={() => handleDelete(comment.id)}
                  className="mt-0.5 flex items-center gap-1 text-caption text-ink-3 transition-colors hover:text-red-600"
                >
                  <Trash2 className="h-3 w-3" />
                  Delete
                </button>
              ) : user ? (
                <button
                  type="button"
                  onClick={() => setReportingComment({
                    id: comment.id,
                    authorId: comment.author_id,
                    authorName: comment.author_name || 'Member',
                  })}
                  className="mt-0.5 flex items-center gap-1 text-caption text-ink-3 transition-colors hover:text-red-600"
                >
                  <Flag className="h-3 w-3" />
                  Report
                </button>
              ) : null}
            </div>
          </li>
        ))}
      </ul>

      {!showAll && total > INITIAL_LIMIT && comments.length < total && (
        <button
          type="button"
          onClick={handleLoadAll}
          disabled={isLoading}
          className="px-5 py-2 text-secondary font-semibold text-ink-2"
        >
          {isLoading ? 'Loading…' : `View all ${plural(total)}`}
        </button>
      )}

      {user && (
        <div className="flex items-center gap-2 px-4 py-2.5">
          <Avatar
            src={profile?.avatar_url}
            initials={profile?.full_name?.slice(0, 2) || '?'}
            size="sm"
            className="flex-shrink-0"
            role={profile?.role}
          />
          <input
            ref={inputRef}
            type="text"
            value={newComment}
            onChange={e => setNewComment(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={variant === 'answers' ? 'Write an answer' : 'Add a comment'}
            maxLength={500}
            enterKeyHint="send"
            autoCapitalize="sentences"
            className="h-10 min-w-0 flex-1 rounded-full bg-surface-grouped px-3.5 text-row text-ink-1 placeholder:text-ink-4 focus:outline-none focus:ring-2 focus:ring-hockia-primary/40"
          />
          <button
            type="button"
            onClick={handleSubmit}
            disabled={!newComment.trim() || isSubmitting}
            className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-full bg-hockia-primary text-white transition-opacity disabled:opacity-40"
            aria-label={variant === 'answers' ? 'Post answer' : 'Post comment'}
          >
            {isSubmitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-[18px] w-[18px]" strokeWidth={1.75} />}
          </button>
        </div>
      )}

      {reportingComment && (
        <ReportUserModal
          targetId={reportingComment.authorId}
          targetName={reportingComment.authorName}
          contentType="comment"
          contentId={reportingComment.id}
          onClose={() => setReportingComment(null)}
        />
      )}
    </div>
  )
}
