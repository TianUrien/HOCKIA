import { useNavigate } from 'react-router-dom'
import { useAuthStore } from '@/lib/auth'
import { useOpportunitiesForYou } from '@/hooks/useOpportunitiesForYou'
import { roleTitle } from '@/lib/homeEngagement'
import { HOME_V1_MODULES, recordModuleImpression, trackModuleClick, useImpressionOnce } from '@/lib/homeInstrumentation'
import { navState } from '@/lib/navSource'
import { SectionHeader } from './primitives'
import { RoleCoverCard } from './RoleCoverCard'

/**
 * "Roles for you" (Figma 60:295): players and open coaches only — clubs never
 * see it (spec 65:329). 220×150 cover cards, horizontal scroll; the same
 * list Pulse ranks (matched first, else newest). Hidden when empty. A card
 * opens the v2 role page (/opportunities/:id); Back returns to Home at the
 * same scroll (HomePage useScrollRestore) — one role design app-wide (17 Oct 2026).
 */
export function RolesRail({ className, module = HOME_V1_MODULES.rolesRail }: { className?: string; /** Which slot this rail fills (in-feed or end of feed) for impressions and clicks. */ module?: { id: string; position: number } }) {
  const role = useAuthStore((s) => s.profile?.role ?? null)
  const talent = role === 'player' || role === 'coach'
  const { items, loading } = useOpportunitiesForYou(talent, role === 'coach' ? 'coach' : 'player')
  const navigate = useNavigate()
  const impressionRef = useImpressionOnce(() => recordModuleImpression(module.id, module.position))

  if (!talent || loading || items.length === 0) return null

  return (
    <section ref={impressionRef} className={className ?? 'flex flex-col gap-2 py-4'} data-testid="home-roles-rail">
      <SectionHeader title="Opportunities for you" action="See all" to="/opportunities" onLinkClick={() => trackModuleClick(module.id, module.position, '/opportunities')} />
      <div className="flex gap-3 overflow-x-auto px-4 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {items.slice(0, 10).map((o) => (
          <RoleCoverCard
            key={o.id}
            size="rail"
            clubId={o.club_id}
            clubName={o.club_name ?? 'Club'}
            crestUrl={o.club_avatar_url}
            title={roleTitle(o.position, o.gender, o.title)}
            subtitle={o.club_name ?? ''}
            roleId={o.id}
            onOpen={() => {
              trackModuleClick(module.id, module.position, `/opportunities/${o.id}`)
              navigate(`/opportunities/${o.id}`, navState('home_role_card'))
            }}
          />
        ))}
      </div>
    </section>
  )
}
