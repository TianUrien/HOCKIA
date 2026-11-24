import Avatar from '@/components/Avatar'
import { useAuthStore } from '@/lib/auth'
import { useHomeT } from '@/i18n/ns/home'

/**
 * The post entry at the top of Home (Figma New Hockia 2 Draft, HS S0 / S2;
 * founder 2026-11-24: Home is a feed of posts, so posting is the first thing
 * it offers). Your photo and one field-shaped button that opens the composer.
 */
export function PostEntry({ onCompose }: { onCompose: () => void }) {
  const t = useHomeT()
  const profile = useAuthStore((s) => s.profile)
  const club = profile?.role === 'club'
  return (
    <div className="flex items-center gap-3 border-b-8 border-surface-subtle px-4 pb-3 pt-2" data-testid="home-post-entry">
      <Avatar src={profile?.avatar_url ?? null} alt="" role={profile?.role ?? null} size="sm" className="!h-9 !w-9 shrink-0" />
      <button
        type="button"
        onClick={onCompose}
        className="flex h-11 min-w-0 flex-1 items-center rounded-full bg-surface-subtle px-4 text-left text-secondary text-ink-3 transition-colors hover:bg-surface-muted focus:outline-none focus-visible:ring-2 focus-visible:ring-hockia-primary/30"
        data-testid="home-post-entry-button"
      >
        <span className="truncate">{club ? t('postEntry.club') : t('postEntry.member')}</span>
      </button>
    </div>
  )
}
