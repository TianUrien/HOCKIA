import { assertEquals } from 'https://deno.land/std@0.208.0/assert/mod.ts'
import { publicClub } from './public-api-types.ts'

const base = { club_name: 'Jo Coach', club_logo_url: 'https://cdn/jo.jpg', club_location: 'Rosario', club_league: null }

Deno.test('a club account is its own organisation, crest included', () => {
  const c = publicClub({ ...base, club_name: 'Hockey Team Bologna', club_logo_url: 'https://cdn/htb.png', publisher_role: 'club', organization_name: null, world_club_name: null, world_club_avatar_url: null })
  assertEquals(c, { name: 'Hockey Team Bologna', logo_url: 'https://cdn/htb.png', location: 'Rosario', league: null, kind: 'club' })
})

Deno.test('a coach-published role names the typed organisation, never the coach, and never shows the coach photo', () => {
  const c = publicClub({ ...base, publisher_role: 'coach', organization_name: ' Holcombe Hockey Club ', world_club_name: 'Holcombe HC', world_club_avatar_url: 'https://cdn/holcombe.png' })
  assertEquals(c.kind, 'coach')
  assertEquals(c.name, 'Holcombe Hockey Club')
  assertEquals(c.logo_url, 'https://cdn/holcombe.png')
})

Deno.test('a coach-published role falls back to the linked world club, then to Unknown Club with no crest', () => {
  const linked = publicClub({ ...base, publisher_role: 'coach', organization_name: null, world_club_name: 'Holcombe HC', world_club_avatar_url: null })
  assertEquals(linked.name, 'Holcombe HC')
  assertEquals(linked.logo_url, null)
  const none = publicClub({ ...base, publisher_role: 'coach', organization_name: '  ', world_club_name: null, world_club_avatar_url: 'https://cdn/x.png' })
  assertEquals(none.name, 'Unknown Club')
  assertEquals(none.logo_url, null)
})
