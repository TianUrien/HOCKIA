import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Check, ChevronRight } from 'lucide-react'
import { DetailNavBar } from '@/components/ui/DetailNavBar'
import { EntityAvatar } from '@/components/ui/EntityAvatar'
import AddReferenceModal, { type ReferenceFriendOption } from '@/components/AddReferenceModal'
import WriteReferenceSheet from './WriteReferenceSheet'
import ConfirmActionModal from '@/components/ConfirmActionModal'
import { useAuthStore } from '@/lib/auth'
import { useFriendsList } from '@/hooks/useFriendsList'
import { useTrustedReferences, type PublicReferenceCard } from '@/hooks/useTrustedReferences'
import { getImageUrl } from '@/lib/imageUrl'
import { humanizeToken, identityLine } from '@/lib/identity'
import { profilePath } from '@/lib/profileNavigation'
import { cn } from '@/lib/utils'

/**
 * References — all + Reference detail (Figma 153:715 · 165:581 · 165:636).
 * One screen, two modes. Both list every accepted reference, gold-bordered,
 * newest first; a card opens the detail — the whole quote large, the author
 * (club crest or person avatar) with View profile, then relationship, written
 * date and verified status, because a club checks those before believing the
 * quote. Two taps live on a card: the card reads, the author row goes to the
 * person or club.
 *
 * Own mode adds the owner tools: Ask for a reference, what is still requested,
 * and the requests waiting for the owner to write. Public mode shows Write a
 * reference ONLY when the profile owner has asked this viewer for one — the
 * backend has no unsolicited references, so the button never pretends.
 */
interface ReferencesScreenProps {
  profileId: string
  profileName: string | null
  profileRole: string | null
  mode: 'own' | 'public'
  /** Open straight on one reference (a card tapped on the profile). */
  initialReferenceId?: string | null
  onBack: () => void
}

const MONTH = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
function monthYear(iso: string | null | undefined): string | null {
  const m = iso ? /^(\d{4})-(\d{2})/.exec(iso) : null
  return m ? `${MONTH[Number(m[2]) - 1]} ${m[1]}` : null
}

type Author = PublicReferenceCard['profile']
function authorLine(author: Author, relationship: string): string {
  const rel = humanizeToken(relationship)
  const detail = author?.role === 'coach' || author?.role === 'player' ? [rel, author.currentClub].filter(Boolean).join(' · ') : rel
  return identityLine(author?.role, detail)
}
function authorAvatar(author: Author, size: 'avatar-md' | 'avatar-lg' = 'avatar-md') {
  return author?.avatarUrl ? getImageUrl(author.avatarUrl, size) ?? author.avatarUrl : null
}

function Verified({ className }: { className?: string }) {
  return <span className={cn('flex items-center gap-1 font-semibold text-gold', className)}><Check className="h-3.5 w-3.5" strokeWidth={2.5} /> Verified · written on Hockia</span>
}

