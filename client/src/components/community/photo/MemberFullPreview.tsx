import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { LogoTile } from './LogoTile'
import { createPortal } from 'react-dom'
import { useLocation, useNavigate } from 'react-router-dom'
import { ArrowLeft, Check, ChevronDown, ChevronLeft, ChevronRight, MessageSquare, Star, UserPlus, Users, X } from 'lucide-react'
import ProfileActionMenu from '@/components/ProfileActionMenu'
import SignInPromptModal from '@/components/SignInPromptModal'
import { ShortlistRoleSheet } from '@/components/profile/ClubViewCards'
import { useAuthStore } from '@/lib/auth'
import { useToastStore } from '@/lib/toast'
import { useFriendship } from '@/hooks/useFriendship'
import type { CommonFriend } from '@/hooks/useFriendsInCommon'
import { prefetchFriendsInCommon, useFriendsInCommonSummary } from '@/hooks/useFriendsInCommonBatch'
import { useFriendsAtClub } from '@/hooks/useFriendsAtClub'
import { prefetchMemberPhotos, useMemberPhotos } from '@/hooks/useMemberPhotos'
import { useMemberAges } from '@/hooks/useMemberAges'
import { useClubCrestColors } from '@/hooks/useClubCrestColors'
import { useClubViewOfPlayer } from '@/hooks/useClubViewOfPlayer'
import { useCountries, isEuCountryCode, type Country } from '@/hooks/useCountries'
import { useBodyScrollLock } from '@/hooks/useBodyScrollLock'
import { isTopFocusTrap, useFocusTrap } from '@/hooks/useFocusTrap'
import { getPlayerLeagueName } from '@/hooks/useWorldClubLogo'
import { getImageUrl } from '@/lib/imageUrl'
import { setStatusBarForBackground } from '@/lib/nativeUi'
import { hapticLight, hapticSelection } from '@/lib/haptics'
import { useSquircle } from '@/lib/squircle'
import { isRecruitingViewer } from '@/lib/recruiterAccess'
import { resolveConversationRoute } from '@/lib/startConversation'
import { trackDbEvent } from '@/lib/trackDbEvent'
import { trackEvent, trackProtectedActionBlocked } from '@/lib/analytics'
import { logger } from '@/lib/logger'
import { fitChipLabel, type FitState } from '@/lib/clubRecruiting'
import { brandCategoryLabel, coachSpecialtyLabel, positionLabel } from '@/lib/identity'
import {
  availableLabel, CLUB_BRAND_GRADIENT, displayPlace, placeLabel, PHOTO_SCRIM, GLASS, PRESS, LIGHT_SHADOW, crestGradient, friendsHereLabel, friendsSinceLabel,
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
  /** Clubs: the crest colour for a club without photos (Cover=Crest). */
  crestColor?: string | null
  /** The block went through: close and let the grid offer Undo. */
  onBlocked?: (member: Profile) => void
}

const GLASS_BUTTON = `flex h-11 w-11 items-center justify-center rounded-full border border-white/20 bg-[rgba(15,15,20,0.35)] text-white ${GLASS} ${PRESS}`
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

interface MemberPreviewBodyProps extends MemberFullPreviewProps {
  /** Inside a deck card: no safe-area offsets (the card sits below the status bar). */
  framed?: boolean
  /** A sheet or prompt opened on top: the shell pauses its focus trap. */
  onNestedModal?: (open: boolean) => void
}

