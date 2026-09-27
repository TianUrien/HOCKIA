import { useState, type ReactNode } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { ChevronRight, Link2, Loader2, MoreHorizontal, Search, Share, Users, X } from 'lucide-react'
import { DetailNavBar } from '@/components/ui/DetailNavBar'
import { BottomSheet } from '@/components/ui/BottomSheet'
import { EntityAvatar } from '@/components/ui/EntityAvatar'
import { useClubSquad, useInviteSearch, type SquadInvitation, type SquadMember } from '@/hooks/useClubSquad'
import { useBlockedUsers } from '@/hooks/useBlockedUsers'
import { useToastStore } from '@/lib/toast'
import { getImageUrl } from '@/lib/imageUrl'
import { buildClubInviteUrl } from '@/lib/clubMembership'
import { clubShortName, inviteErrorMessage, inviteStateFor, joinCountLine, squadRoleLine, type SquadPerson } from '@/lib/clubSquad'
import { STATUS_TONE_PILL, STATUS_TONE_TEXT, invitationPendingTone } from '@/lib/statusTone'
import { cn } from '@/lib/utils'

/**
 * Squad — own (Figma 04 Club D1.15 338:575; DEV NOTE 338:702). Players and
 * staff who wear the club's crest on their profile: the invite link card
 * (Share / Copy; join count once someone joined; Revoke in the … menu),
 * "Invite someone on Hockia" search, then invitations still pending (grey —
 * the club waits on them) and the members. Empty state first, because every
 * club starts there. Phone only; desktop keeps the v1 Members tab.
 */
interface SquadScreenProps {
  profile: { id: string; full_name: string | null }
  onBack: () => void
}

type Menu = { kind: 'member'; person: SquadMember } | { kind: 'pending'; person: SquadInvitation } | { kind: 'link' }

