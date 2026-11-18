import { lazy, Suspense, useEffect, useRef, useState } from 'react'
import { queryClient } from '@/lib/queryClient'
import { useToastStore } from '@/lib/toast'
import { trackDbEvent } from '@/lib/trackDbEvent'
import { useMediaT } from '@/i18n/ns/media'

// The composer is heavy and only needed after "Share" (same as Home).
const PostComposerModal = lazy(() => import('@/components/home/PostComposerModal').then((m) => ({ default: m.PostComposerModal })))

/** The composer takes at most five photos per post. */
export const SHARE_TO_HOME_MAX_PHOTOS = 5

/**
 * "Share on Home?" (founder 2026-11-18, direction A): Home shows what members
 * choose to share. Photos added to a profile no longer reach Home on their own
 * (ruling 2026-11-10), so right after an upload the owner is asked once.
 * "Share" opens the normal composer with those photos attached: the result is
 * an ordinary post, copied into the posts bucket, so removing the gallery
 * photo later does not break it. "Not now" changes nothing.
 */
export function ShareToHomePrompt({ files, onDone }: {
  /** The photos just added to the profile; empty hides the prompt. */
  files: File[]
  /** Called when the member answers (shared, cancelled or "Not now"). */
  onDone: () => void
}) {
  const t = useMediaT()
  const addToast = useToastStore((s) => s.addToast)
  const [composing, setComposing] = useState(false)
  const count = files.length

  const ref = useRef<HTMLElement>(null)

  useEffect(() => {
    if (count === 0) return
    trackDbEvent('share_to_home_prompt', undefined, undefined, { action: 'view', media_type: 'photo', count })
    // Mid-screen, clear of the "Photo added." toast at the bottom.
    ref.current?.scrollIntoView?.({ behavior: 'smooth', block: 'center' })
  }, [count])

  if (count === 0) return null

  const share = () => {
    trackDbEvent('share_to_home_prompt', undefined, undefined, { action: 'accept', media_type: 'photo', count })
    setComposing(true)
  }
  const notNow = () => {
    trackDbEvent('share_to_home_prompt', undefined, undefined, { action: 'dismiss', media_type: 'photo', count })
    onDone()
  }

  return (
    <>
      <section ref={ref} className="flex flex-col gap-3 rounded-[20px] bg-hockia-soft px-4 py-4" aria-label={t('shareToHome.title', { count })} data-testid="share-to-home-prompt">
        <div>
          <h3 className="text-[16px] font-semibold leading-[21px] text-ink-1">{t('shareToHome.title', { count })}</h3>
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
            initialImageFiles={files.slice(0, SHARE_TO_HOME_MAX_PHOTOS)}
            onClose={() => { setComposing(false); onDone() }}
            onPostCreated={() => {
              trackDbEvent('share_to_home_prompt', undefined, undefined, { action: 'posted', media_type: 'photo', count })
              void queryClient.invalidateQueries({ queryKey: ['home-feed'] })
              addToast(t('shareToHome.shared'), 'success')
            }}
          />
        </Suspense>
      )}
    </>
  )
}
