import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { personActionGate, useAmbassadorInvite } from '@/lib/ambassadorInvite'
import { BetaPill } from '@/components/hockiaAi/BetaPill'
import { useNavigate } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { Check, ExternalLink, MessageCircle, Plus, Sparkles, Star, UserPlus } from 'lucide-react'
import { useHockiaAiSheet } from '@/components/hockiaAi/hockiaAiSheetStore'

import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/lib/auth'
import { useToastStore } from '@/lib/toast'
import { logger } from '@/lib/logger'
import { useCountries } from '@/hooks/useCountries'
import { useFriendship } from '@/hooks/useFriendship'
import { useFriendsInCommonSummary } from '@/hooks/useFriendsInCommonBatch'
import { useTrustedReferences } from '@/hooks/useTrustedReferences'
import { useWeeklyVisibility } from '@/hooks/useWeeklyVisibility'
import { useSearchAppearances } from '@/hooks/useSearchAppearances'
import { useVideoAccessSummary } from '@/hooks/useVideoAccessSummary'
import { useProfileScrollData, type ScrollVideo } from '@/hooks/useProfileScrollData'
import { useRolesHealth } from '@/hooks/useRolesHealth'
import type { ClubOpenRole } from '@/hooks/useClubProfileScrollData'
import { isRecruiterProfile, fullMatchVisibilityOf, canViewLinkedHighlight } from '@/lib/recruiter'
import { displayPlace } from '@/lib/communityCard'
import { basedInLine, nationalityCountries } from '@/lib/nationality'
import { NationalitiesTile } from '@/components/ui/NationalityBadges'
import { humanizeToken, positionLabel } from '@/lib/identity'
import { categoryToDisplay } from '@/lib/hockeyCategories'
import { RELOCATION_LABEL } from '@/lib/candidateIntent'
import { careerSpan, flagForCountryName, isCurrentEntry } from '@/lib/careerCopy'
import { fitChipLabel, type FitState } from '@/lib/clubRecruiting'
import { publicProfileShareUrl } from '@/lib/profileShare'
import { dayFirst } from '@/lib/dayFirst'
import { sponsorLabel, instagramHandle, nextStepPart, NEXT_STEP_COPY, sameBrandName, type CompletenessPart } from '@/lib/profileV2'
import type { KeyFact } from '@/lib/keyFacts'
import ProfileActionMenu from '@/components/ProfileActionMenu'
import { MediaLightbox } from '@/components/home/MediaLightbox'
import { EntityAvatar } from '@/components/ui/EntityAvatar'
import { SquircleBox } from '@/components/home/v1/primitives'
import { GLASS } from '@/lib/communityCard'
import { ProfileVideoTile } from '@/components/profile/mobile/ProfileVideoTile'
import { VideoAccessSheets, type VideoBlock } from '@/components/profile/mobile/VideoAccessSheets'
import type { PlayerProfileShape } from '@/pages/PlayerDashboard'
import { cn } from '@/lib/utils'
import { ProfileHero } from './ProfileHero'
import { CompactHeader, SectionAnchors } from './ProfileChrome'
import { useScrolledPast } from './profileChromeHooks'
import { OwnerButtons, PrimaryCard, PrivateStats, RecruitingCard } from './OwnerArea'
import { type ActionBarButton } from './ProfileActionBar'
import { ProfileLayout } from './ProfileLayout'
import { Chip, CommentsPreview, FacesRow, FactTile, PostsPhotosGrid, RoleRow, Section, type GridTile } from './ProfileSections'
import { safeVideoHref } from '@/lib/videoUrlValidator'

/**
 * Profile v2 — player, phone (Figma t24oVt… PR1 public 97:4 · PR2 own 101:46 ·
 * PR4 recruiter view 105:364; spec 132:1000). One scroll with sticky anchors:
 * Hero → (own: Edit / Preview → one next step → private stats) → Overview →
 * Videos → References → Career → Posts & photos → Comments → About, and a
 * fixed action bar on someone else's profile. Every fact appears once.
 * Video privacy, recruiter actions and the club-view cards keep the rules of
 * the profile they replace (ProfileLongScroll / HeroIdentityCard).
 */
export interface RecruiterProps {
  /** Club or recruiting coach looking at this player (or "View as club"). */
  enabled: boolean
  preview?: boolean
  fit?: { state: FitState } | null
  fitRoleTitle?: string | null
  shortlisted?: boolean
  busy?: boolean
  onShortlist?: () => void
}

export interface PlayerProfileV2Props {
  profile: PlayerProfileShape
  readOnly: boolean
  isOwnProfile: boolean
  facts: KeyFact[]
  currentClubLogo: string | null
  recruiter: RecruiterProps
  /** Club view cards (Applied to …, Fit for this role) — placed after the facts. */
  clubViewSlot?: ReactNode
  onMessage: () => void
  sendingMessage: boolean
  onEdit: (field?: string) => void
  onOpenSection: (section: string) => void
  onOpenReferences: () => void
  onOpenReference: (id: string) => void
  onViewPublic: () => void
  onViewAsClub: () => void
  onVideoCounts?: (counts: { total: number; highlights: number; fullMatches: number }) => void
  /** Coach (PR8 / PR12): roles this coach posted → Post a role / Review applicants. */
  onPostRole?: () => void
  onOpenRoles?: () => void
}

