import { useMemo, useRef, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { Briefcase, Check, Lock, MessageCircle, UserPlus } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/lib/auth'
import { useToastStore } from '@/lib/toast'
import { logger } from '@/lib/logger'
import { useCountries } from '@/hooks/useCountries'
import { useFriendship } from '@/hooks/useFriendship'
import { useFriendsAtClub } from '@/hooks/useFriendsAtClub'
import { useClubCrestColors } from '@/hooks/useClubCrestColors'
import { useRolesHealth } from '@/hooks/useRolesHealth'
import { useClubProfileScrollData, type ClubOpenRole } from '@/hooks/useClubProfileScrollData'
import { friendsHereLabel } from '@/lib/communityCard'
import { roleTitle } from '@/lib/homeEngagement'
import { positionLabel } from '@/lib/identity'
import { genderPill } from '@/lib/opportunityCopy'
import { publicProfileShareUrl } from '@/lib/profileShare'
import { nextStepPart, NEXT_STEP_COPY, roleStatusLine, type CompletenessPart } from '@/lib/profileV2'
import ProfileActionMenu from '@/components/ProfileActionMenu'
import SignInPromptModal from '@/components/SignInPromptModal'
import { ProfileViewersSection } from '@/components/ProfileViewersSection'
import { PostComposerModal } from '@/components/home/PostComposerModal'
import { BottomSheet } from '@/components/ui/BottomSheet'
import { FaceCircle } from '@/components/home/v1/FaceCircle'
import type { ClubProfileShape } from '@/pages/ClubDashboard'
import { cn } from '@/lib/utils'
import { ClubHero } from './ClubHero'
import { CompactHeader, SectionAnchors } from './ProfileChrome'
import { useScrolledPast } from './profileChromeHooks'
import { OwnerButtons, PrimaryCard } from './OwnerArea'
import { ProfileActionBar, type ActionBarButton } from './ProfileActionBar'
import { CommentsPreview, FacesRow, PostsPhotosGrid, Section, type GridTile } from './ProfileSections'

/**
 * Profile v2 — club, phone (Figma PR6 public 106:255 / PR7 own 107:302).
 * One scroll under sticky anchors: Open roles → Squad → Posts & photos →
 * Comments → About. Own adds the recruiting card (applicants to review,
 * Post a role) and the private views row; visitors get the fixed Message ·
 * Add friend bar. Squad lists only what get_club_members returns (hidden,
 * uncontactable and blocked people are fenced server-side).
 */
export interface ClubProfileV2Props {
  profile: ClubProfileShape
  readOnly: boolean
  isOwnProfile: boolean
  authProfileRole?: string | null
  onEdit: () => void
  onViewPublic: () => void
  onMessage: () => void
  sendingMessage?: boolean
  onOpenSquad: () => void
  onOpenRoles: () => void
  onPostRole: () => void
  onOpenPosts: () => void
  onOpenMedia: () => void
}

const ANCHORS = [
  { id: 'roles', label: 'Open roles' },
  { id: 'squad', label: 'Squad' },
  { id: 'posts', label: 'Posts' },
  { id: 'about', label: 'About' },
]

function websiteHref(url: string) {
  return /^https?:\/\//i.test(url) ? url : `https://${url}`
}

function hostOf(url: string): string {
  try {
    return new URL(websiteHref(url)).hostname.replace(/^www\./, '')
  } catch {
    return url
  }
}

function DetailRow({ label, value, onClick, href, tone }: { label: string; value: string; onClick?: () => void; href?: string; tone?: 'link' }) {
  const v = <span className={cn('min-w-0 truncate text-right font-semibold', tone === 'link' ? 'text-hockia-primary' : 'text-ink-1')}>{value}</span>
  return (
    <div className="flex items-center gap-3 border-b border-line py-3 text-[14px] leading-[19px]">
      <span className="flex-1 text-ink-2">{label}</span>
      {href ? <a href={href} target="_blank" rel="noopener noreferrer" className="min-w-0">{v}</a> : onClick ? <button type="button" onClick={onClick} className="min-w-0">{v}</button> : v}
    </div>
  )
}

function RoleRow({ role, cta, onOpen }: { role: ClubOpenRole; cta: string; onOpen: () => void }) {
  const title = roleTitle(role.position, null, role.title)
  const team = genderPill(role.gender)?.label ?? null
  const status = roleStatusLine(role.deadline, role.createdAt)
  return (
    <div className="flex w-full items-center gap-3 rounded-[20px] bg-surface-subtle py-3 pl-3.5 pr-3" data-testid="club-role-row">
      <button type="button" onClick={onOpen} className="flex min-w-0 flex-1 items-center gap-3 text-left">
        <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-[14px] bg-hockia-soft text-hockia-primary"><Briefcase className="h-[22px] w-[22px]" strokeWidth={1.8} /></span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[16px] font-semibold leading-[21px] text-ink-1">{title}</span>
          {team && <span className="block truncate text-secondary text-ink-2">{team}</span>}
          {status && <span className="block truncate text-caption text-hockia-primary">{status}</span>}
        </span>
      </button>
      <button type="button" onClick={onOpen} className="flex h-11 shrink-0 items-center rounded-full border border-line bg-white px-4 text-[14px] font-semibold text-ink-1">{cta}</button>
    </div>
  )
}

export default function ClubProfileV2(props: ClubProfileV2Props) {
  const { profile, readOnly, isOwnProfile } = props
  const navigate = useNavigate()
  const location = useLocation()
  const addToast = useToastStore((s) => s.addToast)
  const signedIn = useAuthStore((s) => Boolean(s.user))
  const owner = !readOnly
  const visitor = readOnly && !isOwnProfile
  const worldClubId = profile.current_world_club_id ?? null
  const data = useClubProfileScrollData(profile.id, worldClubId, owner)
  const friendship = useFriendship(profile.id)
  const atClub = useFriendsAtClub(visitor ? worldClubId : null)
  const health = useRolesHealth(owner)
  const crestColors = useClubCrestColors(useMemo(() => [{ id: profile.id, avatar_url: profile.avatar_url ?? null }], [profile.id, profile.avatar_url]))
  const { countries } = useCountries()
  const heroRef = useRef<HTMLDivElement>(null)
  const compact = useScrolledPast(heroRef)
  const [signIn, setSignIn] = useState(false)
  const [viewers, setViewers] = useState(false)
  const [composer, setComposer] = useState(false)
  const [bioOpen, setBioOpen] = useState(false)

  // ── Identity ────────────────────────────────────────────────────────────
  const name = profile.full_name?.trim() || 'Club'
  const men = profile.mens_league_division?.trim() || null
  const women = profile.womens_league_division?.trim() || null
  const leagueLine = [women ? `Women’s ${women}` : null, men ? `Men’s ${men}` : null].filter(Boolean).join(' · ') || null
  const flag = countries.find((c) => c.id === profile.nationality_country_id)?.flag_emoji ?? null
  const base = profile.base_location?.trim() || null
  const founded = profile.year_founded ?? null
  const placeLine = [base ? [flag, base].filter(Boolean).join(' ') : null, founded ? `Founded ${founded}` : null].filter(Boolean).join(' · ') || null
  const openRoles = data.openRoles
  const recruiting = openRoles.length > 0
  const coverPhotos = useMemo(() => data.photos.map((p) => p.url).filter(Boolean).slice(0, 4), [data.photos])
  const verified = (profile as { is_verified?: boolean }).is_verified
  const verifiedAt = (profile as { verified_at?: string | null }).verified_at ?? null
  const bio = profile.club_bio?.trim() || null
  const website = profile.website?.trim() || null
  const publicEmail = profile.contact_email_public ? profile.contact_email?.trim() || null : null
  const canMessage = props.authProfileRole !== 'brand'

  const share = async () => {
    const url = publicProfileShareUrl(profile.role, profile.id, profile.username)
    if (!url) return
    try {
      if (navigator.share) { await navigator.share({ title: name, url }); return }
      await navigator.clipboard.writeText(url)
      addToast('Link copied', 'success')
    } catch (err) {
      if (!(err instanceof Error && err.name === 'AbortError')) logger.warn('[ClubProfileV2] share failed', err)
    }
  }
  const back = () => (window.history.length > 1 ? navigate(-1) : navigate('/community'))
  const openRole = (id: string) => navigate(`/opportunities/${id}`, { state: { from: location.pathname } })

  // ── Own: next step (server completeness, crest first) ───────────────────
  const completeness = useQuery({
    queryKey: ['profile-completeness', profile.id],
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
    const a = stepCopy?.action
    if (!a) return
    if (a.kind === 'leaf') props.onOpenMedia()
    else if (a.kind === 'route') navigate(a.to)
    else props.onEdit()
  }

  // ── Posts & photos ──────────────────────────────────────────────────────
  const tiles: GridTile[] = useMemo(() => data.posts.map((post) => {
    const media = (post.images ?? []).filter((m) => m.url || m.thumb_url || m.video_id)
    const first = media[0]
    const url = first ? (first.media_type === 'video' ? first.thumb_url ?? null : first.url ?? null) : null
    return { kind: 'post' as const, id: post.post_id, url, text: post.content, multi: media.length > 1, video: media.some((m) => m.media_type === 'video'), at: post.created_at, onOpen: () => navigate(`/post/${post.post_id}`) }
  }), [data.posts, navigate])

  // ── Action bar (visitors) ───────────────────────────────────────────────
  const addFriend = () => {
    if (!signedIn) { setSignIn(true); return }
    if (friendship.isIncomingRequest) void friendship.acceptRequest()
    else if (!friendship.isFriend && !friendship.isOutgoingRequest) void friendship.sendRequest()
  }
  const friendButton: ActionBarButton = friendship.isFriend
    ? { key: 'friend', label: 'Friends', icon: <Check className="h-5 w-5" strokeWidth={2.4} />, tone: 'done', disabled: true }
    : friendship.isOutgoingRequest
      ? { key: 'friend', label: 'Requested', icon: <Check className="h-5 w-5" strokeWidth={2.4} />, tone: 'secondary', disabled: true }
      : { key: 'friend', label: friendship.isIncomingRequest ? 'Accept' : 'Add friend', icon: <UserPlus className="h-5 w-5" strokeWidth={2} />, tone: canMessage ? 'secondary' : 'primary', onClick: addFriend, disabled: friendship.mutating, testId: 'profile-add-friend' }
  const messageButton: ActionBarButton = { key: 'message', label: props.sendingMessage ? 'Opening…' : 'Message', icon: <MessageCircle className="h-5 w-5" strokeWidth={1.8} />, tone: 'primary', onClick: signedIn ? props.onMessage : () => setSignIn(true), disabled: props.sendingMessage, testId: 'club-message-button' }
  const buttons: ActionBarButton[] = !visitor ? [] : canMessage ? [messageButton, friendButton] : [friendButton]

  const moreMenu = (triggerClassName: string) => (visitor ? (
    <ProfileActionMenu targetId={profile.id} targetName={name} triggerClassName={triggerClassName} iconClassName="h-[22px] w-[22px]" />
  ) : null)

  const anchors = ANCHORS.filter((a) => (
    a.id === 'roles' ? owner || openRoles.length > 0
      : a.id === 'squad' ? owner || data.memberCount > 0
        : a.id === 'posts' ? owner || tiles.length > 0
          : true
  ))
  const friendsHere = atClub.people.length
  const socialText = [friendsHereLabel(friendsHere), data.memberCount > 0 ? `${data.memberCount} ${data.memberCount === 1 ? 'member' : 'members'}` : null].filter(Boolean).join(' · ')
  const pending = health.totals.pending
  const views = data.viewsThisWeek ?? 0

  return (
    <div className="bg-white pb-8" data-testid="club-profile-v2">
      <CompactHeader name={name} avatarUrl={profile.avatar_url} role="club" visible={compact} owner={owner} onBack={back} onShare={() => void share()} right={moreMenu('flex h-11 w-11 items-center justify-center text-ink-1')} />

      <div ref={heroRef}>
        <ClubHero
          photos={coverPhotos}
          crestUrl={profile.avatar_url ?? null}
          crestColor={crestColors.get(profile.id) ?? null}
          name={name}
          verified={verified}
          verifiedAt={verifiedAt}
          leagueLine={leagueLine}
          placeLine={placeLine}
          recruiting={recruiting}
          owner={owner}
          onBack={back}
          onShare={() => void share()}
          moreMenu={moreMenu('flex h-11 w-11 items-center justify-center rounded-full border border-white/20 bg-[rgba(15,15,20,0.35)] text-white backdrop-blur-[10px]')}
          onEditCover={props.onOpenMedia}
          onEditCrest={props.onEdit}
          onSettings={() => navigate('/settings')}
        />
      </div>

      {owner && (
        <div className="flex flex-col gap-3">
          <OwnerButtons
            onEdit={props.onEdit}
            previews={[{ key: 'public', label: 'Someone on Hockia', detail: 'What players and coaches see', onSelect: props.onViewPublic }]}
          />
          {stepCopy && step && (
            <PrimaryCard pct={completeness.data?.pct ?? null} title={stepCopy.title} subtitle={stepCopy.subtitle} cta={stepCopy.cta} onAction={runStep} />
          )}
          <div className="px-4">
            <div className="flex flex-col gap-3 rounded-[24px] bg-hockia-soft p-4" data-testid="club-recruiting-card">
              <div className="flex items-center gap-3">
                <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-white text-hockia-primary"><Briefcase className="h-5 w-5" strokeWidth={1.8} /></span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[16px] font-semibold leading-[21px] text-ink-1">
                    {recruiting ? (pending > 0 ? `${pending} ${pending === 1 ? 'applicant' : 'applicants'} to review` : 'No applicants to review') : 'Not recruiting right now'}
                  </span>
                  <span className="block truncate text-secondary text-ink-2">
                    {recruiting
                      ? `${openRoles.length} open ${openRoles.length === 1 ? 'role' : 'roles'} · ${[...new Set(openRoles.map((r) => positionLabel(r.position) || r.title))].slice(0, 2).join(', ')}`
                      : 'Post a role and players can apply'}
                  </span>
                </span>
              </div>
              <div className="flex gap-2.5">
                {recruiting && (
                  <button type="button" onClick={props.onOpenRoles} className="flex h-11 flex-1 items-center justify-center rounded-full bg-hockia-primary text-[16px] font-semibold text-white">Review applicants</button>
                )}
                <button type="button" onClick={props.onPostRole} className={cn('flex h-11 items-center justify-center rounded-full px-4 text-[16px] font-semibold', recruiting ? 'bg-white text-hockia-primary' : 'flex-1 bg-hockia-primary text-white')}>+ Post a role</button>
              </div>
            </div>
          </div>
          <div className="px-4">
            <button type="button" onClick={() => setViewers(true)} className="flex w-full items-center gap-3 rounded-[16px] border border-line px-3.5 py-3 text-left" data-testid="club-views-row">
              <span className="text-[22px] font-bold leading-[27px] tracking-[-0.13px] text-ink-1 tabular-nums">{views}</span>
              <span className="flex min-w-0 flex-1 items-center gap-1 text-secondary text-ink-2">
                {views === 1 ? 'profile view' : 'profile views'} this week · <Lock className="h-3 w-3 shrink-0" strokeWidth={2} /> only you
              </span>
              <span className="shrink-0 text-secondary font-semibold text-hockia-primary">See who</span>
            </button>
          </div>
        </div>
      )}

      <SectionAnchors items={anchors} refreshKey={data.loading} />

      {visitor && socialText && (
        <div className="px-4 pt-3">
          <FacesRow
            people={atClub.people.map((p) => ({ id: p.id, full_name: p.fullName, avatar_url: p.avatarUrl, role: p.role }))}
            text={socialText}
            onClick={data.memberCount > 0 ? props.onOpenSquad : undefined}
          />
        </div>
      )}

      {/* Open roles */}
      {(owner || recruiting) && (
        <Section
          id="roles"
          title={recruiting ? `Open roles · ${openRoles.length}` : 'Open roles'}
          action={owner ? '+ Post a role' : openRoles.length > 2 ? 'See all' : null}
          onAction={owner ? props.onPostRole : () => navigate('/opportunities')}
        >
          <div className="flex flex-col gap-2.5 px-4">
            {openRoles.slice(0, owner ? 3 : 2).map((r) => (
              <RoleRow key={r.id} role={r} cta={owner ? 'Manage' : 'Apply'} onOpen={() => openRole(r.id)} />
            ))}
            {owner && openRoles.length > 3 && (
              <button type="button" onClick={props.onOpenRoles} className="flex min-h-[44px] items-center text-secondary font-semibold text-hockia-primary">See all {openRoles.length} roles</button>
            )}
            {owner && !recruiting && !data.loading && <p className="text-body text-ink-3">No open roles right now.</p>}
          </div>
        </Section>
      )}

      {/* Squad */}
      {(owner || data.memberCount > 0) && (
        <Section id="squad" title={data.memberCount > 0 ? `Squad · ${data.memberCount}` : 'Squad'} action={owner ? 'Manage' : data.memberCount > data.members.length ? 'See all' : null} onAction={props.onOpenSquad}>
          {data.members.length > 0 ? (
            <div className="flex gap-3.5 overflow-x-auto px-4 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
              {data.members.map((m) => (
                <button key={m.id} type="button" onClick={() => navigate(m.role === 'coach' ? `/coaches/id/${m.id}` : `/players/id/${m.id}`)} className="flex w-16 shrink-0 flex-col items-center gap-1" data-testid="club-squad-face">
                  <FaceCircle url={m.avatarUrl} name={m.fullName} role={m.role} size="avatar-md" initialsClassName="text-[18px]" className="h-16 w-16" />
                  <span className="w-full truncate text-center text-secondary font-semibold text-ink-1">{m.fullName.split(/\s+/)[0]}</span>
                  <span className="w-full truncate text-center text-caption text-ink-3">{m.role === 'coach' ? 'Coach' : positionLabel(m.position) || 'Player'}</span>
                </button>
              ))}
            </div>
          ) : !data.loading && (
            <p className="px-4 text-body text-ink-3">No one on the squad yet.</p>
          )}
        </Section>
      )}

      {/* Posts & photos */}
      {(owner || tiles.length > 0) && (
        <Section
          id="posts"
          title="Posts & photos"
          action={owner ? '+ Add' : data.postCount > tiles.length ? `See all ${data.postCount}` : null}
          onAction={owner ? () => setComposer(true) : props.onOpenPosts}
        >
          {tiles.length > 0 ? <PostsPhotosGrid tiles={tiles} /> : !data.loading && <p className="px-4 text-body text-ink-3">No posts yet.</p>}
        </Section>
      )}

      <CommentsPreview profileId={profile.id} profileRole="club" owner={owner} />

      {/* About */}
      <Section id="about" title="About" action={owner ? 'Edit' : null} onAction={props.onEdit}>
        <div className="flex flex-col items-start gap-1.5 px-4">
          {bio ? (
            <>
              <p className={cn('whitespace-pre-line text-body text-ink-1', !bioOpen && 'line-clamp-3')}>{bio}</p>
              {!bioOpen && bio.length > 140 && <button type="button" onClick={() => setBioOpen(true)} className="min-h-[32px] text-secondary font-semibold text-hockia-primary">More</button>}
            </>
          ) : owner ? (
            <p className="text-body text-ink-3">No description yet</p>
          ) : null}
          <div className="w-full pt-2">
            {(founded || owner) && <DetailRow label="Founded" value={founded ? String(founded) : 'Add'} tone={founded ? undefined : 'link'} onClick={!founded && owner ? props.onEdit : undefined} />}
            {women && <DetailRow label="Women" value={women} />}
            {men && <DetailRow label="Men" value={men} />}
            {(website || owner) && <DetailRow label="Website" value={website ? hostOf(website) : 'Add website'} tone="link" href={website ? websiteHref(website) : undefined} onClick={!website && owner ? props.onEdit : undefined} />}
            {owner ? (
              <DetailRow label="Contact" value={publicEmail ?? 'Add contact email'} tone="link" onClick={props.onEdit} />
            ) : visitor && canMessage ? (
              <DetailRow label="Contact" value="Message the club" tone="link" onClick={signedIn ? props.onMessage : () => setSignIn(true)} />
            ) : publicEmail ? (
              <DetailRow label="Contact" value={publicEmail} tone="link" href={`mailto:${publicEmail}`} />
            ) : null}
          </div>
        </div>
      </Section>

      <ProfileActionBar buttons={buttons} />

      <SignInPromptModal isOpen={signIn} onClose={() => setSignIn(false)} title="Sign in to connect with this club" action="connect" />
      {owner && (
        <BottomSheet open={viewers} onClose={() => setViewers(false)} ariaLabel="Profile views">
          <div className="px-1 pb-4"><ProfileViewersSection /></div>
        </BottomSheet>
      )}
      {composer && (
        <PostComposerModal isOpen={composer} onClose={() => setComposer(false)} onPostCreated={() => { setComposer(false); data.refresh() }} />
      )}
    </div>
  )
}
