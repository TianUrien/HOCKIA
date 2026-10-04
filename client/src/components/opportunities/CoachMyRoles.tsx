import { useQuery } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { RecruiterRoles } from '@/components/club/ClubOpportunitiesScreen'
import type { ClubRole, ClubRolesData } from '@/hooks/useClubRoles'
import { recruitingForLine } from '@/lib/coachRoles'

/**
 * Opportunities · My roles for a coach who recruits (Figma D6.4 377:1814,
 * DEV NOTE 378:321–323). "Recruiting for <club>" = the coach's linked world
 * club, else the club they typed. Everything under it — the amber waiting
 * notice (only while a reply is owed), the role card with its pipeline and
 * "Review N applicants", Find players and Shortlist — is the Club v2 panel
 * with owner = the coach. Its own chunk: candidates and players never load it.
 */
export interface CoachMyRolesProps {
  profile: { id: string; current_world_club_id?: string | null; current_club?: string | null }
  data: ClubRolesData
  onPostRole: () => void
  onEditRole: (role: ClubRole) => void
}

export default function CoachMyRoles({ profile, data, onPostRole, onEditRole }: CoachMyRolesProps) {
  const worldClubId = profile.current_world_club_id ?? null
  const { data: worldClubName } = useQuery({
    queryKey: ['world-club-name', worldClubId],
    enabled: !!worldClubId,
    staleTime: 10 * 60_000,
    retry: false,
    queryFn: async (): Promise<string | null> => {
      const { data: row, error } = await supabase.from('world_clubs').select('club_name').eq('id', worldClubId as string).maybeSingle()
      if (error) return null
      return (row as { club_name: string | null } | null)?.club_name ?? null
    },
  })
  const line = recruitingForLine(worldClubName, profile.current_club)

  return (
    <div data-testid="coach-my-roles">
      {line && <p className="px-6 pb-3.5 text-secondary text-ink-2" data-testid="coach-recruiting-for">{line}</p>}
      <RecruiterRoles
        data={data}
        onPostRole={onPostRole}
        onEditRole={onEditRole}
        from="/opportunities?view=mine"
        statusSegment="when-closed"
      />
    </div>
  )
}
