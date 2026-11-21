import { lazy, Suspense, useState } from 'react'
import { trackDbEvent } from '@/lib/trackDbEvent'
import { cn } from '@/lib/utils'
import { useClubT } from '@/i18n/ns/club'

const FeedbackModal = lazy(() => import('./FeedbackModal'))

/**
 * "Report a problem" where the recruiting work happens (founder ruling
 * 2026-11-21, docs/product/proposals/recruiter-satisfaction.md). Opens the
 * same feedback form as Settings, which records the screen it was sent from:
 * until now it was only reachable from Settings and nobody used it.
 */
export function ReportProblemLink({ surface, className }: { surface: string; className?: string }) {
  const t = useClubT()
  const [open, setOpen] = useState(false)
  const [mounted, setMounted] = useState(false)
  return (
    <>
      <button
        type="button"
        onClick={() => { setMounted(true); setOpen(true); trackDbEvent('report_problem_open', undefined, undefined, { surface }) }}
        className={cn('flex min-h-[44px] items-center justify-center text-[15px] text-ink-2 underline-offset-2 hover:underline', className)}
        data-testid="report-problem-link"
      >
        {t('reportProblem.link')}
      </button>
      {mounted && (
        <Suspense fallback={null}>
          <FeedbackModal open={open} onClose={() => setOpen(false)} />
        </Suspense>
      )}
    </>
  )
}
