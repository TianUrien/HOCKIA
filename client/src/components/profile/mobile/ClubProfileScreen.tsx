import { useMemo, useState, type ReactNode } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { Briefcase, Check, ChevronLeft, ChevronRight, Eye, Globe, MapPin, MessageCircle, PenLine, Plus, Settings, Share, Shield, Trophy, UserPlus, Users } from 'lucide-react'
import ProfileActionMenu from '@/components/ProfileActionMenu'
import SignInPromptModal from '@/components/SignInPromptModal'
import { ProfileViewersSection } from '@/components/ProfileViewersSection'
import { PostComposerModal } from '@/components/home/PostComposerModal'
import { BottomSheet } from '@/components/ui/BottomSheet'
import { EntityAvatar } from '@/components/ui/EntityAvatar'
import { SmoothImage } from '@/components/ui/SmoothImage'
import { PostTile } from './ProfileLongScroll'
import { useClubProfileScrollData, type ClubOpenRole } from '@/hooks/useClubProfileScrollData'
import { useCountries } from '@/hooks/useCountries'
import { useFriendship } from '@/hooks/useFriendship'
import { useAuthStore } from '@/lib/auth'
import { useToastStore } from '@/lib/toast'
import { getImageUrl } from '@/lib/imageUrl'
import { publicProfileShareUrl } from '@/lib/profileShare'
import { genderPill, roleTitle } from '@/lib/opportunityCopy'
import { humanizeToken, roleLabel } from '@/lib/identity'
import { clubLeagueLine, openRoleLine } from '@/lib/clubProfileCopy'
import { logger } from '@/lib/logger'
import { cn } from '@/lib/utils'
import type { ClubProfileShape } from '@/pages/ClubDashboard'

/**
 * Phone Club profile (Figma 04 Club › Club profile — own 337:372 / public
 * 337:588). One component, two modes, the same identity block the player
 * screen uses: cover (the club's photos, swipeable) with glass buttons,
 * the squared crest overlapping the cover, the Recruiting pill, name,
 * "🇮🇪 City, Country · League", Edit profile / Public view or Add friend /
 * Message, then the three-cell stats row (members · friends · open roles).
 * Own mode adds the private grouped list (Club & league · Squad · Profile
 * views); public mode shows the first open role right under the stats and
 * never shows applicant counts or fit. Tabs: About · Squad · Roles · Posts.
 */
interface ClubProfileScreenProps {
  profile: ClubProfileShape
  readOnly: boolean
  isOwnProfile: boolean
  authProfileRole?: string | null
  onEdit: () => void
  onViewPublic: () => void
  onMessage: () => void
  sendingMessage?: boolean
  onOpenFriends: () => void
  onOpenSquad: () => void
  /** Owner: the roles management surface. */
  onOpenRoles: () => void
  onPostRole: () => void
  onOpenClubLeague: () => void
  onOpenPosts: () => void
}

type Tab = 'about' | 'squad' | 'roles' | 'posts'

function plural(n: number, one: string, many: string) {
  return n === 1 ? one : many
}