export default function SquadScreen({ profile, onBack }: SquadScreenProps) {
  const navigate = useNavigate()
  const location = useLocation()
  const addToast = useToastStore((s) => s.addToast)
  const { blockedIds } = useBlockedUsers()
  const squad = useClubSquad(profile.id)
  const [query, setQuery] = useState('')
  const search = useInviteSearch(profile.id, query, blockedIds)
  const [menu, setMenu] = useState<Menu | null>(null)
  const [linkBusy, setLinkBusy] = useState(false)
  const [invitingId, setInvitingId] = useState<string | null>(null)

  const memberIds = new Set(squad.members.map((m) => m.id))
  const pendingIds = new Set(squad.pending.map((p) => p.id))
  const joinLine = joinCountLine(squad.link?.join_count)
  const isEmpty = !squad.loading && !squad.error && squad.members.length === 0 && squad.pending.length === 0

  const openProfile = (p: SquadPerson) =>
    navigate(p.role === 'coach' ? `/coaches/id/${p.id}` : `/players/id/${p.id}`, { state: { from: location.pathname } })

  const withLink = async (then: (url: string) => Promise<void>) => {
    if (linkBusy) return
    setLinkBusy(true)
    try {
      const res = await squad.ensureLink()
      if ('error' in res) { addToast(res.error, 'error'); return }
      await then(buildClubInviteUrl(res.token))
    } finally {
      setLinkBusy(false)
    }
  }

  const copy = async (url: string) => {
    try {
      await navigator.clipboard.writeText(url)
      addToast('Invite link copied', 'success')
    } catch {
      addToast('Could not copy the link. Please try again.', 'error')
    }
  }

  const share = async (url: string) => {
    const text = `Join ${profile.full_name?.trim() || 'our club'} on Hockia`
    if (typeof navigator.share === 'function') {
      try {
        await navigator.share({ title: text, text, url })
      } catch (err) {
        // Dismissing the share sheet is not an error.
        if ((err as { name?: string })?.name !== 'AbortError') await copy(url)
      }
      return
    }
    await copy(url)
  }

  const invite = async (p: SquadPerson) => {
    setInvitingId(p.id)
    const res = await squad.invite(p.id)
    setInvitingId(null)
    if (res.success) addToast(`Invitation sent to ${p.full_name?.trim() || 'them'}`, 'success')
    else addToast(inviteErrorMessage(res), 'error')
  }

  const confirmMenu = async () => {
    const m = menu
    setMenu(null)
    if (!m) return
    if (m.kind === 'link') {
      const ok = await squad.revokeLink()
      addToast(ok ? 'Invite link revoked. It no longer works.' : 'Could not revoke the link. Please try again.', ok ? 'success' : 'error')
      return
    }
    const res = await squad.remove(m.person.id)
    const name = m.person.full_name?.trim() || 'They'
    if (res.success) addToast(m.kind === 'pending' ? 'Invitation cancelled' : `${name} removed from your squad`, 'success')
    else addToast(res.error ?? 'Something went wrong. Please try again.', 'error')
  }

  return (
    <div className="min-h-screen bg-white pb-28 lg:hidden" data-testid="squad-screen">
      <DetailNavBar parent="Profile" onBack={onBack} />
      <div className="px-5 pt-1.5">
        <h1 className="text-[28px] font-bold leading-[34px] text-ink-1">Squad</h1>
        <p className="mt-1 text-[14px] leading-5 text-ink-2">Players and staff who wear your crest on their profile.</p>
      </div>

      {/* Invite link (DEV NOTE: create_club_invite_link · join_count · revoke in the … menu) */}
      <div className="mx-5 mt-3 rounded-2xl border border-line bg-white p-4" data-testid="squad-invite-link">
        <div className="flex items-center gap-3">
          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-[9px] bg-hockia-soft text-hockia-primary">
            <Link2 className="h-[18px] w-[18px]" strokeWidth={2} aria-hidden="true" />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block text-[16px] font-semibold leading-[21px] text-ink-1">Invite link</span>
            <span className="block text-[13px] leading-[18px] text-ink-2">Anyone with it can ask to join. You approve each one.</span>
            {joinLine && <span className="mt-0.5 block text-[13px] leading-[18px] text-ink-2" data-testid="squad-join-count">{joinLine}</span>}
          </span>
          {squad.link && (
            <button type="button" onClick={() => setMenu({ kind: 'link' })} aria-label="Invite link options" className="-mr-1.5 flex h-9 w-9 shrink-0 items-center justify-center self-start rounded-full text-ink-2">
              <MoreHorizontal className="h-5 w-5" strokeWidth={2} />
            </button>
          )}
        </div>
        <div className="mt-3 flex gap-2">
          <button type="button" disabled={linkBusy} onClick={() => void withLink(share)} className="flex h-10 flex-1 items-center justify-center gap-1.5 rounded-full bg-hockia-primary text-[15px] font-semibold leading-5 text-white disabled:opacity-60">
            <Share className="h-[18px] w-[18px]" strokeWidth={2} aria-hidden="true" />
            Share link
          </button>
          <button type="button" disabled={linkBusy} onClick={() => void withLink(copy)} className="flex h-10 flex-1 items-center justify-center rounded-full bg-surface-grouped text-[15px] font-semibold leading-5 text-ink-1 disabled:opacity-60">
            Copy
          </button>
        </div>
      </div>

      {/* Search invites someone directly → invite_club_member */}
      <div className="px-5 pt-4">
        <label className="flex h-10 items-center gap-2 rounded-xl bg-surface-grouped pl-3 pr-2">
          <Search className="h-[18px] w-[18px] shrink-0 text-ink-3" strokeWidth={2} aria-hidden="true" />
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Invite someone on Hockia"
            aria-label="Invite someone on Hockia"
            className="min-w-0 flex-1 bg-transparent text-[17px] leading-[22px] text-ink-1 outline-none placeholder:text-ink-4 focus-visible:outline-none [&::-webkit-search-cancel-button]:hidden"
          />
          {query && (
            <button type="button" onClick={() => setQuery('')} aria-label="Clear search" className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-ink-3">
              <X className="h-4 w-4" strokeWidth={2} />
            </button>
          )}
        </label>
      </div>

      {search.active ? (
        <div data-testid="squad-search-results">
          {search.searching && search.rows.length === 0 && <p className="px-5 py-4 text-row text-ink-3" aria-live="polite">Searching…</p>}
          {search.error && <p className="px-5 py-4 text-row text-ink-2">{search.error}</p>}
          {!search.searching && !search.error && search.rows.length === 0 && (
            <p className="px-5 py-4 text-row text-ink-3">No players or coaches match “{query.trim()}”.</p>
          )}
          <div className="pt-2">
            {search.rows.map((p, i) => {
              const state = inviteStateFor(p.id, memberIds, pendingIds)
              return (
                <PersonRow
                  key={p.id}
                  person={p}
                  onOpen={() => openProfile(p)}
                  divider={i < search.rows.length - 1}
                  testId="squad-search-row"
                  // Rows pad 16px for the icon-sized trailing controls (…, ›);
                  // solid controls sit 4px further in so they end 20px from
                  // the edge like every other row.
                  trailing={<span className="mr-1 flex shrink-0 items-center">{state === 'member' ? (
                    <span className="shrink-0 text-secondary text-ink-2">On your squad</span>
                  ) : state === 'pending' ? (
                    <PendingPill />
                  ) : (
                    <button type="button" onClick={() => void invite(p)} disabled={invitingId === p.id} className="flex h-8 shrink-0 items-center gap-1 rounded-full bg-hockia-primary px-3.5 text-[14px] font-semibold text-white disabled:opacity-60">
                      {invitingId === p.id && <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />}
                      Invite
                    </button>
                  )}</span>}
                />
              )
            })}
          </div>
        </div>
      ) : (
        <>
          {squad.loading && <p className="px-5 py-6 text-row text-ink-3" aria-live="polite">Loading…</p>}
          {squad.error && (
            <div className="px-5 py-6">
              <p className="text-row text-ink-2">{squad.error}</p>
              <button type="button" onClick={squad.retry} className="mt-3 flex h-11 items-center rounded-full bg-surface-grouped px-4 text-row font-semibold text-ink-1">Try again</button>
            </div>
          )}

          {isEmpty && (
            <div className="flex flex-col items-center px-10 pt-14 text-center" data-testid="squad-empty">
              <span className="flex h-16 w-16 items-center justify-center rounded-full bg-surface-grouped text-ink-3">
                <Users className="h-[30px] w-[30px]" strokeWidth={1.6} aria-hidden="true" />
              </span>
              <p className="mt-2 text-[17px] font-semibold leading-[22px] text-ink-1">No one yet</p>
              <p className="mt-2 text-[14px] leading-5 text-ink-2">
                Players who pick {clubShortName(profile.full_name)} as their current club show up here on their own. You can also invite them.
              </p>
            </div>
          )}

          {squad.pending.length > 0 && (
            <section data-testid="squad-pending">
              <SectionLabel>Invited</SectionLabel>
              {squad.pending.map((p, i) => (
                <PersonRow
                  key={p.club_member_id}
                  person={p}
                  onOpen={() => openProfile(p)}
                  onMenu={() => setMenu({ kind: 'pending', person: p })}
                  divider={i < squad.pending.length - 1}
                  testId="squad-pending-row"
                  status={<PendingLine />}
                  trailing={null}
                />
              ))}
            </section>
          )}

          {squad.members.length > 0 && (
            <section data-testid="squad-members">
              <SectionLabel>Members · {squad.members.length}</SectionLabel>
              {squad.members.map((m, i) => (
                <PersonRow
                  key={m.id}
                  person={m}
                  onOpen={() => openProfile(m)}
                  // Only roster members can be removed; people who list the club as
                  // their current club manage that on their own profile.
                  onMenu={m.is_roster_member ? () => setMenu({ kind: 'member', person: m }) : undefined}
                  divider={i < squad.members.length - 1}
                  testId="squad-member-row"
                  trailing={m.is_roster_member ? null : <ChevronRight className="h-4 w-4 shrink-0 text-ink-4" strokeWidth={2} aria-hidden="true" />}
                />
              ))}
            </section>
          )}
        </>
      )}

      <BottomSheet open={menu !== null} onClose={() => setMenu(null)} ariaLabel={menu?.kind === 'link' ? 'Invite link' : menu?.person.full_name ?? 'Member'}>
        <div role="menu" className="pb-2">
          <p className="px-5 pb-2 pt-1 text-secondary text-ink-2">
            {menu?.kind === 'link'
              ? 'The link stops working. Share or Copy makes a new one.'
              : menu?.kind === 'pending'
                ? `${menu.person.full_name?.trim() || 'They'} won’t be able to accept this invitation.`
                : menu ? `${menu.person.full_name?.trim() || 'They'} will no longer show on your squad.` : ''}
          </p>
          <button type="button" role="menuitem" onClick={() => void confirmMenu()} className="flex h-[52px] w-full items-center px-5 text-left text-[16px] text-hockia-danger" data-testid="squad-menu-confirm">
            {menu?.kind === 'link' ? 'Revoke link' : menu?.kind === 'pending' ? 'Cancel invitation' : 'Remove from squad'}
          </button>
        </div>
      </BottomSheet>
    </div>
  )
}

