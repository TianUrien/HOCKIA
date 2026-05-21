interface SkeletonProps {
  className?: string
  variant?: 'text' | 'circular' | 'rectangular'
  width?: string | number
  height?: string | number
  animation?: 'pulse' | 'wave' | 'none'
}

export default function Skeleton({
  className = '',
  variant = 'text',
  width,
  height,
  animation = 'pulse',
}: SkeletonProps) {
  const getVariantStyles = () => {
    switch (variant) {
      case 'circular':
        return 'rounded-full'
      case 'rectangular':
        return 'rounded-lg'
      case 'text':
      default:
        return 'rounded'
    }
  }

  const getAnimationStyles = () => {
    switch (animation) {
      case 'pulse':
        return 'animate-pulse'
      case 'wave':
        return 'animate-shimmer bg-gradient-to-r from-gray-200 via-gray-100 to-gray-200 bg-[length:200%_100%]'
      case 'none':
      default:
        return ''
    }
  }

  const style: React.CSSProperties = {
    width: typeof width === 'number' ? `${width}px` : width,
    height: typeof height === 'number' ? `${height}px` : height,
  }

  return (
    <div
      className={`bg-gray-200 ${getVariantStyles()} ${getAnimationStyles()} ${className}`}
      style={style}
    />
  )
}

// Conversation List Item Skeleton
export function ConversationSkeleton() {
  return (
    <div className="flex items-center gap-4 p-4 border-b border-gray-100">
      <Skeleton variant="circular" width={48} height={48} />
      <div className="flex-1 space-y-2">
        <Skeleton width="40%" height={16} />
        <Skeleton width="80%" height={14} />
      </div>
      <Skeleton variant="circular" width={20} height={20} />
    </div>
  )
}

// Opportunity Card Skeleton (formerly VacancyCardSkeleton)
/** Matches the App Store-style OpportunityCard bento tile: header row,
 *  logo + title + creator identity block, meta line, perk pills.
 *  Layout-neutral — the caller owns spacing (the masonry feed wraps it
 *  with break-inside-avoid + mb-4; OpportunitiesTab uses a gap grid). */
export function OpportunityCardSkeleton() {
  return (
    <div className="bg-white rounded-2xl border border-gray-100 p-5">
      {/* Header: opening type · country */}
      <div className="flex items-center justify-between">
        <Skeleton width={110} height={12} />
        <Skeleton width={72} height={24} className="rounded-full" />
      </div>
      {/* Identity: logo + title + creator */}
      <div className="mt-4 flex items-start gap-3.5">
        <Skeleton width={56} height={56} className="rounded-2xl" />
        <div className="flex-1 space-y-2">
          <Skeleton width="85%" height={18} />
          <Skeleton width="55%" height={18} />
          <Skeleton width="45%" height={13} />
        </div>
      </div>
      {/* Meta */}
      <div className="my-3.5 border-t border-gray-100" />
      <Skeleton width="65%" height={13} />
      {/* Perk pills */}
      <div className="flex gap-1.5 mt-3">
        <Skeleton width={72} height={26} className="rounded-full" />
        <Skeleton width={60} height={26} className="rounded-full" />
        <Skeleton width={66} height={26} className="rounded-full" />
      </div>
    </div>
  )
}

// Profile Card Skeleton (for Community page)
export function ProfileCardSkeleton() {
  return (
    <div className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden hover:shadow-md transition-shadow">
      <div className="h-32 bg-gradient-to-br from-gray-200 to-gray-300 animate-pulse" />
      <div className="p-6 space-y-4">
        <div className="flex items-center gap-4">
          <Skeleton variant="circular" width={64} height={64} />
          <div className="flex-1 space-y-2">
            <Skeleton width="70%" height={20} />
            <Skeleton width="50%" height={16} />
          </div>
        </div>
        <div className="space-y-2">
          <Skeleton width="100%" height={14} />
          <Skeleton width="90%" height={14} />
        </div>
        <div className="flex gap-2">
          <Skeleton width={80} height={24} className="rounded-full" />
          <Skeleton width={90} height={24} className="rounded-full" />
        </div>
      </div>
    </div>
  )
}

// Message Bubble Skeleton
export function MessageSkeleton({ isOwn = false }: { isOwn?: boolean }) {
  return (
    <div className={`flex ${isOwn ? 'justify-end' : 'justify-start'} mb-4`}>
      <div className={`max-w-[70%] space-y-2 ${isOwn ? 'items-end' : 'items-start'} flex flex-col`}>
        <Skeleton width={Math.random() * 200 + 150} height={60} className="rounded-2xl" />
        <Skeleton width={60} height={12} />
      </div>
    </div>
  )
}

