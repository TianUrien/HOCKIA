import { nationalityCountries } from '@/lib/nationality'
import { personActionGate, useAmbassadorInvite } from '@/lib/ambassadorInvite'
import { isRoleAvatarRole } from '@/lib/roleAvatar'
import RolePlaceholder from '@/components/RolePlaceholder'
import { NationalityLine } from '@/components/ui/NationalityBadges'
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { LogoTile } from './LogoTile'
import { createPortal } from 'react-dom'
import { useLocation, useNavigate } from 'react-router-dom'
import { ArrowLeft, Check, ChevronDown, ChevronLeft, ChevronRight, ChevronUp, MessageSquare, Play, Star, UserPlus, Users, X } from 'lucide-react'
import { Capacitor } from '@capacitor/core'
import { App as CapacitorApp } from '@capacitor/app'
import { useMediaQuery } from '@/hooks/useMediaQuery'
import { animateSpring, springValue, stopSpring, type SpringValue } from '@/lib/spring'
import { EuBadge } from '@/components/ui/NationalityBadges'
import { hasEuPassport } from '@/lib/nationality'
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
import { queryClient } from '@/lib/queryClient'
import { qk } from '@/lib/queryKeys'
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
import { FitBadge } from '@/components/ui/FitBadge'

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

/** Every nationality, named ("🇦🇷 Argentina · 🇮🇹 Italy"), + EU when either passport is EU. */
function passportText(passports: Country[]): string | null {
  if (passports.length === 0) return null
  const names = passports.map((c) => [c.flag_emoji, c.common_name || c.name].filter(Boolean).join(' ')).join(' · ')
  return passports.some((c) => isEuCountryCode(c.code)) ? `${names} · EU` : names
}

interface MemberPreviewBodyProps extends MemberFullPreviewProps {
  /** Inside a deck card: no safe-area offsets (the card sits below the status bar). */
  framed?: boolean
  /** A sheet or prompt opened on top: the shell pauses its focus trap. */
  onNestedModal?: (open: boolean) => void
  /** False for the neighbours peeking in the deck: rendered, not counted as a preview. */
  active?: boolean
  /** Phones (ruling 2026-10-21): one member per screen, full-bleed photo, a "More" details panel. */
  immersive?: boolean
  /** Immersive top row label ("All members · Newest"). */
  contextLabel?: string
  /** Immersive: the details panel opened or closed (the deck pauses its gestures). */
  onDetailsChange?: (open: boolean) => void
  /** Desktop (≥ 1024, audit B2): photo column + the details content + a footer action bar. */
  desktop?: boolean
}

