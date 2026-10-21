/** Which skeleton shape a Community tab loads with (audit A9). */
export type CommunitySkeletonKind = 'person' | 'club' | 'brand'

export function skeletonKindFor(roleFilter: string | null | undefined): CommunitySkeletonKind {
  if (roleFilter === 'club') return 'club'
  if (roleFilter === 'brand') return 'brand'
  return 'person'
}
