import { useState, useCallback } from 'react'
import { Play } from 'lucide-react'
import { getImageUrl, getLqipUrl } from '@/lib/imageUrl'
import type { ImageSize } from '@/lib/imageUrl'
import type { PostMediaItem } from '@/types/homeFeed'

interface FeedMediaGridProps {
  media: PostMediaItem[]
  onImageClick?: (index: number) => void
  /** Prefix for image / video alt text. Defaults to "Post" — pass the
   *  author or post context (e.g. `Post by ${author_name}`) so screen
   *  readers don't skip the media silently. We don't collect per-image
   *  captions on the composer, so a contextual prefix is the best alt
   *  we can produce. */
  altPrefix?: string
}

function MediaItem({
  item,
  className = '',
  onClick,
  imageSize = 'feed-thumb',
  alt,
}: {
  item: PostMediaItem
  className?: string
  onClick?: () => void
  imageSize?: ImageSize
  alt: string
}) {
  const mediaType = item.media_type ?? 'image'
  const [imgLoaded, setImgLoaded] = useState(false)
  // LQIP blur-up ONLY on the full-width single image (a heavy, above-fold,
  // placeholder-less surface). Grid thumbs (feed-thumb) get null → no extra
  // request, preserving Phase 1's request-reduction win.
  const lqip = imageSize === 'feed-full' ? getLqipUrl(item.url) : null

  if (mediaType === 'video') {
    return (
      <button
        type="button"
        aria-label={`Play video — ${alt}`}
        className={`relative overflow-hidden cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-hockia-primary ${className}`}
        onClick={onClick}
      >
        {item.thumb_url ? (
          <img src={getImageUrl(item.thumb_url, imageSize) ?? undefined} alt={alt} loading="lazy" decoding="async" className="w-full h-full object-cover" onError={(e) => { if (item.thumb_url && e.currentTarget.src !== item.thumb_url) e.currentTarget.src = item.thumb_url }} />
        ) : (
          // Cloudflare reels store no poster (the signed poster is minted at
          // playback), so show the branded tile rather than a black box.
          <div className="w-full h-full bg-gradient-to-br from-[#1a1030] via-[#2a1a4a] to-hockia-primary/40" />
        )}
        <div className="absolute inset-0 flex items-center justify-center bg-black/20">
          <div className="w-12 h-12 rounded-full bg-black/50 backdrop-blur-sm flex items-center justify-center">
            <Play className="w-6 h-6 text-white ml-0.5" fill="white" />
          </div>
        </div>
      </button>
    )
  }

  return (
    <button
      type="button"
      aria-label={`View image — ${alt}`}
      className={`relative overflow-hidden cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-hockia-primary ${className}`}
      onClick={onClick}
    >
      {lqip && !imgLoaded && (
        <div
          aria-hidden="true"
          className="absolute inset-0 scale-105 bg-cover bg-center blur-md"
          style={{ backgroundImage: `url("${lqip}")` }}
        />
      )}
      <img
        src={getImageUrl(item.url, imageSize) ?? undefined}
        alt={alt}
        loading="lazy"
        decoding="async"
        className={`relative w-full h-full object-cover transition-[transform,opacity] duration-300 hover:scale-[1.02] ${lqip && !imgLoaded ? 'opacity-0' : 'opacity-100'}`}
        onLoad={() => setImgLoaded(true)}
        onError={(e) => { setImgLoaded(true); if (item.url && e.currentTarget.src !== item.url) e.currentTarget.src = item.url }}
      />
    </button>
  )
}