/** The preview's content — photo area, summary panel and action bar — for one member. */
function MemberPreviewBody({ member, onClose, age: ageProp = null, fit = null, crestColor: crestProp = null, onBlocked, framed = false, onNestedModal, active = true, immersive = false, contextLabel, onDetailsChange, desktop = false }: MemberPreviewBodyProps) {
  const { user, profile: viewer } = useAuthStore()
  const navigate = useNavigate()
  const location = useLocation()
  const addToast = useToastStore((s) => s.addToast)
  // Brands have followers, not friends (audit A7): Message + Invite as ambassador.
  const personGate = personActionGate(viewer?.role, member.role)
  const ambassador = useAmbassadorInvite(personGate.inviteAmbassador ? member.id : null, addToast)
  const { countries } = useCountries()
  const [signIn, setSignIn] = useState<'view' | 'message' | 'connect' | null>(null)
  const [sending, setSending] = useState(false)
  const [rolePicker, setRolePicker] = useState(false)
  // Immersive only: the "More" details panel over the photo (Figma V3).
  const [details, setDetails] = useState(false)
  useEffect(() => { setDetails(false) }, [member.id])
  useEffect(() => { if (active) onDetailsChange?.(details) }, [active, details, onDetailsChange])
  // Phone-deck measurement goes to the DB event log: GA4 is skipped inside the native apps.
  const trackAction = (action: 'message' | 'add_friend' | 'shortlist' | 'full_profile') => {
    if (immersive) trackDbEvent('member_preview_action', 'profile', member.id, { action, viewed_role: member.role, surface: details ? 'details' : 'photo' })
    else if (desktop) trackDbEvent('member_preview_action', 'profile', member.id, { action, viewed_role: member.role, surface: 'desktop' })
  }

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
  // The photo on screen once decoded (a preloaded one shows at once, a late one fades in).
  const [shownSrc, setShownSrc] = useState<string | null>(null)
  const [failed, setFailed] = useState<Set<string>>(() => new Set())
  const shown = photos.filter((p) => !failed.has(p))
  const current = shown[Math.min(photoIndex, Math.max(shown.length - 1, 0))] ?? null
  useEffect(() => { setPhotoIndex(0) }, [member.id])

  useEffect(() => { if (active) onNestedModal?.(signIn !== null || rolePicker) }, [active, signIn, rolePicker, onNestedModal])
  // Continuous top corners on the summary panel (finish pass).
  const panelRef = useRef<HTMLDivElement>(null)
  useSquircle(panelRef, { tl: 28, tr: 28 })

  useEffect(() => {
    if (!active) return
    trackDbEvent('profile_preview', 'profile', member.id, { viewed_role: member.role, source: 'community' })
    trackEvent({ action: 'community_preview_open', category: 'community', label: member.role })
  }, [active, member.id, member.role])

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
    trackAction('full_profile')
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
    trackAction('message')
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
  // People: the place is text without a flag (the flag means nationality); clubs and brands keep theirs.
  const place = isPerson ? [where.city, where.country].filter(Boolean).join(', ') || null : placeLabel(where, true)
  const nationalities = isPerson ? nationalityCountries([member.nationality_country_id, member.nationality2_country_id], countries) : []
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
  const fitPillText = fitLabel
  const fitSuffix = fitLabel && recruiterView.fitRole ? `for ${recruiterView.fitRole.title}` : null
  const onShortlist = () => {
    trackAction('shortlist')
    void hapticLight()
    if (recruiterView.roles.length === 0) void recruiterView.shortlistDefault()
    else if (recruiterView.roles.length === 1) void recruiterView.shortlistForRole(recruiterView.roles[0])
    else setRolePicker(true)
  }

  // One set of actions, three surfaces: the classic sheet / deck card, the
  // immersive photo (Figma V1: glass secondary) and the details panel (V3).
  // Inside the narrower deck card the labels stay on one line ("See open roles").
  // Deck card (Figma correction 2026-10-11): real type sizes, buttons 48 high.
  const buildActions = (surface: 'card' | 'photo' | 'panel') => {
  const btnSize = surface !== 'card' || framed ? 'h-12 gap-1.5 px-2.5 text-[15px]' : 'h-[52px] gap-2 px-4 text-[16px]'
  const primary = `flex min-w-0 flex-1 items-center justify-center whitespace-nowrap rounded-full bg-hockia-primary ${btnSize} font-semibold text-white ${PRESS} disabled:opacity-60`
  const secondary = surface === 'photo'
    ? `flex min-w-0 flex-1 items-center justify-center whitespace-nowrap rounded-full border border-white/[0.28] bg-white/[0.18] ${btnSize} font-semibold text-white ${GLASS} ${PRESS} disabled:text-white/50`
    : surface === 'panel'
      ? `flex min-w-0 flex-1 items-center justify-center whitespace-nowrap rounded-full bg-surface-muted ${btnSize} font-semibold text-ink-1 ${PRESS} disabled:text-ink-4`
      : `flex min-w-0 flex-1 items-center justify-center whitespace-nowrap rounded-full border-[1.5px] border-line bg-white ${btnSize} font-semibold text-ink-1 ${PRESS} active:bg-surface-muted disabled:text-ink-4`
  const muted = surface === 'photo'
    ? `flex min-w-0 flex-1 items-center justify-center whitespace-nowrap rounded-full border border-white/[0.28] bg-white/[0.18] ${btnSize} font-semibold text-white/80 ${GLASS}`
    : `flex min-w-0 flex-1 items-center justify-center whitespace-nowrap rounded-full bg-surface-muted ${btnSize} font-semibold text-ink-2`
  const iconSquare = surface === 'photo'
    ? `flex shrink-0 items-center justify-center rounded-full border border-white/[0.28] bg-white/[0.18] h-12 w-12 text-white ${GLASS} disabled:text-white/50`
    : `flex shrink-0 items-center justify-center rounded-full border-[1.5px] ${surface !== 'card' || framed ? 'h-12 w-12' : 'h-[52px] w-[52px]'} border-line bg-white text-ink-1 disabled:text-ink-4`

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

  return (() => {
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
    if (!personGate.addFriend) {
      const tonal = surface === 'photo'
        ? secondary
        : `flex min-w-0 flex-1 items-center justify-center whitespace-nowrap rounded-full bg-brand-soft ${btnSize} font-semibold text-brand-primary ${PRESS} disabled:opacity-60`
      return (
        <>
          {messageButton('primary')}
          {personGate.inviteAmbassador && (
            <button type="button" onClick={() => void ambassador.invite()} disabled={ambassador.state !== 'idle'} className={tonal} data-testid="member-preview-invite-ambassador">
              {ambassador.state === 'sent' && <Check className="h-5 w-5" strokeWidth={2.4} aria-hidden="true" />} {ambassador.label}
            </button>
          )}
        </>
      )
    }
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
            className={iconSquare}
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
          onClick={() => { if (requireMember('connect')) { trackAction('add_friend'); void hapticLight(); void friendship.sendRequest() } }}
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
  }
  const actions = buildActions('card')

  // ── Photo area background when there is no photo to show
  const crest = isClub && member.avatar_url ? getImageUrl(member.avatar_url, 'avatar-xl') ?? member.avatar_url : null
  const noPhotoBackground = isClub
    ? (crest ? crestGradient(crestColor) : CLUB_BRAND_GRADIENT)
    : rolePreviewGradient(member.role)
  const brandLogo = isBrand ? member.brand_logo_url ?? member.avatar_url : null

  if (immersive || desktop) {
    const pageProps: ImmersivePageProps = {
      member: member,
      name: name,
      firstName: firstName,
      title: title,
      isPerson: isPerson,
      isClub: isClub,
      current: current,
      shownSrc: shownSrc,
      setShownSrc: setShownSrc,
      markFailed: (src) => setFailed((s) => new Set(s).add(src)),
      shownCount: shown.length,
      photoIndex: photoIndex,
      stepPhoto: stepPhoto,
      noPhotoBackground: noPhotoBackground,
      crest: crest,
      brandLogo: brandLogo,
      contextLabel: contextLabel,
      onClose: onClose,
      menu: user && !friendship.isOwnProfile ? (
          <ProfileActionMenu
            targetId={member.id}
            targetName={name}
            actionName={firstName}
            leadingItems={[{ key: 'share', label: 'Share profile', onSelect: () => void share() }]}
            onBlocked={() => { onClose(); onBlocked?.(member) }}
            triggerClassName={IMMERSIVE_GLASS_BUTTON}
            iconClassName="h-[22px] w-[22px] text-white"
          />
        ) : null,
      fitPill: fitPillText && fitState ? <FitBadge state={fitState} surface="photo" suffix={fitSuffix} /> : null,
      incomingRequest: !fitPillText && friendship.isIncomingRequest && !recruiterActions,
      nationalities: nationalities,
      place: place,
      idLine: (() => {
          if (!isPerson) return subLine
          const club = member.current_club?.trim() || null
          return [...subParts, club].filter(Boolean).join(' · ')
        })(),
      facts: facts,
      playsAt: (() => {
          if (member.role !== 'player' && member.role !== 'coach') return null
          const club = member.current_club?.trim() || null
          if (!club) return null
          const team = member.role === 'player' ? teamLabel(member.playing_category) : coachTeam
          return { label: member.role === 'coach' ? 'Coaches at' : 'Plays at', value: [club, team].filter(Boolean).join(' · '), detail: getPlayerLeagueName(member.current_world_club_id, null) }
        })(),
      references: isPerson ? member.accepted_reference_count ?? 0 : 0,
      hasHighlights: isPerson && Boolean(member.highlight_video_url),
      about: about,
      details: details,
      setDetails: (open) => {
          if (open) {
            trackDbEvent('member_preview_more_open', 'profile', member.id, { viewed_role: member.role })
            void hapticSelection()
          }
          setDetails(open)
        },
      photoActions: buildActions('photo'),
      panelActions: buildActions('panel'),
      messageBlockedReason: messageBlockedReason,
      onViewProfile: viewProfile,
      sheets: (
          <>
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
          </>
        ),
    }
    return immersive ? <ImmersivePage {...pageProps} /> : <DesktopPage {...pageProps} />
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden bg-white" data-member-id={member.id}>
      <div data-preview-scroll="" className="flex min-h-0 flex-1 flex-col overflow-y-auto overscroll-contain">
        {/* Photo area */}
        <div
          className={`relative w-full shrink-0 grow overflow-hidden ${framed ? 'min-h-[min(410px,52dvh)]' : 'min-h-[min(520px,61dvh)]'}`}
          // The member's colour sits behind the photo, so a photo still on its
          // way never shows as a white gap.
          style={{ backgroundImage: noPhotoBackground }}
        >
          {current ? (
            <>
              <img
                key={current}
                ref={(el) => { if (el?.complete && el.naturalWidth > 0) setShownSrc(current) }}
                src={getImageUrl(current, 'feed-full') ?? current}
                alt=""
                className={`absolute inset-0 h-full w-full object-cover transition-opacity duration-200 ${shownSrc === current ? 'opacity-100' : 'opacity-0'}`}
                decoding="async"
                onError={() => setFailed((s) => new Set(s).add(current))}
                // Clubs: a small media upload (often the logo) goes blurry at
                // this size; below the spec's 600 px it is skipped, like the card.
                onLoad={(e) => {
                  if (isClub && e.currentTarget.naturalWidth > 0 && e.currentTarget.naturalWidth < 600) setFailed((s) => new Set(s).add(current))
                  else setShownSrc(current)
                }}
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
          <div data-preview-identity="" className="pointer-events-none absolute inset-x-5 bottom-[calc(24px+18px)] flex flex-col items-start gap-1.5">
            {isClub && current && crest && (
              <LogoTile src={crest} name={name} eager className="mb-0.5 h-14 w-14 rounded-[16px] p-[5px]" initialsClassName="text-[18px]" />
            )}
            {fitPillText && fitState && <FitBadge state={fitState} surface="photo" suffix={fitSuffix} />}
            {!fitPillText && friendship.isIncomingRequest && !recruiterActions && (
              <span className={`inline-flex items-center gap-1.5 rounded-full bg-[rgba(15,15,20,0.55)] px-2.5 py-[5px] ${GLASS}`}>
                <span className="h-[7px] w-[7px] rounded-full bg-[#b79cff]" aria-hidden="true" />
                <span className="text-[12px] font-semibold leading-4 text-white">Sent you a friend request</span>
              </span>
            )}
            <h2 className="line-clamp-2 text-[28px] font-bold leading-[34px] tracking-[-0.01em] text-white">{title}</h2>
            {subLine && <p className="line-clamp-2 text-[15px] leading-5 text-white/[0.88]">{subLine}</p>}
            {nationalities.length > 0 && <NationalityLine nationalities={nationalities} className="pt-1" />}
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
                        <RolePlaceholder role={isRoleAvatarRole(p.role) ? p.role : 'player'} name={p.fullName} label="" />
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
/** Phones: the vertical deck (ruling 2026-10-21), or the classic sheet for a single preview. Desktop: the deck with arrows (audit B2). */
const PHONE_QUERY = '(max-width: 1023px)'
export function MemberFullPreview(props: MemberFullPreviewProps & { deck?: MemberPreviewDeck }) {
  const isPhone = useMediaQuery(PHONE_QUERY)
  if (!isPhone) return <DesktopMemberDeck {...props} />
  if (props.deck) return <VerticalMemberDeck {...props} deck={props.deck} />
  return <ClassicMemberPreview {...props} />
}

function ClassicMemberPreview(props: MemberFullPreviewProps & { deck?: MemberPreviewDeck }) {
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
    // Three members each way: their data, then their first photo downloaded
    // and decoded, so a card is complete before it ever slides into view.
    const near = [-3, -2, -1, 1, 2, 3].map((d) => members[index + d]).filter((m): m is Profile => Boolean(m))
    void prefetchFriendsInCommon(near.filter((m) => m.role !== 'club' && m.role !== 'brand').map((m) => m.id))
    void prefetchMemberPhotos(near.map((m) => m.id)).then(() => {
      for (const m of near) preloadImage(firstPhotoOf(m))
    })
  }, [deck, index, members])

  // ── Gestures: sideways = members (deck), down = close.
  const [hint, setHint] = useState(false)
  const hintTimers = useRef<number[]>([])
  // "Seen" is recorded only once the hint has really been shown — finished,
  // or swiped past — never on an unmount (React runs effects twice in dev).
  const markHintSeen = useCallback(() => {
    try { window.localStorage.setItem(DECK_HINT_KEY, '1') } catch { /* private mode */ }
  }, [])
  const stopHint = useCallback((seen = false) => {
    if (seen && hintTimers.current.length > 0) markHintSeen()
    hintTimers.current.forEach((t) => window.clearTimeout(t))
    hintTimers.current = []
    setHint(false)
  }, [markHintSeen])
  const start = useRef<{ x: number; y: number; axis: 'x' | 'y' | null } | null>(null)
  const moved = useRef(false)
  const [dy, setDy] = useState(0)
  const cardWidth = typeof window !== 'undefined' ? Math.min(310, window.innerWidth - 83) : 310
  // Cards sit 4 pt apart; neighbours shrink toward the current card, so a
  // generous edge of each (~37 pt on a 393 pt phone) peeks out at rest.
  const slot = cardWidth + 4
  // The row of cards moves under the finger directly (no re-render per
  // touchmove); React only re-renders when a swipe lands.
  const stripRef = useRef<HTMLDivElement>(null)
  const dragX = useRef(0)
  const animating = useRef(false)
  // While a swipe lands, the incoming card already grows to full size.
  const [focusIndex, setFocusIndex] = useState(index)
  const setX = useCallback((x: number, motion: 'none' | 'settle' | 'spring' = 'none') => {
    dragX.current = x
    const el = stripRef.current
    if (!el) return
    el.style.transition = motion === 'none' ? 'none' : motion === 'settle' ? 'transform 260ms cubic-bezier(0.22, 0.9, 0.3, 1)' : 'transform 420ms cubic-bezier(0.34, 1.4, 0.64, 1)'
    el.style.transform = `translate3d(${x}px, 0, 0)`
  }, [])
  // After the index moves, put the row back at rest in the same frame: the
  // landed card is the same element, now one slot over — no visible jump.
  useLayoutEffect(() => { setX(0); setFocusIndex(index) }, [index, setX])

  const go = useCallback((dir: 1 | -1) => {
    if (!deck || animating.current) return
    const next = index + dir
    if (next < 0 || next > members.length) return
    trackEvent({ action: 'community_deck_swipe', category: 'community', label: dir > 0 ? 'next' : 'previous' })
    void hapticSelection()
    stopHint(true)
    if (reduce) { setIndex(next); return }
    animating.current = true
    setFocusIndex(next)
    setX(-dir * slot, 'settle')
    window.setTimeout(() => {
      animating.current = false
      setIndex(next)
    }, 260)
  }, [deck, index, members.length, reduce, slot, stopHint, setX])

  const startTime = useRef(0)
  const onTouchStart = (e: React.TouchEvent) => {
    if (animating.current) return
    start.current = { x: e.touches[0].clientX, y: e.touches[0].clientY, axis: null }
    startTime.current = performance.now()
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
    if (hintTimers.current.length > 0) stopHint(true)
    if (s0.axis === 'x') {
      // Resist past the first member.
      const edge = (index === 0 && mx > 0) || (atEnd && mx < 0)
      setX(edge ? mx / 3 : mx)
    } else setDy(Math.max(0, my))
  }
  const onTouchEnd = () => {
    const s0 = start.current
    start.current = null
    if (!s0?.axis) return
    if (s0.axis === 'x') {
      // A quick flick counts as much as a long drag.
      const x = dragX.current
      const flick = Math.abs(x) > 30 && Math.abs(x) / Math.max(performance.now() - startTime.current, 1) > 0.5
      if ((x <= -SWIPE_DISTANCE || (flick && x < 0)) && !atEnd) go(1)
      else if ((x >= SWIPE_DISTANCE || (flick && x > 0)) && index > 0) go(-1)
      else setX(0, 'spring')
    } else if (dy > 110) onClose()
    else setDy(0)
  }
  // A swipe that started on a tap zone must not also step the photo.
  const onClickCapture = (e: React.MouseEvent) => {
    if (moved.current) { e.stopPropagation(); e.preventDefault(); moved.current = false }
  }

  // ── First-open nudge (P20), once per device.
  // Placed in the photo: its vertical centre, but always clear of the name
  // block (16 pt above it) and of the close / ⋯ row and progress bars
  // (never above 16 pt under the close button).
  const hintRef = useRef<HTMLDivElement>(null)
  const [hintTop, setHintTop] = useState<number | null>(null)
  useLayoutEffect(() => {
    if (!hint) return
    const card = stripRef.current?.querySelector('[data-testid="member-deck-card"]') as HTMLElement | null
    const photo = card?.querySelector('[data-preview-scroll] > div') as HTMLElement | null
    const identity = card?.querySelector('[data-preview-identity]') as HTMLElement | null
    const hintH = hintRef.current?.offsetHeight ?? 44
    if (!card || !photo) return
    const cardTop = card.getBoundingClientRect().top
    const containerTop = stripRef.current!.parentElement!.getBoundingClientRect().top
    const offset = cardTop - containerTop
    const belowClose = 24 + 44 + 16 // close row top + button + gap
    const centre = photo.offsetHeight / 2 - hintH / 2
    const aboveName = identity ? identity.getBoundingClientRect().top - cardTop - 16 - hintH : centre
    setHintTop(offset + Math.max(belowClose, Math.min(centre, aboveName)))
  }, [hint, index])
  // Depends on "is this a deck", never on the deck object (rebuilt on every
  // grid render — a re-run would cancel the hint the moment it shows).
  const isDeck = Boolean(deck)
  useEffect(() => {
    if (!isDeck || members.length < 2) return
    let seen = false
    try { seen = window.localStorage.getItem(DECK_HINT_KEY) === '1' } catch { /* private mode */ }
    if (seen) return
    setHint(true)
    const done = () => { markHintSeen(); hintTimers.current = []; setHint(false) }
    hintTimers.current = reduce
      ? [window.setTimeout(done, 2600)]
      : [
          window.setTimeout(() => setX(-40, 'settle'), 500),
          window.setTimeout(() => setX(0, 'spring'), 500 + 260 + 300),
          window.setTimeout(done, 2800),
        ]
    return () => stopHint()
  }, [isDeck, members.length, reduce, stopHint, setX, markHintSeen])

  const dragging = start.current?.axis != null
  const renderBody = (m: Profile, active: boolean) => (
    <MemberPreviewBody
      key={m.id}
      member={m}
      onClose={onClose}
      age={deck?.ageOf?.(m.id) ?? null}
      fit={deck?.fitOf?.(m.id) ?? null}
      crestColor={deck?.crestOf?.(m.id) ?? null}
      onBlocked={onBlocked}
      framed
      onNestedModal={active ? setNested : undefined}
      active={active}
    />
  )
  // The previous, current and next slot (the end card is the slot after the last member).
  // Two cards built on each side: after a swipe the new neighbour is already
  // rendered (photo included) one slot further out, never mounted in view.
  const windowSlots = deck ? [index - 2, index - 1, index, index + 1, index + 2].filter((k) => k >= 0 && k <= members.length) : []
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
        <div ref={stripRef} className="absolute inset-y-0 left-1/2 will-change-transform" style={{ width: cardWidth, marginLeft: -cardWidth / 2 }}>
          {windowSlots.map((k) => {
            const isEnd = k === members.length
            const isActive = k === index
            return (
              <DeckCard
                key={isEnd ? 'end' : members[k].id}
                offset={(k - index) * slot}
                focused={k === focusIndex}
                side={k < focusIndex ? 'left' : k > focusIndex ? 'right' : 'center'}
                active={isActive}
                animateIn={reduce && isActive}
              >
                {isEnd
                  ? <DeckEnd onAdjustFilters={() => { onClose(); deck.onAdjustFilters?.() }} onBack={onClose} />
                  : renderBody(members[k], isActive)}
              </DeckCard>
            )
          })}
        </div>
        {hint && (
          <div ref={hintRef} className="pointer-events-none absolute left-1/2 z-10 flex -translate-x-1/2 items-center gap-2 rounded-full bg-white px-4 py-2.5 shadow-lg animate-fade-in" style={{ top: hintTop ?? 84 }} role="status">
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
const DECK_EASE = 'cubic-bezier(0.22, 0.9, 0.3, 1)'

/**
 * One card of the deck. The outer layer places it (slot, scale, depth shadow);
 * the inner layer carries the continuous corners — a clip would cut the shadow.
 * Neighbours sit at 94 %, shrunk toward the current card so their near edge
 * stays close, dimmed a little as if behind it; the focused card is full
 * size, lifted by a soft shadow onto them.
 */
function DeckCard({ children, animateIn, offset, focused, active, side }: { children: React.ReactNode; animateIn: boolean; offset: number; focused: boolean; active: boolean; side: 'left' | 'center' | 'right' }) {
  const ref = useRef<HTMLDivElement>(null)
  useSquircle(ref, 24)
  return (
    <div
      inert={!active}
      aria-hidden={!active || undefined}
      className={`absolute inset-y-0 w-full ${animateIn ? 'animate-fade-in' : ''}`}
      style={{
        left: offset,
        zIndex: focused ? 2 : 1,
        // Shrink toward the current card: a 94 % card moved 3 % of its width
        // inward. One transform per state, so changes animate without jumps.
        transform: focused ? 'translate3d(0, 0, 0) scale(1)' : `translate3d(${side === 'left' ? 3 : -3}%, 0, 0) scale(0.94)`,
        filter: focused ? 'drop-shadow(0 18px 36px rgba(0, 0, 0, 0.45))' : 'none',
        transition: `transform 260ms ${DECK_EASE}, filter 260ms ${DECK_EASE}`,
      }}
      data-testid={active ? 'member-deck-card' : undefined}
    >
      <div ref={ref} className="flex h-full w-full flex-col overflow-hidden rounded-[24px] bg-white">
        {children}
        <span aria-hidden="true" className="pointer-events-none absolute inset-0 rounded-[24px] shadow-[inset_0_0_0_0.5px_rgba(255,255,255,0.08)]" />
        {/* Depth: neighbours read as sitting behind the current card. */}
        <span aria-hidden="true" className="pointer-events-none absolute inset-0 rounded-[24px] bg-surface-inverse transition-opacity duration-[260ms]" style={{ opacity: focused ? 0 : 0.28 }} />
      </div>
    </div>
  )
}

/** The photo a member's card opens on: the avatar for people, the first media photo for clubs. */
function firstPhotoOf(m: Profile): string | null {
  if (m.role === 'brand') return null
  if (m.role !== 'club' && m.avatar_url) return m.avatar_url
  return queryClient.getQueryData<string[]>(qk.memberPhotos(m.id))?.[0] ?? null
}

const preloaded = new Set<string>()
/** Download and decode an image ahead of time (same URL the card uses). */
function preloadImage(raw: string | null) {
  if (!raw || typeof Image === 'undefined') return
  const src = getImageUrl(raw, 'feed-full') ?? raw
  if (preloaded.has(src)) return
  preloaded.add(src)
  const img = new Image()
  img.decoding = 'async'
  img.src = src
  void img.decode?.().catch(() => undefined)
}

// ── Phones: the vertical deck (founder ruling 2026-10-21, Figma 01 Community ·
// "Vertical deck on phones" V0–V3). Desktop keeps the classic deck above.

/** Glass round button over the photo (Figma V1 top row: black 32 % + 14 % white hairline). */
const IMMERSIVE_GLASS_BUTTON = `flex h-11 w-11 items-center justify-center rounded-full border border-white/[0.14] bg-black/[0.32] text-white ${GLASS} ${PRESS}`
/** Figma V1 scrims: top 45 → 0 % over 140 pt; bottom 0 → 25 % (35 %) → 85 % over 420 pt. */
const TOP_SCRIM = 'linear-gradient(180deg, rgba(0,0,0,0.45) 0%, rgba(0,0,0,0) 100%)'
const BOTTOM_SCRIM = 'linear-gradient(180deg, rgba(0,0,0,0) 0%, rgba(0,0,0,0.25) 35%, rgba(0,0,0,0.85) 100%)'

interface ImmersivePageProps {
  member: Profile
  name: string
  firstName: string
  title: string
  isPerson: boolean
  isClub: boolean
  current: string | null
  shownSrc: string | null
  setShownSrc: (src: string) => void
  markFailed: (src: string) => void
  shownCount: number
  photoIndex: number
  stepPhoto: (dir: 1 | -1) => void
  noPhotoBackground: string
  crest: string | null
  brandLogo: string | null
  contextLabel?: string
  onClose: () => void
  menu: React.ReactNode
  fitPill: React.ReactNode
  incomingRequest: boolean
  nationalities: ReturnType<typeof nationalityCountries>
  place: string | null
  /** Position · category · club (people); the classic sub line for clubs and brands. */
  idLine: string
  facts: { label: string; value: string }[]
  playsAt: { label: string; value: string; detail: string | null } | null
  references: number
  hasHighlights: boolean
  about: string | null
  details: boolean
  setDetails: (open: boolean) => void
  photoActions: React.ReactNode
  panelActions: React.ReactNode
  messageBlockedReason: string | null
  onViewProfile: () => void
  sheets: React.ReactNode
}

/**
 * One member per screen (Figma V1): full-bleed photo, top and bottom scrims,
 * the top row (close · list label · menu), photo progress, identity over the
 * photo, a "More" chevron and the action bar fixed above the home indicator.
 * "More" opens the details panel (V3, sheet r28): head, Plays at,
 * nationalities with EU, Based in, references (gold) and highlights, bio, the
 * same actions and See full profile. Tap the photo or drag the panel down to close it.
 */
function ImmersivePage(p: ImmersivePageProps) {
  const panelRef = useRef<HTMLDivElement>(null)
  useSquircle(panelRef, { tl: 28, tr: 28 })
  // Drag the panel down (from its top, content not scrolled) to close it.
  const drag = useRef<{ y: number; dy: number } | null>(null)
  const [panelDy, setPanelDy] = useState(0)
  const onPanelTouchStart = (e: React.TouchEvent) => {
    const el = panelRef.current
    if (el && el.scrollTop > 0) return
    drag.current = { y: e.touches[0].clientY, dy: 0 }
  }
  const onPanelTouchMove = (e: React.TouchEvent) => {
    if (!drag.current) return
    const dy = Math.max(0, e.touches[0].clientY - drag.current.y)
    drag.current.dy = dy
    setPanelDy(dy)
  }
  const onPanelTouchEnd = () => {
    const dy = drag.current?.dy ?? 0
    drag.current = null
    setPanelDy(0)
    if (dy > 90) p.setDetails(false)
  }
  useEffect(() => {
    if (!p.details) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.stopPropagation(); p.setDetails(false) } }
    document.addEventListener('keydown', onKey, true)
    return () => document.removeEventListener('keydown', onKey, true)
  }, [p, p.details])

  const avatar = p.member.avatar_url ? getImageUrl(p.member.avatar_url, 'avatar-md') ?? p.member.avatar_url : null
  const nationalityNames = p.nationalities.map((c) => [c.flag, c.name].filter(Boolean).join(' ')).join(' · ')

  return (
    <div className="relative h-full w-full overflow-hidden bg-surface-inverse" data-member-id={p.member.id} data-testid="member-vdeck-page">
      {/* Photo, full bleed; the member's colour sits behind it while it loads. */}
      <div className="absolute inset-0" style={{ backgroundImage: p.noPhotoBackground }}>
        {p.current ? (
          <img
            key={p.current}
            ref={(el) => { if (el?.complete && el.naturalWidth > 0) p.setShownSrc(p.current!) }}
            src={getImageUrl(p.current, 'feed-full') ?? p.current}
            alt=""
            className={`absolute inset-0 h-full w-full object-cover transition-opacity duration-200 ${p.shownSrc === p.current ? 'opacity-100' : 'opacity-0'}`}
            decoding="async"
            onError={() => p.markFailed(p.current!)}
            onLoad={(e) => {
              if (p.isClub && e.currentTarget.naturalWidth > 0 && e.currentTarget.naturalWidth < 600) p.markFailed(p.current!)
              else p.setShownSrc(p.current!)
            }}
          />
        ) : (
          <span aria-hidden="true" className="absolute inset-0">
            <img src={pitchVertical} alt="" className="absolute inset-0 h-full w-full" />
            {p.isClub && p.crest ? (
              <LogoTile src={p.crest} name={p.name} eager className={`absolute left-1/2 top-[26%] h-[150px] w-[150px] -translate-x-1/2 rounded-[32px] p-3.5 ${LIGHT_SHADOW}`} initialsClassName="text-[44px]" />
            ) : p.brandLogo ? (
              <LogoTile src={getImageUrl(p.brandLogo, 'avatar-lg') ?? p.brandLogo} name={p.name} eager className="absolute left-1/2 top-[28%] h-[140px] w-[140px] -translate-x-1/2 rounded-[28px] p-4" initialsClassName="text-[40px]" />
            ) : (
              <span className="absolute left-1/2 top-[28%] flex h-[140px] w-[140px] -translate-x-1/2 items-center justify-center rounded-full border-[1.5px] border-white/40 bg-white/[0.14] text-[52px] font-bold text-white">
                {initialsOf(p.name)}
              </span>
            )}
          </span>
        )}
      </div>
      <span aria-hidden="true" className="pointer-events-none absolute inset-x-0 top-0 h-[140px]" style={{ backgroundImage: TOP_SCRIM }} />
      <span aria-hidden="true" className="pointer-events-none absolute inset-x-0 bottom-0 h-[420px] max-h-[60%]" style={{ backgroundImage: BOTTOM_SCRIM }} />

      {/* Tap the left / right half for the previous / next photo (vertical swipes are members). */}
      {p.shownCount > 1 && (
        <>
          <button type="button" aria-label="Previous photo" onClick={() => p.stepPhoto(-1)} className="absolute inset-y-0 left-0 w-1/2" />
          <button type="button" aria-label="Next photo" onClick={() => p.stepPhoto(1)} className="absolute inset-y-0 right-0 w-1/2" />
        </>
      )}

      {/* Top row and photo progress */}
      <div className="absolute inset-x-4 top-[calc(env(safe-area-inset-top)+4px)] flex h-11 items-center gap-2">
        <button type="button" onClick={p.onClose} aria-label="Close preview" className={IMMERSIVE_GLASS_BUTTON} data-testid="member-preview-close">
          <ChevronDown className="h-[22px] w-[22px]" strokeWidth={2} />
        </button>
        <p className="min-w-0 flex-1 truncate text-center text-[13px] font-semibold leading-[18px] text-white/[0.92]" data-testid="member-deck-context">{p.contextLabel}</p>
        {p.menu ?? <span className="h-11 w-11 shrink-0" aria-hidden="true" />}
      </div>
      {p.shownCount > 1 && (
        <div aria-hidden="true" className="absolute inset-x-4 top-[calc(env(safe-area-inset-top)+56px)] flex gap-1">
          {Array.from({ length: p.shownCount }, (_, i) => (
            <span key={i} className={`h-[3px] flex-1 rounded-[2px] ${i === p.photoIndex ? 'bg-white/95' : 'bg-white/[0.35]'}`} />
          ))}
        </div>
      )}

      {/* Identity, More and the action bar, bottom up from the home indicator. */}
      <div className="pointer-events-none absolute inset-x-0 bottom-0 flex flex-col pb-[max(env(safe-area-inset-bottom),12px)]">
        <div data-preview-identity="" className="flex flex-col items-start gap-1.5 px-4">
          {p.isClub && p.current && p.crest && (
            <LogoTile src={p.crest} name={p.name} eager className="mb-0.5 h-14 w-14 rounded-[16px] p-[5px]" initialsClassName="text-[18px]" />
          )}
          {p.fitPill}
          {p.incomingRequest && (
            <span className={`inline-flex items-center gap-1.5 rounded-full bg-[rgba(15,15,20,0.55)] px-2.5 py-[5px] ${GLASS}`}>
              <span className="h-[7px] w-[7px] rounded-full bg-[#b79cff]" aria-hidden="true" />
              <span className="text-[12px] font-semibold leading-4 text-white">Sent you a friend request</span>
            </span>
          )}
          <h2 className="line-clamp-2 text-[30px] font-bold leading-9 tracking-[-0.015em] text-white">{p.title}</h2>
          {p.idLine && <p className="line-clamp-2 text-[16px] leading-[22px] text-white/[0.92]">{p.idLine}</p>}
          {p.nationalities.length > 0 && (
            <div className="flex flex-wrap items-center gap-1.5" data-testid="member-vdeck-nationalities">
              {p.nationalities.map((c) => (
                <span key={c.id} className={`flex h-7 items-center rounded-full border border-white/[0.22] bg-white/[0.16] px-2.5 text-[13px] font-semibold leading-[18px] text-white ${GLASS}`}>
                  {[c.flag, c.name].filter(Boolean).join(' ')}
                </span>
              ))}
              {hasEuPassport(p.nationalities) && <EuBadge surface="photo" className="h-7 rounded-full px-2.5 text-[13px] leading-[18px]" />}
            </div>
          )}
          {p.isPerson && p.place && <p className="line-clamp-2 text-[13px] leading-[18px] text-white/80">Based in {p.place}</p>}
        </div>
        <div className="flex justify-center pt-1.5">
          <button
            type="button"
            onClick={() => p.setDetails(true)}
            aria-label={`More about ${p.firstName}`}
            aria-expanded={p.details}
            className="pointer-events-auto flex h-11 w-16 items-center justify-center text-white"
            data-testid="member-vdeck-more"
          >
            <ChevronUp className="h-[18px] w-[18px]" strokeWidth={2.2} aria-hidden="true" />
          </button>
        </div>
        <div data-vdeck-actions="" className="pointer-events-auto px-4 pt-0.5 transition-opacity duration-200 group-data-[dragging=true]:opacity-0">
          {p.photoActions && <div className="flex gap-2.5">{p.photoActions}</div>}
          {p.messageBlockedReason && (
            <p id="member-preview-message-note" className="mt-2 text-center text-[13px] leading-[18px] text-white/80">{p.messageBlockedReason}</p>
          )}
        </div>
      </div>

      {/* Details panel (Figma V3) */}
      {p.details && (
        <div className="absolute inset-0 z-10" data-vdeck-panel="">
          <button type="button" aria-label="Close details" onClick={() => p.setDetails(false)} className="absolute inset-0 bg-black/[0.35] animate-fade-in" />
          <div
            ref={panelRef}
            role="region"
            aria-label={`About ${p.name}`}
            className="absolute inset-x-0 bottom-0 flex max-h-[78%] flex-col gap-3 overflow-y-auto overscroll-contain rounded-t-[28px] bg-white px-5 pb-[max(env(safe-area-inset-bottom),12px)] pt-2 animate-slide-in-up"
            style={{ transform: panelDy > 0 ? `translateY(${panelDy}px)` : undefined, transition: panelDy > 0 ? 'none' : 'transform 0.2s ease-out' }}
            onTouchStart={onPanelTouchStart}
            onTouchMove={onPanelTouchMove}
            onTouchEnd={onPanelTouchEnd}
            onTouchCancel={onPanelTouchEnd}
            data-testid="member-vdeck-details"
          >
            <div aria-hidden="true" className="flex justify-center pb-1"><span className="h-[5px] w-9 rounded-[3px] bg-line" /></div>
            <div className="flex items-center gap-3">
              {avatar ? (
                <img src={avatar} alt="" className="h-12 w-12 shrink-0 rounded-full object-cover" />
              ) : (
                <span className="block h-12 w-12 shrink-0 overflow-hidden rounded-full"><RolePlaceholder role={isRoleAvatarRole(p.member.role) ? p.member.role : 'player'} name={p.name} label="" /></span>
              )}
              <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                <p className="line-clamp-2 text-[22px] font-bold leading-[27px] tracking-[-0.006em] text-ink-1">{p.title}</p>
                {p.idLine && <p className="line-clamp-2 text-[16px] leading-[22px] text-ink-2">{p.idLine}</p>}
              </div>
            </div>
            {p.isPerson ? (
              <>
                {p.playsAt && (
                  <DetailTile label={p.playsAt.label} value={p.playsAt.value} detail={p.playsAt.detail} />
                )}
                {p.nationalities.length > 0 && (
                  <div className="flex flex-col gap-[3px] rounded-[14px] bg-surface-muted px-3.5 py-2.5">
                    <span className="text-[12px] font-semibold uppercase leading-4 tracking-[0.04em] text-ink-2">Nationalities and passports</span>
                    <span className="text-[16px] leading-[22px] text-ink-1">{nationalityNames}</span>
                    {hasEuPassport(p.nationalities) && (
                      <span className="mt-0.5 flex items-center gap-1.5 text-[12px] leading-4 text-ink-2"><EuBadge surface="light" /> EU passport</span>
                    )}
                  </div>
                )}
                {p.place && <DetailTile label="Based in" value={p.place} />}
                {(p.references > 0 || p.hasHighlights) && (
                  <div className="flex gap-2">
                    {p.references > 0 && (
                      <div className="flex min-w-0 flex-1 flex-col gap-[3px] rounded-[14px] bg-gold-soft px-3.5 py-2.5" data-testid="member-vdeck-references">
                        <span className="text-[12px] font-semibold uppercase leading-4 tracking-[0.04em] text-gold">References</span>
                        <span className="text-[16px] leading-[22px] text-ink-1">{p.references} accepted</span>
                      </div>
                    )}
                    {p.hasHighlights && (
                      <button type="button" onClick={p.onViewProfile} className="flex min-w-0 flex-1 flex-col items-start gap-[3px] rounded-[14px] bg-hockia-soft px-3.5 py-2.5 text-left text-hockia-primary" data-testid="member-vdeck-highlights">
                        <span className="text-[12px] font-semibold uppercase leading-4 tracking-[0.04em]">Highlights</span>
                        <span className="flex items-center gap-1.5 text-[16px] leading-[22px]"><Play className="h-4 w-4 fill-current" strokeWidth={0} aria-hidden="true" /> Watch</span>
                      </button>
                    )}
                  </div>
                )}
              </>
            ) : (
              p.facts.map((f) => <DetailTile key={f.label} label={f.label} value={f.value} />)
            )}
            {p.about && <p className="whitespace-pre-line text-[16px] leading-[22px] text-ink-1">{p.about}</p>}
            {p.panelActions && <div className="flex gap-2.5 pt-1">{p.panelActions}</div>}
            <button
              type="button"
              onClick={p.onViewProfile}
              className="mx-auto flex min-h-[44px] items-center gap-1 px-2 text-[14px] font-semibold text-hockia-primary"
              data-testid="member-preview-full-profile"
            >
              See full profile <ChevronRight className="h-4 w-4" strokeWidth={2} aria-hidden="true" />
            </button>
          </div>
        </div>
      )}
      {p.sheets}
    </div>
  )
}

function DetailTile({ label, value, detail = null }: { label: string; value: string; detail?: string | null }) {
  return (
    <div className="flex flex-col gap-[3px] rounded-[14px] bg-surface-muted px-3.5 py-2.5">
      <span className="text-[12px] font-semibold uppercase leading-4 tracking-[0.04em] text-ink-2">{label}</span>
      <span className="text-[16px] leading-[22px] text-ink-1">{value}</span>
      {detail && <span className="text-[13px] leading-[18px] text-ink-2">{detail}</span>}
    </div>
  )
}

// ── Desktop (≥ 1024 px): the deck with arrows (ruling 2026-10-21, design audit
// B2). The same member data and detail tiles as the phone panel, a photo
// column, ‹ › arrows, "3 of N", Esc to close, ← / → to page, and a footer
// action bar (Primary by relationship, Message, See full profile).

/** One member on the desktop deck: photo column + details + footer actions. */
function DesktopPage(p: ImmersivePageProps) {
  const nationalityNames = p.nationalities.map((c) => [c.flag, c.name].filter(Boolean).join(' ')).join(' · ')
  return (
    <div className="flex h-full w-full overflow-hidden bg-white" data-member-id={p.member.id} data-testid="member-desktop-page">
      {/* Photo column */}
      <div className="relative h-full w-[44%] max-w-[440px] shrink-0 overflow-hidden" style={{ backgroundImage: p.noPhotoBackground }}>
        {p.current ? (
          <img
            key={p.current}
            ref={(el) => { if (el?.complete && el.naturalWidth > 0) p.setShownSrc(p.current!) }}
            src={getImageUrl(p.current, 'feed-full') ?? p.current}
            alt=""
            className={`absolute inset-0 h-full w-full object-cover transition-opacity duration-200 ${p.shownSrc === p.current ? 'opacity-100' : 'opacity-0'}`}
            decoding="async"
            onError={() => p.markFailed(p.current!)}
            onLoad={(e) => {
              if (p.isClub && e.currentTarget.naturalWidth > 0 && e.currentTarget.naturalWidth < 600) p.markFailed(p.current!)
              else p.setShownSrc(p.current!)
            }}
          />
        ) : (
          <span aria-hidden="true" className="absolute inset-0">
            <img src={pitchVertical} alt="" className="absolute inset-0 h-full w-full" />
            {p.isClub && p.crest ? (
              <LogoTile src={p.crest} name={p.name} eager className={`absolute left-1/2 top-1/2 h-[150px] w-[150px] -translate-x-1/2 -translate-y-1/2 rounded-[32px] p-3.5 ${LIGHT_SHADOW}`} initialsClassName="text-[44px]" />
            ) : p.brandLogo ? (
              <LogoTile src={getImageUrl(p.brandLogo, 'avatar-lg') ?? p.brandLogo} name={p.name} eager className="absolute left-1/2 top-1/2 h-[140px] w-[140px] -translate-x-1/2 -translate-y-1/2 rounded-[28px] p-4" initialsClassName="text-[40px]" />
            ) : (
              <span className="absolute left-1/2 top-1/2 flex h-[140px] w-[140px] -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full border-[1.5px] border-white/40 bg-white/[0.14] text-[52px] font-bold text-white">
                {initialsOf(p.name)}
              </span>
            )}
          </span>
        )}
        <span aria-hidden="true" className="pointer-events-none absolute inset-x-0 top-0 h-[120px]" style={{ backgroundImage: TOP_SCRIM }} />
        {p.shownCount > 1 && (
          <>
            <button type="button" aria-label="Previous photo" onClick={() => p.stepPhoto(-1)} className="absolute inset-y-0 left-0 w-1/2 cursor-w-resize" />
            <button type="button" aria-label="Next photo" onClick={() => p.stepPhoto(1)} className="absolute inset-y-0 right-0 w-1/2 cursor-e-resize" />
            <div aria-hidden="true" className="absolute inset-x-4 top-4 flex gap-1">
              {Array.from({ length: p.shownCount }, (_, i) => (
                <span key={i} className={`h-[3px] flex-1 rounded-[2px] ${i === p.photoIndex ? 'bg-white/95' : 'bg-white/[0.35]'}`} />
              ))}
            </div>
          </>
        )}
        {p.menu && <div className="absolute right-4 top-6">{p.menu}</div>}
        {(p.fitPill || p.incomingRequest) && (
          <div className="pointer-events-none absolute inset-x-4 bottom-4 flex flex-col items-start gap-1.5">
            {p.fitPill}
            {p.incomingRequest && (
              <span className={`inline-flex items-center gap-1.5 rounded-full bg-[rgba(15,15,20,0.55)] px-2.5 py-[5px] ${GLASS}`}>
                <span className="h-[7px] w-[7px] rounded-full bg-brand-soft" aria-hidden="true" />
                <span className="text-[12px] font-semibold leading-4 text-white">Sent you a friend request</span>
              </span>
            )}
          </div>
        )}
      </div>

      {/* Details + footer action bar */}
      <div className="flex min-w-0 flex-1 flex-col">
        <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto overscroll-contain px-7 pb-5 pt-7" data-testid="member-desktop-details">
          <div className="flex items-center gap-3 pr-12">
            {p.isClub && p.current && p.crest && (
              <LogoTile src={p.crest} name={p.name} eager className="h-14 w-14 shrink-0 rounded-[16px] border border-line p-[5px]" initialsClassName="text-[18px]" />
            )}
            <div className="flex min-w-0 flex-col gap-0.5">
              <h2 className="line-clamp-2 text-[28px] font-bold leading-[34px] tracking-[-0.01em] text-ink-1">{p.title}</h2>
              {p.idLine && <p className="line-clamp-2 text-[16px] leading-[22px] text-ink-2">{p.idLine}</p>}
            </div>
          </div>
          {p.isPerson ? (
            <>
              {p.playsAt && <DetailTile label={p.playsAt.label} value={p.playsAt.value} detail={p.playsAt.detail} />}
              {p.nationalities.length > 0 && (
                <div className="flex flex-col gap-[3px] rounded-[14px] bg-surface-muted px-3.5 py-2.5">
                  <span className="text-[12px] font-semibold uppercase leading-4 tracking-[0.04em] text-ink-2">Nationalities and passports</span>
                  <span className="text-[16px] leading-[22px] text-ink-1">{nationalityNames}</span>
                  {hasEuPassport(p.nationalities) && (
                    <span className="mt-0.5 flex items-center gap-1.5 text-[12px] leading-4 text-ink-2"><EuBadge surface="light" /> EU passport</span>
                  )}
                </div>
              )}
              {p.place && <DetailTile label="Based in" value={p.place} />}
              {(p.references > 0 || p.hasHighlights) && (
                <div className="flex gap-2">
                  {p.references > 0 && (
                    <div className="flex min-w-0 flex-1 flex-col gap-[3px] rounded-[14px] bg-gold-soft px-3.5 py-2.5" data-testid="member-desktop-references">
                      <span className="text-[12px] font-semibold uppercase leading-4 tracking-[0.04em] text-gold">References</span>
                      <span className="text-[16px] leading-[22px] text-ink-1">{p.references} accepted</span>
                    </div>
                  )}
                  {p.hasHighlights && (
                    <button type="button" onClick={p.onViewProfile} className="flex min-h-[44px] min-w-0 flex-1 flex-col items-start gap-[3px] rounded-[14px] bg-hockia-soft px-3.5 py-2.5 text-left text-hockia-primary">
                      <span className="text-[12px] font-semibold uppercase leading-4 tracking-[0.04em]">Highlights</span>
                      <span className="flex items-center gap-1.5 text-[16px] leading-[22px]"><Play className="h-4 w-4 fill-current" strokeWidth={0} aria-hidden="true" /> Watch</span>
                    </button>
                  )}
                </div>
              )}
            </>
          ) : (
            p.facts.map((f) => <DetailTile key={f.label} label={f.label} value={f.value} />)
          )}
          {p.about && <p className="line-clamp-6 whitespace-pre-line text-[16px] leading-[22px] text-ink-1">{p.about}</p>}
        </div>
        <div className="shrink-0 border-t border-line px-7 py-4" data-testid="member-preview-actions">
          <div className="flex items-center gap-2.5">
            {p.panelActions && <div className="flex min-w-0 flex-1 gap-2.5">{p.panelActions}</div>}
            <button
              type="button"
              onClick={p.onViewProfile}
              className={`flex h-12 shrink-0 items-center gap-1 rounded-full px-4 text-[15px] font-semibold text-hockia-primary hover:bg-brand-soft ${p.panelActions ? '' : 'mx-auto'}`}
              data-testid="member-preview-full-profile"
            >
              See full profile <ChevronRight className="h-4 w-4" strokeWidth={2} aria-hidden="true" />
            </button>
          </div>
          {p.messageBlockedReason && (
            <p id="member-preview-message-note" className="mt-2 text-[13px] leading-[18px] text-ink-2">{p.messageBlockedReason}</p>
          )}
        </div>
      </div>
      {p.sheets}
    </div>
  )
}

/**
 * Desktop deck shell: the card centred on a dim, ‹ › arrows either side,
 * "3 of N" under it. Esc closes; ← / → page; a click on the dim closes. A
 * single preview (no list) has no arrows or pager. Past the last member:
 * "You've seen everyone". Same DB events as the phone deck.
 */
function DesktopMemberDeck(props: MemberFullPreviewProps & { deck?: MemberPreviewDeck }) {
  const { onClose, onBlocked } = props
  const deck = props.deck
  const members = useMemo(() => deck?.members ?? [props.member], [deck?.members, props.member])
  const containerRef = useRef<HTMLDivElement>(null)
  const [nested, setNested] = useState(false)
  const [index, setIndex] = useState(() => Math.min(Math.max(deck?.startIndex ?? 0, 0), Math.max(members.length - 1, 0)))
  const paged = Boolean(deck) && members.length > 1
  const atEnd = paged && index >= members.length
  const member = atEnd ? null : members[index] ?? props.member

  useBodyScrollLock(true)
  useFocusTrap({ containerRef, isActive: !nested })

  const seen = useRef(new Set<string>())
  useEffect(() => {
    trackDbEvent('member_preview_open', 'profile', member?.id, { source: deck ? 'grid' : 'single', context: deck?.contextLabel ?? null, surface: 'desktop' })
    const seenSet = seen.current
    return () => { trackDbEvent('member_preview_depth', 'community', undefined, { members_seen: seenSet.size }) }
    // Once per deck open.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  useEffect(() => { if (member) seen.current.add(member.id) }, [member])

  // Warm the neighbours so an arrow lands on a loaded card.
  useEffect(() => {
    if (!paged) return
    const near = [-1, 1, 2].map((d) => members[index + d]).filter((m): m is Profile => Boolean(m))
    void prefetchFriendsInCommon(near.filter((m) => m.role !== 'club' && m.role !== 'brand').map((m) => m.id))
    void prefetchMemberPhotos(near.map((m) => m.id)).then(() => {
      for (const m of near) preloadImage(firstPhotoOf(m))
    })
  }, [paged, index, members])

  const go = useCallback((dir: 1 | -1) => {
    if (!paged) return
    const next = index + dir
    if (next < 0 || next > members.length) return
    trackDbEvent('member_preview_swipe', 'profile', members[next]?.id, { direction: dir > 0 ? 'next' : 'prev' })
    setIndex(next)
  }, [paged, index, members])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (nested || !isTopFocusTrap(containerRef.current)) return
      if (e.key === 'Escape') { e.preventDefault(); onClose() }
      else if (e.key === 'ArrowRight') { e.preventDefault(); go(1) }
      else if (e.key === 'ArrowLeft') { e.preventDefault(); go(-1) }
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [go, onClose, nested])

  const arrow = 'relative flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-white text-ink-1 shadow-[0_4px_16px_rgba(41,16,96,0.18)] transition-opacity hover:bg-surface-subtle disabled:pointer-events-none disabled:opacity-0'

  return createPortal(
    <div
      ref={containerRef}
      role="dialog"
      aria-modal="true"
      aria-label={member ? `${member.full_name?.trim() || 'Member'} preview${paged ? `, ${index + 1} of ${members.length}` : ''}` : 'End of the list'}
      tabIndex={-1}
      data-testid="member-preview"
      data-deck="desktop"
      className="fixed inset-0 z-50 flex flex-col items-center justify-center gap-3 px-6 py-6 animate-fade-in focus:outline-none"
    >
      <div aria-hidden="true" onClick={onClose} className="absolute inset-0 bg-black/60" data-testid="member-deck-dim" />
      {deck?.contextLabel && (
        <p className="relative text-[13px] font-semibold leading-[18px] text-white/80" data-testid="member-deck-context">{deck.contextLabel}</p>
      )}
      <div className="pointer-events-none relative flex w-full items-center justify-center gap-4">
        {paged && (
          <button type="button" onClick={() => go(-1)} disabled={index === 0} aria-label="Previous member" className={`pointer-events-auto ${arrow}`} data-testid="member-deck-prev">
            <ChevronLeft className="h-6 w-6" strokeWidth={2} />
          </button>
        )}
        <div
          className="pointer-events-auto relative flex h-[min(680px,calc(100dvh-140px))] w-[min(960px,calc(100vw-176px))] overflow-hidden rounded-[24px] bg-white shadow-[0_24px_64px_rgba(15,15,20,0.35)]"
          data-testid="member-deck-card"
        >
          {member ? (
            <MemberPreviewBody
              key={member.id}
              member={member}
              onClose={onClose}
              age={deck?.ageOf?.(member.id) ?? (member.id === props.member.id ? props.age ?? null : null)}
              fit={deck?.fitOf?.(member.id) ?? (member.id === props.member.id ? props.fit ?? null : null)}
              crestColor={deck?.crestOf?.(member.id) ?? (member.id === props.member.id ? props.crestColor ?? null : null)}
              onBlocked={onBlocked}
              onNestedModal={setNested}
              desktop
              contextLabel={deck?.contextLabel}
            />
          ) : (
            <div className="flex h-full w-full flex-col">
              <DeckEnd onAdjustFilters={() => { onClose(); deck?.onAdjustFilters?.() }} onBack={onClose} />
            </div>
          )}
          <button type="button" onClick={onClose} aria-label="Close preview" className="absolute right-4 top-4 z-10 flex h-11 w-11 items-center justify-center rounded-full bg-surface-muted text-ink-1 hover:bg-line" data-testid="member-preview-close">
            <X className="h-5 w-5" strokeWidth={2} />
          </button>
        </div>
        {paged && (
          <button type="button" onClick={() => go(1)} disabled={atEnd} aria-label="Next member" className={`pointer-events-auto ${arrow}`} data-testid="member-deck-next">
            <ChevronRight className="h-6 w-6" strokeWidth={2} />
          </button>
        )}
      </div>
      {paged && (
        <p className="relative text-[13px] font-semibold leading-[18px] tabular-nums text-white/90" data-testid="member-deck-pager" aria-live="polite">
          {Math.min(index + 1, members.length)} of {members.length}
        </p>
      )}
    </div>,
    document.body,
  )
}

/** Figma notes: the deck spring (response 0.48 · damping 0.82). */
const VDECK_SPRING = { response: 0.48, damping: 0.82 } as const
const VDECK_HINT_KEY = 'hockia.community.vdeckHintSeen'
/** A release past this share of the screen (or a flick) moves to the next member. */
const VDECK_PAGE_SHARE = 0.18
const VDECK_CLOSE_DISTANCE = 110

/**
 * Phones: swipe up = next member, down = previous, one per screen with snap.
 * Dragging down past the first member closes the deck (as today). Photo
 * steps stay on taps (left / right half). The action bar fades while the
 * finger moves. First open only: "Swipe up for the next member" for 2 s.
 * Android: the system back closes the deck.
 */
function VerticalMemberDeck(props: MemberFullPreviewProps & { deck: MemberPreviewDeck }) {
  const { deck, onClose, onBlocked } = props
  const members = deck.members
  const containerRef = useRef<HTMLDivElement>(null)
  const stripRef = useRef<HTMLDivElement>(null)
  const [nested, setNested] = useState(false)
  const [detailsOpen, setDetailsOpen] = useState(false)
  const [index, setIndex] = useState(() => Math.min(Math.max(deck.startIndex, 0), Math.max(members.length - 1, 0)))
  const atEnd = index >= members.length
  const member = atEnd ? null : members[index]
  const [height, setHeight] = useState(() => (typeof window !== 'undefined' ? window.innerHeight : 852))

  useEffect(() => {
    void setStatusBarForBackground('dark-bg')
    return () => { void setStatusBarForBackground('light-bg') }
  }, [])
  useBodyScrollLock(true)
  useFocusTrap({ containerRef, isActive: !nested })
  useLayoutEffect(() => {
    const el = containerRef.current
    if (!el) return
    const measure = () => setHeight(el.clientHeight || window.innerHeight)
    measure()
    window.addEventListener('resize', measure)
    return () => window.removeEventListener('resize', measure)
  }, [])

  // Measurement (DB event log: GA4 is skipped inside the native apps).
  const seen = useRef(new Set<string>())
  useEffect(() => {
    const first = members[Math.min(Math.max(deck.startIndex, 0), members.length - 1)]
    trackDbEvent('member_preview_open', 'profile', first?.id, { source: 'grid', context: deck.contextLabel })
    const seenSet = seen.current
    return () => { trackDbEvent('member_preview_depth', 'community', undefined, { members_seen: seenSet.size }) }
    // Once per deck open.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  useEffect(() => { if (member) seen.current.add(member.id) }, [member])

  // Preload: the next members' data and first photos, so a swipe never shows black.
  useEffect(() => {
    const near = [-1, 1, 2, 3].map((d) => members[index + d]).filter((m): m is Profile => Boolean(m))
    void prefetchFriendsInCommon(near.filter((m) => m.role !== 'club' && m.role !== 'brand').map((m) => m.id))
    void prefetchMemberPhotos(near.map((m) => m.id)).then(() => {
      for (const m of near) preloadImage(firstPhotoOf(m))
    })
  }, [index, members])

  // ── Strip position (px). The spring runs in PAGES (1 = one screen): its
  // settle thresholds are tuned for unit-scale values, so in px a landing
  // took seconds to "finish". React re-renders only when a page lands.
  const offset = useRef(0)
  const heightRef = useRef(height)
  heightRef.current = height
  const spring = useRef<SpringValue | null>(null)
  const applyOffset = useCallback((y: number) => {
    offset.current = y
    if (stripRef.current) stripRef.current.style.transform = `translate3d(0, ${y}px, 0)`
  }, [])
  useEffect(() => {
    spring.current = springValue(0, (pages) => applyOffset(pages * heightRef.current))
    return () => { if (spring.current) stopSpring(spring.current) }
  }, [applyOffset])
  // After the index moves, the landed page is the same element one slot over: rest at 0 in the same frame.
  useLayoutEffect(() => {
    if (spring.current) { stopSpring(spring.current); spring.current.x = 0; spring.current.v = 0 }
    applyOffset(0)
  }, [index, applyOffset])
  const settling = useRef(false)
  const setDragging = (on: boolean) => { if (containerRef.current) containerRef.current.dataset.dragging = on ? 'true' : 'false' }

  // ── One-time hint
  const [hint, setHint] = useState(false)
  const hintTimer = useRef<number | null>(null)
  const endHint = useCallback(() => {
    if (hintTimer.current !== null) { window.clearTimeout(hintTimer.current); hintTimer.current = null }
    setHint((shown) => {
      if (shown) { try { window.localStorage.setItem(VDECK_HINT_KEY, '1') } catch { /* private mode */ } }
      return false
    })
  }, [])
  useEffect(() => {
    if (members.length < 2) return
    let seenHint = false
    try { seenHint = window.localStorage.getItem(VDECK_HINT_KEY) === '1' } catch { /* private mode */ }
    if (seenHint) return
    setHint(true)
    hintTimer.current = window.setTimeout(endHint, 2000)
    return () => { if (hintTimer.current !== null) window.clearTimeout(hintTimer.current) }
  }, [members.length, endHint])

  const go = useCallback((dir: 1 | -1, v?: number) => {
    const next = index + dir
    if (settling.current || next < 0 || next > members.length || !spring.current) return
    trackDbEvent('member_preview_swipe', 'profile', members[next]?.id, { direction: dir > 0 ? 'next' : 'prev' })
    endHint()
    settling.current = true
    spring.current.x = offset.current / height
    animateSpring(spring.current, -dir, {
      ...VDECK_SPRING,
      v: v === undefined ? undefined : v / height,
      onDone: () => {
        settling.current = false
        setDragging(false)
        void hapticSelection()
        setIndex(next)
      },
    })
  }, [index, members, height, endHint])
  const snapBack = useCallback(() => {
    if (!spring.current) return
    spring.current.x = offset.current / heightRef.current
    animateSpring(spring.current, 0, { ...VDECK_SPRING, onDone: () => setDragging(false) })
  }, [])

  // Keyboard and Android back
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!isTopFocusTrap(containerRef.current) || detailsOpen) return
      if (e.key === 'Escape') onClose()
      if (e.key === 'ArrowDown') go(1)
      if (e.key === 'ArrowUp') go(-1)
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [go, onClose, detailsOpen])
  useEffect(() => {
    if (Capacitor.getPlatform() !== 'android') return
    const sub = CapacitorApp.addListener('backButton', () => onClose())
    return () => { void sub.then((h) => h.remove()) }
  }, [onClose])

  // ── Gestures
  const touch = useRef<{ x: number; y: number; t: number; axis: 'x' | 'y' | null } | null>(null)
  const moved = useRef(false)
  const onTouchStart = (e: React.TouchEvent) => {
    if (settling.current || detailsOpen || nested) return
    if ((e.target as HTMLElement).closest('[data-vdeck-panel]')) return
    touch.current = { x: e.touches[0].clientX, y: e.touches[0].clientY, t: performance.now(), axis: null }
    moved.current = false
  }
  const onTouchMove = (e: React.TouchEvent) => {
    const s0 = touch.current
    if (!s0) return
    const mx = e.touches[0].clientX - s0.x
    const my = e.touches[0].clientY - s0.y
    if (!s0.axis) {
      if (Math.abs(mx) < 8 && Math.abs(my) < 8) return
      if (Math.abs(mx) > Math.abs(my)) { touch.current = null; return }
      s0.axis = 'y'
      setDragging(true)
      if (spring.current) stopSpring(spring.current)
    }
    moved.current = true
    if (hint) endHint()
    // Past the last page the strip resists; past the first it follows (to close).
    const resist = atEnd && my < 0
    applyOffset(resist ? my / 3 : my)
  }
  const onTouchEnd = () => {
    const s0 = touch.current
    touch.current = null
    if (!s0?.axis) return
    const y = offset.current
    const dt = Math.max(performance.now() - s0.t, 1)
    const velocity = (y / dt) * 1000
    const flick = Math.abs(y) > 30 && Math.abs(velocity) > 500
    if ((y <= -height * VDECK_PAGE_SHARE || (flick && y < 0)) && !atEnd) go(1, velocity)
    else if ((y >= height * VDECK_PAGE_SHARE || (flick && y > 0)) && index > 0) go(-1, velocity)
    else if (index === 0 && y > VDECK_CLOSE_DISTANCE) onClose()
    else snapBack()
  }
  // A drag must not also count as a tap on the photo halves.
  const onClickCapture = (e: React.MouseEvent) => {
    if (moved.current) { e.stopPropagation(); e.preventDefault(); moved.current = false }
  }

  const slots = [index - 1, index, index + 1].filter((k) => k >= 0 && k <= members.length)

  return createPortal(
    <div
      ref={containerRef}
      role="dialog"
      aria-modal="true"
      aria-label={member ? `${member.full_name?.trim() || 'Member'} preview, ${index + 1} of ${members.length}` : 'End of the list'}
      tabIndex={-1}
      data-testid="member-preview"
      data-deck="vertical"
      data-dragging="false"
      className="group fixed inset-0 z-50 overflow-hidden bg-surface-inverse animate-fade-in"
      onTouchStart={onTouchStart}
      onTouchMove={onTouchMove}
      onTouchEnd={onTouchEnd}
      onTouchCancel={onTouchEnd}
      onClickCapture={onClickCapture}
    >
      <div ref={stripRef} className="absolute inset-0 will-change-transform">
        {slots.map((k) => {
          const isEnd = k === members.length
          const isActive = k === index
          return (
            <div
              key={isEnd ? 'end' : members[k].id}
              inert={!isActive}
              aria-hidden={!isActive || undefined}
              className="absolute inset-x-0 flex flex-col"
              style={{ top: (k - index) * height, height }}
              data-testid={isActive ? 'member-deck-card' : undefined}
            >
              {isEnd ? (
                <div className="flex h-full flex-col bg-white pb-[max(env(safe-area-inset-bottom),12px)] pt-[env(safe-area-inset-top)]">
                  <DeckEnd onAdjustFilters={() => { onClose(); deck.onAdjustFilters?.() }} onBack={onClose} />
                </div>
              ) : (
                <MemberPreviewBody
                  member={members[k]}
                  onClose={onClose}
                  age={deck.ageOf?.(members[k].id) ?? null}
                  fit={deck.fitOf?.(members[k].id) ?? null}
                  crestColor={deck.crestOf?.(members[k].id) ?? null}
                  onBlocked={onBlocked}
                  onNestedModal={isActive ? setNested : undefined}
                  active={isActive}
                  immersive
                  contextLabel={deck.contextLabel}
                  onDetailsChange={isActive ? setDetailsOpen : undefined}
                />
              )}
            </div>
          )
        })}
      </div>
      {hint && (
        <div className="pointer-events-none absolute left-1/2 top-[calc(env(safe-area-inset-top)+72px)] z-20 flex -translate-x-1/2 items-center gap-2 rounded-full bg-white px-4 py-2 shadow-lg animate-fade-in" role="status" data-testid="member-vdeck-hint">
          <ChevronUp className="h-4 w-4 text-hockia-primary" strokeWidth={2.2} aria-hidden="true" />
          <span className="whitespace-nowrap text-[13px] font-semibold leading-[18px] text-ink-1">Swipe up for the next member</span>
        </div>
      )}
    </div>,
    document.body,
  )
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
