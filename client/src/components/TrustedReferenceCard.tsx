import { type ReactNode, useMemo, useState } from 'react'
import { ShieldCheck, MessageCircle, Loader2, Quote } from 'lucide-react'
import Avatar from './Avatar'
import RoleBadge from './RoleBadge'
import { NationalityFlagsInline } from './DualNationalityDisplay'
import { cn } from '@/lib/utils'
import type { ReferenceCard, PublicReferenceCard } from '@/hooks/useTrustedReferences'

type ReferenceLike = Pick<ReferenceCard, 'id' | 'relationshipType' | 'endorsementText' | 'profile'>
  | Pick<PublicReferenceCard, 'id' | 'relationshipType' | 'endorsementText' | 'profile'>

interface TrustedReferenceCardProps {
  reference: ReferenceLike
  onMessage?: (profileId: string | null) => void
  messageLoading?: boolean
  disabled?: boolean
  className?: string
  layout?: 'grid' | 'carousel'
  endorsementFallback?: string
  secondaryAction?: ReactNode
  showShield?: boolean
  messageLabel?: string
  onOpenProfile?: (profileId: string | null, role?: string | null) => void
  /** Max characters for endorsement text before truncation. Default: 120 */
  maxEndorsementLength?: number
}

/** Character threshold for showing "Read more" */
const TRUNCATION_THRESHOLD = 120