export function FeedMediaGrid({ media, onImageClick, altPrefix = 'Post' }: FeedMediaGridProps) {
  const [overflowExpanded, setOverflowExpanded] = useState(false)

  const handleImageClick = useCallback(
    (index: number) => {
      onImageClick?.(index)
    },
    [onImageClick]
  )

  // Per-item alt: "Post by Author Name — image 2 of 5".
  const altFor = (i: number, total: number) =>
    total > 1 ? `${altPrefix} — image ${i + 1} of ${total}` : altPrefix

  if (!media || media.length === 0) return null

  const sorted = [...media].sort((a, b) => a.order - b.order)
  const displayItems = overflowExpanded ? sorted : sorted.slice(0, 5)
  const overflowCount = sorted.length - 5
  const count = displayItems.length

  // Single item — full width
  if (count === 1) {
    const item = displayItems[0]
    const isVideo = (item.media_type ?? 'image') === 'video'
    const aspectClass = isVideo ? 'aspect-video' : 'aspect-[4/3] max-h-[500px]'

    return (
      <div className="overflow-hidden">
        <MediaItem
          item={item}
          className={aspectClass}
          imageSize="feed-full"
          alt={altFor(0, count)}
          onClick={() => handleImageClick(0)}
        />
      </div>
    )
  }

  // 2 items — side by side
  if (count === 2) {
    return (
      <div className="grid grid-cols-2 gap-1 overflow-hidden">
        {displayItems.map((item, i) => (
          <MediaItem
            key={item.video_id ?? item.url}
            item={item}
            className="aspect-square"
            alt={altFor(i, count)}
            onClick={() => handleImageClick(i)}
          />
        ))}
      </div>
    )
  }

  // 3 items — 1 large left + 2 small right
  if (count === 3) {
    return (
      <div className="grid grid-cols-3 grid-rows-2 gap-1 overflow-hidden" style={{ height: '320px' }}>
        <div className="col-span-2 row-span-2">
          <MediaItem
            item={displayItems[0]}
            className="w-full h-full"
            alt={altFor(0, count)}
            onClick={() => handleImageClick(0)}
          />
        </div>
        <div className="col-span-1 row-span-1">
          <MediaItem
            item={displayItems[1]}
            className="w-full h-full"
            alt={altFor(1, count)}
            onClick={() => handleImageClick(1)}
          />
        </div>
        <div className="col-span-1 row-span-1">
          <MediaItem
            item={displayItems[2]}
            className="w-full h-full"
            alt={altFor(2, count)}
            onClick={() => handleImageClick(2)}
          />
        </div>
      </div>
    )
  }

  // 4 items — 2x2 grid
  if (count === 4) {
    return (
      <div className="grid grid-cols-2 grid-rows-2 gap-1 overflow-hidden">
        {displayItems.map((item, i) => (
          <MediaItem
            key={item.video_id ?? item.url}
            item={item}
            className="aspect-square"
            alt={altFor(i, count)}
            onClick={() => handleImageClick(i)}
          />
        ))}
      </div>
    )
  }

  // 5+ items — 2 top + 3 bottom
  return (
    <div className="overflow-hidden space-y-1">
      {/* Top row: 2 items */}
      <div className="grid grid-cols-2 gap-1">
        {displayItems.slice(0, 2).map((item, i) => (
          <MediaItem
            key={item.video_id ?? item.url}
            item={item}
            className="aspect-[4/3]"
            alt={altFor(i, sorted.length)}
            onClick={() => handleImageClick(i)}
          />
        ))}
      </div>
      {/* Bottom row: 3 items */}
      <div className="grid grid-cols-3 gap-1">
        {displayItems.slice(2, 5).map((item, i) => {
          const actualIndex = i + 2
          const isLast = actualIndex === 4 && overflowCount > 0 && !overflowExpanded

          return (
            <div key={item.video_id ?? item.url} className="relative">
              <MediaItem
                item={item}
                className="aspect-square"
                alt={altFor(actualIndex, sorted.length)}
                onClick={() => {
                  if (isLast) {
                    setOverflowExpanded(true)
                  } else {
                    handleImageClick(actualIndex)
                  }
                }}
              />
              {isLast && (
                <button
                  type="button"
                  onClick={() => setOverflowExpanded(true)}
                  className="absolute inset-0 bg-black/50 flex items-center justify-center"
                >
                  <span className="text-white text-2xl font-bold">+{overflowCount}</span>
                </button>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}
