import { useEffect, useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { ArrowLeft, Loader2 } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { logger } from '@/lib/logger'
import { useAuthStore } from '@/lib/auth'
import { Header, Layout } from '@/components'
import { UserPostCard } from '@/components/home/cards/UserPostCard'
import type { UserPostFeedItem, PostMediaItem, PostType, TransferMetadata, SigningMetadata } from '@/types/homeFeed'
import type { Profile } from '@/lib/supabase'

/**
 * PostPage — single-post detail view at /post/:postId.
 *
 * Reachable from chat shared-post cards (SharedPostCard) and from the
 * "Copy link" affordance in SharePostSheet. Before this page existed,
 * those navigates dead-ended on a 404.
 *
 * Reuses UserPostCard wholesale — fetches the user_posts row + author +
 * has_liked, manufactures a UserPostFeedItem shape, and renders the
 * exact same card the home feed uses. Visitors get a fully functional
 * post with author header, media, like/comment/share actions, and the
 * comment thread.
 *
 * Public-readable: anon SELECT is allowed on user_posts (deleted_at IS NULL),
 * so unauthenticated link recipients can view. Like/comment actions still
 * require auth (enforced upstream by RLS on post_likes / post_comments).
 */

type PostRow = {
  id: string
  author_id: string
  content: string
  images: PostMediaItem[] | null
  like_count: number
  comment_count: number
  created_at: string
  // Some posts have these via the rich-media migration; tolerate absence.
  post_type?: PostType | null
  metadata?: TransferMetadata | SigningMetadata | null
}

type AuthorRow = Pick<Profile, 'id' | 'full_name' | 'avatar_url' | 'role'>

export default function PostPage() {
  const { postId } = useParams<{ postId: string }>()
  const navigate = useNavigate()
  const { user } = useAuthStore()

  const [item, setItem] = useState<UserPostFeedItem | null>(null)
  const [loading, setLoading] = useState(true)
  const [notFound, setNotFound] = useState(false)
  // Distinguish "post genuinely doesn't exist / was deleted" (notFound)
  // from "we couldn't reach the database" (loadError). Lumping them
  // together meant a transient network failure looked identical to a
  // 404, denying the user any retry signal.
  const [loadError, setLoadError] = useState(false)

  useEffect(() => {
    if (!postId) {
      setNotFound(true)
      setLoading(false)
      return
    }

    let cancelled = false

    const load = async () => {
      try {
        const { data: postData, error: postErr } = await supabase
          .from('user_posts')
          .select('id, author_id, content, images, like_count, comment_count, created_at, post_type, metadata')
          .eq('id', postId)
          .is('deleted_at', null)
          .maybeSingle()
          .returns<PostRow | null>()

        if (cancelled) return
        if (postErr) throw postErr
        if (!postData) {
          setNotFound(true)
          return
        }

        const { data: author, error: authorErr } = await supabase
          .from('profiles')
          .select('id, full_name, avatar_url, role')
          .eq('id', postData.author_id)
          .maybeSingle()
          .returns<AuthorRow | null>()
        if (cancelled) return
        if (authorErr) throw authorErr
        if (!author || !author.role || author.role === 'member') {
          // Author missing or in a role we don't render in the feed UI.
          setNotFound(true)
          return
        }

        let hasLiked = false
        if (user?.id) {
          const { data: likeRow } = await supabase
            .from('post_likes')
            .select('post_id')
            .eq('post_id', postData.id)
            .eq('user_id', user.id)
            .maybeSingle()
          if (cancelled) return
          hasLiked = Boolean(likeRow)
        }

        const feedItem: UserPostFeedItem = {
          feed_item_id: postData.id,
          item_type: 'user_post',
          created_at: postData.created_at,
          post_id: postData.id,
          author_id: author.id,
          author_name: author.full_name,
          author_avatar: author.avatar_url,
          author_role: author.role as UserPostFeedItem['author_role'],
          content: postData.content,
          images: postData.images,
          like_count: postData.like_count,
          comment_count: postData.comment_count,
          has_liked: hasLiked,
          post_type: postData.post_type ?? undefined,
          metadata: postData.metadata ?? null,
        }
        setItem(feedItem)
        document.title = `${author.full_name ?? 'A post'} on HOCKIA`
      } catch (err) {
        logger.error('[PostPage] failed to load post', err)
        if (!cancelled) setLoadError(true)
      } finally {
        if (!cancelled) setLoading(false)
      }
    }

    void load()
    return () => { cancelled = true }
  }, [postId, user?.id])

  if (loading) {
    return (
      <Layout>
        <Header />
        <div className="flex flex-1 items-center justify-center">
          <Loader2 className="h-6 w-6 animate-spin text-gray-400" aria-label="Loading post" />
        </div>
      </Layout>
    )
  }

  if (loadError) {
    return (
      <Layout>
        <Header />
        <div className="flex flex-1 flex-col items-center justify-center gap-3 px-6 text-center">
          <p className="text-lg font-semibold text-gray-900">Couldn’t load this post</p>
          <p className="max-w-md text-sm text-gray-500">
            Something went wrong reaching the post. Check your connection and try again.
          </p>
          <div className="flex gap-3">
            <button
              type="button"
              onClick={() => window.location.reload()}
              className="rounded-lg bg-[#8026FA] px-4 py-2 text-sm font-medium text-white hover:bg-[#6B20D4]"
            >
              Try again
            </button>
            <button
              type="button"
              onClick={() => navigate('/home')}
              className="text-sm font-medium text-gray-600 hover:text-gray-900"
            >
              Back to home
            </button>
          </div>
        </div>
      </Layout>
    )
  }

  if (notFound || !item) {
    return (
      <Layout>
        <Header />
        <div className="flex flex-1 flex-col items-center justify-center gap-3 px-6 text-center">
          <p className="text-lg font-semibold text-gray-900">Post not found</p>
          <p className="max-w-md text-sm text-gray-500">
            This post may have been deleted or made private.
          </p>
          <button
            type="button"
            onClick={() => navigate('/home')}
            className="text-sm font-medium text-[#8026FA] hover:text-[#6B20D4]"
          >
            Go to home feed
          </button>
        </div>
      </Layout>
    )
  }

  // If the post is deleted while open, UserPostCard's onDelete fires —
  // route the user back to feed since the page no longer has anything
  // to render.
  const handleDelete = () => navigate('/home', { replace: true })

  return (
    <Layout>
      <Header />
      <div className="flex-1 bg-gray-50 pt-[var(--app-header-offset)]">
        <div className="mx-auto max-w-2xl px-4 py-6 md:py-10">
          <button
            type="button"
            onClick={() => navigate(-1)}
            className="mb-4 inline-flex items-center gap-2 text-sm text-gray-600 hover:text-gray-900"
          >
            <ArrowLeft className="h-4 w-4" />
            Back
          </button>
          <UserPostCard item={item} onDelete={handleDelete} />
        </div>
      </div>
    </Layout>
  )
}
