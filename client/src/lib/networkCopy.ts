import { tProfile } from '@/i18n/ns/profile'

/**
 * The app's one network-failure line (role page, sign-in, Community), so an
 * offline member reads the same words everywhere (design audit 2026-10-21,
 * A9). Never "not found" for a read that never reached HOCKIA.
 *
 * The constant is the English line, kept for callers not yet translated;
 * `networkErrorCopy()` gives it in the interface language.
 */
export const NETWORK_ERROR_COPY = 'Couldn’t reach Hockia. Check your connection and try again.'

/** The network-failure line in the interface language. */
export function networkErrorCopy(): string {
  return tProfile('networkCopy.networkError')
}

/** "Couldn’t load clubs" etc., per Community tab. */
export function couldntLoadTitle(roleFilter: string | null | undefined): string {
  switch (roleFilter) {
    case 'player': return tProfile('networkCopy.couldntLoad.players')
    case 'coach': return tProfile('networkCopy.couldntLoad.coaches')
    case 'club': return tProfile('networkCopy.couldntLoad.clubs')
    case 'brand': return tProfile('networkCopy.couldntLoad.brands')
    case 'umpire': return tProfile('networkCopy.couldntLoad.umpires')
    default: return tProfile('networkCopy.couldntLoad.members')
  }
}
