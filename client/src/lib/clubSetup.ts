/**
 * Club set-up — the club part of onboarding (Figma 04 Club D1.24, DEV NOTE
 * 368:1088). Continue is enabled when name, country and city are set and the
 * 18+ box is ticked; year founded is optional.
 */
export type ClubSetupDraft = {
  name: string
  countryId: number | null
  /** base_location — the picked (or typed) city line. */
  location: string
  /** base_city, set when a city is picked from the list. */
  city: string
  baseCountryId: number | null
  locationSelected: boolean
  yearFounded: string
  attested: boolean
}

export function clubSetupReady(d: ClubSetupDraft): boolean {
  return Boolean(d.name.trim() && d.countryId && d.location.trim() && d.attested)
}

/**
 * Who gets the phone club set-up instead of the classic form: a club on a
 * phone whose onboarding is not finished. Everyone else (players, coaches,
 * umpires, brands, desktop, already-onboarded clubs) keeps today's flow.
 */
export function showsClubSetup(role: string | null | undefined, isPhone: boolean, onboardingCompleted: boolean | null | undefined): boolean {
  return role === 'club' && isPhone && !onboardingCompleted
}
