import { useState } from 'react'
import { DetailNavBar } from '@/components/ui/DetailNavBar'
import { MediaLightbox } from '@/components/home/MediaLightbox'
import { useGalleryPhotos } from '@/hooks/useGalleryPhotos'
import { getImageUrl, getImageSrcSet } from '@/lib/imageUrl'
import { SmoothImage } from '@/components/ui/SmoothImage'
import { profilePath } from '@/lib/profileNavigation'
import { cn } from '@/lib/utils'
import { useMediaT } from '@/i18n/ns/media'

/**
 * Gallery (Figma 136:558): every photo of a profile in a grid — two across,
 * with every fifth photo full width — in the order the owner arranged. A tap
 * opens the Photo viewer (Figma 188:633 — the app's one media viewer: "N of
 * M", author + View profile, caption, X to go back). Same screen for the
 * owner and a visitor; the owner's tools live in Manage media.
 */
interface GalleryScreenProps {
  profile: { id: string; full_name?: string | null; username?: string | null; avatar_url?: string | null; role?: string | null }
  mode: 'own' | 'public'
  onBack: () => void
}

export default function GalleryScreen({ profile, mode, onBack }: GalleryScreenProps) {
  const t = useMediaT()
  const own = mode === 'own'
  const { photos, loading } = useGalleryPhotos(profile.id)
  const [open, setOpen] = useState<number | null>(null)
  const firstName = profile.full_name?.trim().split(/\s+/)[0] || null
  const count = photos.length
  // Owner: "Photos · 2". Visitor: "Mariano's photos" with the count below —
  // never the raw account name in a title.
  const title = own ? (loading ? t('galleryScreen.title') : t('galleryScreen.titleCount', { total: count })) : firstName ? t('galleryScreen.titleNamed', { firstName }) : t('galleryScreen.title')
  const avatar = profile.avatar_url ? getImageUrl(profile.avatar_url, 'avatar-md') ?? profile.avatar_url : null

  return (
    <div className="min-h-screen bg-white pb-24 lg:hidden" data-testid="gallery-screen">
      <div className="sticky top-0 z-20 bg-white pt-[env(safe-area-inset-top)]">
        <DetailNavBar parent={own ? t('galleryScreen.parent') : firstName ?? t('galleryScreen.parent')} title={title} onBack={onBack} />
      </div>
      <div className="px-5 pt-2">
        {!own && !loading && <p className="pb-3 text-secondary text-ink-2">{t('galleryScreen.photoCount', { count })}</p>}
        {loading ? (
          <div className="grid grid-cols-2 gap-2" aria-busy="true">{Array.from({ length: 4 }, (_, i) => <div key={i} className="aspect-square animate-pulse rounded-card bg-surface-grouped" />)}</div>
        ) : count === 0 ? (
          <div className="py-12 text-center">
            <p className="text-row font-semibold text-ink-1">{own ? t('galleryScreen.emptyOwn') : t('galleryScreen.emptyPublic')}</p>
            {own && <p className="mt-1 text-secondary text-ink-2">{t('galleryScreen.emptyOwnHint')}</p>}
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-2">
            {photos.map((p, i) => (
              <button
                key={p.id}
                type="button"
                onClick={() => setOpen(i)}
                aria-label={p.caption || t('galleryScreen.photoLabel', { index: i + 1, total: count })}
                className={cn('overflow-hidden rounded-card bg-surface-grouped', i % 5 === 4 ? 'col-span-2 aspect-[3/2]' : 'aspect-square')}
              >
                <SmoothImage src={getImageUrl(p.url, 'gallery') ?? p.url} srcSet={getImageSrcSet(p.url, 'gallery') ?? undefined} sizes={i % 5 === 4 ? '100vw' : '50vw'} alt="" eager={i < 4} priority={i === 0} className="object-cover" />
              </button>
            ))}
          </div>
        )}
      </div>
      {open !== null && (
        <MediaLightbox
          images={photos.map((p, i) => ({ url: p.url, media_type: 'image', order: i }))}
          initialIndex={open}
          onClose={() => setOpen(null)}
          caption={photos[open]?.caption ?? null}
          author={{ id: profile.id, name: profile.full_name ?? null, avatarUrl: avatar, role: profile.role ?? null, profilePath: own ? null : profilePath(profile.role, profile.username, profile.id) }}
        />
      )}
    </div>
  )
}
