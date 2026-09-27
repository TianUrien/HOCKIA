/** Squad copy shared with Settings — kept apart from clubSquad.ts so Settings does not pull the coach-fit helpers. */

/** Settings → Squad & invites subtitle (Figma D1.22 353:1081). */
export function squadSettingsSubtitle(count: number | null | undefined): string {
  if (count === null || count === undefined) return 'Players and staff · your invite link'
  if (count === 0) return 'No members yet · share your invite link'
  return `${count} ${count === 1 ? 'member' : 'members'} · your invite link`
}

/** Friendly message for an invite_club_member refusal. */
export const NOT_INVITABLE_MESSAGE = 'This person can’t be invited yet.'
export function inviteErrorMessage(res: { error?: string; code?: string }): string {
  if (res.code === 'not_invitable') return NOT_INVITABLE_MESSAGE
  return res.error ?? 'Could not send the invitation.'
}
