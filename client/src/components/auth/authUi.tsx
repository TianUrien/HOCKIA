import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { ChevronLeft } from 'lucide-react'
import { cn } from '@/lib/utils'
import { IconButton } from '@/components/ui/IconButton'
import { webButtonClassName } from '@/components/ui/buttonClasses'

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
    <div className="flex min-h-app-screen flex-col bg-white pt-[env(safe-area-inset-top)] pb-[max(env(safe-area-inset-bottom),16px)]">
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

/** "By continuing, you agree to our Terms and Privacy Policy."
 *  `tone="web"` = the Landing v3 auth card cut (13/18, ink-3, underlined links). */
export function TermsLine({ className, tone = 'app' }: { className?: string; tone?: 'app' | 'web' }) {
  const link = tone === 'web' ? 'underline underline-offset-2 hover:text-ink-1' : 'text-ink-2 underline underline-offset-2'
  return (
    <p className={cn('text-center', tone === 'web' ? 'text-[13px] leading-[18px] text-ink-3' : 'text-caption leading-4 text-ink-3', className)}>
      By continuing, you agree to our{' '}
      <Link to="/terms" className={link}>Terms</Link>
      {' '}and{' '}
      <Link to="/privacy-policy" className={link}>Privacy Policy</Link>.
    </p>
  )
}

/* ────────────────────── Landing v3 auth layout ──────────────────────
 * Figma "Landing v3" (approved 6 Oct 2026): Log in 127:2141 / 127:2204, Sign
 * up 127:2261 / 127:2304. Desktop: surface-subtle page, 72 header (logo left,
 * "Back to home" right), a white card (radius 28, pad 40, 1 px line, shadow)
 * centred vertically with a 360 form, and the switch line under the card.
 * Phones: no card — a 56 top bar (back chevron, centred logo), content at 20
 * px gutters and the switch line pinned to the bottom (safe-area aware).
 */

interface AuthPageProps {
  children: ReactNode
  /** "New to HOCKIA? Create an account" — under the card / pinned to the bottom. */
  switchLine: ReactNode
  /** Phone top-bar back chevron. Omit when there is nowhere to go (native First run). */
  onBack?: () => void
  /** Accessible name of the back chevron, "Back to <parent>". */
  backLabel?: string
  className?: string
}

export function AuthPage({ children, switchLine, onBack, backLabel = 'Back', className }: AuthPageProps) {
  return (
    <div className="flex min-h-app-screen flex-col bg-white pt-[env(safe-area-inset-top)] md:bg-surface-subtle">
      {/* Phone top bar (56) */}
      <div className="relative flex h-14 shrink-0 items-center px-2 md:hidden">
        {onBack ? (
          <IconButton label={backLabel} tone="brand" onClick={onBack}>
            <ChevronLeft className="h-6 w-6" strokeWidth={2} />
          </IconButton>
        ) : (
          <span className="w-11" />
        )}
        <Link to="/" aria-label="HOCKIA home" className="absolute left-1/2 top-1/2 flex -translate-x-1/2 -translate-y-1/2 items-center gap-2.5 rounded-lg focus:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring">
          <AuthLogo />
        </Link>
      </div>

      {/* Desktop header (72) */}
      <header className="mx-auto hidden h-[72px] w-full max-w-[1280px] shrink-0 items-center justify-between px-10 md:flex">
        <Link to="/" aria-label="HOCKIA home" className="flex items-center gap-2.5 rounded-lg focus:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring">
          <AuthLogo />
        </Link>
        <Link to="/" className={webButtonClassName({ variant: 'link', size: 'medium' })}>
          Back to home
        </Link>
      </header>

      <main className={cn('flex w-full flex-1 flex-col md:items-center md:justify-center md:px-6 md:py-10', className)}>
        <div className="flex w-full flex-1 flex-col px-5 pt-5 md:w-[440px] md:flex-none md:rounded-panel md:border md:border-line md:bg-white md:p-10 md:shadow-[0_12px_32px_rgba(15,15,20,0.06)]">
          {children}
        </div>
        <p className="mt-auto px-5 pb-[max(env(safe-area-inset-bottom),24px)] pt-8 text-center text-[15px] leading-[21px] text-ink-2 md:mt-8 md:p-0">
          {switchLine}
        </p>
      </main>
    </div>
  )
}

function AuthLogo() {
  return (
    <>
      <img src="/brand/svg/hockia-logo-violet.svg" alt="" width={300} height={243} className="h-6 w-auto md:h-7" />
      <img src="/brand/wordmark/hockia-wordmark-black.svg" alt="HOCKIA" width={153} height={42} className="h-4 w-auto md:h-[18px]" />
    </>
  )
}

/** Card heading: the symbol (desktop only — on phones it is in the top bar),
 *  the title 28/34 and the subtitle 15/21. */
export function AuthHeading({ title, subtitle }: { title: string; subtitle?: string }) {
  return (
    <div className="flex flex-col">
      <img src="/brand/svg/hockia-logo-violet.svg" alt="" width={300} height={243} className="mb-6 hidden h-9 w-auto self-start md:block" />
      <h1 className="text-web3-title text-ink-1">{title}</h1>
      {subtitle && <p className="mt-2 text-[15px] leading-[21px] text-ink-2">{subtitle}</p>}
    </div>
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
