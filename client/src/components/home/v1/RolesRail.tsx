import { lazy, Suspense, useState } from 'react'
import { useAuthStore } from '@/lib/auth'
import { useOpportunitiesForYou } from '@/hooks/useOpportunitiesForYou'
import { roleTitle } from '@/lib/homeEngagement'
import { SectionHeader } from './primitives'
import { RoleCoverCard } from './RoleCoverCard'

const OpportunityDetailOverlay = lazy(() => import('@/components/OpportunityDetailOverlay'))

/**
 * "Roles for you" (Figma 60:295): players and open coaches only — clubs never
 * see it (spec 65:329). 220×150 cover cards, horizontal scroll; the same
 * list Pulse ranks (matched first, else newest). Hidden when empty.
 */
export function RolesRail({ className }: { className?: string }) {
  const role = useAuthStore((s) => s.profile?.role ?? null)
  const talent = role === 'player' || role === 'coach'
  const { items, loading } = useOpportunitiesForYou(talent, role === 'coach' ? 'coach' : 'player')
  const [open, setOpen] = useState<{ id: string; logo: string | null } | null>(null)

  if (!talent || loading || items.length === 0) return null

  return (
    <section className={className ?? 'flex flex-col gap-2 py-4'} data-testid="home-roles-rail">
      <SectionHeader title="Roles for you" action="See all" to="/opportunities" />
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
            onOpen={() => setOpen({ id: o.id, logo: o.club_avatar_url })}
          />
        ))}
      </div>
      {open && (
        <Suspense fallback={null}>
          <OpportunityDetailOverlay opportunityId={open.id} clubLogo={open.logo} onClose={() => setOpen(null)} />
        </Suspense>
      )}
    </section>
  )
}
