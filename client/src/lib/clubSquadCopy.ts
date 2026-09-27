/** Squad copy shared with Settings — kept apart from clubSquad.ts so Settings does not pull the coach-fit helpers. */

/** Settings → Squad & invites subtitle (Figma D1.22 353:1081). */
export function squadSettingsSubtitle(count: number | null | undefined): string {
  if (count === null || count === undefined) return 'Players and staff · your invite link'
  if (count === 0) return 'No members yet · share your invite link'
  return `${count} ${count === 1 ? 'member' : 'members'} · your invite link`
}
