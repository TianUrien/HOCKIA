import { useState, useCallback } from 'react'
import { Play } from 'lucide-react'
import { getImageUrl } from '@/lib/imageUrl'
import type { ImageSize } from '@/lib/imageUrl'
import type { PostMediaItem } from '@/types/homeFeed'

interface FeedMediaGridProps {
  media: PostMediaItem[]
  onImageClick?: (index: number) => void
}

function MediaItem({
  item,
  className = '',
  onClick,
  imageSize = 'feed-thumb',
}: {
  item: PostMediaItem
  className?: string
  onClick?: () => void
  imageSize?: ImageSize
}) {
  const mediaType = item.media_type ?? 'image'

  if (mediaType === 'video') {
    return (
      <button
        type="button"
        aria-label="Play video"
        className={`relative overflow-hidden cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-[#8026FA] ${className}`}
        onClick={onClick}
      >
        {item.thumb_url ? (
          <img src={getImageUrl(item.thumb_url, imageSize) ?? undefined} alt="" loading="lazy" decoding="async" className="w-full h-full object-cover" />
        ) : (
          <div className="w-full h-full bg-gray-900" />
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
      className={`overflow-hidden cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-[#8026FA] ${className}`}
      onClick={onClick}
    >
      <img
        src={getImageUrl(item.url, imageSize) ?? undefined}
        alt=""
        loading="lazy"
        decoding="async"
        className="w-full h-full object-cover transition-transform duration-200 hover:scale-[1.02]"
      />
    </button>
  )
}

export function FeedMediaGrid({ media, onImageClick }: FeedMediaGridProps) {
  const [overflowExpanded, setOverflowExpanded] = useState(false)

  const handleImageClick = useCallback(
    (index: number) => {
      onImageClick?.(index)
    },
    [onImageClick]
  )

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
      <div className="rounded-lg overflow-hidden">
        <MediaItem
          item={item}
          className={aspectClass}
          imageSize="feed-full"
          onClick={() => handleImageClick(0)}
        />
      </div>
    )
  }

  // 2 items — side by side
  if (count === 2) {
    return (
      <div className="grid grid-cols-2 gap-1 rounded-lg overflow-hidden">
        {displayItems.map((item, i) => (
          <MediaItem
            key={item.url}
            item={item}
            className="aspect-square"
            onClick={() => handleImageClick(i)}
          />
        ))}
      </div>
    )
  }

  // 3 items — 1 large left + 2 small right
  if (count === 3) {
    return (
      <div className="grid grid-cols-3 grid-rows-2 gap-1 rounded-lg overflow-hidden" style={{ height: '320px' }}>
        <div className="col-span-2 row-span-2">
          <MediaItem
            item={displayItems[0]}
            className="w-full h-full"
            onClick={() => handleImageClick(0)}
          />
        </div>
        <div className="col-span-1 row-span-1">
          <MediaItem
            item={displayItems[1]}
            className="w-full h-full"
            onClick={() => handleImageClick(1)}
          />
        </div>
        <div className="col-span-1 row-span-1">
          <MediaItem
            item={displayItems[2]}
            className="w-full h-full"
            onClick={() => handleImageClick(2)}
          />
        </div>
      </div>
    )
  }

  // 4 items — 2x2 grid
  if (count === 4) {
    return (
      <div className="grid grid-cols-2 grid-rows-2 gap-1 rounded-lg overflow-hidden">
        {displayItems.map((item, i) => (
          <MediaItem
            key={item.url}
            item={item}
            className="aspect-square"
            onClick={() => handleImageClick(i)}
          />
        ))}
      </div>
    )
  }

  // 5+ items — 2 top + 3 bottom
  return (
    <div className="rounded-lg overflow-hidden space-y-1">
      {/* Top row: 2 items */}
      <div className="grid grid-cols-2 gap-1">
        {displayItems.slice(0, 2).map((item, i) => (
          <MediaItem
            key={item.url}
            item={item}
            className="aspect-[4/3]"
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
            <div key={item.url} className="relative">
              <MediaItem
                item={item}
                className="aspect-square"
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
