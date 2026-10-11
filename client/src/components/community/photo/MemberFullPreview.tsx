import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useLocation, useNavigate } from 'react-router-dom'
import { Check, ChevronDown, ChevronRight, MessageSquare, Star, UserPlus, X } from 'lucide-react'
import ProfileActionMenu from '@/components/ProfileActionMenu'
import SignInPromptModal from '@/components/SignInPromptModal'
import { ShortlistRoleSheet } from '@/components/profile/ClubViewCards'
import { useAuthStore } from '@/lib/auth'
import { useToastStore } from '@/lib/toast'
import { useFriendship } from '@/hooks/useFriendship'
import { useFriendsInCommon, type CommonFriend } from '@/hooks/useFriendsInCommon'
import { useFriendsAtClub } from '@/hooks/useFriendsAtClub'
import { useMemberPhotos } from '@/hooks/useMemberPhotos'
import { useClubViewOfPlayer } from '@/hooks/useClubViewOfPlayer'
import { useCountries, isEuCountryCode, type Country } from '@/hooks/useCountries'
import { useBodyScrollLock } from '@/hooks/useBodyScrollLock'
import { isTopFocusTrap, useFocusTrap } from '@/hooks/useFocusTrap'
import { getPlayerLeagueName } from '@/hooks/useWorldClubLogo'
import { getImageUrl } from '@/lib/imageUrl'
import { setStatusBarForBackground } from '@/lib/nativeUi'
import { isRecruitingViewer } from '@/lib/recruiterAccess'
import { resolveConversationRoute } from '@/lib/startConversation'
import { trackDbEvent } from '@/lib/trackDbEvent'
import { trackEvent, trackProtectedActionBlocked } from '@/lib/analytics'
import { logger } from '@/lib/logger'
import { fitChipLabel, type FitState } from '@/lib/clubRecruiting'
import { brandCategoryLabel, coachSpecialtyLabel, positionLabel } from '@/lib/identity'
import {
  availableLabel, CLUB_BRAND_GRADIENT, crestGradient, friendsHereLabel, friendsSinceLabel,
  inCommonCountLabel, initialsOf, rolePreviewGradient, teamLabel,
} from '@/lib/communityCard'
import pitchVertical from '@/assets/community/pitch-full-vertical.svg'
import type { Profile } from '../PeopleListView'
import { FitPill } from './FitPill'

/**
 * Member preview, full screen (Figma Community P7–P12, P16, P22–P24). Opens
 * from any Community card on the phone.
 *
 *  - Photo area: the member's photos (avatar first, then gallery / club
 *    media); tap the left or right side for the previous / next photo, the
 *    bars on top say where you are. No photo → the role colour + pitch +
 *    initials; a club without photos → its crest on its colour.
 *  - Close: the chevron, Escape, or a downward swipe on the photo.
 *  - ⋯: Share profile · Report · Block. After a block the preview closes and
 *    the grid offers Undo (P26).
 *  - Summary: three key facts per role, About in two lines, friends in
 *    common (people) / friends who play here (clubs).
 *  - One primary action, by relationship: Add friend / Request sent /
 *    Message (friends) / Accept · Decline (incoming). Clubs: See open roles
 *    while recruiting, else Message. A club or recruiting coach viewing a
 *    player or coach: Shortlist + Message (P10). Messaging that the rules
 *    refuse is shown disabled with the reason (P24).
 */
interface MemberFullPreviewProps {
  member: Profile
  onClose: () => void
  /** Server age, when known (people only). */
  age?: number | null
  /** Recruiters only: the fit for the active "Ranked for" role. */
  fit?: FitState | null
  /** The block went through: close and let the grid offer Undo. */
  onBlocked?: (member: Profile) => void
}

const PHOTO_SCRIM = 'linear-gradient(180deg, rgba(15,15,20,0.45) 0%, rgba(15,15,20,0) 18%, rgba(15,15,20,0) 55%, rgba(15,15,20,0.85) 100%)'
const GLASS_BUTTON = 'flex h-11 w-11 items-center justify-center rounded-full border border-white/20 bg-[rgba(15,15,20,0.35)] text-white backdrop-blur-[8px]'
const UNDER_18_MESSAGE = 'Under-18 accounts can’t message clubs or coaches.'

