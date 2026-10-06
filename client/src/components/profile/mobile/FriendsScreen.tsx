import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Search, UserPlus } from 'lucide-react'
import { DetailNavBar } from '@/components/ui/DetailNavBar'
import { FriendListItem, type FriendTrailing } from '@/components/ui/FriendListItem'
import { IconButton } from '@/components/ui/IconButton'
import { buttonClassName } from '@/components/ui/buttonClasses'
import AddReferenceModal, { type ReferenceFriendOption } from '@/components/AddReferenceModal'
import SignInPromptModal from '@/components/SignInPromptModal'
import { useAuthStore } from '@/lib/auth'
import { useCountries } from '@/hooks/useCountries'
import { useFriendsList, type FriendPerson } from '@/hooks/useFriendsList'
import { useFriendsInCommon } from '@/hooks/useFriendsInCommon'
import { useFriendship } from '@/hooks/useFriendship'
import { useTrustedReferences } from '@/hooks/useTrustedReferences'
import { getImageUrl } from '@/lib/imageUrl'
import { coachSpecialtyLabel, humanizeToken, identityLine } from '@/lib/identity'
import { profilePath } from '@/lib/profileNavigation'

/**
 * Friends / Friends — public (Figma 101:460 · 250:581): one screen, two
 * modes. Own rows carry the owner tools (Ask for reference · Requested ·
 * Wrote you a reference, in gold). Public rows are viewer-relative — Friends,
 * Requested, Accept or Add — with people in common first and a gold
 * "Wrote a reference" on whoever vouched for the profile owner. Owner-only
 * actions never render for another viewer. Rows are List item / Friend
 * (`ui/FriendListItem`).
 */
interface FriendsScreenProps {
  profileId: string
  profileName: string | null
  profileRole: string | null
  mode: 'own' | 'public'
  onBack: () => void
}

function detailFor(p: FriendPerson): string | null {
  if (p.role === 'player') return humanizeToken(p.position)
  if (p.role === 'coach') return coachSpecialtyLabel(p.coachSpecialization, p.coachSpecializationCustom)
  if (p.role === 'umpire') return p.umpireLevel
  return null
}

/** Public list: the trailing state is the VIEWER's relationship with that person. */
function PublicFriendRow({ person, meta, flags, vouched, onOpen }: { person: FriendPerson; meta: string; flags: string; vouched: boolean; onOpen: () => void }) {
  const f = useFriendship(person.id)
  const name = person.fullName?.trim() || 'Hockia member'
  const trailing: FriendTrailing = f.isOwnProfile
    ? { kind: 'none' }
    : f.isFriend
      ? { kind: 'friends' }
      : f.isOutgoingRequest
        ? { kind: 'requested' }
        : { kind: 'add', label: f.isIncomingRequest ? 'Accept' : 'Add', disabled: f.mutating, onClick: () => void (f.isIncomingRequest ? f.acceptRequest() : f.sendRequest()) }
  return <FriendListItem name={name} avatarUrl={avatarOf(person)} role={person.role} meta={meta} flags={flags} showReference={vouched} trailing={trailing} onOpen={onOpen} />
}

const avatarOf = (p: FriendPerson) => (p.avatarUrl ? getImageUrl(p.avatarUrl, 'avatar-md') ?? p.avatarUrl : null)

