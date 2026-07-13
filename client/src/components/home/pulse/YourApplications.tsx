import { useNavigate } from 'react-router-dom'
import { Clock, Eye, CheckCircle2, ChevronRight } from 'lucide-react'
import { useMyApplications } from '@/hooks/useMyApplications'
import { SectionHeader } from './SectionHeader'
import { recordModuleImpression, trackModuleClick, useImpressionOnce } from '@/lib/homeInstrumentation'

/**
 * "Your applications" (Home redesign V2, player Pulse). The anxiety-loop
 * closer the brief calls non-negotiable: shows live application status where a
 * player will actually look, instead of buried in each opportunity's detail.
 *
 * Empty-state rule (§C): collapses entirely below 1 active application — no
 * empty tab, no "0 applications".
 */
const MODULE_ID = 'your_applications'
const POSITION = 1

function statusPill(status: string, viewed: boolean): { label: string; className: string; Icon: typeof Clock } {
  if (status === 'shortlisted' || status === 'maybe') {
    return { label: 'In review', className: 'bg-[#e7f9ee] text-[#10b981]', Icon: CheckCircle2 }
  }
  if (viewed) {
    return { label: 'Viewed by club', className: 'bg-[#f4f0fd] text-hockia-primary', Icon: Eye }
  }
  return { label: 'Pending', className: 'bg-[#fef3c7] text-[#b45309]', Icon: Clock }
}

export function YourApplications({ enabled }: { enabled: boolean }) {
  const navigate = useNavigate()
  const { applications, loading } = useMyApplications(enabled)
  const ref = useImpressionOnce(() => recordModuleImpression(MODULE_ID, POSITION))

  // §C: hide until there's at least one live application (and while loading,
  // to avoid a flash).
  if (!enabled || loading || applications.length === 0) return null

  return (
    <section ref={ref} className="mb-6">
      <SectionHeader
        title="Your applications"
        chip={{ label: `${applications.length} active`, tone: 'new' }}
      />
      <div className="space-y-2">
        {applications.map((app) => {
          const pill = statusPill(app.status, app.viewed_by_club)
          // Unreadable opportunity (hidden club / deleted): an inert row, not
          // a dead link — the application itself is still the player's record.
          if (!app.available) {
            return (
              <div
                key={app.id}
                className="flex w-full items-center gap-3 rounded-2xl border border-gray-100 bg-white px-4 py-3 opacity-70"
              >
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-semibold text-gray-400">{app.opportunity_title}</p>
                </div>
                <span className={`inline-flex items-center gap-1 whitespace-nowrap rounded-full px-2.5 py-1 text-[11px] font-semibold ${pill.className}`}>
                  <pill.Icon className="h-3 w-3" />
                  {pill.label}
                </span>
              </div>
            )
          }
          return (
            <button
              key={app.id}
              type="button"
              onClick={() => {
                trackModuleClick(MODULE_ID, POSITION)
                navigate(`/opportunities/${app.opportunity_id}`)
              }}
              className="flex w-full items-center gap-3 rounded-2xl border border-gray-100 bg-white px-4 py-3 text-left shadow-sm transition-shadow hover:shadow-md"
            >
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-semibold text-[#14141c]">{app.opportunity_title}</p>
                {app.club_name && <p className="truncate text-xs text-gray-500">{app.club_name}</p>}
              </div>
              <span className={`inline-flex items-center gap-1 whitespace-nowrap rounded-full px-2.5 py-1 text-[11px] font-semibold ${pill.className}`}>
                <pill.Icon className="h-3 w-3" />
                {pill.label}
              </span>
              <ChevronRight className="h-4 w-4 flex-shrink-0 text-gray-300" />
            </button>
          )
        })}
      </div>
    </section>
  )
}
