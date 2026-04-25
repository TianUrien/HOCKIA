import { useCallback, useEffect, useMemo, useState } from 'react'
import { formatDistanceToNow } from 'date-fns'
import { Flag, MessageSquare, MessageSquarePlus, ShieldAlert, UserCheck, Share2 } from 'lucide-react'
import * as Sentry from '@sentry/react'
import { supabase } from '@/lib/supabase'
import { logger } from '@/lib/logger'
import type { Database } from '@/lib/database.types'
import type { Profile } from '@/lib/supabase'
import { useAuthStore } from '@/lib/auth'
import { useToastStore } from '@/lib/toast'
import Avatar from './Avatar'
import RoleBadge from './RoleBadge'
import { cn } from '@/lib/utils'
import ConfirmActionModal from './ConfirmActionModal'
import { reportSupabaseError } from '@/lib/sentryHelpers'
import { checkContent } from '@/lib/contentFilter'
import InfoTooltip from './InfoTooltip'
import ReportUserModal from './ReportUserModal'
import RequestFeedbackModal from './RequestFeedbackModal'

interface CommentsTabProps {
  profileId: string
  highlightedCommentIds?: Set<string>
  /** Profile role being viewed — drives tone of composer placeholder
   * and empty-state copy. Optional; defaults to generic wording. */
  profileRole?: Profile['role'] | null
}

/** Role-aware composer placeholder — keeps tone appropriate to the
 * profile being commented on. */
function composerPlaceholderFor(role: Profile['role'] | null | undefined): string {
  if (role === 'umpire') {
    return "Share a note about this umpire's officiating — fair decisions, professionalism, knowledge of the laws..."
  }
  if (role === 'coach') {
    return "Tell clubs and players why this coach stands out..."
  }
  if (role === 'club') {
    return 'Share your experience with this club — culture, facilities, professionalism...'
  }
  return 'Tell clubs, coaches, and players why this profile stands out...'
}

/** Role-aware empty-state body copy. */
function emptyStateCopyFor(role: Profile['role'] | null | undefined): string {
  if (role === 'umpire') {
    return 'Be the first to share a note about this umpire.'
  }
  return 'Be the first to share constructive feedback for this profile.'
}

type CommentRating = Database['public']['Enums']['comment_rating']
type CommentRow = Database['public']['Tables']['profile_comments']['Row']

type CommentWithAuthor = CommentRow & {
  author: Pick<Profile, 'id' | 'full_name' | 'avatar_url' | 'role' | 'username'> | null
}

const MAX_LENGTH = 1000
const MIN_LENGTH = 10

const ratingOptions: { value: CommentRating; label: string; description: string; badgeClass: string }[] = [
  { value: 'positive', label: 'Positive', description: 'Highlight a standout quality or experience.', badgeClass: 'bg-green-100 text-green-700 border-green-200' },
  { value: 'neutral', label: 'Neutral', description: 'Share balanced, factual feedback.', badgeClass: 'bg-gray-100 text-gray-700 border-gray-200' },
  { value: 'negative', label: 'Needs Work', description: 'Flag concerns respectfully for moderators.', badgeClass: 'bg-red-100 text-red-700 border-red-200' },
]

const COMMENTS_HEADER_INFO = (
  <div className="space-y-2 text-sm text-gray-100">
    <p className="font-semibold text-white">About comments</p>
    <ul className="list-disc space-y-1 pl-4 text-gray-200">
      <li>Visible to everyone who views this profile.</li>
      <li>Use clear, professional language and concrete observations.</li>
      <li>Your rating helps clubs and coaches scan at a glance.</li>
    </ul>
  </div>
)

const COMMENT_COMPOSER_INFO = (
  <div className="space-y-2 text-sm text-gray-100">
    <p className="font-semibold text-white">Posting tips</p>
    <ul className="list-disc space-y-1 pl-4 text-gray-200">
      <li>Stay constructive—your profile name is shown with every comment.</li>
      <li>Reference specific games, training moments, or character traits.</li>
      <li>Respect the minimum length and select a sentiment before submitting.</li>
    </ul>
  </div>
)