export default function FriendsScreen({ profileId, profileName, profileRole, mode, onBack }: FriendsScreenProps) {
  const navigate = useNavigate()
  const user = useAuthStore((s) => s.user)
  const own = mode === 'own'
  const signedOut = !own && !user
  const { people, loading, failed } = useFriendsList(profileId, mode, !signedOut)
  const { countries } = useCountries()
  const refs = useTrustedReferences(profileId)
  const common = useFriendsInCommon(own ? null : profileId)
  const [query, setQuery] = useState('')
  const [askFor, setAskFor] = useState<string | null>(null)
  const [join, setJoin] = useState(false)

  const firstName = profileName?.trim().split(/\s+/)[0] || null
  const wrote = useMemo(() => new Set(refs.acceptedReferences.map((r) => r.profile?.id).filter((id): id is string => Boolean(id))), [refs.acceptedReferences])
  const asked = useMemo(() => new Set(refs.pendingReferences.map((r) => r.profile?.id).filter((id): id is string => Boolean(id))), [refs.pendingReferences])
  // request_reference only lets players, coaches and umpires collect references.
  const canAsk = own && (profileRole === 'player' || profileRole === 'coach' || profileRole === 'umpire')

  const flags = (p: FriendPerson) => p.countryIds.map((id) => countries.find((c) => c.id === id)?.flag_emoji).filter(Boolean).join(' ')
  const needle = query.trim().toLowerCase()
  // The viewer's own row never appears in someone else's list.
  const listed = own ? people : people.filter((p) => p.id !== user?.id)
  const visible = needle ? listed.filter((p) => (p.fullName ?? '').toLowerCase().includes(needle)) : listed
  const commonIds = useMemo(() => new Set(common.people.map((p) => p.id)), [common.people])
  const inCommon = own ? [] : visible.filter((p) => commonIds.has(p.id))
  const rest = own ? visible : visible.filter((p) => !commonIds.has(p.id))

  const friendOptions: ReferenceFriendOption[] = people
    .filter((p) => !wrote.has(p.id) && !asked.has(p.id))
    .map((p) => ({ id: p.id, fullName: p.fullName ?? 'Hockia member', username: p.username, avatarUrl: p.avatarUrl, role: p.role, baseLocation: null, currentClub: null, acceptedAt: p.connectedAt }))

  const row = (p: FriendPerson) => {
    const name = p.fullName?.trim() || 'Hockia member'
    const vouched = wrote.has(p.id)
    const meta = identityLine(p.role, detailFor(p))
    const open = () => { const to = profilePath(p.role, p.username, p.id); if (to) navigate(to) }
    if (!own) return <PublicFriendRow key={p.id} person={p} meta={meta} flags={flags(p)} vouched={vouched} onOpen={open} />
    // Own list: the owner tools. "Wrote you a reference" is trust → gold.
    const trailing: FriendTrailing = vouched
      ? { kind: 'wrote' }
      : asked.has(p.id)
        ? { kind: 'requested' }
        : canAsk
          ? { kind: 'ask', onClick: () => setAskFor(p.id), disabled: !refs.canAddMore }
          : { kind: 'none' }
    return <FriendListItem key={p.id} name={name} avatarUrl={avatarOf(p)} role={p.role} meta={meta} flags={flags(p)} trailing={trailing} onOpen={open} />
  }

  const title = own ? `Friends · ${people.length}` : firstName ? `${firstName}’s friends` : 'Friends'

  return (
    <div className="min-h-screen bg-white pb-24 lg:hidden" data-testid={own ? 'friends-screen-own' : 'friends-screen-public'}>
      <div className="sticky top-0 z-20 bg-white pt-[env(safe-area-inset-top)]">
        <DetailNavBar
          parent="Profile"
          title={loading && own ? 'Friends' : title}
          onBack={onBack}
          trailing={own ? (
            <IconButton label="Add friends" onClick={() => navigate('/community')}>
              <UserPlus className="h-[22px] w-[22px]" strokeWidth={1.8} />
            </IconButton>
          ) : undefined}
        />
        {!signedOut && (
          <div className="px-5 pb-2 pt-1">
            <label className="flex h-11 items-center gap-2 rounded-[12px] bg-surface-grouped px-3">
              <Search className="h-[18px] w-[18px] text-ink-3" strokeWidth={2} />
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder={own ? 'Search friends' : firstName ? `Search ${firstName}’s friends` : 'Search friends'}
                className="h-full min-w-0 flex-1 bg-transparent text-body text-ink-1 placeholder:text-ink-3 focus:outline-none"
              />
            </label>
          </div>
        )}
      </div>

      <div className="px-5">
        {signedOut ? (
          <div className="mt-6 rounded-card bg-surface-grouped p-5">
            <p className="text-row font-semibold text-ink-1">Join Hockia to see {firstName ? `${firstName}’s` : 'their'} friends</p>
            <p className="mt-1 text-secondary text-ink-2">Friends lists are for members only.</p>
            <button type="button" onClick={() => setJoin(true)} className={buttonClassName({ variant: 'primary', size: 'large', radius: 'rounded-full', block: true, className: 'mt-4' })}>Join Hockia</button>
          </div>
        ) : loading ? (
          <ul aria-busy="true">
            {Array.from({ length: 6 }, (_, i) => (
              <li key={i} className="flex items-center gap-3 border-b border-line py-3">
                <span className="h-[52px] w-[52px] animate-pulse rounded-full bg-surface-grouped" />
                <span className="flex-1 space-y-2"><span className="block h-3.5 w-36 animate-pulse rounded bg-surface-grouped" /><span className="block h-3 w-24 animate-pulse rounded bg-surface-grouped" /></span>
              </li>
            ))}
          </ul>
        ) : failed ? (
          <p className="py-10 text-center text-row text-ink-2">Friends could not be loaded. Pull back and try again.</p>
        ) : people.length === 0 ? (
          <div className="py-12 text-center">
            <p className="text-row font-semibold text-ink-1">{own ? 'No friends yet' : 'No friends to show'}</p>
            {own && <button type="button" onClick={() => navigate('/community')} className="mt-3 text-row font-semibold text-hockia-primary">Find people in Community</button>}
          </div>
        ) : visible.length === 0 ? (
          <p className="py-10 text-center text-row text-ink-2">No one matches “{query.trim()}”.</p>
        ) : (
          <>
            {inCommon.length > 0 && (
              <>
                <h2 className="pb-1 pt-3 text-[20px] font-semibold leading-6 text-ink-1">In common · {inCommon.length}</h2>
                <ul>{inCommon.map(row)}</ul>
                {rest.length > 0 && <h2 className="pb-1 pt-5 text-[20px] font-semibold leading-6 text-ink-1">All friends</h2>}
              </>
            )}
            <ul>{rest.map(row)}</ul>
          </>
        )}
      </div>

      {own && (
        <AddReferenceModal
          isOpen={askFor !== null}
          onClose={() => setAskFor(null)}
          friends={friendOptions}
          onSubmit={refs.requestReference}
          isSubmitting={refs.isMutating('request')}
          remainingSlots={refs.maxReferences - refs.acceptedCount}
          requesterRole={profileRole}
          preselectedFriendId={askFor}
        />
      )}
      <SignInPromptModal isOpen={join} onClose={() => setJoin(false)} title="Sign in to see friends" action="view" />
    </div>
  )
}
