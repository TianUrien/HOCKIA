import { useEffect, useState } from 'react'
import { usePostInteractions } from '@/hooks/usePostInteractions'
import type { PostComment } from '@/types/homeFeed'

// Module cache so a question card that scrolls in and out of view does not
// refetch its preview. Cleared for a post whenever its comment count changes.
const cache = new Map<string, PostComment | null>()

export function clearTopAnswerCache(postId: string) {
  cache.delete(postId)
}

/**
 * The answer shown on a question card in the feed (Home v2 DEV NOTE: "the
 * answer with most likes, or the newest"). Comments carry no like counts
 * today, so this is the first answer the RPC returns.
 */
export function useTopAnswer(postId: string, enabled: boolean): PostComment | null {
  const { fetchComments } = usePostInteractions()
  const [answer, setAnswer] = useState<PostComment | null>(() => cache.get(postId) ?? null)

  useEffect(() => {
    if (!enabled) return
    if (cache.has(postId)) {
      setAnswer(cache.get(postId) ?? null)
      return
    }
    let cancelled = false
    void fetchComments(postId, 1, 0).then((result) => {
      const first = result.comments[0] ?? null
      cache.set(postId, first)
      if (!cancelled) setAnswer(first)
    })
    return () => {
      cancelled = true
    }
  }, [postId, enabled, fetchComments])

  return answer
}
