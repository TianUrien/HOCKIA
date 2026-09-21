/** Public-profile route for a feed author, by role. Pure (no React). */
export type FeedAuthorRole = 'player' | 'coach' | 'club' | 'brand' | 'umpire' | string | null | undefined

export function profilePathForRole(role: FeedAuthorRole, id: string): string {
  if (role === 'club') return `/clubs/id/${id}?ref=feed`
  if (role === 'umpire') return `/umpires/id/${id}?ref=feed`
  if (role === 'coach') return `/coaches/id/${id}?ref=feed`
  return `/players/id/${id}?ref=feed`
}
