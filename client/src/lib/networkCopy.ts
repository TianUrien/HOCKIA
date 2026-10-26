/**
 * The app's one network-failure line (role page, sign-in, Community), so an
 * offline member reads the same words everywhere (design audit 2026-10-21,
 * A9). Never "not found" for a read that never reached HOCKIA.
 */
export const NETWORK_ERROR_COPY = 'Couldn’t reach Hockia. Check your connection and try again.'

/** "Couldn’t load clubs" etc., per Community tab. */
export function couldntLoadTitle(roleFilter: string | null | undefined): string {
  const noun = roleFilter === 'player' ? 'players'
    : roleFilter === 'coach' ? 'coaches'
      : roleFilter === 'club' ? 'clubs'
        : roleFilter === 'brand' ? 'brands'
          : roleFilter === 'umpire' ? 'umpires'
            : 'members'
  return `Couldn’t load ${noun}`
}
