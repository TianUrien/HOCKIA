// The facts Hockia AI may use about a member and one open role: the member's
// own profile (position, passports with EU flag, availability, career,
// references, video) and the role's public fields with its club named the
// way the role page names it. Shared by the role questions in nl-search.
import { roleOrganisationName } from './role-organisation.ts'
import type { ApplyFacts, RoleFacts } from './apply-note.ts'

const EU = new Set(['AT', 'BE', 'BG', 'HR', 'CY', 'CZ', 'DK', 'EE', 'FI', 'FR', 'DE', 'GR', 'HU', 'IE', 'IT', 'LV', 'LT', 'LU', 'MT', 'NL', 'PL', 'PT', 'RO', 'SK', 'SI', 'ES', 'SE'])
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']

export interface RoleExtra { teamCategory: string | null; type: string | null }

// deno-lint-ignore no-explicit-any
export async function loadMemberRoleFacts(db: any, userId: string, oppId: string): Promise<{ member: ApplyFacts; role: RoleFacts; extra: RoleExtra } | null> {
  const [{ data: p }, { data: o }] = await Promise.all([
    db.from('profiles').select('role, full_name, position, secondary_position, nationality_country_id, nationality2_country_id, available_from, current_club, accepted_reference_count, highlight_video_url, playing_category').eq('id', userId).maybeSingle(),
    db.from('opportunities').select('id, title, position, opportunity_type, status, gender, location_city, eu_passport_required, club_id, organization_name, world_club_id').eq('id', oppId).maybeSingle(),
  ])
  if (!p || !o || o.status !== 'open') return null
  const { data: pub } = await db.from('profiles').select('full_name, role, current_club, current_world_club_id').eq('id', o.club_id).maybeSingle()
  const worldIds = [o.world_club_id, pub?.current_world_club_id].filter((x: unknown): x is string => typeof x === 'string')
  const names = new Map<string, string>()
  if (worldIds.length) {
    const { data: wc } = await db.from('world_clubs').select('id, club_name').in('id', worldIds)
    for (const c of (wc ?? []) as { id: string; club_name: string }[]) names.set(c.id, c.club_name)
  }
  const club = roleOrganisationName({
    publisherRole: pub?.role ?? null,
    publisherName: pub?.full_name ?? null,
    publisherCurrentClub: pub?.current_club ?? null,
    organizationName: o.organization_name ?? null,
    roleWorldClubName: o.world_club_id ? names.get(o.world_club_id) ?? null : null,
    publisherWorldClubName: pub?.current_world_club_id ? names.get(pub.current_world_club_id) ?? null : null,
  }) ?? 'the club'
  const ids = [p.nationality_country_id, p.nationality2_country_id].filter((x: unknown): x is number => typeof x === 'number')
  const { data: cs } = ids.length ? await db.from('countries').select('name, common_name, code').in('id', ids) : { data: [] }
  const { data: career } = await db.from('career_history').select('club_name, years, division_league, start_date').eq('user_id', userId).order('start_date', { ascending: false, nullsFirst: false }).limit(4)
  const af = typeof p.available_from === 'string' ? new Date(p.available_from) : null
  return {
    member: {
      firstName: typeof p.full_name === 'string' ? p.full_name.trim().split(/\s+/)[0] || null : null,
      role: p.role === 'coach' ? 'coach' : 'player',
      position: p.position ?? null,
      secondary: p.secondary_position ?? null,
      passports: ((cs ?? []) as { name: string; common_name: string | null; code: string }[]).map((c) => ({ name: c.common_name || c.name, eu: EU.has(c.code) })),
      availableFrom: af && !Number.isNaN(af.getTime()) && af > new Date() ? `${MONTHS[af.getUTCMonth()]} ${af.getUTCFullYear()}` : null,
      currentClub: p.current_club || null,
      career: ((career ?? []) as { club_name: string; years: string | null; division_league: string | null }[]).map((c) => ({ club: c.club_name, years: c.years || null, league: c.division_league || null })),
      references: typeof p.accepted_reference_count === 'number' ? p.accepted_reference_count : 0,
      hasVideo: Boolean(p.highlight_video_url),
    },
    role: { club, title: String(o.title ?? 'this role'), position: o.position ?? null, euRequired: o.eu_passport_required === true, city: o.location_city ?? null },
    extra: { teamCategory: o.gender ?? null, type: o.opportunity_type ?? null },
  }
}
