import { Briefcase, ChevronRight, Medal, Trophy, type LucideIcon } from 'lucide-react'
import { SwitchCardRow } from '@/components/ui/SwitchCardRow'
import { STATUS_TONE_PILL } from '@/lib/statusTone'
import { closedRoleDate, closedRoleMeta, closedRoleOwnStatus, coachingRolesPostedLine, type ClosedCoachingRole } from '@/lib/coachRoles'

/**
 * Opportunities · Roles for a candidate coach when no coaching role is open
 * (Figma D6.2 377:614, DEV NOTE 378:313–314). The honest state: nothing is
 * open, how many were posted this year, the alert switch, two things that
 * make the coach stronger for the next role (each only while it is missing),
 * and the last two roles that closed. Player rules: no match, no counts of
 * other applicants, no Save; the coach's own status on a closed role is grey.
 */
export interface CoachRolesEmptyStateProps {
  /** Coaching roles posted this year; null when it could not be read. */
  postedThisYear: number | null
  recentlyClosed: ClosedCoachingRole[]
  /** The coach's own application status per role id. */
  ownStatuses: Record<string, string>
  careerEntryCount: number
  acceptedReferenceCount: number
  alertsOn: boolean
  alertsBusy?: boolean
  onToggleAlerts: () => void
  onAddCareer: () => void
  onAskReference: () => void
  onOpenRole: (id: string) => void
  now?: Date
}

function SectionTitle({ children }: { children: string }) {
  return <h2 className="px-1 pb-1 pt-5 text-[20px] font-semibold leading-6 tracking-[-0.08px] text-ink-1">{children}</h2>
}

function ReadyRow({ icon: Icon, title, detail, onClick, testId }: { icon: LucideIcon; title: string; detail: string; onClick: () => void; testId: string }) {
  return (
    <button type="button" onClick={onClick} className="flex min-h-[52px] w-full items-center gap-3 py-2.5 text-left" data-testid={testId}>
      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-tile bg-brand-soft text-brand-primary" aria-hidden="true">
        <Icon className="h-[18px] w-[18px]" strokeWidth={1.8} />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-row font-semibold text-ink-1">{title}</span>
        <span className="block text-caption text-ink-3">{detail}</span>
      </span>
      <ChevronRight className="h-[18px] w-[18px] shrink-0 text-ink-4" strokeWidth={2} aria-hidden="true" />
    </button>
  )
}

export function CoachRolesEmptyState({
  postedThisYear, recentlyClosed, ownStatuses, careerEntryCount, acceptedReferenceCount,
  alertsOn, alertsBusy, onToggleAlerts, onAddCareer, onAskReference, onOpenRole, now,
}: CoachRolesEmptyStateProps) {
  const posted = coachingRolesPostedLine(postedThisYear)
  const needsCareer = careerEntryCount === 0
  const needsReference = acceptedReferenceCount === 0

  return (
    <div className="flex flex-col px-5 pb-6" data-testid="coach-roles-empty">
      <div className="flex flex-col items-center gap-2 py-6 text-center">
        <span className="flex h-[52px] w-[52px] items-center justify-center rounded-full bg-surface-muted text-ink-2" aria-hidden="true">
          <Briefcase className="h-6 w-6" strokeWidth={1.6} />
        </span>
        <h2 className="text-[16px] font-semibold leading-[21px] text-ink-1">No coaching roles open right now</h2>
        {posted && <p className="text-secondary text-ink-2" data-testid="coach-roles-posted-line">{posted}</p>}
      </div>

      <div className="mt-3">
        <SwitchCardRow
          title="Coaching role alerts"
          description="Push and email when a role fits you"
          checked={alertsOn}
          disabled={alertsBusy}
          onChange={onToggleAlerts}
          testId="coach-role-alerts"
        />
      </div>

      {(needsCareer || needsReference) && (
        <section data-testid="coach-be-ready">
          <SectionTitle>Be ready for the next one</SectionTitle>
          {needsCareer && <ReadyRow icon={Trophy} title="Add your coaching career" detail="Clubs read career first. You have none yet." onClick={onAddCareer} testId="coach-ready-career" />}
          {needsReference && <ReadyRow icon={Medal} title="Ask for a reference" detail="From a player, coach or club you’ve worked with." onClick={onAskReference} testId="coach-ready-reference" />}
        </section>
      )}

      {recentlyClosed.length > 0 && (
        <section data-testid="coach-recently-closed">
          <SectionTitle>Recently closed</SectionTitle>
          {recentlyClosed.map((role) => {
            const own = closedRoleOwnStatus(ownStatuses[role.id])
            const meta = [closedRoleMeta(role), closedRoleDate(role.closedAt, now)].filter(Boolean).join(' · ')
            return (
              <button key={role.id} type="button" onClick={() => onOpenRole(role.id)} className="flex min-h-[52px] w-full items-center gap-3 py-2.5 text-left" data-testid="coach-closed-role">
                <span className="min-w-0 flex-1">
                  <span className="line-clamp-2 block break-words text-row font-semibold text-ink-1">{role.title}</span>
                  {meta && <span className="block truncate text-caption text-ink-3">{meta}</span>}
                </span>
                {own && <span className={`shrink-0 rounded-full px-2 py-0.5 text-caption font-semibold ${STATUS_TONE_PILL.grey}`} data-testid="coach-closed-role-status">{own}</span>}
                <ChevronRight className="h-[18px] w-[18px] shrink-0 text-ink-4" strokeWidth={2} aria-hidden="true" />
              </button>
            )
          })}
        </section>
      )}
    </div>
  )
}
