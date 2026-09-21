import { useMemo, useState } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import { Check, ChevronRight, MessageCircle, UserPlus, X } from 'lucide-react'
import { BottomSheet } from '@/components/ui/BottomSheet'
import { EntityAvatar } from '@/components/ui/EntityAvatar'
import SignInPromptModal from '@/components/SignInPromptModal'
import { MediaLightbox } from '@/components/home/MediaLightbox'
import { useAuthStore } from '@/lib/auth'
import { useToastStore } from '@/lib/toast'
import { useFriendship } from '@/hooks/useFriendship'
import { inCommonLabel, useFriendsInCommon } from '@/hooks/useFriendsInCommon'
import { openRolesLabel } from '@/hooks/useOpenRoleCounts'
import { useCountries, isEuCountryCode } from '@/hooks/useCountries'
import { availabilityLabel } from '@/lib/availabilityLabel'
import { getSpecializationLabel } from '@/lib/coachSpecializations'
import { getImageUrl } from '@/lib/imageUrl'
import { humanizeToken, identityLine, isOrganisationRole } from '@/lib/identity'
import { nationalityLine } from '@/lib/nationalityLine'
import { resolveConversationRoute } from '@/lib/startConversation'
import { trackEvent, trackProtectedActionBlocked } from '@/lib/analytics'
import { logger } from '@/lib/logger'
import type { Profile } from './PeopleListView'

interface MemberPreviewSheetProps {
  member: Profile
  onClose: () => void
}

const BRAND_CATEGORY_LABELS: Record<string, string> = {
  equipment: 'Equipment', apparel: 'Apparel', accessories: 'Accessories', nutrition: 'Nutrition', technology: 'Technology',
  coaching: 'Coaching & Training', recruiting: 'Recruiting', media: 'Media', services: 'Services', other: 'Other',
}

function profileRouteFor(member: Profile): string {
  if (member.role === 'brand') return `/brands/id/${member.id}?ref=community_preview`
  if (member.role === 'club') return `/clubs/id/${member.id}?ref=community_preview`
  if (member.role === 'umpire') return `/umpires/id/${member.id}?ref=community_preview`
  if (member.role === 'coach') return `/coaches/id/${member.id}?ref=community_preview`
  return `/players/id/${member.id}?ref=community_preview`
}

/**
 * Member preview (Figma 72:316 / 221:556) — the half-sheet a Community card
 * opens for players, umpires, brands and guests. Passports · Club · Based
 * (· In common); never Evidence or Available. Tapping the photo opens the
 * Member photo viewer; See full profile opens the profile. Long names wrap
 * to two lines then truncate; the role line and buttons never move.
 * Recruiters (clubs, coaches) keep the richer preview in MemberPreviewModal.
 */
