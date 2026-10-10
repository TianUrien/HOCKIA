/** Profile cover empty-state copy (founder ruling 10 Oct 2026). Gender-neutral. */
export const COVER_COPY = {
  headline: 'Add a cover photo',
  button: 'Add cover photo',
  change: 'Change cover',
  club: 'Showcase your club, team, or home ground.',
  member: 'Show yourself on the pitch or with your team.',
} as const

export function coverSupportingText(role: string | null | undefined): string {
  return role === 'club' ? COVER_COPY.club : COVER_COPY.member
}