export default function ReferencesScreen({ profileId, profileName, profileRole, mode, initialReferenceId = null, onBack }: ReferencesScreenProps) {
  const navigate = useNavigate()
  const viewerId = useAuthStore((s) => s.user?.id ?? null)
  const own = mode === 'own'
  const refs = useTrustedReferences(profileId)
  // The viewer's own reference desk: requests other members sent THEM.
  const mine = useTrustedReferences(own ? profileId : viewerId ?? '')
  const friends = useFriendsList(own ? profileId : null, 'own', own)
  const [openId, setOpenId] = useState<string | null>(initialReferenceId)
  // Arrived from a profile card → back returns to the profile, not the list.
  const [cameFromProfile, setCameFromProfile] = useState(Boolean(initialReferenceId))
  const [asking, setAsking] = useState(false)
  const [writingId, setWritingId] = useState<string | null>(null)
  // Withdrawing has no undo — always confirmed first (same pattern as Delete
  // on Career entry).
  const [withdrawId, setWithdrawId] = useState<string | null>(null)

  const firstName = profileName?.trim().split(/\s+/)[0] || null
  const list = useMemo(
    () => [...refs.acceptedReferences].sort((a, b) => (b.acceptedAt ?? '').localeCompare(a.acceptedAt ?? '')),
    [refs.acceptedReferences],
  )
  const open = openId ? list.find((r) => r.id === openId) ?? null : null
  const canAsk = own && (profileRole === 'player' || profileRole === 'coach' || profileRole === 'umpire')

  const incoming = own ? mine.incomingRequests : mine.incomingRequests.filter((r) => r.requesterProfile?.id === profileId)
  const writing = writingId ? incoming.find((r) => r.id === writingId) ?? null : null

  const taken = useMemo(() => new Set([...refs.acceptedReferences, ...refs.pendingReferences].map((r) => r.profile?.id).filter(Boolean)), [refs.acceptedReferences, refs.pendingReferences])
  const friendOptions: ReferenceFriendOption[] = friends.people
    .filter((p) => !taken.has(p.id))
    .map((p) => ({ id: p.id, fullName: p.fullName ?? 'Hockia member', username: p.username, avatarUrl: p.avatarUrl, role: p.role, baseLocation: null, currentClub: null, acceptedAt: p.connectedAt }))

  const goToAuthor = (author: Author) => {
    const to = author ? profilePath(author.role, author.username, author.id) : null
    if (to) navigate(to)
  }

  if (open) {
    const author = open.profile
    const name = author?.fullName?.trim() || 'Hockia member'
    return (
      <div className="min-h-screen bg-white pb-24 lg:hidden" data-testid="reference-detail-screen">
        <div className="sticky top-0 z-20 bg-white pt-[env(safe-area-inset-top)]">
          <DetailNavBar parent={firstName ?? 'References'} title="Reference" showParent onBack={() => { if (cameFromProfile) onBack(); else setOpenId(null) }} />
        </div>
        <div className="px-5 pt-3">
          <button type="button" onClick={() => goToAuthor(author)} className="flex w-full items-center gap-3.5 text-left">
            <span className={cn('inline-flex shrink-0 border border-gold-line p-[3px]', author?.role === 'club' || author?.role === 'brand' ? 'rounded-[14px]' : 'rounded-full')}>
              <EntityAvatar src={authorAvatar(author, 'avatar-lg')} name={name} role={author?.role} size={64} />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[20px] font-bold leading-6 text-ink-1">{name}</span>
              <span className="block truncate text-[14px] text-ink-2">{authorLine(author, open.relationshipType)}</span>
            </span>
          </button>
          <button type="button" onClick={() => goToAuthor(author)} className="mt-4 flex h-[46px] w-full items-center justify-center rounded-full bg-surface-grouped text-row font-semibold text-ink-1">
            View profile
          </button>

          <span className="mt-6 block h-7 font-serif text-[48px] italic leading-none text-gold-line" aria-hidden="true">“</span>
          <p className="mt-2 whitespace-pre-line text-[20px] leading-[28px] text-ink-1">{open.endorsementText?.trim() || `${name} vouches for ${firstName ?? 'this member'}.`}</p>

          <dl className="mt-7 divide-y divide-line border-t border-line">
            <div className="flex gap-3 py-3"><dt className="w-[110px] shrink-0 text-row text-ink-3">Relationship</dt><dd className="min-w-0 flex-1 text-row text-ink-1">{humanizeToken(open.relationshipType)}</dd></div>
            <div className="flex gap-3 py-3"><dt className="w-[110px] shrink-0 text-row text-ink-3">Written</dt><dd className="min-w-0 flex-1 text-row text-ink-1">{[monthYear(open.acceptedAt), 'on Hockia'].filter(Boolean).join(' · ')}</dd></div>
            <div className="flex gap-3 py-3"><dt className="w-[110px] shrink-0 text-row text-ink-3">Status</dt><dd className="flex min-w-0 flex-1 items-start gap-1 text-row font-semibold text-gold"><Check className="mt-0.5 h-4 w-4 shrink-0" strokeWidth={2.5} /> Verified · approved by {own ? 'you' : firstName ?? 'the member'}</dd></div>
          </dl>
        </div>
      </div>
    )
  }

  const count = refs.loading ? null : list.length
  return (
    <div className="min-h-screen bg-white pb-24 lg:hidden" data-testid={own ? 'references-screen-own' : 'references-screen-public'}>
      <div className="sticky top-0 z-20 bg-white pt-[env(safe-area-inset-top)]">
        <DetailNavBar parent={own ? 'Profile' : firstName ?? 'Profile'} title={count === null ? 'References' : `References · ${count}`} showParent onBack={onBack} />
      </div>

      <div className="flex flex-col gap-3 px-5 pt-2">
        {list.length > 0 && (
          <p className="flex items-start gap-1.5 text-secondary font-semibold text-gold">
            <Check className="mt-0.5 h-3.5 w-3.5 shrink-0" strokeWidth={2.5} /> All written on Hockia by friends, approved by {own ? 'you' : firstName ?? 'the member'}.
          </p>
        )}

        {canAsk && (
          <button type="button" onClick={() => setAsking(true)} disabled={!refs.canAddMore} className="flex h-[50px] w-full items-center justify-center rounded-full bg-hockia-soft text-body font-semibold text-hockia-primary disabled:opacity-50">
            Ask for a reference
          </button>
        )}
        {!own && incoming.length > 0 && (
          <button type="button" onClick={() => setWritingId(incoming[0].id)} className="flex h-[50px] w-full items-center justify-center rounded-full bg-hockia-soft text-body font-semibold text-hockia-primary">
            Write a reference
          </button>
        )}

        {own && incoming.length > 0 && (
          <section className="rounded-card bg-surface-grouped p-3.5">
            <h2 className="text-secondary font-semibold text-ink-2">Asked you for a reference · {incoming.length}</h2>
            <ul className="mt-1 divide-y divide-line">
              {incoming.map((r) => {
                const who = r.requesterProfile?.fullName?.trim() || 'Hockia member'
                return (
                  <li key={r.id} className="flex items-center gap-3 py-2.5">
                    <EntityAvatar src={authorAvatar(r.requesterProfile)} name={who} role={r.requesterProfile?.role} size={40} />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-row font-semibold text-ink-1">{who}</span>
                      <span className="block truncate text-secondary text-ink-2">{humanizeToken(r.relationshipType)}</span>
                    </span>
                    <button type="button" onClick={() => void mine.respondToRequest({ referenceId: r.id, accept: false })} className="h-8 rounded-full px-2 text-secondary font-semibold text-ink-2">Decline</button>
                    <button type="button" onClick={() => setWritingId(r.id)} className="h-8 rounded-full bg-hockia-primary px-3 text-secondary font-semibold text-white">Write</button>
                  </li>
                )
              })}
            </ul>
          </section>
        )}

        {refs.loading ? (
          Array.from({ length: 3 }, (_, i) => <div key={i} className="h-[150px] animate-pulse rounded-card bg-surface-grouped" />)
        ) : list.length === 0 ? (
          <div className="py-12 text-center">
            <p className="text-row font-semibold text-ink-1">{own ? 'No references yet' : 'No references to show'}</p>
            {own && <p className="mt-1 text-secondary text-ink-2">Friends who know your hockey can vouch for you. Clubs read these first.</p>}
          </div>
        ) : (
          list.map((r) => {
            const author = r.profile
            const name = author?.fullName?.trim() || 'Hockia member'
            return (
              <article key={r.id} className="rounded-card border border-gold-line bg-white p-3.5">
                <button type="button" onClick={() => goToAuthor(author)} aria-label={`Open ${name}’s profile`} className="flex w-full items-center gap-3 text-left">
                  <EntityAvatar src={authorAvatar(author)} name={name} role={author?.role} size={40} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-row font-semibold text-ink-1">{name}</span>
                    <span className="block truncate text-secondary text-ink-2">{authorLine(author, r.relationshipType)}</span>
                  </span>
                  <ChevronRight className="h-4 w-4 shrink-0 text-ink-4" strokeWidth={2} />
                </button>
                <button type="button" onClick={() => { setCameFromProfile(false); setOpenId(r.id) }} className="mt-2.5 block w-full text-left">
                  {r.endorsementText && <span className="line-clamp-4 block text-row leading-[21px] text-ink-1">“{r.endorsementText}”</span>}
                  <span className="mt-2.5 flex items-center justify-between">
                    <Verified className="text-caption" />
                    {r.acceptedAt && <span className="text-caption text-ink-3">{monthYear(r.acceptedAt)}</span>}
                  </span>
                </button>
              </article>
            )
          })
        )}

        {own && refs.pendingReferences.length > 0 && (
          <section className="pt-2">
            <h2 className="pb-1 text-secondary font-semibold text-ink-2">Requested · {refs.pendingReferences.length}</h2>
            <ul className="divide-y divide-line">
              {refs.pendingReferences.map((r) => {
                const who = r.profile?.fullName?.trim() || 'Hockia member'
                return (
                  <li key={r.id} className="flex items-center gap-3 py-3">
                    <EntityAvatar src={authorAvatar(r.profile)} name={who} role={r.profile?.role} size={40} />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-row font-semibold text-ink-1">{who}</span>
                      <span className="block truncate text-secondary text-ink-2">{authorLine(r.profile, r.relationshipType)}</span>
                    </span>
                    <button type="button" onClick={() => setWithdrawId(r.id)} disabled={refs.isMutating('withdraw', r.id)} className="flex h-8 shrink-0 items-center gap-1 rounded-full bg-surface-grouped px-3 text-secondary font-semibold text-ink-2 disabled:opacity-60" aria-label={`Withdraw the request to ${who}`}>
                      <Check className="h-3.5 w-3.5" strokeWidth={2.5} /> Requested
                    </button>
                  </li>
                )
              })}
            </ul>
            <p className="text-caption text-ink-3">Tap Requested to withdraw a request.</p>
          </section>
        )}
      </div>

      {own && (
        <AddReferenceModal
          isOpen={asking}
          onClose={() => setAsking(false)}
          friends={friendOptions}
          onSubmit={refs.requestReference}
          isSubmitting={refs.isMutating('request')}
          remainingSlots={refs.maxReferences - refs.acceptedCount}
          requesterRole={profileRole}
        />
      )}
      <ConfirmActionModal
        isOpen={withdrawId !== null}
        onClose={() => setWithdrawId(null)}
        onConfirm={() => {
          const id = withdrawId
          if (!id) return
          void refs.withdrawReference(id).finally(() => setWithdrawId(null))
        }}
        title="Withdraw reference request?"
        description={(() => {
          const who = refs.pendingReferences.find((r) => r.id === withdrawId)?.profile?.fullName?.trim()
          return who ? `${who} will no longer be asked to write you a reference.` : 'They will no longer be asked to write you a reference.'
        })()}
        confirmLabel="Withdraw"
        confirmTone="danger"
        confirmLoading={withdrawId ? refs.isMutating('withdraw', withdrawId) : false}
        loadingLabel="Withdrawing…"
      />
      <WriteReferenceSheet
        open={Boolean(writing)}
        onClose={() => setWritingId(null)}
        forName={writing?.requesterProfile?.fullName?.trim().split(/\s+/)[0] ?? null}
        relationshipType={writing?.relationshipType ?? ''}
        requestNote={writing?.requestNote}
        loading={writing ? mine.isMutating('respond', writing.id) : false}
        onSend={async (endorsement) => {
          if (!writing) return false
          const ok = await mine.respondToRequest({ referenceId: writing.id, accept: true, endorsement })
          if (ok) setWritingId(null)
          return ok
        }}
        onDecline={async () => {
          if (!writing) return false
          const ok = await mine.respondToRequest({ referenceId: writing.id, accept: false })
          if (ok) setWritingId(null)
          return ok
        }}
      />
    </div>
  )
}