function profilePath(m: Profile): string {
  if (m.role === 'brand') return m.brand_slug ? `/brands/${m.brand_slug}?ref=community_preview` : `/brands/id/${m.id}?ref=community_preview`
  if (m.role === 'club') return `/clubs/id/${m.id}?ref=community_preview`
  if (m.role === 'umpire') return `/umpires/id/${m.id}?ref=community_preview`
  if (m.role === 'coach') return `/coaches/id/${m.id}?ref=community_preview`
  return `/players/id/${m.id}?ref=community_preview`
}

function ageFromDob(dob: string | null | undefined, now = new Date()): number | null {
  if (!dob) return null
  const d = new Date(dob)
  if (Number.isNaN(d.getTime())) return null
  let age = now.getUTCFullYear() - d.getUTCFullYear()
  const m = now.getUTCMonth() - d.getUTCMonth()
  if (m < 0 || (m === 0 && now.getUTCDate() < d.getUTCDate())) age -= 1
  return age
}

function passportText(passports: Country[]): string | null {
  if (passports.length === 0) return null
  const flags = passports.map((c) => c.flag_emoji).filter(Boolean).join(' ')
  if (passports.length === 1) return [flags, passports[0].common_name || passports[0].name].filter(Boolean).join(' ')
  return [flags, passports.some((c) => isEuCountryCode(c.code)) ? 'EU' : null].filter(Boolean).join(' ')
}

