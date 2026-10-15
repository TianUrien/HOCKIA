/**
 * RecruitingFunnelCard — the recruiting loop as one funnel (Overview round 2,
 * 2026-10-15). Replaces the six "North Star" tiles that showed the same
 * numbers without their order.
 *
 *   Roles posted → Roles viewed → Applications → Shortlisted → Invited → Offers → Signed
 *
 * Each step shows the thing counted (roles, applications…) and, in grey, the
 * people behind it. Steps are not strict subsets of each other (a club can
 * invite without a role being viewed), so the small percentage names what it
 * is a share of. Data: admin_get_recruiting_funnel(p_days).
 */
import { useQuery } from '@tanstack/react-query'
import { getRecruitingFunnel } from '../api/adminApi'
import type { RecruitingFunnel, RecruitingFunnelStep } from '../types'
import { ChartCard } from './charts/ChartCard'
import { shareLabel } from '../lib/adminCharts'
import { HOCKIA_PRIMARY } from '@/lib/brandTokens'

interface RecruitingFunnelCardProps {
  days: number
}

const STEP_COLORS: Record<RecruitingFunnelStep['key'], string> = {
  posted: '#f59e0b',
  viewed: '#0ea5e9',
  applied: HOCKIA_PRIMARY,
  shortlisted: '#6366f1',
  invited: '#10b981',
  offered: '#0d9488',
  signed: '#e11d48',
}

/** What each step's percentage is a share of. */
function shareOf(step: RecruitingFunnelStep, steps: RecruitingFunnelStep[]): { label: string; whole: number } | null {
  const by = (k: RecruitingFunnelStep['key']) => steps.find((s) => s.key === k)
  switch (step.key) {
    case 'viewed': return { label: 'of roles posted', whole: by('posted')?.count ?? 0 }
    case 'applied': return { label: 'of viewers applied', whole: by('viewed')?.people ?? 0 }
    case 'shortlisted':
    case 'signed': return { label: 'of applications', whole: by('applied')?.count ?? 0 }
    default: return null
  }
}

function hours(h: number | null | undefined): string {
  if (h === null || h === undefined) return '—'
  if (h < 48) return `${Math.round(h)} h`
  return `${(h / 24).toFixed(1)} d`
}

export function RecruitingFunnelCard({ days }: RecruitingFunnelCardProps) {
  const q = useQuery<RecruitingFunnel>({
    queryKey: ['admin', 'recruiting-funnel', days],
    queryFn: () => getRecruitingFunnel(days),
    staleTime: 5 * 60 * 1000,
  })
  const steps = q.data?.steps ?? []
  const max = Math.max(1, ...steps.map((s) => s.count))
  const med = q.data?.medians

  return (
    <ChartCard
      title={`Recruiting loop (last ${days}d)`}
      hint="From a role being posted to a signing confirmed by both sides, all within the period. Bold is the thing counted; grey is the people behind it. Roles viewed can exceed roles posted: older roles keep being viewed."
      loading={q.isLoading}
      empty={!q.isLoading && steps.every((s) => s.count === 0)}
      emptyMessage="No recruiting activity in this period"
      height={320}
      className="lg:col-span-2"
    >
      {q.error ? (
        <p className="text-sm text-red-600" data-testid="funnel-error">{(q.error as Error).message}</p>
      ) : (
        <>
          <ol className="space-y-2.5" data-testid="recruiting-funnel">
            {steps.map((s) => {
              const share = shareOf(s, steps)
              const people = s.people > 0 ? `${s.people.toLocaleString()} ${s.people_unit}` : null
              return (
                <li key={s.key} className="grid grid-cols-[9rem_minmax(0,1fr)_7.5rem] items-center gap-3 text-sm sm:grid-cols-[10rem_minmax(0,1fr)_9rem]">
                  <span className="truncate font-medium text-gray-700">{s.label}</span>
                  <div className="h-5 overflow-hidden rounded-md bg-gray-100">
                    <div className="h-full rounded-md" style={{ width: `${Math.max(s.count > 0 ? 2 : 0, (s.count / max) * 100)}%`, backgroundColor: STEP_COLORS[s.key] }} />
                  </div>
                  <div className="text-right leading-tight">
                    <div className="tabular-nums text-gray-900"><span className="font-bold">{s.count.toLocaleString()}</span> <span className="text-xs text-gray-500">{s.unit}</span></div>
                    <div className="text-[11px] text-gray-500 tabular-nums">
                      {people ?? '—'}
                      {share && share.whole > 0 && s.count > 0 && <span> · {shareLabel(s.key === 'applied' ? s.people : s.count, share.whole)} {share.label}</span>}
                    </div>
                  </div>
                </li>
              )
            })}
          </ol>
          {med && (
            <dl className="mt-4 grid grid-cols-2 gap-x-6 gap-y-2 border-t border-gray-100 pt-3 text-xs sm:grid-cols-4" data-testid="funnel-medians">
              <div>
                <dt className="text-gray-500">Role posted → first application</dt>
                <dd className="font-semibold text-gray-900 tabular-nums">{hours(med.role_to_first_application_hours)} <span className="font-normal text-gray-400">median · {med.roles_with_application} roles</span></dd>
              </div>
              <div>
                <dt className="text-gray-500">Invite answered in</dt>
                <dd className="font-semibold text-gray-900 tabular-nums">{hours(med.invite_response_hours)} <span className="font-normal text-gray-400">median</span></dd>
              </div>
              <div>
                <dt className="text-gray-500">Offer answered in</dt>
                <dd className="font-semibold text-gray-900 tabular-nums">{hours(med.offer_response_hours)} <span className="font-normal text-gray-400">median</span></dd>
              </div>
              <div>
                <dt className="text-gray-500">Applications still unanswered</dt>
                <dd className={`font-semibold tabular-nums ${med.applications_without_reply > 0 ? 'text-amber-600' : 'text-gray-900'}`}>{med.applications_without_reply.toLocaleString()}</dd>
              </div>
            </dl>
          )}
        </>
      )}
    </ChartCard>
  )
}
