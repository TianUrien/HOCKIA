import { HOME_V1_MODULES, recordModuleImpression, useImpressionOnce } from '@/lib/homeInstrumentation'
import { Button } from '@/components/ui/Button'
import { useHomeT } from '@/i18n/ns/home'

/**
 * End of feed (Figma New Hockia 2 Draft, HS S1 / S3; founder 2026-11-24).
 * Home is a feed of posts: when it runs out it says so and offers to post.
 * No rows of people or second rail as filler. `empty` is the same block when
 * there is no post at all.
 */
export function EndOfFeed({ empty = false, onCompose }: { empty?: boolean; onCompose?: () => void }) {
  const t = useHomeT()
  const impressionRef = useImpressionOnce(() => recordModuleImpression(HOME_V1_MODULES.endOfFeed.id, HOME_V1_MODULES.endOfFeed.position))
  return (
    <section ref={impressionRef} className="flex flex-col items-center gap-1 px-8 pb-8 pt-9 text-center" data-testid={empty ? 'home-empty-feed' : 'home-end-of-feed'}>
      <h2 className="text-body font-semibold text-ink-1">{empty ? t('endOfFeed.emptyTitle') : t('endOfFeed.title')}</h2>
      <p className="text-secondary text-ink-2">{empty ? t('endOfFeed.emptyBody') : t('endOfFeed.body')}</p>
      {onCompose && (
        <Button className="mt-3" onClick={onCompose} data-testid="home-end-post">
          {t('endOfFeed.post')}
        </Button>
      )}
    </section>
  )
}
