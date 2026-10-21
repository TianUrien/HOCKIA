/**
 * Layout-matched loading states (quick wins 2026-10-21). Design rule: full
 * screens load with skeletons shaped like the content, never a spinner
 * (hockia-design-rules › components-and-patterns › Loading). Each skeleton
 * mirrors the real screen's outer boxes (hero heights, card radii, row
 * padding) so nothing jumps when the data lands. Pulses stop under
 * prefers-reduced-motion (Skeleton's motion-reduce class).
 *
 * Built from the shared `Skeleton` block; no data, no imports beyond it, so it
 * is cheap to pull into any route chunk.
 */
import Skeleton from './Skeleton'

const BAR = 'bg-white/25'

/** Role page (OpportunityDetailMobile: 440 px cover hero, identity card, key facts, sticky action bar;
 *  desktop: OpportunityDetailDesktop's two columns). */
export function RoleDetailSkeleton() {
  return (
    <div className="min-h-screen bg-white lg:bg-gray-50" data-testid="role-detail-skeleton" aria-busy="true" aria-label="Loading role">
      <div className="lg:mx-auto lg:grid lg:max-w-[1200px] lg:grid-cols-[420px_minmax(0,1fr)] lg:gap-10 lg:px-6 lg:pt-24">
        <div className="relative h-[440px] w-full animate-pulse bg-ink-3/40 motion-reduce:animate-none lg:rounded-[24px]">
          <div className="absolute inset-x-4 bottom-5 flex flex-col gap-2.5">
            <div className={`h-3 w-28 rounded ${BAR}`} />
            <div className={`h-7 w-4/5 rounded ${BAR}`} />
            <div className={`h-7 w-3/5 rounded ${BAR}`} />
            <div className="flex gap-1.5">
              <div className={`h-7 w-20 rounded-full ${BAR}`} />
              <div className={`h-7 w-24 rounded-full ${BAR}`} />
            </div>
          </div>
        </div>
        <div className="px-4 pt-4 lg:px-0 lg:pt-0">
          <div className="flex items-center gap-3 rounded-[20px] bg-surface-subtle px-3.5 py-3">
            <Skeleton variant="circular" width={44} height={44} />
            <div className="flex-1 space-y-1.5">
              <Skeleton width={70} height={10} />
              <Skeleton width="60%" height={16} />
              <Skeleton width="40%" height={13} />
            </div>
          </div>
          <Skeleton width="45%" height={12} className="mt-3" />
          <div className="grid grid-cols-2 gap-2.5 pt-5">
            {[0, 1, 2, 3].map((i) => (
              <div key={i} className="flex flex-col gap-1.5 rounded-[12px] bg-surface-subtle px-3.5 py-3">
                <Skeleton width={48} height={10} />
                <Skeleton width="70%" height={16} />
              </div>
            ))}
          </div>
          <div className="space-y-2 pt-7">
            <Skeleton width="50%" height={20} />
            <Skeleton width="100%" height={14} />
            <Skeleton width="92%" height={14} />
            <Skeleton width="80%" height={14} />
          </div>
        </div>
      </div>
      <div className="fixed inset-x-0 bottom-0 border-t-[0.5px] border-line bg-white px-4 pb-[max(env(safe-area-inset-bottom),0.75rem)] pt-3 lg:hidden">
        <Skeleton height={52} className="w-full rounded-full" />
      </div>
    </div>
  )
}