function SectionLabel({ children }: { children: ReactNode }) {
  return <p className="px-5 pb-1 pt-[22px] text-caption font-semibold uppercase tracking-[0.04em] text-ink-2">{children}</p>
}

/** Grey, never amber: the club is waiting on the invitee (founder ruling 2026-09-26). */
function PendingLine() {
  return <span className={cn('block truncate text-secondary', STATUS_TONE_TEXT[invitationPendingTone()])} data-testid="squad-pending-status">Invitation pending</span>
}

function PendingPill() {
  return (
    <span className={cn('shrink-0 rounded-full px-2.5 py-1 text-caption font-semibold', STATUS_TONE_PILL[invitationPendingTone()])} data-testid="squad-pending-pill">
      Invitation pending
    </span>
  )
}

function PersonRow({ person, trailing, status, onOpen, onMenu, divider, testId }: {
  person: SquadPerson
  trailing: ReactNode
  /** Optional third line (e.g. "Invitation pending"). */
  status?: ReactNode
  onOpen: () => void
  onMenu?: () => void
  divider: boolean
  testId: string
}) {
  const avatar = person.avatar_url ? getImageUrl(person.avatar_url, 'avatar-md') ?? person.avatar_url : null
  return (
    <div data-testid={testId}>
      <div className="flex items-center gap-3 py-2.5 pl-5 pr-4">
        <button
          type="button"
          onClick={onOpen}
          onContextMenu={onMenu ? (e) => { e.preventDefault(); onMenu() } : undefined}
          className="flex min-w-0 flex-1 items-center gap-3 text-left"
        >
          <EntityAvatar src={avatar} name={person.full_name} role={person.role} size={44} />
          <span className="min-w-0 flex-1">
            <span className="block truncate text-row font-semibold text-ink-1">{person.full_name}</span>
            <span className="block truncate text-secondary text-ink-2">{squadRoleLine(person)}</span>
            {status}
          </span>
        </button>
        {trailing}
        {onMenu && (
          <button type="button" onClick={onMenu} aria-label={`Options for ${person.full_name ?? 'member'}`} className="-mr-1.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-ink-3">
            <MoreHorizontal className="h-[18px] w-[18px]" strokeWidth={2} />
          </button>
        )}
      </div>
      {divider && <div className="ml-[76px] h-[0.5px] bg-line" />}
    </div>
  )
}