function hostOf(url: string): string {
  try {
    return new URL(/^https?:\/\//i.test(url) ? url : `https://${url}`).hostname.replace(/^www\./, '')
  } catch {
    return url
  }
}

function GroupRow({ icon, title, sub, trailing, onClick }: { icon: ReactNode; title: string; sub?: string | null; trailing?: string | null; onClick?: () => void }) {
  return (
    <button type="button" onClick={onClick} disabled={!onClick} className="flex w-full items-center gap-3 py-2.5 pl-3.5 pr-2.5 text-left active:bg-black/[0.04]">
      {icon}
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[16px] font-medium leading-[21px] text-ink-1">{title}</span>
        {sub && <span className="block truncate text-secondary text-ink-2">{sub}</span>}
      </span>
      {trailing && <span className="shrink-0 text-row text-ink-2">{trailing}</span>}
      <ChevronRight className="h-[18px] w-[18px] shrink-0 text-ink-4" strokeWidth={2} />
    </button>
  )
}

function TintedIcon({ children }: { children: ReactNode }) {
  return <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-[9px] bg-hockia-soft text-hockia-primary">{children}</span>
}

function FactRow({ icon, text, onClick, href, last }: { icon: ReactNode; text: string; onClick?: () => void; href?: string; last?: boolean }) {
  const inner = (
    <>
      <span className="flex h-[22px] w-[22px] shrink-0 items-center justify-center text-ink-1">{icon}</span>
      <span className="min-w-0 flex-1 truncate text-row text-ink-1">{text}</span>
      {(onClick || href) && <ChevronRight className="h-[18px] w-[18px] shrink-0 text-ink-4" strokeWidth={2} />}
    </>
  )
  const cls = 'flex w-full items-center gap-3.5 py-3 text-left'
  return (
    <div>
      {href ? (
        <a href={href} target="_blank" rel="noopener noreferrer" className={cls}>{inner}</a>
      ) : onClick ? (
        <button type="button" onClick={onClick} className={cls}>{inner}</button>
      ) : (
        <div className={cls}>{inner}</div>
      )}
      {!last && <div className="ml-9 h-[0.5px] bg-line" />}
    </div>
  )
}

function RoleCard({ role, onOpen }: { role: ClubOpenRole; onOpen: () => void }) {
  const pill = genderPill(role.gender)
  const title = [roleTitle({ position: role.position, title: role.title, opportunity_type: role.opportunityType }), pill?.label ?? null].filter(Boolean).join(' · ')
  return (
    <button type="button" onClick={onOpen} className="flex w-full items-center gap-3 rounded-2xl border border-line bg-white p-3.5 text-left active:bg-surface-grouped">
      <TintedIcon><Briefcase className="h-[18px] w-[18px]" strokeWidth={2} /></TintedIcon>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[16px] font-semibold leading-[21px] text-ink-1">{title}</span>
        <span className="block truncate text-secondary text-ink-2">{openRoleLine(role)}</span>
      </span>
      <ChevronRight className="h-[18px] w-[18px] shrink-0 text-ink-4" strokeWidth={2} />
    </button>
  )
}

export default function ClubProfileScreen({
  profile, readOnly, isOwnProfile, authProfileRole, onEdit, onViewPublic, onMessage, sendingMessage = false,
  onOpenFriends, onOpenSquad, onOpenRoles, onPostRole, onOpenClubLeague, onOpenPosts,
}: ClubProfileScreenProps) {
  const navigate = useNavigate()
  const location = useLocation()
  const { user } = useAuthStore()
  const addToast = useToastStore((s) => s.addToast)
  const owner = !readOnly
  const isVisitorView = readOnly && !isOwnProfile
  const data = useClubProfileScrollData(profile.id, profile.current_world_club_id ?? null, owner)
  const friendship = useFriendship(profile.id)
  const { countries } = useCountries()
  const [tab, setTab] = useState<Tab>('about')
  const [bioOpen, setBioOpen] = useState(false)
  const [coverIndex, setCoverIndex] = useState(0)
  const [signIn, setSignIn] = useState(false)
  const [viewers, setViewers] = useState(false)
  const [composer, setComposer] = useState(false)

  const flag = useMemo(() => countries.find((c) => c.id === profile.nationality_country_id)?.flag_emoji ?? null, [countries, profile.nationality_country_id])
  const menLeague = profile.mens_league_division?.trim() || null
  const womenLeague = profile.womens_league_division?.trim() || null
  const leagueShort = menLeague ?? womenLeague
  const leagueLine = clubLeagueLine(menLeague, womenLeague)
  const base = profile.base_location?.trim() || null
  const identityLine = [base ? [flag, base].filter(Boolean).join(' ') : null, leagueShort].filter(Boolean).join(' · ')
  const bio = profile.club_bio?.trim() || null
  const bioLong = (bio?.length ?? 0) > 180
  const website = profile.website?.trim() || null
  const linked = Boolean(profile.current_world_club_id)
  const friendCount = profile.accepted_friend_count ?? 0
  const openRoles = data.openRoles
  // Recruiting = the club has at least one open role (DEV NOTE). Not
  // profiles.open_to_opportunities: that is a player/coach availability flag.
  const recruiting = openRoles.length > 0
  const crestUrl = profile.avatar_url ? getImageUrl(profile.avatar_url, 'avatar-md') ?? profile.avatar_url : null
  const hasCover = data.photos.length > 0
  const glass = hasCover ? 'bg-black/40 text-white' : 'bg-white/90 text-ink-1 shadow-sm'
  const GLASS = `flex h-9 w-9 items-center justify-center rounded-full backdrop-blur ${glass}`

  const share = async () => {
    const url = publicProfileShareUrl(profile.role, profile.id, profile.username)
    if (!url) return
    try {
      if (typeof navigator !== 'undefined' && navigator.share) {
        await navigator.share({ title: profile.full_name ?? 'HOCKIA club', url })
        return
      }
      await navigator.clipboard.writeText(url)
      addToast('Link copied', 'success')
    } catch (err) {
      if (!(err instanceof Error && err.name === 'AbortError')) logger.warn('[ClubProfileScreen] share failed', err)
    }
  }

  const addFriend = () => {
    if (!user) { setSignIn(true); return }
    if (friendship.isIncomingRequest) void friendship.acceptRequest()
    else if (!friendship.isFriend && !friendship.isOutgoingRequest) void friendship.sendRequest()
  }
  const friendButton = (() => {
    if (!isVisitorView) return null
    if (friendship.isFriend) return { label: 'Friends', icon: <Check className="h-[18px] w-[18px]" strokeWidth={2.5} />, cls: 'bg-positive-soft text-positive', disabled: true }
    if (friendship.isOutgoingRequest) return { label: 'Requested', icon: <Check className="h-[18px] w-[18px]" strokeWidth={2.5} />, cls: 'bg-surface-grouped text-ink-2', disabled: true }
    if (friendship.isIncomingRequest) return { label: 'Accept', icon: <UserPlus className="h-[18px] w-[18px]" strokeWidth={2} />, cls: 'bg-hockia-primary text-white', disabled: friendship.mutating }
    return { label: 'Add friend', icon: <Plus className="h-[18px] w-[18px]" strokeWidth={2.2} />, cls: 'bg-hockia-primary text-white', disabled: friendship.mutating }
  })()

  const openRole = (id: string) => navigate(`/opportunities/${id}`, { state: { from: location.pathname } })

  const stat = (value: number, label: string, onClick?: () => void) => (
    <button type="button" onClick={onClick} disabled={!onClick} className="flex flex-1 flex-col items-start text-left" aria-label={`${value} ${label}`}>
      <span className="text-[22px] font-semibold leading-[26px] tracking-[-0.11px] text-ink-1 tabular-nums">{value}</span>
      <span className="text-secondary text-ink-2">{label}</span>
    </button>
  )

  const empty = (text: string, onClick: () => void) => (
    <button type="button" onClick={onClick} className="flex h-[52px] w-full items-center justify-between rounded-card bg-surface-grouped px-4 text-row text-ink-2">
      {text} <Plus className="h-4 w-4 text-hockia-primary" strokeWidth={2.2} />
    </button>
  )
  const quiet = (text: string) => <p className="py-2 text-row text-ink-3">{text}</p>

  const TABS: { id: Tab; label: string }[] = [
    { id: 'about', label: 'About' }, { id: 'squad', label: 'Squad' }, { id: 'roles', label: 'Roles' }, { id: 'posts', label: 'Posts' },
  ]

  return (
    <section data-testid="club-profile-screen" className="bg-white">
      {/* Cover — the club's photos, swipeable, with the page dots */}
      <div className="relative h-[220px] w-full overflow-hidden bg-gradient-to-b from-hockia-soft to-white">
        {hasCover && (
          <div
            className="flex h-full w-full snap-x snap-mandatory overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
            onScroll={(e) => setCoverIndex(Math.round(e.currentTarget.scrollLeft / Math.max(1, e.currentTarget.clientWidth)))}
          >
            {data.photos.map((p, i) => (
              <div key={p.id} className="h-full w-full shrink-0 snap-start">
                <SmoothImage src={getImageUrl(p.url, 'lightbox') ?? p.url} alt={p.caption ?? ''} eager={i === 0} priority={i === 0} className="object-cover" />
              </div>
            ))}
          </div>
        )}
        {hasCover && <div className="pointer-events-none absolute inset-0 bg-gradient-to-b from-black/35 via-transparent to-black/15" aria-hidden="true" />}
        {data.photos.length > 1 && (
          <div className="pointer-events-none absolute inset-x-0 bottom-2.5 flex justify-center gap-1" aria-hidden="true">
            {data.photos.map((p, i) => <span key={p.id} className={cn('h-1.5 w-1.5 rounded-full', i === coverIndex ? 'bg-white' : 'bg-white/45')} />)}
          </div>
        )}
        <div className="absolute inset-x-0 top-0 flex items-center justify-between px-4 pt-[max(env(safe-area-inset-top),0.75rem)]">
          {owner ? <span /> : (
            <button type="button" onClick={() => (window.history.length > 1 ? navigate(-1) : navigate('/community'))} aria-label="Back" className={GLASS}>
              <ChevronLeft className="h-[22px] w-[22px]" strokeWidth={1.8} />
            </button>
          )}
          <div className="flex items-center gap-2">
            <button type="button" onClick={() => void share()} aria-label="Share profile" className={GLASS}>
              <Share className="h-[20px] w-[20px]" strokeWidth={1.6} />
            </button>
            {owner && (
              <button type="button" onClick={() => navigate('/settings')} aria-label="Settings" className={GLASS}>
                <Settings className="h-[20px] w-[20px]" strokeWidth={1.6} />
              </button>
            )}
            {isVisitorView && (
              <span className={cn(GLASS, '[&>button]:h-9 [&>button]:min-h-0 [&>button]:w-9 [&>button]:min-w-0 [&>button]:rounded-full [&>button]:hover:bg-transparent [&_svg]:!text-current')}>
                <ProfileActionMenu targetId={profile.id} targetName={profile.full_name ?? 'this club'} />
              </span>
            )}
          </div>
        </div>
      </div>

      {/* Identity */}
      <div className="px-5 pb-4">
        <div className="flex h-[52px] items-end justify-between">
          <div className="relative h-[52px] w-24">
            <div className="absolute left-0 top-[-44px] flex h-24 w-24 items-center justify-center overflow-hidden rounded-[23px] border-[3px] border-white bg-white shadow-[0_4px_12px_rgba(0,0,0,0.12)]">
              {crestUrl ? (
                <img src={crestUrl} alt="" className="h-[88px] w-[88px] object-contain" decoding="async" />
              ) : (
                <EntityAvatar src={null} name={profile.full_name} role="club" size={88} />
              )}
            </div>
          </div>
          {recruiting && (
            <span className="mb-0.5 inline-flex items-center gap-1.5 rounded-full bg-positive-soft px-2.5 py-[5px] text-caption font-semibold text-[#1b8a3f]">
              <span className="h-1.5 w-1.5 rounded-full bg-[#1b8a3f]" aria-hidden="true" />
              Recruiting
            </span>
          )}
        </div>
        <h1 className="mt-2.5 text-[28px] font-bold leading-[34px] tracking-[-0.336px] text-ink-1">{profile.full_name}</h1>
        {identityLine && <p className="mt-2.5 text-row text-ink-2" data-testid="club-identity-line">{identityLine}</p>}

        <div className="mt-3.5 flex items-stretch gap-2">
          {owner ? (
            <>
              <button type="button" onClick={onEdit} className="flex h-11 flex-1 items-center justify-center gap-1.5 rounded-full bg-surface-grouped text-row font-semibold text-ink-1 active:bg-gray-200">
                <PenLine className="h-[18px] w-[18px]" strokeWidth={1.8} /> Edit profile
              </button>
              <button type="button" onClick={onViewPublic} className="flex h-11 flex-1 items-center justify-center gap-1.5 rounded-full bg-surface-grouped text-row font-semibold text-ink-1 active:bg-gray-200">
                <Eye className="h-[18px] w-[18px]" strokeWidth={1.8} /> Public view
              </button>
            </>
          ) : isVisitorView ? (
            <>
              {friendButton && (
                <button type="button" onClick={addFriend} disabled={friendButton.disabled} className={`flex h-11 flex-1 items-center justify-center gap-1.5 rounded-full text-row font-semibold ${friendButton.cls} disabled:opacity-100`}>
                  {friendButton.icon} {friendButton.label}
                </button>
              )}
              {authProfileRole !== 'brand' && (
                <button type="button" onClick={onMessage} disabled={sendingMessage} className="flex h-11 flex-1 items-center justify-center gap-1.5 rounded-full bg-surface-grouped text-row font-semibold text-ink-1 disabled:opacity-60">
                  <MessageCircle className="h-[18px] w-[18px]" strokeWidth={1.8} /> {sendingMessage ? 'Opening…' : 'Message'}
                </button>
              )}
            </>
          ) : null}
        </div>
      </div>

      {/* Stats — the number opens the collection */}
      <div className="flex px-5 pb-4" data-testid="club-stats">
        {stat(data.memberCount, plural(data.memberCount, 'member', 'members'), onOpenSquad)}
        {stat(friendCount, plural(friendCount, 'friend', 'friends'), onOpenFriends)}
        {stat(openRoles.length, plural(openRoles.length, 'open role', 'open roles'), () => setTab('roles'))}
      </div>

      {/* Own: the private group. Public: the open role. */}
      {owner && (
        <div className="px-5 pb-3.5 pt-1" data-testid="club-owner-group">
          <div className="rounded-2xl bg-surface-grouped">
            <GroupRow
              icon={linked && (data.worldClub?.crestUrl || crestUrl) ? (
                <span className="flex h-8 w-8 shrink-0 items-center justify-center overflow-hidden rounded-lg border-[0.5px] border-line bg-white">
                  <img src={getImageUrl(data.worldClub?.crestUrl ?? profile.avatar_url ?? null, 'avatar-sm') ?? data.worldClub?.crestUrl ?? crestUrl ?? undefined} alt="" className="h-[26px] w-[26px] object-contain" />
                </span>
              ) : <TintedIcon><Shield className="h-[18px] w-[18px]" strokeWidth={2} /></TintedIcon>}
              title="Club & league"
              sub={linked ? `Linked · ${leagueShort ?? data.worldClub?.clubName ?? 'league not set'}` : 'Not linked yet · link your club'}
              onClick={onOpenClubLeague}
            />
            <div className="ml-[58px] h-[0.5px] bg-line" />
            <GroupRow
              icon={<TintedIcon><Users className="h-[18px] w-[18px]" strokeWidth={2} /></TintedIcon>}
              title="Squad"
              sub={data.memberCount > 0 ? `${data.memberCount} ${plural(data.memberCount, 'member', 'members')} · players and staff` : 'No one yet · invite players and staff'}
              onClick={onOpenSquad}
            />
            <div className="ml-[58px] h-[0.5px] bg-line" />
            <GroupRow
              icon={<TintedIcon><Eye className="h-[18px] w-[18px]" strokeWidth={2} /></TintedIcon>}
              title="Profile views"
              trailing={`${data.viewsThisWeek ?? 0} this week`}
              onClick={() => setViewers(true)}
            />
          </div>
        </div>
      )}
      {!owner && openRoles[0] && (
        <div className="px-5 pb-3.5 pt-1" data-testid="club-open-role">
          <RoleCard role={openRoles[0]} onOpen={() => openRole(openRoles[0].id)} />
        </div>
      )}

      {/* Tabs */}
      <div className="flex gap-6 px-5" role="tablist" aria-label="Club profile sections">
        {TABS.map((t) => (
          <button key={t.id} type="button" role="tab" aria-selected={tab === t.id} onClick={() => setTab(t.id)} className="flex flex-col items-center gap-[9px] pt-0.5">
            <span className={cn('text-row font-semibold', tab === t.id ? 'text-ink-1' : 'text-ink-3')}>{t.label}</span>
            <span className={cn('h-0.5 w-full rounded-[1px]', tab === t.id ? 'bg-ink-1' : 'bg-transparent')} />
          </button>
        ))}
      </div>
      <div className="h-[0.5px] bg-line" />

      {tab === 'about' && (
        <div data-testid="club-about">
          {bio && (
            <div className="flex flex-col items-start gap-1.5 px-5 pb-1.5 pt-[18px]">
              <p className={cn('text-row leading-[21px] text-ink-1 whitespace-pre-line', !bioOpen && 'line-clamp-4')}>{bio}</p>
              {bioLong && (
                <button type="button" onClick={() => setBioOpen((v) => !v)} className="text-row font-semibold text-hockia-primary">{bioOpen ? 'Read less' : 'Read more'}</button>
              )}
            </div>
          )}
          {!bio && owner && <div className="px-5 pt-[18px]">{empty('Tell players about your club', onEdit)}</div>}
          <div className="px-5 pt-2">
            {(base || owner) && <FactRow icon={<MapPin className="h-[22px] w-[22px]" strokeWidth={1.6} />} text={base ?? 'Add your city'} onClick={owner ? onEdit : undefined} />}
            {(leagueLine || owner) && (
              <FactRow
                icon={<Trophy className="h-[22px] w-[22px]" strokeWidth={1.6} />}
                text={leagueLine ?? 'Add your league'}
                onClick={owner ? onOpenClubLeague : data.worldClub ? () => navigate(`/world/clubs/${data.worldClub!.id}`) : undefined}
              />
            )}
            {(website || owner) && <FactRow icon={<Globe className="h-[22px] w-[22px]" strokeWidth={1.6} />} text={website ? hostOf(website) : 'Add your website'} href={website && !owner ? (/^https?:\/\//i.test(website) ? website : `https://${website}`) : undefined} onClick={owner ? onEdit : undefined} last />}
          </div>
        </div>
      )}

      {tab === 'squad' && (
        <div className="flex flex-col gap-3 px-5 pt-4" data-testid="club-squad">
          {data.members.length === 0 && !data.loading && (owner ? empty('Invite players and staff', onOpenSquad) : quiet('No one on the squad yet.'))}
          {data.members.map((m) => (
            <button key={m.id} type="button" onClick={() => navigate(m.role === 'coach' ? `/coaches/id/${m.id}` : `/players/id/${m.id}`)} className="flex w-full items-center gap-3 py-1 text-left">
              <EntityAvatar src={m.avatarUrl ? getImageUrl(m.avatarUrl, 'avatar-md') ?? m.avatarUrl : null} name={m.fullName} role={m.role} size={40} />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-row font-semibold text-ink-1">{m.fullName}</span>
                <span className="block truncate text-secondary text-ink-2">{[roleLabel(m.role as 'player' | 'coach'), m.position ? humanizeToken(m.position) : null].filter(Boolean).join(' · ')}</span>
              </span>
              <ChevronRight className="h-4 w-4 shrink-0 text-ink-4" strokeWidth={2} />
            </button>
          ))}
          {data.memberCount > data.members.length && (
            <button type="button" onClick={onOpenSquad} className="flex items-center gap-0.5 text-row font-semibold text-hockia-primary">See all {data.memberCount} <ChevronRight className="h-4 w-4" strokeWidth={2} /></button>
          )}
        </div>
      )}

      {tab === 'roles' && (
        <div className="flex flex-col gap-3 px-5 pt-4" data-testid="club-roles">
          {owner && (
            <div className="flex items-center justify-between">
              <span className="text-row text-ink-2">{openRoles.length} open · applicants in Opportunities</span>
              <button type="button" onClick={onOpenRoles} className="text-row font-semibold text-hockia-primary">Manage</button>
            </div>
          )}
          {openRoles.length === 0 && !data.loading && (owner ? empty('Post a role', onPostRole) : quiet('No open roles right now.'))}
          {openRoles.map((r) => <RoleCard key={r.id} role={r} onOpen={() => openRole(r.id)} />)}
        </div>
      )}

      {tab === 'posts' && (
        <div className="flex flex-col gap-3 px-5 pt-4" data-testid="club-posts">
          {data.posts.length === 0 && !data.loading && (owner ? empty('New post', () => setComposer(true)) : quiet('No posts yet.'))}
          {data.posts.length > 0 && (
            <div className="flex flex-wrap gap-3">
              {data.posts.map((p) => <PostTile key={p.post_id} post={p} onOpen={() => navigate(`/post/${p.post_id}`)} />)}
            </div>
          )}
          {data.postCount > data.posts.length && (
            <button type="button" onClick={onOpenPosts} className="flex items-center gap-0.5 text-row font-semibold text-hockia-primary">See all {data.postCount} <ChevronRight className="h-4 w-4" strokeWidth={2} /></button>
          )}
        </div>
      )}

      <div className="h-6" />

      <SignInPromptModal isOpen={signIn} onClose={() => setSignIn(false)} title="Sign in to add friends" action="connect" />

      {owner && (
        <BottomSheet open={viewers} onClose={() => setViewers(false)} ariaLabel="Profile views">
          <div className="px-1 pb-4"><ProfileViewersSection /></div>
        </BottomSheet>
      )}

      {composer && (
        <PostComposerModal isOpen={composer} onClose={() => setComposer(false)} onPostCreated={() => { setComposer(false); data.refresh() }} />
      )}
    </section>
  )
}
