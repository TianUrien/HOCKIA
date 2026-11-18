import { lazy, Suspense, useEffect, useRef, useState } from 'react'
import { queryClient } from '@/lib/queryClient'
import { supabase } from '@/lib/supabase'
import { validateVideoFull } from '@/lib/imageOptimization'
import { useToastStore } from '@/lib/toast'
import { trackDbEvent } from '@/lib/trackDbEvent'
import { useMediaT } from '@/i18n/ns/media'

// The composer is heavy and only needed after "Share" (same as Home).
const PostComposerModal = lazy(() => import('@/components/home/PostComposerModal').then((m) => ({ default: m.PostComposerModal })))

/** The composer takes at most five photos per post. */
export const SHARE_TO_HOME_MAX_PHOTOS = 5

/**
 * True when this video can become a Home post right now: video posts are
 * switched on (server flag, off unless the row exists) and the file fits a
 * post (shorter and smaller than a profile highlight may be). Fails closed, so
 * the prompt never leads to a composer that refuses the video.
 */
async function videoFitsHomePost(file: File): Promise<boolean> {
  try {
    const { data, error } = await supabase.rpc('video_posts_enabled')
    if (error || data !== true) return false
    return (await validateVideoFull(file)).valid
  } catch {
    return false
  }
}

/**
 * "Share on Home?" (founder 2026-11-18, direction A): Home shows what members
 * choose to share. Photos and videos added to a profile no longer reach Home
 * on their own (ruling 2026-11-10), so right after an upload the owner is
 * asked once. "Share" opens the normal composer with the media attached: the
 * result is an ordinary post with its own copy, so removing the profile photo
 * or video later does not break it. "Not now" changes nothing.
 */
export function ShareToHomePrompt({ files = [], video = null, onDone }: {
  /** The photos just added to the profile. */
  files?: File[]
  /** The public highlight video just added to the profile (see shareableVideo). */
  video?: File | null
  /** Called when the member answers (shared, cancelled or "Not now"). */
  onDone: () => void
}) {
  const t = useMediaT()
  const addToast = useToastStore((s) => s.addToast)
  const [composing, setComposing] = useState(false)
  // The video the prompt may be shown for, once the checks have passed.
  const [videoReady, setVideoReady] = useState<File | null>(null)

  useEffect(() => {
    if (!video) return
    let cancelled = false
    void videoFitsHomePost(video).then((ok) => { if (!cancelled && ok) setVideoReady(video) })
    return () => { cancelled = true }
  }, [video])

  const shownVideo = video && videoReady === video ? video : null
  const mediaType = shownVideo ? 'video' : 'photo'
  const count = shownVideo ? 1 : files.length

  const ref = useRef<HTMLElement>(null)

  useEffect(() => {
    if (count === 0) return
    trackDbEvent('share_to_home_prompt', undefined, undefined, { action: 'view', media_type: mediaType, count })
    // Mid-screen, clear of the toast at the bottom.
    ref.current?.scrollIntoView?.({ behavior: 'smooth', block: 'center' })
  }, [count, mediaType])

  if (count === 0) return null

  const share = () => {
    trackDbEvent('share_to_home_prompt', undefined, undefined, { action: 'accept', media_type: mediaType, count })
    setComposing(true)
  }
  const notNow = () => {
    trackDbEvent('share_to_home_prompt', undefined, undefined, { action: 'dismiss', media_type: mediaType, count })
    onDone()
  }
  const title = shownVideo ? t('shareToHome.videoTitle') : t('shareToHome.title', { count })

  return (
    <>
      <section ref={ref} className="flex flex-col gap-3 rounded-[20px] bg-hockia-soft px-4 py-4" aria-label={title} data-testid="share-to-home-prompt">
        <div>
          <h3 className="text-[16px] font-semibold leading-[21px] text-ink-1">{title}</h3>
          <p className="mt-0.5 text-secondary text-ink-2">{t('shareToHome.body', { count })}</p>
        </div>
        <div className="flex gap-2">
          <button type="button" onClick={share} className="h-11 rounded-full bg-hockia-primary px-5 text-[15px] font-semibold text-white" data-testid="share-to-home-accept">
            {t('shareToHome.share')}
          </button>
          <button type="button" onClick={notNow} className="h-11 rounded-full border border-line bg-white px-5 text-[15px] font-semibold text-ink-1" data-testid="share-to-home-dismiss">
            {t('shareToHome.notNow')}
          </button>
        </div>
      </section>

      {composing && (
        <Suspense fallback={null}>
          <PostComposerModal
            isOpen
            initialImageFiles={shownVideo ? undefined : files.slice(0, SHARE_TO_HOME_MAX_PHOTOS)}
            initialVideoFile={shownVideo}
            onClose={() => { setComposing(false); onDone() }}
            onPostCreated={() => {
              trackDbEvent('share_to_home_prompt', undefined, undefined, { action: 'posted', media_type: mediaType, count })
              void queryClient.invalidateQueries({ queryKey: ['home-feed'] })
              addToast(t('shareToHome.shared'), 'success')
            }}
          />
        </Suspense>
      )}
    </>
  )
}
