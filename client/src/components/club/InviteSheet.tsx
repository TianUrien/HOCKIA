import { useEffect, useMemo, useState } from 'react'
import { Check, Pencil } from 'lucide-react'
import { BottomSheet } from '@/components/ui/BottomSheet'
import { EntityAvatar } from '@/components/ui/EntityAvatar'
import { useAuthStore } from '@/lib/auth'
import { getImageUrl } from '@/lib/imageUrl'
import { personRoleLine } from '@/lib/clubRecruiting'
import { useClubInviteStatuses, useInviteAllowance, useInviteRoles, useSendInvite } from '@/hooks/useInvites'
import {
  INVITE_NOTE_MAX,
  draftInviteNote,
  firstNameOf,
  inviteLimitReason,
  inviteRoleLabel,
  inviteSheetFooter,
  roleOfferLine,
} from '@/lib/invites'

/**
 * D3.2 · Invite to apply (Figma 393:178; DEV NOTE 394:102). Pick the role
 * (the active one preselected), keep or edit the note drafted from the role
 * fields and the club name, and send. The footer says what the player sees
 * and what happens if they apply. send_invite enforces every rule (18+ with
 * a known date of birth, open to play, one open invite per player per club,
 * 20 a day / 5 in the first week) — its reason shows here when it refuses.
 */
export interface InviteSheetPlayer {
  id: string
  full_name: string | null
  avatar_url: string | null
  role: string | null
  position: string | null
  secondary_position: string | null
}

interface Props {
  open: boolean
  player: InviteSheetPlayer | null
  /** The active "Ranked for" role, preselected when it is one of the open roles. */
  activeRoleId: string | null
  onClose: () => void
  onSent?: () => void
}