export function MemberFullPreview({ member, onClose, age = null, fit = null, onBlocked }: MemberFullPreviewProps) {
  const { user, profile: viewer } = useAuthStore()
  const navigate = useNavigate()
  const location = useLocation()
  const addToast = useToastStore((s) => s.addToast)
  const { countries } = useCountries()
  const containerRef = useRef<HTMLDivElement>(null)
  const [signIn, setSignIn] = useState<'view' | 'message' | 'connect' | null>(null)
  const [sending, setSending] = useState(false)
  const [rolePicker, setRolePicker] = useState(false)

  const isClub = member.role === 'club'
  const isBrand = member.role === 'brand'
  const isOrg = isClub || isBrand
  const isPerson = !isOrg
  const name = member.full_name?.trim() || 'HOCKIA member'
  const firstName = name.split(/\s+/)[0]

  const friendship = useFriendship(member.id)
  const inCommon = useFriendsInCommon(isPerson ? member.id : null)
  const atClub = useFriendsAtClub(isClub ? member.current_world_club_id : null)
  const recruiterView = useClubViewOfPlayer(isPerson && (member.role === 'player' || member.role === 'coach') ? member : null)
  const viewerRecruits = isRecruitingViewer(viewer)

  // Photos: the avatar first, then up to five gallery photos (clubs: their
  // media; the crest is not a photo). Brands keep their logo treatment.
  const gallery = useMemberPhotos(isBrand ? null : member.id)
  const photos = useMemo(() => {
    const list = [...(isPerson && member.avatar_url ? [member.avatar_url] : []), ...(gallery.data ?? [])]
    return [...new Set(list)]
  }, [isPerson, member.avatar_url, gallery.data])
  const [photoIndex, setPhotoIndex] = useState(0)
  const [failed, setFailed] = useState<Set<string>>(() => new Set())
  const shown = photos.filter((p) => !failed.has(p))
  const current = shown[Math.min(photoIndex, Math.max(shown.length - 1, 0))] ?? null
  useEffect(() => { setPhotoIndex(0) }, [member.id])

  // Light status-bar icons over the photo; dark again on the white app.
  useEffect(() => {
    void setStatusBarForBackground('dark-bg')
    return () => { void setStatusBarForBackground('light-bg') }
  }, [])

  useBodyScrollLock(true)
  useFocusTrap({ containerRef, isActive: signIn === null && !rolePicker })

  useEffect(() => {
    trackDbEvent('profile_preview', 'profile', member.id, { viewed_role: member.role, source: 'community' })
    trackEvent({ action: 'community_preview_open', category: 'community', label: member.role })
  }, [member.id, member.role])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || !isTopFocusTrap(containerRef.current)) return
      onClose()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])

  // Swipe down on the photo closes (the sheet follows the finger).
  const dragStart = useRef<{ x: number; y: number } | null>(null)
  const [dragY, setDragY] = useState(0)
  const [dragging, setDragging] = useState(false)
  const onTouchStart = (e: React.TouchEvent) => { dragStart.current = { x: e.touches[0].clientX, y: e.touches[0].clientY }; setDragging(true) }
  const onTouchMove = (e: React.TouchEvent) => {
    if (!dragStart.current) return
    const dy = e.touches[0].clientY - dragStart.current.y
    const dx = Math.abs(e.touches[0].clientX - dragStart.current.x)
    if (dy > 0 && dy > dx) setDragY(dy)
  }
  const onTouchEnd = () => {
    dragStart.current = null
    setDragging(false)
    if (dragY > 110) onClose()
    else setDragY(0)
  }

  const stepPhoto = (dir: 1 | -1) => {
    if (shown.length < 2) return
    setPhotoIndex((i) => Math.min(Math.max(i + dir, 0), shown.length - 1))
  }

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
    navigate(profilePath(member), { state: { from: location.pathname + location.search } })
  }

  const openRoles = () => {
    if (!requireMember('view')) return
    onClose()
    navigate(`/clubs/id/${member.id}/opportunities`, { state: { from: location.pathname + location.search } })
  }

  const message = async () => {
    if (!requireMember('message') || !user) return
    setSending(true)
    try {
      const route = await resolveConversationRoute(user.id, member.id)
      trackEvent({ action: 'community_preview_message', category: 'community', label: member.role })
      onClose()
      navigate(route, { state: { returnTo: location.pathname + location.search, messageOrigin: 'Community' } })
    } catch (err) {
      logger.error('[MemberFullPreview] message failed', err)
      addToast('Could not open the conversation. Please try again.', 'error')
    } finally {
      setSending(false)
    }
  }

  const share = useCallback(async () => {
    const url = `${window.location.origin}${profilePath(member).split('?')[0]}`
    try {
      if (typeof navigator.share === 'function') {
        await navigator.share({ title: name, url })
        return
      }
      await navigator.clipboard.writeText(url)
      addToast('Link copied', 'success')
    } catch {
      /* the member closed the share sheet */
    }
  }, [member, name, addToast])

  // ── Messaging rules (founder ruling 2026-10-06): an under-18 can't start a
  // conversation with a club or a coach who recruits, and the reverse. The
  // server has the final word; this only explains the disabled button.
  const viewerAge = ageFromDob((viewer as { date_of_birth?: string | null } | null)?.date_of_birth)
  const targetRecruits = isClub || (member.role === 'coach' && member.coach_recruits_for_team === true)
  const messageBlockedReason =
    typeof viewerAge === 'number' && viewerAge < 18 && targetRecruits ? UNDER_18_MESSAGE
      : viewerRecruits && typeof age === 'number' && age < 18 ? 'This member can’t be contacted by clubs or coaches.'
        : null

  // ── Identity lines
  const baseCountry = countries.find((c) => c.id === (member.base_country_id ?? null))
  const place = [baseCountry?.flag_emoji, member.base_location?.trim() || null].filter(Boolean).join(' ')
  const league = isClub ? (member as { competition_name?: string | null }).competition_name?.trim() || getPlayerLeagueName(member.current_world_club_id, null) : null
  const coachTeam = member.coaching_categories?.length === 1 ? teamLabel(member.coaching_categories[0]) : null
  const subParts = (() => {
    switch (member.role) {
      case 'player': return [positionLabel(member.position) ?? 'Player', teamLabel(member.playing_category)]
      case 'coach': return [coachSpecialtyLabel(member.coach_specialization, member.coach_specialization_custom) ?? 'Coach', coachTeam]
      case 'umpire': return ['Umpire', member.umpire_level]
      case 'club': return ['Club', league]
      default: return ['Brand', brandCategoryLabel(member.brand_category)]
    }
  })()
  const subLine = [...subParts, place || null].filter(Boolean).join(' · ')
  const title = isPerson && typeof age === 'number' ? `${name}, ${age}` : name

  // ── Key facts (three per role; a missing value drops its tile)
  const passports = [member.nationality_country_id, member.nationality2_country_id]
    .filter((id): id is number => typeof id === 'number')
    .map((id) => countries.find((c) => c.id === id))
    .filter((c): c is Country => Boolean(c))
  const city = member.base_location?.split(',')[0]?.trim() || null
  const facts: { label: string; value: string }[] = (() => {
    const list: { label: string; value: string | null }[] = []
    switch (member.role) {
      case 'player':
      case 'coach':
        list.push({ label: member.role === 'coach' ? 'Coaches at' : 'Plays at', value: member.current_club?.trim() || null })
        list.push({ label: 'Passport', value: passportText(passports) })
        list.push({ label: 'Available', value: availableLabel(member) })
        break
      case 'umpire':
        list.push({ label: 'Level', value: member.umpire_level?.trim() || null })
        list.push({ label: 'Passport', value: passportText(passports) })
        list.push({ label: 'Based in', value: city })
        break
      case 'club':
        list.push(league ? { label: 'League', value: league } : { label: 'Founded', value: member.year_founded ? String(member.year_founded) : null })
        list.push({ label: 'Based in', value: city })
        if (atClub.linked && user) list.push({ label: 'Friends here', value: atClub.loading ? null : String(atClub.people.length) })
        break
      default:
        list.push({ label: 'Category', value: brandCategoryLabel(member.brand_category) })
        list.push({ label: 'Based in', value: city })
    }
    return list.filter((f): f is { label: string; value: string } => Boolean(f.value))
  })()

  const about = (isClub ? member.club_bio : isBrand ? member.brand_bio : member.bio)?.trim() || null

  // ── Friends line
  const friendsPeople: CommonFriend[] = isClub ? atClub.people : inCommon.people
  const friendsText = (() => {
    if (isClub) return friendsHereLabel(atClub.people.length)
    if (friendship.isFriend) {
      const since = friendsSinceLabel(friendship.relationship?.accepted_at ?? null)
      const common = inCommon.count > 0 ? `${inCommon.count} in common` : null
      return [since, common].filter(Boolean).join(' · ') || null
    }
    return inCommonCountLabel(inCommon.count)
  })()

  // ── Actions
  const recruiterActions = recruiterView.enabled
  const fitState = fit ?? recruiterView.fit?.state ?? null
  const fitLabel = fitChipLabel(fitState)
  const fitPillText = fitLabel && recruiterView.fitRole ? `${fitLabel} for ${recruiterView.fitRole.title}` : fitLabel
  const onShortlist = () => {
    if (recruiterView.roles.length === 0) void recruiterView.shortlistDefault()
    else if (recruiterView.roles.length === 1) void recruiterView.shortlistForRole(recruiterView.roles[0])
    else setRolePicker(true)
  }

  const primary = 'flex h-[52px] min-w-0 flex-1 items-center justify-center gap-2 rounded-full bg-hockia-primary px-4 text-[16px] font-semibold text-white transition-opacity active:opacity-80 disabled:opacity-60'
  const secondary = 'flex h-[52px] min-w-0 flex-1 items-center justify-center gap-2 rounded-full border-[1.5px] border-line bg-white px-4 text-[16px] font-semibold text-ink-1 transition-colors active:bg-surface-muted disabled:text-ink-4'
  const muted = 'flex h-[52px] min-w-0 flex-1 items-center justify-center gap-2 rounded-full bg-surface-muted px-4 text-[16px] font-semibold text-ink-2'

  const messageButton = (variant: 'primary' | 'secondary') => (
    <button
      type="button"
      onClick={() => void message()}
      disabled={sending || Boolean(messageBlockedReason)}
      aria-describedby={messageBlockedReason ? 'member-preview-message-note' : undefined}
      className={variant === 'primary' && !messageBlockedReason ? primary : secondary}
      data-testid="member-preview-message"
    >
      <MessageSquare className="h-5 w-5" strokeWidth={1.8} aria-hidden="true" /> Message
    </button>
  )

  const actions = (() => {
    if (friendship.isOwnProfile) return null
    if (isClub) {
      return (member.open_role_count ?? 0) > 0 ? (
        <>
          <button type="button" onClick={openRoles} className={primary} data-testid="member-preview-open-roles">See open roles</button>
          {messageButton('secondary')}
        </>
      ) : messageButton('primary')
    }
    if (isBrand) return messageButton('primary')
    if (recruiterActions) {
      return (
        <>
          {recruiterView.shortlisted ? (
            <button type="button" disabled className={muted} data-testid="member-preview-shortlist">
              <Check className="h-5 w-5" strokeWidth={2.4} aria-hidden="true" /> Shortlisted
            </button>
          ) : (
            <button type="button" onClick={onShortlist} disabled={recruiterView.busy} className={primary} data-testid="member-preview-shortlist">
              <Star className="h-5 w-5" strokeWidth={1.8} aria-hidden="true" /> Shortlist
            </button>
          )}
          {messageButton('secondary')}
        </>
      )
    }
    if (friendship.isIncomingRequest) {
      return (
        <>
          <button type="button" onClick={() => void friendship.acceptRequest()} disabled={friendship.mutating} className={primary} data-testid="member-preview-friend">
            <Check className="h-5 w-5" strokeWidth={2.4} aria-hidden="true" /> Accept
          </button>
          <button type="button" onClick={() => void friendship.rejectRequest()} disabled={friendship.mutating} className={secondary} data-testid="member-preview-decline">
            <X className="h-5 w-5" strokeWidth={2} aria-hidden="true" /> Decline
          </button>
          <button
            type="button"
            onClick={() => void message()}
            disabled={sending || Boolean(messageBlockedReason)}
            aria-label="Message"
            className="flex h-[52px] w-[52px] shrink-0 items-center justify-center rounded-full border-[1.5px] border-line bg-white text-ink-1 disabled:text-ink-4"
            data-testid="member-preview-message"
          >
            <MessageSquare className="h-5 w-5" strokeWidth={1.8} aria-hidden="true" />
          </button>
        </>
      )
    }
    if (friendship.isFriend) {
      return (
        <>
          {messageButton('primary')}
          <button type="button" disabled className={`${secondary} disabled:text-ink-1`} data-testid="member-preview-friend">
            <Check className="h-5 w-5" strokeWidth={2.4} aria-hidden="true" /> Friends
          </button>
        </>
      )
    }
    if (friendship.isOutgoingRequest) {
      return (
        <>
          <button type="button" disabled className={muted} data-testid="member-preview-friend">
            <Check className="h-5 w-5" strokeWidth={2.4} aria-hidden="true" /> Request sent
          </button>
          {messageButton('primary')}
        </>
      )
    }
    return (
      <>
        <button
          type="button"
          onClick={() => { if (requireMember('connect')) void friendship.sendRequest() }}
          disabled={friendship.mutating || friendship.loading}
          className={primary}
          data-testid="member-preview-friend"
        >
          <UserPlus className="h-5 w-5" strokeWidth={1.8} aria-hidden="true" /> Add friend
        </button>
        {messageButton('secondary')}
      </>
    )
  })()

  // ── Photo area background when there is no photo to show
  const crest = isClub && member.avatar_url ? getImageUrl(member.avatar_url, 'avatar-xl') ?? member.avatar_url : null
  const noPhotoBackground = isClub
    ? (crest ? crestGradient((member as { crest_color?: string | null }).crest_color ?? null) : CLUB_BRAND_GRADIENT)
    : rolePreviewGradient(member.role)
  const brandLogo = isBrand ? member.brand_logo_url ?? member.avatar_url : null

  const overlay = (
    <div
      ref={containerRef}
      role="dialog"
      aria-modal="true"
      aria-label={`${name} — preview`}
      tabIndex={-1}
      data-testid="member-preview"
      className="fixed inset-0 z-50 flex flex-col overflow-hidden bg-white animate-slide-in-up"
      style={{ transform: dragY > 0 ? `translateY(${dragY}px)` : undefined, transition: dragging ? 'none' : 'transform 0.2s ease-out' }}
    >
      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
        {/* Photo area */}
        <div
          className="relative h-[min(520px,61dvh)] w-full overflow-hidden"
          style={current ? undefined : { backgroundImage: noPhotoBackground }}
          onTouchStart={onTouchStart}
          onTouchMove={onTouchMove}
          onTouchEnd={onTouchEnd}
          onTouchCancel={onTouchEnd}
        >
          {current ? (
            <>
              <img
                key={current}
                src={getImageUrl(current, 'lightbox') ?? current}
                alt=""
                className="absolute inset-0 h-full w-full object-cover"
                decoding="async"
                onError={() => setFailed((s) => new Set(s).add(current))}
              />
              <span aria-hidden="true" className="absolute inset-0" style={{ backgroundImage: PHOTO_SCRIM }} />
            </>
          ) : (
            <span aria-hidden="true" className="absolute inset-0">
              <img src={pitchVertical} alt="" className="absolute inset-0 h-full w-full" />
              {isClub && crest ? (
                <img src={crest} alt="" className="absolute left-1/2 top-[29%] h-[150px] w-[150px] -translate-x-1/2 object-contain drop-shadow-[0_10px_24px_rgba(0,0,0,0.3)]" />
              ) : brandLogo ? (
                <span className="absolute left-1/2 top-[33%] flex h-[140px] w-[140px] -translate-x-1/2 items-center justify-center overflow-hidden rounded-[28px] bg-white p-4">
                  <img src={getImageUrl(brandLogo, 'avatar-lg') ?? brandLogo} alt="" className="h-full w-full object-contain" />
                </span>
              ) : (
                <span className="absolute left-1/2 top-[33%] flex h-[140px] w-[140px] -translate-x-1/2 items-center justify-center rounded-full border-[1.5px] border-white/40 bg-white/[0.14] text-[52px] font-bold text-white">
                  {initialsOf(name)}
                </span>
              )}
            </span>
          )}

          {/* Tap left / right for the previous / next photo */}
          {shown.length > 1 && (
            <>
              <button type="button" aria-label="Previous photo" onClick={() => stepPhoto(-1)} className="absolute inset-y-0 left-0 w-1/3" />
              <button type="button" aria-label="Next photo" onClick={() => stepPhoto(1)} className="absolute inset-y-0 right-0 w-1/3" />
              <div aria-hidden="true" className="absolute inset-x-4 top-[calc(env(safe-area-inset-top)+3px)] flex gap-1">
                {shown.map((p, i) => (
                  <span key={p} className={`h-[3px] flex-1 rounded-[2px] ${i === photoIndex ? 'bg-white' : 'bg-white/40'}`} />
                ))}
              </div>
            </>
          )}

          <div className="absolute inset-x-4 top-[calc(env(safe-area-inset-top)+17px)] flex items-center justify-between">
            <button type="button" onClick={onClose} aria-label="Close preview" className={GLASS_BUTTON} data-testid="member-preview-close">
              <ChevronDown className="h-[22px] w-[22px]" strokeWidth={2} />
            </button>
            {user && !friendship.isOwnProfile && (
              <ProfileActionMenu
                targetId={member.id}
                targetName={name}
                actionName={firstName}
                leadingItems={[{ key: 'share', label: 'Share profile', onSelect: () => void share() }]}
                onBlocked={() => { onClose(); onBlocked?.(member) }}
                triggerClassName={GLASS_BUTTON}
                iconClassName="h-[22px] w-[22px] text-white"
              />
            )}
          </div>

          {/* Identity */}
          <div className="pointer-events-none absolute inset-x-5 bottom-[calc(24px+18px)] flex flex-col items-start gap-1.5">
            {isClub && current && crest && (
              <span className="mb-0.5 flex h-14 w-14 items-center justify-center overflow-hidden rounded-[16px] bg-white p-[5px]">
                <img src={crest} alt="" className="h-full w-full object-contain" />
              </span>
            )}
            {fitPillText && fitState && <FitPill state={fitState} label={fitPillText} />}
            {!fitPillText && friendship.isIncomingRequest && !recruiterActions && (
              <span className="inline-flex items-center gap-1.5 rounded-full bg-[rgba(15,15,20,0.55)] px-2.5 py-[5px] backdrop-blur-[6px]">
                <span className="h-[7px] w-[7px] rounded-full bg-[#b79cff]" aria-hidden="true" />
                <span className="text-[12px] font-semibold leading-4 text-white">Sent you a friend request</span>
              </span>
            )}
            <h2 className="line-clamp-2 text-[28px] font-bold leading-[34px] tracking-[-0.01em] text-white">{title}</h2>
            {subLine && <p className="line-clamp-2 text-[15px] leading-5 text-white/[0.88]">{subLine}</p>}
          </div>
        </div>

        {/* Summary panel */}
        <div className="relative -mt-6 flex flex-col gap-5 rounded-t-[28px] bg-white px-5 pb-6 pt-5">
          <div aria-hidden="true" className="flex justify-center">
            <span className="h-[5px] w-9 rounded-[3px] bg-line" />
          </div>
          {facts.length > 0 && (
            <div className="flex gap-2" data-testid="member-preview-rows">
              {facts.map((f) => (
                <div key={f.label} className="flex min-w-0 flex-1 flex-col gap-0.5 rounded-[14px] bg-surface-muted px-3 py-2.5">
                  <span className="truncate text-[11px] font-semibold uppercase leading-[14px] text-ink-3">{f.label}</span>
                  <span className="truncate text-[14px] font-semibold leading-[19px] text-ink-1">{f.value}</span>
                </div>
              ))}
            </div>
          )}
          {about && <p className="line-clamp-2 whitespace-pre-line text-[15px] leading-5 text-ink-2">{about}</p>}
          {friendsText && (
            <div className="flex items-center gap-2.5">
              {friendsPeople.length > 0 && (
                <span aria-hidden="true" className="flex shrink-0">
                  {friendsPeople.slice(0, 3).map((p, i) => (
                    <span key={p.id} className={`h-[26px] w-[26px] overflow-hidden rounded-full bg-surface-muted ring-2 ring-white ${i > 0 ? '-ml-2' : ''}`}>
                      {p.avatarUrl ? (
                        <img src={getImageUrl(p.avatarUrl, 'avatar-sm') ?? p.avatarUrl} alt="" className="h-full w-full object-cover" loading="lazy" />
                      ) : (
                        <span className="flex h-full w-full items-center justify-center text-[10px] font-semibold text-ink-2">{initialsOf(p.fullName)}</span>
                      )}
                    </span>
                  ))}
                </span>
              )}
              <p className="min-w-0 truncate text-[13px] leading-[18px] text-ink-2">{friendsText}</p>
            </div>
          )}
        </div>
      </div>

      {/* Action bar */}
      <div className="shrink-0 border-t border-line bg-white px-5 pb-[max(env(safe-area-inset-bottom),12px)] pt-3.5">
        {actions && <div className="flex gap-2.5">{actions}</div>}
        {messageBlockedReason && (
          <p id="member-preview-message-note" className="mt-2 text-center text-[13px] leading-[18px] text-ink-2">{messageBlockedReason}</p>
        )}
        <button
          type="button"
          onClick={viewProfile}
          className="mx-auto mt-1.5 flex min-h-[44px] items-center gap-1 px-2 text-[14px] font-semibold text-hockia-primary"
          data-testid="member-preview-full-profile"
        >
          See full profile <ChevronRight className="h-4 w-4" strokeWidth={2} aria-hidden="true" />
        </button>
      </div>

      {recruiterActions && (
        <ShortlistRoleSheet
          open={rolePicker}
          roles={recruiterView.roles}
          shortlistedRoleIds={recruiterView.shortlistedRoleIds}
          appliedRoleId={recruiterView.application?.role.id ?? null}
          onPick={(role) => { setRolePicker(false); void recruiterView.shortlistForRole(role) }}
          onClose={() => setRolePicker(false)}
        />
      )}
      <SignInPromptModal
        isOpen={signIn !== null}
        onClose={() => setSignIn(null)}
        title={signIn === 'message' ? 'Sign in to message' : signIn === 'connect' ? 'Sign in to add friends' : 'Sign in to view profile'}
        action={signIn ?? undefined}
      />
    </div>
  )

  return createPortal(overlay, document.body)
}

export default MemberFullPreview