/** The preview's content — photo area, summary panel and action bar — for one member. */
function MemberPreviewBody({ member, onClose, age: ageProp = null, fit = null, crestColor: crestProp = null, onBlocked, framed = false, onNestedModal }: MemberPreviewBodyProps) {
  const { user, profile: viewer } = useAuthStore()
  const navigate = useNavigate()
  const location = useLocation()
  const addToast = useToastStore((s) => s.addToast)
  const { countries } = useCountries()
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
  const inCommon = useFriendsInCommonSummary(isPerson ? member.id : null)
  const atClub = useFriendsAtClub(isClub ? member.current_world_club_id : null)
  const recruiterView = useClubViewOfPlayer(isPerson && (member.role === 'player' || member.role === 'coach') ? member : null)
  const viewerRecruits = isRecruitingViewer(viewer)
  // A deck can reach members the grid hasn't loaded yet: read what's missing.
  const fetchedAges = useMemberAges(ageProp == null && isPerson ? [member.id] : [])
  const age = ageProp ?? fetchedAges.get(member.id) ?? null
  const fetchedCrest = useClubCrestColors(crestProp == null && isClub ? [member] : [])
  const crestColor = crestProp ?? fetchedCrest.get(member.id) ?? null

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

  useEffect(() => { onNestedModal?.(signIn !== null || rolePicker) }, [signIn, rolePicker, onNestedModal])
  // Continuous top corners on the summary panel (finish pass).
  const panelRef = useRef<HTMLDivElement>(null)
  useSquircle(panelRef, { tl: 28, tr: 28 })

  useEffect(() => {
    trackDbEvent('profile_preview', 'profile', member.id, { viewed_role: member.role, source: 'community' })
    trackEvent({ action: 'community_preview_open', category: 'community', label: member.role })
  }, [member.id, member.role])

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
    void hapticLight()
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
  const where = displayPlace(member.base_location, member.base_country_id, countries)
  const place = placeLabel(where, true)
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
  const city = where.city ?? where.country
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
    void hapticLight()
    if (recruiterView.roles.length === 0) void recruiterView.shortlistDefault()
    else if (recruiterView.roles.length === 1) void recruiterView.shortlistForRole(recruiterView.roles[0])
    else setRolePicker(true)
  }

  // Inside the narrower deck card the labels stay on one line ("See open roles").
  // Deck card (Figma correction 2026-10-11): real type sizes, buttons 48 high.
  const btnSize = framed ? 'h-12 gap-1.5 px-2.5 text-[15px]' : 'h-[52px] gap-2 px-4 text-[16px]'
  const primary = `flex min-w-0 flex-1 items-center justify-center whitespace-nowrap rounded-full bg-hockia-primary ${btnSize} font-semibold text-white ${PRESS} disabled:opacity-60`
  const secondary = `flex min-w-0 flex-1 items-center justify-center whitespace-nowrap rounded-full border-[1.5px] border-line bg-white ${btnSize} font-semibold text-ink-1 ${PRESS} active:bg-surface-muted disabled:text-ink-4`
  const muted = `flex min-w-0 flex-1 items-center justify-center whitespace-nowrap rounded-full bg-surface-muted ${btnSize} font-semibold text-ink-2`

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
            className={`flex shrink-0 items-center justify-center rounded-full border-[1.5px] ${framed ? 'h-12 w-12' : 'h-[52px] w-[52px]'} border-line bg-white text-ink-1 disabled:text-ink-4`}
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
          onClick={() => { if (requireMember('connect')) { void hapticLight(); void friendship.sendRequest() } }}
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
    ? (crest ? crestGradient(crestColor) : CLUB_BRAND_GRADIENT)
    : rolePreviewGradient(member.role)
  const brandLogo = isBrand ? member.brand_logo_url ?? member.avatar_url : null

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden bg-white" data-member-id={member.id}>
      <div data-preview-scroll="" className="flex min-h-0 flex-1 flex-col overflow-y-auto overscroll-contain">
        {/* Photo area */}
        <div
          className={`relative w-full shrink-0 grow overflow-hidden ${framed ? 'min-h-[min(410px,52dvh)]' : 'min-h-[min(520px,61dvh)]'}`}
          style={current ? undefined : { backgroundImage: noPhotoBackground }}
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
                // Clubs: a small media upload (often the logo) goes blurry at
                // this size; below the spec's 600 px it is skipped, like the card.
                onLoad={(e) => { if (isClub && e.currentTarget.naturalWidth > 0 && e.currentTarget.naturalWidth < 600) setFailed((s) => new Set(s).add(current)) }}
              />
              <span aria-hidden="true" className="absolute inset-0" style={{ backgroundImage: PHOTO_SCRIM }} />
            </>
          ) : (
            <span aria-hidden="true" className="absolute inset-0">
              <img src={pitchVertical} alt="" className="absolute inset-0 h-full w-full" />
              {isClub && crest ? (
                <LogoTile src={crest} name={name} eager className={`absolute left-1/2 top-[29%] h-[150px] w-[150px] -translate-x-1/2 rounded-[32px] p-3.5 ${LIGHT_SHADOW}`} initialsClassName="text-[44px]" />
              ) : brandLogo ? (
                <LogoTile src={getImageUrl(brandLogo, 'avatar-lg') ?? brandLogo} name={name} eager className="absolute left-1/2 top-[33%] h-[140px] w-[140px] -translate-x-1/2 rounded-[28px] p-4" initialsClassName="text-[40px]" />
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
              <div aria-hidden="true" className={`absolute inset-x-4 flex gap-1 ${framed ? 'top-3' : 'top-[calc(env(safe-area-inset-top)+3px)]'}`}>
                {shown.map((p, i) => (
                  <span key={p} className={`h-[3px] flex-1 rounded-[2px] ${i === photoIndex ? 'bg-white' : 'bg-white/40'}`} />
                ))}
              </div>
            </>
          )}

          <div className={`absolute inset-x-4 flex items-center justify-between ${framed ? 'top-6' : 'top-[calc(env(safe-area-inset-top)+17px)]'}`}>
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
              <LogoTile src={crest} name={name} eager className="mb-0.5 h-14 w-14 rounded-[16px] p-[5px]" initialsClassName="text-[18px]" />
            )}
            {fitPillText && fitState && <FitPill state={fitState} label={fitPillText} />}
            {!fitPillText && friendship.isIncomingRequest && !recruiterActions && (
              <span className={`inline-flex items-center gap-1.5 rounded-full bg-[rgba(15,15,20,0.55)] px-2.5 py-[5px] ${GLASS}`}>
                <span className="h-[7px] w-[7px] rounded-full bg-[#b79cff]" aria-hidden="true" />
                <span className="text-[12px] font-semibold leading-4 text-white">Sent you a friend request</span>
              </span>
            )}
            <h2 className="line-clamp-2 text-[28px] font-bold leading-[34px] tracking-[-0.01em] text-white">{title}</h2>
            {subLine && <p className="line-clamp-2 text-[15px] leading-5 text-white/[0.88]">{subLine}</p>}
          </div>
        </div>

        {/* Summary panel */}
        <div ref={panelRef} className="relative -mt-6 flex shrink-0 flex-col gap-5 rounded-t-[28px] bg-white px-5 pb-6 pt-5">
          <div aria-hidden="true" className="flex justify-center">
            <span className="h-[5px] w-9 rounded-[3px] bg-line" />
          </div>
          {facts.length > 0 && (
            // Narrow deck cards (< 360 pt, Figma sizing audit): the first fact
            // on its own row, the other two side by side — no mid-word breaks.
            <div className={framed && facts.length === 3 ? 'grid grid-cols-2 gap-2' : 'flex gap-2'} data-testid="member-preview-rows">
              {facts.map((f, i) => (
                <div key={f.label} className={`flex min-w-0 flex-1 flex-col gap-0.5 rounded-[12px] bg-surface-muted px-3 py-2.5 ${framed && facts.length === 3 && i === 0 ? 'col-span-2' : ''}`}>
                  <span className="line-clamp-2 break-words text-[11px] font-semibold uppercase leading-[14px] text-ink-3">{f.label}</span>
                  <span className="line-clamp-2 break-words text-[14px] font-semibold leading-[19px] text-ink-1">{f.value}</span>
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
      <div className={`shrink-0 border-t border-line bg-white px-5 pt-3.5 ${framed ? 'pb-2' : 'pb-[max(env(safe-area-inset-bottom),12px)]'}`}>
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
}

// ─────────────────────────────────────────────────────────────────────────────
// Shell: the full-screen sheet (one member) or the swipe deck (Figma P18–P21).

export interface MemberPreviewDeck {
  /** The list to swipe through, in grid order. */
  members: Profile[]
  startIndex: number
  /** "All members · Newest" — what the list is (P18 top label). */
  contextLabel: string
  ageOf?: (id: string) => number | null
  fitOf?: (id: string) => FitState | null
  crestOf?: (id: string) => string | null
  /** End of list (P21) → open the filters. */
  onAdjustFilters?: () => void
}

const DECK_HINT_KEY = 'hockia.community.deckHintSeen'
const SWIPE_DISTANCE = 80
const prefersReducedMotion = () =>
  typeof window !== 'undefined' && typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches

/**
 * One member: full screen (P7). A list: the deck (P18) — the member on a
 * 310 pt card, the neighbours peeking at 94 %, a "‹ 3 of N ›" pager. Swipe
 * sideways for the next / previous member, down to close. First open per
 * device nudges the card 40 pt with "Swipe for the next member" (P20). Past
 * the last member: "You've seen everyone" (P21). Reduce Motion: cross-fade.
 */
export function MemberFullPreview(props: MemberFullPreviewProps & { deck?: MemberPreviewDeck }) {
  const { deck, onClose, onBlocked } = props
  const containerRef = useRef<HTMLDivElement>(null)
  const [nested, setNested] = useState(false)
  const reduce = useMemo(prefersReducedMotion, [])
  const single = props.member
  const members = useMemo(() => deck?.members ?? [single], [deck?.members, single])
  const [index, setIndex] = useState(() => Math.min(Math.max(deck?.startIndex ?? 0, 0), Math.max(members.length - 1, 0)))
  const atEnd = Boolean(deck) && index >= members.length
  const member = atEnd ? null : members[index] ?? props.member

  // Light status-bar icons over the photo / dark deck; dark again on the white app.
  useEffect(() => {
    void setStatusBarForBackground('dark-bg')
    return () => { void setStatusBarForBackground('light-bg') }
  }, [])
  useBodyScrollLock(true)
  useFocusTrap({ containerRef, isActive: !nested })
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!isTopFocusTrap(containerRef.current)) return
      if (e.key === 'Escape') onClose()
      if (deck && e.key === 'ArrowRight') go(1)
      if (deck && e.key === 'ArrowLeft') go(-1)
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  })

  // Warm the neighbours' photos so a swipe lands on a loaded card.
  useEffect(() => {
    if (!deck) return
    const near = [members[index - 1], members[index + 1], members[index + 2]].filter((m): m is Profile => Boolean(m))
    void prefetchMemberPhotos(near.map((m) => m.id))
    void prefetchFriendsInCommon(near.filter((m) => m.role !== 'club' && m.role !== 'brand').map((m) => m.id))
  }, [deck, index, members])

  // ── Gestures: sideways = members (deck), down = close.
  const [hint, setHint] = useState(false)
  const hintTimers = useRef<number[]>([])
  const stopHint = useCallback(() => {
    hintTimers.current.forEach((t) => window.clearTimeout(t))
    hintTimers.current = []
    setHint(false)
  }, [])
  const start = useRef<{ x: number; y: number; axis: 'x' | 'y' | null } | null>(null)
  const moved = useRef(false)
  const [dx, setDx] = useState(0)
  const [dy, setDy] = useState(0)
  const [animating, setAnimating] = useState(false)
  const cardWidth = typeof window !== 'undefined' ? Math.min(310, window.innerWidth - 83) : 310

  const go = useCallback((dir: 1 | -1) => {
    if (!deck || animating) return
    const next = index + dir
    if (next < 0 || next > members.length) return
    trackEvent({ action: 'community_deck_swipe', category: 'community', label: dir > 0 ? 'next' : 'previous' })
    void hapticSelection()
    stopHint()
    if (reduce) { setIndex(next); return }
    setAnimating(true)
    setDx(-dir * (cardWidth + 10))
    window.setTimeout(() => {
      setIndex(next)
      setAnimating(false)
      setDx(0)
    }, 220)
  }, [deck, animating, index, members.length, reduce, cardWidth, stopHint])

  const onTouchStart = (e: React.TouchEvent) => {
    if (animating) return
    start.current = { x: e.touches[0].clientX, y: e.touches[0].clientY, axis: null }
    moved.current = false
  }
  const onTouchMove = (e: React.TouchEvent) => {
    const s0 = start.current
    if (!s0) return
    const mx = e.touches[0].clientX - s0.x
    const my = e.touches[0].clientY - s0.y
    if (!s0.axis) {
      if (Math.abs(mx) < 8 && Math.abs(my) < 8) return
      const scroller = (e.target as HTMLElement).closest('[data-preview-scroll]') as HTMLElement | null
      if (Math.abs(mx) > Math.abs(my) && deck) s0.axis = 'x'
      else if (my > 0 && (!scroller || scroller.scrollTop <= 0)) s0.axis = 'y'
      else { start.current = null; return }
    }
    moved.current = true
    if (hintTimers.current.length > 0) stopHint()
    if (s0.axis === 'x') {
      // Resist past the first member.
      const edge = (index === 0 && mx > 0) || (atEnd && mx < 0)
      setDx(edge ? mx / 3 : mx)
    } else setDy(Math.max(0, my))
  }
  const onTouchEnd = () => {
    const s0 = start.current
    start.current = null
    if (!s0?.axis) return
    if (s0.axis === 'x') {
      if (dx <= -SWIPE_DISTANCE && !atEnd) go(1)
      else if (dx >= SWIPE_DISTANCE && index > 0) go(-1)
      else setDx(0)
    } else if (dy > 110) onClose()
    else setDy(0)
  }
  // A swipe that started on a tap zone must not also step the photo.
  const onClickCapture = (e: React.MouseEvent) => {
    if (moved.current) { e.stopPropagation(); e.preventDefault(); moved.current = false }
  }

  // ── First-open nudge (P20), once per device.
  useEffect(() => {
    if (!deck || members.length < 2) return
    let seen = false
    try { seen = window.localStorage.getItem(DECK_HINT_KEY) === '1' } catch { /* private mode */ }
    if (seen) return
    try { window.localStorage.setItem(DECK_HINT_KEY, '1') } catch { /* private mode */ }
    setHint(true)
    hintTimers.current = reduce
      ? [window.setTimeout(() => setHint(false), 2600)]
      : [
          window.setTimeout(() => setDx(-40), 500),
          window.setTimeout(() => setDx(0), 500 + 250 + 300),
          window.setTimeout(() => { hintTimers.current = []; setHint(false) }, 2800),
        ]
    return stopHint
  }, [deck, members.length, reduce, stopHint])

  const dragging = start.current?.axis != null
  const body = member ? (
    <MemberPreviewBody
      key={member.id}
      member={member}
      onClose={onClose}
      age={deck?.ageOf?.(member.id) ?? props.age ?? null}
      fit={deck?.fitOf?.(member.id) ?? props.fit ?? null}
      crestColor={deck?.crestOf?.(member.id) ?? props.crestColor ?? null}
      onBlocked={onBlocked}
      framed={Boolean(deck)}
      onNestedModal={setNested}
    />
  ) : null

  const overlay = deck ? (
    <div
      ref={containerRef}
      role="dialog"
      aria-modal="true"
      aria-label={member ? `${member.full_name?.trim() || 'Member'} — preview, ${index + 1} of ${members.length}` : 'End of the list'}
      tabIndex={-1}
      data-testid="member-preview"
      className="fixed inset-0 z-50 flex flex-col items-center overflow-hidden bg-surface-inverse animate-fade-in"
      style={{ transform: dy > 0 ? `translateY(${dy}px)` : undefined, transition: dragging ? 'none' : 'transform 0.2s ease-out' }}
    >
      <p className="shrink-0 pt-[calc(env(safe-area-inset-top)+3px)] text-[13px] font-semibold leading-[18px] text-white/60" data-testid="member-deck-context">{deck.contextLabel}</p>

      <div className="relative mt-1.5 min-h-0 w-full flex-1" onTouchStart={onTouchStart} onTouchMove={onTouchMove} onTouchEnd={onTouchEnd} onTouchCancel={onTouchEnd} onClickCapture={onClickCapture}>
        {/* Neighbours peeking (94 %), and the active card */}
        <div
          className="absolute inset-y-0 left-1/2"
          style={{ width: cardWidth, marginLeft: -cardWidth / 2, transform: `translateX(${dx}px)`, transition: dragging ? 'none' : `transform ${hint && dx !== 0 ? 0.25 : 0.22}s ${dx === 0 && hint ? 'cubic-bezier(0.34,1.56,0.64,1)' : 'ease-out'}` }}
        >
          {index > 0 && <PeekCard member={members[index - 1]} side="left" width={cardWidth} />}
          {index + 1 < members.length ? <PeekCard member={members[index + 1]} side="right" width={cardWidth} /> : index < members.length && <PeekEnd side="right" width={cardWidth} />}
          <DeckCard animateIn={reduce} key={reduce ? index : 'card'}>
            {body ?? <DeckEnd onAdjustFilters={() => { onClose(); deck.onAdjustFilters?.() }} onBack={onClose} />}
          </DeckCard>
        </div>
        {hint && (
          <div className="pointer-events-none absolute left-1/2 top-[30%] z-10 flex -translate-x-1/2 items-center gap-2 rounded-full bg-white px-4 py-2.5 shadow-lg animate-fade-in" role="status">
            <ArrowLeft className="h-4 w-4 text-hockia-primary" strokeWidth={2.2} aria-hidden="true" />
            <span className="whitespace-nowrap text-[15px] font-semibold text-ink-1">Swipe for the next member</span>
          </div>
        )}
      </div>

      {/* Pager ‹ 3 of N › */}
      <div className="flex shrink-0 items-center gap-3 pb-[max(env(safe-area-inset-bottom),12px)] pt-3.5" data-testid="member-deck-pager">
        <button type="button" onClick={() => go(-1)} disabled={index === 0} aria-label="Previous member" className="flex h-11 w-11 items-center justify-center rounded-full bg-white/[0.14] text-white disabled:text-white/30">
          <ChevronLeft className="h-5 w-5" strokeWidth={2} />
        </button>
        <p className="min-w-[72px] text-center text-[13px] font-semibold leading-[18px] tabular-nums text-white/90">{Math.min(index + 1, members.length)} of {members.length}</p>
        <button type="button" onClick={() => go(1)} disabled={atEnd} aria-label="Next member" className="flex h-11 w-11 items-center justify-center rounded-full bg-white/[0.14] text-white disabled:text-white/30">
          <ChevronRight className="h-5 w-5" strokeWidth={2} />
        </button>
      </div>
    </div>
  ) : (
    <div
      ref={containerRef}
      role="dialog"
      aria-modal="true"
      aria-label={`${props.member.full_name?.trim() || 'Member'} — preview`}
      tabIndex={-1}
      data-testid="member-preview"
      className="fixed inset-0 z-50 flex flex-col overflow-hidden bg-white animate-slide-in-up"
      style={{ transform: dy > 0 ? `translateY(${dy}px)` : undefined, transition: dragging ? 'none' : 'transform 0.2s ease-out' }}
      onTouchStart={onTouchStart}
      onTouchMove={onTouchMove}
      onTouchEnd={onTouchEnd}
      onTouchCancel={onTouchEnd}
      onClickCapture={onClickCapture}
    >
      {body}
    </div>
  )

  return createPortal(overlay, document.body)
}

/** The active deck card: continuous corners, white 8 % inside hairline (finish pass). */
function DeckCard({ children, animateIn }: { children: React.ReactNode; animateIn: boolean }) {
  const ref = useRef<HTMLDivElement>(null)
  useSquircle(ref, 24)
  return (
    <div ref={ref} className={`absolute inset-0 flex flex-col overflow-hidden rounded-[24px] bg-white ${animateIn ? 'animate-fade-in' : ''}`} data-testid="member-deck-card">
      {children}
      <span aria-hidden="true" className="pointer-events-none absolute inset-0 rounded-[24px] shadow-[inset_0_0_0_0.5px_rgba(255,255,255,0.08)]" />
    </div>
  )
}

/** A neighbour card peeking beside the active one (94 %, photo + name only). */
function PeekCard({ member, side, width }: { member: Profile; side: 'left' | 'right'; width: number }) {
  const gallery = useMemberPhotos(member.role === 'brand' ? null : member.id)
  const isPerson = member.role !== 'club' && member.role !== 'brand'
  const photo = (isPerson ? member.avatar_url : null) ?? gallery.data?.[0] ?? null
  const offset = side === 'left' ? -(width * 0.94 + 10) : width + 10
  return (
    <div
      aria-hidden="true"
      className="absolute top-[3%] h-[94%] overflow-hidden rounded-[21px] bg-white opacity-90"
      style={{ width: width * 0.94, left: offset }}
    >
      <div className="relative h-[61%] w-full" style={photo ? undefined : { backgroundImage: rolePreviewGradient(member.role) }}>
        {photo && <img src={getImageUrl(photo, 'gallery') ?? photo} alt="" className="absolute inset-0 h-full w-full object-cover" loading="lazy" decoding="async" />}
        <span className="absolute inset-0" style={{ backgroundImage: PHOTO_SCRIM }} />
      </div>
    </div>
  )
}

function PeekEnd({ side, width }: { side: 'left' | 'right'; width: number }) {
  const offset = side === 'left' ? -(width * 0.94 + 10) : width + 10
  return <div aria-hidden="true" className="absolute top-[3%] h-[94%] rounded-[21px] bg-white opacity-90" style={{ width: width * 0.94, left: offset }} />
}

/** Past the last member (Figma P21). */
function DeckEnd({ onAdjustFilters, onBack }: { onAdjustFilters: () => void; onBack: () => void }) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center px-8 text-center" data-testid="member-deck-end">
      <span className="flex h-16 w-16 items-center justify-center rounded-full bg-hockia-soft text-hockia-primary">
        <Users className="h-7 w-7" strokeWidth={1.8} aria-hidden="true" />
      </span>
      <h2 className="mt-4 text-[22px] font-bold leading-7 text-ink-1">You’ve seen everyone</h2>
      <p className="mt-2 text-row text-ink-2">New members join every day. Change your filters or come back later.</p>
      <button type="button" onClick={onAdjustFilters} className="mt-5 flex h-12 w-full items-center justify-center rounded-full bg-hockia-primary text-body font-semibold text-white">
        Adjust filters
      </button>
      <button type="button" onClick={onBack} className="mt-2 min-h-[44px] px-3 text-[14px] font-semibold text-hockia-primary">
        Back to Community
      </button>
    </div>
  )
}

export default MemberFullPreview
