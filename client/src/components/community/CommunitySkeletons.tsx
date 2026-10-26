import type { CommunitySkeletonKind } from '@/lib/communitySkeleton'

/**
 * Content-shaped Community skeletons (design audit 2026-10-21, A9): the
 * shape follows the selected tab, so the Clubs tab loads club cards (wide,
 * crest tile), the Brands tab brand cards (logo tile), everything else
 * person tiles. Phone and desktop grids match their real layouts.
 */

function Bars() {
  return (
    <>
      <span className="h-2.5 w-[64%] rounded-full bg-line" />
      <span className="h-2.5 w-[46%] rounded-full bg-line" />
      <span className="h-2.5 w-[37%] rounded-full bg-line" />
    </>
  )
}

export function CommunitySkeletons({ kind, layout }: { kind: CommunitySkeletonKind; layout: 'phone' | 'desktop' }) {
  if (kind === 'club') {
    return (
      <div className={layout === 'phone' ? 'grid grid-cols-1 gap-3' : 'grid grid-cols-1 gap-4'} aria-busy="true" aria-label="Loading clubs" data-testid="community-skeleton-club">
        {[...Array(3)].map((_, i) => (
          <div key={i} className="flex h-[188px] flex-col justify-end gap-1.5 rounded-[24px] bg-surface-muted p-4" data-testid="club-card-skeleton">
            <span className="mb-1.5 h-12 w-12 rounded-[14px] bg-line" />
            <Bars />
          </div>
        ))}
      </div>
    )
  }
  if (kind === 'brand') {
    return (
      <div className={layout === 'phone' ? 'grid grid-cols-2 gap-3' : 'grid grid-cols-2 gap-3 lg:grid-cols-4 lg:gap-4 min-[1440px]:grid-cols-5'} aria-busy="true" aria-label="Loading brands" data-testid="community-skeleton-brand">
        {[...Array(layout === 'phone' ? 6 : 15)].map((_, i) => (
          <div key={i} className="flex aspect-[3/4] flex-col items-center justify-between rounded-[20px] bg-surface-muted p-3" data-testid="brand-card-skeleton">
            <span className="mt-6 h-16 w-16 rounded-[16px] bg-line" />
            <span className="flex w-full flex-col items-start gap-1.5"><Bars /></span>
          </div>
        ))}
      </div>
    )
  }
  // People: the photo card shape on every screen size (audit B1).
  return (
    <div className={layout === 'phone' ? 'grid grid-cols-2 gap-3' : 'grid grid-cols-2 gap-3 lg:grid-cols-4 lg:gap-4 min-[1440px]:grid-cols-5'} aria-busy="true" aria-label="Loading members" data-testid="community-skeleton-person">
      {[...Array(layout === 'phone' ? 6 : 15)].map((_, i) => (
        <div key={i} className="flex aspect-[3/4] flex-col justify-end gap-1.5 rounded-[20px] bg-surface-muted p-3" data-testid="member-tile-skeleton">
          <Bars />
        </div>
      ))}
    </div>
  )
}
