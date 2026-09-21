import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Check, PenLine, Search, UserPlus } from 'lucide-react'
import { DetailNavBar } from '@/components/ui/DetailNavBar'
import { EntityAvatar } from '@/components/ui/EntityAvatar'
import AddReferenceModal, { type ReferenceFriendOption } from '@/components/AddReferenceModal'
import SignInPromptModal from '@/components/SignInPromptModal'
import { useAuthStore } from '@/lib/auth'
import { useCountries } from '@/hooks/useCountries'
import { useFriendsList, type FriendPerson } from '@/hooks/useFriendsList'
import { useFriendsInCommon } from '@/hooks/useFriendsInCommon'
import { useFriendship } from '@/hooks/useFriendship'
import { useTrustedReferences } from '@/hooks/useTrustedReferences'
import { getSpecializationLabel } from '@/lib/coachSpecializations'
import { getImageUrl } from '@/lib/imageUrl'
import { humanizeToken, identityLine } from '@/lib/identity'
import { profilePath } from '@/lib/profileNavigation'

/**
 * Friends / Friends — public (Figma 101:460 · 250:581): one screen, two
 * modes. Own rows carry the owner tools (Ask for reference · Requested ·
 * Wrote you a reference). Public rows are viewer-relative — Friends,
 * Requested, Accept or Add — with people in common first and a gold
 * "Wrote a reference" on whoever vouched for the profile owner. Owner-only
 * actions never render for another viewer.
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
  if (p.role === 'coach') return p.coachSpecialization ? getSpecializationLabel(p.coachSpecialization, p.coachSpecializationCustom) : null
  if (p.role === 'umpire') return p.umpireLevel
  return null
}

function RelationshipAction({ personId }: { personId: string }) {
  const f = useFriendship(personId)
  if (f.isOwnProfile) return null
  const quiet = 'flex h-8 shrink-0 items-center gap-1 rounded-full bg-surface-grouped px-3 text-secondary font-semibold text-ink-2'
  if (f.isFriend) return <span className={quiet}><Check className="h-3.5 w-3.5" strokeWidth={2.5} /> Friends</span>
  if (f.isOutgoingRequest) return <span className={quiet}><Check className="h-3.5 w-3.5" strokeWidth={2.5} /> Requested</span>
  return (
    <button
      type="button"
      disabled={f.mutating}
      onClick={() => void (f.isIncomingRequest ? f.acceptRequest() : f.sendRequest())}
      className="flex h-8 shrink-0 items-center gap-1 rounded-full bg-hockia-soft px-3 text-secondary font-semibold text-hockia-primary disabled:opacity-60"
    >
      <UserPlus className="h-3.5 w-3.5" strokeWidth={2.2} /> {f.isIncomingRequest ? 'Accept' : 'Add'}
    </button>
  )
}

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
    const passportFlags = flags(p)
    const vouched = wrote.has(p.id)
    return (
      <li key={p.id} className="flex items-center gap-3 border-b border-line py-3 last:border-b-0">
        <button
          type="button"
          onClick={() => { const to = profilePath(p.role, p.username, p.id); if (to) navigate(to) }}
          className="flex min-w-0 flex-1 items-center gap-3 text-left"
        >
          <EntityAvatar src={p.avatarUrl ? getImageUrl(p.avatarUrl, 'avatar-md') ?? p.avatarUrl : null} name={name} role={p.role} size={48} />
          <span className="min-w-0 flex-1">
            <span className="block truncate text-row font-semibold text-ink-1">{name}</span>
            {/* One line, always: the identity text truncates, the flags never do. */}
            <span className="flex min-w-0 items-center text-secondary text-ink-2">
              <span className="min-w-0 truncate">{identityLine(p.role, detailFor(p))}</span>
              {passportFlags && <span className="shrink-0 whitespace-pre"> · {passportFlags}</span>}
            </span>
            {!own && vouched && (
              <span className="mt-1 inline-flex h-[22px] items-center gap-1 rounded-full bg-amber-50 px-2 text-caption font-semibold text-amber-600">
                <PenLine className="h-3 w-3" strokeWidth={2.2} /> Wrote a reference
              </span>
            )}
          </span>
        </button>
        {own ? (
          vouched ? (
            <span className="shrink-0 text-caption font-semibold text-positive">Wrote you a reference</span>
          ) : asked.has(p.id) ? (
            <span className="flex h-8 shrink-0 items-center gap-1 rounded-full bg-surface-grouped px-3 text-secondary font-semibold text-ink-2"><Check className="h-3.5 w-3.5" strokeWidth={2.5} /> Requested</span>
          ) : canAsk ? (
            <button type="button" onClick={() => setAskFor(p.id)} disabled={!refs.canAddMore} className="flex h-8 shrink-0 items-center rounded-full bg-hockia-soft px-3 text-secondary font-semibold text-hockia-primary disabled:opacity-50">
              Ask for reference
            </button>
          ) : null
        ) : (
          <RelationshipAction personId={p.id} />
        )}
      </li>
    )
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
            <button type="button" onClick={() => navigate('/community')} aria-label="Find people" className="flex h-11 w-11 items-center justify-center text-ink-1">
              <UserPlus className="h-[22px] w-[22px]" strokeWidth={1.8} />
            </button>
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
            <button type="button" onClick={() => setJoin(true)} className="mt-4 flex h-[46px] w-full items-center justify-center rounded-full bg-hockia-primary text-row font-semibold text-white">Join Hockia</button>
          </div>
        ) : loading ? (
          <ul aria-busy="true">
            {Array.from({ length: 6 }, (_, i) => (
              <li key={i} className="flex items-center gap-3 border-b border-line py-3">
                <span className="h-12 w-12 animate-pulse rounded-full bg-surface-grouped" />
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
                <h2 className="pb-1 pt-3 text-secondary font-semibold text-ink-2">In common · {inCommon.length}</h2>
                <ul>{inCommon.map(row)}</ul>
                {rest.length > 0 && <h2 className="pb-1 pt-5 text-secondary font-semibold text-ink-2">All friends</h2>}
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
