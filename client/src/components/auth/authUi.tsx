import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { ChevronLeft } from 'lucide-react'
import { cn } from '@/lib/utils'
import { IconButton } from '@/components/ui/IconButton'

/**
 * Pieces shared by the account-first auth and onboarding screens (Figma 04
 * Player: First run 104:2096, Log in 114:477, Create with email 114:434,
 * Choose your role 101:892, Set up 114:537 / 114:608). Phone-first: a white
 * full-height page with a 16 px gutter and safe-area padding; on wider screens
 * the same column sits centred at 448 px so desktop keeps working.
 */
/* Field header + Text field classes live in `ui/fieldClasses.ts` (shared with
   the pickers' 'field' appearance); this file exports components only. */

interface AuthShellProps {
  children: ReactNode
  /** Back chevron — accessible name "Back to <parent>". Omit for root screens. */
  back?: { parent: string; onBack: () => void }
  /** Centred nav-bar title (17/semibold). */
  title?: string
  /** One trailing text action in the nav bar ("Skip"). */
  trailing?: ReactNode
  /** Step progress "Step 1 of 2" above the content (Figma Step progress 472:159). */
  step?: { current: number; total: number }
  className?: string
}

export function AuthShell({ children, back, title, trailing, step, className }: AuthShellProps) {
  return (
    <div className="flex min-h-[100dvh] flex-col bg-white pt-[env(safe-area-inset-top)] pb-[max(env(safe-area-inset-bottom),16px)]">
      {(back || title || trailing) && (
        <div className="relative mx-auto flex h-11 w-full max-w-md items-center justify-between px-2">
          {back ? (
            // Nav bar back = Ghost icon button 44 (Figma 459:171) with the chevron.
            <IconButton label={`Back to ${back.parent}`} tone="brand" onClick={back.onBack}>
              <ChevronLeft className="h-6 w-6" strokeWidth={2} />
            </IconButton>
          ) : (
            <span className="w-11" />
          )}
          {title && (
            <h1 className="pointer-events-none absolute inset-x-16 truncate text-center text-body font-semibold text-ink-1">{title}</h1>
          )}
          {trailing ? <div className="flex h-11 items-center pr-2">{trailing}</div> : <span className="w-11" />}
        </div>
      )}
      {step && (
        <div className="mx-auto w-full max-w-md px-4 pt-2" aria-label={`Step ${step.current} of ${step.total}`}>
          <div className="flex gap-1.5" aria-hidden="true">
            {Array.from({ length: step.total }, (_, i) => (
              <span key={i} className={cn('h-1 flex-1 rounded-full', i < step.current ? 'bg-hockia-primary' : 'bg-line')} />
            ))}
          </div>
          <p className="mt-2 text-caption font-semibold uppercase tracking-[0.04em] text-ink-3">
            Step {step.current} of {step.total}
          </p>
        </div>
      )}
      <main className={cn('mx-auto flex w-full max-w-md flex-1 flex-col px-4', className)}>{children}</main>
    </div>
  )
}

/** "By continuing, you agree to our Terms and Privacy Policy." */
export function TermsLine({ className }: { className?: string }) {
  return (
    <p className={cn('text-center text-caption leading-4 text-ink-3', className)}>
      By continuing, you agree to our{' '}
      <Link to="/terms" className="text-ink-2 underline underline-offset-2">Terms</Link>
      {' '}and{' '}
      <Link to="/privacy-policy" className="text-ink-2 underline underline-offset-2">Privacy Policy</Link>.
    </p>
  )
}

/** Inline error under a form (role="alert"). */
export function FormError({ children }: { children: ReactNode }) {
  if (!children) return null
  return (
    <p className="rounded-[12px] bg-status-danger-soft px-3.5 py-2.5 text-secondary text-status-danger" role="alert">
      {children}
    </p>
  )
}