// Chat Window Skeleton
export function ChatWindowSkeleton() {
  return (
    <div className="flex-1 overflow-y-auto p-4 space-y-4">
      <MessageSkeleton isOwn={false} />
      <MessageSkeleton isOwn={true} />
      <MessageSkeleton isOwn={false} />
      <MessageSkeleton isOwn={false} />
      <MessageSkeleton isOwn={true} />
      <MessageSkeleton isOwn={false} />
    </div>
  )
}

// Table Row Skeleton (for applicants list)
export function TableRowSkeleton() {
  return (
    <tr className="border-b border-gray-100">
      <td className="px-6 py-4">
        <div className="flex items-center gap-3">
          <Skeleton variant="circular" width={40} height={40} />
          <div className="space-y-2">
            <Skeleton width={150} height={16} />
            <Skeleton width={100} height={14} />
          </div>
        </div>
      </td>
      <td className="px-6 py-4">
        <Skeleton width={80} height={24} className="rounded-full" />
      </td>
      <td className="px-6 py-4">
        <Skeleton width={100} height={14} />
      </td>
      <td className="px-6 py-4">
        <div className="flex gap-2">
          <Skeleton width={80} height={32} className="rounded-lg" />
          <Skeleton width={80} height={32} className="rounded-lg" />
        </div>
      </td>
    </tr>
  )
}

// Dashboard Skeleton (for Player/Coach/Club dashboards during loading)
export function DashboardSkeleton() {
  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header placeholder */}
      <div className="h-16 bg-white border-b border-gray-200" />
      
      <main className="max-w-7xl mx-auto px-4 md:px-6 pt-24 pb-12">
        {/* Profile Header */}
        <div className="bg-white rounded-2xl p-6 md:p-8 shadow-sm mb-6">
          <div className="flex flex-col md:flex-row gap-6">
            {/* Avatar */}
            <Skeleton variant="circular" width={128} height={128} />
            
            {/* Info */}
            <div className="flex-1 space-y-4">
              <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4">
                <div className="space-y-3">
                  <Skeleton width={200} height={32} />
                  <div className="flex gap-2">
                    <Skeleton width={80} height={24} className="rounded-full" />
                    <Skeleton width={100} height={24} className="rounded-full" />
                  </div>
                </div>
                <div className="flex gap-2">
                  <Skeleton width={100} height={40} className="rounded-lg" />
                  <Skeleton width={100} height={40} className="rounded-lg" />
                </div>
              </div>
              
              {/* Details */}
              <div className="flex flex-wrap gap-4">
                <Skeleton width={120} height={20} />
                <Skeleton width={100} height={20} />
                <Skeleton width={140} height={20} />
              </div>
              
              {/* Bio */}
              <div className="space-y-2">
                <Skeleton width="100%" height={16} />
                <Skeleton width="80%" height={16} />
              </div>
            </div>
          </div>
        </div>
        
        {/* Tabs */}
        <div className="bg-white rounded-xl p-4 shadow-sm mb-6">
          <div className="flex gap-4">
            <Skeleton width={80} height={36} className="rounded-lg" />
            <Skeleton width={80} height={36} className="rounded-lg" />
            <Skeleton width={80} height={36} className="rounded-lg" />
            <Skeleton width={80} height={36} className="rounded-lg" />
          </div>
        </div>
        
        {/* Content area */}
        <div className="bg-white rounded-xl p-6 shadow-sm">
          <div className="space-y-4">
            <Skeleton width="60%" height={24} />
            <Skeleton width="100%" height={100} className="rounded-lg" />
            <Skeleton width="100%" height={100} className="rounded-lg" />
          </div>
        </div>
      </main>
    </div>
  )
}

// Brand Card Skeleton (for Brands directory grid)
export function BrandCardSkeleton() {
  return (
    <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
      <div className="aspect-square bg-gray-100 animate-pulse" />
      <div className="p-4 space-y-2">
        <Skeleton width="70%" height={18} />
        <Skeleton width="40%" height={14} />
      </div>
    </div>
  )
}

// Member Tile Skeleton — mirrors the live MemberTile layout (centred
// circular avatar + vertical info stack) so the load → loaded transition
// doesn't shift the grid.
export function MemberTileSkeleton() {
  return (
    <div className="bg-white rounded-2xl border border-gray-200 overflow-hidden">
      <div className="pt-5 pb-4 px-4 flex items-center justify-center">
        <div className="w-24 h-24 sm:w-28 sm:h-28 rounded-full bg-gray-100 animate-pulse" />
      </div>
      <div className="px-4 pb-4 space-y-2.5">
        <Skeleton width="80%" height={16} />
        <div className="flex gap-1.5">
          <Skeleton width={56} height={20} className="rounded-full" />
          <Skeleton width={44} height={20} className="rounded-full" />
        </div>
        <Skeleton width="60%" height={12} />
        <Skeleton width="70%" height={12} />
      </div>
    </div>
  )
}

/** @deprecated Use OpportunityCardSkeleton instead */
export const VacancyCardSkeleton = OpportunityCardSkeleton
