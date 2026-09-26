import { BadgeCheck } from 'lucide-react'
import { brandCategoryLabel } from '@/lib/identity'
import { getImageUrl } from '@/lib/imageUrl'
import { FeedCard, FeedCardBody, FeedCardHeader, FeedCardMedia } from '../FeedCard'
import type { BrandPostFeedItem } from '@/types/homeFeed'

interface BrandPostCardProps {
  item: BrandPostFeedItem
}

/**
 * brand_post — the BRAND is the author. Brand routes are slug-based, and a
 * brand has no profiles row, so the header's club · city line is replaced
 * by the brand category; the verified check sits in the header's right slot.
 */
export function BrandPostCard({ item }: BrandPostCardProps) {
  return (
    <FeedCard testId="brand-post-card">
      <FeedCardHeader
        authorId={item.brand_id}
        name={item.brand_name}
        avatarUrl={item.brand_logo_url}
        role="brand"
        createdAt={item.created_at}
        profilePath={`/brands/${item.brand_slug}`}
        subtitle={brandCategoryLabel(item.brand_category)}
        right={item.brand_is_verified ? (
          <BadgeCheck className="h-5 w-5 flex-shrink-0 text-blue-500" aria-label="Verified brand" />
        ) : undefined}
      />

      {item.post_content && (
        <FeedCardBody>
          <p className="whitespace-pre-line break-words">{item.post_content}</p>
        </FeedCardBody>
      )}

      {/* Reserved 4:3 box: zero layout shift as the image decodes (the feed's
          house ratio, matching products/carousels). */}
      {item.post_image_url && (
        <FeedCardMedia>
          <div className="aspect-[4/3]">
            <img
              src={getImageUrl(item.post_image_url, 'feed-full') ?? undefined}
              alt=""
              className="h-full w-full object-cover"
              loading="lazy"
              decoding="async"
            />
          </div>
        </FeedCardMedia>
      )}
    </FeedCard>
  )
}
