import { supabase } from '@/lib/supabase'
import { logger } from '@/lib/logger'
import { withTimeout } from '@/lib/retry'
import { trackDbEvent } from '@/lib/trackDbEvent'
import { currentSurface } from '@/lib/homeInstrumentation'
import { positionLabel } from '@/lib/identity'
import { getShareOrigin } from '@/lib/profileShare'
import { opportunityGenderToTeamLabel } from '@/lib/hockeyCategories'
import type { PostComment, SigningMetadata } from '@/types/homeFeed'

/**
 * Home v1 engagement (Figma t24oVt… H9 / H12c / H17): Congrats and comments
 * on the two target kinds the backend knows —
 *   post      → user_posts (comments: post_comments; congrats: signing only)
 *   feed_item → home_feed_items admitted by feed_item_engageable() (references)
 * One API so the card, the comments sheet and the ⋯ menu never branch on it.
 */
export type EngageTarget = { type: 'post'; id: string } | { type: 'feed_item'; id: string }

interface Result { success: boolean; error?: string }

function failed(err: unknown, fallback: string): Result {
  const message = err && typeof err === 'object' && 'message' in err && typeof err.message === 'string' ? err.message : fallback
  return { success: false, error: message }
}

export async function toggleCongrats(target: EngageTarget): Promise<Result & { has_congrats?: boolean; count?: number }> {
  try {
    const { data, error } = await withTimeout(
      async () => await supabase.rpc('toggle_congrats', { p_target_type: target.type, p_target_id: target.id }),
      10_000,
    )
    if (error) throw error
    const result = data as unknown as Result & { has_congrats?: boolean; count?: number }
    if (result.success) trackDbEvent('congrats_toggle', target.type, target.id, { has: result.has_congrats ?? null, surface: currentSurface() })
    return result
  } catch (err) {
    logger.error('[homeEngagement] toggleCongrats', err)
    return failed(err, 'Could not send congrats')
  }
}

export interface FeedComment extends PostComment {
  /** post_id for post comments, feed_item_id for reference comments. */
  target_id: string
}

export async function fetchComments(target: EngageTarget, limit = 50): Promise<{ comments: FeedComment[]; total: number }> {
  try {
    const { data, error } = await withTimeout(
      async () =>
        target.type === 'post'
          ? await supabase.rpc('get_post_comments', { p_post_id: target.id, p_limit: limit, p_offset: 0 })
          : await supabase.rpc('get_feed_item_comments', { p_feed_item_id: target.id, p_limit: limit, p_offset: 0 }),
      10_000,
    )
    if (error) throw error
    const res = (data ?? {}) as { comments?: Array<PostComment & { feed_item_id?: string }>; total?: number }
    const comments = (Array.isArray(res.comments) ? res.comments : []).map((c) => ({ ...c, post_id: c.post_id ?? target.id, target_id: target.id }))
    return { comments, total: res.total ?? comments.length }
  } catch (err) {
    logger.error('[homeEngagement] fetchComments', err)
    throw err
  }
}

export async function createComment(target: EngageTarget, content: string): Promise<Result & { comment_id?: string }> {
  try {
    const { data, error } = await withTimeout(
      async () =>
        target.type === 'post'
          ? await supabase.rpc('create_post_comment', { p_post_id: target.id, p_content: content })
          : await supabase.rpc('create_feed_item_comment', { p_feed_item_id: target.id, p_content: content }),
      15_000,
    )
    if (error) throw error
    const result = data as unknown as Result & { comment_id?: string }
    if (result.success) trackDbEvent(target.type === 'post' ? 'post_comment_create' : 'feed_item_comment_create', target.type, target.id, { surface: currentSurface() })
    return result
  } catch (err) {
    logger.error('[homeEngagement] createComment', err)
    return failed(err, 'Could not post your comment')
  }
}

export async function deleteComment(target: EngageTarget, commentId: string): Promise<Result> {
  try {
    const { data, error } = await withTimeout(
      async () =>
        target.type === 'post'
          ? await supabase.rpc('delete_post_comment', { p_comment_id: commentId })
          : await supabase.rpc('delete_feed_item_comment', { p_comment_id: commentId }),
      15_000,
    )
    if (error) throw error
    return data as unknown as Result
  } catch (err) {
    logger.error('[homeEngagement] deleteComment', err)
    return failed(err, 'Could not delete the comment')
  }
}

export async function setCommentsEnabled(target: EngageTarget, enabled: boolean): Promise<Result> {
  try {
    const { data, error } = await withTimeout(
      async () =>
        target.type === 'post'
          ? await supabase.rpc('set_post_comments_enabled', { p_post_id: target.id, p_enabled: enabled })
          : await supabase.rpc('set_feed_item_comments_enabled', { p_feed_item_id: target.id, p_enabled: enabled }),
      10_000,
    )
    if (error) throw error
    return data as unknown as Result
  } catch (err) {
    logger.error('[homeEngagement] setCommentsEnabled', err)
    return failed(err, 'Could not change comments')
  }
}

export async function removeSigningTag(postId: string): Promise<Result> {
  try {
    const { data, error } = await withTimeout(async () => await supabase.rpc('remove_signing_tag', { p_post_id: postId }), 10_000)
    if (error) throw error
    return data as unknown as Result
  } catch (err) {
    logger.error('[homeEngagement] removeSigningTag', err)
    return failed(err, 'Could not remove your tag')
  }
}

/** "1.2k" (Figma counts). Tabular-nums is applied by the caller. */
export function compactCount(n: number): string {
  if (n < 1000) return String(n)
  if (n < 10_000) return `${(n / 1000).toFixed(1).replace(/\.0$/, '')}k`
  return `${Math.round(n / 1000)}k`
}

/** Duration "0:42" / "70:00" from seconds. */
export function formatClock(seconds: number | null | undefined): string | null {
  if (!seconds || seconds <= 0) return null
  const total = Math.floor(seconds)
  const m = Math.floor(total / 60)
  const s = (total % 60).toString().padStart(2, '0')
  return `${m}:${s}`
}

/** "Defender · Women's 1st team · 2027" — the club's role label, else the
 *  person's position, then the season. */
export function signingDetail(m: Pick<SigningMetadata, 'signing_role' | 'person_position' | 'season'>): string | null {
  const role = m.signing_role?.trim() || positionLabel(m.person_position) || null
  return [role, m.season?.trim() || null].filter(Boolean).join(' · ') || null
}

/** Share a Hockia path with the system sheet, else copy it. */
export async function shareLink(path: string): Promise<'shared' | 'copied' | 'dismissed' | 'failed'> {
  const url = `${getShareOrigin()}${path}`
  try {
    if (typeof navigator !== 'undefined' && navigator.share) {
      await navigator.share({ url })
      return 'shared'
    }
  } catch (err) {
    return err instanceof Error && err.name === 'AbortError' ? 'dismissed' : 'failed'
  }
  try {
    await navigator.clipboard.writeText(url)
    return 'copied'
  } catch {
    return 'failed'
  }
}

/** "Defender · Women's 1st" — position, then the team ("Women's Team" → "Women's"). */
export function roleTitle(position: string | null, gender: string | null, fallback: string): string {
  const team = opportunityGenderToTeamLabel(gender).replace(/ Team$/, '')
  return [positionLabel(position) || null, team || null].filter(Boolean).join(' · ') || fallback
}

/** People-row rings (Figma 60:164): brand for new members, green for available now. */
export const NEW_RING = 'linear-gradient(135deg, #a854f7 25%, #6b2bd9 75%)'
export const AVAILABLE_RING = 'linear-gradient(135deg, #22a559 25%, #157a3f 75%)'