/** Own and public profiles (ProfileHero 540 px person hero, ClubHero 480 px with crest tile; ProfileLayout columns). */
export function ProfileSkeleton({ variant = 'person' }: { variant?: 'person' | 'club' }) {
  const club = variant === 'club'
  return (
    <div className="min-h-screen bg-white" data-testid="profile-skeleton" aria-busy="true" aria-label="Loading profile">
      <div className="lg:mx-auto lg:grid lg:max-w-[1200px] lg:grid-cols-[360px_minmax(0,1fr)] lg:items-start lg:gap-12 lg:px-6 lg:pt-24 xl:grid-cols-[480px_680px] xl:justify-center">
        <div className={`relative w-full animate-pulse bg-ink-3/40 motion-reduce:animate-none lg:overflow-hidden lg:rounded-[24px] ${club ? 'h-[480px]' : 'h-[540px]'}`}>
          <div className="absolute inset-x-4 bottom-6 flex flex-col gap-2">
            {club && <div className="mb-1 h-[72px] w-[72px] rounded-[20px] bg-white/40" />}
            <div className={`h-8 w-3/5 rounded ${BAR}`} />
            <div className={`h-4 w-2/5 rounded ${BAR}`} />
            <div className="flex gap-1.5 pt-0.5">
              <div className={`h-6 w-16 rounded-full ${BAR}`} />
              <div className={`h-6 w-16 rounded-full ${BAR}`} />
            </div>
          </div>
        </div>
        <div className="flex flex-col gap-7 px-5 pb-6 pt-5 lg:px-0 lg:pt-0">
          <div className="flex gap-2.5 lg:hidden">
            <Skeleton height={52} className="flex-1 rounded-full" />
            <Skeleton height={52} className="flex-1 rounded-full" />
          </div>
          {[0, 1].map((i) => (
            <div key={i} className="flex flex-col gap-3">
              <Skeleton width="40%" height={20} />
              <div className="grid grid-cols-2 gap-2.5">
                <Skeleton height={64} className="rounded-[12px]" />
                <Skeleton height={64} className="rounded-[12px]" />
              </div>
              <Skeleton width="90%" height={14} />
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

/** Inbox Activity rows (ActivityRow: 40 px avatar, text, detail, age; hairline between rows). */
export function ActivityListSkeleton({ rows = 6 }: { rows?: number }) {
  return (
    <ul aria-busy="true" aria-label="Loading activity" data-testid="activity-skeleton">
      {Array.from({ length: rows }, (_, i) => (
        <li key={i} className="flex items-start gap-3 pl-4">
          <span className="shrink-0 py-3.5"><Skeleton variant="circular" width={40} height={40} /></span>
          <span className={`flex min-w-0 flex-1 flex-col gap-1.5 py-3.5 pr-4 ${i < rows - 1 ? 'border-b border-line' : ''}`}>
            <Skeleton width={`${70 - (i % 3) * 12}%`} height={16} />
            <Skeleton width="45%" height={13} />
            <Skeleton width={56} height={12} />
          </span>
        </li>
      ))}
    </ul>
  )
}

/** A message thread while its conversation loads: header row and fixed-width bubbles (no random widths, so no jitter). */
export function ThreadSkeleton({ onBack, backLabel = 'Back to conversations' }: { onBack?: () => void; backLabel?: string }) {
  const bubbles: Array<{ own: boolean; w: number; h: number }> = [
    { own: false, w: 220, h: 44 }, { own: true, w: 180, h: 44 }, { own: false, w: 260, h: 64 },
    { own: true, w: 200, h: 44 }, { own: false, w: 150, h: 44 },
  ]
  return (
    <div className="flex h-full flex-col bg-white" data-testid="thread-skeleton" aria-busy="true" aria-label="Loading conversation">
      <div className="flex h-14 items-center gap-3 border-b border-line px-4">
        {onBack && (
          <button type="button" onClick={onBack} className="-ml-2 flex h-11 items-center px-2 text-secondary font-semibold text-brand-primary">
            {backLabel}
          </button>
        )}
        <Skeleton variant="circular" width={36} height={36} />
        <Skeleton width={140} height={16} />
      </div>
      <div className="flex flex-1 flex-col justify-end gap-3 overflow-hidden p-4">
        {bubbles.map((b, i) => (
          <div key={i} className={`flex ${b.own ? 'justify-end' : 'justify-start'}`}>
            <Skeleton width={b.w} height={b.h} className="max-w-[75%] rounded-2xl" />
          </div>
        ))}
      </div>
      <div className="border-t border-line p-3">
        <Skeleton height={44} className="w-full rounded-full" />
      </div>
    </div>
  )
}

/** Club role cards (ClubOpportunitiesScreen RoleCard: 88 px cover band, title, meta, stats row). */
export function ClubRoleCardSkeleton() {
  return (
    <div className="flex flex-col overflow-hidden rounded-[24px] border border-line bg-white" data-testid="club-role-card-skeleton" aria-hidden="true">
      <div className="h-[88px] animate-pulse bg-ink-3/30 motion-reduce:animate-none" />
      <div className="flex flex-col gap-2 px-4 pb-4 pt-3.5">
        <Skeleton width="60%" height={18} />
        <Skeleton width="40%" height={14} />
        <div className="flex gap-2 pt-3">
          {[0, 1, 2].map((i) => <Skeleton key={i} height={52} className="flex-1 rounded-[12px]" />)}
        </div>
      </div>
    </div>
  )
}

/** Applicant rows (ApplicantsScreen / ApplicantsDesktop: 16 px radius card, 48 px avatar, name, role line, days left). */
export function ApplicantRowsSkeleton({ rows = 4 }: { rows?: number }) {
  return (
    <div className="flex flex-col gap-2.5" aria-busy="true" aria-label="Loading applicants" data-testid="applicants-skeleton">
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="flex items-center gap-3 rounded-[16px] bg-surface-subtle p-3">
          <Skeleton variant="circular" width={48} height={48} />
          <div className="flex-1 space-y-1.5">
            <Skeleton width={`${55 - (i % 2) * 10}%`} height={16} />
            <Skeleton width="40%" height={13} />
          </div>
          <Skeleton width={48} height={13} />
        </div>
      ))}
    </div>
  )
}
