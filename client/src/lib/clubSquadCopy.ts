/** Squad copy shared with Settings — kept apart from clubSquad.ts so Settings does not pull the coach-fit helpers. */
import { tRecruiting } from '@/i18n/ns/recruiting'

/** Settings → Squad & invites subtitle (Figma D1.22 353:1081). */
export function squadSettingsSubtitle(count: number | null | undefined): string {
  if (count === null || count === undefined) return tRecruiting('clubSquadCopy.settingsSubtitleUnknown')
  if (count === 0) return tRecruiting('clubSquadCopy.settingsSubtitleEmpty')
  return tRecruiting('clubSquadCopy.settingsSubtitle', { count })
}

/** Friendly message for an invite_club_member refusal. */
export function inviteErrorMessage(res: { error?: string; code?: string }): string {
  if (res.code === 'not_invitable') return tRecruiting('clubSquadCopy.notInvitable')
  return res.error ?? tRecruiting('clubSquadCopy.inviteFailed')
}
