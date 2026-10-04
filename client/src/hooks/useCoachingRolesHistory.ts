import { useQuery } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { logger } from '@/lib/logger'
import { startOfYearIso, type ClosedCoachingRole } from '@/lib/coachRoles'

/**
 * What a candidate coach sees when no coaching role is open (Figma D6.2
 * 377:614, DEV NOTE 378:313–314): how many coaching roles were posted this
 * year, and the last two that closed.
 *
 * Both are plain reads under the viewer's own RLS — open roles are public,
 * closed roles are readable by signed-in members (20260928260000), drafts
 * are never visible — so hidden publishers and blocked pairs are already
 * fenced by the policies. Test-account publishers are dropped here unless
 * the viewer may see them, the same rule the open list applies.
 *
 * `postedThisYear` is null when the count could not be read (the line hides).
 */
interface Row {
  id: string
  title: string | null
  status: string | null
  location_country: string | null
  closed_at: string | null
  updated_at: string | null
  created_at: string | null
  organization_name: string | null
  club: { full_name: string | null; current_club: string | null; role: string | null; is_test_account: boolean | null } | null
  world_club: { club_name: string | null; country: { name: string | null } | null } | null
}

const SELECT = `
  id, title, status, location_country, closed_at, updated_at, created_at, organization_name,
  club:profiles!opportunities_club_id_fkey(full_name, current_club, role, is_test_account),
  world_club:world_clubs!opportunities_world_club_id_fkey(club_name, country:countries(name))
`

export interface CoachingRolesHistory {
  postedThisYear: number | null
  recentlyClosed: ClosedCoachingRole[]
  loading: boolean
}

export function useCoachingRolesHistory(opts: { enabled: boolean; includeTestAccounts: boolean; now?: Date }): CoachingRolesHistory {
  const { enabled, includeTestAccounts } = opts
  const yearStart = startOfYearIso(opts.now ?? new Date())
  const visible = (rows: Row[]) => (includeTestAccounts ? rows : rows.filter((r) => !r.club?.is_test_account))

  const { data, isLoading } = useQuery({
    queryKey: ['coaching-roles-history', yearStart, includeTestAccounts],
    enabled,
    staleTime: 5 * 60_000,
    retry: false,
    queryFn: async (): Promise<{ postedThisYear: number | null; recentlyClosed: ClosedCoachingRole[] }> => {
      const [posted, closed] = await Promise.all([
        supabase
          .from('opportunities')
          .select(SELECT)
          .eq('opportunity_type', 'coach')
          .in('status', ['open', 'closed'])
          .gte('created_at', yearStart),
        supabase
          .from('opportunities')
          .select(SELECT)
          .eq('opportunity_type', 'coach')
          .eq('status', 'closed')
          .order('closed_at', { ascending: false, nullsFirst: false })
          .limit(8),
      ])
      if (posted.error) logger.debug('[coaching-roles-history] posted count failed', posted.error.message)
      if (closed.error) logger.debug('[coaching-roles-history] closed list failed', closed.error.message)
      const postedThisYear = posted.error ? null : visible((posted.data ?? []) as unknown as Row[]).length
      const recentlyClosed = closed.error
        ? []
        : visible((closed.data ?? []) as unknown as Row[]).slice(0, 2).map((r) => ({
            id: r.id,
            title: r.title?.trim() || 'Coaching role',
            // The club the role is for: the linked world club, else what a
            // recruiting coach typed, else the publisher.
            clubName: r.world_club?.club_name ?? r.organization_name ?? (r.club?.role === 'coach' ? r.club?.current_club : null) ?? r.club?.full_name ?? null,
            country: r.location_country ?? r.world_club?.country?.name ?? null,
            closedAt: r.closed_at ?? r.updated_at ?? null,
          }))
      return { postedThisYear, recentlyClosed }
    },
  })

  return { postedThisYear: data?.postedThisYear ?? null, recentlyClosed: data?.recentlyClosed ?? [], loading: enabled && isLoading }
}
