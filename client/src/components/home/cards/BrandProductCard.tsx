import { BadgeCheck, ExternalLink } from 'lucide-react'
import { FeedImageCarousel } from '../FeedImageCarousel'
import { FeedCard, FeedCardBody, FeedCardFooter, FeedCardHeader, FeedCardMedia } from '../FeedCard'
import type { BrandProductFeedItem } from '@/types/homeFeed'

interface BrandProductCardProps {
  item: BrandProductFeedItem
}

/**
 * brand_product — the BRAND is the author (slug route, category as the
 * header subtitle, verified check in the right slot). Product images sit in
 * the media well; name + description in the body; the external "Learn more"
 * CTA in the footer.
 */
export function BrandProductCard({ item }: BrandProductCardProps) {
  const sortedImages = item.product_images
    ? [...item.product_images].sort((a, b) => a.order - b.order)
    : []

  return (
    <FeedCard testId="brand-product-card">
      <FeedCardHeader
        authorId={item.brand_id}
        name={item.brand_name}
        avatarUrl={item.brand_logo_url}
        role="brand"
        createdAt={item.created_at}
        profilePath={`/brands/${item.brand_slug}`}
        subtitle={item.brand_category}
        right={item.brand_is_verified ? (
          <BadgeCheck className="h-5 w-5 flex-shrink-0 text-blue-500" aria-label="Verified brand" />
        ) : undefined}
      />

      {sortedImages.length > 0 && (
        <FeedCardMedia>
          <FeedImageCarousel images={sortedImages} altPrefix={item.product_name} />
        </FeedCardMedia>
      )}

      <FeedCardBody>
        <h3 className="text-[15px] font-semibold leading-5 text-gray-900">{item.product_name}</h3>
        {item.product_description && (
          <p className="mt-1 line-clamp-2 text-[14px] leading-5 text-gray-600">
            {item.product_description}
          </p>
        )}
      </FeedCardBody>

      {/* External destination — a plain <a target="_blank"> (the shell's
          primary action only knows in-app routes), styled to match it. */}
      {item.product_external_url && (
        <FeedCardFooter>
          <a
            href={item.product_external_url}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 rounded-full bg-hockia-primary px-4 py-2 text-[13px] font-semibold text-white transition-opacity hover:opacity-90 active:opacity-80"
          >
            Learn more
            <ExternalLink className="h-3.5 w-3.5" />
          </a>
        </FeedCardFooter>
      )}
    </FeedCard>
  )
}
