import { Link } from 'react-router-dom'
import { Briefcase, ChevronRight } from 'lucide-react'
import { applicationCardDetail, applicationCardTitle, type ClubApplication } from '@/lib/clubInbox'
import { cn } from '@/lib/utils'

/**
 * Club v2 Chat context card (Figma D1.20 353:718 / D1.21 353:809; DEV NOTES
 * 355:919, 355:923): the other person's application to one of the club's
 * roles, pinned above the thread so the club answers with context. Closed
 * ones say how; days left turn amber at 5 (the club must act). Tap →
 * Applicants for that role. Club-only.
 */
export function ChatApplicationCard({ app, expiryDays }: { app: ClubApplication; expiryDays: number }) {
  const detail = applicationCardDetail(app, expiryDays)
  return (
    <div className="shrink-0 bg-white px-4 pb-1 pt-3">
      <Link
        to={`/dashboard/opportunities/${app.opportunityId}/applicants`}
        className="flex items-center gap-3 rounded-2xl bg-surface-grouped py-3 pl-3 pr-2.5 active:bg-[#e9e9ef]"
        data-testid="chat-application-card"
      >
        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-[10px] bg-hockia-soft text-hockia-primary">
          <Briefcase className="h-[18px] w-[18px]" strokeWidth={1.9} aria-hidden="true" />
        </span>
        <span className="min-w-0 flex-1">
          <span className="line-clamp-2 block text-[15px] font-semibold leading-5 text-ink-1">{applicationCardTitle(app)}</span>
          <span className={cn('block truncate text-caption', detail.urgent ? 'font-semibold text-amber-600' : 'text-ink-2')}>{detail.text}</span>
        </span>
        <ChevronRight className="h-5 w-5 shrink-0 text-ink-3" strokeWidth={1.75} aria-hidden="true" />
      </Link>
    </div>
  )
}

/** The empty new chat with an applicant (D1.21): one useful line. */
export function ApplicantChatEmpty({ title, body }: { title: string; body: string }) {
  return (
    <div className="flex flex-col items-center px-8 pt-12 text-center" data-testid="applicant-chat-empty">
      <p className="text-[17px] font-semibold text-ink-1">{title}</p>
      <p className="mt-1 text-secondary text-ink-2">{body}</p>
    </div>
  )
}
