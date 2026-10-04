/**
 * The organisation a role recruits for, by name. Mirrors the SQL the server
 * texts use (role_organisation, 20261004200000) — keep in sync.
 *
 * A club account is its own organisation: its name, as before. A coach who
 * recruits is never the organisation: first non-blank of the organisation
 * typed on the role → the role's world club → the coach's current world club
 * → the club typed on the coach's profile. Never the coach's name; null when
 * there is none (callers use a neutral phrase).
 */
export interface RoleOrganisationInput {
  publisherRole: string | null | undefined
  publisherName: string | null | undefined
  publisherCurrentClub?: string | null
  organizationName?: string | null
  roleWorldClubName?: string | null
  publisherWorldClubName?: string | null
}

const clean = (value: string | null | undefined): string | null => {
  const trimmed = typeof value === 'string' ? value.trim() : ''
  return trimmed || null
}

export function roleOrganisationName(input: RoleOrganisationInput): string | null {
  if (input.publisherRole === 'club') return clean(input.publisherName)
  return (
    clean(input.organizationName) ??
    clean(input.roleWorldClubName) ??
    clean(input.publisherWorldClubName) ??
    clean(input.publisherCurrentClub)
  )
}