export default function CommentsTab({ profileId, highlightedCommentIds, profileRole }: CommentsTabProps) {
  const { profile: authProfile, user } = useAuthStore()
  const { addToast } = useToastStore()

  const [comments, setComments] = useState<CommentWithAuthor[]>([])
  const [loading, setLoading] = useState(true)
  const [creating, setCreating] = useState(false)
  const [composerContent, setComposerContent] = useState('')
  const [composerRating, setComposerRating] = useState<CommentRating | ''>('')
  const [isEditing, setIsEditing] = useState(false)
  const [editContent, setEditContent] = useState('')
  const [editRating, setEditRating] = useState<CommentRating | ''>('')
  const [editing, setEditing] = useState(false)
  const [deleteModalOpen, setDeleteModalOpen] = useState(false)
  const [deleteLoading, setDeleteLoading] = useState(false)
  const [friendIds, setFriendIds] = useState<Set<string>>(new Set())
  const [reportingComment, setReportingComment] = useState<{ id: string; authorId: string; authorName: string } | null>(null)
  const [showRequestFeedback, setShowRequestFeedback] = useState(false)

  const isOwner = authProfile?.id === profileId

  // Compute the owner's public profile URL for the "Ask for feedback" share link.
  const ownerProfileUrl = useMemo(() => {
    if (!isOwner || !authProfile) return ''
    const origin = typeof window !== 'undefined' ? window.location.origin : ''
    const slug = authProfile.username || `id/${authProfile.id}`
    const basePath =
      authProfile.role === 'club'
        ? '/clubs'
        : authProfile.role === 'umpire'
          ? '/umpires'
          : '/players'
    return `${origin}${basePath}/${slug}`
  }, [isOwner, authProfile])

  const canComment = Boolean(user && authProfile && authProfile.id !== profileId)

  const fetchComments = useCallback(async () => {
    setLoading(true)

    Sentry.addBreadcrumb({
      category: 'supabase',
      message: 'comments.fetch_visible',
      data: { profileId },
      level: 'info'
    })
    const { data, error } = await supabase
      .from('profile_comments')
      .select(`
        id,
        profile_id,
        author_profile_id,
        content,
        rating,
        status,
        created_at,
        updated_at,
        author:profiles!profile_comments_author_profile_id_fkey (
          id,
          full_name,
          avatar_url,
          role,
          username
        )
      `)
      .eq('profile_id', profileId)
      .eq('status', 'visible')
      .order('created_at', { ascending: false })

    if (error) {
      logger.error('Error loading comments', error)
      reportSupabaseError('comments.fetch_visible', error, { profileId }, {
        feature: 'comments',
        operation: 'fetch_comments'
      })
      addToast('Failed to load comments. Please try again.', 'error')
    } else {
      setComments((data as CommentWithAuthor[]) ?? [])
    }

    setLoading(false)
  }, [addToast, profileId])

  const fetchFriendIds = useCallback(async () => {
    Sentry.addBreadcrumb({
      category: 'supabase',
      message: 'comments.fetch_friend_edges',
      data: { profileId },
      level: 'info'
    })
    const { data, error } = await supabase
      .from('profile_friend_edges')
      .select('friend_id')
      .eq('profile_id', profileId)
      .eq('status', 'accepted')

    if (error) {
      logger.error('Error loading friend relationships', error)
      reportSupabaseError('comments.fetch_friend_edges', error, { profileId }, {
        feature: 'friends',
        operation: 'fetch_friend_edges'
      })
      return
    }

    const ids = new Set((data ?? []).map((row) => row.friend_id).filter((id): id is string => Boolean(id)))
    setFriendIds(ids)
  }, [profileId])

  useEffect(() => {
    void fetchComments()
  }, [fetchComments])

  useEffect(() => {
    void fetchFriendIds()
  }, [fetchFriendIds])

  const existingComment = useMemo(() => {
    if (!authProfile) return null
    return comments.find((comment) => comment.author_profile_id === authProfile.id) ?? null
  }, [comments, authProfile])

  useEffect(() => {
    if (!existingComment) {
      setEditContent('')
      setEditRating('')
      setIsEditing(false)
      return
    }

    setEditContent(existingComment.content)
    setEditRating(existingComment.rating ?? '')
  }, [existingComment])

  const upsertComment = useCallback((next: CommentWithAuthor) => {
    setComments((prev) => {
      const others = prev.filter((comment) => comment.id !== next.id)
      return [next, ...others]
    })
  }, [])

  const handleCreateComment = async (event: React.FormEvent) => {
    event.preventDefault()
    if (!canComment || !authProfile) {
      addToast('You need to sign in with a profile to leave a comment.', 'error')
      return
    }

    const trimmed = composerContent.trim()
    if (trimmed.length < MIN_LENGTH) {
      addToast(`Comments must be at least ${MIN_LENGTH} characters.`, 'error')
      return
    }

    if (!composerRating) {
      addToast('Select a sentiment to post your comment.', 'error')
      return
    }

    const filterResult = checkContent(trimmed)
    if (!filterResult.allowed) {
      addToast(filterResult.reason || 'Content violates community guidelines.', 'error')
      return
    }

    setCreating(true)
    try {
      Sentry.addBreadcrumb({
        category: 'supabase',
        message: 'comments.insert',
        data: { profileId, authorId: authProfile.id },
        level: 'info'
      })
      const { data, error } = await supabase
        .from('profile_comments')
        .insert({
          profile_id: profileId,
          author_profile_id: authProfile.id,
          content: trimmed,
          rating: composerRating,
          status: 'visible' as CommentRow['status'],
        })
        .select(`
          *,
          author:profiles!profile_comments_author_profile_id_fkey (
            id,
            full_name,
            avatar_url,
            role,
            username
          )
        `)
        .single()

      if (error) throw error
      upsertComment(data as CommentWithAuthor)
      setComposerContent('')
      setComposerRating('')
      addToast('Thanks for sharing feedback!', 'success')
    } catch (error) {
      logger.error('Failed to post comment', error)
      reportSupabaseError('comments.insert', error, { profileId, authorId: authProfile?.id }, {
        feature: 'comments',
        operation: 'create_comment'
      })
      addToast('Unable to post your comment. Please try again.', 'error')
    } finally {
      setCreating(false)
    }
  }

  const handleEditComment = async (event: React.FormEvent) => {
    event.preventDefault()
    if (!existingComment) return

    const trimmed = editContent.trim()
    if (trimmed.length < MIN_LENGTH) {
      addToast(`Comments must be at least ${MIN_LENGTH} characters.`, 'error')
      return
    }

    if (!editRating) {
      addToast('Select a sentiment before saving changes.', 'error')
      return
    }

    setEditing(true)
    try {
      Sentry.addBreadcrumb({
        category: 'supabase',
        message: 'comments.update',
        data: { commentId: existingComment.id },
        level: 'info'
      })
      const { data, error } = await supabase
        .from('profile_comments')
        .update({ content: trimmed, rating: editRating, status: 'visible' as CommentRow['status'] })
        .eq('id', existingComment.id)
        .select(`
          *,
          author:profiles!profile_comments_author_profile_id_fkey (
            id,
            full_name,
            avatar_url,
            role,
            username
          )
        `)
        .single()

      if (error) throw error
      upsertComment(data as CommentWithAuthor)
      setIsEditing(false)
      addToast('Your comment was updated.', 'success')
    } catch (error) {
      logger.error('Failed to update comment', error)
      reportSupabaseError('comments.update', error, { commentId: existingComment?.id }, {
        feature: 'comments',
        operation: 'update_comment'
      })
      addToast('Unable to save your changes. Please try again.', 'error')
    } finally {
      setEditing(false)
    }
  }

  const handleDeleteComment = async () => {
    if (!existingComment) return
    setDeleteLoading(true)

    try {
      Sentry.addBreadcrumb({
        category: 'supabase',
        message: 'comments.delete',
        data: { commentId: existingComment.id },
        level: 'warning'
      })
      const { error, data } = await supabase
        .from('profile_comments')
        .delete()
        .eq('id', existingComment.id)
        .select('id')
        .maybeSingle()

      if (error || !data) {
        throw error ?? new Error('Comment not found or already removed')
      }

      setComments((prev) => prev.filter((comment) => comment.id !== data.id))
      setDeleteModalOpen(false)
      addToast('Comment deleted.', 'success')
    } catch (error) {
      logger.error('Failed to delete comment', error)
      reportSupabaseError('comments.delete', error, { commentId: existingComment?.id }, {
        feature: 'comments',
        operation: 'delete_comment'
      })
      addToast('Unable to delete your comment. Please try again.', 'error')
    } finally {
      setDeleteLoading(false)
    }
  }

  const otherComments = useMemo(() => {
    if (!existingComment) return comments
    return comments.filter((comment) => comment.id !== existingComment.id)
  }, [comments, existingComment])

  const getInitials = (name?: string | null) => {
    if (!name) return '?'
    return name
      .trim()
      .split(' ')
      .filter(Boolean)
      .map((part) => part[0]?.toUpperCase())
      .slice(0, 2)
      .join('') || '?'
  }

  const renderRatingBadge = (value?: CommentRating | null) => {
    if (!value) return null
    const option = ratingOptions.find((entry) => entry.value === value)
    if (!option) return null
    return (
      <span className={cn('inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-semibold capitalize', option.badgeClass)}>
        {option.label}
      </span>
    )
  }

  return (
    <div className="space-y-8">
      <section className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <h2 className="text-2xl font-bold text-gray-900">Comments</h2>
              <InfoTooltip label="How comments work" alignment="start">
                {COMMENTS_HEADER_INFO}
              </InfoTooltip>
            </div>
            <p className="text-sm text-gray-600">Verified testimonials from HOCKIA members.</p>
          </div>
          <div className="inline-flex items-center gap-2 rounded-full bg-gray-100 px-3 py-1 text-sm font-medium text-gray-700">
            <MessageSquare className="h-4 w-4 text-[#8026FA]" />
            {comments.length} {comments.length === 1 ? 'comment' : 'comments'}
          </div>
        </div>
      </section>

      {canComment ? (
        !existingComment && (
          <section className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm">
            <div className="flex items-center gap-3 mb-4">
              <div className="bg-[#f5f3ff] text-[#8026FA] rounded-full p-2">
                <MessageSquarePlus className="h-4 w-4" />
              </div>
              <div>
                <div className="flex items-center gap-2 text-sm font-semibold text-gray-900">
                  <span>Share your experience</span>
                  <InfoTooltip label="Commenting tips" alignment="start">
                    {COMMENT_COMPOSER_INFO}
                  </InfoTooltip>
                </div>
                <p className="text-xs text-gray-500">Give thoughtful, professional feedback.</p>
              </div>
            </div>

            <form className="space-y-4" onSubmit={handleCreateComment}>
              <div>
                <label htmlFor="comment-content" className="sr-only">
                  Comment
                </label>
                <textarea
                  id="comment-content"
                  value={composerContent}
                  onChange={(event) => setComposerContent(event.target.value.slice(0, MAX_LENGTH))}
                  rows={4}
                  placeholder={composerPlaceholderFor(profileRole)}
                  autoCapitalize="sentences"
                  spellCheck
                  className="w-full rounded-xl border border-gray-200 bg-gray-50 px-4 py-3 text-sm text-gray-900 focus:border-[#8026FA] focus:ring-[#8026FA]"
                />
                <div className="mt-1 flex justify-between text-xs text-gray-500">
                  <span>Min {MIN_LENGTH} characters</span>
                  <span>
                    {composerContent.trim().length}/{MAX_LENGTH}
                  </span>
                </div>
              </div>

              <div className="grid gap-3 sm:grid-cols-3">
                {ratingOptions.map((option) => (
                  <label
                    key={option.value}
                    className={cn(
                      'cursor-pointer rounded-xl border px-4 py-3 text-sm shadow-sm transition hover:border-[#8026FA] hover:shadow-md',
                      composerRating === option.value ? 'border-[#8026FA] bg-[#f5f3ff] text-[#8026FA]' : 'border-gray-200 bg-white text-gray-700'
                    )}
                  >
                    <input
                      type="radio"
                      name="comment-rating"
                      value={option.value}
                      className="sr-only"
                      checked={composerRating === option.value}
                      onChange={() => setComposerRating(option.value)}
                    />
                    <p className="font-semibold">{option.label}</p>
                    <p className="text-xs text-gray-500 mt-0.5">{option.description}</p>
                  </label>
                ))}
              </div>

              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <p className="text-xs text-gray-500">
                  Comments follow community guidelines. Moderators may hide content that violates the code of conduct.
                </p>
                <button
                  type="submit"
                  disabled={creating}
                  className="inline-flex items-center justify-center gap-2 rounded-lg bg-gradient-to-r from-[#8026FA] to-[#924CEC] px-5 py-2 text-sm font-semibold text-white shadow-lg shadow-purple-500/25 transition disabled:opacity-60"
                >
                  {creating ? 'Posting...' : 'Post Comment'}
                </button>
              </div>
            </form>
          </section>
        )
      ) : (
        <section className="rounded-2xl border border-dashed border-gray-200 bg-gray-50 p-5 text-sm text-gray-600">
          {isOwner ? (
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
              <div className="flex items-start gap-3">
                <ShieldAlert className="h-5 w-5 text-gray-400 flex-shrink-0 mt-0.5" />
                <p>
                  You can&apos;t leave a comment on your own profile, but other members can — ask a teammate or coach to share one.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setShowRequestFeedback(true)}
                className="inline-flex items-center justify-center gap-2 rounded-full bg-gradient-to-r from-[#8026FA] to-[#924CEC] text-white px-4 py-2 text-sm font-semibold shadow-sm hover:opacity-90 transition-opacity whitespace-nowrap flex-shrink-0"
              >
                <Share2 className="h-4 w-4" />
                Ask for feedback
              </button>
            </div>
          ) : (
            <div className="flex items-center gap-3">
              <ShieldAlert className="h-5 w-5 text-gray-400" />
              <p>
                Sign in with a HOCKIA profile to leave a public, attributed comment.
              </p>
            </div>
          )}
        </section>
      )}

      {isOwner && (
        <RequestFeedbackModal
          isOpen={showRequestFeedback}
          onClose={() => setShowRequestFeedback(false)}
          profileUrl={ownerProfileUrl}
          ownerName={authProfile?.full_name}
        />
      )}

      <section className="space-y-4">
        {existingComment && (
          <div className="space-y-3">
            <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">Your Comment</p>
            <article
              className={cn(
                'rounded-2xl border border-gray-100 bg-white p-5 shadow-sm',
                highlightedCommentIds?.has(existingComment.id) && 'border-amber-200 shadow-lg shadow-amber-100 ring-2 ring-amber-200'
              )}
            >
              <div className="flex items-start gap-3">
                <Avatar
                  src={existingComment.author?.avatar_url}
                  initials={getInitials(existingComment.author?.full_name ?? existingComment.author?.username ?? null)}
                  size="md"
                  alt={existingComment.author?.full_name || existingComment.author?.username || 'HOCKIA member'}
                  enablePreview
                  previewTitle={existingComment.author?.full_name || existingComment.author?.username || undefined}
                />
                <div className="flex-1 space-y-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div>
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="font-semibold text-gray-900">
                          {existingComment.author?.full_name || existingComment.author?.username || 'HOCKIA member'}
                        </p>
                        <RoleBadge role={existingComment.author?.role} />
                      </div>
                    </div>
                    <div className="flex flex-wrap items-center gap-2 text-xs text-gray-500">
                      <span>{formatDistanceToNow(new Date(existingComment.created_at), { addSuffix: true })}</span>
                      {renderRatingBadge(existingComment.rating)}
                    </div>
                  </div>

                  {isEditing ? (
                    <form className="space-y-4" onSubmit={handleEditComment}>
                      <textarea
                        aria-label="Edit comment"
                        value={editContent}
                        onChange={(event) => setEditContent(event.target.value.slice(0, MAX_LENGTH))}
                        rows={4}
                        autoCapitalize="sentences"
                        spellCheck
                        className="w-full rounded-xl border border-gray-200 bg-gray-50 px-4 py-3 text-sm text-gray-900 focus:border-[#8026FA] focus:ring-[#8026FA]"
                      />
                      <div className="flex justify-between text-xs text-gray-500">
                        <span>Min {MIN_LENGTH} characters</span>
                        <span>{editContent.trim().length}/{MAX_LENGTH}</span>
                      </div>

                      <div className="grid gap-3 sm:grid-cols-3">
                        {ratingOptions.map((option) => (
                          <label
                            key={option.value}
                            className={cn(
                              'cursor-pointer rounded-xl border px-4 py-3 text-sm shadow-sm transition hover:border-[#8026FA] hover:shadow-md',
                              editRating === option.value ? 'border-[#8026FA] bg-[#f5f3ff] text-[#8026FA]' : 'border-gray-200 bg-white text-gray-700'
                            )}
                          >
                            <input
                              type="radio"
                              name="edit-comment-rating"
                              value={option.value}
                              className="sr-only"
                              checked={editRating === option.value}
                              onChange={() => setEditRating(option.value)}
                            />
                            <p className="font-semibold">{option.label}</p>
                            <p className="text-xs text-gray-500 mt-0.5">{option.description}</p>
                          </label>
                        ))}
                      </div>

                      <div className="flex flex-wrap items-center gap-3">
                        <button
                          type="button"
                          onClick={() => setIsEditing(false)}
                          className="inline-flex items-center justify-center rounded-lg border border-gray-200 px-4 py-2 text-sm font-semibold text-gray-700 hover:bg-gray-50"
                        >
                          Cancel
                        </button>
                        <button
                          type="submit"
                          disabled={editing}
                          className="inline-flex items-center justify-center rounded-lg bg-gradient-to-r from-[#8026FA] to-[#924CEC] px-4 py-2 text-sm font-semibold text-white shadow disabled:opacity-60"
                        >
                          {editing ? 'Saving…' : 'Save changes'}
                        </button>
                      </div>
                    </form>
                  ) : (
                    <>
                      <p className="text-sm leading-relaxed text-gray-700 whitespace-pre-line break-words">
                        {existingComment.content}
                      </p>
                      <div className="flex flex-wrap items-center gap-3">
                        <button
                          type="button"
                          onClick={() => setIsEditing(true)}
                          className="inline-flex items-center rounded-lg border border-gray-200 px-3 py-1.5 text-sm font-semibold text-gray-700 hover:bg-gray-50"
                        >
                          Edit
                        </button>
                        <button
                          type="button"
                          onClick={() => setDeleteModalOpen(true)}
                          className="inline-flex items-center rounded-lg border border-red-200 px-3 py-1.5 text-sm font-semibold text-red-600 hover:bg-red-50"
                        >
                          Delete
                        </button>
                      </div>
                    </>
                  )}
                </div>
              </div>
            </article>
          </div>
        )}

        {loading ? (
          <div className="flex flex-col gap-4">
            {Array.from({ length: 3 }).map((_, index) => (
              <div
                key={index}
                className="animate-pulse rounded-2xl border border-gray-200 bg-white p-4 shadow-sm"
              >
                <div className="flex items-center gap-3">
                  <div className="h-10 w-10 rounded-full bg-gray-200" />
                  <div className="flex-1 space-y-2">
                    <div className="h-3 w-1/3 rounded bg-gray-200" />
                    <div className="h-3 w-1/4 rounded bg-gray-100" />
                  </div>
                </div>
                <div className="mt-4 space-y-2">
                  <div className="h-3 w-full rounded bg-gray-100" />
                  <div className="h-3 w-2/3 rounded bg-gray-100" />
                </div>
              </div>
            ))}
          </div>
        ) : comments.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-gray-200 bg-white p-10 text-center text-gray-500">
            <p className="text-base font-semibold text-gray-900 mb-2">No comments yet</p>
            <p className="text-sm">{emptyStateCopyFor(profileRole)}</p>
          </div>
        ) : (
          <div className="space-y-4">
            {existingComment && otherComments.length > 0 && (
              <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">Other Comments</p>
            )}
            {otherComments.map((comment) => {
              const authorId = comment.author_profile_id
              const isFriend = Boolean(authorId && friendIds.has(authorId))
              const isHighlighted = Boolean(highlightedCommentIds?.has(comment.id))

              return (
                <article
                  key={comment.id}
                  className={cn(
                    'rounded-2xl border border-gray-100 bg-white p-5 shadow-sm transition-transform',
                    isHighlighted && 'border-amber-200 shadow-lg shadow-amber-100 ring-2 ring-amber-200'
                  )}
                  data-highlighted={isHighlighted || undefined}
                >
                  <div className="flex items-start gap-3">
                    <Avatar
                      src={comment.author?.avatar_url}
                      initials={getInitials(comment.author?.full_name ?? comment.author?.username ?? null)}
                      size="md"
                      alt={comment.author?.full_name || comment.author?.username || 'Former HOCKIA member'}
                      enablePreview
                      previewTitle={comment.author?.full_name || comment.author?.username || undefined}
                    />
                    <div className="flex-1">
                      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
                        <div>
                          <div className="flex flex-wrap items-center gap-2">
                            <p className="font-semibold text-gray-900">
                              {comment.author?.full_name || comment.author?.username || 'Former HOCKIA member'}
                            </p>
                            <RoleBadge role={comment.author?.role} />
                          </div>
                        </div>
                        <div className="flex flex-wrap items-center gap-2 text-xs text-gray-500">
                          {isFriend && (
                            <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 font-semibold text-emerald-700">
                              <UserCheck className="h-3.5 w-3.5" />
                              Friend
                            </span>
                          )}
                          <span>
                            {formatDistanceToNow(new Date(comment.created_at), { addSuffix: true })}
                          </span>
                          {renderRatingBadge(comment.rating)}
                        </div>
                      </div>
                      <p className="mt-3 text-sm leading-relaxed text-gray-700 whitespace-pre-line break-words">
                        {comment.content}
                      </p>
                      {user && authorId !== user.id && (
                        <button
                          type="button"
                          onClick={() => setReportingComment({
                            id: comment.id,
                            authorId: authorId ?? '',
                            authorName: comment.author?.full_name || comment.author?.username || 'Unknown',
                          })}
                          className="mt-2 inline-flex items-center gap-1 text-xs text-gray-400 hover:text-red-500 transition-colors"
                        >
                          <Flag className="w-3 h-3" />
                          Report
                        </button>
                      )}
                    </div>
                  </div>
                </article>
              )
            })}
          </div>
        )}
      </section>

      <ConfirmActionModal
        isOpen={deleteModalOpen}
        onClose={() => setDeleteModalOpen(false)}
        onConfirm={handleDeleteComment}
        title="Delete comment?"
        description="This action cannot be undone."
        confirmLabel="Delete"
        confirmTone="danger"
        confirmLoading={deleteLoading}
        loadingLabel="Deleting..."
      />

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
