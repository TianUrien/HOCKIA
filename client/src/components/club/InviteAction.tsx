import type { InvitePill } from '@/lib/invites'

/**
 * The row action of D3.1 (Figma 393:2; DEV NOTE 394:98): Invite for a player
 * with no application or open invite to this club's open roles; otherwise
 * their status pill (Applied, Invited, Passed — grey: nothing for the club to
 * do). Passed = the player passed on every open role (other roles stay invitable).
 * Not invitable (under 18, no date of birth, not open to play) → nothing.
 * Daily limit reached → Invite disabled, with the reason.
 */
export function InviteAction({ pill, invitable, name, limitReason, onInvite, onApplied }: {
  pill: InvitePill | null
  invitable: boolean
  name: string | null
  /** Set when the daily limit is reached: Invite is disabled and says why. */
  limitReason?: string | null
  onInvite: () => void
  onApplied?: () => void
}) {
  if (pill === 'applied') {
    return onApplied
      ? <button type="button" onClick={onApplied} className="rounded-full bg-surface-grouped px-3 py-1.5 text-secondary font-semibold text-ink-2" data-testid="invite-pill-applied">Applied</button>
      : <span className="inline-flex rounded-full bg-surface-grouped px-3 py-1.5 text-secondary font-semibold text-ink-2" data-testid="invite-pill-applied">Applied</span>
  }
  if (pill === 'passed') {
    return <span className="inline-flex rounded-full bg-surface-grouped px-3 py-1.5 text-secondary font-semibold text-ink-2" aria-label="Passed on this role" data-testid="invite-pill-passed">Passed</span>
  }
  if (pill === 'invited') {
    return <span className="inline-flex rounded-full bg-surface-grouped px-3 py-1.5 text-secondary font-semibold text-ink-2" data-testid="invite-pill-invited">Invited</span>
  }
  if (!invitable) return null
  return (
    <button
      type="button"
      onClick={onInvite}
      disabled={!!limitReason}
      title={limitReason ?? undefined}
      aria-label={limitReason ? `Invite ${name ?? 'player'} — ${limitReason}` : `Invite ${name ?? 'player'} to apply`}
      className="flex h-9 items-center rounded-full bg-hockia-primary px-4 text-[16px] font-semibold text-white disabled:opacity-40"
      data-testid="invite-button"
    >
      Invite
    </button>
  )
}

/** One line above a list when the daily limit is reached (the reason the Invite buttons are disabled). */
export function InviteLimitNotice({ reason }: { reason: string }) {
  return (
    <div className="px-5 pt-3">
      <p className="rounded-card bg-surface-grouped p-3.5 text-secondary leading-[18px] text-ink-2" role="status" data-testid="invite-limit-notice">{reason}</p>
    </div>
  )
}
