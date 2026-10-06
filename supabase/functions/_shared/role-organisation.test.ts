import { assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts'
import { roleOrganisationName } from './role-organisation.ts'

Deno.test('a club account is named by its own name, even with an organisation typed on the role', () => {
  assertEquals(roleOrganisationName({ publisherRole: 'club', publisherName: ' Barnes HC ', organizationName: 'Other' }), 'Barnes HC')
  assertEquals(roleOrganisationName({ publisherRole: 'club', publisherName: '  ' }), null)
})

Deno.test('a coach role: typed organisation first', () => {
  assertEquals(roleOrganisationName({
    publisherRole: 'coach', publisherName: 'Alex Coach', organizationName: 'Typed Org',
    roleWorldClubName: 'Role World', publisherWorldClubName: 'Coach World', publisherCurrentClub: 'Typed Club',
  }), 'Typed Org')
})

Deno.test('a coach role: role world club, then the coach world club, then the typed club', () => {
  assertEquals(roleOrganisationName({
    publisherRole: 'coach', publisherName: 'Alex Coach', organizationName: '  ',
    roleWorldClubName: 'Role World', publisherWorldClubName: 'Coach World', publisherCurrentClub: 'Typed Club',
  }), 'Role World')
  assertEquals(roleOrganisationName({
    publisherRole: 'coach', publisherName: 'Alex Coach', publisherWorldClubName: 'Coach World', publisherCurrentClub: 'Typed Club',
  }), 'Coach World')
  assertEquals(roleOrganisationName({ publisherRole: 'coach', publisherName: 'Alex Coach', publisherCurrentClub: ' Typed Club ' }), 'Typed Club')
})

Deno.test('a coach role with no organisation is never named after the coach', () => {
  assertEquals(roleOrganisationName({ publisherRole: 'coach', publisherName: 'Alex Coach' }), null)
  assertEquals(roleOrganisationName({ publisherRole: null, publisherName: 'Alex Coach' }), null)
})
