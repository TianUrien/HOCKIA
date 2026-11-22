import { tRecruiting } from '@/i18n/ns/recruiting'

/** The name the default list is created with (hooks/useSavedProfiles, hooks/useScouting). */
export const DEFAULT_SHORTLIST_NAME = 'Saved players'

/**
 * A list's name as shown. The default list is created by the app, not named
 * by the member, so it reads in the member's language until they rename it.
 */
export function shortlistDisplayName(list: { name: string; is_default?: boolean | null }): string {
  return list.is_default && list.name === DEFAULT_SHORTLIST_NAME ? tRecruiting('shortlistsIndex.defaultName') : list.name
}
