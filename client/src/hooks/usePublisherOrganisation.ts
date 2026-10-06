import { useQuery } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/lib/auth'
import { publisherOrganisation, type OrganisationRole, type PublisherOrganisation } from '@/lib/coachRoles'

/**
 * The organisation a role's publisher recruits for, for the sheets that name
 * it (offer, mark as signed, invite note). A club account is its own
 * organisation. A coach who recruits is never the organisation: it is the
 * organisation typed on the role, else the linked world club, else the
 * club on the coach's profile — the "Recruiting for <club>" source.
 */
export function usePublisherOrganisation(role?: OrganisationRole | null): PublisherOrganisation {
  const profile = useAuthStore((s) => s.profile)
  const isCoach = profile?.role === 'coach'
  const worldClubId = isCoach ? role?.world_club_id ?? profile?.current_world_club_id ?? null : null
  const { data: worldClub = null } = useQuery({
    queryKey: ['world-club-crest', worldClubId],
    enabled: !!worldClubId,
    staleTime: 10 * 60_000,
    retry: false,
    queryFn: async (): Promise<{ club_name: string | null; avatar_url: string | null } | null> => {
      const { data, error } = await supabase.from('world_clubs').select('club_name, avatar_url').eq('id', worldClubId as string).maybeSingle()
      if (error) return null
      return (data as { club_name: string | null; avatar_url: string | null } | null) ?? null
    },
  })
  return publisherOrganisation(profile, role, worldClub)
}
