import { useNavigate } from 'react-router-dom'
import { Send, Eye, CheckCircle2, ChevronRight, type LucideIcon } from 'lucide-react'
import { useMyApplications } from '@/hooks/useMyApplications'
import { SectionHeader } from './SectionHeader'
import { recordModuleImpression, trackModuleClick, useImpressionOnce } from '@/lib/homeInstrumentation'
import { applicationStatusPill } from '@/lib/opportunityCopy'

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

// Words = My applications' (founder ruling 2026-09-26: one set of status
// labels everywhere, via applicationStatusPill). Colours stay under the amber
// rule: amber only when the VIEWER must act soon — a player waiting on a club
// can't act, so every waiting state is neutral grey, with no Clock. The eye
// icon still tells the player the club opened it.
function statusPill(status: string, appliedAt: string | null, roleOpen: boolean, viewed: boolean): { label: string; className: string; Icon: LucideIcon } {
  const { label, tone } = applicationStatusPill(status, appliedAt, roleOpen)
  if (tone === 'positive') return { label, className: 'bg-[#e7f9ee] text-[#047857]', Icon: CheckCircle2 }
  return { label, className: 'bg-gray-100 text-gray-600', Icon: viewed ? Eye : Send }
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
          const pill = statusPill(app.status, app.applied_at, app.role_open ?? true, app.viewed_by_club)
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
              <ChevronRight className="h-4 w-4 flex-shrink-0 text-gray-500" />
            </button>
          )
        })}
      </div>
    </section>
  )
}
