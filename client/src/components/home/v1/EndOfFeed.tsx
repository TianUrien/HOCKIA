import { Check } from 'lucide-react'
import { useAuthStore } from '@/lib/auth'
import { PeopleRow } from './PeopleRow'
import { RolesRail } from './RolesRail'

/**
 * End of feed (Figma H13 88:688): "You're all caught up" + People you may
 * know (friends of friends, then newest; same deck on tap) + Roles for you
 * for players / open coaches — clubs get Available now instead.
 */
export function EndOfFeed() {
  const role = useAuthStore((s) => s.profile?.role ?? null)
  const clubSide = role === 'club'
  return (
    <section className="pb-6" data-testid="home-end-of-feed">
      <div className="flex flex-col items-center gap-1 px-8 pb-6 pt-7 text-center">
        <span className="mb-2 flex h-12 w-12 items-center justify-center rounded-full bg-hockia-soft">
          <Check className="h-6 w-6 text-hockia-primary" strokeWidth={2} aria-hidden="true" />
        </span>
        <h2 className="text-body font-semibold text-ink-1">You’re all caught up</h2>
        <p className="text-secondary text-ink-2">New signings and highlights will show up here.</p>
      </div>
      <PeopleRow kind="pymk" />
      {clubSide ? <PeopleRow kind="available" /> : <RolesRail className="flex flex-col gap-2 pb-4" />}
    </section>
  )
}
