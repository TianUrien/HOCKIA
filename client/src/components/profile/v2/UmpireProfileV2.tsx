import { useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { Check, MessageCircle, Shield, Trophy, UserPlus } from 'lucide-react'
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
import { useProfileScrollData } from '@/hooks/useProfileScrollData'
import { useUmpireAppointments, type UmpireAppointment } from '@/hooks/useUmpireAppointments'
import { displayPlace } from '@/lib/communityCard'
import { basedInLine, nationalityCountries } from '@/lib/nationality'
import { humanizeToken } from '@/lib/identity'
import { flagForCountryName } from '@/lib/careerCopy'
import { publicProfileShareUrl } from '@/lib/profileShare'
import { dayFirst } from '@/lib/dayFirst'
import { nextStepPart, NEXT_STEP_COPY, type CompletenessPart } from '@/lib/profileV2'
import type { Profile } from '@/lib/supabase'
import ProfileActionMenu from '@/components/ProfileActionMenu'
import SignInPromptModal from '@/components/SignInPromptModal'
import { MediaLightbox } from '@/components/home/MediaLightbox'
import { EntityAvatar } from '@/components/ui/EntityAvatar'
import { SquircleBox } from '@/components/home/v1/primitives'
import { GLASS } from '@/lib/communityCard'
import { calculateAge, cn } from '@/lib/utils'
import { ProfileHero } from './ProfileHero'
import { CompactHeader, SectionAnchors } from './ProfileChrome'
import { useScrolledPast } from './profileChromeHooks'
import { OwnerButtons, PrimaryCard, PrivateStats } from './OwnerArea'
import { type ActionBarButton } from './ProfileActionBar'
import { ProfileLayout } from './ProfileLayout'
import { CommentsPreview, FacesRow, FactTile, PostsPhotosGrid, Section, type GridTile } from './ProfileSections'
import { useProfileT } from '@/i18n/ns/profile'
import { useEnumsT } from '@/i18n/ns/enums'
import { intlLocale, isEnglish } from '@/i18n/format'
import { countryLabel } from '@/i18n/countryNames'

/**
 * Profile v2 — umpire, phone (Figma PR23 137:1000 · PR25 empty 141:1056).
 * Same scroll language as the player: hero → Overview (federation, level,
 * available) → Appointments → References → Posts & photos → Comments →
 * About (bio + languages). No Career section (ruling 11 Oct: umpire career
 * folds into appointments). Trust is references + appointments, never a score.
 */
export interface UmpireProfileV2Props {
  profile: Partial<Profile> & Pick<Profile, 'id' | 'role' | 'full_name' | 'avatar_url'>
  readOnly: boolean
  isOwnProfile: boolean
  onEdit: () => void
  onMessage: () => void
  sendingMessage: boolean
  onViewPublic: () => void
  onOpenSection: (section: 'officiating' | 'gallery' | 'references' | 'friends' | 'posts') => void
}

const ANCHORS = ['overview', 'appointments', 'references', 'posts', 'about'] as const

function specializationLabel(value: string | null | undefined, t: ReturnType<typeof useProfileT>): string | null {
  if (!value) return null
  if (value === 'both') return t('umpireProfileV2.spec.both')
  if (value === 'outdoor') return t('umpireProfileV2.spec.outdoor')
  if (value === 'indoor') return t('umpireProfileV2.spec.indoor')
  return value.charAt(0).toUpperCase() + value.slice(1)
}

function monthYear(date: string | null): string | null {
  if (!date) return null
  const d = new Date(`${date.slice(0, 10)}T00:00:00Z`)
  if (Number.isNaN(d.getTime())) return null
  // English keeps its en-GB month names ("Sept"); other languages read their own.
  return d.toLocaleDateString(isEnglish() ? 'en-GB' : intlLocale(), { month: 'short', year: 'numeric', timeZone: 'UTC' })
}

function AppointmentRow({ a, flag }: { a: UmpireAppointment; flag: string | null }) {
  const where = [flag, a.location_city?.trim() || countryLabel(a.location_country?.trim()) || null].filter(Boolean).join(' ')
  const sub = [a.organizer?.trim() || null, where || null].filter(Boolean).join(', ')
  const tags = [a.match_level ? humanizeToken(a.match_level) : null, a.match_format ? humanizeToken(a.match_format) : null].filter(Boolean).join(', ')
  return (
    <div className="flex items-start gap-3 py-2.5" data-testid="appointment-row">
      <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-gold-soft text-[#b45309]"><Trophy className="h-5 w-5" strokeWidth={1.8} /></span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[16px] font-semibold leading-[21px] text-ink-1">{a.event_name}</span>
        {sub && <span className="block text-secondary text-ink-2">{sub}</span>}
        {tags && <span className="block truncate text-caption text-hockia-primary">{tags}</span>}
      </span>
      {monthYear(a.start_date) && <span className="shrink-0 text-secondary text-ink-2">{monthYear(a.start_date)}</span>}
    </div>
  )
}

export default function UmpireProfileV2(props: UmpireProfileV2Props) {
  const { profile, readOnly, isOwnProfile } = props
  const t = useProfileT()
  const tEnum = useEnumsT()
  const navigate = useNavigate()
  const addToast = useToastStore((s) => s.addToast)
  const signedIn = useAuthStore((s) => Boolean(s.user))
  // Brands have followers, not friends (audit A7).
  const viewerIsBrand = useAuthStore((s) => s.profile?.role === 'brand')
  const owner = !readOnly
  const visitor = readOnly && !isOwnProfile
  const profileId = profile.id
  const { countries } = useCountries()
  const data = useProfileScrollData(profileId)
  const appts = useUmpireAppointments({ userId: profileId })
  const { acceptedReferences, loading: refsLoading } = useTrustedReferences(profileId)
  const friendship = useFriendship(profileId)
  const inCommon = useFriendsInCommonSummary(visitor ? profileId : null)
  const heroRef = useRef<HTMLDivElement>(null)
  const compact = useScrolledPast(heroRef)
  const [signIn, setSignIn] = useState(false)
  const [bioOpen, setBioOpen] = useState(false)
  const [photoIndex, setPhotoIndex] = useState<number | null>(null)

  // ── Identity ────────────────────────────────────────────────────────────
  const name = profile.full_name?.trim() || t('umpireProfileV2.nameFallback')
  const age = (profile as { server_age?: number | null }).server_age ?? (profile.date_of_birth ? calculateAge(profile.date_of_birth) : null)
  const level = profile.umpire_level?.trim() || null
  const spec = specializationLabel(profile.officiating_specialization, t)
  // Same lead as the Community card and preview ("Umpire · Regional"), then the format.
  const roleLine = [tEnum('role.umpire'), level, spec].filter(Boolean).join(', ')
  const place = useMemo(() => basedInLine(displayPlace(profile.base_location ?? null, (profile as { base_country_id?: number | null }).base_country_id ?? null, countries)), [profile, countries])
  const nationalities = useMemo(() => nationalityCountries([profile.nationality_country_id, profile.nationality2_country_id], countries), [profile.nationality_country_id, profile.nationality2_country_id, countries])
  const photos = useMemo(() => {
    const urls = data.photos.map((p) => p.url).filter(Boolean)
    if (urls.length === 0 && profile.avatar_url) urls.push(profile.avatar_url)
    return urls.slice(0, 4)
  }, [data.photos, profile.avatar_url])
  const federation = profile.federation?.trim() || null
  const since = profile.umpire_since ?? null
  // available_for_appointments is the umpire's own flag (open_to_opportunities is the player/coach one).
  const available = Boolean((profile as { available_for_appointments?: boolean | null }).available_for_appointments)
  const languages = (profile.languages ?? []).filter(Boolean)
  const bio = profile.bio?.trim() || null
  const apptCount = profile.umpire_appointment_count ?? appts.appointments.length
  const referenceCount = profile.accepted_reference_count ?? acceptedReferences.length
  const friendCount = profile.accepted_friend_count ?? 0

  const share = async () => {
    const url = publicProfileShareUrl(profile.role, profileId, profile.username)
    if (!url) return
    try {
      if (navigator.share) { await navigator.share({ title: name, url }); return }
      await navigator.clipboard.writeText(url)
      addToast(t('umpireProfileV2.linkCopied'), 'success')
    } catch (err) {
      if (!(err instanceof Error && err.name === 'AbortError')) logger.warn('[UmpireProfileV2] share failed', err)
    }
  }
  const back = () => (window.history.length > 1 ? navigate(-1) : navigate('/community'))

  // ── Own: next step + private stats ──────────────────────────────────────
  const completeness = useQuery({
    queryKey: ['profile-completeness', profileId],
    enabled: owner,
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
    if (stepCopy.action.kind === 'leaf') props.onOpenSection('gallery')
    else if (stepCopy.action.kind === 'route') navigate(stepCopy.action.to)
    else props.onEdit()
  }
  const vis = useWeeklyVisibility(owner, false)
  const searches = useSearchAppearances({ profileId: owner ? profileId : null })
  const stats = owner ? [
    { value: vis.visibility?.views_7d ?? 0, label: t('umpireProfileV2.stats.views', { count: vis.visibility?.views_7d ?? 0 }) },
    { value: vis.visibility?.viewers_by_role?.club ?? 0, label: t('umpireProfileV2.stats.clubs', { count: vis.visibility?.viewers_by_role?.club ?? 0 }) },
    { value: searches.summary?.total ?? 0, label: t('umpireProfileV2.stats.searches') },
  ] : []

  // ── Posts & photos ──────────────────────────────────────────────────────
  const tiles: GridTile[] = useMemo(() => {
    const out: GridTile[] = []
    data.photos.forEach((p, i) => out.push({ kind: 'photo', id: p.id, url: p.url, at: p.createdAt ?? '', onOpen: () => setPhotoIndex(i) }))
    for (const post of data.posts) {
      const media = (post.images ?? []).filter((m) => m.url || m.thumb_url || m.video_id)
      const first = media[0]
      const url = first ? (first.media_type === 'video' ? first.thumb_url ?? null : first.url ?? null) : null
      out.push({ kind: 'post', id: post.post_id, url, text: post.content, multi: media.length > 1, video: media.some((m) => m.media_type === 'video'), at: post.created_at, onOpen: () => navigate(`/post/${post.post_id}`) })
    }
    return out.sort((a, b) => (b.at || '').localeCompare(a.at || ''))
  }, [data.photos, data.posts, navigate])
  const gridTotal = data.photoCount + data.postCount

  // ── Friends ─────────────────────────────────────────────────────────────
  const friendsPreview = useQuery({
    queryKey: ['profile-friend-faces', profileId],
    enabled: friendCount > 0 && !(visitor && inCommon.count > 0),
    staleTime: 5 * 60_000,
    queryFn: async () => {
      const { data: rows } = await supabase.rpc('get_profile_connections', { p_profile_id: profileId, p_limit: 3, p_offset: 0 })
      return ((rows ?? []) as Array<{ id: string; full_name: string | null; avatar_url: string | null; role: string | null }>)
    },
  })
  const friendText = visitor && inCommon.count > 0
    ? t('umpireProfileV2.friendsInCommon', { count: friendCount, common: inCommon.count })
    : t('umpireProfileV2.friends', { count: friendCount })
  const faces = visitor && inCommon.count > 0
    ? inCommon.people.map((p) => ({ id: p.id, full_name: p.fullName, avatar_url: p.avatarUrl, role: p.role }))
    : friendsPreview.data ?? []

  // ── Action bar ──────────────────────────────────────────────────────────
  const addFriend = () => {
    if (!signedIn) { setSignIn(true); return }
    if (friendship.isIncomingRequest) void friendship.acceptRequest()
    else if (!friendship.isFriend && !friendship.isOutgoingRequest) void friendship.sendRequest()
  }
  const friendButton: ActionBarButton = friendship.isFriend
    ? { key: 'friend', label: t('umpireProfileV2.action.friends'), icon: <Check className="h-5 w-5" strokeWidth={2.4} />, tone: 'done', disabled: true }
    : friendship.isOutgoingRequest
      ? { key: 'friend', label: t('umpireProfileV2.action.requested'), icon: <Check className="h-5 w-5" strokeWidth={2.4} />, tone: 'secondary', disabled: true }
      : { key: 'friend', label: friendship.isIncomingRequest ? t('umpireProfileV2.action.accept') : t('umpireProfileV2.action.addFriend'), icon: <UserPlus className="h-5 w-5" strokeWidth={2} />, tone: 'primary', onClick: addFriend, disabled: friendship.mutating, testId: 'profile-add-friend' }
  const messageButton: ActionBarButton = { key: 'message', label: props.sendingMessage ? t('umpireProfileV2.action.opening') : t('umpireProfileV2.action.message'), icon: <MessageCircle className="h-5 w-5" strokeWidth={1.8} />, tone: 'secondary', onClick: signedIn ? props.onMessage : () => setSignIn(true), disabled: props.sendingMessage, testId: 'profile-message' }
  const buttons: ActionBarButton[] = !visitor ? [] : viewerIsBrand ? [{ ...messageButton, tone: 'primary' }] : [friendButton, messageButton]

  const moreMenu = (triggerClassName: string) => (visitor ? (
    <ProfileActionMenu targetId={profileId} targetName={name} actionName={name.split(/\s+/)[0]} triggerClassName={triggerClassName} iconClassName="h-[22px] w-[22px]" />
  ) : null)

  const anchors = ANCHORS.filter((id) => (
    id === 'appointments' ? owner || apptCount > 0
      : id === 'references' ? owner || referenceCount > 0
      : id === 'about' ? owner || Boolean(bio) || languages.length > 0
      : id === 'posts' ? owner || tiles.length > 0
        : true
  )).map((id) => ({ id, label: t(`umpireProfileV2.anchors.${id}`) }))

  return (
    <div className="bg-white pb-8" data-testid="umpire-profile-v2">
      <CompactHeader name={name} avatarUrl={profile.avatar_url} role="umpire" visible={compact} owner={owner} onBack={back} onShare={() => void share()} right={moreMenu('flex h-11 w-11 items-center justify-center text-ink-1')} />

      <ProfileLayout actions={buttons} hero={<div ref={heroRef}>
        <ProfileHero
          photos={photos}
          name={name}
          age={age}
          roleLine={owner && !level ? t('umpireProfileV2.addLevelLine') : roleLine}
          roleLineAction={owner && !level ? props.onEdit : null}
          place={place}
          nationalities={nationalities}
          role="umpire"
          owner={owner}
          onBack={back}
          onShare={() => void share()}
          onCamera={() => props.onOpenSection('gallery')}
          onSettings={() => navigate('/settings')}
          moreMenu={moreMenu(cn('flex h-11 w-11 items-center justify-center rounded-full border border-white/20 bg-[rgba(15,15,20,0.35)] text-white', GLASS))}
        />
      </div>}>

      {owner && (
        <>
          <OwnerButtons onEdit={props.onEdit} previews={[{ key: 'public', label: t('umpireProfileV2.previewPublic'), detail: t('umpireProfileV2.previewPublicDetail'), onSelect: props.onViewPublic }]} />
          {stepCopy && step && <PrimaryCard role="umpire" stepKey={step?.key ?? null} title={stepCopy.title} subtitle={stepCopy.subtitle} cta={stepCopy.cta} onAction={runStep} />}
          <PrivateStats stats={stats} emptyText={t('umpireProfileV2.statsEmpty')} />
        </>
      )}

      <SectionAnchors items={anchors} refreshKey={data.loading || appts.loading} />

      {/* Overview */}
      <section id="overview" className="scroll-mt-[120px] flex flex-col gap-2.5 px-4 pt-3" data-testid="profile-section-overview">
        {(federation || owner) && (
          <FactTile
            full
            label={t('umpireProfileV2.federation.label')}
            value={federation ?? t('umpireProfileV2.federation.add')}
            detail={federation ? t('umpireProfileV2.federation.detail') : null}
            tone={federation ? undefined : 'muted'}
            leading={<span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-hockia-soft text-hockia-primary"><Shield className="h-5 w-5" strokeWidth={1.8} /></span>}
            onClick={!federation && owner ? props.onEdit : undefined}
          />
        )}
        <div className="flex gap-2.5">
          <FactTile label={t('umpireProfileV2.level.label')} value={level ?? (owner ? t('umpireProfileV2.level.add') : t('umpireProfileV2.level.notSet'))} detail={level && since ? t('umpireProfileV2.level.since', { year: since }) : null} tone={level ? undefined : 'muted'} />
          <FactTile label={t('umpireProfileV2.available.label')} value={available ? t('umpireProfileV2.available.open') : t('umpireProfileV2.available.notNow')} detail={available ? t('umpireProfileV2.available.detail') : null} tone={available ? 'positive' : 'muted'} />
        </div>
        {friendCount > 0 && <FacesRow people={faces} text={friendText} onClick={() => props.onOpenSection('friends')} />}
      </section>

      {/* Matches officiated (the record; never "appointments", founder 2026-10-03) */}
      {(owner || apptCount > 0) && (
        <Section id="appointments" title={t('umpireProfileV2.matches.title')} count={apptCount > 0 ? apptCount : null} action={owner ? t('umpireProfileV2.matches.add') : apptCount > 3 ? t('umpireProfileV2.matches.seeAll') : null} onAction={() => props.onOpenSection('officiating')}>
          <div className="flex flex-col px-4">
            {appts.appointments.slice(0, 3).map((a) => <AppointmentRow key={a.id} a={a} flag={flagForCountryName(countries, a.location_country)} />)}
            {apptCount === 0 && !appts.loading && <p className="text-body text-ink-3">{t('umpireProfileV2.matches.empty')}</p>}
          </div>
        </Section>
      )}

      {/* References (gold = trust) */}
      {(owner || referenceCount > 0) && (
      <Section id="references" title={t('umpireProfileV2.references.title')} action={referenceCount > 0 ? t('umpireProfileV2.references.seeAll', { count: referenceCount }) : owner ? t('umpireProfileV2.references.ask') : null} onAction={() => props.onOpenSection('references')}>
        {referenceCount === 0 && !refsLoading && <p className="px-4 text-row leading-[21px] text-ink-2">{t('umpireProfileV2.references.empty')}</p>}
        <div className="flex flex-col gap-3 px-4">
          {acceptedReferences.slice(0, 1).map((r) => {
            const p = r.profile
            const who = [p?.fullName?.trim() || t('umpireProfileV2.references.memberFallback'), humanizeToken(r.relationshipType)].filter(Boolean).join(', ')
            return (
              <button key={r.id} type="button" onClick={() => props.onOpenSection('references')} className="w-full text-left" data-testid="profile-reference">
                <SquircleBox className="flex flex-col gap-3 bg-gold-soft px-[18px] py-4 shadow-[inset_0_0_0_0.5px_rgba(15,15,20,0.06)]">
                  {r.endorsementText && <p className="line-clamp-5 text-body font-semibold text-ink-1">“{r.endorsementText}”</p>}
                  <span className="flex items-center gap-2.5">
                    <EntityAvatar src={p?.avatarUrl ?? null} name={p?.fullName ?? null} role={p?.role} size={32} />
                    <span className="min-w-0">
                      <span className="block truncate text-[14px] font-semibold leading-[19px] text-ink-1">{who}</span>
                      <span className="block truncate text-caption text-ink-2">{t('umpireProfileV2.references.verified')}{r.acceptedAt && <>{' '}<span className="ml-1 text-ink-2">{dayFirst(r.acceptedAt, { year: 'always' })}</span></>}</span>
                    </span>
                  </span>
                </SquircleBox>
              </button>
            )
          })}
        </div>
      </Section>

      )}

      {/* Posts & photos */}
      {(owner || tiles.length > 0) && (
        <Section id="posts" title={t('umpireProfileV2.posts.title')} action={owner ? t('umpireProfileV2.posts.add') : gridTotal > 6 ? t('umpireProfileV2.posts.seeAll', { count: gridTotal }) : null} onAction={() => props.onOpenSection(owner ? 'gallery' : 'posts')}>
          {tiles.length > 0 ? <PostsPhotosGrid tiles={tiles} /> : !data.loading && <p className="px-4 text-body text-ink-3">{t('umpireProfileV2.posts.empty')}</p>}
        </Section>
      )}

      <CommentsPreview profileId={profileId} profileRole="umpire" owner={owner} />

      {/* About */}
      {(owner || bio || languages.length > 0) && (
        <Section id="about" title={t('umpireProfileV2.about.title')} action={owner ? t('umpireProfileV2.about.edit') : null} onAction={props.onEdit}>
          <div className="px-4">
            {bio ? (
              <>
                <p className={cn('whitespace-pre-line text-body text-ink-1', !bioOpen && 'line-clamp-3')}>{bio}</p>
                {!bioOpen && bio.length > 140 && <button type="button" onClick={() => setBioOpen(true)} className="min-h-[32px] text-secondary font-semibold text-hockia-primary">{t('umpireProfileV2.about.more')}</button>}
              </>
            ) : owner ? <p className="text-body text-ink-3">{t('umpireProfileV2.about.noBio')}</p> : null}
            {languages.length > 0 && (
              <div className="mt-2 flex items-center justify-between gap-3 border-b border-line py-3">
                <span className="text-[14px] text-ink-2">{t('umpireProfileV2.about.languages')}</span>
                <span className="min-w-0 truncate text-right text-[14px] font-semibold text-ink-1">{languages.join(', ')}</span>
              </div>
            )}
          </div>
        </Section>
      )}

      </ProfileLayout>
      <SignInPromptModal isOpen={signIn} onClose={() => setSignIn(false)} title={t('umpireProfileV2.signInTitle')} action="connect" />
      {photoIndex !== null && (
        <MediaLightbox
          images={data.photos.map((p, i) => ({ url: p.url, media_type: 'image', order: i }))}
          initialIndex={photoIndex}
          onClose={() => setPhotoIndex(null)}
          caption={data.photos[photoIndex]?.caption ?? null}
        />
      )}
    </div>
  )
}