const ANCHORS_PUBLIC = [
  { id: 'overview', label: 'Overview' },
  { id: 'roles', label: 'Open opportunities' },
  { id: 'videos', label: 'Videos' },
  { id: 'references', label: 'References' },
  { id: 'career', label: 'Career' },
  { id: 'posts', label: 'Posts' },
  { id: 'about', label: 'About' },
]

function fact(facts: KeyFact[], id: string): KeyFact | undefined {
  return facts.find((f) => f.id === id)
}

export default function PlayerProfileV2(props: PlayerProfileV2Props) {
  const { profile, readOnly, isOwnProfile, facts, recruiter } = props
  const navigate = useNavigate()
  const addToast = useToastStore((s) => s.addToast)
  const viewer = useAuthStore((s) => s.profile)
  // Brands have followers, not friends (audit A7): Message (Primary) + Invite as ambassador (Tonal, players only).
  const personGate = personActionGate(viewer?.role, profile.role)
  const ambassador = useAmbassadorInvite(personGate.inviteAmbassador && readOnly && !isOwnProfile ? profile.id : null, addToast)
  const signedIn = useAuthStore((s) => Boolean(s.user))
  const owner = !readOnly
  const visitor = readOnly && !isOwnProfile
  const profileId = profile.id ?? null
  const { countries } = useCountries()
  const data = useProfileScrollData(profileId)
  // "Fill my profile with Hockia AI" (ruling 2026-10-18): the owner opens the
  // builder from a thin Career section; after "Save all" the list reloads.
  const showAi = useHockiaAiSheet((st) => st.show)
  const refreshScroll = data.refresh
  useEffect(() => {
    const onUpdated = () => refreshScroll()
    window.addEventListener('hockia:profile-updated', onUpdated)
    return () => window.removeEventListener('hockia:profile-updated', onUpdated)
  }, [refreshScroll])
  const { acceptedReferences, loading: refsLoading } = useTrustedReferences(profileId ?? '')
  const friendship = useFriendship(profileId ?? '')
  const inCommon = useFriendsInCommonSummary(visitor ? profileId : null)
  const heroRef = useRef<HTMLDivElement>(null)
  const compact = useScrolledPast(heroRef)

  // ── Identity ────────────────────────────────────────────────────────────
  const name = profile.full_name?.trim() || 'Hockia member'
  const ageFact = fact(facts, 'age')
  const age = ageFact && !ageFact.missing ? Number.parseInt(ageFact.value, 10) || null : (profile.server_age ?? null)
  const positions = [profile.position, profile.secondary_position]
    .filter((v, i, self): v is string => Boolean(v) && self.indexOf(v) === i)
    .map((p) => humanizeToken(p) ?? p)
  // Coach (PR8): same scroll as the player, with coach facts and the roles
  // the coach posted; no Videos section unless the coach has videos.
  const isCoach = profile.role === 'coach'
  const coachSpec = isCoach ? fact(facts, 'specialization') : undefined
  const coachCats = isCoach ? fact(facts, 'categories') : undefined
  const category = isCoach
    ? (coachCats && !coachCats.missing ? coachCats.value : null)
    : categoryToDisplay(profile.playing_category) || null
  const roleLine = isCoach
    ? [coachSpec && !coachSpec.missing ? coachSpec.value : 'Coach', category].filter(Boolean).join(' · ')
    : [...positions, category].filter(Boolean).join(' · ') || 'Player'
  const recruitsForTeam = isCoach && Boolean((profile as { coach_recruits_for_team?: boolean | null }).coach_recruits_for_team)
  // A person's flag means nationality; the place is text ("Based in Santander, Spain") — 16 Oct 2026.
  const place = useMemo(() => basedInLine(displayPlace(profile.base_location ?? null, (profile as { base_country_id?: number | null }).base_country_id ?? null, countries)), [profile, countries])
  const nationalities = useMemo(() => nationalityCountries([profile.nationality_country_id, profile.nationality2_country_id], countries), [profile.nationality_country_id, profile.nationality2_country_id, countries])
  const instagram = instagramHandle((profile as { social_links?: unknown }).social_links)
  const minor = typeof age === 'number' && age < 18
  // Ruling 11 Oct: no fit pill and no Shortlist on an under-18 player.
  const showRecruiter = recruiter.enabled && !minor
  const fitLabel = showRecruiter && recruiter.fit ? fitChipLabel(recruiter.fit.state) : null
  const fitPill = fitLabel && recruiter.fit && recruiter.fit.state !== 'grey'
    ? { state: recruiter.fit.state, suffix: recruiter.fitRoleTitle ? `· ${recruiter.fitRoleTitle}` : null }
    : null

  // Hero photos: the gallery (first = cover), else the avatar.
  const photos = useMemo(() => {
    const urls = data.photos.map((p) => p.url).filter(Boolean)
    if (urls.length === 0 && profile.avatar_url) urls.push(profile.avatar_url)
    return urls.slice(0, 4)
  }, [data.photos, profile.avatar_url])

  const share = async () => {
    const url = profileId ? publicProfileShareUrl(profile.role, profileId, profile.username) : null
    if (!url) return
    try {
      if (navigator.share) { await navigator.share({ title: name, url }); return }
      await navigator.clipboard.writeText(url)
      addToast('Link copied', 'success')
    } catch (err) {
      if (!(err instanceof Error && err.name === 'AbortError')) logger.warn('[PlayerProfileV2] share failed', err)
    }
  }
  const back = () => (window.history.length > 1 ? navigate(-1) : navigate('/community'))

  // ── Own: next step + private stats ──────────────────────────────────────
  const completeness = useQuery({
    queryKey: ['profile-completeness', profileId],
    enabled: owner && Boolean(profileId),
    staleTime: 60_000,
    queryFn: async () => {
      const { data: res, error } = await supabase.rpc('get_my_profile_completeness')
      if (error) throw error
      return res as unknown as { pct: number; parts: CompletenessPart[] }
    },
  })
  const step = owner ? nextStepPart(completeness.data?.parts) : null
  const stepCopy = step ? NEXT_STEP_COPY[step.key] : null
  const runStep = () => {
    if (!stepCopy) return
    const a = stepCopy.action
    if (a.kind === 'edit') props.onEdit(a.field)
    else if (a.kind === 'leaf') props.onOpenSection(a.section)
    else navigate(a.to)
  }
  const vis = useWeeklyVisibility(owner, false)
  const searches = useSearchAppearances({ profileId: owner ? profileId : null })
  const stats = owner ? [
    { value: vis.visibility?.views_7d ?? 0, label: (vis.visibility?.views_7d ?? 0) === 1 ? 'profile view' : 'profile views' },
    { value: vis.visibility?.viewers_by_role?.club ?? 0, label: (vis.visibility?.viewers_by_role?.club ?? 0) === 1 ? 'club viewed' : 'clubs viewed' },
    { value: searches.summary?.total ?? 0, label: 'in searches' },
  ] : []

  // ── Videos (privacy kept from ProfileLongScroll) ────────────────────────
  const canWatchLocked = owner || isRecruiterProfile(viewer)
  const access = useVideoAccessSummary(profileId, { enabled: !owner })
  const lockFullMatches = owner
    ? fullMatchVisibilityOf(profile) === 'recruiters'
    : access.lockedFullMatches > 0 || data.fullMatches.some((v) => v.visibility === 'recruiters') || data.fullGameLinks.some((l) => l.visibility === 'recruiters')
  const lockedFull = owner ? 0 : access.lockedFullMatches
  const lockedHighlights = owner ? 0 : access.lockedHighlights
  const [videoBlock, setVideoBlock] = useState<VideoBlock>(null)
  const [player, setPlayer] = useState<ScrollVideo | null>(null)
  const openVideo = (v: ScrollVideo, locked: boolean) => {
    if (!signedIn && !owner) setVideoBlock('join')
    else if (locked && !canWatchLocked) setVideoBlock('locked')
    else setPlayer(v)
  }
  // Only an https link is ever opened (members write these; CodeQL 2026-10-23).
  const linkedHighlight = safeVideoHref(profile.highlight_video_url)
  const canOpenLinkedHighlight = canViewLinkedHighlight({ owner, profile, viewer })
  const highlightCount = data.highlights.length + (linkedHighlight ? 1 : 0) + lockedHighlights
  const fullMatchCount = data.fullMatches.length + data.fullGameLinks.length + lockedFull
  const videoTotal = highlightCount + fullMatchCount
  // Only what this viewer can play is shown (Figma review 11 Oct): locked
  // tiles are a dead grey row for most visitors. Signed-out tiles stay — they
  // ask to join, which is the point.
  const canPlay = (locked: boolean) => !locked || canWatchLocked
  const shownHighlights = data.highlights.filter((v) => canPlay(v.visibility === 'recruiters'))
  const shownFullMatches = data.fullMatches.filter((v) => canPlay(lockFullMatches || v.visibility === 'recruiters'))
  const shownLinked = Boolean(linkedHighlight && canOpenLinkedHighlight)
  const shownVideoCount = shownHighlights.length + (shownLinked ? 1 : 0) + shownFullMatches.length + data.fullGameLinks.length
  const videosHiddenFromViewer = !owner && shownVideoCount < videoTotal
  const { onVideoCounts } = props
  useEffect(() => {
    if (!data.loading) onVideoCounts?.({ total: videoTotal + data.reels.length, highlights: highlightCount, fullMatches: fullMatchCount })
  }, [data.loading, videoTotal, highlightCount, fullMatchCount, data.reels.length, onVideoCounts])

  // ── Sponsor badge (two sources, ruling 11 Oct) ──────────────────────────
  const confirmed = useQuery({
    queryKey: ['profile-ambassadorships', profileId],
    enabled: Boolean(profileId),
    staleTime: 5 * 60_000,
    queryFn: async () => {
      const { data: rows } = await supabase
        .from('brand_ambassadors')
        .select('brand:brands!inner(id, name, slug, logo_url, deleted_at)')
        .eq('player_id', profileId as string)
        .eq('status', 'accepted')
        .limit(3)
      return ((rows ?? []) as unknown as Array<{ brand: { id: string; name: string; slug: string; logo_url: string | null; deleted_at: string | null } }>)
        .map((r) => r.brand).filter((b) => b && !b.deleted_at)
    },
  })
  const selfDeclared = profile.brand_representation?.trim() || null
  const showSelfDeclared = selfDeclared && !(confirmed.data ?? []).some((b) => sameBrandName(b.name, selfDeclared)) && viewer?.role !== 'brand'

  // ── Overview facts ──────────────────────────────────────────────────────
  const playsAt = fact(facts, isCoach ? 'coaches_at' : 'plays_at')
  // "Plays at" opens the club's own profile when the club has claimed its
  // directory entry; the directory page otherwise (QA F6).
  const claimedClub = useQuery({
    queryKey: ['world-club-claimed', profile.current_world_club_id],
    enabled: Boolean(profile.current_world_club_id),
    staleTime: 10 * 60_000,
    queryFn: async () => {
      const { data: row } = await supabase.from('world_clubs').select('claimed_profile_id').eq('id', profile.current_world_club_id as string).maybeSingle()
      return (row?.claimed_profile_id as string | null | undefined) ?? null
    },
  })
  const available = fact(facts, 'available')
  const passport = fact(facts, 'passport')
  // Available follows the role's own open flag (Figma review 11 Oct): off →
  // visitors see no tile (Passport takes the row), the owner a quiet line;
  // on → "Open to coach" + the date for coaches, the player's season line.
  const openFlag = isCoach ? profile.open_to_coach === true : profile.open_to_play === true
  const availableTile: { value: string; detail: string | null; tone?: 'positive' | 'muted' } | null = !available
    ? null
    : !openFlag
      ? (owner ? { value: 'Not looking right now', detail: null, tone: 'muted' } : null)
      : isCoach
        ? { value: 'Open to coach', detail: !available.missing && available.value !== 'Open to coach' ? available.value : null, tone: 'positive' }
        // Open but no dates yet: say so, never "Not given" in green (QA F2).
        : available.missing
          ? { value: 'Open to play', detail: owner ? 'Add when you’re available' : null, tone: 'positive' }
          : { value: available.value, detail: available.detail, tone: 'positive' }
  const skills = isCoach ? [] : (profile.specialist_skills ?? []).filter(Boolean)
  const friendCount = profile.accepted_friend_count ?? 0
  const friendsPreview = useQuery({
    queryKey: ['profile-friend-faces', profileId],
    enabled: Boolean(profileId) && friendCount > 0 && !(visitor && inCommon.count > 0),
    staleTime: 5 * 60_000,
    queryFn: async () => {
      const { data: rows } = await supabase.rpc('get_profile_connections', { p_profile_id: profileId as string, p_limit: 3, p_offset: 0 })
      return ((rows ?? []) as Array<{ id: string; full_name: string | null; avatar_url: string | null; role: string | null }>)
    },
  })
  const friendText = visitor && inCommon.count > 0
    ? `${friendCount} ${friendCount === 1 ? 'friend' : 'friends'} · ${inCommon.count} in common with you`
    : `${friendCount} ${friendCount === 1 ? 'friend' : 'friends'}`
  const faces = visitor && inCommon.count > 0
    ? inCommon.people.map((p) => ({ id: p.id, full_name: p.fullName, avatar_url: p.avatarUrl, role: p.role }))
    : friendsPreview.data ?? []

  // ── Posts & photos (one grid, newest first; reels join it — ruling H31) ─
  const [photoIndex, setPhotoIndex] = useState<number | null>(null)
  const tiles: GridTile[] = useMemo(() => {
    const out: GridTile[] = []
    data.photos.forEach((p, i) => out.push({ kind: 'photo', id: p.id, url: p.url, at: p.createdAt ?? '', onOpen: () => setPhotoIndex(i) }))
    for (const post of data.posts) {
      const media = (post.images ?? []).filter((m) => m.url || m.thumb_url || m.video_id)
      const first = media[0]
      const url = first ? (first.media_type === 'video' ? first.thumb_url ?? null : first.url ?? null) : null
      out.push({ kind: 'post', id: post.post_id, url, text: post.content, multi: media.length > 1, video: media.some((m) => m.media_type === 'video'), at: post.created_at, onOpen: () => navigate(`/post/${post.post_id}`) })
    }
    for (const r of data.reels) out.push({ kind: 'reel', id: r.id, poster: null, at: '', onOpen: () => openVideo(r, false) })
    return out.sort((a, b) => (b.at || '').localeCompare(a.at || ''))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data.photos, data.posts, data.reels])
  const gridTotal = data.photoCount + data.postCount + data.reels.length

  // ── About ───────────────────────────────────────────────────────────────
  const bio = profile.bio?.trim() || null
  const [bioOpen, setBioOpen] = useState(false)
  const relocation = profile.relocation_willingness ? RELOCATION_LABEL[profile.relocation_willingness] ?? null : null

  const referenceCount = profile.accepted_reference_count ?? acceptedReferences.length
  const careerCount = profile.career_entry_count ?? data.career.length

  // ── Action bar ──────────────────────────────────────────────────────────
  const addFriend = () => {
    if (!signedIn) { navigate('/signup'); return }
    if (friendship.isIncomingRequest) void friendship.acceptRequest()
    else if (!friendship.isFriend && !friendship.isOutgoingRequest) void friendship.sendRequest()
  }
  const friendButton: ActionBarButton = friendship.isFriend
    ? { key: 'friend', label: 'Friends', icon: <Check className="h-5 w-5" strokeWidth={2.4} />, tone: 'done', disabled: true }
    : friendship.isOutgoingRequest
      ? { key: 'friend', label: 'Requested', icon: <Check className="h-5 w-5" strokeWidth={2.4} />, tone: 'secondary', disabled: true }
      : { key: 'friend', label: friendship.isIncomingRequest ? 'Accept' : 'Add friend', icon: <UserPlus className="h-5 w-5" strokeWidth={2} />, tone: 'primary', onClick: addFriend, disabled: friendship.mutating, testId: 'profile-add-friend' }
  const messageButton: ActionBarButton = { key: 'message', label: props.sendingMessage ? 'Opening…' : 'Message', icon: <MessageCircle className="h-5 w-5" strokeWidth={1.8} />, tone: 'secondary', onClick: recruiter.preview ? undefined : (signedIn ? props.onMessage : () => navigate('/signup')), disabled: props.sendingMessage, testId: 'profile-message' }
  const buttons: ActionBarButton[] = !readOnly ? [] : showRecruiter
    ? [
        { key: 'shortlist', label: recruiter.shortlisted ? 'Shortlisted' : 'Shortlist', icon: <Star className={cn('h-5 w-5', recruiter.shortlisted && 'fill-current')} strokeWidth={1.8} />, tone: recruiter.shortlisted ? 'done' : 'primary', onClick: recruiter.onShortlist, disabled: recruiter.busy, testId: 'profile-shortlist' },
        messageButton,
      ]
    : !personGate.addFriend
      ? [
          { ...messageButton, tone: 'primary' as const },
          ...(personGate.inviteAmbassador
            ? [{ key: 'ambassador', label: ambassador.label, icon: ambassador.state === 'sent' ? <Check className="h-5 w-5" strokeWidth={2.4} /> : undefined, tone: 'tonal' as const, onClick: () => void ambassador.invite(), disabled: ambassador.state !== 'idle', testId: 'profile-invite-ambassador' }]
            : []),
        ]
      : [friendButton, messageButton]
  // Recruiters: Add friend moves into ⋯ (Shortlist owns the primary button).
  const leadingMenuItems = showRecruiter && !friendship.isFriend && signedIn
    ? [{ key: 'friend', label: friendship.isOutgoingRequest ? 'Friend request sent' : friendship.isIncomingRequest ? 'Accept friend request' : 'Add friend', onSelect: addFriend, disabled: friendship.isOutgoingRequest || friendship.mutating }]
    : []

  // ── Coach: open roles this coach posted ─────────────────────────────────
  const coachRolesQ = useQuery({
    queryKey: ['coach-open-roles', profileId],
    enabled: isCoach && Boolean(profileId),
    staleTime: 60_000,
    queryFn: async (): Promise<ClubOpenRole[]> => {
      const { data: rows, error } = await supabase
        .from('opportunities')
        .select('id, title, position, gender, opportunity_type, start_date, duration_text, created_at, application_deadline')
        .eq('club_id', profileId as string)
        .eq('status', 'open')
        .order('created_at', { ascending: false })
        .limit(12)
      if (error) throw error
      return (rows ?? []).map((r) => ({ id: r.id, title: r.title, position: r.position, gender: r.gender, opportunityType: r.opportunity_type, startDate: r.start_date, durationText: r.duration_text, deadline: r.application_deadline, createdAt: r.created_at }))
    },
  })
  const coachRoles = coachRolesQ.data ?? []
  const coachHealth = useRolesHealth(owner && isCoach && (recruitsForTeam || coachRoles.length > 0))

  const anchors = ANCHORS_PUBLIC.filter((a) => (a.id === 'roles' ? isCoach && (coachRoles.length > 0 || (owner && recruitsForTeam)) : a.id === 'videos' ? (owner && !isCoach) || shownVideoCount > 0 : a.id === 'career' ? owner || careerCount > 0 : a.id === 'posts' ? owner || tiles.length > 0 : a.id === 'references' ? owner || referenceCount > 0 : a.id === 'about' ? owner || Boolean(bio) || Boolean(relocation) : true))

  // ⋯ (report / block) — in the hero and again in the compact header, so it
  // stays reachable after scrolling (PR10).
  const moreMenu = (triggerClassName: string) => (visitor && profileId ? (
    <ProfileActionMenu
      targetId={profileId}
      targetName={name}
      actionName={name.split(/\s+/)[0]}
      leadingItems={leadingMenuItems}
      triggerClassName={triggerClassName}
      iconClassName="h-[22px] w-[22px]"
    />
  ) : null)

  const dashed = (text: string, onClick: () => void) => (
    <div className="px-4">
      <button type="button" onClick={onClick} className="flex h-[88px] w-full items-center justify-center gap-2 rounded-[20px] border border-dashed border-hockia-primary/50 bg-hockia-soft/40 text-row font-semibold text-hockia-primary">
        <Plus className="h-5 w-5" strokeWidth={2.2} /> {text}
      </button>
    </div>
  )

  return (
    <div className="bg-white pb-8" data-testid="profile-v2">
      <CompactHeader name={name} avatarUrl={profile.avatar_url} visible={compact} owner={owner} onBack={back} onShare={() => void share()} right={moreMenu('flex h-11 w-11 items-center justify-center text-ink-1')} />

      <ProfileLayout actions={buttons} hero={<div ref={heroRef}>
        <ProfileHero
          photos={photos}
          name={name}
          age={age}
          roleLine={roleLine}
          place={place}
          nationalities={nationalities}
          instagram={instagram}
          // Coaches get the coach (teal) no-photo hero, never player blue (Batch C).
          role={isCoach ? 'coach' : 'player'}
          owner={owner}
          fitPill={fitPill}
          badge={recruitsForTeam ? 'Recruiting players' : null}
          onBack={back}
          onShare={() => void share()}
          onCamera={() => props.onOpenSection('media')}
          onSettings={() => navigate('/settings')}
          moreMenu={moreMenu(cn('flex h-11 w-11 items-center justify-center rounded-full border border-white/20 bg-[rgba(15,15,20,0.35)] text-white', GLASS))}
        />
      </div>}>

      {owner && (
        <>
          <OwnerButtons
            onEdit={() => props.onEdit()}
            previews={[
              { key: 'public', label: 'Someone on Hockia', detail: 'What players and coaches see', onSelect: props.onViewPublic },
              { key: 'club', label: 'A club', detail: 'With the fit for their role', onSelect: props.onViewAsClub },
            ]}
          />
          {stepCopy && step && (
            <PrimaryCard stepKey={step?.key ?? null} title={stepCopy.title} subtitle={stepCopy.subtitle} cta={stepCopy.cta} onAction={runStep} />
          )}
          {isCoach && (recruitsForTeam || coachRoles.length > 0) && props.onPostRole && (
            <div className="pt-3">
              <RecruitingCard
                pending={coachHealth.totals.pending}
                openRoleCount={coachRoles.length}
                roleNames={coachRoles.map((r) => positionLabel(r.position) || r.title)}
                hasNextStep={Boolean(stepCopy)}
                onReview={props.onOpenRoles ?? (() => navigate('/opportunities'))}
                onPostRole={props.onPostRole}
                testId="coach-recruiting-card"
              />
            </div>
          )}
          <PrivateStats stats={stats} />
        </>
      )}

      <SectionAnchors items={anchors} refreshKey={data.loading} />

      {/* Overview */}
      <section id="overview" className="scroll-mt-[120px] flex flex-col gap-2.5 px-4 pt-3" data-testid="profile-section-overview">
        {playsAt && !playsAt.missing && (
          <FactTile
            full
            label={isCoach ? 'Coaches at' : 'Plays at'}
            value={playsAt.value}
            detail={playsAt.detail}
            leading={<EntityAvatar src={props.currentClubLogo} name={playsAt.value} role="club" size={40} />}
            onClick={profile.current_world_club_id ? () => navigate(claimedClub.data ? `/clubs/id/${claimedClub.data}` : `/world/clubs/${profile.current_world_club_id}`) : undefined}
          />
        )}
        {/* Figma 189:61: nationalities, passports & permits full width, never truncated; permit lines follow the viewer rules in lib/keyFacts. */}
        {passport && (
          <NationalitiesTile
            nationalities={nationalities}
            permits={passport.extraLines.map((l) => ({ text: l.text, amber: l.status === 'expiring_soon' || l.status === 'expired' }))}
            onAdd={owner && passport.action === 'add_passport' ? () => props.onEdit() : null}
          />
        )}
        {availableTile && (
          <div className="flex gap-2.5">
            <FactTile label="Available" value={availableTile.value} detail={availableTile.detail} tone={availableTile.tone} />
          </div>
        )}
        {!isCoach && (skills.length > 0 || (confirmed.data?.length ?? 0) > 0 || showSelfDeclared) && (
          <div className="flex flex-wrap gap-2">
            {skills.map((s) => <Chip key={s}>🎯 {humanizeToken(s)}</Chip>)}
            {(confirmed.data ?? []).map((b) => (
              <button key={b.id} type="button" onClick={() => navigate(`/brands/${b.slug}`)} className="inline-flex" data-testid="sponsor-confirmed">
                <Chip outline>
                  <EntityAvatar src={b.logo_url} name={b.name} role="brand" size={24} />
                  {b.name} athlete ✓
                </Chip>
              </button>
            ))}
            {showSelfDeclared && <Chip><span data-testid="sponsor-self-declared">{sponsorLabel(selfDeclared)}</span></Chip>}
          </div>
        )}
        {videosHiddenFromViewer && shownVideoCount === 0 && <p className="text-secondary text-ink-3" data-testid="profile-videos-clubs-only">Videos are shared with clubs</p>}
        {friendCount > 0 && <FacesRow people={faces} text={friendText} onClick={() => props.onOpenSection('friends')} />}
        {props.clubViewSlot}
      </section>

      {/* Videos: highlights + full matches (reels live in the grid) */}
      {((owner && !isCoach) || shownVideoCount > 0) && (
        <Section id="videos" title="Videos" action={shownVideoCount > 0 ? `See all ${shownVideoCount}` : null} onAction={() => props.onOpenSection('videos')}>
          {videoTotal === 0 && !data.loading && dashed('Add a highlight', () => props.onOpenSection('media'))}
          {shownVideoCount > 0 && (
            <div className="flex snap-x scroll-pl-4 gap-3 overflow-x-auto px-4 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
              {shownHighlights.map((v, i) => <VideoCard key={v.id} title={v.title}><ProfileVideoTile video={v} locked={v.visibility === 'recruiters'} canWatch={canWatchLocked} eager={i < 2} priority={i === 0} size={{ width: 280, height: 158 }} onOpen={() => openVideo(v, v.visibility === 'recruiters')} className="h-[158px] w-[280px]" /></VideoCard>)}
              {shownLinked && linkedHighlight && (
                <VideoCard title="Linked highlight">
                  <a href={linkedHighlight} target="_blank" rel="noopener noreferrer" className="relative flex h-[158px] w-[280px] items-center justify-center rounded-[16px] bg-gradient-to-br from-ink-1 to-ink-2 text-white"><ExternalLink className="h-6 w-6" /></a>
                </VideoCard>
              )}
              {shownFullMatches.map((v, i) => <VideoCard key={v.id} title={v.title}><ProfileVideoTile video={v} locked={lockFullMatches || v.visibility === 'recruiters'} canWatch={canWatchLocked} eager={i < 1} size={{ width: 280, height: 158 }} onOpen={() => openVideo(v, lockFullMatches || v.visibility === 'recruiters')} className="h-[158px] w-[280px]" /></VideoCard>)}
              {data.fullGameLinks.map((l) => (
                <VideoCard key={l.id} title={l.match_title?.trim() || (l.opponent_team ? `vs ${l.opponent_team}` : 'Full match')}>
                  <a href={safeVideoHref(l.video_url) ?? undefined} target="_blank" rel="noopener noreferrer" className="relative flex h-[158px] w-[280px] items-center justify-center rounded-[16px] bg-gradient-to-br from-ink-1 to-ink-2 text-white"><ExternalLink className="h-6 w-6" /></a>
                </VideoCard>
              ))}
            </div>
          )}
        </Section>
      )}

      {/* Coach: open roles (PR8 / PR12) */}
      {isCoach && (coachRoles.length > 0 || (owner && recruitsForTeam)) && (
        <Section
          id="roles"
          title={coachRoles.length > 0 ? `Open opportunities · ${coachRoles.length}` : 'Open opportunities'}
          action={owner && props.onPostRole ? '+ Post an opportunity' : coachRoles.length > 2 ? 'See all' : null}
          onAction={owner && props.onPostRole ? props.onPostRole : () => navigate('/opportunities')}
        >
          <div className="flex flex-col gap-2.5 px-4">
            {coachRoles.slice(0, owner ? 3 : 2).map((r) => (
              <RoleRow key={r.id} role={r} onOpen={() => navigate(`/opportunities/${r.id}`)} />
            ))}
            {owner && coachRoles.length === 0 && !coachRolesQ.isLoading && <p className="text-body text-ink-3">No open opportunities right now.</p>}
            {owner && coachRoles.length > 3 && (
              <button type="button" onClick={props.onOpenRoles ?? (() => navigate('/opportunities'))} className="flex min-h-[44px] items-center text-secondary font-semibold text-hockia-primary" data-testid="coach-roles-see-all">See all {coachRoles.length} roles</button>
            )}
          </div>
        </Section>
      )}

      {/* References (gold = trust) */}
      {(owner || referenceCount > 0) && (
      <Section id="references" title="References" action={referenceCount > 0 ? `See all ${referenceCount}` : owner ? 'Ask for one' : null} onAction={props.onOpenReferences}>
        {referenceCount === 0 && !refsLoading && (owner
          ? dashed('Ask for a reference', props.onOpenReferences)
          : <p className="px-4 text-row leading-[21px] text-ink-2">{isCoach ? 'No references yet. Clubs, players and coaches who are friends on Hockia can write one.' : 'No references yet. Coaches and teammates who are friends on Hockia can write one.'}</p>)}
        <div className="flex flex-col gap-3 px-4">
          {acceptedReferences.slice(0, 1).map((r) => {
            const p = r.profile
            const who = [p?.fullName?.trim() || 'Hockia member', humanizeToken(r.relationshipType)].filter(Boolean).join(' · ')
            return (
              <button key={r.id} type="button" onClick={() => props.onOpenReference(r.id)} className="w-full text-left" data-testid="profile-reference">
                <SquircleBox className="flex flex-col gap-3 bg-gold-soft px-[18px] py-4 shadow-[inset_0_0_0_0.5px_rgba(15,15,20,0.06)]">
                  {r.endorsementText && <p className="line-clamp-5 text-body font-semibold text-ink-1">“{r.endorsementText}”</p>}
                  <span className="flex items-center gap-2.5">
                    <EntityAvatar src={p?.avatarUrl ?? null} name={p?.fullName ?? null} role={p?.role} size={32} />
                    <span className="min-w-0">
                      <span className="block truncate text-[14px] font-semibold leading-[19px] text-ink-1">{who}</span>
                      <span className="block truncate text-caption text-ink-2">✓ Verified on Hockia{r.acceptedAt ? ` · ${dayFirst(r.acceptedAt, { year: 'always' })}` : ''}</span>
                    </span>
                  </span>
                </SquircleBox>
              </button>
            )
          })}
        </div>
      </Section>

      )}

      {/* Career */}
      {(owner || careerCount > 0) && (
        <Section id="career" title="Career" action={careerCount > 0 ? `See all ${careerCount}` : null} onAction={() => props.onOpenSection('journey')}>
          {careerCount === 0 && !data.loading && dashed('Add your first club', () => props.onOpenSection('journey'))}
          {owner && careerCount < 2 && !data.loading && (
            <div className="px-4 pt-2">
              <button type="button" onClick={() => showAi('profile', 'builder')} className="flex min-h-[52px] w-full items-center gap-3 rounded-[16px] bg-brand-soft px-4 py-3 text-left" data-testid="profile-fill-with-ai">
                <Sparkles className="h-5 w-5 shrink-0 text-brand-primary" strokeWidth={2} />
                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-1.5 text-[15px] font-semibold leading-5 text-brand-primary">Fill my profile with Hockia AI <BetaPill onSoft testId="profile-fill-with-ai-beta" /></span>
                  <span className="block text-caption text-ink-2">From your CV, photos, links or a few lines. You check it first.</span>
                </span>
              </button>
            </div>
          )}
          <div className="flex flex-col px-4">
            {data.career.map((e) => {
              const now = isCurrentEntry(e)
              const flag = flagForCountryName(countries, e.locationCountry) ?? e.worldClub?.flag ?? null
              const sub = [e.positionRole?.trim() ? humanizeToken(e.positionRole) : null, [flag, e.locationCity?.trim() || e.locationCountry?.trim() || null].filter(Boolean).join(' ') || null].filter(Boolean).join(' · ')
              return (
                <div key={e.id} className="flex items-start gap-3 py-2.5" data-testid="career-row">
                  <EntityAvatar src={e.worldClub?.avatar_url ?? null} name={e.clubName} role="club" size={40} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[16px] font-semibold leading-[21px] text-ink-1">{e.clubName}</span>
                    {sub && <span className="block truncate text-secondary text-ink-2">{sub}</span>}
                  </span>
                  <span className={cn('shrink-0 text-secondary font-semibold', now ? 'text-hockia-primary' : 'text-ink-3')}>{careerSpan(e)}</span>
                </div>
              )
            })}
          </div>
        </Section>
      )}

      {/* Posts & photos */}
      {(owner || tiles.length > 0) && (
        <Section id="posts" title="Posts & photos" action={gridTotal > 6 ? `See all ${gridTotal}` : null} onAction={() => props.onOpenSection('posts')}>
          {tiles.length === 0 && !data.loading && dashed('Add your first photo', () => props.onOpenSection('media'))}
          {tiles.length > 0 && <PostsPhotosGrid tiles={tiles} />}
        </Section>
      )}

      {profileId && <CommentsPreview profileId={profileId} profileRole={profile.role} owner={owner} />}

      {/* About */}
      {(owner || bio || relocation) && (
        <Section id="about" title="About" action={owner ? 'Edit' : null} onAction={() => props.onEdit('about')}>
          <div className="px-4">
            {bio ? (
              <>
                <p className={cn('whitespace-pre-line text-body text-ink-1', !bioOpen && 'line-clamp-3')}>{bio}</p>
                {!bioOpen && bio.length > 140 && <button type="button" onClick={() => setBioOpen(true)} className="min-h-[32px] text-secondary font-semibold text-hockia-primary">More</button>}
              </>
            ) : owner ? (step?.key === 'bio' ? <p className="text-body text-ink-3">No bio yet</p> : dashed('Write a short bio', () => props.onEdit('about'))) : null}
            <div className="mt-2 divide-y divide-line">
              {relocation && <DetailRow label="Relocation" value={relocation} />}
            </div>
          </div>
        </Section>
      )}

      </ProfileLayout>

      {player && (
        <MediaLightbox
          images={[{ video_id: player.id, media_type: 'video', duration: player.durationSeconds, order: 0 }]}
          initialIndex={0}
          onClose={() => setPlayer(null)}
          videoLabel={player.kind === 'highlight' ? 'Highlight' : player.kind === 'full_match' ? 'Full match' : 'Reel'}
          isOwner={owner}
          caption={player.title}
        />
      )}
      {photoIndex !== null && (
        <MediaLightbox
          images={data.photos.map((p, i) => ({ url: p.url, media_type: 'image', order: i }))}
          initialIndex={photoIndex}
          onClose={() => setPhotoIndex(null)}
          caption={data.photos[photoIndex]?.caption ?? null}
        />
      )}
      <VideoAccessSheets block={videoBlock} firstName={name.split(/\s+/)[0] || null} onClose={() => setVideoBlock(null)} />
    </div>
  )
}

function VideoCard({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="flex w-[280px] shrink-0 snap-start flex-col gap-1.5">
      <div className="overflow-hidden rounded-[16px] border-[0.5px] border-[rgba(15,15,20,0.06)]">{children}</div>
      <p className="truncate text-[14px] font-semibold leading-[19px] text-ink-1">{title}</p>
    </div>
  )
}

function DetailRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-3 py-3">
      <span className="text-[14px] text-ink-2">{label}</span>
      <span className="min-w-0 truncate text-right text-[14px] font-semibold text-ink-1">{value}</span>
    </div>
  )
}
