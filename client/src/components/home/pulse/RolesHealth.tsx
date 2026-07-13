import { useNavigate } from 'react-router-dom'
import { Eye, PlusCircle, ChevronRight } from 'lucide-react'
import type { RoleHealth } from '@/hooks/useRolesHealth'
import { SectionHeader } from './SectionHeader'
import { recordModuleImpression, trackModuleClick, useImpressionOnce } from '@/lib/homeInstrumentation'

/**
 * "Your open roles" (club Pulse, Home V2 Phase 2): per-role health rows —
 * 7-day views with a ▲delta when the week grew, applicant totals with the
 * "new" badge. Rows open the role's applicant list. With no open roles the
 * module becomes the Post-an-opportunity CTA card (§C: useful, never empty).
 */
const MODULE_ID = 'roles_health'
const POSITION = 4
const MAX_ROWS = 5

export function RolesHealth({ roles, loading }: { roles: RoleHealth[]; loading: boolean }) {
  const navigate = useNavigate()
  const ref = useImpressionOnce(() => recordModuleImpression(MODULE_ID, POSITION))

  if (loading) return null

  const go = (to: string) => {
    trackModuleClick(MODULE_ID, POSITION)
    navigate(to)
  }

  if (roles.length === 0) {
    return (
      <section ref={ref} className="mb-6">
        <button
          type="button"
          onClick={() => go('/dashboard/profile/opportunities')}
          className="flex w-full items-center gap-3 rounded-2xl border border-dashed border-hockia-primary/30 bg-[#f4f0fd]/50 px-4 py-3.5 text-left transition-colors hover:bg-[#f4f0fd]"
        >
          <PlusCircle className="h-5 w-5 flex-shrink-0 text-hockia-primary" />
          <div className="min-w-0 flex-1">
            <p className="text-sm font-bold text-[#14141c]">Post an opportunity</p>
            <p className="text-xs text-gray-500">Open roles get you ranked candidates and applicants here.</p>
          </div>
          <ChevronRight className="h-4 w-4 flex-shrink-0 text-gray-300" />
        </button>
      </section>
    )
  }

  return (
    <section ref={ref} className="mb-6">
      <SectionHeader
        title="Your open roles"
        chip={{ label: `${roles.length} open`, tone: 'new' }}
        action={
          <button
            type="button"
            onClick={() => go('/dashboard/profile/opportunities')}
            className="inline-flex items-center gap-0.5 text-sm font-semibold text-hockia-primary"
          >
            Manage
            <ChevronRight className="h-4 w-4" />
          </button>
        }
      />
      <div className="overflow-hidden rounded-2xl border border-gray-100 bg-white shadow-sm">
        {roles.slice(0, MAX_ROWS).map((r, i) => {
          const viewDelta = r.views_7d - r.views_prior_7d
          return (
            <button
              key={r.opportunity_id}
              type="button"
              onClick={() => go(`/dashboard/opportunities/${r.opportunity_id}/applicants`)}
              className={`flex w-full items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-gray-50 ${i > 0 ? 'border-t border-gray-50' : ''}`}
            >
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-semibold text-[#14141c]">{r.title}</p>
                <p className="mt-0.5 flex items-center gap-2 text-xs text-gray-500">
                  <span className="inline-flex items-center gap-1">
                    <Eye className="h-3 w-3" />
                    {r.views_7d > 0 ? `${r.views_7d} views this week` : 'No views yet this week'}
                  </span>
                  {viewDelta > 0 && r.views_7d > 0 && (
                    <span className="font-semibold text-emerald-600">▲ {viewDelta}</span>
                  )}
                </p>
              </div>
              <div className="flex flex-shrink-0 items-center gap-1.5">
                {r.applicant_count > 0 && (
                  <span className="rounded-full bg-[#f4f0fd] px-2 py-0.5 text-[11px] font-semibold text-hockia-primary">
                    {r.applicant_count} applied
                  </span>
                )}
                {r.new_count > 0 && (
                  <span className="rounded-full bg-red-50 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-red-600">
                    {r.new_count} new
                  </span>
                )}
                <ChevronRight className="h-4 w-4 text-gray-300" />
              </div>
            </button>
          )
        })}
      </div>
    </section>
  )
}