export default function TrustedReferenceCard({
  reference,
  onMessage,
  messageLoading = false,
  disabled = false,
  className,
  layout = 'grid',
  endorsementFallback,
  secondaryAction,
  showShield = true,
  messageLabel = 'Message',
  onOpenProfile,
  maxEndorsementLength = TRUNCATION_THRESHOLD,
}: TrustedReferenceCardProps) {
  const [isExpanded, setIsExpanded] = useState(false)

  const profileName = reference.profile?.fullName ?? 'HOCKIA Member'
  const profileInitials = reference.profile?.fullName?.slice(0, 2) ?? 'PM'
  const hasNationality = Boolean(reference.profile?.nationalityCountryId)
  const profileDetails = useMemo(() => {
    const { position, currentClub, baseLocation } = reference.profile ?? {}
    // Skip position if it duplicates the relationship type (e.g. both "Head Coach")
    const showPosition = position && position.toLowerCase() !== reference.relationshipType?.toLowerCase()
    // When nationality flags are shown, skip baseLocation from the fallback chain
    if (hasNationality) return (showPosition ? position : null) || currentClub || null
    return (showPosition ? position : null) || currentClub || baseLocation || null
  }, [reference.profile, reference.relationshipType, hasNationality])

  const messageDisabled = disabled || !reference.profile?.id || messageLoading
  const isCarousel = layout === 'carousel'
  // Responsive width: leaves a visible peek of the next card on mobile
  const layoutClasses = isCarousel
    ? 'w-[calc(100vw-6rem)] min-w-[260px] max-w-[340px] flex-shrink-0 sm:w-[340px]'
    : ''
  const canNavigateProfile = Boolean(onOpenProfile && reference.profile?.id)

  const rawEndorsement = reference.endorsementText?.trim() ?? ''
  const hasEndorsement = rawEndorsement.length > 0
  const needsTruncation = rawEndorsement.length > maxEndorsementLength

  const endorsementDisplay = useMemo(() => {
    if (!hasEndorsement) return endorsementFallback ?? null
    if (isExpanded || !needsTruncation) return `"${rawEndorsement}"`
    // Truncate at word boundary
    const truncated = rawEndorsement.slice(0, maxEndorsementLength).replace(/\s+\S*$/, '')
    return `"${truncated}…"`
  }, [rawEndorsement, hasEndorsement, endorsementFallback, isExpanded, needsTruncation, maxEndorsementLength])

  const handleOpenProfile = () => {
    if (!canNavigateProfile) return
    onOpenProfile?.(reference.profile?.id ?? null, reference.profile?.role ?? undefined)
  }

  return (
    <article
      className={cn(
        // Softer gold styling - premium but not "warning box"
        'relative flex flex-col overflow-hidden rounded-2xl',
        'border border-amber-200/50 bg-gradient-to-b from-white via-white to-amber-50/30',
        'p-5 text-slate-900',
        'shadow-sm shadow-amber-100/40',
        'transition-all duration-200 hover:-translate-y-0.5 hover:shadow-md hover:shadow-amber-100/50',
        layoutClasses,
        className
      )}
    >
      {/* Subtle quote watermark - smaller and more subtle */}
      <Quote
        className="pointer-events-none absolute -right-1 -top-1 h-12 w-12 rotate-12 text-amber-100/40"
        aria-hidden
      />

      {/* Inner glow border */}
      <div className="pointer-events-none absolute inset-0 rounded-2xl border border-white/50" />

      {/* Identity block - centered vertical layout */}
      <div className="relative flex flex-col items-center text-center">
        {/* Avatar - larger, centered */}
        {canNavigateProfile ? (
          <button
            type="button"
            onClick={handleOpenProfile}
            className="flex-shrink-0 rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-emerald-500"
            aria-label={`View ${profileName}'s profile`}
          >
            <Avatar
              src={reference.profile?.avatarUrl}
              alt={profileName}
              initials={profileInitials}
              size="lg"
              className="shadow-md"
            />
          </button>
        ) : (
          <Avatar
            src={reference.profile?.avatarUrl}
            alt={profileName}
            initials={profileInitials}
            size="lg"
            className="shadow-md"
          />
        )}

        {/* Name + Shield */}
        <div className="mt-3 flex items-center gap-1.5">
          {canNavigateProfile ? (
            <button
              type="button"
              onClick={handleOpenProfile}
              className="text-base font-semibold text-slate-900 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-emerald-500"
            >
              {profileName}
            </button>
          ) : (
            <p className="text-base font-semibold text-slate-900">{profileName}</p>
          )}
          {showShield && (
            <ShieldCheck className="h-5 w-5 flex-shrink-0 text-emerald-500" aria-hidden />
          )}
        </div>

        {/* Role badge + Relationship type */}
        <div className="mt-2 flex flex-wrap items-center justify-center gap-2">
          <RoleBadge role={reference.profile?.role ?? undefined} className="px-2 py-0.5 text-[11px]" />
          <span className="text-xs font-medium text-slate-500">{reference.relationshipType}</span>
        </div>

        {/* Nationality flags (preferred) or location fallback */}
        {hasNationality ? (
          <NationalityFlagsInline
            primaryCountryId={reference.profile?.nationalityCountryId ?? null}
            secondaryCountryId={reference.profile?.nationality2CountryId ?? null}
            className="mt-1.5 text-sm text-slate-500"
          />
        ) : profileDetails ? (
          <p className="mt-1.5 truncate text-sm text-slate-500 max-w-full">{profileDetails}</p>
        ) : null}

        {/* Position / club details (shown below flags when both exist) */}
        {hasNationality && profileDetails && (
          <p className="mt-1 truncate text-xs text-slate-400 max-w-full">{profileDetails}</p>
        )}
      </div>

      {/* Endorsement Quote - only if text exists */}
      {endorsementDisplay && (
        <div className="relative mt-4 border-t border-amber-100/40 pt-3 text-center">
          <p
            className={cn(
              'text-sm leading-relaxed text-slate-600',
              !hasEndorsement && 'italic text-slate-400',
              'transition-all duration-300 ease-out'
            )}
          >
            {endorsementDisplay}
          </p>

          {/* Read more / Show less toggle */}
          {hasEndorsement && needsTruncation && (
            <button
              type="button"
              onClick={() => setIsExpanded(!isExpanded)}
              className="mt-2 text-sm font-medium text-amber-600 hover:text-amber-700 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-500 focus-visible:ring-offset-2"
            >
              {isExpanded ? 'Show less' : 'Read more'}
            </button>
          )}
        </div>
      )}

      {/* Action buttons */}
      {(secondaryAction || onMessage) && (
        <div className={cn(
          'mt-4 flex flex-wrap items-center justify-center gap-2 pt-3',
          !endorsementDisplay && 'border-t border-amber-100/40'
        )}>
          {onMessage && (
            <button
              type="button"
              onClick={() => onMessage(reference.profile?.id ?? null)}
              disabled={messageDisabled}
              className="inline-flex items-center gap-2 rounded-full bg-gradient-to-r from-emerald-500 to-emerald-600 px-4 py-2 text-sm font-semibold text-white shadow-sm shadow-emerald-500/20 transition-all hover:shadow-md hover:shadow-emerald-500/25 hover:brightness-105 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {messageLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <MessageCircle className="h-4 w-4" />}
              <span>{messageLoading ? 'Messaging…' : messageLabel}</span>
            </button>
          )}
          {secondaryAction}
        </div>
      )}
    </article>
  )
}
