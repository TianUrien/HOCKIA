import { AVAILABLE_RING, NEW_RING } from '@/lib/homeEngagement'
import { FaceCircle } from './FaceCircle'
import { cn } from '@/lib/utils'
import { SectionHeader } from './primitives'
import { useHomeV1 } from './homeV1Context'
import { useHomePeople, type PeopleKind } from './useHomePeople'

const COPY: Record<PeopleKind, { title: string; label: string; to: string; a11y: string }> = {
  new: { title: 'New in the community', label: 'New in the community', to: '/community', a11y: 'new member' },
  available: { title: 'Available now', label: 'Available now', to: '/community', a11y: 'available now' },
  pymk: { title: 'People you may know', label: 'People you may know', to: '/community', a11y: 'you may know' },
}

/**
 * Faces row (Figma 60:158): 68 pt faces in a ring — brand gradient for new
 * members, green for "Available now" (H2) — first names under them. Tap a
 * face → the Community deck with that list and order. Hidden when empty.
 */
export function PeopleRow({ kind, className }: { kind: PeopleKind; className?: string }) {
  const { data, isLoading } = useHomePeople(kind)
  const { openDeck, openDeckByIds } = useHomeV1()
  const copy = COPY[kind]

  if (isLoading) return <PeopleRowSkeleton className={className} />
  const faces = data?.faces ?? []
  if (faces.length === 0) return null

  const open = (i: number) => {
    if (data?.profiles) openDeck(data.profiles, i, copy.label)
    else openDeckByIds(faces.map((f) => f.id), i, copy.label)
  }

  return (
    <section className={cn('flex flex-col gap-2 pb-4', className)} data-testid={`home-people-${kind}`}>
      <SectionHeader title={copy.title} action="See all" to={copy.to} />
      <div className="flex gap-3.5 overflow-x-auto px-4 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {faces.map((f, i) => {
          const first = (f.full_name ?? '').trim().split(/\s+/)[0] || 'Member'
          return (
            <button
              key={f.id}
              type="button"
              onClick={() => open(i)}
              aria-label={`${first}, ${copy.a11y}`}
              className="flex w-[68px] shrink-0 flex-col items-center gap-1.5 transition-transform duration-300 active:scale-[0.97]"
            >
              <span
                className="flex h-[68px] w-[68px] items-center justify-center rounded-full p-[2px]"
                style={{ backgroundImage: kind === 'available' ? AVAILABLE_RING : NEW_RING }}
              >
                <span className="flex h-full w-full items-center justify-center rounded-full bg-white p-[2px]">
                  <FaceCircle url={f.avatar_url} name={f.full_name} role={f.role} initialsClassName="text-[18px]" className="h-full w-full" />
                </span>
              </span>
              <span className="max-w-full truncate text-caption text-ink-2">{first}</span>
            </button>
          )
        })}
      </div>
    </section>
  )
}

export function PeopleRowSkeleton({ className }: { className?: string }) {
  return (
    <div className={cn('flex flex-col gap-2 pb-4', className)} aria-hidden="true">
      <div className="mx-4 h-[21px] w-[150px] animate-pulse rounded-full bg-surface-muted" />
      <div className="flex gap-3.5 overflow-hidden px-4">
        {Array.from({ length: 6 }, (_, i) => (
          <div key={i} className="flex w-[68px] shrink-0 flex-col items-center gap-1.5">
            <div className="h-[68px] w-[68px] animate-pulse rounded-full bg-surface-muted" />
            <div className="h-3 w-10 animate-pulse rounded-full bg-surface-muted" />
          </div>
        ))}
      </div>
    </div>
  )
}
