import { Zap } from 'lucide-react'

type AvailabilityVariant = 'play' | 'coach'
type AvailabilitySize = 'sm' | 'md'

interface AvailabilityPillProps {
  variant: AvailabilityVariant
  size?: AvailabilitySize
  className?: string
}

/**
 * AvailabilityPill - Displays availability status for players and coaches
 * 
 * Used in:
 * - Community page member cards
 * - Public profile pages
 * - Dashboard headers
 * 
 * Style:
 * - Players (Open to Play): Green gradient
 * - Coaches (Open to Coach): Purple/violet gradient
 */
export default function AvailabilityPill({ variant, size = 'md', className = '' }: AvailabilityPillProps) {
  const isPlay = variant === 'play'
  
  const gradientClass = isPlay
    ? 'bg-gradient-to-r from-emerald-400 to-green-500'
    : 'bg-gradient-to-r from-violet-500 to-purple-600'
  
  const label = isPlay ? 'Open to Play' : 'Open to Coach'
  
  const sizeClasses = size === 'sm' 
    ? 'px-2 py-0.5 text-[10px]' 
    : 'px-3 py-1 text-xs'
  
  const iconSize = size === 'sm' ? 'w-2.5 h-2.5' : 'w-3 h-3'

  return (
    <span
      className={`
        inline-flex items-center gap-1.5
        ${sizeClasses}
        rounded-full
        text-white font-medium
        ${gradientClass}
        shadow-sm
        ${className}
      `}
    >
      <Zap className={iconSize} fill="currentColor" />
      {label}
    </span>
  )
}

/**
 * Helper component that conditionally renders the appropriate pill
 * based on role and availability flags
 */
interface ConditionalAvailabilityPillProps {
  // Accepts any of the 5 HOCKIA roles. Only player + coach actually render
  // a pill (the other three return null below) but typing the union loosely
  // here lets generic profile-card components pass `profile.role` directly
  // without needing `as any` casts.
  role: 'player' | 'coach' | 'club' | 'brand' | 'umpire'
  openToPlay?: boolean
  openToCoach?: boolean
  className?: string
}

export function ConditionalAvailabilityPill({
  role,
  openToPlay,
  openToCoach,
  className = '',
}: ConditionalAvailabilityPillProps) {
  // Players with open_to_play = true
  if (role === 'player' && openToPlay) {
    return <AvailabilityPill variant="play" className={className} />
  }
  
  // Coaches with open_to_coach = true
  if (role === 'coach' && openToCoach) {
    return <AvailabilityPill variant="coach" className={className} />
  }
  
  // Clubs or inactive availability: render nothing
  return null
}