export default function InviteSheet({ open, player, activeRoleId, onClose, onSent }: Props) {
  const clubName = useAuthStore((s) => s.profile?.full_name ?? null)
  const { roles, loading } = useInviteRoles('player', open)
  const allowance = useInviteAllowance()
  const { send, sending } = useSendInvite()
  const [roleId, setRoleId] = useState<string | null>(null)
  const [note, setNote] = useState('')
  const [edited, setEdited] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // One role card (Figma D3.2); with several open roles, tapping it lists the others.
  const [picking, setPicking] = useState(false)
  // The club chose a role itself (vs the automatic preselection).
  const [userPicked, setUserPicked] = useState(false)
  const firstName = firstNameOf(player?.full_name)
  // Roles this player passed on can't be offered again (founder ruling 2026-10-01).
  const playerIds = useMemo(() => (open && player ? [player.id] : []), [open, player])
  const statuses = useClubInviteStatuses(playerIds)
  const passed = player ? statuses.declinedFor(player.id) : []
  const passedKey = passed.join(',')
  const invitable = useMemo(() => roles.filter((r) => !passedKey.split(',').includes(r.id)), [roles, passedKey])
  // The active "Ranked for" role is one the player passed on: say so and let
  // the club choose another role — never switch to a different role silently.
  const passedActiveRole = useMemo(
    () => (activeRoleId && passedKey.split(',').includes(activeRoleId) ? roles.find((r) => r.id === activeRoleId) ?? null : null),
    [roles, activeRoleId, passedKey],
  )
  const choosing = !!passedActiveRole && !userPicked

  // Fresh state every time the sheet opens for a player.
  useEffect(() => {
    if (!open) { setRoleId(null); setNote(''); setEdited(false); setError(null); setPicking(false); setUserPicked(false) }
  }, [open, player?.id])

  // Preselect the active role, else the newest open role — never one the player
  // passed on. When the active role is one they passed on, nothing is preselected:
  // the club picks a role (Send stays disabled until it does).
  useEffect(() => {
    if (!open) return
    if (choosing) { if (roleId !== null) setRoleId(null); return }
    if (invitable.length === 0) return
    if (roleId && invitable.some((r) => r.id === roleId)) return
    setRoleId(invitable.find((r) => r.id === activeRoleId)?.id ?? invitable[0].id)
  }, [open, invitable, roleId, activeRoleId, choosing])

  const role = useMemo(() => invitable.find((r) => r.id === roleId) ?? null, [invitable, roleId])
  const draft = useMemo(() => (role ? draftInviteNote({ firstName, clubName, role }) : ''), [role, firstName, clubName])
  // The draft follows the role until the club edits it.
  useEffect(() => { if (!edited) setNote(draft) }, [draft, edited])
  const showsDraft = !edited || note === draft

  const avatar = player?.avatar_url ? getImageUrl(player.avatar_url, 'avatar-md') ?? player.avatar_url : null
  const blockedByLimit = allowance.reached
  // Wait for the passed-on roles before Send, so a passed role is never sent by a fast tap.
  const canSend = !!player && !!role && !statuses.loading && !sending && !blockedByLimit && note.length <= INVITE_NOTE_MAX

  const submit = async () => {
    if (!player || !role || !canSend) return
    setError(null)
    const reason = await send({ playerId: player.id, playerName: player.full_name, opportunityId: role.id, note })
    if (reason) { setError(reason); return }
    onSent?.()
    onClose()
  }

  return (
    <BottomSheet open={open} onClose={onClose} ariaLabel={`Invite ${firstName} to apply`}>
      <div className="flex flex-col px-5 pb-6 pt-1" data-testid="invite-sheet">
        <div className="flex items-center gap-3 pb-4">
          <EntityAvatar src={avatar} name={player?.full_name ?? null} role="player" size={48} />
          <div className="min-w-0">
            <h2 className="truncate text-[20px] font-bold leading-6 tracking-[-0.2px] text-ink-1">Invite {firstName} to apply</h2>
            {player && <p className="truncate text-[14px] leading-[19px] text-ink-2">{personRoleLine({ role: player.role, position: player.position, secondaryPosition: player.secondary_position })}</p>}
          </div>
        </div>

        <p className="pb-2 text-caption font-semibold uppercase tracking-[0.4px] text-ink-2">Role</p>
        {choosing && passedActiveRole && (
          <p className="pb-2 text-secondary leading-[18px] text-ink-2" role="status" data-testid="invite-passed-active">
            {firstNameOf(player?.full_name, 'The player')} passed on {inviteRoleLabel(passedActiveRole)} — choose another role.
          </p>
        )}
        {loading ? (
          <p className="rounded-card bg-surface-grouped p-3.5 text-row text-ink-3">Loading roles…</p>
        ) : roles.length === 0 ? (
          <p className="rounded-card bg-surface-grouped p-3.5 text-row text-ink-2" data-testid="invite-no-roles">Post a role first — an invite is always to one of your open roles.</p>
        ) : (
          <div className="flex flex-col gap-2" role="radiogroup" aria-label="Role">
            {(picking || choosing ? roles : roles.filter((r) => r.id === roleId || (!role && passed.includes(r.id)))).map((r) => {
              const on = r.id === roleId
              const wasPassed = passed.includes(r.id)
              const offer = wasPassed ? 'Passed on this role' : roleOfferLine(r)
              return (
                <button
                  key={r.id}
                  type="button"
                  role="radio"
                  aria-checked={on}
                  aria-disabled={wasPassed || undefined}
                  onClick={() => {
                    if (wasPassed) return
                    setError(null)
                    if (picking || choosing) { setRoleId(r.id); setPicking(false); setUserPicked(true) } else if (roles.length > 1) setPicking(true)
                  }}
                  className="flex w-full items-center gap-3 rounded-card bg-surface-grouped px-3.5 py-3 text-left"
                  data-testid="invite-role"
                  data-passed={wasPassed || undefined}
                >
                  <span className="min-w-0 flex-1">
                    <span className={`block truncate text-[16px] font-semibold leading-[21px] ${wasPassed ? 'text-ink-3' : 'text-ink-1'}`}>{inviteRoleLabel(r)}</span>
                    {offer && <span className={`block truncate text-[14px] leading-[19px] ${wasPassed ? 'text-ink-3' : 'text-ink-2'}`}>{offer}</span>}
                  </span>
                  {on && <Check className="h-5 w-5 shrink-0 text-hockia-primary" strokeWidth={2.2} aria-hidden="true" />}
                </button>
              )
            })}
            {!picking && !choosing && invitable.length > 1 && (
              <button type="button" onClick={() => setPicking(true)} className="-my-2 flex min-h-11 items-center self-start text-secondary font-semibold text-hockia-primary" data-testid="invite-change-role">
                Change role
              </button>
            )}
          </div>
        )}

        {role && (
          <>
            <p className="pb-2 pt-4 text-caption font-semibold uppercase tracking-[0.4px] text-ink-2">Note</p>
            <div className="flex flex-col gap-1.5 rounded-card bg-surface-grouped p-3.5 focus-within:ring-2 focus-within:ring-focus-ring">
              {showsDraft ? (
                <span className="flex items-center gap-1.5 text-caption font-semibold text-ink-2" data-testid="invite-note-draft">
                  <Pencil className="h-3.5 w-3.5" strokeWidth={2} aria-hidden="true" /> Drafted from the role · tap to edit
                </span>
              ) : (
                <span className="text-caption font-semibold text-ink-2">Your note</span>
              )}
              <textarea
                value={note}
                onChange={(e) => { setNote(e.target.value.slice(0, INVITE_NOTE_MAX)); setEdited(true) }}
                rows={Math.max(4, Math.ceil(note.length / 42))}
                maxLength={INVITE_NOTE_MAX}
                aria-label={`Note to ${firstName}`}
                placeholder={`Write a short note to ${firstName}`}
                className="w-full resize-none bg-transparent text-[16px] leading-[22px] text-ink-1 outline-none placeholder:text-ink-3"
              />
            </div>
          </>
        )}

        <p className="pt-3 text-caption leading-4 text-ink-3" data-testid="invite-footer">{inviteSheetFooter(firstName)}</p>
        {(error || blockedByLimit) && (
          <p role="alert" className="pt-2 text-secondary text-hockia-danger" data-testid="invite-error">{error ?? inviteLimitReason(allowance.limit)}</p>
        )}
        <button
          type="button"
          disabled={!canSend}
          onClick={() => void submit()}
          className="mt-3 flex h-12 w-full items-center justify-center rounded-full bg-hockia-primary text-body font-semibold text-white disabled:opacity-40"
          data-testid="invite-send"
        >
          {sending ? 'Sending…' : 'Send invite'}
        </button>
      </div>
    </BottomSheet>
  )
}