export function MemberPreviewSheet({ member, onClose }: MemberPreviewSheetProps) {
  const { user } = useAuthStore()
  const navigate = useNavigate()
  const location = useLocation()
  const addToast = useToastStore((s) => s.addToast)
  const { countries } = useCountries()
  const friendship = useFriendship(member.id)
  const inCommon = useFriendsInCommon(member.role === 'club' || member.role === 'brand' ? null : member.id)
  const [signIn, setSignIn] = useState<'view' | 'message' | 'connect' | null>(null)
  const [photoOpen, setPhotoOpen] = useState(false)
  const [sending, setSending] = useState(false)

  const isOrg = isOrganisationRole(member.role)
  const name = member.full_name?.trim() || 'HOCKIA member'
  const rawPhoto = member.role === 'brand' ? (member.brand_logo_url ?? member.avatar_url) : member.avatar_url
  const photoUrl = rawPhoto ? getImageUrl(rawPhoto, 'avatar-lg') ?? rawPhoto : null

  const positions = [member.position, member.secondary_position].filter((p): p is string => Boolean(p)).map((p) => humanizeToken(p) ?? p)
  const detail = (() => {
    switch (member.role) {
      case 'player': return positions.join(', ') || null
      case 'coach': return member.coach_specialization ? getSpecializationLabel(member.coach_specialization, member.coach_specialization_custom) : null
      case 'umpire': return member.umpire_level ?? null
      case 'club': return (member as { competition_name?: string | null }).competition_name?.trim() || null
      case 'brand': return member.brand_category ? BRAND_CATEGORY_LABELS[member.brand_category] ?? null : null
      default: return null
    }
  })()
  const availability = openRolesLabel(member.open_role_count) ?? availabilityLabel(member.role, member)

  const passports = useMemo(() => {
    const ids = [member.nationality_country_id, member.role === 'club' ? null : member.nationality2_country_id].filter((id): id is number => typeof id === 'number')
    return ids.map((id) => countries.find((c) => c.id === id)).filter((c): c is NonNullable<typeof c> => Boolean(c))
  }, [countries, member.nationality_country_id, member.nationality2_country_id, member.role])
  const passportsText = nationalityLine(passports) ?? (member.nationality?.trim() || null)
  const holdsEu = passports.some((c) => isEuCountryCode(c.code))

  const rows: { label: string; value: string; sub?: string | null; subTone?: 'positive' | 'muted' }[] = []
  if (!isOrg && passportsText) rows.push({ label: 'Passports', value: passportsText, sub: holdsEu ? 'EU passport' : null, subTone: 'positive' })
  if ((member.role === 'player' || member.role === 'coach') && member.current_club) rows.push({ label: 'Club', value: member.current_club })
  if (member.role === 'club' && member.year_founded) rows.push({ label: 'Founded', value: String(member.year_founded) })
  if (member.role === 'umpire' && member.federation) rows.push({ label: 'Federation', value: member.federation })
  if (member.base_location) rows.push({ label: 'Based', value: member.base_location })
  const commonText = inCommonLabel(inCommon.people)
  if (commonText) rows.push({ label: 'In common', value: commonText })
  if (member.role === 'brand' && member.brand_website_url) rows.push({ label: 'Website', value: member.brand_website_url.replace(/^https?:\/\//, '') })

  const requireMember = (action: 'view' | 'message' | 'connect') => {
    if (user) return true
    setSignIn(action)
    trackProtectedActionBlocked(action === 'view' ? 'view_profile' : action)
    return false
  }

  const viewProfile = () => {
    if (!requireMember('view')) return
    trackEvent({ action: 'community_preview_view_profile', category: 'community', label: member.role })
    onClose()
    navigate(profileRouteFor(member))
  }

  const message = async () => {
    if (!requireMember('message')) return
    if (user!.id === member.id) { addToast('You cannot message yourself.', 'error'); return }
    setSending(true)
    try {
      const route = await resolveConversationRoute(user!.id, member.id)
      onClose()
      navigate(route, { state: { from: location.pathname + location.search } })
    } catch (err) {
      logger.error('[MemberPreviewSheet] message failed', err)
      addToast('Could not open the conversation. Please try again.', 'error')
    } finally {
      setSending(false)
    }
  }

  const addFriend = () => {
    if (!requireMember('connect')) return
    if (friendship.isIncomingRequest) void friendship.acceptRequest()
    else if (!friendship.isFriend && !friendship.isOutgoingRequest) void friendship.sendRequest()
  }

  const friendButton = (() => {
    if (friendship.isOwnProfile || isOrg) return null
    if (friendship.isFriend) return { label: 'Friends', icon: <Check className="h-[18px] w-[18px]" strokeWidth={2.5} />, cls: 'bg-positive-soft text-positive', disabled: true }
    if (friendship.isOutgoingRequest) return { label: 'Requested', icon: <Check className="h-[18px] w-[18px]" strokeWidth={2.5} />, cls: 'bg-surface-grouped text-ink-2', disabled: true }
    if (friendship.isIncomingRequest) return { label: 'Accept', icon: <UserPlus className="h-[18px] w-[18px]" strokeWidth={2} />, cls: 'bg-hockia-primary text-white', disabled: friendship.mutating }
    return { label: 'Add friend', icon: <UserPlus className="h-[18px] w-[18px]" strokeWidth={2} />, cls: 'bg-hockia-primary text-white', disabled: friendship.mutating }
  })()

  return (
    <>
      <BottomSheet open onClose={onClose} ariaLabel={`${name} — preview`}>
        <div className="px-5 pb-3 pt-1">
          <div className="flex justify-end">
            <button type="button" onClick={onClose} aria-label="Close preview" className="-mr-2 flex h-8 w-8 items-center justify-center rounded-full text-ink-4">
              <X className="h-5 w-5" strokeWidth={2} />
            </button>
          </div>
          <div className="flex items-start gap-3.5">
            <button type="button" onClick={() => photoUrl && setPhotoOpen(true)} aria-label={photoUrl ? `Open ${name}'s photo` : undefined} className="shrink-0">
              {isOrg ? (
                <EntityAvatar src={photoUrl} name={name} role={member.role} size={96} />
              ) : photoUrl ? (
                <img src={photoUrl} alt="" className="h-24 w-24 rounded-[20px] object-cover" />
              ) : (
                <EntityAvatar src={null} name={name} role={member.role} size={96} className="rounded-[20px]" />
              )}
            </button>
            <div className="min-w-0 flex-1 pt-0.5">
              <h2 className="line-clamp-2 text-[24px] font-bold leading-[29px] text-ink-1">{name}</h2>
              <p className="mt-0.5 text-row text-ink-2">{identityLine(member.role, detail)}</p>
              {availability && <p className="mt-0.5 text-secondary font-semibold text-positive">{availability}</p>}
            </div>
          </div>

          <div className="mt-2 divide-y divide-line">
            {rows.map((r) => (
              <div key={r.label} className="flex items-start gap-3 py-2.5">
                <span className="w-24 shrink-0 text-row text-ink-2">{r.label}</span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-row text-ink-1">{r.value}</span>
                  {r.sub && <span className={`block text-secondary ${r.subTone === 'positive' ? 'text-positive' : 'text-ink-2'}`}>{r.sub}</span>}
                </span>
              </div>
            ))}
          </div>

          <button type="button" onClick={viewProfile} className="mt-1 flex items-center gap-1 py-2.5 text-row font-semibold text-hockia-primary">
            See full profile <ChevronRight className="h-4 w-4" strokeWidth={2} />
          </button>

          <div className="mt-1 flex gap-2.5">
            {friendButton && (
              <button
                type="button"
                onClick={addFriend}
                disabled={friendButton.disabled}
                className={`flex h-[50px] flex-1 items-center justify-center gap-1.5 rounded-full text-body font-semibold ${friendButton.cls} disabled:opacity-100`}
              >
                {friendButton.icon} {friendButton.label}
              </button>
            )}
            {!friendship.isOwnProfile && (
              <button
                type="button"
                onClick={() => void message()}
                disabled={sending}
                className="flex h-[50px] flex-1 items-center justify-center gap-1.5 rounded-full bg-surface-grouped text-body font-semibold text-ink-1 disabled:opacity-60"
              >
                <MessageCircle className="h-[18px] w-[18px]" strokeWidth={1.8} /> Message
              </button>
            )}
          </div>
        </div>
      </BottomSheet>

      {photoOpen && photoUrl && (
        <MediaLightbox
          images={[{ url: rawPhoto ?? photoUrl, media_type: 'image', order: 0 }]}
          initialIndex={0}
          onClose={() => setPhotoOpen(false)}
          author={{ id: member.id, name, avatarUrl: photoUrl, role: member.role, profilePath: user ? profileRouteFor(member) : null }}
        />
      )}

      <SignInPromptModal
        isOpen={signIn !== null}
        onClose={() => setSignIn(null)}
        title={signIn === 'message' ? 'Sign in to message' : signIn === 'connect' ? 'Sign in to add friends' : 'Sign in to view profile'}
        action={signIn ?? undefined}
      />
    </>
  )
}
